import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import type { Book, Chapter, CharactersMap, Index, IndexEntry, Shelf } from './types'

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

const SHELVES_PATH = path.join(LIBRARY_DIR, 'shelves.json')
const ALL_SHELF_ID = 'all'
const BOOK_SLUG = /^[a-z0-9-]+$/
const CHAPTER_ID = /^v\d{1,3}-c\d{1,5}$/
const READ_CONCURRENCY = 16

interface ShelfFile {
  shelves: Shelf[]
  placements: Record<string, string[]>
}

interface FileCache<T> {
  mtimeMs: number
  size: number
  value: T
}

// ดัชนีหนังสือ cache ตาม mtime+size ของ book.json — เขียนทับไฟล์ขนาดเท่าเดิมในหน่วย mtime เดียวกันอาจได้ค่าเก่าจนกระทั่งเวลาเดิน
const bookCache = new Map<string, FileCache<Book>>()
let shelfCache: FileCache<ShelfFile> | null = null

function fileStamp(filePath: string): { mtimeMs: number; size: number } | null {
  if (!fs.existsSync(filePath)) return null
  const stat = fs.statSync(filePath)
  return { mtimeMs: stat.mtimeMs, size: stat.size }
}

function allShelf(): Shelf {
  return { id: ALL_SHELF_ID, name: 'ทั้งหมด', order: 0 }
}

function assertShelfFile(data: ShelfFile): void {
  if (!data || !Array.isArray(data.shelves) || !data.placements || typeof data.placements !== 'object' || Array.isArray(data.placements)) {
    throw new Error('shelves.json must be { shelves: [], placements: {} }')
  }
  for (const shelf of data.shelves) {
    if (!shelf || typeof shelf.id !== 'string' || shelf.id === '' || typeof shelf.name !== 'string' || typeof shelf.order !== 'number') {
      throw new Error('shelves.json shelf needs id, name, and order')
    }
  }
}

// ไม่มีไฟล์ = null (ผู้เรียกใช้ชั้น "ทั้งหมด"); มีไฟล์แต่รูปแบบผิด = throw เหมือน book.json ที่ parse ไม่ผ่าน
function readShelfFile(): ShelfFile | null {
  const stamp = fileStamp(SHELVES_PATH)
  if (!stamp) {
    shelfCache = null
    return null
  }
  if (shelfCache && shelfCache.mtimeMs === stamp.mtimeMs && shelfCache.size === stamp.size) return shelfCache.value
  const value = readJson<ShelfFile>(SHELVES_PATH)
  assertShelfFile(value)
  shelfCache = { ...stamp, value }
  return value
}

// เรื่องคือโฟลเดอร์ (หรือ symlink/junction) ที่มี book.json; ไม่มี library เลย → ชั้นว่าง (build ต้องผ่านแม้ไม่มีเนื้อหา)
export function getBooks(): Book[] {
  if (!fs.existsSync(LIBRARY_DIR)) {
    bookCache.clear()
    return []
  }
  const slugs = fs
    .readdirSync(LIBRARY_DIR, { withFileTypes: true })
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && fs.existsSync(path.join(LIBRARY_DIR, entry.name, 'book.json')))
    .map((entry) => entry.name)
  const seen = new Set(slugs)
  for (const slug of bookCache.keys()) {
    if (!seen.has(slug)) bookCache.delete(slug)
  }
  return slugs
    .map((slug) => {
      const filePath = path.join(LIBRARY_DIR, slug, 'book.json')
      const stamp = fileStamp(filePath)
      const cached = bookCache.get(slug)
      if (stamp && cached && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) return { ...cached.value }
      const book = { ...readJson<Omit<Book, 'slug'>>(filePath), slug }
      if (stamp) bookCache.set(slug, { ...stamp, value: book })
      return { ...book }
    })
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

