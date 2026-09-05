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
  title: '词序｜在句子里背四六级单词',
  description: '按考试日期安排每天的背词量，先听句子，再结合语境记住四六级单词。',
  openGraph: {
    title: '词序｜在句子里背四六级单词',
    description: '按考试日期安排背词量，先听句子，再结合语境记。',
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: '词序｜在句子里背四六级单词',
    description: '按考试日期安排背词量，先听句子，再结合语境记。',
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
