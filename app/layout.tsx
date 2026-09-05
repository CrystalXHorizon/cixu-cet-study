import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '词序｜四六级词汇复习',
  description: '用清晰的每日任务和间隔复习，稳稳记住四六级单词。',
  openGraph: {
    title: '词序｜四六级词汇复习',
    description: '每天少背一点，但按时回来。',
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: '词序｜四六级词汇复习',
    description: '每天少背一点，但按时回来。',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
