import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import VolumeWorkspace from '@/components/studio/VolumeWorkspace'

export const metadata: Metadata = { title: 'Studio · เล่ม' }

export default async function StudioVolumePage({ params }: { params: Promise<{ book: string; volume: string }> }) {
  const { book, volume } = await params
  const n = Number(volume)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(book) || !Number.isInteger(n) || n < 1 || n > 999) notFound()
  return <VolumeWorkspace book={book} volume={n} />
}
