'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import NextImage from 'next/image';
import { apiRequest } from '@/lib/client';
import { composePrompt, promptLayers } from '@/lib/prompts';
import ServiceStatus from '@/app/components/ServiceStatus';
import type { Project, Task, KeywordSet } from '@/lib/projects';

// ── Utilities ───────────────────────────────────────────────────
function formatTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function readAndCompressImage(file: File, maxSize = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width *= ratio;
          height *= ratio;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(e.target?.result as string); // fallback
        ctx.fillStyle = '#FFF'; // Default bg
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85); // Compress drastically
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Toast ────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; type: ToastType; msg: string; }

function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}</span>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── AI Chat Panel ────────────────────────────────────────────────
interface ChatMsg { role: 'user' | 'assistant'; content: string; }

const QUICK_ACTIONS = [
  '帮我优化当前提示词',
  '推荐三个创意场景',
  '如何提升画面质量？',
  '分析当前角色的画风特点',
  '给我一些赛博朋克场景灵感',
];

function ChatPanel({ projectId, project, onClose }: {
  projectId: string;
  project: Project;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([{
    role: 'assistant',
    content: `你好！我是你的 AIGC 创作助手 ✦\n\n我已了解你的项目「${project.name}」的角色和画风设定。你可以问我：\n• 场景创意和构图建议\n• 提示词优化\n• AI 绘图技巧\n• 画风特征分析`,
  }]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: ChatMsg = { role: 'user', content: text.trim() };
    setMessages((p) => [...p, userMsg]);
    setInput('');
    setStreaming(true);

    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Add placeholder
    setMessages((p) => [...p, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, projectId }),
      });

      if (!res.body) throw new Error('No stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const json = JSON.parse(raw);
            // doubao-seed-1.8 returns reasoning_content (chain-of-thought) separately from content
            // Only display the final content, skip reasoning_content
            const chunk = json.choices?.[0]?.delta?.content || '';
            if (chunk) {
              setMessages((p) => {
                const last = p[p.length - 1];
                return [...p.slice(0, -1), { ...last, content: last.content + chunk }];
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      setMessages((p) => [...p.slice(0, -1), { role: 'assistant', content: `请求失败: ${String(err)}` }]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', right: 0, top: 60, bottom: 0, width: 380,
      background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', zIndex: 200,
      boxShadow: '-20px 0 60px rgba(0,0,0,0.4)',
      animation: 'slideInRight 0.25s cubic-bezier(0.34,1.56,0.64,1)'
    }}>
      <style>{`@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>

      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'linear-gradient(135deg,var(--primary),var(--secondary))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.85rem', boxShadow: '0 0 15px rgba(124,58,237,0.4)'
        }}>✦</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>AI 创作助手</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            豆包大模型 · 已了解项目上下文
          </div>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
            {msg.role === 'assistant' && (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg,var(--primary),var(--secondary))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', marginTop: 2
              }}>✦</div>
            )}
            <div style={{
              maxWidth: '82%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user'
                ? '14px 14px 4px 14px'
                : '14px 14px 14px 4px',
              background: msg.role === 'user'
                ? 'linear-gradient(135deg,var(--primary),#9333ea)'
                : 'var(--bg-hover)',
              border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
              fontSize: '0.83rem',
              lineHeight: 1.65,
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content}
              {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                <span style={{ display: 'inline-block', width: 6, height: 14, background: 'var(--primary)', marginLeft: 3, borderRadius: 2, animation: 'pulse 0.8s infinite' }} />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      {messages.length <= 1 && (
        <div style={{ padding: '0 20px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.72rem', padding: '4px 10px', borderColor: 'var(--border-glow)', color: '#c4b5fd' }}
              onClick={() => sendMessage(a)}
            >
              {a}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          className="textarea"
          placeholder="问我任何创作问题... (Enter发送, Shift+Enter换行)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
          }}
          style={{ minHeight: 42, maxHeight: 120, resize: 'none', flex: 1, fontSize: '0.83rem' }}
          disabled={streaming}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || streaming}
          style={{ padding: '10px 14px', flexShrink: 0, alignSelf: 'flex-end' }}
        >
          {streaming ? '⋯' : '⬆'}
        </button>
      </div>
    </div>
  );
}

// ── Keyword Tags Editor ──────────────────────────────────────────
const KW_CATEGORY_LABELS: Record<keyof KeywordSet, string> = {
  hairstyle: '发型', clothing: '服装', colors: '配色',
  style: '风格', features: '特征', quality: '质量词',
};

function KeywordCategory({ label, keywords, onAdd, onRemove, tagClass }: {
  label: string; keywords: string[];
  onAdd: (kw: string) => void; onRemove: (kw: string) => void; tagClass?: string;
}) {
  const [input, setInput] = useState('');
  function add() {
    const v = input.trim();
    if (v && !keywords.includes(v)) { onAdd(v); setInput(''); }
  }
  return (
    <div className="kw-category">
      <div className="kw-category-label">{label}</div>
      <div className="tags-wrap">
        {keywords.map((kw) => (
          <span key={kw} className={`tag removable ${tagClass || ''}`} onClick={() => onRemove(kw)} title="点击删除">
            {kw} ✕
          </span>
        ))}
      </div>
      <div className="kw-add-row">
        <input className="input" placeholder="添加关键词..."
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn-ghost btn-sm" onClick={add}>+</button>
      </div>
    </div>
  );
}

// ── Image Upload + AI Analysis ───────────────────────────────────
function ImageUploadZone({ label, imageUrl, onUpload, analyzing }: {
  label: string; imageUrl?: string;
  onUpload: (base64: string, file: File) => Promise<void>;
  analyzing?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (uploading) return;
    setUploadError(''); setUploading(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片');
      if (file.size > 5 * 1024 * 1024) throw new Error('参考图片不能超过 5 MB');
      const b64 = await readAndCompressImage(file);
      await onUpload(b64, file);
    } catch (e) { setUploadError(e instanceof Error ? e.message : '图片读取失败'); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  return (
    <div>
      <div className="kw-category-label" style={{ marginBottom: 8 }}>{label}</div>
      {imageUrl ? (
        <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
          <NextImage unoptimized width={1024} height={1024} src={imageUrl} alt={label} style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
          {analyzing && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(7,7,15,0.82)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10
            }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--secondary)' }}>AI 分析图片中…</span>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>豆包视觉模型提取关键词</div>
            </div>
          )}
          {!analyzing && (
            <button className="btn btn-ghost btn-sm"
              style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', padding: '3px 8px' }}
              onClick={() => inputRef.current?.click()}>替换</button>
          )}
        </div>
      ) : (
        <div
          className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => inputRef.current?.click()}
          style={{ minHeight: 120 }}
        >
          <span className="upload-icon">📁</span>
          <span className="upload-text">拖拽或点击上传</span>
          <span className="upload-hint">上传后 AI 自动分析提取关键词</span>
        </div>
      )}
      {uploadError && <p role="alert" className="error-message">{uploadError}</p>}
      {uploading && <p role="status">上传中…</p>}
      <input disabled={uploading} ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}

// ── Left Panel ───────────────────────────────────────────────────
function LeftPanel({ project, onUpdate, addToast }: {
  project: Project;
  onUpdate: (updates: Partial<Project>) => Promise<boolean>;
  addToast: (type: ToastType, msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'character' | 'style'>('character');
  const [manualDesc, setManualDesc] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const keywords = activeTab === 'character' ? project.characterKeywords : project.styleKeywords;

  function setKeywords(kw: KeywordSet) {
    onUpdate(activeTab === 'character' ? { characterKeywords: kw } : { styleKeywords: kw });
  }
  function updateCategory(cat: keyof KeywordSet, newList: string[]) {
    setKeywords({ ...keywords, [cat]: newList });
  }

  // Auto-analyze image with vision model
  async function analyzeImage(base64: string) {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, type: activeTab }),
      });
      const data = await res.json();
      if (data.success) {
        const total = Object.values(data.data as Record<string, string[]>).flat().length;
        if (data.warning) {
          addToast('error', `⚠️ ${data.warning}`);
        } else if (!data.configured) {
          addToast('info', '图片已上传，请配置 ARK_API_KEY 以启用 AI 自动分析');
        } else if (total > 0) {
          setKeywords({ ...keywords, ...data.data });
          addToast('success', `✦ AI 分析完成！提取了 ${total} 个关键词`);
        } else {
          addToast('info', 'AI 返回内容为空，请稍后手动添加关键词');
        }
      } else { addToast('error', data.error || '分析失败，请重试'); }
    } catch (e) {
      addToast('error', '图片分析请求失败: ' + String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  // Manual text-based extraction
  async function handleManualExtract() {
    if (!manualDesc.trim()) return;
    setExtracting(true);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: manualDesc, type: activeTab }),
      });
      const data = await res.json();
      if (data.success) {
        setKeywords({ ...keywords, ...data.data });
        addToast('success', '关键词提取成功！');
      } else { addToast('error', data.error || '关键词提取失败'); }
    } catch (e) { addToast('error', e instanceof Error ? e.message : '关键词提取请求失败'); } finally {
      setExtracting(false);
    }
  }

  async function handleImageUpload(base64: string, file: File) {
    const result = await apiRequest<{ url: string }>('/api/upload', { method: 'POST', body: JSON.stringify({ base64, filename: file.name }) });
    const saved = await onUpdate(activeTab === 'character' ? { characterImage: result.url } : { styleImage: result.url });
    if (!saved) throw new Error('参考图未关联到项目，请重试');
    addToast('success', '参考图已保存');
    await analyzeImage(base64);
  }

  return (
    <div className="workspace-panel" style={{ width: 300, minWidth: 300 }}>
      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'character' ? 'active' : ''}`} onClick={() => setActiveTab('character')}>🎭 角色</button>
        <button className={`tab ${activeTab === 'style' ? 'active' : ''}`} onClick={() => setActiveTab('style')}>🎨 画风</button>
      </div>

      {/* Image upload with auto-analysis */}
      <ImageUploadZone
        label={activeTab === 'character' ? '角色参考图（三视图） — 上传后 AI 自动提取' : '画风参考图 — AI 自动分析风格'}
        imageUrl={activeTab === 'character' ? project.characterImage : project.styleImage}
        onUpload={handleImageUpload}
        analyzing={analyzing}
      />

      {/* AI Analysis status indicator + retry button */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: 'var(--bg-input)', borderRadius: 8, border: '1px solid var(--border)',
        fontSize: '0.73rem'
      }}>
        {analyzing ? (
          <>
            <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, flexShrink: 0 }} />
            <span style={{ color: 'var(--secondary)' }}>AI 正在分析图片...</span>
          </>
        ) : (activeTab === 'character' ? project.characterImage : project.styleImage) ? (
          <>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)', flex: 1 }}>图片已上传</span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.68rem', padding: '2px 8px', color: '#c4b5fd' }}
              onClick={async () => {
                const imgUrl = activeTab === 'character' ? project.characterImage : project.styleImage;
                if (!imgUrl) return;
                try {
                  const res = await fetch(imgUrl);
                  if (!res.ok) throw new Error('无法读取参考图，请重新上传');
      const blob = await res.blob();
                  const b64 = await new Promise<string>(resolve => {
                    const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(blob);
                  });
                  await analyzeImage(b64);
                } catch { addToast('error', '重新分析失败'); }
              }}
            >
              ✦ 重新分析
            </button>
          </>
        ) : (
          <>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)' }}>上传图片后 AI 自动分析</span>
          </>
        )}
      </div>

      {/* Manual extract from description */}
      <div>
        <div className="kw-category-label" style={{ marginBottom: 6 }}>
          补充描述 → 提取关键词
        </div>
        <textarea
          className="textarea"
          placeholder={activeTab === 'character'
            ? '描述角色特征，例：白色长发，蓝眼睛，赛博朋克皮夹克...'
            : '描述画风，例：日系动漫风，柔和粉色调，精美线条...'}
          value={manualDesc}
          onChange={(e) => setManualDesc(e.target.value)}
          style={{ minHeight: 68, marginBottom: 8 }}
        />
        <button
          className="btn btn-secondary w-full"
          onClick={handleManualExtract}
          disabled={!manualDesc.trim() || extracting}
          style={{ fontSize: '0.82rem' }}
        >
          {extracting ? '✦ 提取中...' : '✦ 从描述提取关键词'}
        </button>
      </div>

      <div className="divider" />

      {/* Keyword editor */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div className="section-header">
          <span className="section-title">{activeTab === 'character' ? '角色关键词' : '画风关键词'}</span>
          <span className="section-badge">
            {Object.values(keywords).flat().length} 个
          </span>
        </div>
        {(Object.keys(KW_CATEGORY_LABELS) as (keyof KeywordSet)[]).map((cat) => (
          <KeywordCategory
            key={cat}
            label={KW_CATEGORY_LABELS[cat]}
            keywords={keywords[cat]}
            onAdd={(kw) => updateCategory(cat, [...keywords[cat], kw])}
            onRemove={(kw) => updateCategory(cat, keywords[cat].filter((k) => k !== kw))}
            tagClass={cat === 'style' ? 'tag-cyan' : cat === 'colors' ? 'tag-amber' : ''}
          />
        ))}
      </div>
    </div>
  );
}

