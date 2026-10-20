import type { Metadata, Viewport } from "next";
import { Sarabun } from "next/font/google";
import "./globals.css";

const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ชั้นหนังสือแชท",
  description: "อ่านนิยายในรูปแบบแชทบับเบิล",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#14161a" },
  ],
};

// กันจอกระพริบ (plan.md §4.6 ข้อ 2-3) — อ่าน reader:settings ก่อน ยังไม่ migrate ค่อยใช้ ppu:settings เดิม — อ่าน localStorage ก่อน paint แล้วเซ็ต data-theme/data-font
// ที่ <html> ทันที ก่อน React hydrate เลยต้องมี suppressHydrationWarning ที่ <html> (มีอยู่แล้ว)
// ต้อง resolve 'system' เป็นค่าจริงในสคริปต์นี้ด้วย ไม่ปล่อยเป็น "system" ลง data-theme ตรงๆ
const NO_FLASH_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('reader:settings')||localStorage.getItem('ppu:settings')||'{}');var theme=s.theme||'system';var font=s.fontSize||'md';if(theme==='system'){theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var html=document.documentElement;html.setAttribute('data-theme',theme);html.setAttribute('data-font',font);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${sarabun.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
