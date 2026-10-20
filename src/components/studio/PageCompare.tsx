'use client'

// หน้าเทียบผล OCR (D13): ภาพหน้า + ผลทุกโมเดลข้างกัน → เลือกผู้ชนะ แก้ใน textarea แล้วบันทึกเป็น raw
// ไม่มี merge ระดับคำ; raw ที่มีอยู่แล้วไม่ถูกเขียนทับ (คง raw เดิม = เอาหน้าออกจากคิว)
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { errorText, studioApi, type BookCard, type CandidateDetail, type PageDetail, type QueueEntry } from '@/lib/studio/api'
import { pageHref } from './VolumeWorkspace'
import { btnGhost, btnPrimary, card, Notice, Pill, StudioNav } from './ui'

const STATE: Record<string, { label: string; tone: 'ok' | 'part' | 'none' | 'bad' }> = {
  accepted: { label: 'ใช้เป็น raw แล้ว', tone: 'ok' },
  review: { label: 'รอเลือก', tone: 'part' },
  cover: { label: 'ปก/ภาพประกอบ', tone: 'none' },
  kept: { label: 'คง raw เดิม', tone: 'none' },
  rejected: { label: 'ไม่ได้เลือก', tone: 'none' },
}

const nonSpace = (text: string) => text.replace(/<!--.*?-->/g, '').replace(/\s+/g, '').length

