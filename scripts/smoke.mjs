import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const dataDir = mkdtempSync(path.join(root, '.tmp', 'smoke-data-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, ARK_API_KEY: '', ARK_CHAT_MODEL: '', ARK_VISION_MODEL: '', VOLCENGINE_AK: '', VOLCENGINE_SK: '', AIGC_ENABLE_EXPERIMENTAL: 'false', AIGC_DATA_DIR: dataDir, NEXT_TELEMETRY_DISABLED: '1', TEMP: path.join(root, '.tmp'), TMP: path.join(root, '.tmp') };
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(port)], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', chunk => { log += chunk; });
server.stderr.on('data', chunk => { log += chunk; });
async function call(url, body, method = 'POST') {
  const response = await fetch(base + url, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, result: await response.json() };
}
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try { if ((await fetch(base + '/api/config')).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert.ok(ready, 'production server became ready');
  assert.equal((await fetch(base)).status, 200);
  const config = await call('/api/config');
  assert.deepEqual(config.result.data, { chat: false, vision: false, image: false, experimental: false });
  assert.equal((await call('/api/projects', { name: '  ' })).status, 400);
  assert.equal((await call('/api/projects', null)).status, 400);
  assert.equal((await call('/api/upload', [])).status, 400);
  const created = await call('/api/projects', { name: 'Smoke project', description: 'round trip' });
  assert.equal(created.status, 201);
  const id = created.result.data.id;
  assert.equal((await fetch(base + `/project/${id}`)).status, 200);
  assert.equal((await call('/api/projects', { id, tasks: [] }, 'PATCH')).status, 400);
  const updated = await call('/api/projects', { id, characterKeywords: { features: ['测试角色'], style: ['水彩'] } }, 'PATCH');
  assert.deepEqual(updated.result.data.characterKeywords.features, ['测试角色']);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNq0AAAAASUVORK5CYII=';
  const uploaded = await call('/api/upload', { base64: `data:image/png;base64,${png}`, filename: 'pretend.html' });
  assert.equal(uploaded.status, 200);
  const imageResponse = await fetch(base + uploaded.result.data.url);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from(png, 'base64'));
  const linked = await call('/api/projects', { id, characterImage: uploaded.result.data.url }, 'PATCH');
  assert.equal(linked.result.data.characterImage, uploaded.result.data.url);
  assert.equal((await call('/api/upload', { base64: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  assert.equal((await call('/api/analyze', { imageBase64: `data:image/png;base64,${png}` })).status, 503);
  assert.equal((await call('/api/extract', { description: '测试角色' })).status, 503);
  assert.equal((await call('/api/generate', { projectId: id, scene: '测试' })).status, 503);
  assert.equal((await call('/api/generate', { projectId: id, type: 'doubao-seedance', scene: 'test' })).status, 409);
  assert.equal((await call('/api/generate', { projectId: id, width: 99999 })).status, 400);
  const reloaded = await call(`/api/projects?id=${id}`);
  assert.equal(reloaded.result.data.tasks.length, 0, 'missing credentials did not create fake processing tasks');
  assert.equal((await call('/api/video/export', {})).status, 501);
  assert.equal((await call('/api/projects', { id }, 'DELETE')).status, 200);
  assert.equal((await call(`/api/projects?id=${id}`)).status, 404);
  console.log('PASS: production pages, project CRUD/persistence, uploads/readback, validation, configuration errors and experimental feature gating');
} finally {
  server.kill();
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else { server.once('exit', resolve); setTimeout(resolve, 5000); } });
  writeFileSync(path.join(dataDir, 'server.log'), log);
}
