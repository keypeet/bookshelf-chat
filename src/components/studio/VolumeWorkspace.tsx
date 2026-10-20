'use client'

// หน้าเล่มของ Studio: แถบ 6 ขั้น · ตารางหน้า + ตัวกรอง · สั่ง OCR "ส่งไป N หน้า ทีละ M หน้า" (D10)
// · งานที่กำลังทำ (ยกเลิก/ทำต่อ) · คิวผลที่ต้องให้คนดู · ขอบเขตบท + จบเล่ม
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  errorText,
  studioApi,
  type BookCard,
  type JobOut,
  type PagesOut,
  type ProviderOut,
  type QueueEntry,
  type VolumeStatus,
} from '@/lib/studio/api'
import { useJob } from '@/lib/studio/use-job'
import { getStudioModels } from '@/lib/storage'
import ChaptersEditor from './ChaptersEditor'
import ChapterPipeline from './ChapterPipeline'
import { defaultChoice, modelFor } from './ModelPanel'
import { btnGhost, btnPrimary, card, Notice, Pill, Stepper, StudioNav } from './ui'

type PageState = 'none' | 'running' | 'accepted' | 'review' | 'cover' | 'failed'

const LOOK: Record<PageState, { glyph: string; label: string; style: string }> = {
  accepted: { glyph: '✓', label: 'OCR แล้ว', style: 'bg-[#e1f0e7] text-[#1f5039] border-[#b9d9c5]' },
  review: { glyph: '◐', label: 'รอคนดู', style: 'bg-[#fff3d6] text-[#7a4a00] border-[#ecd29c]' },
  cover: { glyph: '▣', label: 'ปก/ภาพประกอบ', style: 'bg-[#ede6f7] text-[#4a2f7a] border-[#cfc0e6]' },
  running: { glyph: '…', label: 'กำลังทำ', style: 'bg-[#eef0f3] text-[#3a4350] border-[#d3d8de]' },
  failed: { glyph: '!', label: 'ล้มเหลว', style: 'bg-[#f8e0dd] text-[#8a1f14] border-[#e5b3ad]' },
  none: { glyph: '○', label: 'ยังไม่ OCR', style: 'bg-bg text-fg2 border-line' },
}
const PER_PAGE = 60

function pageState(page: PagesOut['pages'][number], running: Set<number>): PageState {
  if (running.has(page.image)) return 'running'
  if (page.raw) return 'accepted'
  const states = page.candidates.map((c) => (c.status === 'ok' ? c.accept : 'failed'))
  if (states.includes('cover')) return 'cover'
  if (states.includes('review')) return 'review'
  if (states.includes('failed')) return 'failed'
  return 'none'
}

interface Props {
  book: string
  volume: number
}

