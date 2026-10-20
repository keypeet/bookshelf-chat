#!/usr/bin/env node
// coverage ของการแปลงเป็นแชท — สูตรเดียวกับ backend/app/modules/convert/coverage.py
// `node scripts/coverage.mjs --test` รัน test case ร่วม scripts/coverage-cases.json (Python ก็รันชุดเดียวกัน)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LOW = 0.97
const HIGH = 1.03
const PROBE = 10
const MIN_PARAGRAPH = 6
const COMMENT = /<!--[\s\S]*?-->/g
// รายการตัวอักษรเขียนเองทั้งหมด ให้ตรงกับ Python (\s ของสองภาษาไม่เท่ากัน)
const STRIP = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff"'“”‘’„‟«»]/g
const COUNTED = new Set(['narration', 'dialogue', 'thought'])

// นับเป็น code point ให้ตรงกับ len() ของ Python
const length = (s) => [...s].length
const norm = (text) => text.replace(COMMENT, '').replace(STRIP, '')

function blockText(blocks) {
  return norm(blocks.filter((b) => COUNTED.has(b.type)).map((b) => `${b.text ?? ''}${b.action ?? ''}`).join(''))
}

export function coverage(blocks, rawTexts) {
  const have = blockText(blocks)
  const paragraphs = rawTexts.flatMap((t) => t.replace(COMMENT, '').split(/\r?\n/)).map(norm)
  const want = paragraphs.join('')
  const ratio = want ? Math.round((length(have) / length(want)) * 1000) / 1000 : null
  const missing = []
  for (const p of paragraphs) {
    const chars = [...p]
    if (chars.length < MIN_PARAGRAPH) continue
    const head = chars.slice(0, PROBE).join('')
    const tail = chars.slice(-PROBE).join('')
    if (!have.includes(head) && !have.includes(tail)) missing.push(chars.slice(0, 40).join(''))
  }
  const ok = (ratio === null && !have) || (ratio !== null && ratio >= LOW && ratio <= HIGH)
  return { ratio, missing, ok: ok && missing.length === 0 }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--test')) {
  const casesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'coverage-cases.json')
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf-8'))
  let failed = 0
  for (const c of cases) {
    const got = coverage(c.blocks, c.raw)
    const pass = got.ratio === c.ratio && got.missing.length === c.missing && got.ok === c.ok
    if (!pass) failed++
    console.log(`${pass ? '✓' : '✗'} ${c.name} → ratio ${got.ratio} missing ${got.missing.length} ok ${got.ok}`)
  }
  if (failed) {
    console.error(`coverage: ${failed} case(s) failed`)
    process.exit(1)
  }
  console.log(`coverage: ${cases.length} cases passed`)
}
