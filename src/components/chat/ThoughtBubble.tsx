import DialogueBubble from './DialogueBubble'
import type { Side } from '@/lib/types'
import type { ResolvedAvatar } from '@/lib/characters'

interface ThoughtBubbleProps {
  text: string
  side: Side
  showHeader: boolean
  displayName: string
  color: string
  generic: boolean
  action?: string
  avatar: ResolvedAvatar
}

// ความคิดในใจ — ใช้โครง bubble เดียวกับบทพูด ต่างแค่ตัวเอียง (variant='thought')
export default function ThoughtBubble(props: ThoughtBubbleProps) {
  return <DialogueBubble {...props} variant="thought" />
}
