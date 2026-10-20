import type { Book } from '@/lib/types'

interface BookCoverProps {
  book: Book
  className?: string
}

// สีพื้นคงที่ต่อชื่อเรื่อง — ใช้เมื่อ book.json ไม่มีทั้ง cover และ coverColor
function coverColor(title: string): string {
  let hash = 0
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) % 360
  return `hsl(${hash} 35% 40%)`
}

// ปกมาจาก library/<slug>/assets/ ที่ scripts/sync-library-assets.mjs คัดลอกไป public/books/<slug>/
export default function BookCover({ book, className = '' }: BookCoverProps) {
  if (book.cover) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/books/${book.slug}/${book.cover}`}
        alt={`ปกหนังสือ ${book.title}`}
        width={1272}
        height={1800}
        className={`aspect-[1272/1800] h-auto rounded-lg object-cover shadow-md ${className}`}
      />
    )
  }
  return (
    <div
      role="img"
      aria-label={`ปกหนังสือ ${book.title}`}
      style={{ backgroundColor: book.coverColor ?? coverColor(book.title) }}
      className={`flex aspect-[1272/1800] items-center justify-center rounded-lg p-3 text-center text-[15px] font-semibold text-white shadow-md ${className}`}
    >
      {book.title}
    </div>
  )
}
