import { keywords, stringList } from './validation.ts';
// 火山方舟 豆包 API (OpenAI compatible)
// 文档: https://www.volcengine.com/docs/82379

const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_BASE_URL = (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
const CHAT_MODEL = process.env.ARK_CHAT_MODEL || '';
const VISION_MODEL = process.env.ARK_VISION_MODEL || '';

export async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface KeywordResult {
  hairstyle: string[];
  clothing: string[];
  colors: string[];
  style: string[];
  features: string[];
  quality: string[];
}

export function isConfigured(): boolean {
  return Boolean(CHAT_MODEL) && ARK_API_KEY !== '' && ARK_API_KEY !== 'your-ark-api-key-here';
}

/** 流式对话 - 返回 Response 供直接转发到前端 */
export async function streamChat(messages: ChatMessage[]): Promise<Response> {
  if (!isConfigured()) {
    // Return a mock stream that explains how to configure
    const msg = `⚠️ 请先配置豆包 API Key！\n\n步骤：\n1. 前往 https://console.volcengine.com/ark\n2. 在"API Key管理"中创建新的 API Key\n3. 在项目 .env.local 中填写 ARK_API_KEY 和 ARK_CHAT_MODEL\n4. 重启服务后即可使用 AI 对话功能。`;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const words = msg.split('');
        let i = 0;
        const send = () => {
          if (i < words.length) {
            const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: words[i] } }] })}\n\n`;
            controller.enqueue(encoder.encode(chunk));
            i++;
            setTimeout(send, 20);
          } else {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        };
        send();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }

  const response = await fetchWithTimeout(
    `${ARK_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        stream: true,
        temperature: 0.75,
        max_tokens: 2048,
      }),
    },
    30000
  );

  if (!response.ok) {
    const errText = await response.text();
    let friendlyMsg = `❌ 豆包 API 调用失败 (${response.status})\n`;
    try {
      const errJson = JSON.parse(errText);
      const code = errJson?.error?.code || '';
      if (code === 'InvalidEndpointOrModel.NotFound') {
        const currentModel = CHAT_MODEL;
        friendlyMsg += `\n模型 "${currentModel}" 不存在或无访问权限。\n\n请前往 https://console.volcengine.com/ark 模型广场查看可用 Model ID，然后更新 .env.local 中的 ARK_CHAT_MODEL。`;
      } else {
        friendlyMsg += errJson?.error?.message || errText;
      }
    } catch {
      friendlyMsg += errText;
    }
    // Return error as a stream so frontend can display it
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: friendlyMsg } }] })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' }, status: 200 });
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/** 图片分析 - 提取结构化关键词 */
export async function analyzeImageKeywords(
  imageBase64: string,
  type: 'character' | 'style'
): Promise<KeywordResult> {
  const defaultResult: KeywordResult = {
    hairstyle: [],
    clothing: [],
    colors: [],
    style: [],
    features: [],
    quality: ['masterpiece', 'best quality', 'ultra detailed', '8k'],
  };

  if (!ARK_API_KEY || !VISION_MODEL) throw new Error('请配置 ARK_API_KEY 和 ARK_VISION_MODEL');

  const systemPrompt =
    type === 'character'
      ? `你是一个专业的 AIGC 提示词专家，擅长从人物参考图中提取精准关键词。
请分析图片中的角色，提取用于 AI 绘图（即梦等）的中文关键词。
必须以纯 JSON 格式返回，格式如下（不要包含任何 markdown 代码块，直接返回JSON）：
{
  "hairstyle": ["长发", "白发", "高马尾", ...],
  "clothing": ["蓝色夹克", "白衬衫", "机能风服饰", ...],
  "colors": ["白色", "蓝色", "金色", ...],
  "style": ["日系动漫", "高细节", "赛博朋克", ...],
  "features": ["单个女孩", "蓝眼睛", "苗条身材", ...],
  "quality": ["杰作", "最高画质", "超高清", "8k分辨率"]
}
要求：
- 关键词必须是【中文】，且符合中文 AI 绘图模型（如即梦）的提示词规范
- 每个类别提取 3-8 个精准关键词
- 尽量精准描述图片中的核心视觉特征`
      : `你是一个专业的 AIGC 提示词专家，擅长从风格参考图中提取画风关键词。
请分析图片的整体视觉风格，提取用于 AI 绘图的中文关键词。
必须以纯 JSON 格式返回（不要 markdown 代码块，直接返回JSON）：
{
  "hairstyle": [],
  "clothing": [],
  "colors": ["暖色调", "柔和色彩", "低饱和度", ...],
  "style": ["日系动漫", "吉卜力画风", "水彩渲染", ...],
  "features": ["高细节背景", "电影级光影", "景深效果", ...],
  "quality": ["杰作", "最高画质", "超高清", "8k分辨率"]
}
要求：
- 重点提取画风、色调、笔触、光影等风格词
- 关键词必须是【中文】
- style 类别最重要，提取 3-6 个精准风格词`;

  const userPrompt =
    type === 'character'
      ? '请分析这张角色参考图，提取人物的发型、服装、配色、风格和特征关键词。'
      : '请分析这张风格参考图，提取画风、色调、光影和艺术风格关键词。';

  // Clean base64 (remove data URL prefix if present)
  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const dataUrl = `data:image/jpeg;base64,${cleanBase64}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: userPrompt },
      ],
    },
  ];

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${ARK_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ARK_API_KEY}`,
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          messages,
          stream: false,
          temperature: 0.3,
          max_tokens: 1024,
        }),
      },
      40000
    );
  } catch (err) {
    console.error('[Vision] Network error:', err);
    throw new Error(`视觉模型网络连接失败，请检查网络: ${String(err)}`);
  }

  if (!response.ok) {
    const err = await response.text();
    console.error('[Vision] API error:', response.status, err);
    throw new Error(`Vision API ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('AI 未返回有效文本');

  // Parse JSON from content (strip markdown if model wraps it)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 未返回有效的关键词 JSON');

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<KeywordResult>;
    return keywords({ ...defaultResult, ...parsed });
  } catch {
    throw new Error('AI 返回的关键词格式错误，请重试');
  }
}

/** 优化提示词 - 将口语中文转为高质量中文提示词由于即梦需要中文 */
export async function optimizePrompt(
  chinesePrompt: string,
  projectContext: { characterKeywords: string[]; styleKeywords: string[] }
): Promise<string> {
  if (!isConfigured()) throw new Error('请先配置对话模型');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是一名为即梦(Jimeng) AI 服务的专业绘图提示词优化专家。
请将用户的描述，结合项目上下文，转化为高质量的【中文】AI绘图提示词。
当前项目已有的画风特征和人物要求：
- 角色关键词: ${projectContext.characterKeywords.join(', ')}
- 画风关键词: ${projectContext.styleKeywords.join(', ')}
要求：
- 直接返回优化后的中文提示词序列，无需额外解释
- 用顿号或者逗号分隔各关键词，方便用户复制使用
- 必须保持全中文`,
    },
    { role: 'user', content: `优化这个场景描述：${chinesePrompt}` },
  ];

  const resp = await fetchWithTimeout(`${ARK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ARK_API_KEY}` },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: false, temperature: 0.5, max_tokens: 256 }),
  });

  if (!resp.ok) throw new Error(`AI 请求失败 (${resp.status})`);
  const data = await resp.json();
  const optimized = data.choices?.[0]?.message?.content;
  if (typeof optimized !== 'string' || !optimized.trim()) throw new Error('AI 未返回优化结果');
  return optimized.trim();
}