export default function VolumeWorkspace({ book, volume }: Props) {
  const [card_, setCard] = useState<BookCard | null>(null)
  const [status, setStatus] = useState<VolumeStatus | null>(null)
  const [pages, setPages] = useState<PagesOut | null>(null)
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [jobs, setJobs] = useState<JobOut[]>([])
  const [providers, setProviders] = useState<ProviderOut[]>([])
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<PageState | 'all'>('all')
  const [offset, setOffset] = useState(0)

  const load = useCallback(async () => {
    try {
      const [books, st, pg, q, js] = await Promise.all([
        studioApi.books(),
        studioApi.status(book),
        studioApi.pages(book, volume),
        studioApi.queue(book, volume),
        studioApi.jobs(book),
      ])
      setCard(books.find((b) => b.slug === book) ?? null)
      setStatus(st.volumes.find((v) => v.n === volume) ?? null)
      setPages(pg)
      setQueue(q)
      setJobs(js.filter((j) => j.volume === volume))
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }, [book, volume])

  useEffect(() => {
    load()
    studioApi
      .providers()
      .then(setProviders, (err) => setError(errorText(err)))
      .finally(() => setProvidersLoaded(true))
  }, [load])

  // backend รันได้ทีละงานต่อเล่ม; ติดตามงานที่กำลังรัน (ถ้ามี) ไม่งั้นแสดงงานล่าสุด
  const runningJob = jobs.find((j) => j.running) ?? null
  const { job: liveJob } = useJob(runningJob?.id ?? null, () => load())
  const job = liveJob && liveJob.id === runningJob?.id ? liveJob : (runningJob ?? jobs[0] ?? null)
  const activeId = job?.running ? job.id : null
  const ocrActive = job?.running && job.kind === 'ocr' ? job.id : null

  // ระหว่างงานรัน รีเฟรชตารางหน้าเป็นระยะ ให้เห็นหน้าที่เสร็จทีละหน้า
  useEffect(() => {
    if (!ocrActive) return
    const timer = setInterval(() => {
      studioApi.pages(book, volume).then(setPages, () => {})
    }, 4000)
    return () => clearInterval(timer)
  }, [ocrActive, book, volume])

  const running = useMemo(() => {
    const set = new Set<number>()
    // งานแปลง/สแกน/สรุปใช้เลข item เป็นเลข call/บท ไม่ใช่เลขหน้า
    if (job?.running && job.kind === 'ocr') for (const [n, item] of Object.entries(job.items)) if (item.state === 'running') set.add(Number(n))
    return set
  }, [job])

  const rows = useMemo(
    () => (pages?.pages ?? []).map((p) => ({ ...p, state: pageState(p, running) })),
    [pages, running],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const r of rows) c[r.state] = (c[r.state] ?? 0) + 1
    return c
  }, [rows])
  const shown = rows.filter((r) => filter === 'all' || r.state === filter)
  // หน้าในตัวกรองลดลง (เช่น รับผลจนหมดหน้าสุดท้าย) → ถอยกลับหน้าที่ยังมีของ
  useEffect(() => {
    if (offset > 0 && offset >= shown.length) setOffset(Math.max(0, Math.floor((shown.length - 1) / PER_PAGE) * PER_PAGE))
  }, [offset, shown.length])
  const visible = shown.slice(offset, offset + PER_PAGE)

  const ocrProviders = providers.filter((p) => p.tasks.includes('ocr') && p.status.available)
  const title = status?.title ?? card_?.volumes?.find((v) => v.n === volume)?.title

  async function uploadPdf(file: File) {
    try {
      await studioApi.uploadSource(book, volume, file)
      await load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <>
      <StudioNav
        crumbs={[
          { label: 'หนังสือ & สถานะ', href: '/studio' },
          { label: card_?.title ?? book },
          { label: `เล่ม ${volume} · ขั้นตอน` },
        ]}
      />
      <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-6">
        <section className={`${card} flex flex-wrap items-center gap-3`}>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-bold text-fg">
              เล่ม {volume}
              {title ? ` · ${title}` : ''}
            </h1>
            <p className="text-[13px] text-fg2">
              {pages?.hasSource
                ? `source.pdf · ${pages.lastPage} หน้า`
                : pages && pages.lastPage > 0
                  ? `ภาพหน้า ${pages.lastPage} หน้า (ยังไม่มี PDF)`
                  : 'ยังไม่มี PDF หรือภาพหน้า'}
            </p>
          </div>
          {!pages?.hasSource ? (
            <label className={`${btnGhost} cursor-pointer`}>
              อัปโหลด PDF ของเล่มนี้
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])}
              />
            </label>
          ) : null}
        </section>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <StepBar status={status} pages={pages} queue={new Set(queue.filter((q) => !q.rawExists).map((q) => q.image)).size} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className={`${card} flex min-w-0 flex-col gap-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-bold text-fg">หน้าหนังสือ</h2>
              <span className="text-[13px] text-fg2">
                {shown.length ? `แสดง ${offset + 1}–${Math.min(offset + PER_PAGE, shown.length)} จาก ${shown.length}` : ''}
              </span>
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  className={`${btnGhost} min-h-9`}
                  aria-label="หน้าก่อน"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PER_PAGE))}
                >
                  ←
                </button>
                <button
                  type="button"
                  className={`${btnGhost} min-h-9`}
                  aria-label="หน้าถัดไป"
                  disabled={offset + PER_PAGE >= shown.length}
                  onClick={() => setOffset(offset + PER_PAGE)}
                >
                  →
                </button>
              </span>
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="กรองหน้า">
              {(['all', 'none', 'accepted', 'review', 'failed', 'cover', 'running'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f)
                    setOffset(0)
                  }}
                  className={`min-h-9 rounded-full border px-3 text-[13px] ${filter === f ? 'border-accent bg-bubble-me text-fg' : 'border-line text-fg2'}`}
                >
                  {f === 'all' ? 'ทั้งหมด' : `${LOOK[f].glyph} ${LOOK[f].label}`} {counts[f] ?? 0}
                </button>
              ))}
            </div>
            {visible.length === 0 ? <p className="text-[14px] text-fg2">ไม่มีหน้าในสถานะนี้</p> : null}
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
              {visible.map((p) => (
                <li key={p.image} className={`flex flex-col gap-1 rounded-lg border p-2 ${LOOK[p.state].style}`}>
                  <Link
                    href={pageHref(book, volume, p.image)}
                    className="flex items-center justify-between text-[13px] font-semibold"
                    title={LOOK[p.state].label}
                  >
                    <span>หน้า {p.image}</span>
                    <span aria-label={LOOK[p.state].label}>{LOOK[p.state].glyph}</span>
                  </Link>
                  {p.marker.length ? <span className="text-[11px]">บทที่ {p.marker.join(', ')}</span> : null}
                  {p.state === 'none' || p.state === 'failed' ? (
                    <OnePageButton book={book} volume={volume} image={p.image} providers={ocrProviders} disabled={!!activeId} onStarted={load} />
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-fg2">กดเลขหน้าเพื่อเปิดหน้าเทียบ (ภาพ + ผลทุกโมเดล) · ▶ = OCR หน้านั้นหน้าเดียวด้วยโมเดลหลัก · หน้าที่มี raw อยู่แล้วจะไม่ถูกเขียนทับ</p>
          </section>

          <div className="flex flex-col gap-4">
            <OcrPanel
              book={book}
              volume={volume}
              lastPage={pages?.lastPage ?? 0}
              providers={ocrProviders}
              busy={!!activeId}
              loading={!providersLoaded}
              version={`${job?.id}:${job?.state}`}
              onStarted={load}
            />
            {job ? <JobPanel job={job} onChanged={load} /> : null}
            <QueuePanel book={book} volume={volume} queue={queue} onChanged={load} />
            <ChaptersEditor book={book} volume={volume} card={card_} pages={pages} onSaved={load} />
          </div>
        </div>

        <ChapterPipeline book={book} volume={volume} status={status} providers={providers} busy={!!activeId} onChanged={load} />
      </main>
    </>
  )
}

function StepBar({ status, pages, queue }: { status: VolumeStatus | null; pages: PagesOut | null; queue: number }) {
  const chapters = status?.chapters ?? []
  const total = chapters.length
  const steps = [
    { title: 'OCR', done: status?.ocrPages ?? 0, of: pages?.lastPage ?? 0, unit: 'หน้า', live: true },
    { title: 'เลือกผล', done: Math.max(0, (status?.ocrPages ?? 0)), of: (status?.ocrPages ?? 0) + queue, unit: 'หน้า', live: true },
    { title: 'ตัวละคร', done: chapters.filter((c) => c.scanned).length, of: total, unit: 'บท', live: true },
    { title: 'แปลงแชท', done: chapters.filter((c) => c.drafted || c.published).length, of: total, unit: 'บท', live: true },
    { title: 'ตรวจ/publish', done: chapters.filter((c) => c.published && !c.drafted).length, of: total, unit: 'บท', live: true },
    { title: 'สรุปบท', done: chapters.filter((c) => c.summarized).length, of: total, unit: 'บท', live: true },
  ]
  return (
    <section className={`${card} flex flex-col gap-2`}>
      <h2 className="text-[15px] font-bold text-fg">ความคืบหน้าของเล่ม</h2>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((s, i) => {
          const full = s.of > 0 && s.done >= s.of
          return (
            <li key={s.title} className={`flex flex-col gap-1 rounded-lg border p-2 ${s.live ? 'border-line' : 'border-dashed border-line opacity-70'}`}>
              <span className="flex items-center gap-2 text-[14px] font-semibold text-fg">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] ${full ? 'bg-accent text-white' : 'bg-bg text-fg2'}`}>
                  {full ? '✓' : i + 1}
                </span>
                {s.title}
              </span>
              <span className="text-[13px] text-fg2">
                {s.done} / {s.of} {s.unit}
              </span>
              <span className="h-1.5 rounded bg-bg">
                <span className="block h-1.5 rounded bg-accent" style={{ width: `${s.of ? Math.round((s.done / s.of) * 100) : 0}%` }} />
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function pageHref(book: string, volume: number, image: number) {
  return `/studio/books/${encodeURIComponent(book)}/v/${volume}/pages/${image}`
}

