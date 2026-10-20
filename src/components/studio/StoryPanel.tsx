'use client'

// หน้าเรื่องของ Studio: ทะเบียนตัวละคร + ข้อเสนอจาก AI (รับ/ไม่รับทีละข้อ) · เนื้อเรื่องบท → เล่ม (อนุมัติ/แก้สรุป)
// · ข้อสังเกตเฉพาะเรื่อง (styleNotes + คำถาม/ลักษณะการพูดจากการสแกน)
import { useCallback, useEffect, useState } from 'react'
import { errorText, studioApi, type Proposal, type StoryOut, type VolumeStory } from '@/lib/studio/api'
import { btnGhost, btnPrimary, card, input, Notice, Pill, StudioNav } from './ui'

const KIND_LABEL: Record<string, string> = {
  character: 'ตัวละครใหม่',
  generic: 'ตัวประกอบใหม่',
  alias: 'คำเรียกใหม่',
  appearance: 'รูปลักษณ์',
  status: 'เปลี่ยนสถานะ',
}
const STATUS_LABEL: Record<string, string> = { dead: 'เสียชีวิต', left: 'แยกทาง', 'changed-side': 'เปลี่ยนฝ่าย', returned: 'กลับมา' }
const CHAPTER_BUDGET = 1500
const VOLUME_BUDGET = 4000
const SHORT_BUDGET = 800

function describe(p: Proposal): string {
  const v = p.value as Record<string, unknown>
  if (p.kind === 'character' || p.kind === 'generic') return `${p.key} · ${String(v.name ?? '')}${v.role ? ` · ${String(v.role)}` : ''}`
  if (p.kind === 'alias') return `${p.key} ← "${String(v.alias ?? '')}"`
  if (p.kind === 'status') return `${p.key} → ${STATUS_LABEL[String(v.status)] ?? String(v.status)}`
  return `${p.key}: ${String(v.appearance ?? '')}`
}

export default function StoryPanel({ book }: { book: string }) {
  const [story, setStory] = useState<StoryOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    studioApi.story(book).then(
      (s) => {
        setStory(s)
        setError(null)
      },
      (err) => setError(errorText(err)),
    )
  }, [book])

  useEffect(() => load(), [load])

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setError(null)
    try {
      await fn()
      load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const pending = story?.proposals.filter((p) => p.state === 'pending') ?? []
  const characters = Object.entries(story?.characters ?? {})
  const notes = (story?.notes ?? []).filter(
    (n) => (n.questions as unknown[])?.length || (n.speakingStyles as unknown[])?.length || (n.promotedGenerics as unknown[])?.length,
  )

  return (
    <>
      <StudioNav crumbs={[{ label: 'หนังสือ & สถานะ', href: '/studio' }, { label: story?.title ?? book }, { label: 'ตัวละคร & เนื้อเรื่อง' }]} />
      <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-6">
        {error ? <Notice tone="error">{error}</Notice> : null}

        <section className={`${card} flex flex-col gap-2`}>
          <h2 className="text-[17px] font-bold text-fg">ข้อเสนอจาก AI ที่รอตัดสิน ({pending.length})</h2>
          <p className="text-[12px] text-fg2">
            รับ = เขียนลง characters.json ทันที · บทที่ยังมีข้อเสนอค้างจะแปลงเป็นแชทไม่ได้ · รับตัวละครใหม่ก่อนคำเรียกของคนนั้น
          </p>
          {pending.length === 0 ? <p className="text-[14px] text-fg2">ไม่มีข้อเสนอค้าง</p> : null}
          <ul className="flex flex-col gap-2">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-[14px]">
                <Pill tone="part">{KIND_LABEL[p.kind] ?? p.kind}</Pill>
                <span className="min-w-0 flex-1 text-fg">
                  {describe(p)}
                  <span className="block text-[12px] text-fg2">
                    เล่ม {p.volume}
                    {p.chapter ? ` บทที่ ${p.chapter}` : ''} · {p.evidence}
                  </span>
                </span>
                <button type="button" className={`${btnPrimary} min-h-9`} disabled={busy !== null} onClick={() => act(p.id, () => studioApi.decide(book, p.id, true))}>
                  รับ
                </button>
                <button type="button" className={`${btnGhost} min-h-9`} disabled={busy !== null} onClick={() => act(p.id, () => studioApi.decide(book, p.id, false))}>
                  ไม่รับ
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${card} flex flex-col gap-2`}>
          <h2 className="text-[17px] font-bold text-fg">ทะเบียนตัวละคร ({characters.length})</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {characters.map(([key, c]) => (
              <li key={key} className="flex items-start gap-2 rounded-lg border border-line p-2 text-[13px]">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: String(c.color ?? '#999') }} aria-hidden />
                <span className="min-w-0">
                  <span className="font-semibold text-fg">{String(c.name ?? key)}</span> <span className="text-fg2">({key})</span>
                  {c.generic ? <span className="text-fg2"> · ตัวประกอบ</span> : null}
                  {c.status ? <span className="text-[#8a1f14]"> · {STATUS_LABEL[String(c.status)] ?? String(c.status)}</span> : null}
                  {Array.isArray(c.aliases) && c.aliases.length ? <span className="block text-fg2">เรียกว่า {c.aliases.join(', ')}</span> : null}
                  {c.firstSeen ? <span className="block text-fg2">เจอครั้งแรก {String(c.firstSeen)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${card} flex flex-col gap-3`}>
          <h2 className="text-[17px] font-bold text-fg">เนื้อเรื่อง: บท → เล่ม</h2>
          <p className="text-[12px] text-fg2">
            สรุปที่อนุมัติแล้วเป็นบริบทให้การแปลงบทถัดไป · งบ: บท ≤{CHAPTER_BUDGET.toLocaleString()} · เล่ม ≤{VOLUME_BUDGET.toLocaleString()} · เล่มฉบับสั้น ≤{SHORT_BUDGET} ตัวอักษร (เกินงบ backend ไม่รับ)
          </p>
          {story?.volumes.map((v) => (
            <VolumeSummaries key={v.n} book={book} volume={v} busy={busy} act={act} />
          ))}
        </section>

        <section className={`${card} flex flex-col gap-2`}>
          <h2 className="text-[17px] font-bold text-fg">ข้อสังเกตเฉพาะเรื่อง</h2>
          <p className="whitespace-pre-wrap text-[14px] text-fg">{story?.styleNotes || 'ยังไม่มี styleNotes (แก้ได้ที่หน้า Studio → แก้ไขหนังสือ)'}</p>
          {notes.map((n) => (
            <div key={`${n.volume}-${n.chapter}`} className="rounded-lg border border-line p-2 text-[13px] text-fg2">
              <span className="font-semibold text-fg">
                จากการสแกน เล่ม {String(n.volume)} บทที่ {String(n.chapter)}
              </span>
              {(n.questions as string[]).map((q) => (
                <span key={q} className="block">
                  ❓ {q}
                </span>
              ))}
              {(n.speakingStyles as { key: string; speakingStyle: string }[]).map((s) => (
                <span key={s.key} className="block">
                  🗣 {s.key}: {s.speakingStyle}
                </span>
              ))}
              {(n.promotedGenerics as { fromGeneric: string; toKey: string }[]).map((g) => (
                <span key={g.toKey} className="block">
                  ↑ ตัวประกอบ {g.fromGeneric} ได้ชื่อเป็น {g.toKey}
                </span>
              ))}
            </div>
          ))}
        </section>
      </main>
    </>
  )
}

