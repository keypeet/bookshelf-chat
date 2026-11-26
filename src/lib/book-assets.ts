import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { getCharacters, isBookSlug } from './content'

const LIBRARY_DIR = process.env.LIBRARY_DIR
  ? path.resolve(process.env.LIBRARY_DIR)
  : path.join(process.cwd(), 'library')

const KEY = /^[a-z0-9-]+$/

export interface ServedAsset {
  filePath: string
  contentType: string
}

function assetsDir(slug: string): string | null {
  if (!isBookSlug(slug)) return null
  const dir = path.join(LIBRARY_DIR, slug)
  if (!fs.existsSync(path.join(dir, 'book.json'))) return null
  return path.join(dir, 'assets')
}

function underAssets(root: string, filePath: string): string | null {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(filePath)
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null
  return resolved
}

// ชื่อที่รับได้มีแค่ cover.webp และ avatar-<key>.jpg|.svg เมื่อ key อยู่ใน characters.json
export function resolveBookAsset(slug: string, asset: string): ServedAsset | null {
  if (asset.includes('/') || asset.includes('\\') || asset.includes('..')) return null
  const root = assetsDir(slug)
  if (!root) return null

  let relative: string | null = null
  let contentType: string | null = null
  if (asset === 'cover.webp') {
    relative = 'cover.webp'
    contentType = 'image/webp'
  } else {
    const jpg = /^avatar-([a-z0-9-]+)\.jpg$/.exec(asset)
    const svg = /^avatar-([a-z0-9-]+)\.svg$/.exec(asset)
    const key = jpg?.[1] ?? svg?.[1]
    if (!key || !KEY.test(key) || !Object.hasOwn(getCharacters(slug), key)) return null
    if (jpg) {
      relative = path.join('avatars', `${key}.jpg`)
      contentType = 'image/jpeg'
    } else {
      relative = path.join('avatars', 'svg', `${key}.svg`)
      contentType = 'image/svg+xml'
    }
  }

  const filePath = underAssets(root, path.join(root, relative))
  if (!filePath || !contentType) return null
  return { filePath, contentType }
}
