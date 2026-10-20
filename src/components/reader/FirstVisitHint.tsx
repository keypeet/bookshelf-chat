'use client'

import { useEffect, useState } from 'react'
import { getSeenHint, setSeenHint } from '@/lib/storage'

// F3.3 — โชว์ครั้งเดียวตลอด (เขียน reader:seenHint), หายเมื่อ 4 วิ/เลื่อน/แตะ
// เช็ค seenHint ตอน mount ของทั้งแอป (ไม่ผูกกับ chapterId) — เปลี่ยนตอนไม่โผล่ซ้ำเพราะ
// ReaderShell mount ครั้งเดียวต่อการเข้าเว็บ ไม่ remount ตอนเปลี่ยน route ภายใน /b/[book]/[id]
export default function FirstVisitHint() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (getSeenHint()) return
    setShow(true)
    setSeenHint()

    const timer = setTimeout(() => setShow(false), 4000)

    function dismiss() {
      setShow(false)
    }
    window.addEventListener('scroll', dismiss, { passive: true, once: true })
    window.addEventListener('pointerdown', dismiss, { once: true })

    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', dismiss)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [])

  if (!show) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-1/2 z-40 flex -translate-y-1/2 justify-center px-6"
    >
      <p className="rounded-full bg-fg/85 px-4 py-2 text-center text-[13px] text-bg shadow-lg">
        แตะจอเพื่อซ่อน/แสดงเมนู
      </p>
    </div>
  )
}
