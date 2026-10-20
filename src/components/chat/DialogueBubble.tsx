import type { Side } from '@/lib/types'
import type { ResolvedAvatar } from '@/lib/characters'
import Avatar from './Avatar'

interface DialogueBubbleProps {
  text: string
  side: Side
  showHeader: boolean
  displayName: string
  color: string
  generic: boolean
  action?: string
  avatar: ResolvedAvatar
  variant?: 'dialogue' | 'thought'
}

// side 'none' ปฏิบัติเหมือน 'left' (plan.md §5)
function resolveEffectiveSide(side: Side): 'left' | 'right' {
  return side === 'right' ? 'right' : 'left'
}

export default function DialogueBubble({
  text,
  side,
  showHeader,
  displayName,
  color,
  generic,
  action,
  avatar,
  variant = 'dialogue',
}: DialogueBubbleProps) {
  const effectiveSide = resolveEffectiveSide(side)
  const isRight = effectiveSide === 'right'

  return (
    <div className={`flex items-end gap-2 ${isRight ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar avatar={avatar} size={32} />
      <div className={`flex max-w-[80%] flex-col ${isRight ? 'items-end' : 'items-start'}`}>
        {showHeader ? (
          <span
            className={`speaker-name mb-1 px-1 text-[13px] font-medium ${generic ? 'text-fg2' : ''}`}
            style={generic ? undefined : { ['--char' as string]: color }}
          >
            {displayName}
          </span>
        ) : (
          // จัดกลุ่มแล้วไม่โชว์ชื่อซ้ำ แต่ยังต้องอ่านได้ด้วย screen reader
          <span className="sr-only">{displayName}</span>
        )}
        {action ? <span className="mb-1 px-1 text-[12px] italic text-fg2">{action}</span> : null}
        <div
          className={`relative flex overflow-hidden rounded-2xl ${
            isRight ? 'flex-row-reverse' : 'flex-row'
          } ${isRight ? 'bg-bubble-me' : 'bg-card'}`}
          style={{ ['--char' as string]: color }}
        >
          <span aria-hidden className="bubble-rail w-0.75 shrink-0" />
          <p
            className={`text-[length:var(--text-body)] px-4 py-2 ${variant === 'thought' ? 'italic' : ''}`}
            style={{ lineHeight: 1.75 }}
          >
            {text}
          </p>
        </div>
      </div>
    </div>
  )
}