function OcrPanel({
  book,
  volume,
  lastPage,
  providers,
  busy,
  loading,
  version,
  onStarted,
}: {
  book: string
  volume: number
  lastPage: number
  providers: ProviderOut[]
  busy: boolean
  loading: boolean // กำลังตรวจ CLI (ครั้งแรกเรียก --version ทุกตัว ใช้เวลาหลายวินาที)
  version: string // เปลี่ยนเมื่องานเริ่ม/จบ → นับ call ใหม่
  onStarted: () => void
}) {
  const [from, setFrom] = useState(1)
  const [count, setCount] = useState(10)
  const [parallel, setParallel] = useState(2)
  const [picked, setPicked] = useState<string[] | null>(null) // null = ตัวที่เปิดสวิตช์ไว้ในหน้า Studio
  const [calls, setCalls] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const prefs = getStudioModels()
  const enabled = providers.filter((p) => (prefs[p.id] ?? defaultChoice(p)).enabled).map((p) => p.id)
  const ids = (picked ?? enabled).filter((id) => providers.some((p) => p.id === id))
  const choices = ids.map((id) => modelFor(providers, id)).filter((c) => c !== null)
  const models = choices.map(({ provider, model, effort }) => ({ provider, model, effort }))
  const modelsKey = JSON.stringify(models)
  const to = Math.min(from + count - 1, lastPage || from + count - 1)
  const inRange = Math.max(0, to - from + 1)
  const rounds = Math.ceil(inRange / parallel)

  useEffect(() => {
    setCalls(null) // ระหว่างรอนับใหม่ ไม่โชว์จำนวนของตัวเลือกเดิม
    if (models.length === 0 || lastPage === 0) return
    const timer = setTimeout(() => {
      studioApi
        .ocrJob({ book, volume, from, count, parallel, models, dryRun: true })
        .then((r) => setCalls(r.plan.calls), (err) => setMessage(errorText(err)))
    }, 300)
    return () => clearTimeout(timer)
  }, [book, volume, from, count, parallel, modelsKey, lastPage, version]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setMessage(null)
    setPicked(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  }

  async function start() {
    if (models.length === 0) return
    setMessage(null)
    try {
      await studioApi.ocrJob({ book, volume, from, count, parallel, models })
      onStarted()
    } catch (err) {
      setMessage(errorText(err))
    }
  }

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <h2 className="text-[17px] font-bold text-fg">① สั่ง OCR ช่วงหน้า</h2>
      <div className="flex flex-wrap gap-3">
        <Stepper label="เริ่มที่หน้า" value={from} max={Math.max(1, lastPage)} onChange={setFrom} />
        <Stepper label="ส่งไปทั้งหมด (หน้า)" value={count} max={2000} onChange={setCount} />
        <Stepper label="ส่งทีละกี่หน้า" value={parallel} max={8} onChange={setParallel} />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[13px] text-fg2">โมเดล — เลือกหลายตัวเพื่อเทียบผล (ทุกหน้าเข้าคิวให้เลือกเอง)</legend>
        {loading ? <p className="text-[13px] text-fg2">กำลังตรวจ CLI…</p> : null}
        {!loading && providers.length === 0 ? <p className="text-[13px] text-fg2">ไม่มี CLI ที่ OCR ได้ในเครื่องนี้</p> : null}
        {providers.map((p) => {
          const c = modelFor(providers, p.id)
          return (
            <label key={p.id} className="flex items-center gap-2 text-[14px] text-fg">
              <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} className="accent-[var(--accent)]" />
              {c?.label}
            </label>
          )
        })}
      </fieldset>
      <p className="text-[14px] text-fg">
        ส่งไป {inRange} หน้า ทีละ {parallel} หน้า = {rounds} รอบ · หน้า {from}–{to}
        {models.length > 1 ? ` · ${models.length} โมเดล` : ''}
        <br />
        <span className="text-fg2">
          เรียก CLI {calls ?? '…'} ครั้ง (หน้า × โมเดล ข้ามที่ OCR แล้วอัตโนมัติ) · เพดานรวมทั้งระบบ 4 process
          {models.length > 1 ? ' · หลายโมเดลไม่รับผลอัตโนมัติ' : ''}
        </span>
      </p>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <button type="button" className={btnPrimary} disabled={busy || models.length === 0 || calls === 0 || lastPage === 0} onClick={start}>
        {busy ? 'มีงานกำลังทำอยู่' : `เริ่ม OCR (${calls ?? '…'} call)`}
      </button>
    </section>
  )
}

