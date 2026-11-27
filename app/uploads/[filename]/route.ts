import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOADS_DIR } from '@/lib/projects';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  if (!/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(filename)) return new Response('Not found', { status: 404 });
  try {
    const data = await fs.readFile(/* turbopackIgnore: true */ path.join(UPLOADS_DIR, filename));
    const ext = filename.split('.').pop()!;
    return new Response(data, { headers: {
      'Content-Type': ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[ext],
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    } });
  } catch { return new Response('Not found', { status: 404 }); }
}
