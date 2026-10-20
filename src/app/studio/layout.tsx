import { notFound } from 'next/navigation'

// Studio ใช้ในเครื่องเท่านั้น — build/dev ที่ไม่มี STUDIO=1 ทุกหน้าใต้ /studio เป็น 404
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  if (process.env.STUDIO !== '1') notFound()
  return <div className="flex flex-1 flex-col bg-bg">{children}</div>
}
