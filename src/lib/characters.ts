import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import type { Character, CharactersMap } from './types'

// avatar ของแต่ละเรื่องถูกคัดลอกจาก library/<slug>/assets/ มาไว้ที่นี่ตอน predev/prebuild
const BOOKS_PUBLIC_DIR = path.join(process.cwd(), 'public', 'books')

export type ResolvedAvatar =
  | { kind: 'image'; src: string }
  | { kind: 'initials'; initials: string; color: string }
  | { kind: 'none' } // generic — ไม่แสดงภาพเลย แต่กันที่ไว้
  | { kind: 'unknown'; key: string } // key ไม่พบใน characters.json — วงกลมเทา

export interface ResolvedCharacter {
  key: string
  character: Character
  avatar: ResolvedAvatar
}

/**
 * หา character จาก key ใน characters.json ตาม §4.9
 * - key ไม่พบ → คืนตัวละคร "ไม่ระบุ" สีเทา + โชว์ key เป็นชื่อ + console.warn (ห้าม crash)
 */
export function resolveCharacter(
  book: string,
  key: string,
  characters: CharactersMap
): ResolvedCharacter {
  const character = characters[key]

  if (!character) {
    console.warn(`[characters] ไม่พบตัวละครสำหรับ key "${key}" ใน characters.json`)
    return {
      key,
      character: {
        name: key,
        short: key,
        color: '#78716c', // --fg2 เทา
        side: 'left',
      },
      avatar: { kind: 'unknown', key },
    }
  }

  return {
    key,
    character,
    avatar: resolveAvatar(book, key, character),
  }
}

function resolveAvatar(book: string, key: string, character: Character): ResolvedAvatar {
  // generic ไม่แสดงภาพเลย แม้จะมี avatar/avatarSvg ติดมา (เมิน — ตาม §4.9/edge case #ตัวประกอบมี avatar)
  if (character.generic) {
    return { kind: 'none' }
  }

  if (character.avatar) {
    const filePath = path.join(BOOKS_PUBLIC_DIR, book, 'avatars', `${key}.jpg`)
    if (fs.existsSync(filePath)) {
      return { kind: 'image', src: `/books/${book}/avatars/${key}.jpg` }
    }
  }

  if (character.avatarSvg) {
    const filePath = path.join(BOOKS_PUBLIC_DIR, book, 'avatars', 'svg', `${key}.svg`)
    if (fs.existsSync(filePath)) {
      return { kind: 'image', src: `/books/${book}/avatars/svg/${key}.svg` }
    }
  }

  const initials = character.initials || character.short.slice(0, 1)
  return { kind: 'initials', initials, color: character.color }
}
