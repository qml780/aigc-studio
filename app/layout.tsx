import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIGC Studio — 智能创作工作台',
  description: '基于即梦 API 的 AIGC 项目制创作平台。上传角色三视图自动提取关键词，项目级上下文记忆，智能提示词构建，一键直出高质量图像。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="page-bg" />
        {children}
      </body>
    </html>
  );
}
