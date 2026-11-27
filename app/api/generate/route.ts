import { NextRequest, NextResponse } from 'next/server';
import { textToImage, dreamOGenerate, getTaskResult } from '@/lib/jimeng';
import { arkVideoGenerate, getArkVideoTaskResult } from '@/lib/ark_video';
import { getProject, addTask, updateTask, buildFullPrompt, saveUploadedImage } from '@/lib/projects';
import type { Task } from '@/lib/projects';
import { generationInput, imageTaskResult } from '@/lib/generation';
import { getCapabilities } from '@/lib/config';
import { apiError, readBody } from '@/lib/api';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const imageBase64 = body.imageBase64 as string | undefined;
    const promptImagesBase64 = body.promptImagesBase64 as string[] | undefined;
    const params = generationInput(body);
    const { projectId, scene, type, width, height, seed } = params;
    const project = getProject(projectId);
    if (!project) return NextResponse.json({ success: false, error: '项目不存在' }, { status: 404 });
    const caps = getCapabilities();
    if (type !== 'text2img' && !caps.experimental) return NextResponse.json({ success: false, error: '该模式属于实验功能，当前未启用' }, { status: 409 });
    if (type === 'doubao-seedance' ? !process.env.ARK_API_KEY || !process.env.ARK_VIDEO_MODEL : !caps.image) return NextResponse.json({ success: false, error: type === 'doubao-seedance' ? '视频生成服务尚未配置' : '请先配置文生图服务的 VOLCENGINE_AK 和 VOLCENGINE_SK' }, { status: 503 });
    const fullPrompt = buildFullPrompt(project, scene);
    if (!scene && !project.characterKeywords.features.length && !project.characterKeywords.clothing.length && !project.characterKeywords.hairstyle.length) return NextResponse.json({ success: false, error: '请填写场景描述或角色关键词' }, { status: 400 });
    if (fullPrompt.length > 800) return NextResponse.json({ success: false, error: '组合后的提示词不能超过 800 个字符，请精简关键词' }, { status: 400 });
    const task = addTask(projectId, { type, prompt: scene, fullPrompt, status: 'processing', width, height, seed, promptImagesBase64: type === 'doubao-seedance' ? promptImagesBase64 || [] : [] });
    if (!task) return NextResponse.json({ success: false, error: '项目已被删除' }, { status: 404 });
    try {
      if (type === 'doubao-seedance') {
        const result = await arkVideoGenerate({ prompt: fullPrompt, imageBase64, promptImagesBase64 });
        if (!result.id) throw new Error('视频服务未返回任务 ID');
        updateTask(projectId, task.id, { taskId: result.id });
      } else {
        const result = type === 'dreamo'
          ? await dreamOGenerate({ prompt: fullPrompt, imageBase64: imageBase64!.replace(/^data:image\/[^;]+;base64,/, ''), width, height })
          : await textToImage({ prompt: fullPrompt, width, height, seed });
        if (result.code !== 10000) throw new Error(result.message || '提交生成任务失败');
        if (result.data?.task_id) updateTask(projectId, task.id, { taskId: result.data.task_id });
        else if (result.data?.binary_data_base64?.[0] || result.data?.image_urls?.[0]) {
          const imageUrl = result.data.binary_data_base64?.[0] ? await saveUploadedImage(result.data.binary_data_base64[0], undefined, 20 * 1024 * 1024) : result.data.image_urls![0];
          updateTask(projectId, task.id, { status: 'done', imageUrl });
        } else throw new Error('生成服务未返回任务或图片');
      }
      return NextResponse.json({ success: true, data: { taskId: task.id } }, { status: 202 });
    } catch (error) {
      console.error('[generation submit]', error);
      updateTask(projectId, task.id, { status: 'failed', error: '提交失败或超时，请检查服务端日志和服务商任务记录，再决定是否重新提交' });
      return NextResponse.json({ success: false, error: '提交生成任务失败，请检查服务配置和服务端日志', data: { taskId: task.id } }, { status: 502 });
    }
  } catch (e) { return apiError(e); }
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId');
    const taskId = req.nextUrl.searchParams.get('taskId');
    if (!projectId || !taskId) return NextResponse.json({ success: false, error: '缺少项目或任务 ID' }, { status: 400 });
    const task = getProject(projectId)?.tasks.find(t => t.id === taskId);
    if (!task) return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    let warning: string | undefined;
    if (task.status === 'processing') {
      if (Date.now() - Date.parse(task.createdAt) > 15 * 60 * 1000) updateTask(projectId, taskId, { status: 'failed', error: '等待结果超时，请在服务商控制台核对任务状态' });
      else if (task.taskId) {
        try {
          if (task.type === 'doubao-seedance') {
            const result = await getArkVideoTaskResult(task.taskId);
            if (result.status === 'succeeded' && result.result?.video_url) updateTask(projectId, taskId, { status: 'done', imageUrl: result.result.video_url });
            else if (result.status === 'failed') updateTask(projectId, taskId, { status: 'failed', error: '视频生成失败' });
          } else {
            const result = imageTaskResult(await getTaskResult(task.taskId));
            const updates: Partial<Task> = { ...result };
            if (result.status === 'done' && result.imageBase64) {
              updates.imageUrl = await saveUploadedImage(result.imageBase64, undefined, 20 * 1024 * 1024);
              updates.imageBase64 = undefined;
            }
            updateTask(projectId, taskId, updates);
          }
        } catch (e) {
          console.error('[generation poll]', e);
          warning = '暂时无法获取生成结果，正在重试';
        }
      }
    }
    return NextResponse.json({ success: true, data: getProject(projectId)?.tasks.find(t => t.id === taskId), warning });
  } catch (e) { return apiError(e); }
}
