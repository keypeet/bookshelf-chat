import { notFound } from 'next/navigation'
import {
  getBookChapterBlocks,
  getBookChapterEntries,
  getBooks,
  getCharacters,
  getIndex,
} from '@/lib/content'
import { bookChapterId, bookChapterTitle } from '@/lib/routes'
import { resolveCharacter } from '@/lib/characters'
import type { IndexEntry } from '@/lib/types'
import ReaderShell from '@/components/reader/ReaderShell'
import type { Metadata } from 'next'

interface ReadBookPageProps {
  params: Promise<{ book: string; volume: string; bookChapter: string }>
}

// รายการ "ทั้งบท" ทุกบทที่มีจริง — ใช้ทั้ง generateStaticParams และ dropdown ของทุกหน้า
function getAllBookChapters(book: string): { volume: number; bookChapter: number }[] {
  const seen = new Set<string>()
  const result: { volume: number; bookChapter: number }[] = []
  for (const entry of getIndex(book).chapters) {
    if (entry.bookChapter === undefined) continue
    const key = `${entry.volume}-${entry.bookChapter}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ volume: entry.volume, bookChapter: entry.bookChapter })
  }
  return result
}

export const dynamicParams = false

export function generateStaticParams() {
  return getBooks().flatMap((book) =>
    getAllBookChapters(book.slug).map(({ volume, bookChapter }) => ({
      book: book.slug,
      volume: String(volume),
      bookChapter: String(bookChapter),
    }))
  )
}

export async function generateMetadata({ params }: ReadBookPageProps): Promise<Metadata> {
  const { book, volume, bookChapter } = await params
  const title = getBooks().find((b) => b.slug === book)?.title
  const multiVolume = new Set(getIndex(book).chapters.map((e) => e.volume)).size > 1
  return title
    ? { title: `${bookChapterTitle(Number(volume), Number(bookChapter), multiVolume)} · ${title}` }
    : {}
}

export default async function ReadBookPage({ params }: ReadBookPageProps) {
  const { book, volume, bookChapter } = await params
  const volumeNum = Number(volume)
  const bookChapterNum = Number(bookChapter)

  const entries = getBookChapterEntries(book, volumeNum, bookChapterNum)
  if (entries.length === 0) {
    notFound()
  }

  const blocks = getBookChapterBlocks(book, entries)
  const characters = getCharacters(book)

  const speakerKeys = new Set<string>()
  for (const block of blocks) {
    if (block.type === 'dialogue' || block.type === 'thought') {
      speakerKeys.add(block.speaker)
    }
  }
  const resolvedSpeakers = Object.fromEntries(
    Array.from(speakerKeys, (key) => [key, resolveCharacter(book, key, characters)])
  )

  // synthetic IndexEntry — id คนละ namespace กับช่วงย่อยเสมอ (กันชนกับ v1-c1 เป็นต้น)
  // ใช้เก็บ progress/position แยกจากโหมดอ่านทีละช่วง ตามที่ผู้ใช้ยืนยันว่าไม่ต้องผูกกัน
  const multiVolume = new Set(getIndex(book).chapters.map((e) => e.volume)).size > 1
  const first = entries[0]
  const currentEntry: IndexEntry = {
    ...first,
    id: bookChapterId(volumeNum, bookChapterNum),
    title: bookChapterTitle(volumeNum, bookChapterNum, multiVolume),
  }

  // dropdown ของหน้านี้สลับไปมาระหว่าง "ทั้งบท" ของบทอื่นได้ ไม่ปนกับโหมดทีละช่วง
  const allBookChapters = getAllBookChapters(book).map(({ volume: v, bookChapter: bc }) => {
    const chapterEntries = getBookChapterEntries(book, v, bc)
    return {
      ...chapterEntries[0],
      id: bookChapterId(v, bc),
      title: bookChapterTitle(v, bc, multiVolume),
    }
  })

  return (
    <main>
      <ReaderShell
        book={book}
        chapter={currentEntry}
        chapters={allBookChapters}
        blocks={blocks}
        resolvedSpeakers={resolvedSpeakers}
      />
    </main>
  )
}