function VolumeSummaries({
  book,
  volume,
  busy,
  act,
}: {
  book: string
  volume: VolumeStory
  busy: string | null
  act: (key: string, fn: () => Promise<unknown>) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-fg">
        เล่ม {volume.n}
        {volume.title ? ` · ${volume.title}` : ''}
        {volume.imported ? <Pill tone="none">นำเข้าของเดิม (ข้ามตัวกั้นสรุป)</Pill> : null}
        {volume.closed ? <Pill tone="ok">ปิดเล่มแล้ว</Pill> : null}
      </h3>
      {volume.chapters.length === 0 ? <p className="text-[13px] text-fg2">ยังไม่มีขอบเขตบท</p> : null}
      {volume.chapters.map((c) => (
        <SummaryRow
          key={c.n}
          label={`บทที่ ${c.n}${c.title ? ` · ${c.title}` : ''}`}
          approved={c.approved}
          pending={c.pending}
          budget={CHAPTER_BUDGET}
          busy={busy !== null}
          onApprove={(summary) => act(`v${volume.n}-c${c.n}`, () => studioApi.approveSummary(book, volume.n, c.n, summary))}
        />
      ))}
      <SummaryRow
        label="สรุปทั้งเล่ม"
        approved={volume.volume}
        pending={volume.volumePending}
        budget={VOLUME_BUDGET}
        withShort
        busy={busy !== null}
        onApprove={(summary, short) => act(`v${volume.n}`, () => studioApi.approveSummary(book, volume.n, null, summary, short))}
      />
    </div>
  )
}

function SummaryRow({
  label,
  approved,
  pending,
  budget,
  withShort = false,
  busy,
  onApprove,
}: {
  label: string
  approved: Record<string, unknown> | null
  pending: Record<string, unknown> | null
  budget: number
  withShort?: boolean
  busy: boolean
  onApprove: (summary: string, short?: string) => void
}) {
  const [text, setText] = useState(String(pending?.summary ?? ''))
  const [short, setShort] = useState(String(pending?.short ?? ''))
  useEffect(() => {
    setText(String(pending?.summary ?? ''))
    setShort(String(pending?.short ?? ''))
  }, [pending?.summary, pending?.short]) // eslint-disable-line react-hooks/exhaustive-deps
  const over = text.length > budget || (withShort && (short.length > SHORT_BUDGET || !short.trim()))

  return (
    <div className="flex flex-col gap-1 text-[14px]">
      <span className="flex items-center gap-2 font-semibold text-fg">
        {label}
        {approved ? <Pill tone="ok">อนุมัติแล้ว</Pill> : pending ? <Pill tone="part">รออนุมัติ</Pill> : <Pill tone="none">ยังไม่สรุป</Pill>}
      </span>
      {approved && !pending ? <p className="whitespace-pre-wrap text-fg2">{String(approved.summary ?? '')}</p> : null}
      {pending ? (
        <div className="flex flex-col gap-1">
          <textarea aria-label={`สรุป ${label}`} rows={5} className={`${input} py-2 leading-relaxed`} value={text} onChange={(e) => setText(e.target.value)} />
          {withShort ? (
            <textarea aria-label={`สรุปฉบับสั้น ${label}`} rows={2} className={`${input} py-2`} value={short} onChange={(e) => setShort(e.target.value)} />
          ) : null}
          <span className="flex items-center gap-2 text-[12px] text-fg2">
            {text.length.toLocaleString()} / {budget.toLocaleString()} ตัวอักษร
            {withShort ? ` · ฉบับสั้น ${short.length} / ${SHORT_BUDGET}` : ''}
            <button type="button" className={`${btnPrimary} ml-auto min-h-9`} disabled={busy || over || !text.trim()} onClick={() => onApprove(text, withShort ? short : undefined)}>
              อนุมัติสรุป
            </button>
          </span>
        </div>
      ) : null}
    </div>
  )
}
