// ทางเข้า localStorage ที่เดียวของทั้งโปรเจกต์ (plan.md §7) — ทุกอ่าน/เขียนต้องผ่านไฟล์นี้
// ปิด localStorage (โหมดส่วนตัว/DevTools block) ต้องไม่พัง เลยมี try/catch คืน default เสมอ

export type FontSize = 'sm' | 'md' | 'lg' | 'xl'
export type Theme = 'light' | 'dark' | 'system'
export type ReadMode = 'scroll' | 'tap'

export interface Progress {
  lastChapterId: string | null
  completed: string[]
  positions: Record<string, number>
  lastReadAt: number // Date.now() ตอนเปิดตอนล่าสุด; ข้อมูลที่ migrate มาไม่มี → 0
}

export interface Settings {
  fontSize: FontSize
  theme: Theme
  readMode: ReadMode
}

// progress แยกต่อเรื่อง (slug) — id ตอนซ้ำกันข้ามเรื่องได้
interface ProgressStore {
  books: Record<string, Progress>
}

const KEY_PROGRESS = 'reader:progress'
const KEY_SETTINGS = 'reader:settings'
const KEY_SEEN_HINT = 'reader:seenHint'
// สงวนชื่อ 'reader:assistant' ไว้ให้ผู้ช่วยในอนาคต — ยังไม่ใช้

// คีย์ของเว็บรุ่นเรื่องเดียว — คัดลอกมาครั้งเดียว ไม่ลบ (ถอยกลับไปรุ่นเก่าได้)
const LEGACY_PROGRESS = 'ppu:progress'
const LEGACY_SETTINGS = 'ppu:settings'
const LEGACY_SEEN_HINT = 'ppu:seenHint'
const LEGACY_BOOK = 'phet-phra-uma'

const DEFAULT_SETTINGS: Settings = {
  fontSize: 'md',
  theme: 'system',
  readMode: 'scroll',
}

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ปิด localStorage อยู่ — เมิน ไม่ให้พัง
  }
}

function emptyProgress(): Progress {
  return { lastChapterId: null, completed: [], positions: {}, lastReadAt: 0 }
}

// รับทั้งรูปแบบใหม่และก้อน ppu:progress เดิม (ไม่มี lastReadAt)
function parseProgress(parsed: unknown): Progress {
  if (typeof parsed !== 'object' || parsed === null) return emptyProgress()
  const p = parsed as Record<string, unknown>
  return {
    lastChapterId: typeof p.lastChapterId === 'string' ? p.lastChapterId : null,
    completed: Array.isArray(p.completed) ? p.completed : [],
    positions:
      typeof p.positions === 'object' && p.positions !== null
        ? (p.positions as Record<string, number>)
        : {},
    lastReadAt: typeof p.lastReadAt === 'number' ? p.lastReadAt : 0,
  }
}

let migrated = false

// ครั้งแรกที่อ่าน: คีย์ reader:* ตัวไหนยังไม่มีแต่ ppu:* มี → คัดลอกมา
// ppu:progress ทั้งก้อน (รวม id สังเคราะห์ v{n}-book{m}) เป็นของเรื่อง phet-phra-uma
function migrateLegacy(): void {
  if (migrated) return
  migrated = true
  if (safeGetItem(KEY_PROGRESS) === null) {
    const legacy = safeGetItem(LEGACY_PROGRESS)
    if (legacy !== null) {
      try {
        const store: ProgressStore = { books: { [LEGACY_BOOK]: parseProgress(JSON.parse(legacy)) } }
        safeSetItem(KEY_PROGRESS, JSON.stringify(store))
      } catch {
        // ก้อนเดิมเสีย — เริ่มใหม่
      }
    }
  }
  for (const [key, legacyKey] of [
    [KEY_SETTINGS, LEGACY_SETTINGS],
    [KEY_SEEN_HINT, LEGACY_SEEN_HINT],
  ]) {
    if (safeGetItem(key) !== null) continue
    const legacy = safeGetItem(legacyKey)
    if (legacy !== null) safeSetItem(key, legacy)
  }
}

function getStore(): ProgressStore {
  migrateLegacy()
  const raw = safeGetItem(KEY_PROGRESS)
  if (!raw) return { books: {} }
  try {
    const parsed = JSON.parse(raw)
    const books: Record<string, Progress> = {}
    if (typeof parsed.books === 'object' && parsed.books !== null) {
      for (const [slug, value] of Object.entries(parsed.books)) books[slug] = parseProgress(value)
    }
    return { books }
  } catch {
    return { books: {} }
  }
}

// ทุกเรื่องที่มีประวัติ — ใช้กับแถว "อ่านต่อ" บนชั้น
export function getAllProgress(): Record<string, Progress> {
  return getStore().books
}

export function getProgress(book: string): Progress {
  return getStore().books[book] ?? emptyProgress()
}

function updateProgress(book: string, update: (progress: Progress) => Progress): void {
  const store = getStore()
  store.books[book] = update(store.books[book] ?? emptyProgress())
  safeSetItem(KEY_PROGRESS, JSON.stringify(store))
}

export function setLastChapterId(book: string, chapterId: string): void {
  updateProgress(book, (progress) => ({ ...progress, lastChapterId: chapterId, lastReadAt: Date.now() }))
}

export function markCompleted(book: string, chapterId: string): void {
  if (isCompleted(book, chapterId)) return
  updateProgress(book, (progress) => ({ ...progress, completed: [...progress.completed, chapterId] }))
}

export function isCompleted(book: string, chapterId: string): boolean {
  return getProgress(book).completed.includes(chapterId)
}

export function setPosition(book: string, chapterId: string, blockIndex: number): void {
  updateProgress(book, (progress) => ({
    ...progress,
    positions: { ...progress.positions, [chapterId]: blockIndex },
  }))
}

export function getPosition(book: string, chapterId: string): number {
  return getProgress(book).positions[chapterId] ?? 0
}

export function getSettings(): Settings {
  migrateLegacy()
  const raw = safeGetItem(KEY_SETTINGS)
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(raw)
    return {
      fontSize: parsed.fontSize ?? DEFAULT_SETTINGS.fontSize,
      theme: parsed.theme ?? DEFAULT_SETTINGS.theme,
      readMode: parsed.readMode ?? DEFAULT_SETTINGS.readMode,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function setSettings(settings: Partial<Settings>): void {
  const current = getSettings()
  const next = { ...current, ...settings }
  safeSetItem(KEY_SETTINGS, JSON.stringify(next))
}

export function getSeenHint(): boolean {
  migrateLegacy()
  return safeGetItem(KEY_SEEN_HINT) === 'true'
}

export function setSeenHint(): void {
  safeSetItem(KEY_SEEN_HINT, 'true')
}

// --- Studio (ใช้ในเครื่องเท่านั้น) — โมเดล + ระดับการคิดค่าเริ่มต้นที่ตั้งจากหน้าแรก Studio (D11)

const KEY_STUDIO_MODELS = 'studio:models'

export interface StudioModelChoice {
  enabled: boolean
  model: string
  effort: string
}

export function getStudioModels(): Record<string, StudioModelChoice> {
  const raw = safeGetItem(KEY_STUDIO_MODELS)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function setStudioModels(models: Record<string, StudioModelChoice>): void {
  safeSetItem(KEY_STUDIO_MODELS, JSON.stringify(models))
}
