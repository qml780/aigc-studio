import { composePrompt } from '../lib/prompts.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { text, imageData, keywords } from '../lib/validation.ts';
import { generationInput, imageTaskResult } from '../lib/generation.ts';
import { signRequest, textToImage, getTaskResult } from '../lib/jimeng.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNq0AAAAASUVORK5CYII=';
const fakeAK = 'unit-test-access';
const fakeSK = 'unit-test-secret';

test('invalid uploads and misleading extensions cannot bypass image validation', () => {
  assert.equal(imageData(`data:image/png;base64,${png}`).ext, 'png');
  assert.equal(imageData(`data:image/jpeg;base64,${png}`).ext, 'png');
  assert.throws(() => imageData('data:image/svg+xml;base64,PHN2Zz4='));
  assert.throws(() => imageData('data:image/png;base64,PHNjcmlwdD4='));
  assert.throws(() => imageData(png, 10));
  assert.throws(() => imageData('%%%'));
});

test('project and keyword validation reject invalid values and normalize lists', () => {
  assert.equal(text('  project  ', 'name', 100, true), 'project');
  assert.throws(() => text('  ', 'name', 100, true));
  assert.throws(() => text(5, 'name', 100));
  assert.deepEqual(keywords({ style: [' 水彩 ', '水彩', ''] }).style, ['水彩']);
  assert.throws(() => keywords({ style: 'watercolor' }));
});

test('generation preserves seed zero and rejects malformed modes and dimensions', () => {
  const params = generationInput({ projectId: 'p', scene: 'scene', seed: 0 });
  assert.equal(params.seed, 0);
  assert.equal(params.type, 'text2img');
  assert.throws(() => generationInput({ projectId: 'p', type: 'unknown' }));
  assert.throws(() => generationInput({ projectId: 'p', width: 99999 }));
  assert.throws(() => generationInput({ projectId: 'p', width: 1024, height: 100 }));
  assert.throws(() => generationInput({ projectId: 'p', type: 'dreamo' }));
  assert.throws(() => generationInput({ projectId: 'p', seed: -2 }));
});

test('official async task states resolve success, failure, expiry and empty results', () => {
  assert.equal(imageTaskResult({ code: 10000, message: '', data: { status: 'generating' } }).status, 'processing');
  assert.equal(imageTaskResult({ code: 10000, message: '', data: { status: 'done', binary_data_base64: [png] } }).status, 'done');
  assert.equal(imageTaskResult({ code: 10000, message: '', data: { status: 'done' } }).status, 'failed');
  assert.equal(imageTaskResult({ code: 10000, message: '', data: { status: 'expired' } }).status, 'failed');
  assert.equal(imageTaskResult({ code: 50413, message: 'rejected' }).error, 'rejected');
});

test('signature agrees with the documented canonical request and key derivation', () => {
  process.env.VOLCENGINE_AK = fakeAK; process.env.VOLCENGINE_SK = fakeSK;
  process.env.VOLCENGINE_REGION = 'cn-north-1'; process.env.VOLCENGINE_HOST = 'visual.volcengineapi.com';
  const payload = JSON.stringify({ req_key: 'jimeng_t2i_v30', prompt: 'test' });
  const signed = signRequest('CVSync2AsyncSubmitTask', payload, new Date('2026-01-02T03:04:05Z'));
  const sha = s => createHash('sha256').update(s).digest('hex');
  const hm = (key, s) => createHmac('sha256', key).update(s).digest();
  const canonical = `POST\n/\nAction=CVSync2AsyncSubmitTask&Version=2022-08-31\ncontent-type:application/json\nhost:visual.volcengineapi.com\nx-date:20260102T030405Z\n\ncontent-type;host;x-date\n${sha(payload)}`;
  const scope = '20260102/cn-north-1/cv/request';
  const key = hm(hm(hm(hm(fakeSK, '20260102'), 'cn-north-1'), 'cv'), 'request');
  const expected = hm(key, `HMAC-SHA256\n20260102T030405Z\n${scope}\n${sha(canonical)}`).toString('hex');
  assert.ok(signed.headers.Authorization.endsWith(`Signature=${expected}`));
  assert.equal(signed.headers['X-Date'], '20260102T030405Z');
  assert.ok(signed.url.includes('Action=CVSync2AsyncSubmitTask'));
});

test('provider integration uses matching submit/query actions and requests durable image data', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ code: 10000, message: 'Success', data: { task_id: 'test-task' } });
  };
  try {
    await textToImage({ prompt: 'test', width: 1024, height: 1024, seed: 0 });
    await getTaskResult('test-task');
    assert.equal(calls[0].body.req_key, 'jimeng_t2i_v30');
    assert.equal(calls[0].body.seed, 0);
    assert.ok(calls[1].url.includes('Action=CVSync2AsyncGetResult'));
    assert.equal(calls[1].body.req_key, calls[0].body.req_key);
    assert.equal(JSON.parse(calls[1].body.req_json).return_url, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('submission timeout is surfaced without automatically creating duplicate jobs', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('timeout'); };
  try {
    await assert.rejects(textToImage({ prompt: 'test', width: 1024, height: 1024, seed: -1 }), /timeout/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('project edits preserve task history and store uploads under the configured data directory', async () => {
  mkdirSync(path.resolve('.tmp'), { recursive: true });
  const directory = mkdtempSync(path.resolve('.tmp/unit-data-'));
  process.env.AIGC_DATA_DIR = directory;
  const store = await import('../lib/projects.ts');
  const project = store.createProject({ name: '  Test project  ' });
  assert.equal(project.name, 'Test project');
  const task = store.addTask(project.id, { type: 'text2img', prompt: 'test', fullPrompt: 'test', status: 'processing', width: 1024, height: 1024, seed: 0 });
  store.updateProject(project.id, store.validateProjectUpdates({ description: 'saved', characterKeywords: { features: ['角色'] } }));
  assert.equal(store.getProject(project.id).tasks[0].id, task.id);
  assert.throws(() => store.validateProjectUpdates({ id: 'changed', tasks: [] }));
  assert.throws(() => store.validateProjectUpdates({ characterImage: '/uploads/../../x.svg' }));
  const url = await store.saveUploadedImage(`data:image/png;base64,${png}`, '../../pretend.html');
  assert.match(url, /^\/uploads\/[a-f0-9-]+\.png$/);
  assert.ok(existsSync(path.join(directory, url.slice(1))));
  assert.equal(JSON.parse(readFileSync(path.join(directory, 'projects.json'), 'utf8'))[0].description, 'saved');
  assert.equal(store.deleteProject(project.id), true);
  assert.equal(store.getProject(project.id), null);
});

test('prompt composition includes edited character, style and quality keywords without duplicates', () => {
  const project = { characterKeywords: keywords({ features: ['角色'], style: ['水彩'], quality: ['清晰'] }), styleKeywords: keywords({ features: ['逆光'], colors: ['暖色'], quality: ['清晰'] }), defaultQuality: ['高质量'] };
  const prompt = composePrompt(project, ' 花园 ');
  assert.equal(prompt, '角色, 水彩, 逆光, 暖色, 花园, 高质量, 清晰');
});
