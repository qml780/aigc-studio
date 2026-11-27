export class InputError extends Error {
  status = 400;
}

export function text(value: unknown, label: string, max: number, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new InputError(`${label}必须是文本`);
  const result = value.trim();
  if (required && !result) throw new InputError(`请填写${label}`);
  if (result.length > max) throw new InputError(`${label}不能超过 ${max} 个字符`);
  return result;
}

export const keywordCategories = ['hairstyle', 'clothing', 'colors', 'style', 'features', 'quality'] as const;
export type KeywordSet = Record<typeof keywordCategories[number], string[]>;

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || v.length > 200)) {
    throw new InputError('关键词必须是最多 100 个文本组成的列表，每项最多 200 个字符');
  }
  return [...new Set(value.map(v => v.trim()).filter(Boolean))];
}

export function keywords(value: unknown): KeywordSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('关键词格式错误');
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keywordCategories.map(key => [key, record[key] === undefined ? [] : stringList(record[key])])) as KeywordSet;
}

export function imageData(value: unknown, maxBytes = 5 * 1024 * 1024): { buffer: Buffer; ext: string } {
  if (typeof value !== 'string') throw new InputError('请提供图片数据');
  // Limit encoded size before allocating a decoded buffer.
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 100) throw new InputError('图片超过大小限制');
  const match = /^(?:data:image\/(?:jpeg|jpg|png|webp|gif);base64,)?([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) throw new InputError('图片 Base64 格式错误');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > maxBytes) throw new InputError('图片为空或超过大小限制');
  let ext = '';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ext = 'png';
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) ext = 'jpg';
  else if (['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) ext = 'gif';
  else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
  if (!ext) throw new InputError('仅支持 PNG、JPEG、WebP、GIF 图片');
  return { buffer, ext };
}
