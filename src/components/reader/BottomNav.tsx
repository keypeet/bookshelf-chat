'use client'

import type { IndexEntry } from '@/lib/types'

interface BottomNavProps {
  prevChapter: IndexEntry | null
  nextChapter: IndexEntry | null
  visible: boolean
  onNavigate: (chapterId: string) => void
}

// F2.2 — ตอนแรก/ตอนท้าย ปุ่มนั้นหายไปทั้งอัน (ไม่ใช่แค่ disabled) + safe-area กัน home indicator
export default function BottomNav({ prevChapter, nextChapter, visible, onNavigate }: BottomNavProps) {
  return (
    <nav
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur transition-[transform,opacity] duration-200 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex w-full max-w-[640px] items-center justify-between px-4 py-3">
        {prevChapter ? (
          <button
            type="button"
            data-no-tap
            onClick={() => onNavigate(prevChapter.id)}
            className="min-w-0 max-w-[45%] truncate text-[14px] text-fg2"
          >
            ← {prevChapter.title}
          </button>
        ) : (
          <span />
        )}
        {nextChapter ? (
          <button
            type="button"
            data-no-tap
            onClick={() => onNavigate(nextChapter.id)}
            className="min-w-0 max-w-[45%] truncate text-[14px] font-medium text-accent"
          >
            {nextChapter.title} →
          </button>
        ) : (
          <span />
        )}
      </div>
    </nav>
  )
}
