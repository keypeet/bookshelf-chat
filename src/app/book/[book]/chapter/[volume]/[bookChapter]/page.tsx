import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import ReaderShell from '@/components/reader/ReaderShell'
import { resolveCharacter } from '@/lib/characters'
import { getBooksForRequest, getChaptersForRequest, getCharacters, getIndexForRequest } from '@/lib/content'
import { bookChapterId, bookChapterTitle } from '@/lib/routes'
import { isSiteV2 } from '@/lib/site-v2'
import type { IndexEntry } from '@/lib/types'

interface WholeChapterPageProps {
  params: Promise<{ book: string; volume: string; bookChapter: string }>
}

const POSITIVE_INT = /^[1-9]\d{0,3}$/

// ทุกบทที่มีจริงของเรื่อง เรียงตามสารบัญ — ใช้ทำ dropdown และปุ่มบทถัดไป
function wholeChapters(entries: IndexEntry[]): IndexEntry[][] {
  const groups = new Map<string, IndexEntry[]>()
  for (const entry of entries) {
    if (entry.bookChapter === undefined) continue
    const key = `${entry.volume}-${entry.bookChapter}`
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }
  return Array.from(groups.values(), (group) => group.sort((a, b) => a.chapter - b.chapter))
}

export async function generateMetadata({ params }: WholeChapterPageProps): Promise<Metadata> {
  if (!isSiteV2()) return {}
  const { book, volume, bookChapter } = await params
  const title = (await getBooksForRequest()).find((item) => item.slug === book)?.title
  if (!title || !POSITIVE_INT.test(volume) || !POSITIVE_INT.test(bookChapter)) return {}
  const index = await getIndexForRequest(book)
  const multiVolume = new Set(index.chapters.map((entry) => entry.volume)).size > 1
  return { title: `${bookChapterTitle(Number(volume), Number(bookChapter), multiVolume)} · ${title}` }
}

// ย้าย logic จาก /b/[book]/chapter/... — อ่านตอน request แทนตอน build
export default async function WholeChapterPage({ params }: WholeChapterPageProps) {
  if (!isSiteV2()) notFound()
  const { book, volume, bookChapter } = await params
  if (!POSITIVE_INT.test(volume) || !POSITIVE_INT.test(bookChapter)) notFound()
  if (!(await getBooksForRequest()).some((item) => item.slug === book)) notFound()

  const volumeNum = Number(volume)
  const bookChapterNum = Number(bookChapter)
  const index = await getIndexForRequest(book)
  const groups = wholeChapters(index.chapters)
  const entries = groups.find((group) => group[0].volume === volumeNum && group[0].bookChapter === bookChapterNum)
  if (!entries) notFound()

  const chapters = await getChaptersForRequest(
    book,
    entries.map((entry) => entry.id),
  )
  const blocks = chapters.flatMap((chapter) => chapter?.blocks ?? [])
  const characters = getCharacters(book)

  const speakerKeys = new Set<string>()
  for (const block of blocks) {
    if (block.type === 'dialogue' || block.type === 'thought') speakerKeys.add(block.speaker)
  }
  const resolvedSpeakers = Object.fromEntries(
    Array.from(speakerKeys, (key) => [key, resolveCharacter(book, key, characters)]),
  )

  // id สังเคราะห์ v{n}-book{m} เหมือนหน้าเดิม — progress/position ของโหมดทั้งบทจึงต่อกันได้ทั้งสอง route
  const multiVolume = new Set(index.chapters.map((entry) => entry.volume)).size > 1
  const toEntry = (group: IndexEntry[]): IndexEntry => {
    const first = group[0]
    const v = first.volume
    const bc = first.bookChapter ?? 0
    return { ...first, id: bookChapterId(v, bc), title: bookChapterTitle(v, bc, multiVolume) }
  }

  return (
    <main>
      <ReaderShell
        book={book}
        chapter={toEntry(entries)}
        chapters={groups.map(toEntry)}
        blocks={blocks}
        resolvedSpeakers={resolvedSpeakers}
        siteV2
      />
    </main>
  )
}
