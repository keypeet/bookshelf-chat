'use client'

import { useEffect, useState } from 'react'
import { isCompleted } from '@/lib/storage'

interface ChapterCompletedMarkProps {
  book: string
  chapterId: string
}

// F4.3 — ✓ ตอนที่อ่านแล้ว ใช้ isCompleted เดียวกับ ChapterPicker (หน้าอ่าน) เพื่อให้ตรงกัน
// render สถานะกลาง (ไม่มี ✓) ก่อน mount เสมอ (§4.6 ข้อ 4) กัน hydration mismatch
export default function ChapterCompletedMark({ book, chapterId }: ChapterCompletedMarkProps) {
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDone(isCompleted(book, chapterId))
  }, [book, chapterId])

  if (!done) return null

  return (
    <span aria-hidden className="shrink-0 text-accent">
      ✓
    </span>
  )
}
