import { NextResponse } from 'next/server';
import { getCapabilities } from '@/lib/config';

export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({ success: true, data: getCapabilities() });
}
