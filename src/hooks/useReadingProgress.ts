'use client'

import { useEffect } from 'react'
import { markCompleted, setLastChapterId } from '@/lib/storage'

// F4.1 ตาม plan.md §4.3 — ใช้ sentinel ไม่คำนวณ scrollY/scrollHeight เอง
// เขียน lastChapterId ตอน mount (ไม่ใช่ตอน 80%) + IntersectionObserver จับ [data-progress-sentinel]
// intersect ครั้งแรก = บันทึก completed
export function useReadingProgress(book: string, chapterId: string) {
  useEffect(() => {
    setLastChapterId(book, chapterId)
  }, [book, chapterId])

  useEffect(() => {
    const sentinel = document.querySelector('[data-progress-sentinel]')
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            markCompleted(book, chapterId)
            observer.disconnect()
            break
          }
        }
      },
      { threshold: 0 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [book, chapterId])
}
