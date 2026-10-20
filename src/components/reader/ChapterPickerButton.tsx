'use client'

import type { IndexEntry } from '@/lib/types'
import ChapterPicker from './ChapterPicker'

interface ChapterPickerButtonProps {
  book: string
  chapters: IndexEntry[]
  currentChapterId: string
  visible: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
  onNavigate: (chapterId: string) => void
}

// ปุ่มลอยมุมล่างขวา — เลือกตอน/ช่วง (แทนที่ dropdown เดิมที่เคยผูกกับชื่อบทใน header)
// วางเหนือ ScrollTopButton เสมอ (bottom-36) กันซ้อนทับกันตอนโผล่พร้อมกัน
export default function ChapterPickerButton({
  book,
  chapters,
  currentChapterId,
  visible,
  open,
  onToggle,
  onClose,
  onNavigate,
}: ChapterPickerButtonProps) {
  return (
    <div
      className={`fixed bottom-36 right-4 z-30 transition-[transform,opacity] duration-200 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <button
        type="button"
        data-no-tap
        aria-hidden={!visible}
        tabIndex={visible ? 0 : -1}
        aria-label="เลือกตอน/ช่วง"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-fg shadow-md"
      >
        ☰
      </button>
      <ChapterPicker
        book={book}
        chapters={chapters}
        currentChapterId={currentChapterId}
        open={open}
        onClose={onClose}
        onNavigate={onNavigate}
        anchorClassName="absolute bottom-full right-0 z-20 mb-2 max-h-[70vh] w-[min(90vw,320px)] overflow-y-auto rounded-xl border border-line bg-card shadow-lg"
      />
    </div>
  )
}
