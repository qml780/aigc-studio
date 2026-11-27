import { NextRequest, NextResponse } from 'next/server';
import { analyzeImageKeywords, optimizePrompt, brainstormStoryboard } from '@/lib/llm';
import { getCapabilities } from '@/lib/config';
import { imageData, text, stringList, InputError } from '@/lib/validation';
import { apiError, readBody } from '@/lib/api';

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const action = body.action;
    const caps = getCapabilities();
    if ((action ? !caps.chat : !caps.vision)) return NextResponse.json({ success: false, error: action ? '请先配置 ARK_API_KEY 和 ARK_CHAT_MODEL' : '图片已上传；请配置 ARK_API_KEY 和 ARK_VISION_MODEL 后再分析，也可以手动编辑关键词' }, { status: 503 });
    const rawContext = (body.projectContext || {}) as Record<string, unknown>;
    const context = { characterKeywords: stringList(rawContext.characterKeywords || []), styleKeywords: stringList(rawContext.styleKeywords || []) };
    if (action === 'optimize') {
      const optimized = await optimizePrompt(text(body.prompt, '提示词', 2000, true), context);
      return NextResponse.json({ success: true, data: { optimized } });
    }
    if (action === 'brainstorm_next') {
      const history = body.historyPrompts || [];
      if (!Array.isArray(history) || history.length > 5) throw new InputError('最多使用 5 条历史场景');
      const ideas = await brainstormStoryboard(context, history.map(item => text(item, '历史场景', 800)));
      return NextResponse.json({ success: true, data: { ideas } });
    }
    imageData(body.imageBase64);
    const data = await analyzeImageKeywords(body.imageBase64 as string, body.type === 'style' ? 'style' : 'character');
    return NextResponse.json({ success: true, configured: true, data });
  } catch (e) { return apiError(e); }
}
