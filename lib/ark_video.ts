import { fetchWithTimeout } from './llm.ts';

const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const ARK_VIDEO_MODEL = process.env.ARK_VIDEO_MODEL || '';  // Doubao-Seedance-1.0-pro

export interface ArkVideoResponse {
  id?: string;
  task_id?: string;
  status?: string;
  error?: { message?: string };
  result?: {
    video_url?: string;
  }
}

/** 提交 Ark 视频生成任务 */
export async function arkVideoGenerate(params: {
  prompt: string;
  imageBase64?: string; // 兼容单图旧字段
  promptImagesBase64?: string[]; // 支持多张垫图
  resolution?: string; // e.g. "1080p"
}): Promise<ArkVideoResponse> {
  const content: Array<{ type: string; image_url?: { url: string }; text?: string }> = [];

  // 获取所有图片并插入到提示词结构中（从按顺序上传的多图，或是单图）
  const images = params.promptImagesBase64 || (params.imageBase64 ? [params.imageBase64] : []);
  for (const b64 of images) {
    const cleanBase64 = b64.replace(/^data:image\/\w+;base64,/, '');
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${cleanBase64}` }
    });
  }

  // 添加文本提示词
  content.push({ type: 'text', text: params.prompt || '默认视频场景' });

  // According to standard Ark Video documentation
  const body: { model: string; content: typeof content; resolution?: string } = {
    model: ARK_VIDEO_MODEL,
    content: content,
  };

  // HD / 1080p support format if needed
  if (params.resolution === '1080p') {
    body.resolution = '1080p';
  }

  try {
    const response = await fetchWithTimeout(`${ARK_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify(body),
    }, 30000); // 30秒超时确保能提交任务

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ark API Error (${response.status}): ${err}`);
    }

    const data = await response.json();
    return data;
  } catch (err: unknown) {
    console.error('Ark Video Task Creation Failed:', err);
    throw new Error(`视频生成任务提交失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 轮询查询 Ark 视频任务状态 */
export async function getArkVideoTaskResult(taskId: string): Promise<ArkVideoResponse> {
  try {
    const response = await fetchWithTimeout(`${ARK_BASE_URL}/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ARK_API_KEY}`,
      },
    }, 15000);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ark API Error (${response.status}): ${err}`);
    }

    return response.json();
  } catch (err: unknown) {
    console.error('Ark Video Status Check Failed:', err);
    throw new Error(`视频状态查询失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}
