import { NextRequest, NextResponse } from 'next/server';
import { saveUploadedImage } from '@/lib/projects';
import { apiError, readBody } from '@/lib/api';

export async function POST(req: NextRequest) {
  try {
    if (Number(req.headers.get('content-length')) > 7 * 1024 * 1024) return NextResponse.json({ success: false, error: '图片不能超过 5 MB' }, { status: 413 });
    const { base64 } = await readBody(req);
    const url = await saveUploadedImage(base64 as string);
    return NextResponse.json({ success: true, data: { url } });
  } catch (e) { return apiError(e); }
}
