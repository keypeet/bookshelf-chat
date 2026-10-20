'use client'

import { useEffect, useRef, useState } from 'react'
import type { IndexEntry } from '@/lib/types'
import { isCompleted } from '@/lib/storage'

interface ChapterPickerProps {
  book: string
  chapters: IndexEntry[]
  currentChapterId: string
  open: boolean
  onClose: () => void
  onNavigate: (chapterId: string) => void
  // panel ลอยจากปุ่มมุมล่างขวา (ReaderShell) แทนที่จะ absolute ใต้ header เหมือนเดิม
  anchorClassName?: string
}

// F2.1 — dropdown สารบัญ ตอนปัจจุบันถูกเน้น, ตอนอ่านแล้วมี ✓ (จาก storage), แตะข้างนอก/Escape ปิด
// ไม่ toggle chrome ตามไปด้วย เพราะ ReaderShell เช็ค "dropdown เปิดอยู่ไหม" ก่อน toggle เสมอ (§4.1)
export default function ChapterPicker({
  book,
  chapters,
  currentChapterId,
  open,
  onClose,
  onNavigate,
  anchorClassName,
}: ChapterPickerProps) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)

  // อ่าน localStorage ฝั่ง client เท่านั้น (§4.6 ข้อ 4) — เปิด dropdown ครั้งไหนก็รีเฟรชค่าใหม่
  useEffect(() => {
    if (!open) return
    const next = new Set<string>()
    for (const chapter of chapters) {
      if (isCompleted(book, chapter.id)) next.add(chapter.id)
    }
    setCompletedIds(next)
  }, [open, chapters, book])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      data-no-tap
      className={
        anchorClassName ??
        'absolute left-1/2 top-full z-20 mt-2 max-h-[70vh] w-[min(90vw,360px)] -translate-x-1/2 overflow-y-auto rounded-xl border border-line bg-card shadow-lg'
      }
    >
      <ul className="py-1">
        {chapters.map((chapter) => {
          const isCurrent = chapter.id === currentChapterId
          const done = completedIds.has(chapter.id)
          return (
            <li key={chapter.id}>
              <button
                type="button"
                data-no-tap
                onClick={() => {
                  onNavigate(chapter.id)
                  onClose()
                }}
                className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[15px] ${
                  isCurrent ? 'bg-bubble-me font-semibold text-accent' : 'text-fg'
                }`}
              >
                <span className="truncate">{chapter.title}</span>
                {done ? <span aria-hidden className="shrink-0 text-accent">✓</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
