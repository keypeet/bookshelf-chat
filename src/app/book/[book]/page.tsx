import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import ContinueReadingButton from '@/components/home/ContinueReadingButton'
import CoverThumb from '@/components/site/CoverThumb'
import SiteBar from '@/components/site/SiteBar'
import { resolveBookAsset } from '@/lib/book-assets'
import { coverFallbackColor } from '@/lib/cover-color'
import { getBooksForRequest, getIndexForRequest, getShelvesOfBookForRequest } from '@/lib/content'
import { bookChapterId, chapterHref } from '@/lib/routes'
import { isSiteV2 } from '@/lib/site-v2'
import type { IndexEntry } from '@/lib/types'

interface BookPageProps {
  params: Promise<{ book: string }>
}

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  if (!isSiteV2()) return {}
  const { book } = await params
  const found = (await getBooksForRequest()).find((item) => item.slug === book)
  return found ? { title: `${found.title} · ชั้นหนังสือแชท` } : {}
}

function groupChapters(entries: IndexEntry[]) {
  const volumes: { volume: number; volumeTitle: string; chapters: IndexEntry[] }[] = []
  for (const entry of entries) {
    let volume = volumes.find((item) => item.volume === entry.volume)
    if (!volume) {
      volume = { volume: entry.volume, volumeTitle: entry.volumeTitle, chapters: [] }
      volumes.push(volume)
    }
    volume.chapters.push(entry)
  }
  return volumes.map((volume) => {
    const groups: { bookChapter: number | undefined; entries: IndexEntry[] }[] = []
    for (const entry of volume.chapters) {
      let group = groups.find((item) => item.bookChapter === entry.bookChapter)
      if (!group) {
        group = { bookChapter: entry.bookChapter, entries: [] }
        groups.push(group)
      }
      group.entries.push(entry)
    }
    return { ...volume, groups }
  })
}

export default async function BookPage({ params }: BookPageProps) {
  if (!isSiteV2()) notFound()
  const { book } = await params
  const info = (await getBooksForRequest()).find((item) => item.slug === book)
  if (!info) notFound()
  const index = await getIndexForRequest(book)
  const shelves = (await getShelvesOfBookForRequest(book)).filter((item) => item.id !== 'all')
  const volumes = groupChapters(index.chapters)
  const title = index.title || info.title
  const author = index.author || info.author
  const cover = info.cover === 'cover.webp' && resolveBookAsset(book, 'cover.webp') ? `/books/${book}/cover.webp` : undefined

  return (
    <div className="min-h-dvh overflow-x-hidden bg-paper bg-[radial-gradient(900px_420px_at_70%_-10%,rgba(255,255,255,0.72),transparent_62%)] text-ink">
      <SiteBar />
      <main className="mx-auto mb-10 flex w-[min(880px,calc(100%-40px))] flex-col gap-8 sm:flex-row sm:items-end">
        <CoverThumb title={title} color={info.coverColor ?? coverFallbackColor(title)} src={cover} />
        <div>
          {author ? <p className="text-[13px] tracking-[0.08em] text-ink-soft">{author}</p> : null}
          <h1 className="mt-1 font-serif text-[clamp(40px,6vw,68px)] font-medium leading-tight">{title}</h1>
          {shelves.length > 0 ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-soft">อยู่บนชั้น</span>
              {shelves.map((shelf) => (
                <Link key={shelf.id} href={`/browse?shelf=${shelf.id}`} className="rounded-full border border-hairline px-3 py-1 text-ink no-underline">
                  {shelf.name}
                </Link>
              ))}
            </p>
          ) : null}
          <div className="mt-7">
            {index.chapters.length > 0 ? (
              <ContinueReadingButton book={book} indexEntries={index.chapters} siteV2 />
            ) : (
              <p className="text-ink-soft">ยังไม่มีบทให้อ่าน</p>
            )}
          </div>
        </div>
      </main>
      {volumes.map((volume) => (
        <section key={volume.volume} className="mx-auto mb-12 w-[min(880px,calc(100%-40px))]">
          <h2 className="font-serif text-2xl font-medium">
            เล่ม {volume.volume}
            {volume.volumeTitle ? ` · ${volume.volumeTitle}` : ''}
          </h2>
          <ol className="mt-4 list-none p-0">
            {volume.groups.map((group) =>
              group.bookChapter === undefined ? (
                group.entries.map((entry) => (
                  <li key={entry.id} className="border-b border-hairline">
                    <Link href={chapterHref(book, entry.id, true)} className="flex items-baseline justify-between gap-3 py-3 text-inherit no-underline">
                      <span>
                        <span className="text-[13px] text-ink-soft">ตอน {entry.chapter}</span>
                        <strong className="mt-0.5 block font-serif text-lg font-medium">{entry.title}</strong>
                      </span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))
              ) : (
                <li key={`${volume.volume}-${group.bookChapter}`} className="border-b border-hairline">
                  <Link
                    href={chapterHref(book, bookChapterId(volume.volume, group.bookChapter), true)}
                    className="flex items-baseline justify-between gap-3 py-3 text-inherit no-underline"
                  >
                    <span>
                      <span className="text-[13px] text-ink-soft">{group.entries.length} ช่วง</span>
                      <strong className="mt-0.5 block font-serif text-lg font-medium">บทที่ {group.bookChapter}</strong>
                    </span>
                    <span className="shrink-0 text-sm text-ink-soft">อ่านทั้งบท →</span>
                  </Link>
                  <details className="pb-3">
                    <summary className="cursor-pointer select-none text-[13px] text-ink-soft">อ่านทีละช่วง ({group.entries.length})</summary>
                    <ul className="mt-2 list-none p-0">
                      {group.entries.map((entry) => (
                        <li key={entry.id}>
                          <Link href={chapterHref(book, entry.id, true)} className="block py-1.5 pl-4 text-[15px] text-ink-soft no-underline">
                            {entry.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ),
            )}
          </ol>
        </section>
      ))}
      <p className="mx-auto mb-[72px] w-[min(880px,calc(100%-40px))]">
        <Link href={`/book/${book}/characters`} className="font-semibold text-ink no-underline">
          ตัวละคร
        </Link>
      </p>
    </div>
  )
}
