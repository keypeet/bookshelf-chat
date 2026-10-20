import type { Metadata } from 'next'
import StudioHome from '@/components/studio/StudioHome'

export const metadata: Metadata = { title: 'Studio · ชั้นหนังสือแชท' }

export default function StudioPage() {
  return <StudioHome />
}
