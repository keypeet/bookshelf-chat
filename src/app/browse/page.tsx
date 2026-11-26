import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import CoverThumb from '@/components/site/CoverThumb'
import SiteBar from '@/components/site/SiteBar'
import { resolveBookAsset } from '@/lib/book-assets'
import { coverFallbackColor } from '@/lib/cover-color'
import { getBooksForRequest, getBooksOnShelf, getShelvesForRequest, getShelvesOfBook } from '@/lib/content'
import { BROWSE_PAGE_SIZE, pageSlice, parsePage } from '@/lib/paging'
import { isSiteV2 } from '@/lib/site-v2'
import type { Book } from '@/lib/types'

export const metadata: Metadata = { title: 'สารบัญ · ชั้นหนังสือแชท' }

interface BrowseProps {
  searchParams: Promise<{ q?: string; shelf?: string; page?: string }>
}

function browseHref(query: string, shelfId: string, page: number): string {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (shelfId) params.set('shelf', shelfId)
  if (page > 1) params.set('page', String(page))
  const search = params.toString()
  return search ? `/browse?${search}` : '/browse'
}

function matches(book: Book, needle: string): boolean {
  if (!needle) return true
  const title = book.title.toLocaleLowerCase('th')
  const author = (book.author ?? '').toLocaleLowerCase('th')
  return title.includes(needle) || author.includes(needle)
}

function coverSrc(book: Book): string | undefined {
  if (book.cover !== 'cover.webp') return undefined
  return resolveBookAsset(book.slug, 'cover.webp') ? `/books/${book.slug}/cover.webp` : undefined
}

export default async function BrowsePage({ searchParams }: BrowseProps) {
  if (!isSiteV2()) notFound()
  const params = await searchParams
  const query = (params.q ?? '').trim()
  const needle = query.toLocaleLowerCase('th')
  const books = await getBooksForRequest()
  const shelves = (await getShelvesForRequest()).filter((item) => item.id !== 'all')
  const shelf = params.shelf ? shelves.find((item) => item.id === params.shelf) : undefined
  const shelfId = shelf?.id ?? ''
  const pool = shelf ? getBooksOnShelf(shelf.id) : books
  const results = pool.filter((book) => matches(book, needle))
  const paged = pageSlice(results, parsePage(params.page), BROWSE_PAGE_SIZE)

  return (
    <div className="min-h-dvh overflow-x-hidden bg-paper bg-[radial-gradient(900px_420px_at_70%_-10%,rgba(255,255,255,0.72),transparent_62%)] text-ink">
      <SiteBar />
      <main className="mx-auto mb-[72px] w-[min(1040px,calc(100%-40px))]">
        <p className="mt-2 text-[13px] tracking-[0.08em] text-ink-soft">สารบัญ</p>
        <h1 className="mt-1 font-serif text-[clamp(28px,4vw,36px)] font-medium leading-snug">
          {shelf ? `ชั้น${shelf.name}` : 'ทุกเล่มในห้องสมุด'}
        </h1>

        <form action="/browse" method="get" className="mt-[18px] mb-2.5 flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="ค้นชื่อเรื่องหรือผู้เขียน"
            aria-label="ค้นหนังสือ"
            className="min-h-[42px] min-w-0 flex-[1_1_240px] rounded-[10px] border border-hairline bg-paper-light px-3 py-2 text-[15px] text-ink"
          />
          <select
            name="shelf"
            aria-label="ชั้น"
            defaultValue={shelfId}
            className="min-h-[42px] max-w-full rounded-[10px] border border-hairline bg-paper-light px-3 py-2 text-[15px] text-ink"
          >
            <option value="">ทุกชั้น ({books.length.toLocaleString('th-TH')})</option>
            {shelves.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({getBooksOnShelf(item.id).length.toLocaleString('th-TH')})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center rounded-full border border-ink px-4 text-sm font-semibold text-ink"
          >
            ค้น
          </button>
        </form>

        <p className="mb-3 text-[13px] text-ink-soft">พบ {results.length.toLocaleString('th-TH')} เล่ม</p>
        {results.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-hairline px-4 py-8 text-center text-ink-soft">
            ไม่พบเล่มที่ตรงกับคำค้น ลองคำอื่นหรือเลือกทุกชั้น
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-[22px] p-0">
            {paged.items.map((book) => {
              const placed = getShelvesOfBook(book.slug)
              const names = placed.filter((item) => item.id !== 'all').map((item) => item.name)
              const shelfLabel = names.length > 0 ? names.join(' · ') : placed.some((item) => item.id === 'all') ? 'ทั้งหมด' : 'ยังไม่อยู่บนชั้น'
              return (
                <li key={book.slug}>
                  <Link href={`/book/${book.slug}`} className="group flex flex-col gap-0.5 text-inherit no-underline">
                    <CoverThumb
                      title={book.title}
                      color={book.coverColor ?? coverFallbackColor(book.title)}
                      src={coverSrc(book)}
                      size="fill"
                      className="mb-2 rounded-[3px_8px_8px_3px] shadow-[4px_8px_16px_rgba(37,35,31,0.14)] motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:-translate-y-[3px]"
                    />
                    <strong className="text-[15px] leading-snug">{book.title}</strong>
                    {book.author ? <span className="text-[13px] text-ink-soft">{book.author}</span> : null}
                    <span className="truncate text-[13px] text-ink-soft">{shelfLabel}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        {paged.pages > 1 ? (
          <nav className="mt-5 flex items-center justify-center gap-4 text-sm" aria-label="แบ่งหน้า">
            {paged.page > 1 ? (
              <Link href={browseHref(query, shelfId, paged.page - 1)} className="font-semibold text-ink no-underline">
                ก่อนหน้า
              </Link>
            ) : (
              <span className="text-ink-soft">ก่อนหน้า</span>
            )}
            <span>
              หน้า {paged.page.toLocaleString('th-TH')} / {paged.pages.toLocaleString('th-TH')}
            </span>
            {paged.page < paged.pages ? (
              <Link href={browseHref(query, shelfId, paged.page + 1)} className="font-semibold text-ink no-underline">
                ถัดไป
              </Link>
            ) : (
              <span className="text-ink-soft">ถัดไป</span>
            )}
          </nav>
        ) : null}
      </main>
    </div>
  )
}
