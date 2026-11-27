import { NextRequest } from 'next/server';
import { streamChat } from '@/lib/llm';
import { getProject } from '@/lib/projects';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, projectId } = body;

    // Inject project context into system message
    let systemContent = `你是 AIGC Studio 的 AI 创作助手，专门帮助用户优化 AI 绘图工作流。
你的能力：
- 优化和完善提示词（中英文均可）
- 推荐创意场景和构图方案
- 解释 AI 绘图技巧和参数
- 分析画风特征
- 帮助解决生成质量问题
回答时简洁专业，中文回答。`;

    if (projectId) {
      const project = getProject(projectId);
      if (project) {
        const charKws = [
          ...project.characterKeywords.features,
          ...project.characterKeywords.hairstyle,
          ...project.characterKeywords.clothing,
        ].filter(Boolean).join(', ');
        const styleKws = [...project.styleKeywords.style, ...project.styleKeywords.colors].filter(Boolean).join(', ');

        systemContent += `\n\n当前项目「${project.name}」上下文：
- 角色关键词: ${charKws || '(未设置)'}
- 画风关键词: ${styleKws || '(未设置)'}
- 已有任务数: ${project.tasks.length}
- 已完成图片: ${project.tasks.filter((t) => t.status === 'done').length}
你回答时要结合这个项目的具体上下文。`;
      }
    }

    // Prepend system message
    const fullMessages = [
      { role: 'system', content: systemContent },
      ...messages,
    ];

    try {
      return await streamChat(fullMessages);
    } catch (e) {
      const errMsg = String(e);
      let msg = `❌ 连接豆包 API 失败\n\n`;
      if (errMsg.includes('ConnectTimeout') || errMsg.includes('abort') || errMsg.includes('timeout')) {
        msg += `网络连接超时。请检查：\n1. 网络是否能访问 ark.cn-beijing.volces.com\n2. 是否需要代理/VPN\n3. 防火墙是否阻止了 HTTPS 出站连接`;
      } else {
        msg += errMsg;
      }
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
            ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
            ctrl.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' }, status: 200 }
      );
    }
  } catch (e) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: `请求解析错误: ${String(e)}` } }] })}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' }, status: 200 }
    );
  }
}
