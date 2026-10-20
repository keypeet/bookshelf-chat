'use client'

// ตรวจร่างแชทก่อน publish: ข้อความ OCR ↔ บล็อกแชท · ไล่ธง needsReview · เลือกผู้พูดจากทะเบียน
// · ตัวกรอง "ผู้พูดที่อนุมาน" · publish ได้เมื่อ backend ไม่เหลือปัญหา (ธง / ผู้พูดนอกทะเบียน / coverage ของบท)
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { errorText, studioApi, type BlockIn, type DraftDetail } from '@/lib/studio/api'
import { reviewHref } from './ChapterPipeline'
import { btnGhost, btnPrimary, card, input, Notice, Pill, StudioNav } from './ui'

type Filter = 'all' | 'flagged' | 'inferred'
const TYPES: BlockIn['type'][] = ['narration', 'dialogue', 'thought', 'scene', 'gap']
const TYPE_LABEL: Record<BlockIn['type'], string> = {
  narration: 'บรรยาย',
  dialogue: 'พูด',
  thought: 'คิด',
  scene: 'คั่นฉาก',
  gap: 'รอยขาด',
}
const spoken = (b: BlockIn) => b.type === 'dialogue' || b.type === 'thought'

// gap เก็บข้อความใน note ส่วนชนิดอื่นใช้ text — ย้ายข้อความตามเมื่อเปลี่ยนชนิด ไม่ให้หายตอนบันทึก
function retype(b: BlockIn, type: BlockIn['type']): Partial<BlockIn> {
  if (type === 'gap') return { type, note: b.note || b.text || '', text: undefined }
  if (b.type === 'gap') return { type, text: b.text || b.note || '', note: undefined }
  return { type }
}