// ── Middle Panel: Prompt Builder ─────────────────────────────────
function MiddlePanel({ project, onGenerate, addToast, replicaTask }: {
  project: Project;
  onGenerate: (p: { scene: string; type: 'text2img' | 'dreamo' | 'doubao-seedance'; width: number; height: number; seed: number; promptImagesBase64?: string[] }) => Promise<void>;
  addToast: (type: ToastType, msg: string) => void;
  replicaTask: Task | null;
}) {
  const [scene, setScene] = useState(replicaTask?.prompt || '');
  const [promptImages, setPromptImages] = useState<string[]>(replicaTask?.promptImagesBase64 || []);
  const [experimental, setExperimental] = useState(false);
  useEffect(() => { apiRequest<{ experimental: boolean }>('/api/config').then(c => setExperimental(c.experimental)).catch(() => {}); }, []);
  const [genType, setGenType] = useState<Task['type']>(replicaTask?.type || 'text2img');
  const [width, setWidth] = useState(replicaTask?.width ?? 1024);
  const [height, setHeight] = useState(replicaTask?.height ?? 1024);
  const [seed, setSeed] = useState(replicaTask?.seed ?? -1);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [brainstorming, setBrainstorming] = useState(false);

  const layers = promptLayers(project);
  const charWords = layers.character;
  const styleWords = layers.style;
  const fullPrompt = composePrompt(project, scene);

  async function handleOptimize() {
    if (!scene.trim()) return;
    setOptimizing(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'optimize',
          prompt: scene,
          projectContext: { characterKeywords: charWords, styleKeywords: styleWords },
        }),
      });
      const data = await res.json();
      if (data.success && data.data.optimized) {
        setScene(data.data.optimized);
        addToast('success', 'AI 场景词已优化！');
      } else { addToast('error', data.error || 'AI 未返回优化结果'); }
    } catch (e) {
      addToast('error', 'AI 优化失败: ' + String(e));
    } finally {
      setOptimizing(false);
    }
  }

  async function handleBrainstorm() {
    setBrainstorming(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'brainstorm_next',
          projectContext: { characterKeywords: charWords, styleKeywords: styleWords },
          historyPrompts: project.tasks.map(t => t.prompt).filter(Boolean).slice(0, 5)
        }),
      });
      const data = await res.json();
      if (data.success && data.data.ideas?.length) {
        setScene(data.data.ideas[0]);
        addToast('success', 'AI 导演已推演新分镜！');
      } else { addToast('error', data.error || 'AI 未返回场景建议'); }
    } catch (e) {
      addToast('error', '推演失败: ' + String(e));
    } finally {
      setBrainstorming(false);
    }
  }

  async function handleGenerate() {
    if (!scene.trim() && charWords.length === 0) return;
    setGenerating(true);
    try {
      await onGenerate({ scene, type: genType, width, height, seed, promptImagesBase64: promptImages.length > 0 ? promptImages : undefined });
    } catch (e) { addToast('error', e instanceof Error ? e.message : '生成请求失败'); }
    finally { setGenerating(false); }
  }

  const ratioPresets = [
    { label: '1:1', w: 1024, h: 1024 },
    { label: '4:3', w: 1024, h: 768 },
    { label: '16:9', w: 1280, h: 720 },
    { label: '9:16', w: 720, h: 1280 },
    { label: '3:2', w: 1024, h: 682 },
  ];

  return (
    <div className="workspace-main">
      <div className="section-header">
        <span className="section-title">✍️ 提示词构建器</span>
        <span className="section-badge">{fullPrompt.split(',').filter(Boolean).length} 个词</span>
      </div>

      {/* Layer cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Character layer */}
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: '#c4b5fd', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            🎭 角色层
          </div>
          {charWords.length > 0 ? (
            <div className="tags-wrap">
              {charWords.map((kw) => <span key={kw} className="tag">{kw}</span>)}
            </div>
          ) : (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              ← 上传角色图后 AI 自动填充，或在左栏手动添加
            </span>
          )}
        </div>

        {/* Style layer */}
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: '#67e8f9', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            🎨 画风层
          </div>
          {styleWords.length > 0 ? (
            <div className="tags-wrap">
              {styleWords.map((kw) => <span key={kw} className="tag tag-cyan">{kw}</span>)}
            </div>
          ) : (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              ← 上传画风参考图后 AI 自动填充
            </span>
          )}
        </div>

        {/* Scene layer - user input */}
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--primary)', boxShadow: '0 0 0 1px rgba(124,58,237,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: '0.72rem', color: '#fcd34d', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              🌄 场景层（你来写）
            </span>
          </div>
          <textarea
            id="scene-input"
            className="textarea"
            placeholder="描述场景，可用中文，例：在霓虹灯咖啡厅，雨夜，坐在窗边..."
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            style={{ background: 'transparent', border: 'none', padding: 0, minHeight: 64, boxShadow: 'none', resize: 'none' }}
          />

          {/* Add Prompt Images Layer */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {/* Display Images */}
            {experimental && genType === 'doubao-seedance' && promptImages.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {promptImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative', width: 44, height: 44, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <NextImage unoptimized width={1024} height={1024} src={img} alt="提示词参考图" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', padding: 2, lineHeight: 1 }}
                      onClick={() => setPromptImages(promptImages.filter((_, i) => i !== idx))}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {experimental && genType === 'doubao-seedance' && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => promptInputRef.current?.click()} style={{ fontSize: '0.75rem', padding: '4px 10px', borderColor: 'rgba(124,58,237,0.3)', borderStyle: 'dashed' }}>
                  🖼️ {promptImages.length > 0 ? `继续添加 (${promptImages.length}/4)` : '添加垫图 (可多张)'}
                </button>
                <input type="file" ref={promptInputRef} style={{ display: 'none' }} accept="image/*" multiple onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length) {
                    for (const f of files) {
                      if (promptImages.length >= 4) break; // Limit to 4 images
                      try {
                        const reader = new FileReader();
                        reader.onload = () => setPromptImages(prev => [...prev, reader.result as string].slice(0,4));
                        reader.readAsDataURL(f);
                      } catch (e) {
                        console.error('Image upload failed', e)
                      }
                    }
                  }
                }} />
              </div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.7rem', padding: '2px 8px', color: '#c4b5fd', borderColor: 'rgba(124,58,237,0.3)' }}
                  onClick={handleOptimize}
                  disabled={!scene.trim() || optimizing}
                  title="优化当前词"
                >
                  {optimizing ? '⋯' : '✦ AI润色'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.7rem', padding: '2px 8px', color: '#6ee7b7', borderColor: 'rgba(110,231,183,0.3)' }}
                  onClick={handleBrainstorm}
                  disabled={brainstorming}
                  title="根据上文自动写新镜头"
                >
                  {brainstorming ? '推演中...' : '🎬 AI导戏'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Quality layer */}
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: '#6ee7b7', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            ✨ 质量层
          </div>
          <div className="tags-wrap">
            {layers.quality.map((kw) => <span key={kw} className="tag tag-green">{kw}</span>)}
          </div>
        </div>
      </div>

      {/* Full prompt preview */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>完整提示词预览</span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(fullPrompt)} style={{ fontSize: '0.72rem' }}>
            复制
          </button>
        </div>
        <div className="prompt-preview font-mono">
          {fullPrompt || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>拼装后的提示词将在此显示...</span>}
        </div>
      </div>

      <div className="divider" />

      {/* Generation settings */}
      <div className="section-header">
        <span className="section-title">⚙️ 生成参数</span>
      </div>

      <div className="form-group">
        <label className="form-label">生成模式</label>
        <div className="tabs">
          <button id="mode-text2img" className={`tab ${genType === 'text2img' ? 'active' : ''}`} onClick={() => setGenType('text2img')}>普通文生图</button>
          {experimental && <button id="mode-dreamo" className={`tab ${genType === 'dreamo' ? 'active' : ''}`} onClick={() => setGenType('dreamo')}>角色保持（实验）</button>}
          {experimental && <button id="mode-video" className={`tab ${genType === 'doubao-seedance' ? 'active' : ''}`} onClick={() => { setGenType('doubao-seedance'); setWidth(1280); setHeight(720); }}>视频生成（实验）</button>}
        </div>
        {genType === 'dreamo' && !project.characterImage && (
          <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: 6 }}>⚠️ DreamO 需先上传角色参考图</div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">画面比例</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ratioPresets.map((r) => (
            <button
              key={r.label}
              className={`btn btn-sm ${width === r.w && height === r.h ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => { setWidth(r.w); setHeight(r.h); }}
            >{r.label}</button>
          ))}
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{width} × {height}</span>
      </div>

      <div className="form-group">
        <label className="form-label">随机种子（-1 随机）</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="number" value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value) || -1)} style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => setSeed(-1)}>随机</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSeed(Math.floor(Math.random() * 999999))}>🎲</button>
        </div>
      </div>

      <button
        id="generate-btn"
        className="btn btn-generate"
        onClick={handleGenerate}
        disabled={generating || (charWords.length === 0 && !scene.trim())}
        style={{ marginTop: 8 }}
      >
        {generating ? (
          <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> 生成中...</>
        ) : '⚡ 立即生成'}
      </button>
    </div>
  );
}

// ── Right Panel: Result & History ────────────────────────────────
function RightPanel({ project, activeTask, onTaskClick, onReplicate }: {
  project: Project; activeTask: Task | null; onTaskClick: (t: Task) => void;
  onReplicate: (t: Task) => void;
}) {
  const [tab, setTab] = useState<'result' | 'history'>('result');

  return (
    <div className="workspace-panel" style={{ borderRight: 'none', borderLeft: '1px solid var(--border)', width: 340, minWidth: 340, display: 'flex', flexDirection: 'column' }}>
      <div className="tabs">
        <button className={`tab ${tab === 'result' ? 'active' : ''}`} onClick={() => setTab('result')}>🖼️ 选区</button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>📋 历史序列 ({project.tasks.length})</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 20 }}>
        {tab === 'result' ? (
        <div>
          {activeTask ? (
            <>
              {activeTask.status === 'processing' && (
                <div style={{
                  border: '1px solid var(--border)', borderRadius: 12,
                  aspectRatio: '1', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 14,
                  background: 'var(--bg-input)'
                }}>
                  <div className="spinner" style={{ width: 48, height: 48 }} />
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>即梦 AI 生成中...</span>
                  <div className="progress-bar w-full" style={{ margin: '0 24px' }}>
                    <div className="progress-fill indeterminate" />
                  </div>
                </div>
              )}
              {activeTask.status === 'done' && (activeTask.imageUrl || activeTask.imageBase64) && (
                <div className="result-image-wrap" style={{ marginBottom: 14 }}>
                  {activeTask.type === 'doubao-seedance' ? (
                    <video
                      src={activeTask.imageUrl}
                      autoPlay loop controls
                      style={{ width: '100%', height: 'auto', borderRadius: 12 }}
                    />
                  ) : (
                    <NextImage unoptimized width={1024} height={1024}
                      src={activeTask.imageUrl || `data:image/png;base64,${activeTask.imageBase64}`}
                      alt="生成结果"
                      style={{ width: '100%', height: 'auto', borderRadius: 12 }}
                    />
                  )}
                  <div className="result-image-overlay">
                    <a
                      href={activeTask.imageUrl || `data:image/png;base64,${activeTask.imageBase64}`}
                      download={activeTask.type === 'doubao-seedance' ? `aigc-${activeTask.id}.mp4` : `aigc-${activeTask.id}.png`}
                      className="btn btn-ghost btn-sm"
                      style={{ background: 'rgba(0,0,0,0.6)' }}
                    >⬇ 下载</a>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ background: 'rgba(0,0,0,0.6)' }}
                      onClick={() => activeTask.imageUrl && navigator.clipboard.writeText(new URL(activeTask.imageUrl, window.location.origin).href)}
                    >🔗 复制链接</button>
                  </div>
                </div>
              )}
              {activeTask.status === 'failed' && (
                <div style={{ padding: 16, background: 'rgba(239,68,68,0.1)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.2)', marginBottom: 14 }}>
                  <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 6 }}>⚠ 生成失败</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{activeTask.error}</div>
                </div>
              )}
              {/* Task meta */}
              <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span className={`status-dot ${activeTask.status}`} />
                  <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                    {activeTask.status === 'processing' ? '生成中' : activeTask.status === 'done' ? '已完成' : '失败'}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{formatTime(activeTask.createdAt)}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6, fontFamily: 'JetBrains Mono,monospace', wordBreak: 'break-word' }}>
                  {activeTask.fullPrompt}
                </div>
                <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {activeTask.width}×{activeTask.height} · seed:{activeTask.seed} · {activeTask.type}
                </div>
                <button className="btn btn-secondary w-full" style={{ marginTop: 10, padding: 6, fontSize: '0.75rem' }} onClick={() => onReplicate(activeTask)}>
                  ♻️ 提取参数并继续创作
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <span className="empty-state-icon">⚡</span>
              <span className="empty-state-text">点击“立即生成”开始创作</span>
              <span className="empty-state-text" style={{ fontSize: '0.72rem', opacity: 0.6 }}>或点击右上角“AI 助手”获取灵感</span>
            </div>
          )}
        </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {project.tasks.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">📋</span>
              <span className="empty-state-text">暂无历史任务</span>
            </div>
          ) : (
            project.tasks.map((task) => (
              <div
                key={task.id}
                className="history-item"
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') { onTaskClick(task); setTab('result'); } }}
                onClick={() => { onTaskClick(task); setTab('result'); }}
                style={{ cursor: 'pointer', borderColor: activeTask?.id === task.id ? 'var(--border-glow)' : undefined }}
              >
                {(task.imageUrl || task.imageBase64) && task.type !== 'doubao-seedance' ? (
                  <NextImage unoptimized width={1024} height={1024}
                    src={task.imageUrl || `data:image/png;base64,${task.imageBase64}`}
                    alt="thumb" className="history-thumb"
                  />
                ) : (
                  <div className="history-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className={`status-dot ${task.status}`} style={{ width: 12, height: 12 }} />
                  </div>
                )}
                <div className="history-info">
                  <div className="history-prompt">{task.fullPrompt || task.prompt}</div>
                  <div className="history-meta">
                    <span className={`status-dot ${task.status}`} />
                    <span className="history-time">{formatTime(task.createdAt)}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{task.width}×{task.height}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      </div>
    </div>
  );
}

// ── Main Page Container ──────────────────────────────────────────
export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [replicaTask, setReplicaTask] = useState<Task | null>(null);
  const [replicaVersion, setReplicaVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveVersion = useRef(0);
  const [showChat, setShowChat] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdRef = useRef(0);

  const addToast = useCallback((type: ToastType, msg: string) => {
    const toastId = ++toastIdRef.current;
    setToasts(previous => [...previous, { id: toastId, type, msg }]);
    setTimeout(() => setToasts(previous => previous.filter(t => t.id !== toastId)), 5000);
  }, []);

  const fetchProject = useCallback(async () => {
    const found = await apiRequest<Project>(`/api/projects?id=${encodeURIComponent(id)}`);
    setProject(found);
    return found;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    apiRequest<Project>(`/api/projects?id=${encodeURIComponent(id)}`).then(found => {
      if (cancelled) return;
      setProject(found);
      setActiveTask(found.tasks.find(t => t.status === 'processing') || found.tasks[0] || null);
    }).catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : '项目加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const taskId = activeTask?.id;
  const taskStatus = activeTask?.status;
  useEffect(() => {
    if (!taskId || taskStatus !== 'processing') return;
    let cancelled = false;
    let failures = 0;
    async function poll() {
      try {
        const task = await apiRequest<Task>(`/api/generate?projectId=${encodeURIComponent(id)}&taskId=${taskId}`);
        if (cancelled) return;
        failures = 0;
        setActiveTask(task);
        if (task.status === 'done' || task.status === 'failed') {
          addToast(task.status === 'done' ? 'success' : 'error', task.status === 'done' ? '生成完成！' : task.error || '生成失败');
          await fetchProject();
          return;
        }
      } catch {
        if (cancelled) return;
        if (++failures === 1) addToast('warning', '暂时无法获取结果，将自动重试；也可以刷新后从历史记录继续查看');
      }
      if (!cancelled) pollRef.current = setTimeout(poll, failures ? 5000 : 2000);
    }
    pollRef.current = setTimeout(poll, 2000);
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [taskId, taskStatus, id, fetchProject, addToast]);

  async function handleUpdate(updates: Partial<Project>): Promise<boolean> {
    const version = ++saveVersion.current;
    setProject(previous => previous ? { ...previous, ...updates } : previous);
    const operation = saveQueue.current.then(async () => {
      try {
        const saved = await apiRequest<Project>('/api/projects', { method: 'PATCH', body: JSON.stringify({ id, ...updates }) });
        if (version === saveVersion.current) setProject(saved);
        return true;
      } catch (e) {
        addToast('error', `保存失败：${e instanceof Error ? e.message : '请重试'}`);
        if (version === saveVersion.current) await fetchProject().catch(() => {});
        return false;
      }
    });
    saveQueue.current = operation;
    return operation;
  }

  async function handleGenerate(p: { scene: string; type: 'text2img' | 'dreamo' | 'doubao-seedance'; width: number; height: number; seed: number; promptImagesBase64?: string[] }) {
    if (!project) return;
    await saveQueue.current;
    let imageBase64: string | undefined;
    if (p.type === 'dreamo' && project.characterImage) {
      const res = await fetch(project.characterImage);
      if (!res.ok) throw new Error('无法读取参考图，请重新上传');
      const blob = await res.blob();
      imageBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    }

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: id, ...p, imageBase64 }),
    });
    const data = await res.json();
    if (data.success) {
      addToast('info', '生成任务已提交');
      const updated = await fetchProject();
      if (updated) {
        const task = updated.tasks.find((t: Task) => t.id === data.data.taskId);
        if (task) setActiveTask(task);
      }
    } else {
      addToast('error', data.error || '提交失败');
      await fetchProject();
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 14 }}>
        <div className="spinner" />
        <span style={{ color: 'var(--text-muted)' }}>加载项目...</span>
      </div>
    );
  }
  if (!project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontSize: '2rem' }}>😕</span>
        <span style={{ color: 'var(--text-secondary)' }}>{loadError || '项目不存在'}</span>
        <Link className="btn btn-ghost" href="/">← 返回首页</Link>
      </div>
    );
  }

  return (
    <div className="page-content" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Navbar */}
      <nav className="navbar">
        <Link className="btn btn-ghost btn-sm" href="/">← 项目列表</Link>
        <span style={{ marginLeft: 12, fontWeight: 600, fontSize: '0.95rem' }}>{project.name}</span>
        <div className="navbar-right">
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {project.tasks.filter((t) => t.status === 'done').length}/{project.tasks.length} 张完成
          </span>
          {/* AI Chat toggle button */}
          <button
            id="open-chat-btn"
            className={`btn btn-sm ${showChat ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowChat((p) => !p)}
            style={{ gap: 6 }}
          >
            <span style={{ fontSize: '0.85rem' }}>✦</span>
            AI 助手
            {showChat && <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>·关闭</span>}
          </button>

        </div>
      </nav>

      <ServiceStatus />
      {/* 3-column workspace */}
      <div className="workspace" style={{ flex: 1, display: 'flex', overflow: 'hidden', marginRight: showChat ? 380 : 0, transition: 'margin-right 0.25s' }}>
        <LeftPanel project={project} onUpdate={handleUpdate} addToast={addToast} />
        <MiddlePanel key={`${id}:${replicaVersion}`} project={project} onGenerate={handleGenerate} addToast={addToast} replicaTask={replicaTask} />
        <RightPanel
          project={project}
          activeTask={activeTask}
          onTaskClick={setActiveTask}
          onReplicate={(t) => { setReplicaTask(t); setReplicaVersion(v => v + 1); addToast('success', '已载入历史参数，可以继续编辑。'); }}
        />
      </div>

      {/* AI Chat Panel (slide-in) */}
      {showChat && project && (
        <ChatPanel projectId={id as string} project={project} onClose={() => setShowChat(false)} />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
