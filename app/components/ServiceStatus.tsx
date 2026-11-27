'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/client';

export type Capabilities = { chat: boolean; vision: boolean; image: boolean; experimental: boolean };

export default function ServiceStatus() {
  const [config, setConfig] = useState<Capabilities | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    apiRequest<Capabilities>('/api/config').then(value => { if (active) setConfig(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  if (error) return <div className="service-status" role="status">暂时无法读取服务状态，请刷新页面。</div>;
  if (!config) return null;
  const labels = [['image', '图片生成'], ['vision', '图片分析'], ['chat', 'AI 助手']] as const;
  const missing = labels.filter(([key]) => !config[key]);
  return <div className="service-status" role="status">
    <div className="service-status-items">{labels.map(([key, label]) => <span key={key}>
      <span className={`status-dot ${config[key] ? 'done' : 'pending'}`} /> {label} · {config[key] ? '已配置' : '未配置'}
    </span>)}</div>
    {missing.length > 0 && <p>可以先创建项目、上传参考图和手动编辑关键词。配置 AI 服务后即可分析与生成；配置方法见项目 README。</p>}
  </div>;
}
