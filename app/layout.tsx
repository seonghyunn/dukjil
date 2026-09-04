import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  ),
  title: '덕질로그 — 공연의 모든 순간',
  description:
    '다녀온 공연을 기록하고, 달력과 지도로 나의 덕질 여정을 돌아보세요.',
  robots: { index: false, follow: false },
  openGraph: {
    title: '덕질로그',
    description: '공연의 모든 순간을 기록하다',
    type: 'website',
    locale: 'ko_KR',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: '덕질로그 — 공연의 모든 순간을 기록하다',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '덕질로그',
    description: '공연의 모든 순간을 기록하다',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${geist.variable} antialiased`}>{children}</body>
    </html>
  );
}