function OnePageButton({
  book,
  volume,
  image,
  providers,
  disabled,
  onStarted,
}: {
  book: string
  volume: number
  image: number
  providers: ProviderOut[]
  disabled: boolean
  onStarted: () => void
}) {
  const choice = modelFor(providers, null)
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="min-h-8 rounded-full border border-current text-[13px] font-bold disabled:opacity-40"
      disabled={disabled || busy || !choice}
      aria-label={`OCR หน้า ${image}`}
      onClick={() => {
        if (!choice) return
        setBusy(true)
        studioApi
          .ocrJob({ book, volume, from: image, count: 1, parallel: 1, models: [{ provider: choice.provider, model: choice.model, effort: choice.effort }] })
          .catch(() => undefined)
          .finally(() => {
            setBusy(false)
            onStarted()
          })
      }}
    >
      ▶
    </button>
  )
}

const KIND: Record<string, string> = { scan: 'สแกนตัวละคร', convert: 'แปลงเป็นแชท', summarize: 'สรุป' }

function JobPanel({ job, onChanged }: { job: JobOut; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const items = Object.values(job.items)
  const done = items.filter((i) => i.state === 'done').length
  const failed = items.filter((i) => i.state === 'failed').length
  const review = items.filter((i) => i.detail === 'review').length
  const pages = Object.keys(job.items).map(Number)
  const canResume = !job.running && ['cancelled', 'interrupted', 'failed'].includes(job.state)
  const tone = job.state === 'done' ? 'ok' : job.state === 'running' ? 'part' : 'bad'
  const label: Record<string, string> = { running: 'กำลังทำ', done: 'เสร็จ', failed: 'มีหน้าล้มเหลว', cancelled: 'ยกเลิกแล้ว', interrupted: 'ค้างจากรอบก่อน' }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  return (
    <section className={`${card} flex flex-col gap-2`} aria-live="polite">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-bold text-fg">
          {job.kind === 'ocr'
            ? `งาน OCR · หน้า ${Math.min(...pages)}–${Math.max(...pages)}`
            : `${KIND[job.kind] ?? job.kind} · ${job.params.chapter ? `บทที่ ${job.params.chapter}` : 'ทั้งเล่ม'}`}
        </h2>
        <Pill tone={tone}>{label[job.state] ?? job.state}</Pill>
      </div>
      <p className="text-[13px] text-fg2">
        เสร็จ {done} / {items.length} {job.kind === 'ocr' ? 'หน้า' : 'call'}{review ? ` · รอคนดู ${review}` : ''}
        {failed ? ` · ล้มเหลว ${failed} (ทำต่อเพื่อลองใหม่)` : ''}
      </p>
      <span className="h-1.5 rounded bg-bg">
        <span className="block h-1.5 rounded bg-accent" style={{ width: `${items.length ? Math.round((done / items.length) * 100) : 0}%` }} />
      </span>
      <div className="flex gap-2">
        {job.running ? (
          <button type="button" className={btnGhost} disabled={busy} onClick={() => act(() => studioApi.cancelJob(job.id))}>
            ยกเลิก
          </button>
        ) : null}
        {canResume ? (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => act(() => studioApi.resumeJob(job.id))}>
            ทำต่อ (ข้ามหน้าที่เสร็จแล้ว)
          </button>
        ) : null}
      </div>
    </section>
  )
}

