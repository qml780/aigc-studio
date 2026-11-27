import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ success: false, error: '视频合成与配音将在后续版本提供，目前可下载单个生成结果' }, { status: 501 });
}
