#!/usr/bin/env node
// สคริปต์ตรวจเนื้อหา (node ล้วน ไม่เพิ่ม dependency) — plan.md §6 งาน 2.11
import fs from 'node:fs'
import path from 'node:path'
import { coverage } from './coverage.mjs'

// เนื้อหาทุกเรื่องอยู่ใน library/<slug>/ — ตั้ง LIBRARY_DIR ชี้ที่อื่นได้ (ต้องตรงกับ src/lib/content.ts)
const LIBRARY_DIR = process.env.LIBRARY_DIR
  ? path.resolve(process.env.LIBRARY_DIR)
  : path.join(process.cwd(), 'library')
const KNOWN_TYPES = new Set(['narration', 'scene', 'gap', 'dialogue', 'thought'])

let hasError = false
const rows = [] // { book, chapter, blocks, speakers, unknownSpeakers, badSpeakerNum, unknownTypes, needsReview }
const draftRows = [] // drafts/ ยังไม่ publish — รายงานธงอย่างเดียว ไม่ทำให้ fail

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw)
}

function fail(message) {
  hasError = true
  console.error(`✗ ${message}`)
}

function warn(message) {
  console.warn(`! ${message}`)
}

// เรื่องคือโฟลเดอร์ที่มี book.json; ไม่มีเรื่องเลย = ผ่าน (library ว่างหรือยังไม่ clone)
const books = fs.existsSync(LIBRARY_DIR)
  ? fs
      .readdirSync(LIBRARY_DIR, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && fs.existsSync(path.join(LIBRARY_DIR, d.name, 'book.json')))
      .map((d) => d.name)
      .sort()
  : []

if (books.length === 0) {
  console.log(`check-content: ไม่มีหนังสือใน ${LIBRARY_DIR} — ผ่าน`)
  process.exit(0)
}

function checkBook(book) {
  const bookDir = path.join(LIBRARY_DIR, book)

  // 1. characters.json ต้อง parse ผ่าน
  let characters = {}
  const charactersPath = path.join(bookDir, 'characters.json')
  try {
    characters = readJson(charactersPath)
  } catch (err) {
    fail(`${book}: อ่าน characters.json ไม่สำเร็จ: ${err.message}`)
    return
  }

  // 2. index.json ต้อง parse ผ่าน
  let index = { chapters: [] }
  const indexPath = path.join(bookDir, 'index.json')
  try {
    index = readJson(indexPath)
  } catch (err) {
    fail(`${book}: อ่าน index.json ไม่สำเร็จ: ${err.message}`)
    return
  }

  for (const entry of index.chapters) {
    const chapterPath = path.join(bookDir, 'chapters', `${entry.id}.json`)
    const row = {
      book,
      chapter: entry.id,
      blocks: 0,
      unknownSpeakers: 0,
      badSpeakerNum: 0,
      unknownTypes: 0,
      needsReview: 0,
    }

    if (!fs.existsSync(chapterPath)) {
      fail(`${entry.id}: ไม่พบไฟล์ ${chapterPath}`)
      rows.push(row)
      continue
    }

    let chapter
    try {
      chapter = readJson(chapterPath)
    } catch (err) {
      fail(`${entry.id}: JSON parse ไม่ผ่าน — ${err.message}`)
      rows.push(row)
      continue
    }

    const blocks = chapter.blocks ?? []
    row.blocks = blocks.length

    for (const [i, block] of blocks.entries()) {
      const where = `${entry.id}[${i}]`

      if (!KNOWN_TYPES.has(block.type)) {
        warn(`${where}: type ไม่รู้จัก "${block.type}"`)
        row.unknownTypes++
        continue
      }

      if (block.type === 'dialogue' || block.type === 'thought') {
        const character = characters[block.speaker]
        if (!character) {
          fail(`${where}: speaker "${block.speaker}" ไม่มี key ใน characters.json`)
          row.unknownSpeakers++
        } else if (block.speakerNum !== undefined && !character.generic) {
          warn(`${where}: speakerNum ใส่มาให้ "${block.speaker}" ซึ่งไม่ใช่ generic — ควรเมิน`)
          row.badSpeakerNum++
        }
        if (block.needsReview) row.needsReview++
      }
    }

    rows.push(row)
  }

  checkDrafts(book, bookDir, characters)
}

