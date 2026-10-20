#!/usr/bin/env node
// คัดลอกปก/avatar ของทุกเรื่อง library/<slug>/assets/ → public/books/<slug>/ (รันใน predev/prebuild)
// ภาพของเรื่องไม่อยู่ใน repo โค้ด — public/books/ ถูก ignore และสร้างใหม่ทุกครั้ง
import fs from 'node:fs'
import path from 'node:path'

// ต้องตรงกับ src/lib/content.ts
const LIBRARY_DIR = process.env.LIBRARY_DIR
  ? path.resolve(process.env.LIBRARY_DIR)
  : path.join(process.cwd(), 'library')
const TARGET_DIR = path.join(process.cwd(), 'public', 'books')

// ล้างก่อนเสมอ กันภาพของ library ก่อนหน้า (เช่นสลับไป library.example) ค้าง
fs.rmSync(TARGET_DIR, { recursive: true, force: true })

if (!fs.existsSync(LIBRARY_DIR)) {
  console.log(`sync-library-assets: ไม่มี ${LIBRARY_DIR} — ข้าม`)
  process.exit(0)
}

let copied = 0
for (const entry of fs.readdirSync(LIBRARY_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
  const assetsDir = path.join(LIBRARY_DIR, entry.name, 'assets')
  if (!fs.existsSync(path.join(LIBRARY_DIR, entry.name, 'book.json')) || !fs.existsSync(assetsDir)) continue
  fs.cpSync(assetsDir, path.join(TARGET_DIR, entry.name), { recursive: true, dereference: true })
  copied++
}
console.log(`sync-library-assets: คัดลอก assets ${copied} เรื่อง → public/books/`)
