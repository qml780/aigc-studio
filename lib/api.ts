import { NextResponse } from 'next/server';
import { InputError } from './validation.ts';

export function apiError(error: unknown) {
  if (error instanceof InputError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ success: false, error: '请求 JSON 格式错误' }, { status: 400 });
  console.error('[AIGC API]', error);
  return NextResponse.json({ success: false, error: '操作失败，请稍后重试并检查服务端日志' }, { status: 500 });
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('请求内容必须是 JSON 对象');
  return body;
}