// drafts/<id>.json (ผลแปลงก่อน publish) — ธงเป็นงานของคนตรวจใน Studio จึงเตือนแต่ไม่ fail
function checkDrafts(book, bookDir, characters) {
  const draftsDir = path.join(bookDir, 'drafts')
  if (!fs.existsSync(draftsDir)) return
  for (const name of fs.readdirSync(draftsDir).filter((n) => n.endsWith('.json')).sort()) {
    const row = { book, draft: name.replace(/\.json$/, ''), blocks: 0, unknownSpeakers: 0, unknownTypes: 0, needsReview: 0 }
    let draft
    try {
      draft = readJson(path.join(draftsDir, name))
    } catch (err) {
      warn(`${book}/drafts/${name}: JSON parse ไม่ผ่าน — ${err.message}`)
      draftRows.push(row)
      continue
    }
    const blocks = draft.blocks ?? []
    row.blocks = blocks.length
    // coverage ของหน้านั้นเอง (ค่าอ้างอิง — Studio ตรวจทั้งบทตอน publish เพราะบล็อกคร่อมหน้านับเป็นของหน้าที่เริ่ม)
    const images = draft.draft?.images ?? []
    const raws = images
      .map((n) => path.join(bookDir, 'raw', `v${draft.volume}`, `img-${String(n).padStart(3, '0')}.txt`))
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p, 'utf-8')) // หัว <!-- image/book-page/source --> ถูกตัดใน coverage อยู่แล้ว
    row.coverage = raws.length ? coverage(blocks, raws).ratio : null
    for (const block of blocks) {
      if (!KNOWN_TYPES.has(block.type)) row.unknownTypes++
      else if ((block.type === 'dialogue' || block.type === 'thought') && !characters[block.speaker]) row.unknownSpeakers++
      if (block.needsReview) row.needsReview++
    }
    draftRows.push(row)
  }
}

for (const book of books) checkBook(book)

// สรุปผลเป็นตาราง
console.log('\n=== check-content: สรุปผล ===\n')
console.table(
  rows.map((r) => ({
    เรื่อง: r.book,
    ตอน: r.chapter,
    blocks: r.blocks,
    'speaker ไม่มี key': r.unknownSpeakers,
    'speakerNum ผิดที่': r.badSpeakerNum,
    'type ไม่รู้จัก': r.unknownTypes,
    needsReview: r.needsReview,
  }))
)

if (draftRows.length > 0) {
  console.log('\n=== drafts (ยังไม่ publish — ไม่นับเป็นข้อผิดพลาด) ===\n')
  console.table(
    draftRows.map((r) => ({
      เรื่อง: r.book,
      draft: r.draft,
      blocks: r.blocks,
      'speaker ไม่มี key': r.unknownSpeakers,
      'type ไม่รู้จัก': r.unknownTypes,
      needsReview: r.needsReview,
      coverage: r.coverage ?? '-',
    }))
  )
}

const totalNeedsReview = rows.reduce((sum, r) => sum + r.needsReview, 0)
const totalUnknownSpeakers = rows.reduce((sum, r) => sum + r.unknownSpeakers, 0)
console.log(`รวม needsReview ค้างอยู่: ${totalNeedsReview}`)
console.log(`รวม speaker ที่ไม่มี key: ${totalUnknownSpeakers}`)

if (hasError) {
  console.error('\ncheck-content: พบข้อผิดพลาด (ดู ✗ ด้านบน)')
  process.exit(1)
}

console.log('\ncheck-content: ผ่าน (ไม่มีข้อผิดพลาดร้ายแรง)')
