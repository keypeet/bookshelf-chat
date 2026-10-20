// ตาม plan.md §5 — schema ของเนื้อหาและตัวละคร

export type Side = 'left' | 'right' | 'none' // 'none' → ปฏิบัติเหมือน 'left'

export interface Character {
  name: string
  short: string
  color: string
  side: Side
  initials?: string
  avatar?: string | null
  avatarSvg?: string | null
  appearance?: string
  imagePrompt?: string
  aliases?: string[]
  role?: string
  generic?: boolean
  order?: number
  firstSeen?: string // id ที่เจอครั้งแรก (v1-book3 = ทั้งบท) — สแกนตัวละครเติมให้ตอนผู้ใช้รับข้อเสนอ
  status?: 'dead' | 'left' | 'changed-side' | 'returned' // สถานะล่าสุดจากสรุปบทที่ผู้ใช้รับ
}

export type Block =
  | { type: 'narration'; text: string }
  | { type: 'scene'; text: string }
  | { type: 'gap'; note: string }
  | {
      type: 'dialogue' | 'thought'
      speaker: string
      text: string
      speakerNum?: number
      action?: string
      needsReview?: boolean
      note?: string
    }

export interface Chapter {
  id: string
  volume: number
  volumeTitle: string
  chapter: number // ลำดับตอนในเว็บ (1, 2, 3…) — ใช้เรียงและตั้ง id
  bookChapter?: number // เลขบทจริงของหนังสือ — ใช้จัดกลุ่มในสารบัญ
  title: string
  sourcePages?: number[]
  blocks: Block[]
}

export type IndexEntry = Omit<Chapter, 'blocks'>

export interface Index {
  title: string
  author: string
  chapters: IndexEntry[]
}

export type CharactersMap = Record<string, Character>

// library/<slug>/book.json — ข้อมูลการ์ดบนชั้นหนังสือ; slug มาจากชื่อโฟลเดอร์ ไม่ได้เก็บในไฟล์
export interface Book {
  slug: string
  title: string
  author?: string
  cover?: string
  language?: string
  styleNotes?: string // ลักษณะเฉพาะของเรื่องที่ prompts/*.md แนบไปกับงาน OCR/แปลง
  coverColor?: string // สีพื้นปกเมื่อไม่มีภาพปก (#rrggbb) — ตั้งจาก Studio
  aliases?: string[] // ชื่อย่อ/คำเรียกเรื่อง — สงวนไว้ให้น้องบุ๊ค ยังไม่มี UI
  volumes?: BookVolume[] // ขอบเขตบทที่คนยืนยันใน Studio; Reader ยังใช้ index.json เป็นสารบัญ
}

export interface BookChapterBoundary {
  n: number // เลขบทจริงของหนังสือ (ตรงกับ IndexEntry.bookChapter)
  title?: string
  startImage: number // เลขภาพหน้าแรกของบท
}

export interface BookVolume {
  n: number
  title?: string
  cover?: string
  chapters: BookChapterBoundary[]
  closed?: boolean // ปิดด้วย "จบเล่มที่หน้า N" แล้ว
  endImage?: number // หน้าสุดท้ายของเล่ม เมื่อ closed
}
