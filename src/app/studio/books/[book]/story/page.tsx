import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import StoryPanel from '@/components/studio/StoryPanel'

export const metadata: Metadata = { title: 'Studio · ตัวละคร & เนื้อเรื่อง' }

export default async function StudioStory({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(book)) notFound()
  return <StoryPanel book={book} />
}
