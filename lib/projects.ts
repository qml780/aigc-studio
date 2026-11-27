import { composePrompt } from './prompts.ts';
import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'node:crypto';
import { imageData, InputError, keywords, stringList, text } from './validation.ts';

export interface KeywordSet {
  hairstyle: string[];    // 发型
  clothing: string[];     // 服装
  colors: string[];       // 配色
  style: string[];        // 风格
  features: string[];     // 特征
  quality: string[];      // 质量词
}

export interface CharacterType {
  id: string;
  name: string;
  keywords: KeywordSet;
  imageBase64: string;
}

export interface Task {
  id: string;
  type: 'text2img' | 'dreamo' | 'doubao-seedance';
  prompt: string;
  fullPrompt: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  taskId?: string;        // async task id
  imageUrl?: string;
  imageBase64?: string;
  promptImagesBase64?: string[]; // 支持多张垫图
  width: number;
  height: number;
  seed: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  characterKeywords: KeywordSet; // 兼容旧版
  styleKeywords: KeywordSet;
  characterImage?: string;       // 兼容旧版
  characters?: CharacterType[];  // 新版多角色池
  styleImage?: string;           // path to uploaded style image
  defaultQuality: string[];
  promptTemplate: string;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export const DATA_DIR = process.env.AIGC_DATA_DIR || path.join(process.cwd(), 'data');
if (!path.isAbsolute(DATA_DIR)) throw new Error('AIGC_DATA_DIR 必须为绝对路径');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function ensureDirs() {
  if (!fs.existsSync(/* turbopackIgnore: true */ DATA_DIR)) fs.mkdirSync(/* turbopackIgnore: true */ DATA_DIR, { recursive: true });
  if (!fs.existsSync(/* turbopackIgnore: true */ UPLOADS_DIR)) fs.mkdirSync(/* turbopackIgnore: true */ UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(/* turbopackIgnore: true */ PROJECTS_FILE)) {
    fs.writeFileSync(/* turbopackIgnore: true */ PROJECTS_FILE, JSON.stringify([], null, 2));
  }
}

function readProjects(): Project[] {
  ensureDirs();
  const raw = fs.readFileSync(/* turbopackIgnore: true */ PROJECTS_FILE, 'utf8');
  return JSON.parse(raw) as Project[];
}

function writeProjects(projects: Project[]) {
  ensureDirs();
  const temporary = `${PROJECTS_FILE}.${uuidv4()}.tmp`;
  try {
    fs.writeFileSync(/* turbopackIgnore: true */ temporary, JSON.stringify(projects, null, 2), { flag: 'wx' });
    fs.renameSync(/* turbopackIgnore: true */ temporary, PROJECTS_FILE);
  } finally {
    if (fs.existsSync(/* turbopackIgnore: true */ temporary)) fs.unlinkSync(/* turbopackIgnore: true */ temporary);
  }
}

export function getAllProjects(): Project[] {
  return readProjects();
}

export function getProject(id: string): Project | null {
  return readProjects().find((p) => p.id === id) ?? null;
}

export function createProject(data: { name: string; description?: string }): Project {
  const name = text(data.name, '项目名称', 100, true);
  const description = text(data.description, '项目描述', 2000);
  const projects = readProjects();
  const now = new Date().toISOString();
  const project: Project = {
    id: uuidv4(),
    name,
    description,
    characterKeywords: { hairstyle: [], clothing: [], colors: [], style: [], features: [], quality: [] },
    styleKeywords: { hairstyle: [], clothing: [], colors: [], style: [], features: [], quality: [] },
    characters: [], // 默认初始化空的多角色池
    defaultQuality: ['masterpiece', 'best quality', 'ultra detailed', '8k'],
    promptTemplate: '{character}, {style}, {scene}, {quality}',
    tasks: [],
    createdAt: now,
    updatedAt: now,
  };
  projects.push(project);
  writeProjects(projects);
  return project;
}

export function updateProject(id: string, updates: Partial<Project>): Project | null {
  const projects = readProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString() };
  writeProjects(projects);
  return projects[idx];
}

export function deleteProject(id: string): boolean {
  const projects = readProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  projects.splice(idx, 1);
  writeProjects(projects);
  return true;
}

export function addTask(projectId: string, task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task | null {
  const projects = readProjects();
  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const newTask: Task = { ...task, id: uuidv4(), createdAt: now, updatedAt: now };
  projects[idx].tasks.unshift(newTask);
  projects[idx].updatedAt = now;
  writeProjects(projects);
  return newTask;
}

export function updateTask(projectId: string, taskId: string, updates: Partial<Task>): Task | null {
  const projects = readProjects();
  const pIdx = projects.findIndex((p) => p.id === projectId);
  if (pIdx === -1) return null;
  const tIdx = projects[pIdx].tasks.findIndex((t) => t.id === taskId);
  if (tIdx === -1) return null;
  const now = new Date().toISOString();
  projects[pIdx].tasks[tIdx] = { ...projects[pIdx].tasks[tIdx], ...updates, updatedAt: now };
  writeProjects(projects);
  return projects[pIdx].tasks[tIdx];
}

export function buildFullPrompt(project: Project, scene: string): string {
  return composePrompt(project, scene);
}

export async function saveUploadedImage(base64Data: string, _filename?: string, maxBytes?: number): Promise<string> {
  const { buffer, ext } = imageData(base64Data, maxBytes);
  ensureDirs();
  const name = `${uuidv4()}.${ext}`;
  fs.writeFileSync(/* turbopackIgnore: true */ path.join(UPLOADS_DIR, name), buffer, { flag: 'wx' });
  return `/uploads/${name}`;
}

export function validateProjectUpdates(value: Record<string, unknown>): Partial<Project> {
  const allowed = ['name', 'description', 'characterKeywords', 'styleKeywords', 'characterImage', 'styleImage', 'defaultQuality', 'promptTemplate'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new InputError('包含不支持修改的项目字段');
  const result: Partial<Project> = {};
  if ('name' in value) result.name = text(value.name, '项目名称', 100, true);
  if ('description' in value) result.description = text(value.description, '项目描述', 2000);
  if ('promptTemplate' in value) result.promptTemplate = text(value.promptTemplate, '提示词模板', 2000);
  if ('characterKeywords' in value) result.characterKeywords = keywords(value.characterKeywords);
  if ('styleKeywords' in value) result.styleKeywords = keywords(value.styleKeywords);
  if ('defaultQuality' in value) result.defaultQuality = stringList(value.defaultQuality);
  for (const key of ['characterImage', 'styleImage'] as const) {
    if (!(key in value)) continue;
    const url = text(value[key], '图片地址', 200);
    if (url && !/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(url)) throw new InputError('请使用已上传的参考图片');
    result[key] = url;
  }
  return result;
}
