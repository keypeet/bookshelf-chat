import { notFound } from 'next/navigation'
import { getBooks, getChapter, getCharacters, getIndexEntries } from '@/lib/content'
import { resolveCharacter } from '@/lib/characters'
import ReaderShell from '@/components/reader/ReaderShell'
import type { Metadata } from 'next'

interface ReadPageProps {
  params: Promise<{ book: string; id: string }>
}

export const dynamicParams = false

export function generateStaticParams() {
  return getBooks().flatMap((book) =>
    getIndexEntries(book.slug).map((entry) => ({ book: book.slug, id: entry.id }))
  )
}

export async function generateMetadata({ params }: ReadPageProps): Promise<Metadata> {
  const { book, id } = await params
  const title = getBooks().find((b) => b.slug === book)?.title
  const entry = getIndexEntries(book).find((e) => e.id === id)
  return entry && title ? { title: `${entry.title} · ${title}` } : {}
}

export default async function ReadPage({ params }: ReadPageProps) {
  const { book, id } = await params
  const chapter = getChapter(book, id)

  if (!chapter) {
    notFound()
  }

  const characters = getCharacters(book)
  const indexEntries = getIndexEntries(book)
  // ไฟล์ตอนค้างที่ไม่อยู่ใน index.json → ไม่มีตำแหน่งในสารบัญ ถือว่าไม่มีตอนนี้
  const currentEntry = indexEntries.find((entry) => entry.id === id)
  if (!currentEntry) notFound()

  // resolveCharacter ต้องรันที่ server เท่านั้น (characters.ts ใช้ fs.existsSync, import 'server-only')
  // ReaderShell เป็น client component (ควบคุม revealCount ของโหมดแตะไล่) เลย resolve ล่วงหน้าที่นี่
  // แล้วส่งเป็น plain object ให้ ChapterBody ใช้ตรงๆ แทนที่จะให้ ChapterBody เรียก resolveCharacter เอง
  const speakerKeys = new Set<string>()
  for (const block of chapter.blocks) {
    if (block.type === 'dialogue' || block.type === 'thought') {
      speakerKeys.add(block.speaker)
    }
  }
  const resolvedSpeakers = Object.fromEntries(
    Array.from(speakerKeys, (key) => [key, resolveCharacter(book, key, characters)])
  )

  return (
    <main>
      <ReaderShell
        book={book}
        chapter={currentEntry}
        chapters={indexEntries}
        blocks={chapter.blocks}
        resolvedSpeakers={resolvedSpeakers}
      />
    </main>
  )
}