export default function PageCompare({ book, volume, image }: { book: string; volume: number; image: number }) {
  const [bookCard, setBookCard] = useState<BookCard | null>(null)
  const [page, setPage] = useState<PageDetail | null>(null)
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [chosen, setChosen] = useState<CandidateDetail | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [books, detail, q] = await Promise.all([
        studioApi.books(),
        studioApi.page(book, volume, image),
        studioApi.queue(book, volume),
      ])
      setBookCard(books.find((b) => b.slug === book) ?? null)
      setPage(detail)
      setQueue(q)
      return detail
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) })
      return null
    }
  }, [book, volume, image])

  // เปิดหน้า: ตั้งผู้ชนะเริ่มต้นเป็นผลแรกที่ใช้ได้ (หรือผลที่ใช้เป็น raw ไปแล้ว)
  // route ใส่ key ต่อหน้าอยู่แล้ว (เปลี่ยนหน้า = mount ใหม่); cancelled กันผลที่มาช้าทับอีกรอบ
  useEffect(() => {
    let cancelled = false
    load().then((detail) => {
      if (cancelled) return
      const ok = detail?.candidates.filter((c) => c.result) ?? []
      const first = ok.find((c) => c.accept === 'accepted') ?? ok[0]
      if (first?.result) {
        setChosen(first)
        setText(first.result.text)
      }
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const usable = page?.candidates.filter((c) => c.result) ?? []
  const open = usable.filter((c) => c.accept === 'review')
  const settled = !!page && open.length === 0
  // เลือกผลแล้ว (รับเป็น raw / ยืนยันปก / คง raw เดิม) → ไม่ให้บันทึกซ้ำ
  const decided = !!page?.candidates.some((c) => ['accepted', 'cover', 'kept'].includes(c.accept ?? ''))
  const canWrite = !!page && !page.raw && !decided
  const nextInQueue = [...new Set(queue.map((q) => q.image))].sort((a, b) => a - b).find((n) => n > image)
  const edited = !!chosen?.result && text !== chosen.result.text

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      setMessage({ tone: 'ok', text: done })
      await load()
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  function pick(c: CandidateDetail) {
    if (!c.result) return
    setChosen(c)
    setText(c.result.text)
  }

  const save = () =>
    chosen &&
    act(
      () => studioApi.accept(book, volume, image, chosen.provider, chosen.model, edited ? text : undefined),
      `บันทึก raw หน้า ${image} แล้ว (library/ — commit เองที่ library/)`,
    )
  const confirmCover = (c: CandidateDetail) =>
    act(() => studioApi.accept(book, volume, image, c.provider, c.model), `ยืนยันหน้า ${image} เป็นปก/ภาพประกอบแล้ว`)
  const keepRaw = () =>
    open[0] && act(() => studioApi.keepRaw(book, volume, image, open[0].provider, open[0].model), 'คง raw เดิมไว้ และเอาหน้านี้ออกจากคิวแล้ว')

  const volumeHref = `/studio/books/${encodeURIComponent(book)}/v/${volume}`

  return (
    <>
      <StudioNav
        crumbs={[
          { label: 'หนังสือ & สถานะ', href: '/studio' },
          { label: bookCard?.title ?? book },
          { label: `เล่ม ${volume}`, href: volumeHref },
          { label: `หน้า ${image}` },
        ]}
      />
      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-6">
        <section className={`${card} flex flex-wrap items-center gap-2`}>
          <h1 className="mr-auto text-[20px] font-bold text-fg">
            เทียบผล OCR · หน้า {image}
            {page?.lastPage ? <span className="text-[14px] font-normal text-fg2"> / {page.lastPage}</span> : null}
          </h1>
          {image > 1 ? (
            <Link className={`${btnGhost} min-h-9`} href={pageHref(book, volume, image - 1)}>
              ← หน้า {image - 1}
            </Link>
          ) : null}
          {page && image < page.lastPage ? (
            <Link className={`${btnGhost} min-h-9`} href={pageHref(book, volume, image + 1)}>
              หน้า {image + 1} →
            </Link>
          ) : null}
          {nextInQueue ? (
            <Link className={`${btnPrimary} min-h-9`} href={pageHref(book, volume, nextInQueue)}>
              หน้าถัดไปในคิว ({nextInQueue}) →
            </Link>
          ) : (
            <Link className={`${btnGhost} min-h-9`} href={volumeHref}>
              กลับหน้าเล่ม
            </Link>
          )}
        </section>

        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section className={`${card} flex flex-col gap-2 self-start lg:sticky lg:top-4`}>
            <h2 className="text-[15px] font-bold text-fg">ภาพหน้า</h2>
            {page?.hasImage ? (
              <a href={studioApi.pageImageUrl(book, volume, image)} target="_blank" rel="noreferrer" title="เปิดภาพขนาดเต็ม">
                {/* eslint-disable-next-line @next/next/no-img-element -- ภาพจาก backend ผ่าน proxy ไม่ผ่าน next/image */}
                <img
                  src={studioApi.pageImageUrl(book, volume, image)}
                  alt={`ภาพหน้า ${image}`}
                  className="max-h-[80vh] w-full rounded-md border border-line object-contain"
                />
              </a>
            ) : (
              <p className="text-[13px] text-fg2">ยังไม่มีภาพหน้านี้ (สร้างเมื่อสั่ง OCR)</p>
            )}
          </section>

          <div className="flex min-w-0 flex-col gap-4">
            {page?.raw ? (
              <section className={`${card} flex flex-col gap-2`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-bold text-fg">raw ที่มีอยู่</h2>
                  <Pill tone="ok">ไม่เขียนทับ</Pill>
                  <span className="text-[12px] text-fg2">
                    หน้าหนังสือ {page.raw.bookPage ?? '—'} · {nonSpace(page.raw.text)} ตัวอักษร
                  </span>
                  {open.length ? (
                    <button type="button" className={`${btnGhost} ml-auto min-h-9`} disabled={busy} onClick={keepRaw}>
                      คง raw เดิม
                    </button>
                  ) : null}
                </div>
                <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-[14px] leading-relaxed text-fg">{page.raw.text}</pre>
                <p className="text-[12px] text-fg2">ต้องการแทนที่: แก้ไฟล์ใน library/ เอง — Studio ไม่ลบหรือทับ raw ที่ตรวจแล้ว</p>
              </section>
            ) : null}

            <section className="flex flex-col gap-2">
              <h2 className="text-[15px] font-bold text-fg">
                ผลจากโมเดล ({page?.candidates.length ?? 0}){settled && page?.candidates.length ? ' · หน้านี้เลือกแล้ว' : ''}
              </h2>
              {page && page.candidates.length === 0 ? (
                <p className="text-[13px] text-fg2">ยังไม่มีผล OCR ของหน้านี้ — สั่ง OCR จากหน้าเล่ม</p>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {page?.candidates.map((c) => (
                  <CandidateCard
                    key={`${c.provider}__${c.model}`}
                    c={c}
                    chosen={chosen?.provider === c.provider && chosen.model === c.model}
                    busy={busy}
                    canWrite={canWrite}
                    onPick={() => pick(c)}
                    onCover={() => confirmCover(c)}
                  />
                ))}
              </div>
            </section>

            {chosen?.result && canWrite ? (
              <section className={`${card} flex flex-col gap-2`}>
                <label htmlFor="raw-text" className="text-[15px] font-bold text-fg">
                  ข้อความที่จะบันทึกเป็น raw
                  <span className="ml-2 text-[13px] font-normal text-fg2">
                    จาก {chosen.provider} · {chosen.model}
                    {edited ? ' · แก้แล้ว' : ''}
                  </span>
                </label>
                <textarea
                  id="raw-text"
                  className="min-h-[40vh] w-full rounded-lg border border-line bg-card p-3 text-[15px] leading-relaxed text-fg outline-none focus:border-accent"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto text-[12px] text-fg2">
                    {nonSpace(text)} ตัวอักษร · หน้าหนังสือ {chosen.result.bookPage ?? '—'} · คง {'<!-- chapter: N -->'} ไว้ถ้ามี
                  </span>
                  {edited ? (
                    <button type="button" className={`${btnGhost} min-h-9`} disabled={busy} onClick={() => chosen.result && setText(chosen.result.text)}>
                      คืนค่าเดิม
                    </button>
                  ) : null}
                  <button type="button" className={btnPrimary} disabled={busy || !text.trim()} onClick={save}>
                    {busy ? 'กำลังบันทึก…' : 'บันทึกเป็น raw'}
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  )
}

function CandidateCard({
  c,
  chosen,
  busy,
  canWrite,
  onPick,
  onCover,
}: {
  c: CandidateDetail
  chosen: boolean
  busy: boolean
  canWrite: boolean
  onPick: () => void
  onCover: () => void
}) {
  const state = c.status === 'ok' ? STATE[c.accept ?? ''] : { label: 'ล้มเหลว', tone: 'bad' as const }
  const r = c.result
  const marks = r ? (r.text.match(/\[\?/g) ?? []).length : 0
  return (
    <article className={`${card} flex min-w-0 flex-col gap-2 ${chosen ? 'border-accent ring-1 ring-accent' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-bold text-fg">
          {c.provider} · {c.model}
          {c.effort ? <span className="font-normal text-fg2"> · {c.effort}</span> : null}
        </h3>
        {state ? <Pill tone={state.tone}>{state.label}</Pill> : null}
      </div>
      {r ? (
        <p className="text-[12px] text-fg2">
          {nonSpace(r.text)} ตัวอักษร · หน้าหนังสือ {r.bookPage ?? '—'} · [?] {marks}
          {c.durationMs ? ` · ${Math.round(c.durationMs / 1000)} วิ` : ''}
          {r.isCover ? ' · AI บอกว่าเป็นปก/ภาพประกอบ' : ''}
        </p>
      ) : (
        <p className="text-[12px] text-red-800 dark:text-red-300">{c.errorKind ?? 'ไม่มีผล'} — สั่งทำต่อที่หน้าเล่มเพื่อลองใหม่</p>
      )}
      {c.reasons.length ? (
        <ul className="list-disc pl-5 text-[12px] text-fg2">
          {c.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {r ? (
        <pre className="max-h-[50vh] min-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-[14px] leading-relaxed text-fg">{r.text || '(ว่าง)'}</pre>
      ) : null}
      {r?.uncertain.length ? <p className="text-[12px] text-fg2">ไม่แน่ใจ: {r.uncertain.join(', ')}</p> : null}
      {r && canWrite ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${chosen ? btnPrimary : btnGhost} min-h-9`} disabled={busy || chosen} onClick={onPick}>
            {chosen ? 'เลือกอยู่' : 'ใช้ผลนี้'}
          </button>
          {r.isCover && c.accept === 'review' ? (
            <button type="button" className={`${btnGhost} min-h-9`} disabled={busy} onClick={onCover}>
              ยืนยันว่าเป็นปก/ภาพ
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
