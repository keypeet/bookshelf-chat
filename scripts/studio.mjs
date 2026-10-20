#!/usr/bin/env node
// เปิด Studio ในเครื่อง: backend (127.0.0.1:8000, 1 worker, ไม่ --reload) + next dev ที่มี STUDIO=1
// ปิดหน้าต่าง/กด Ctrl+C แล้วปิดทั้งคู่ — ต้องมี STUDIO_TOKEN ใน .env.local (ดู AGENTS.md)
import { spawn, spawnSync } from 'node:child_process'

const windows = process.platform === 'win32'
spawnSync('node', ['scripts/sync-library-assets.mjs'], { stdio: 'inherit' })

const children = [
  spawn('uv', ['run', '--directory', 'backend', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--workers', '1'], {
    stdio: 'inherit',
  }),
  // --hostname 127.0.0.1: proxy /studio/api แนบ token ให้ทุก request — ห้ามเปิดให้เครื่องอื่นใน LAN เรียกได้
  spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1'], { stdio: 'inherit', env: { ...process.env, STUDIO: '1' } }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode !== null) continue
    // ฆ่าทั้งต้นไม้ของโปรเซส (Windows: uv → python, node → worker)
    if (windows) spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  process.exit(code)
}

for (const child of children) child.on('exit', (code) => stop(code ?? 0))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
