import type { Block } from '@/lib/types'
import type { ResolvedCharacter } from '@/lib/characters'
import NarrationBlock from './NarrationBlock'
import SceneDivider from './SceneDivider'
import GapNotice from './GapNotice'
import DialogueBubble from './DialogueBubble'
import ThoughtBubble from './ThoughtBubble'

interface ChatBlockProps {
  block: Block
  index: number
  showHeader: boolean
  resolvedSpeakers?: Record<string, ResolvedCharacter>
}

// ชื่อที่โชว์เหนือ bubble: generic ต่อท้ายด้วย speakerNum ถ้ามี, ตัวละครจริงเมิน speakerNum (plan.md §5)
function getDisplayName(
  resolved: ResolvedCharacter,
  speakerNum: number | undefined
): string {
  const isGeneric = !!resolved.character.generic
  if (isGeneric && speakerNum !== undefined) {
    return `${resolved.character.short} ${speakerNum}`
  }
  if (!isGeneric && speakerNum !== undefined) {
    console.warn(
      `[ChatBlock] speakerNum ถูกใส่มาให้ตัวละครที่ไม่ใช่ generic (${resolved.key}) — เมิน`
    )
  }
  return resolved.character.short
}

export default function ChatBlock({ block, index, showHeader, resolvedSpeakers }: ChatBlockProps) {
  switch (block.type) {
    case 'narration':
      return (
        <div data-block-index={index}>
          <NarrationBlock text={block.text} />
        </div>
      )

    case 'scene':
      return (
        <div data-block-index={index}>
          <SceneDivider text={block.text} />
        </div>
      )

    case 'gap':
      return (
        <div data-block-index={index}>
          <GapNotice note={block.note} />
        </div>
      )

    case 'dialogue':
    case 'thought': {
      const resolved = resolvedSpeakers?.[block.speaker]
      if (!resolved) return null
      const displayName = getDisplayName(resolved, block.speakerNum)
      const generic = !!resolved.character.generic
      const Bubble = block.type === 'dialogue' ? DialogueBubble : ThoughtBubble

      return (
        <div data-block-index={index}>
          <Bubble
            text={block.text}
            side={resolved.character.side}
            showHeader={showHeader}
            displayName={displayName}
            color={resolved.character.color}
            generic={generic}
            action={block.action}
            avatar={resolved.avatar}
          />
        </div>
      )
    }

    default:
      // Block เป็น union แต่ runtime ต้องรับ type แปลกได้ — ห้ามหน้าขาว (plan.md §5)
      console.warn(`[ChatBlock] ไม่รู้จัก block type: ${JSON.stringify(block)}`)
      return null
  }
}
