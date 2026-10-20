import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DraftReview from '@/components/studio/DraftReview'

export const metadata: Metadata = { title: 'Studio · ตรวจแชทก่อน publish' }

export default async function StudioDraftReview({ params }: { params: Promise<{ book: string; volume: string; id: string }> }) {
  const { book, volume, id } = await params
  const n = Number(volume)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(book) || !Number.isInteger(n) || n < 1 || n > 999) notFound()
  if (!/^v\d{1,3}-c\d{1,5}$/.test(id)) notFound()
  return <DraftReview key={`${book}:${id}`} book={book} volume={n} id={id} />
}
