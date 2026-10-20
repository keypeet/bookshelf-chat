// client ของ Studio → backend ผ่าน proxy /studio/api/* (src/app/studio/api/[...path]/route.ts)
// types มาจาก openapi.d.ts ที่ generate จาก FastAPI (npm run api:types) — ห้าม import ไฟล์นี้นอก Studio
import type { components } from './openapi'

type S = components['schemas']
export type BookCard = S['BookCard']
export type BookCreate = S['BookCreate']
export type BookPatch = S['BookPatch']
export type BookStatus = S['BookStatus']
export type VolumeStatus = S['VolumeStatus']
export type ChaptersIn = S['ChaptersIn']
export type PagesOut = S['PagesOut']
export type PageOut = S['PageOut']
export type PageDetail = S['PageDetail']
export type CandidateDetail = S['CandidateDetail']
export type QueueEntry = S['QueueEntry']
export type OcrJobIn = S['OcrJobIn']
export type OcrJobCreated = S['OcrJobCreated']
export type JobOut = S['JobOut']
export type ProviderOut = S['ProviderOut']
export type ProbeOut = S['ProbeOut']
export type TextModelIn = S['TextModelIn']
export type ConvertJobIn = S['ConvertJobIn']
export type ConvertJobCreated = S['ConvertJobCreated']
export type DraftRow = S['DraftRow']
export type DraftDetail = S['DraftDetail']
export type BlockIn = S['BlockIn']
export type Proposal = S['Proposal']
export type StoryOut = S['StoryOut']
export type VolumeStory = S['VolumeStory']

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function detailText(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : String(d))).join(' · ')
  }
  return 'เกิดข้อผิดพลาด'
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const headers = new Headers(rest.headers)
  let body = rest.body
  if (json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(json)
  }
  const response = await fetch(`/studio/api${path}`, { ...rest, headers, body, cache: 'no-store' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiError(response.status, detailText((data as { detail?: unknown }).detail))
  }
  return (await response.json()) as T
}

function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  return call<T>(path, { method: 'POST', body: form })
}

const b = (book: string) => `/books/${encodeURIComponent(book)}`

export const studioApi = {
  providers: (refresh = false) => call<ProviderOut[]>(`/providers${refresh ? '?refresh=true' : ''}`),
  probe: (provider: string, model: string, effort: string) =>
    call<ProbeOut>(`/providers/${provider}/probe`, { method: 'POST', json: { model, effort } }),

  books: () => call<BookCard[]>('/books'),
  createBook: (body: BookCreate) => call<BookCard>('/books', { method: 'POST', json: body }),
  updateBook: (book: string, body: BookPatch) => call<BookCard>(b(book), { method: 'PATCH', json: body }),
  uploadCover: (book: string, file: File) => upload<BookCard>(`${b(book)}/cover`, file),
  coverFromPage: (book: string, volume: number, image: number) =>
    call<BookCard>(`${b(book)}/cover/from-page`, { method: 'POST', json: { volume, image } }),
  status: (book: string) => call<BookStatus>(`${b(book)}/status`),
  setChapters: (book: string, volume: number, body: ChaptersIn) =>
    call<BookCard>(`${b(book)}/volumes/${volume}/chapters`, { method: 'PUT', json: body }),
  uploadSource: (book: string, volume: number, file: File) =>
    upload<{ pages: number }>(`${b(book)}/volumes/${volume}/source`, file),
  pages: (book: string, volume: number) => call<PagesOut>(`${b(book)}/volumes/${volume}/pages`),
  pageImageUrl: (book: string, volume: number, image: number) =>
    `/studio/api${b(book)}/volumes/${volume}/pages/${image}/image`,
  page: (book: string, volume: number, image: number) =>
    call<PageDetail>(`${b(book)}/volumes/${volume}/pages/${image}`),
  queue: (book: string, volume: number) => call<QueueEntry[]>(`${b(book)}/volumes/${volume}/ocr/queue`),
  accept: (book: string, volume: number, image: number, provider: string, model: string, text?: string) =>
    call<{ state: string }>(`${b(book)}/volumes/${volume}/pages/${image}/accept`, {
      method: 'POST',
      json: { provider, model, ...(text !== undefined ? { text } : {}) },
    }),

  keepRaw: (book: string, volume: number, image: number, provider: string, model: string) =>
    call<{ state: string }>(`${b(book)}/volumes/${volume}/pages/${image}/keep-raw`, {
      method: 'POST',
      json: { provider, model },
    }),

  ocrJob: (body: OcrJobIn) => call<OcrJobCreated>('/ocr/jobs', { method: 'POST', json: body }),
  // งานทุกชนิด (ocr / scan / convert / summarize)
  jobs: (book: string) => call<JobOut[]>(`/jobs?book=${encodeURIComponent(book)}`),
  job: (id: string) => call<JobOut>(`/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => call<JobOut>(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', json: {} }),
  resumeJob: (id: string) => call<JobOut>(`/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST', json: {} }),

  scanJob: (book: string, volume: number, chapter: number, model: TextModelIn) =>
    call<JobOut>('/scan/jobs', { method: 'POST', json: { book, volume, chapter, model } }),
  convertJob: (body: ConvertJobIn) => call<ConvertJobCreated>('/convert/jobs', { method: 'POST', json: body }),
  summarizeJob: (book: string, volume: number, chapter: number | null, model: TextModelIn) =>
    call<JobOut>('/summarize/jobs', { method: 'POST', json: { book, volume, chapter, model } }),

  drafts: (book: string, volume: number) => call<DraftRow[]>(`${b(book)}/volumes/${volume}/drafts`),
  draft: (book: string, id: string) => call<DraftDetail>(`${b(book)}/drafts/${id}`),
  saveDraft: (book: string, id: string, blocks: BlockIn[], title?: string) =>
    call<DraftDetail>(`${b(book)}/drafts/${id}`, { method: 'PATCH', json: { blocks, ...(title ? { title } : {}) } }),
  publish: (book: string, id: string) => call<{ id: string }>(`${b(book)}/drafts/${id}/publish`, { method: 'POST', json: {} }),

  story: (book: string) => call<StoryOut>(`${b(book)}/story`),
  decide: (book: string, id: string, accept: boolean) =>
    call<Proposal>(`${b(book)}/proposals/${encodeURIComponent(id)}/${accept ? 'accept' : 'reject'}`, { method: 'POST', json: {} }),
  approveSummary: (book: string, volume: number, chapter: number | null, summary?: string, short?: string) =>
    call<unknown>(`${b(book)}/volumes/${volume}/summaries/approve`, { method: 'POST', json: { chapter, summary, short } }),
  setImported: (book: string, volume: number, imported: boolean) =>
    call<unknown>(`${b(book)}/volumes/${volume}/imported`, { method: 'PUT', json: { imported } }),
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
