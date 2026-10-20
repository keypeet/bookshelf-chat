import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ลิงก์เก่าก่อนมีหลายเรื่อง — เดิมมีเรื่องเดียวที่ path ไม่มี slug; เรียงแบบเจาะจงก่อน
  async redirects() {
    return [
      {
        source: '/read/book/:volume/:bookChapter',
        destination: '/b/phet-phra-uma/chapter/:volume/:bookChapter',
        permanent: true,
      },
      { source: '/read/:id', destination: '/b/phet-phra-uma/:id', permanent: true },
      { source: '/characters', destination: '/b/phet-phra-uma/characters', permanent: true },
    ]
  },
};

export default nextConfig;
