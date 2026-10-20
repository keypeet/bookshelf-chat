#!/usr/bin/env node
// สัญญา Studio ↔ backend: openapi.json จาก FastAPI → types ของ openapi-typescript ใน src/lib/studio/
//   node scripts/api-types.mjs          เขียนใหม่ทั้งสองไฟล์ (npm run api:types)
//   node scripts/api-types.mjs --check  ตรวจว่าทั้งสองไฟล์ตรงกับโค้ด backend (npm run api:check)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const check = process.argv.includes('--check')
const spec = path.join('src', 'lib', 'studio', 'openapi.json')
const types = path.join('src', 'lib', 'studio', 'openapi.d.ts')
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
const openapiTs = path.join('node_modules', 'openapi-typescript', 'bin', 'cli.js')

run('uv', ['run', '--directory', 'backend', 'python', 'scripts/export_openapi.py', ...(check ? ['--check'] : [])])

const out = check ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'api-types-')), 'openapi.d.ts') : types
run(process.execPath, [openapiTs, spec, '-o', out, '--alphabetize', '--default-non-nullable', 'false'])

if (check) {
  const normalize = (file) => fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n')
  if (!fs.existsSync(types) || normalize(out) !== normalize(types)) {
    console.error(`${types} ไม่ตรงกับ openapi.json — รัน npm run api:types`)
    process.exit(1)
  }
  console.log('api:check ผ่าน')
}
