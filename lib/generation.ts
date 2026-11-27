import { InputError, imageData, text } from './validation.ts';

export function generationInput(body: Record<string, unknown>) {
  const projectId = text(body.projectId, '项目 ID', 100, true);
  const scene = text(body.scene, '场景描述', 800);
  const type = body.type ?? 'text2img';
  if (type !== 'text2img' && type !== 'dreamo' && type !== 'doubao-seedance') throw new InputError('不支持的生成模式');
  const width = body.width ?? 1024;
  const height = body.height ?? 1024;
  const seed = body.seed ?? -1;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256 || width * height < 512 * 512 || width * height > 2048 * 2048 || width / height < 1 / 3 || width / height > 3) {
    throw new InputError('图片尺寸超出支持范围，宽高比需在 1:3 至 3:1 之间');
  }
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < -1) throw new InputError('随机种子必须是 -1 或非负整数');
  if (type === 'dreamo') imageData(body.imageBase64);
  if (body.promptImagesBase64 !== undefined) {
    if (!Array.isArray(body.promptImagesBase64) || body.promptImagesBase64.length > 4) throw new InputError('最多使用 4 张参考图片');
    body.promptImagesBase64.forEach(v => imageData(v));
  }
  return { projectId, scene, type: type as 'text2img' | 'dreamo' | 'doubao-seedance', width, height, seed };
}

export function imageTaskResult(result: { code: number; message: string; data?: { status?: string | number; image_urls?: string[]; binary_data_base64?: string[] } }) {
  if (result.code !== 10000) return { status: 'failed' as const, error: result.message || '生成失败' };
  if (result.data?.status === 'done' || result.data?.status === 2) {
    if (!result.data.image_urls?.[0] && !result.data.binary_data_base64?.[0]) return { status: 'failed' as const, error: '生成服务没有返回图片' };
    return { status: 'done' as const, imageUrl: result.data.image_urls?.[0], imageBase64: result.data.binary_data_base64?.[0] };
  }
  if (['expired', 'not_found', 3, 4].includes(result.data?.status ?? '')) return { status: 'failed' as const, error: '生成任务已过期或不存在，请重新提交' };
  return { status: 'processing' as const };
}
