'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import NextImage from 'next/image';
import type { Project } from '@/lib/projects';
import { apiRequest } from '@/lib/client';
import ServiceStatus from './components/ServiceStatus';

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (project: Project) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true); setError('');
    try {
      const project = await apiRequest<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name, description }) });
      onCreate(project); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : '创建失败，请重试'); }
    finally { setLoading(false); }
  }
  return <div className="modal-overlay" onClick={() => { if (!loading) onClose(); }}>
    <form className="modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onSubmit={submit} onClick={e => e.stopPropagation()}>
      <h2 id="new-project-title" style={{ marginBottom: 20 }}>新建项目</h2>
      <div className="form-group"><label className="form-label" htmlFor="new-project-name">项目名称 *</label>
        <input id="new-project-name" className="input" placeholder="例如：星之守护者角色设计" value={name} maxLength={100} onChange={e => setName(e.target.value)} autoFocus required />
      </div>
      <div className="form-group" style={{ marginTop: 14 }}><label className="form-label" htmlFor="new-project-description">项目描述</label>
        <textarea id="new-project-description" className="textarea" placeholder="简要描述作品用途、角色或世界观…" value={description} maxLength={2000} onChange={e => setDescription(e.target.value)} />
      </div>
      {error && <p role="alert" className="error-message">{error}</p>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>取消</button>
        <button id="create-project-btn" className="btn btn-primary" disabled={!name.trim() || loading}>{loading ? '创建中…' : '创建项目'}</button>
      </div>
    </form>
  </div>;
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const loadProjects = useCallback(async () => {
    setLoading(true); setError('');
    try { setProjects(await apiRequest<Project[]>('/api/projects')); }
    catch (e) { setError(e instanceof Error ? e.message : '加载项目失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    apiRequest<Project[]>('/api/projects').then(value => { if (active) setProjects(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : '加载项目失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function deleteProject(project: Project) {
    if (!confirm(`确认删除项目「${project.name}」及其任务记录？`)) return;
    setDeleting(project.id); setError('');
    try {
      await apiRequest('/api/projects', { method: 'DELETE', body: JSON.stringify({ id: project.id }) });
      setProjects(previous => previous.filter(p => p.id !== project.id));
    } catch (e) { setError(e instanceof Error ? e.message : '删除失败'); }
    finally { setDeleting(null); }
  }
  return <div className="page-content">
    <nav className="navbar"><Link href="/" className="navbar-logo"><span className="logo-mark">AI</span>AIGC Studio</Link>
      <button id="open-new-project-btn" className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ 新建项目</button>
    </nav>
    <main className="container" style={{ paddingTop: 48, paddingBottom: 48 }}>
      <div style={{ maxWidth: 660, marginBottom: 28 }}>
        <div className="section-badge" style={{ display: 'inline-block', marginBottom: 16 }}>项目里的每一次创作，都有迹可循</div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', lineHeight: 1.2, marginBottom: 18 }}>让灵感，成为一组作品。</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>为角色和画风建立参考，编辑可复用的关键词，组合场景提示词，生成图片并保留创作记录。</p>
      </div>
      <ServiceStatus />
      <div className="home-stats">{[
        ['项目', projects.length],
        ['已完成图片', projects.reduce((sum, p) => sum + p.tasks.filter(t => t.status === 'done' && t.type !== 'doubao-seedance').length, 0)],
        ['生成任务', projects.reduce((sum, p) => sum + p.tasks.length, 0)],
      ].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="section-header"><h2 className="section-title">我的项目</h2><button className="btn btn-ghost btn-sm" onClick={() => setShowModal(true)}>+ 新建</button></div>
      {error && <div className="error-message" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={loadProjects}>重试加载</button></div>}
      {loading ? <div className="empty-state"><div className="spinner" /><span>加载项目中…</span></div> :
        <div className="project-grid">
          <button id="new-project-card" className="card project-card project-card-new" onClick={() => setShowModal(true)}><span className="plus-icon">+</span><span>新建项目</span><small>参考图 · 关键词 · 图片生成</small></button>
          {projects.map(project => <article key={project.id} className="card project-card">
            <Link href={`/project/${project.id}`} className="project-open" aria-label={`打开项目 ${project.name}`}>
              {project.characterImage ? <NextImage unoptimized width={1024} height={1024} src={project.characterImage} alt={`${project.name}的角色参考`} className="project-cover" /> : <div className="project-cover project-placeholder">✦</div>}
              <h3 className="project-card-name">{project.name}</h3><p className="project-card-desc">{project.description || '添加参考图，开始你的第一张作品。'}</p>
            </Link>
            <div className="project-card-footer"><span>{project.tasks.length} 个任务 · {new Date(project.updatedAt).toLocaleDateString('zh-CN')}</span>
              <button className="btn btn-ghost btn-sm" aria-label={`删除项目 ${project.name}`} onClick={() => deleteProject(project)} disabled={deleting === project.id}>{deleting === project.id ? '删除中' : '删除'}</button>
            </div>
          </article>)}
        </div>}
      <div className="workflow-guide">{[
        ['01', '建立参考', '上传角色或画风参考图，也可以直接手动编辑关键词。'],
        ['02', '组合提示词', '把角色、风格、场景和质量词组合为完整提示词。'],
        ['03', '生成与迭代', '查看生成结果，复用历史参数继续创作。'],
      ].map(([number, title, desc]) => <div className="glass-card" key={number}><span className="section-badge">{number}</span><h3>{title}</h3><p>{desc}</p></div>)}</div>
    </main>
    {showModal && <NewProjectModal onClose={() => setShowModal(false)} onCreate={project => setProjects(previous => [project, ...previous])} />}
  </div>;
}