export default function DraftReview({ book, volume, id }: { book: string; volume: number; id: string }) {
  const router = useRouter()
  const [detail, setDetail] = useState<DraftDetail | null>(null)
  const [blocks, setBlocks] = useState<BlockIn[]>([])
  const [dirty, setDirty] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const show = useCallback((next: DraftDetail) => {
    setDetail(next)
    setBlocks((next.draft.blocks as BlockIn[]) ?? [])
    setDirty(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    studioApi.draft(book, id).then(
      (next) => !cancelled && show(next),
      (err) => !cancelled && setMessage({ tone: 'error', text: errorText(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [book, id, show])

  function edit(index: number, patch: Partial<BlockIn>) {
    setBlocks((all) => all.map((b, i) => (i === index ? { ...b, ...patch } : b)))
    setDirty(true)
  }

  function addNarration() {
    setBlocks((all) => [...all, { type: 'narration', text: '' }])
    setDirty(true)
  }

  function remove(index: number) {
    setBlocks((all) => all.filter((_, i) => i !== index))
    setDirty(true)
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      show(await studioApi.saveDraft(book, id, blocks))
      setMessage({ tone: 'ok', text: 'บันทึกแล้ว' })
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!detail) return
    setBusy(true)
    setMessage(null)
    try {
      await studioApi.publish(book, id)
      const next = detail.siblings.find((s) => s !== id)
      router.push(next ? reviewHref(book, volume, next) : `/studio/books/${encodeURIComponent(book)}/v/${volume}`)
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) })
      setBusy(false)
    }
  }

  const speakers = detail?.speakers ?? []
  const generic = new Set(speakers.filter((s) => s.generic).map((s) => s.key))
  const at = detail?.siblings.indexOf(id) ?? -1
  const prev = at > 0 ? detail?.siblings[at - 1] : undefined
  const next = detail && at >= 0 ? detail.siblings[at + 1] : undefined
  const visible = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => filter === 'all' || (filter === 'flagged' ? b.needsReview : spoken(b) && (b.needsReview || !!b.note)))
  const cover = detail?.coverage

  return (
    <>
      <StudioNav
        crumbs={[
          { label: 'หนังสือ & สถานะ', href: '/studio' },
          { label: `เล่ม ${volume}`, href: `/studio/books/${encodeURIComponent(book)}/v/${volume}` },
          { label: `ตรวจ ${id}` },
        ]}
      />
      <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-6">
        <section className={`${card} flex flex-wrap items-center gap-2`}>
          <h1 className="min-w-0 flex-1 text-[19px] font-bold text-fg">
            {id} · {String(detail?.draft.title ?? '')}
          </h1>
          {prev ? (
            <Link className={`${btnGhost} min-h-9`} href={reviewHref(book, volume, prev)} aria-label="ร่างก่อนหน้า">
              ← {prev}
            </Link>
          ) : null}
          {next ? (
            <Link className={`${btnGhost} min-h-9`} href={reviewHref(book, volume, next)} aria-label="ร่างถัดไป">
              {next} →
            </Link>
          ) : null}
        </section>

        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

        {detail ? (
          <section className={`${card} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-center gap-2 text-[14px] text-fg">
              <span>
                coverage ทั้งบท <strong>{cover?.ratio ?? '-'}</strong> (ต้อง 0.97–1.03)
              </span>
              <Pill tone={cover?.ok ? 'ok' : 'bad'}>{cover?.ok ? 'ผ่าน' : 'ไม่ผ่าน'}</Pill>
              <span className="ml-auto flex gap-2">
                <button type="button" className={btnGhost} disabled={busy || !dirty} onClick={save}>
                  บันทึก
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy || dirty || detail.problems.length > 0}
                  title={dirty ? 'บันทึกก่อน publish' : undefined}
                  onClick={publish}
                >
                  publish ตอนนี้
                </button>
              </span>
            </div>
            {detail.problems.length ? (
              <ul className="list-disc pl-5 text-[13px] text-[#8a1f14]">
                {detail.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-fg2">ไม่มีปัญหาที่กั้น publish</p>
            )}
            {cover?.missing.length ? (
              <details className="text-[13px] text-fg2">
                <summary>ย่อหน้าที่หาไม่เจอในบล็อก ({cover.missing.length})</summary>
                <ul className="list-disc pl-5">
                  {cover.missing.map((m) => (
                    <li key={m}>{m}…</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${card} flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[85vh] lg:overflow-auto`}>
            <h2 className="text-[16px] font-bold text-fg">ข้อความ OCR (raw)</h2>
            {detail?.raw.map((r) => (
              <div key={r.image} className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-fg2">ภาพหน้า {r.image}</span>
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{r.text}</p>
              </div>
            ))}
          </section>

          <section className={`${card} flex min-w-0 flex-col gap-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-bold text-fg">บล็อกแชท ({blocks.length})</h2>
              <span className="ml-auto flex gap-1" role="group" aria-label="กรองบล็อก">
                {(
                  [
                    ['all', 'ทั้งหมด'],
                    ['flagged', `มีธง ${blocks.filter((b) => b.needsReview).length}`],
                    ['inferred', 'ผู้พูดที่อนุมาน'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={`min-h-9 rounded-full border px-3 text-[13px] ${filter === key ? 'border-accent bg-bubble-me text-fg' : 'border-line text-fg2'}`}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
            {visible.length === 0 ? <p className="text-[14px] text-fg2">ไม่มีบล็อกในตัวกรองนี้</p> : null}
            <ol className="flex flex-col gap-2">
              {visible.map(({ b, i }) => (
                <li key={i} className={`flex flex-col gap-2 rounded-lg border p-2 ${b.needsReview ? 'border-[#ecd29c] bg-[#fff8e6] dark:bg-transparent' : 'border-line'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-fg2">#{i + 1}</span>
                    <select
                      aria-label="ชนิดบล็อก"
                      className="min-h-9 rounded-lg border border-line bg-card px-2 text-[13px] text-fg"
                      value={b.type}
                      onChange={(e) => edit(i, retype(b, e.target.value as BlockIn['type']))}
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    {spoken(b) ? (
                      <select
                        aria-label="ผู้พูด"
                        className="min-h-9 rounded-lg border border-line bg-card px-2 text-[13px] text-fg"
                        value={b.speaker ?? 'unknown'}
                        onChange={(e) => edit(i, { speaker: e.target.value, speakerNum: generic.has(e.target.value) ? b.speakerNum : undefined })}
                      >
                        {!speakers.some((s) => s.key === b.speaker) ? <option value={b.speaker ?? 'unknown'}>⚠ {b.speaker ?? 'unknown'} (นอกทะเบียน)</option> : null}
                        {speakers.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.name} ({s.key})
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {spoken(b) && b.speaker && generic.has(b.speaker) ? (
                      <input
                        aria-label="เลขตัวประกอบ"
                        type="number"
                        min={1}
                        className={`${input} w-20`}
                        value={b.speakerNum ?? ''}
                        onChange={(e) => edit(i, { speakerNum: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    ) : null}
                    <label className="ml-auto flex items-center gap-1 text-[13px] text-fg">
                      <input
                        type="checkbox"
                        aria-label={`ธง needsReview บล็อก ${i + 1}`}
                        checked={!!b.needsReview}
                        onChange={(e) => edit(i, { needsReview: e.target.checked || undefined })}
                        className="accent-[var(--accent)]"
                      />
                      ธง
                    </label>
                    <button type="button" className="text-[13px] text-fg2 hover:text-accent" onClick={() => remove(i)} aria-label={`ลบบล็อก ${i + 1}`}>
                      ลบ
                    </button>
                  </div>
                  {b.type === 'gap' ? (
                    <input aria-label="บันทึกรอยขาด" className={input} value={b.note ?? ''} onChange={(e) => edit(i, { note: e.target.value })} />
                  ) : (
                    <textarea
                      aria-label="ข้อความ"
                      rows={Math.min(8, Math.max(2, Math.ceil((b.text ?? '').length / 60)))}
                      className={`${input} py-2 leading-relaxed`}
                      value={b.text ?? ''}
                      onChange={(e) => edit(i, { text: e.target.value })}
                    />
                  )}
                  {spoken(b) ? (
                    <input
                      aria-label="กิริยาประกอบ (action)"
                      placeholder="กิริยาประกอบ (action) — ไม่มีก็เว้นว่าง"
                      className={input}
                      value={b.action ?? ''}
                      onChange={(e) => edit(i, { action: e.target.value || undefined })}
                    />
                  ) : null}
                  {b.note && b.type !== 'gap' ? <p className="text-[12px] text-fg2">หมายเหตุจาก AI: {b.note}</p> : null}
                </li>
              ))}
            </ol>
            <button type="button" className={`${btnGhost} self-start`} onClick={addNarration}>
              + เพิ่มบล็อกบรรยายท้ายตอน
            </button>
          </section>
        </div>
      </main>
    </>
  )
}
