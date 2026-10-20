import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getBooks, getIndex } from '@/lib/content'
import { chapterHref } from '@/lib/routes'
import type { IndexEntry } from '@/lib/types'
import ContinueReadingButton from '@/components/home/ContinueReadingButton'
import ChapterCompletedMark from '@/components/home/ChapterCompletedMark'
import VolumeSwitcher from '@/components/home/VolumeSwitcher'
import BookCover from '@/components/home/BookCover'

interface BookPageProps {
  params: Promise<{ book: string }>
}

export const dynamicParams = false

export function generateStaticParams() {
  return getBooks().map((book) => ({ book: book.slug }))
}

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const { book } = await params
  const found = getBooks().find((b) => b.slug === book)
  return found ? { title: `${found.title} · ชั้นหนังสือแชท` } : {}
}

// จัดกลุ่มตาม volume แล้วต่อด้วย bookChapter (D4 — 1 ตอนเว็บ = 1 หน้าภาพ, หลายตอนรวมเป็น 1 บทจริง)
// ไม่ hardcode จำนวนตอน/เล่ม/บท ให้ทำงานถูกแม้มีหลายเล่มในอนาคต
function groupByVolume(entries: IndexEntry[]) {
  const groups: { volume: number; volumeTitle: string; chapters: IndexEntry[] }[] = []
  for (const entry of entries) {
    let group = groups.find((g) => g.volume === entry.volume)
    if (!group) {
      group = { volume: entry.volume, volumeTitle: entry.volumeTitle, chapters: [] }
      groups.push(group)
    }
    group.chapters.push(entry)
  }
  return groups
}

function groupByBookChapter(chapters: IndexEntry[]) {
  const groups: { bookChapter: number | undefined; entries: IndexEntry[] }[] = []
  for (const entry of chapters) {
    let group = groups.find((g) => g.bookChapter === entry.bookChapter)
    if (!group) {
      group = { bookChapter: entry.bookChapter, entries: [] }
      groups.push(group)
    }
    group.entries.push(entry)
  }
  return groups
}

export default async function BookPage({ params }: BookPageProps) {
  const { book } = await params
  const info = getBooks().find((b) => b.slug === book)
  if (!info) notFound()

  const index = getIndex(book)
  const volumes = groupByVolume(index.chapters)
  const title = index.title || info.title
  const author = index.author || info.author

  const panels = volumes.map((group) => (
    <section key={group.volume} className="mb-8">
      <h2 className="mb-3 text-[15px] font-semibold text-fg2">
        เล่ม {group.volume} · {group.volumeTitle}
      </h2>
      <div className="flex flex-col gap-3">
        {groupByBookChapter(group.chapters).map((bookGroup) => (
          <div
            key={bookGroup.bookChapter ?? bookGroup.entries[0].id}
            className="overflow-hidden rounded-xl border border-line bg-card"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <span className="truncate text-[15px] font-medium text-fg">
                บทที่ {bookGroup.bookChapter ?? '?'}
              </span>
              {bookGroup.bookChapter !== undefined ? (
                <Link
                  href={`/b/${book}/chapter/${group.volume}/${bookGroup.bookChapter}`}
                  className="shrink-0 rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-white"
                >
                  อ่านทั้งบท
                </Link>
              ) : null}
            </div>
            <details className="border-t border-line">
              <summary className="cursor-pointer select-none px-4 py-2.5 text-[13px] text-fg2">
                อ่านทีละช่วง ({bookGroup.entries.length})
              </summary>
              <ul className="border-t border-line">
                {bookGroup.entries.map((chapter, i) => (
                  <li key={chapter.id} className={i > 0 ? 'border-t border-line' : ''}>
                    <Link
                      href={chapterHref(book, chapter.id)}
                      className="flex items-center justify-between gap-2 px-4 py-2.5 text-[14px] text-fg2"
                    >
                      <span className="truncate">{chapter.title}</span>
                      <ChapterCompletedMark book={book} chapterId={chapter.id} />
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
      </div>
    </section>
  ))

  return (
    <div className="flex flex-1 flex-col items-center bg-bg">
      <main className="flex w-full max-w-[640px] flex-1 flex-col items-center px-4 py-10 sm:py-16">
        <Link href="/" className="mb-6 self-start text-[14px] text-fg2">
          ← ชั้นหนังสือ
        </Link>

        <BookCover book={info} className="w-48 sm:w-56" />

        <h1 className="mt-6 text-center text-2xl font-bold text-fg">{title}</h1>
        {author ? <p className="mt-1 text-center text-[15px] text-fg2">{author}</p> : null}

        {index.chapters.length > 0 ? (
          <div className="mt-6">
            <ContinueReadingButton book={book} indexEntries={index.chapters} />
          </div>
        ) : (
          <p className="mt-6 text-center text-[15px] text-fg2">ยังไม่มีตอน</p>
        )}

        <nav className="mt-10 w-full">
          {volumes.length > 1 ? (
            <VolumeSwitcher
              volumes={volumes.map((g) => ({ volume: g.volume, label: `เล่ม ${g.volume}` }))}
              panels={panels}
            />
          ) : (
            panels
          )}
        </nav>
      </main>
    </div>
  )
}
