import type { Block } from '@/lib/types'
import type { ResolvedCharacter } from '@/lib/characters'
import ChatBlock from './ChatBlock'

interface ChapterBodyProps {
  blocks: Block[]
  // resolve character ต้องทำที่ server ก่อน (characters.ts ใช้ fs, import 'server-only')
  // ส่งเป็น plain object key→ResolvedCharacter (serializable ข้าม RSC boundary) แทน function
  // เพราะ ReaderShell (client, Phase 4) import ChapterBody ตรงๆ เพื่อคุม revealCount —
  // ถ้าเรียก resolveCharacter ในนี้ fs จะหลุดเข้า client bundle, ถ้าส่ง function ก็ serialize ไม่ได้
  resolvedSpeakers: Record<string, ResolvedCharacter>
  // โหมดแตะไล่ (plan.md §4.5/F3.5) — จำนวน block ที่ "เผยแล้ว" นับจาก 0
  // undefined = แสดงทั้งหมด (โหมด scroll ปกติ, พฤติกรรมเดิมไม่เปลี่ยน)
  revealCount?: number
}

// ตัดกลุ่ม bubble เมื่อมี narration/scene/gap คั่น (plan.md §4.10)
function isGroupBreaker(block: Block): boolean {
  return block.type === 'narration' || block.type === 'scene' || block.type === 'gap'
}

// showHeader = false เมื่อครบ 3 ข้อเทียบกับ block ก่อนหน้าติดกันทันที (plan.md §4.10):
// 1) type เดียวกัน  2) speaker เดียวกัน  3) speakerNum เดียวกัน (รวม undefined ทั้งคู่)
// ต้องคำนวณจาก array เต็มเสมอ (ไม่ใช่จาก array ที่ slice แล้ว) เผื่อโหมดแตะไล่ในอนาคต
function computeShowHeaders(blocks: Block[]): boolean[] {
  const result: boolean[] = new Array(blocks.length).fill(true)

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type !== 'dialogue' && block.type !== 'thought') continue

    const prev = blocks[i - 1]
    if (!prev || isGroupBreaker(prev)) {
      result[i] = true
      continue
    }
    if (prev.type !== block.type) {
      result[i] = true
      continue
    }
    if (prev.type !== 'dialogue' && prev.type !== 'thought') {
      result[i] = true
      continue
    }

    const sameSpeaker = prev.speaker === block.speaker
    const sameSpeakerNum = prev.speakerNum === block.speakerNum // undefined === undefined → true
    result[i] = !(sameSpeaker && sameSpeakerNum)
  }

  return result
}

export default function ChapterBody({ blocks, resolvedSpeakers, revealCount }: ChapterBodyProps) {
  if (blocks.length === 0) {
    return <p className="py-12 text-center text-fg2">ตอนนี้ยังไม่มีเนื้อหา</p>
  }

  // showHeader ต้องคำนวณจาก array เต็มเสมอ (plan.md §4.10) แม้โหมดแตะยังไม่เผยครบ
  const showHeaders = computeShowHeaders(blocks)
  // sentinel ความคืบหน้า 80% ของตอน (plan.md §4.3) — แทรกหลัง block ลำดับที่ ceil(len*0.8)-1
  const progressSentinelAfterIndex = Math.ceil(blocks.length * 0.8) - 1

  // โหมดแตะไล่: block ที่ยังไม่ถึงคิว ไม่ render เข้า DOM เลย (revealCount === undefined = แสดงหมด)
  const isRevealed = (i: number) => revealCount === undefined || i < revealCount
  const isLatestRevealed = (i: number) => revealCount !== undefined && i === revealCount - 1

  return (
    <div className="flex flex-col">
      {blocks.map((block, i) => {
        if (!isRevealed(i)) return null

        const isDialogueLike = block.type === 'dialogue' || block.type === 'thought'
        const prevIsDialogueLike =
          i > 0 && (blocks[i - 1].type === 'dialogue' || blocks[i - 1].type === 'thought')

        // ระยะห่าง: 16px คนละคน / 4px คนเดียวกัน (bubble) · 24px รอบบรรยาย / 12px ระหว่างบรรยายติดกัน
        let spacingClass = ''
        if (i > 0) {
          if (isDialogueLike && prevIsDialogueLike) {
            spacingClass = showHeaders[i] ? 'mt-4' : 'mt-1'
          } else if (isDialogueLike || prevIsDialogueLike) {
            spacingClass = 'mt-6'
          } else {
            // narration/scene/gap ติดกัน
            spacingClass = block.type === 'narration' && blocks[i - 1].type === 'narration' ? 'mt-3' : 'mt-6'
          }
        }

        return (
          <div
            key={i}
            className={`${spacingClass} ${isLatestRevealed(i) ? 'animate-tap-reveal' : ''}`}
          >
            <ChatBlock
              block={block}
              index={i}
              showHeader={showHeaders[i]}
              resolvedSpeakers={resolvedSpeakers}
            />
            {i === progressSentinelAfterIndex && isRevealed(i) ? (
              <div data-progress-sentinel aria-hidden />
            ) : null}
          </div>
        )
      })}
      {/* sentinel ท้ายตอน — ใช้ล็อก chrome ให้โชว์ค้างเมื่ออ่านจบ (Phase 3)
          โหมดแตะยังไม่เผยครบ ไม่ควร render sentinel นี้ ไม่งั้น IntersectionObserver ของ ReaderShell
          จะเห็น element ว่างๆ intersect ทันทีทั้งที่ยังไม่จบตอนจริง */}
      {revealCount === undefined || revealCount >= blocks.length ? (
        <div data-end-sentinel aria-hidden />
      ) : null}
    </div>
  )
}
