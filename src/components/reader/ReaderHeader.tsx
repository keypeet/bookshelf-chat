'use client'

import Link from 'next/link'

interface ReaderHeaderProps {
  title: string
  backHref: string
  visible: boolean
  onOpenSettings: () => void
}

// F2.1 — header ลอยด้านบน ซ่อน/โชว์ตาม chrome visible (translate + opacity เท่านั้น ห้าม display:none)
// ชื่อตอนเป็น label ล้วน ไม่ใช่ปุ่มเปิด dropdown แล้ว — เลือกตอน/ช่วงย้ายไปปุ่มลอยมุมล่างขวา (ReaderShell)
export default function ReaderHeader({ title, backHref, visible, onOpenSettings }: ReaderHeaderProps) {
  return (
    <header
      className={`fixed inset-x-0 top-0 z-30 border-b border-line bg-bg/95 backdrop-blur transition-[transform,opacity] duration-200 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
      }`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="relative mx-auto flex w-full max-w-[640px] items-center gap-1 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">{title}</span>
        <Link
          href={backHref}
          data-no-tap
          aria-label="กลับสารบัญ"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-fg"
        >
          ←
        </Link>
        <button
          type="button"
          data-no-tap
          onClick={onOpenSettings}
          aria-label="ตั้งค่าการอ่าน"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg2"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
