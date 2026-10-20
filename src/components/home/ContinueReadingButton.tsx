'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { IndexEntry } from '@/lib/types'
import { getProgress, isCompleted } from '@/lib/storage'
import { bookChapterTitle, chapterHref, parseBookChapterId } from '@/lib/routes'

interface ContinueReadingButtonProps {
  book: string
  indexEntries: IndexEntry[]
}

interface ButtonTarget {
  chapterId: string
  label: string
}

// ต้อง render สถานะกลาง "เริ่มอ่าน" ก่อนเสมอ (plan.md §4.6 ข้อ 4) แล้วเติมของจริงใน useEffect
// ห้าม import lib/content.ts หรือ lib/characters.ts ที่นี่ (§3) — รับ indexEntries เป็น props จาก server component พ่อ
function resolveTarget(book: string, indexEntries: IndexEntry[]): ButtonTarget | null {
  if (indexEntries.length === 0) return null
  const first = indexEntries[0]

  const { lastChapterId } = getProgress(book)
  const lastEntry = lastChapterId
    ? indexEntries.find((entry) => entry.id === lastChapterId)
    : undefined

  // ค้างที่โหมดอ่านทั้งบท — id สังเคราะห์ไม่อยู่ใน indexEntries ต้องเช็คจาก volume/bookChapter แทน
  const whole = lastChapterId ? parseBookChapterId(lastChapterId) : null
  if (lastChapterId && whole) {
    const exists = indexEntries.some(
      (entry) => entry.volume === whole.volume && entry.bookChapter === whole.bookChapter
    )
    if (exists) {
      const multiVolume = new Set(indexEntries.map((entry) => entry.volume)).size > 1
      const title = bookChapterTitle(whole.volume, whole.bookChapter, multiVolume)
      const label = isCompleted(book, lastChapterId) ? 'อ่านอีกครั้ง' : 'อ่านต่อ'
      return { chapterId: lastChapterId, label: `${label} — ${title}` }
    }
  }

  // §4.6/5.4 — ไม่มี lastChapterId หรือชี้ตอนที่ไม่มีจริง (เช่น "v1-c99") → ถอยไปตอนแรกสุด
  if (!lastEntry) {
    return { chapterId: first.id, label: 'เริ่มอ่าน' }
  }

  if (!isCompleted(book, lastEntry.id)) {
    return { chapterId: lastEntry.id, label: `อ่านต่อ — ${lastEntry.title}` }
  }

  // อ่านจบตอนล่าสุดแล้ว — ถ้ามีตอนถัดไปให้ชี้ไปตอนนั้นแทน
  const lastIndex = indexEntries.findIndex((entry) => entry.id === lastEntry.id)
  const nextEntry = indexEntries[lastIndex + 1]
  if (nextEntry) {
    return { chapterId: nextEntry.id, label: `อ่านต่อ — ${nextEntry.title}` }
  }

  // completed แล้วและเป็นตอนสุดท้าย — plan.md ไม่ได้ระบุเคสนี้ชัดเจน
  // เลือก "อ่านอีกครั้ง" เพื่อสื่อว่าอ่านจบทั้งเรื่องแล้ว ไม่ใช่ชวนให้สับสนว่ายังมีตอนใหม่
  return { chapterId: lastEntry.id, label: `อ่านอีกครั้ง — ${lastEntry.title}` }
}

export default function ContinueReadingButton({ book, indexEntries }: ContinueReadingButtonProps) {
  const first = indexEntries[0]
  const [target, setTarget] = useState<ButtonTarget | null>(
    first ? { chapterId: first.id, label: 'เริ่มอ่าน' } : null
  )

  useEffect(() => {
    setTarget(resolveTarget(book, indexEntries))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!target) return null

  return (
    <Link
      href={chapterHref(book, target.chapterId)}
      className="inline-block w-full max-w-xs rounded-full bg-accent px-6 py-3 text-center text-[15px] font-semibold text-white sm:w-auto"
    >
      {target.label}
    </Link>
  )
}
