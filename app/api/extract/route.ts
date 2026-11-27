import { NextRequest, NextResponse } from 'next/server';
import { extractKeywordsFromTextLLM } from '@/lib/llm';
import { getCapabilities } from '@/lib/config';
import { text } from '@/lib/validation';
import { apiError, readBody } from '@/lib/api';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const description = text(body.description, '描述', 2000, true);
    if (!getCapabilities().chat) return NextResponse.json({ success: false, error: '请配置 ARK_API_KEY 和 ARK_CHAT_MODEL，或手动添加关键词' }, { status: 503 });
    const data = await extractKeywordsFromTextLLM(description, body.type === 'style' ? 'style' : 'character');
    return NextResponse.json({ success: true, data });
  } catch (e) { return apiError(e); }
}