function QueuePanel({ book, volume, queue, onChanged }: { book: string; volume: number; queue: QueueEntry[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null) // หน้าที่กำลังส่งคำสั่ง — กันกดซ้ำ
  const act = (image: number, fn: () => Promise<unknown>) => {
    setBusy(image)
    setError(null)
    fn()
      .then(onChanged, (err) => setError(errorText(err)))
      .finally(() => setBusy(null))
  }
  // หนึ่งแถวต่อหน้า: หน้าที่ OCR หลายโมเดลมีหลายผล → ไปเลือกที่หน้าเทียบ; ผลเดียวรับ/คง raw ได้จากตรงนี้
  const groups = useMemo(() => {
    const byPage = new Map<number, QueueEntry[]>()
    for (const q of queue) byPage.set(q.image, [...(byPage.get(q.image) ?? []), q])
    return [...byPage.entries()]
  }, [queue])
  return (
    <section className={`${card} flex flex-col gap-2`}>
      <h2 className="text-[15px] font-bold text-fg">② ผล OCR ที่ต้องให้คนดู</h2>
      <p className="text-[12px] text-fg2">หน้าที่ผลดูผิดปกติ, มี raw อยู่แล้ว (ไม่เขียนทับ) หรือ OCR หลายโมเดล — กดเลขหน้าเพื่อเทียบ/แก้ข้อความ</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {groups.length === 0 ? <p className="text-[13px] text-fg2">ไม่มีหน้าค้าง</p> : null}
      <ul className="flex flex-col gap-2">
        {groups.map(([image, entries]) => {
          const q = entries[0]
          return (
          <li key={image} className="rounded-lg border border-line p-2 text-[13px]">
            <div className="flex items-center gap-2">
              <Link className="font-semibold text-accent" href={pageHref(book, volume, image)}>
                หน้า {image}
              </Link>
              <span className="text-fg2">{entries.map((e) => e.provider).join(' · ')}</span>
              {entries.length > 1 ? (
                <Link className={`${btnGhost} ml-auto min-h-8`} href={pageHref(book, volume, image)}>
                  เทียบ {entries.length} ผล
                </Link>
              ) : q.rawExists ? (
                <button
                  type="button"
                  className={`${btnGhost} ml-auto min-h-8`}
                  title="มี raw ที่ตรวจแล้วอยู่ — คงไว้และเอาผลนี้ออกจากคิว"
                  disabled={busy !== null}
                  onClick={() => act(image, () => studioApi.keepRaw(book, volume, q.image, q.provider, q.model))}
                >
                  คง raw เดิม
                </button>
              ) : (
                <button
                  type="button"
                  className={`${btnGhost} ml-auto min-h-8`}
                  disabled={busy !== null}
                  onClick={() => act(image, () => studioApi.accept(book, volume, q.image, q.provider, q.model))}
                >
                  {q.cover ? 'ยืนยันว่าเป็นปก/ภาพ' : 'รับผลนี้'}
                </button>
              )}
            </div>
            <ul className="mt-1 list-disc pl-5 text-fg2">
              {[...new Set(entries.flatMap((e) => e.reasons))].map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </li>
          )
        })}
      </ul>
    </section>
  )
}
