#!/usr/bin/env node
// Clone the private book-library repo into library/ before a hosted build (Vercel build command).
// Needs LIBRARY_TOKEN: fine-grained GitHub token, Contents: read-only, only keypeet/book-library.
// Fails the build instead of shipping a site with no books.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const token = process.env.LIBRARY_TOKEN
const repo = process.env.LIBRARY_REPO || 'keypeet/book-library'
const ref = process.env.LIBRARY_REF || 'main'
const dest = path.join(process.cwd(), 'library')

// safety: never wipe a local library/ clone (it holds uncommitted Studio work)
if ((!process.env.VERCEL && !process.env.CI) || fs.existsSync(path.join(dest, '.git'))) {
  console.error('fetch-library: only runs on Vercel/CI; locally library/ is your own clone')
  process.exit(1)
}

if (!token) {
  console.error('fetch-library: LIBRARY_TOKEN is not set, refusing to build without book content')
  process.exit(1)
}

fs.rmSync(dest, { recursive: true, force: true })
const url = `https://x-access-token:${token}@github.com/${repo}.git`
try {
  execFileSync('git', ['clone', '--depth', '1', '--branch', ref, url, dest], { stdio: ['ignore', 'ignore', 'pipe'] })
} catch (e) {
  // never print the URL: it contains the token
  console.error(`fetch-library: clone of ${repo}@${ref} failed (check LIBRARY_TOKEN scope/expiry)`)
  process.exit(1)
}
fs.rmSync(path.join(dest, '.git'), { recursive: true, force: true })

const books = fs.readdirSync(dest, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(dest, d.name, 'book.json')))
if (books.length === 0) {
  console.error('fetch-library: no book.json found in the cloned library')
  process.exit(1)
}
console.log(`fetch-library: ${repo}@${ref} -> library/ (${books.length} books: ${books.map((b) => b.name).join(', ')})`)

