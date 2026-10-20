import Link from 'next/link'
import { getBooks, getIndexEntries } from '@/lib/content'
import { bookChapterId, bookChapterTitle, bookHref } from '@/lib/routes'
import type { IndexEntry } from '@/lib/types'
import BookCover from '@/components/home/BookCover'
import ContinueReadingRow from '@/components/home/ContinueReadingRow'

// ชั้นหนังสือ — ทุกเรื่องใน LIBRARY_DIR; ไม่มีเรื่องเลย (clone ใหม่ไม่มี library) → ข้อความว่าง
// ชื่อที่แถว "อ่านต่อ" ใช้ — ตอนปกติ + id สังเคราะห์ของโหมดอ่านทั้งบท (id ที่ไม่อยู่ในนี้ = ไม่มีแล้ว)
function chapterTitles(entries: IndexEntry[]): Record<string, string> {
  const multiVolume = new Set(entries.map((entry) => entry.volume)).size > 1
  const titles: Record<string, string> = {}
  for (const entry of entries) {
    titles[entry.id] = entry.title
    if (entry.bookChapter !== undefined) {
      titles[bookChapterId(entry.volume, entry.bookChapter)] = bookChapterTitle(entry.volume, entry.bookChapter, multiVolume)
    }
  }
  return titles
}

// tile "เพิ่มหนังสือ" เป็นแค่ลิงก์ไป Studio — Reader ไม่ import lib/studio และไม่เรียก backend
function AddBookTile() {
  return (
    <Link
      href="/studio"
      className="flex aspect-[1272/1800] w-full items-center justify-center rounded-lg border-2 border-dashed border-line text-[15px] font-semibold text-fg2 hover:border-accent hover:text-accent"
    >
      + เพิ่มหนังสือ
    </Link>
  )
}

export default function Shelf() {
  const books = getBooks()
  const studio = process.env.STUDIO === '1'

  if (books.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-bg px-4 py-16">
        <p className="text-center text-[15px] text-fg2">ยังไม่มีหนังสือ</p>
        {studio ? (
          <div className="w-40">
            <AddBookTile />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-bg">
      <main className="w-full max-w-[640px] flex-1 px-4 py-10 sm:py-16">
        <h1 className="mb-8 text-center text-2xl font-bold text-fg">ชั้นหนังสือแชท</h1>

        <ContinueReadingRow
          books={books.map((book) => ({
            slug: book.slug,
            title: book.title,
            chapterTitles: chapterTitles(getIndexEntries(book.slug)),
          }))}
        />

        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
          {books.map((book) => (
            <li key={book.slug}>
              <Link href={bookHref(book.slug)} className="flex flex-col gap-2">
                <BookCover book={book} className="w-full" />
                <span className="line-clamp-2 text-[15px] font-semibold text-fg">{book.title}</span>
                {book.author ? <span className="-mt-1.5 text-[13px] text-fg2">{book.author}</span> : null}
              </Link>
            </li>
          ))}
          {studio ? (
            <li>
              <AddBookTile />
            </li>
          ) : null}
        </ul>
      </main>
    </div>
  )
}
