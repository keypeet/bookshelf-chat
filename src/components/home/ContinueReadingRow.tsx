'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getAllProgress } from '@/lib/storage'
import { bookHref, chapterHref } from '@/lib/routes'

interface ContinueReadingRowProps {
  // ชื่อเรื่องและชื่อตอนทุกเรื่องบนชั้น (รวม id อ่านทั้งบท) จาก server — ไม่ import content.ts ใน client
  books: { slug: string; title: string; chapterTitles: Record<string, string> }[]
}

interface RowItem {
  slug: string
  title: string
  href: string
  label: string
}

// แถว "อ่านต่อ" บนชั้น — เรื่องที่มีประวัติ เรียงอ่านล่าสุดก่อน; ไม่มีประวัติ → ไม่แสดงแถว
// render ว่างก่อน mount เสมอ (§4.6 ข้อ 4) กัน hydration mismatch
export default function ContinueReadingRow({ books }: ContinueReadingRowProps) {
  const [items, setItems] = useState<RowItem[]>([])

  useEffect(() => {
    const progress = getAllProgress()
    const next = books
      .filter((book) => progress[book.slug]?.lastChapterId)
      .sort((a, b) => progress[b.slug].lastReadAt - progress[a.slug].lastReadAt)
      .map((book) => {
        const id = progress[book.slug].lastChapterId!
        const chapterTitle = book.chapterTitles[id]
        // ตอนที่บันทึกไว้ไม่มีแล้ว → ไปหน้าเรื่องแทน
        return chapterTitle
          ? { slug: book.slug, title: book.title, href: chapterHref(book.slug, id), label: chapterTitle }
          : { slug: book.slug, title: book.title, href: bookHref(book.slug), label: 'ดูสารบัญ' }
      })
    setItems(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (items.length === 0) return null

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-[15px] font-semibold text-fg2">อ่านต่อ</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.slug}>
            <Link
              href={item.href}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-fg">{item.title}</span>
                <span className="block truncate text-[13px] text-fg2">{item.label}</span>
              </span>
              <span aria-hidden className="shrink-0 text-accent">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
