'use client'

// แผงโมเดล CLI ในเครื่อง (D11): เปิด/ปิดตัวที่จะใช้ เลือกโมเดล + ระดับการคิด = ค่าเริ่มต้นตอนสั่งงาน
// 🔒 ตรวจสิทธิ์ด้วยการเรียกจริง 1 ครั้ง เฉพาะเมื่อผู้ใช้กด "ตรวจสิทธิ์"
import { useEffect, useState } from 'react'
import { errorText, studioApi, type ProbeOut, type ProviderOut } from '@/lib/studio/api'
import { getStudioModels, setStudioModels, type StudioModelChoice } from '@/lib/storage'
import { btnGhost, card, input, Notice, Pill } from './ui'

const TASK_LABEL: Record<string, string> = { ocr: 'OCR', scan: 'สแกนตัวละคร', convert: 'แปลงแชท', summarize: 'สรุป', ask: 'ถามตอบ' }

export function defaultChoice(provider: ProviderOut): StudioModelChoice {
  const model = provider.models[0]
  return { enabled: provider.id === 'agy', model: model.value, effort: model.efforts[0] }
}

// โมเดลของงานหนึ่ง: ตัวที่เลือก หรือตัวแรกที่เปิดสวิตช์ไว้ในหน้า Studio → ใช้รุ่น/ระดับการคิดที่ตั้งไว้
export function modelFor(providers: ProviderOut[], pick: string | null) {
  const prefs = getStudioModels()
  const provider = providers.find((p) => p.id === pick) ?? providers.find((p) => prefs[p.id]?.enabled) ?? providers[0]
  if (!provider) return null
  const choice = prefs[provider.id] ?? defaultChoice(provider)
  const model = provider.models.find((m) => m.value === choice.model) ?? provider.models[0]
  const effort = model.efforts.includes(choice.effort) ? choice.effort : model.efforts[0]
  return { provider: provider.id, model: model.value, effort, label: `${provider.label} · ${model.label} · ${effort}` }
}

export default function ModelPanel() {
  const [providers, setProviders] = useState<ProviderOut[] | null>(null)
  const [choices, setChoices] = useState<Record<string, StudioModelChoice>>({})
  const [probes, setProbes] = useState<Record<string, ProbeOut | 'running'>>({})
  const [error, setError] = useState<string | null>(null)

  async function load(refresh = false) {
    try {
      setProviders(await studioApi.providers(refresh))
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }

  useEffect(() => {
    setChoices(getStudioModels())
    load()
  }, [])

  function update(provider: ProviderOut, patch: Partial<StudioModelChoice>) {
    const current = choices[provider.id] ?? defaultChoice(provider)
    let next = { ...current, ...patch }
    const model = provider.models.find((m) => m.value === next.model) ?? provider.models[0]
    if (!model.efforts.includes(next.effort)) next = { ...next, model: model.value, effort: model.efforts[0] }
    const all = { ...choices, [provider.id]: next }
    setChoices(all)
    setStudioModels(all)
  }

  async function probe(provider: ProviderOut, choice: StudioModelChoice) {
    setProbes((p) => ({ ...p, [provider.id]: 'running' }))
    try {
      const result = await studioApi.probe(provider.id, choice.model, choice.effort)
      setProbes((p) => ({ ...p, [provider.id]: result }))
    } catch (err) {
      setProbes((p) => ({ ...p, [provider.id]: { ok: false, errorKind: 'error', detail: errorText(err), durationMs: 0 } }))
    }
  }

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <div className="flex items-center gap-3">
        <h2 className="text-[17px] font-bold text-fg">โมเดล (CLI ในเครื่องนี้)</h2>
        <button type="button" className={`${btnGhost} ml-auto min-h-9`} onClick={() => load(true)}>
          ตรวจใหม่
        </button>
      </div>
      <p className="text-[13px] text-fg2">
        เปิดสวิตช์ของตัวที่จะใช้ แล้วเลือกโมเดลและระดับการคิด · ค่าที่เลือกเป็นค่าเริ่มต้นตอนสั่ง OCR (เก็บในเบราว์เซอร์นี้) · 🔒 =
        บัญชีนี้ไม่มีสิทธิ์ (ตรวจจากการเรียกทดสอบจริง 1 ครั้ง)
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {providers === null && !error ? <p className="text-[14px] text-fg2">กำลังตรวจ CLI…</p> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {providers?.map((provider) => {
          const choice = choices[provider.id] ?? defaultChoice(provider)
          const model = provider.models.find((m) => m.value === choice.model) ?? provider.models[0]
          const result = probes[provider.id]
          return (
            <li key={provider.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-fg">
                    {provider.label}{' '}
                    {result && result !== 'running' && !result.ok ? <span title={result.detail}>🔒</span> : null}
                  </p>
                  <p className="truncate text-[12px] text-fg2">
                    {provider.status.available ? provider.status.version : provider.status.detail}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-[13px] text-fg2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--accent)]"
                    checked={choice.enabled}
                    disabled={!provider.status.available}
                    onChange={(e) => update(provider, { enabled: e.target.checked })}
                  />
                  ใช้
                </label>
              </div>
              <div className="flex flex-wrap gap-1">
                {provider.tasks.map((task) => (
                  <Pill key={task} tone={provider.vision.includes(task) || task !== 'ocr' ? 'ok' : 'none'}>
                    {TASK_LABEL[task] ?? task}
                  </Pill>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-[13px] text-fg2">
                โมเดล
                <select className={input} value={model.value} onChange={(e) => update(provider, { model: e.target.value })}>
                  {provider.models.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1 text-[13px] text-fg2">
                ระดับการคิด
                <div className="flex gap-1 rounded-xl bg-bg p-1" role="radiogroup" aria-label={`ระดับการคิดของ ${provider.label}`}>
                  {model.efforts.map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      role="radio"
                      aria-checked={choice.effort === effort}
                      onClick={() => update(provider, { effort })}
                      className={`min-h-9 flex-1 rounded-lg text-[13px] font-semibold ${
                        choice.effort === effort ? 'bg-card text-fg shadow' : 'text-fg2'
                      }`}
                    >
                      {effort}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`${btnGhost} min-h-9`}
                  disabled={!provider.status.available || result === 'running'}
                  onClick={() => probe(provider, choice)}
                >
                  {result === 'running' ? 'กำลังตรวจ…' : 'ตรวจสิทธิ์'}
                </button>
                {result && result !== 'running' ? (
                  <span className="text-[12px] text-fg2">
                    {result.ok ? `ใช้ได้ (${Math.round(result.durationMs / 1000)} วิ)` : `ใช้ไม่ได้: ${result.errorKind}`}
                  </span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
