# AIGC Studio

面向个人创作者的 AIGC 工作台：在项目中管理角色与画风参考、编辑关键词、组合提示词，生成图片并复用历史参数。

> 当前版本是适合本地单人使用的 MVP。项目管理与手动编辑无需 API 密钥；AI 分析、对话和生成需要自行配置有权限的服务账户。视频与角色保持为默认关闭的实验功能。

## 快速开始

需要 Node.js **22.18+**（推荐 24 LTS）和 npm。

```bash
npm ci --ignore-scripts
```

复制 `.env.example` 为 `.env.local`，按需填写环境变量。没有密钥也可以先体验项目管理、参考图上传和手动关键词编辑。

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。服务默认绑定 `127.0.0.1`。

生产模式：

```bash
npm run build
npm start
```

Windows 用户若希望安装缓存和临时文件也留在 D 盘，可在 PowerShell 中先设置：

```powershell
$env:npm_config_cache = 'D:/.npm-cache'
$env:TEMP = 'D:/AIGC-Studio/.tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force
```

## 使用流程

1. **创建项目**：填写作品名称和描述。
2. **建立参考**：上传角色或画风参考图，或手动添加各类关键词。
3. **提取与确认**：配置视觉模型后可以自动分析图片，提取结果仍可编辑。
4. **描述场景**：组合角色词、画风词、场景和质量词；也可用 AI 辅助润色。
5. **生成图片**：选择比例、尺寸和随机种子，提交后查看状态和结果。
6. **继续迭代**：从历史记录选取任务，下载结果或复用参数。

参考图支持 PNG、JPEG、WebP、GIF，原始文件最多 5 MB。浏览器会将图片压缩为 JPEG；透明区域会变为白色，GIF 会作为静态参考图处理。

## 配置

| 环境变量 | 用途 |
| --- | --- |
| `ARK_API_KEY` | 火山方舟 API Key，供对话、文本提取和视觉分析使用 |
| `ARK_CHAT_MODEL` | 你的账户可用的对话模型 ID 或推理接入点 ID |
| `ARK_VISION_MODEL` | 你的账户可用的视觉模型 ID 或推理接入点 ID |
| `ARK_BASE_URL` | 兼容 Chat Completions 的服务地址，默认火山方舟 `/api/v3` |
| `VOLCENGINE_AK` / `VOLCENGINE_SK` | 即梦文生图的火山引擎访问密钥，需要开通相应服务权限 |
| `VOLCENGINE_REGION` | 默认 `cn-north-1` |
| `VOLCENGINE_HOST` | 默认 `visual.volcengineapi.com` |
| `AIGC_DATA_DIR` | 可选的绝对路径，默认项目内 `data` 目录 |
| `AIGC_ENABLE_EXPERIMENTAL` | 默认 `false`，设为 `true` 才显示实验生成模式 |
| `ARK_VIDEO_MODEL` | 实验视频功能使用的模型 ID，默认留空 |

修改配置后重启服务。页面的“已配置”表示已填写必要字段，并不代表已验证服务连接或账户权限。真实调用可能产生服务商费用。

密钥仅供服务端读取，不要添加 `NEXT_PUBLIC_` 前缀，不要提交 `.env.local`。

文生图采用即梦 3.0 的异步任务协议；已修正原版签名服务标识、密钥派生方式、提交与查询 Action 以及字符串任务状态。参考 [官方接口文档](https://docs.volcengine.com/docs/jimeng-ai/dream-text-to-image30-interface-documentation?lang=zh) 和 [签名文档](https://docs.volcengine.com/docs/api-signature-call-guide/signature-method?lang=zh)。模型是否可用仍以账户当前权限为准。

## 当前功能与边界

| 功能 | 状态 |
| --- | --- |
| 创建、读取、编辑、删除项目 | 已实现 |
| 参考图上传、读取与关键词手动编辑 | 已实现 |
| 视觉关键词提取、文本关键词提取、AI 助手 | 已接入，需要配置模型 |
| 文生图、任务轮询、历史参数复用 | 已实现，需配置即梦权限 |
| 生成图片的本地保存 | Base64 结果保存到数据目录；URL 结果保留原地址 |
| 角色保持图生图、视频生成 | 实验代码保留，默认关闭，尚未完成真实账户验证 |
| 视频合成与配音 | 尚未实现，接口返回 501 |
| 登录、多用户隔离、多人协作 | 尚未实现 |
| 数据库、分布式队列与多实例部署 | 后续计划 |

当前每个项目只有一个主要角色参考图和一个画风参考图。普通文生图通过文字关键词引用角色与风格，不直接把参考图传入模型，也不保证角色一致性。

## 数据与部署

- 项目及任务写入 `data/projects.json`，通过临时文件加重命名的方式更新，避免写到一半破坏原文件。
- 上传图和本地生成图保存在 `data/uploads/`，通过 `/uploads/:filename` 读取。
- `.gitignore` 排除了密钥、数据、上传素材、构建产物和缓存。
- 这是**单机单进程**存储方案；不支持多实例共同写入同一个 JSON 文件。不同浏览器同时编辑同一字段仍可能覆盖彼此修改。
- 部署需要持久化可写磁盘；不适合直接作为无持久化磁盘的 Serverless 应用运行。
- 删除项目会移除记录，图片文件暂时保留。清理或迁移前请备份整个数据目录。
- 项目没有身份认证，默认仅本机访问。若要提供公网服务，需要先实现登录、权限、配额和请求限流。
- 等待生成结果超过 15 分钟会标为超时。提交网络超时时不会自动重试，避免重复创建可能计费的任务；请先核对服务商任务记录。

## 检查与测试

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:smoke
```

核心测试覆盖上传校验、关键词与参数验证、签名协议、任务状态、重复提交保护以及项目持久化。冒烟测试会启动隔离数据目录中的生产服务，检查页面、项目 CRUD、上传读取和配置缺失提示，不调用付费 AI 服务。测试数据保存在被忽略的 `.tmp/` 目录。

GitHub Actions 自动执行以上检查。真实模型的图片质量、账户权限、网络连接和实验功能需要另行验证。

## 项目结构

```text
app/
  page.tsx                   项目首页
  components/ServiceStatus   配置状态提示
  project/[id]/              创作工作区
  api/                       项目、分析、上传和生成接口
  uploads/[filename]/        本地图片读取
lib/
  projects.ts                数据存储与项目逻辑
  validation.ts              输入与图片校验
  generation.ts              生成参数与状态转换
  jimeng.ts                  即梦文生图适配
  llm.ts                     对话与视觉模型适配
scripts/smoke.mjs            生产 HTTP 冒烟测试
tests/                       核心回归测试
```

## 后续方向

优先完善多角色参考、项目导入导出和生成结果管理，再推进数据库存储、账号权限及视频工作流。当前未指定开源许可证；公开仓库不代表已授予额外的使用许可。
