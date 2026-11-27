import { NextRequest, NextResponse } from 'next/server';
import { getAllProjects, getProject, createProject, updateProject, deleteProject, validateProjectUpdates } from '@/lib/projects';
import { apiError, readBody } from '@/lib/api';
import { text } from '@/lib/validation';

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      const project = getProject(id);
      if (!project) return NextResponse.json({ success: false, error: '项目不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: project });
    }
    return NextResponse.json({ success: true, data: getAllProjects() });
  } catch (e) { return apiError(e); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const project = createProject({ name: text(body.name, '项目名称', 100, true), description: text(body.description, '项目描述', 2000) });
    return NextResponse.json({ success: true, data: project }, { status: 201 });
  } catch (e) { return apiError(e); }
}
export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updates } = await readBody(req);
    const project = updateProject(text(id, '项目 ID', 100, true), validateProjectUpdates(updates));
    if (!project) return NextResponse.json({ success: false, error: '项目不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: project });
  } catch (e) { return apiError(e); }
}
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await readBody(req);
    if (!deleteProject(text(id, '项目 ID', 100, true))) return NextResponse.json({ success: false, error: '项目不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) { return apiError(e); }
}
