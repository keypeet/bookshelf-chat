import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import type { Book, Chapter, CharactersMap, Index, IndexEntry } from './types'

// เนื้อหาทุกเรื่องอยู่ใน library/<slug>/ (repo private แยก) — ตั้ง LIBRARY_DIR ชี้ที่อื่นได้ เช่น library.example
const LIBRARY_DIR = process.env.LIBRARY_DIR
  ? path.resolve(process.env.LIBRARY_DIR)
  : path.join(process.cwd(), 'library')

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

function bookDir(book: string): string {
  return path.join(LIBRARY_DIR, book)
}

// เรื่องคือโฟลเดอร์ (หรือ symlink/junction) ที่มี book.json; ไม่มี library เลย → ชั้นว่าง (build ต้องผ่านแม้ไม่มีเนื้อหา)
export function getBooks(): Book[] {
  if (!fs.existsSync(LIBRARY_DIR)) return []
  return fs
    .readdirSync(LIBRARY_DIR, { withFileTypes: true })
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && fs.existsSync(path.join(LIBRARY_DIR, entry.name, 'book.json')))
    .map((entry) => ({ ...readJson<Omit<Book, 'slug'>>(path.join(LIBRARY_DIR, entry.name, 'book.json')), slug: entry.name }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

// ไฟล์หาย → คืนค่าว่างแทนการ throw; ไฟล์มีแต่ parse ไม่ผ่านยัง throw ตามเดิม
export function getIndex(book: string): Index {
  const filePath = path.join(bookDir(book), 'index.json')
  if (!fs.existsSync(filePath)) return { title: '', author: '', chapters: [] }
  return readJson<Index>(filePath)
}

export function getIndexEntries(book: string): IndexEntry[] {
  return getIndex(book).chapters
}

export function getIndexEntry(book: string, id: string): IndexEntry | undefined {
  return getIndexEntries(book).find((entry) => entry.id === id)
}

export function getChapter(book: string, id: string): Chapter | undefined {
  const filePath = path.join(bookDir(book), 'chapters', `${id}.json`)
  if (!fs.existsSync(filePath)) return undefined
  return readJson<Chapter>(filePath)
}

export function getCharacters(book: string): CharactersMap {
  const filePath = path.join(bookDir(book), 'characters.json')
  if (!fs.existsSync(filePath)) return {}
  return readJson<CharactersMap>(filePath)
}

// รวมทุกช่วง (IndexEntry) ที่มี volume + bookChapter เดียวกัน เรียงตาม `chapter` เดิม
// ใช้สำหรับโหมด "อ่านทั้งบท" — คืน undefined ถ้าไม่มีช่วงใดตรงเงื่อนไขเลย
export function getBookChapterEntries(book: string, volume: number, bookChapter: number): IndexEntry[] {
  return getIndexEntries(book)
    .filter((entry) => entry.volume === volume && entry.bookChapter === bookChapter)
    .sort((a, b) => a.chapter - b.chapter)
}

export function getBookChapterBlocks(book: string, entries: IndexEntry[]) {
  return entries.flatMap((entry) => getChapter(book, entry.id)?.blocks ?? [])
}
