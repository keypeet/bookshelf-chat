'use client'

import { useCallback, useEffect, useState } from 'react'
import { markCompleted } from '@/lib/storage'

// F3.5 ตาม plan.md §4.5-4.6 — โหมดแตะไล่: แตะแล้วโผล่ block ถัดไปทีละอัน
// เข้าตอนใหม่เริ่มนับ revealedCount ใหม่จาก 0 เสมอ (ผูกกับ chapterId)
// เกณฑ์ completed แยกจาก useReadingProgress (sentinel-based) เพราะ DOM ยังไม่มีของให้เลื่อน (§4.3 ท้ายหัวข้อ)
export function useTapReveal(book: string, chapterId: string, totalBlocks: number) {
  const [revealedCount, setRevealedCount] = useState(0)

  // เปลี่ยนตอน = เริ่มนับใหม่จาก 0 เสมอ
  useEffect(() => {
    setRevealedCount(0)
  }, [book, chapterId])

  // เผยครบ ceil(len*0.8) = บันทึกว่าอ่านแล้ว
  useEffect(() => {
    if (totalBlocks === 0) return
    const threshold = Math.ceil(totalBlocks * 0.8)
    if (revealedCount >= threshold) {
      markCompleted(book, chapterId)
    }
  }, [revealedCount, totalBlocks, book, chapterId])

  // จอเลื่อนตามให้เห็น block ใหม่ที่เพิ่งโผล่ (ข้าม render แรกตอนเข้าตอนใหม่ที่ revealedCount = 0)
  useEffect(() => {
    if (revealedCount === 0) return
    const latestIndex = revealedCount - 1
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-block-index="${latestIndex}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
    return () => cancelAnimationFrame(raf)
  }, [revealedCount])

  const revealNext = useCallback(() => {
    setRevealedCount((v) => Math.min(v + 1, totalBlocks))
  }, [totalBlocks])

  const revealAll = useCallback(() => {
    setRevealedCount(totalBlocks)
  }, [totalBlocks])

  const isComplete = revealedCount >= totalBlocks

  return { revealedCount, revealNext, revealAll, isComplete }
}