/** 从文本描述中提取关键词 (调用大语言模型) */
export async function extractKeywordsFromTextLLM(description: string, type: 'character' | 'style'): Promise<KeywordResult> {
  const defaultResult: KeywordResult = {
    hairstyle: [], clothing: [], colors: [], style: [], features: [], quality: ['杰作', '最高画质', '超高清', '8k分辨率'],
  };

  if (!isConfigured()) throw new Error('请配置 ARK_API_KEY 和 ARK_CHAT_MODEL');

  const systemPrompt = type === 'character' ?
    `你是一个专业的 AIGC 提示词专家。请根据用户的文本描述，提取 AI 绘图所需的【中文】关键词组合。
必须以纯 JSON 格式返回，格式要求如下：
{
  "hairstyle": ["关键词1", ...],
  "clothing": ["关键词1", ...],
  "colors": ["关键词1", ...],
  "style": ["关键词1", ...],
  "features": ["关键词1", ...],
  "quality": ["杰作", "最高画质", "超高清", "8k分辨率"]
}
只输出 JSON，不要任何其他文本。` :
    `你是一个专业的 AIGC 提示词专家。请根据用户的文本描述，提取画风相关的【中文】修饰词。
必须以纯 JSON 格式返回，包含：colors, style, features, quality 类别。
只输出 JSON，不要任何其他文本。`;

  try {
    const response = await fetchWithTimeout(`${ARK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ARK_API_KEY}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `用户描述：\n${description}` }
        ],
        stream: false,
        temperature: 0.1,
      }),
    }, 20000);

    if (!response.ok) throw new Error(`AI 请求失败 (${response.status})`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('AI 未返回有效文本');
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 未返回有效的关键词 JSON');

    const parsed = JSON.parse(jsonMatch[0]) as Partial<KeywordResult>;
    return keywords({ ...defaultResult, ...parsed });
  } catch (e) {
    console.error('Extract keywords error:', e);
    throw new Error('关键词提取失败，请检查模型配置和服务端日志');
  }
}



/** 根据项目设定和历史记录推演下一步剧情提示词 */
export async function brainstormStoryboard(
  projectContext: { characterKeywords: string[]; styleKeywords: string[] },
  historyPrompts: string[]
): Promise<string[]> {
  if (!isConfigured()) throw new Error('请先配置对话模型');

  const systemPrompt = `你是一个专业的影视级 AI 提示词导演。
用户正在进行连续的 AIGC 图像/视频生成。请根据当前的项目设定（角色特征、画风）以及他们最近生成的画面历史，
推演接下来可能发生的故事分镜，并给出 3-5 个连贯的中文场景提示词。

要求：
1. 提示词必须直接可用于输入框（例如："正在街角买咖啡，特写镜头，电影打光"）
2. 保持动作和分镜的电影感，不要带有解释性废话
3. 纯 JSON 数组格式返回，例如：["提示词1", "提示词2", "提示词3"]`;

  const userPrompt = `
项目设定：
- 角色：${projectContext.characterKeywords.join(', ')}
- 画风：${projectContext.styleKeywords.join(', ')}

最近生成的分镜历史：
${historyPrompts.length > 0 ? historyPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n') : '暂无历史'}

请推演接下来的 3 个连贯分镜提示词：`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: [{ type: 'text', text: userPrompt }] },
  ];

  try {
    const response = await fetchWithTimeout(
      `${ARK_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ARK_API_KEY}`,
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages,
          stream: false,
          temperature: 0.8, // 稍微高一点的温度增加想象力
          max_tokens: 1024,
        }),
      },
      30000
    );

    if (!response.ok) throw new Error(`AI 请求失败 (${response.status})`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('AI 未返回有效文本');
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('AI 未返回场景列表');
    const ideas = stringList(JSON.parse(jsonMatch[0]));
    if (!ideas.length) throw new Error('AI 返回场景列表为空');
    return ideas;
  } catch (err) {
    console.error('[Brainstorm] Error:', err);
    throw new Error('场景推演失败，请检查模型配置和服务端日志');
  }
}