export function getShelves(): Shelf[] {
  const file = readShelfFile()
  if (!file) return [allShelf()]
  return file.shelves
    .map((shelf) => ({ id: shelf.id, name: shelf.name, order: shelf.order }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function getBooksOnShelf(shelfId: string): Book[] {
  const file = readShelfFile()
  if (!file) return shelfId === ALL_SHELF_ID ? getBooks() : []
  const slugs = new Set(
    Object.entries(file.placements)
      .filter(([, ids]) => Array.isArray(ids) && ids.includes(shelfId))
      .map(([slug]) => slug),
  )
  return getBooks().filter((book) => slugs.has(book.slug))
}

export function isBookSlug(slug: string): boolean {
  return BOOK_SLUG.test(slug)
}

export function getShelvesOfBook(slug: string): Shelf[] {
  const file = readShelfFile()
  if (!file) return [allShelf()]
  const ids = new Set(file.placements[slug] ?? [])
  return getShelves().filter((shelf) => ids.has(shelf.id))
}

// หน้าใหม่เรียกชุดนี้ — connection() ทำให้ Next อ่านคลังตอนมี request ไม่ใช่ตอน build
async function atRequest(): Promise<void> {
  const { connection } = await import('next/server')
  await connection()
}

export async function getBooksForRequest(): Promise<Book[]> {
  await atRequest()
  return getBooks()
}

export async function getShelvesForRequest(): Promise<Shelf[]> {
  await atRequest()
  return getShelves()
}

export async function getBooksOnShelfForRequest(shelfId: string): Promise<Book[]> {
  await atRequest()
  return getBooksOnShelf(shelfId)
}

export async function getShelvesOfBookForRequest(slug: string): Promise<Shelf[]> {
  await atRequest()
  return getShelvesOfBook(slug)
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

const indexCache = new Map<string, FileCache<Index>>()
const chapterCache = new Map<string, FileCache<Chapter>>()

async function fileStampAsync(filePath: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const stat = await fs.promises.stat(filePath)
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}

function chapterFile(book: string, id: string): string | null {
  if (!BOOK_SLUG.test(book) || !CHAPTER_ID.test(id)) return null
  return path.join(bookDir(book), 'chapters', `${id}.json`)
}

// อ่านสารบัญ/ตอนแบบ async พร้อม cache ตาม mtime — หน้าเดิมยังใช้ getIndex/getChapter แบบ sync
export async function readIndex(book: string): Promise<Index> {
  if (!BOOK_SLUG.test(book)) return { title: '', author: '', chapters: [] }
  const filePath = path.join(bookDir(book), 'index.json')
  const stamp = await fileStampAsync(filePath)
  if (!stamp) {
    indexCache.delete(filePath)
    return { title: '', author: '', chapters: [] }
  }
  const cached = indexCache.get(filePath)
  if (cached && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) return cached.value
  const value = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as Index
  indexCache.set(filePath, { ...stamp, value })
  return value
}

export async function readChapter(book: string, id: string): Promise<Chapter | undefined> {
  const filePath = chapterFile(book, id)
  if (!filePath) return undefined
  const stamp = await fileStampAsync(filePath)
  if (!stamp) {
    chapterCache.delete(filePath)
    return undefined
  }
  const cached = chapterCache.get(filePath)
  if (cached && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) return cached.value
  const value = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as Chapter
  chapterCache.set(filePath, { ...stamp, value })
  return value
}

export async function readChapters(book: string, ids: string[]): Promise<Array<Chapter | undefined>> {
  const result: Array<Chapter | undefined> = new Array(ids.length)
  let next = 0
  const workers = Math.min(READ_CONCURRENCY, ids.length)
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < ids.length) {
        const index = next
        next += 1
        result[index] = await readChapter(book, ids[index] ?? '')
      }
    }),
  )
  return result
}

export async function getIndexForRequest(book: string): Promise<Index> {
  await atRequest()
  return readIndex(book)
}

export async function getChaptersForRequest(book: string, ids: string[]): Promise<Array<Chapter | undefined>> {
  await atRequest()
  return readChapters(book, ids)
}
