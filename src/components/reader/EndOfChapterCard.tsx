'use client'

import Link from 'next/link'

interface EndOfChapterCardProps {
  nextChapterId: string | null
  nextChapterTitle: string | null
  backHref: string
  onNavigate: (chapterId: string) => void
}

// F2.4 — ถึงท้ายตอน (sentinel ท้ายตอน intersect) โชว์การ์ด + ปุ่มไปตอนถัดไป
// ตอนสุดท้ายของ index.json (nextChapterId === null) → ปุ่ม "กลับสารบัญ"
export default function EndOfChapterCard({
  nextChapterId,
  nextChapterTitle,
  backHref,
  onNavigate,
}: EndOfChapterCardProps) {
  return (
    <div className="mx-4 my-8 rounded-2xl border border-line bg-card p-6 text-center">
      <p className="mb-4 text-[15px] text-fg2">จบตอนนี้แล้ว</p>
      {nextChapterId ? (
        <button
          type="button"
          data-no-tap
          onClick={() => onNavigate(nextChapterId)}
          className="w-full rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white"
        >
          อ่าน {nextChapterTitle} ต่อ →
        </button>
      ) : (
        <Link
          href={backHref}
          data-no-tap
          className="inline-block w-full rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white"
        >
          กลับสารบัญ
        </Link>
      )}
    </div>
  )
}
