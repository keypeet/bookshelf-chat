import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import PageCompare from '@/components/studio/PageCompare'

export const metadata: Metadata = { title: 'Studio · เทียบผล OCR' }

export default async function StudioPageCompare({ params }: { params: Promise<{ book: string; volume: string; page: string }> }) {
  const { book, volume, page } = await params
  const n = Number(volume)
  const p = Number(page)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(book) || !Number.isInteger(n) || n < 1 || n > 999) notFound()
  if (!Number.isInteger(p) || p < 1 || p > 9999) notFound()
  return <PageCompare key={`${book}:${n}:${p}`} book={book} volume={n} image={p} />
}
