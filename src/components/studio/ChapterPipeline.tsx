'use client'

// ขั้น ③–⑦ ของเล่ม ทีละบท: สแกนตัวละคร → แปลงเป็นแชท (แบ่ง call ทีละ N หน้า) → ตรวจ/publish → สรุปบท → สรุปเล่ม
// ตัวกั้นแข็งมาจาก backend (dry run); ตัวกั้นอ่อน "บทก่อนหน้ายังไม่สรุป" ข้ามได้ด้วยการติ๊กยอมรับความเสี่ยง
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  errorText,
  studioApi,
  type ConvertJobCreated,
  type DraftRow,
  type ProviderOut,
  type VolumeStatus,
} from '@/lib/studio/api'
import { modelFor } from './ModelPanel'
import { btnGhost, btnPrimary, card, Notice, Pill, Stepper } from './ui'

type Plan = ConvertJobCreated['plan']

export function reviewHref(book: string, volume: number, id: string) {
  return `/studio/books/${encodeURIComponent(book)}/v/${volume}/review/${id}`
}

export function storyHref(book: string) {
  return `/studio/books/${encodeURIComponent(book)}/story`
}

interface Props {
  book: string
  volume: number
  status: VolumeStatus | null
  providers: ProviderOut[]
  busy: boolean // มีงานรันอยู่ในเล่มนี้ (backend รับทีละงานต่อเล่ม)
  onChanged: () => void
}

export default function ChapterPipeline({ book, volume, status, providers, busy, onChanged }: Props) {
  const textProviders = providers.filter((p) => p.status.available && p.tasks.includes('convert'))
  const [pick, setPick] = useState<string | null>(null)
  const choice = modelFor(textProviders, pick)
  const model = choice ? { provider: choice.provider, model: choice.model, effort: choice.effort } : null
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [planFor, setPlanFor] = useState<number | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [perCall, setPerCall] = useState(4)
  const [risk, setRisk] = useState(false)

  useEffect(() => {
    studioApi.drafts(book, volume).then(setDrafts, (err) => setError(errorText(err)))
  }, [book, volume, status])

  // แผนการแปลง (dry run) ของบทที่เปิดอยู่ — นับใหม่เมื่อเปลี่ยนจำนวนหน้าต่อ call หรือสถานะเล่ม
  const modelKey = JSON.stringify(model)
  useEffect(() => {
    setPlan(null)
    if (planFor === null || !model) return
    let cancelled = false // คำตอบของแผนเก่า (บท/จำนวนหน้าก่อนหน้า) ที่มาช้า ห้ามทับ
    studioApi
      .convertJob({ book, volume, chapter: planFor, model, pagesPerCall: perCall, dryRun: true })
      .then((r) => !cancelled && setPlan(r.plan), (err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [book, volume, planFor, perCall, modelKey, status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn: () => Promise<unknown>) {
    setSending(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSending(false)
    }
  }

  const chapters = status?.chapters ?? []
  const allSummarized = chapters.length > 0 && chapters.every((c) => c.summarized)
  const disabled = busy || sending || !model

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[17px] font-bold text-fg">③–⑦ ทีละบท: ตัวละคร · แปลงแชท · ตรวจ · สรุป</h2>
        <Link className="ml-auto text-[14px] font-semibold text-accent" href={storyHref(book)}>
          ตัวละคร & เนื้อเรื่อง →
        </Link>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-[13px] text-fg2">
        โมเดลงานข้อความ
        <select
          className="min-h-9 rounded-lg border border-line bg-card px-2 text-[14px] text-fg"
          value={choice?.provider ?? ''}
          onChange={(e) => setPick(e.target.value)}
        >
          {textProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {modelFor(textProviders, p.id)?.label}
            </option>
          ))}
        </select>
        {textProviders.length === 0 ? <span>ไม่มี CLI ที่แปลง/สรุปได้ในเครื่องนี้</span> : null}
      </label>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {busy ? <Notice>มีงานกำลังทำในเล่มนี้ — รอให้จบก่อนสั่งงานใหม่</Notice> : null}
      {chapters.length === 0 ? <p className="text-[14px] text-fg2">ยังไม่มีขอบเขตบท — ตั้งที่แผง "ขอบเขตบท" ก่อน</p> : null}

      <ul className="flex flex-col gap-2">
        {chapters.map((c) => {
          const own = drafts.filter((d) => d.bookChapter === c.n)
          const open = planFor === c.n
          return (
            <li key={c.n} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-fg">
                  บทที่ {c.n}
                  {c.title ? ` · ${c.title}` : ''}
                </span>
                <span className="text-[12px] text-fg2">
                  หน้า {c.startImage}–{c.endImage ?? '…'}
                </span>
                <span className="flex flex-wrap gap-1">
                  <Pill tone={c.rawComplete ? 'ok' : 'none'}>{c.rawComplete ? 'raw ครบ' : 'raw ยังไม่ครบ'}</Pill>
                  <Pill tone={c.scanned ? 'ok' : 'none'}>{c.scanned ? 'สแกนแล้ว' : 'ยังไม่สแกน'}</Pill>
                  {c.drafted ? <Pill tone="part">ร่าง {own.length} ตอน</Pill> : null}
                  {c.published ? <Pill tone="ok">publish แล้ว</Pill> : null}
                  {c.summarized ? <Pill tone="ok">สรุปแล้ว</Pill> : null}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${btnGhost} min-h-9`}
                  disabled={disabled || !c.rawComplete}
                  onClick={() => model && act(() => studioApi.scanJob(book, volume, c.n, model))}
                >
                  {c.scanned ? 'สแกนตัวละครใหม่' : 'สแกนตัวละคร'}
                </button>
                <button
                  type="button"
                  className={`${btnGhost} min-h-9`}
                  aria-expanded={open}
                  disabled={!model}
                  onClick={() => {
                    setRisk(false)
                    setPlanFor(open ? null : c.n)
                  }}
                >
                  {c.drafted ? 'แปลงใหม่…' : 'แปลงเป็นแชท…'}
                </button>
                {own.length ? (
                  <Link className={`${btnGhost} min-h-9`} href={reviewHref(book, volume, own[0].id)}>
                    ตรวจ {own.length} ตอน →
                  </Link>
                ) : null}
                <button
                  type="button"
                  className={`${btnGhost} min-h-9`}
                  disabled={disabled || !c.published || c.drafted}
                  title="สรุปได้เมื่อ publish ครบทั้งบท"
                  onClick={() => model && act(() => studioApi.summarizeJob(book, volume, c.n, model))}
                >
                  {c.summarized ? 'สรุปบทใหม่' : 'สรุปบท'}
                </button>
              </div>

              {open ? (
                <div className="mt-3 flex flex-col gap-2 rounded-lg bg-bg p-3">
                  <Stepper label="หน้าต่อ call" value={perCall} max={14} onChange={setPerCall} />
                  {!plan ? <p className="text-[13px] text-fg2">กำลังวางแผน…</p> : null}
                  {plan ? (
                    <>
                      <p className="text-[14px] text-fg">
                        {plan.pages.length} หน้า ทีละ {perCall} หน้า = {plan.calls} call
                        {plan.covers.length ? ` · ข้ามหน้าปก/ภาพ ${plan.covers.join(', ')}` : ''}
                        {plan.firstEpisode ? ` · ได้ตอนเริ่มที่ v${volume}-c${plan.firstEpisode}` : ''}
                      </p>
                      {plan.blockers.map((b) => (
                        <Notice key={b} tone="error">
                          {b}
                        </Notice>
                      ))}
                      {plan.warnings.map((w) => (
                        <label key={w} className="flex items-start gap-2 text-[13px] text-fg">
                          <input type="checkbox" aria-label="ยอมรับความเสี่ยง" checked={risk} onChange={(e) => setRisk(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
                          <span>
                            {w} — ติ๊กเพื่อแปลงต่อแบบยอมรับความเสี่ยง
                          </span>
                        </label>
                      ))}
                      {c.drafted ? <p className="text-[12px] text-fg2">แปลงใหม่จะเขียนทับร่างเดิมของบทนี้ (รวมที่แก้ไว้)</p> : null}
                      <button
                        type="button"
                        className={btnPrimary}
                        disabled={disabled || plan.blockers.length > 0 || (plan.warnings.length > 0 && !risk) || plan.calls === 0}
                        onClick={() =>
                          model &&
                          act(async () => {
                            await studioApi.convertJob({ book, volume, chapter: c.n, model, pagesPerCall: perCall, acceptRisk: risk })
                            setPlanFor(null)
                          })
                        }
                      >
                        เริ่มแปลง ({plan.calls} call)
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {drafts.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-bold text-fg">ร่างที่รอตรวจ</h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] hover:border-accent" href={reviewHref(book, volume, d.id)}>
                  <span className="font-semibold text-fg">{d.id}</span>
                  <span className="truncate text-fg2">{d.title}</span>
                  <span className="ml-auto flex gap-1">
                    {d.flags ? <Pill tone="part">ธง {d.flags}</Pill> : null}
                    {d.outside ? <Pill tone="bad">นอกทะเบียน {d.outside}</Pill> : null}
                    {!d.flags && !d.outside ? <Pill tone="ok">พร้อม</Pill> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <button
          type="button"
          className={`${btnGhost} min-h-9`}
          disabled={disabled || !status?.closed || !allSummarized}
          title="สรุปเล่มได้เมื่อปิดเล่มและสรุปครบทุกบท"
          onClick={() => model && act(() => studioApi.summarizeJob(book, volume, null, model))}
        >
          {status?.summarized ? 'สรุปเล่มใหม่' : 'สรุปเล่ม'}
        </button>
        <label className="flex items-center gap-2 text-[13px] text-fg2">
          <input
            type="checkbox"
            aria-label="เล่มนี้ publish ก่อนมีระบบสรุป"
            checked={!!status?.imported}
            disabled={sending}
            onChange={(e) => act(() => studioApi.setImported(book, volume, e.target.checked))}
            className="accent-[var(--accent)]"
          />
          เล่มนี้ publish ก่อนมีระบบสรุป (ข้ามตัวกั้น "สรุปแล้ว" ของเล่มนี้)
        </label>
      </div>
    </section>
  )
}
