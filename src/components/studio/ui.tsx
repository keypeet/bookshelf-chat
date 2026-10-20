// ชิ้นส่วนเล็ก ๆ ที่หน้า Studio ใช้ร่วมกัน — สี/ระยะตาม token เดียวกับ Reader
import Link from 'next/link'

export const btn =
  'inline-flex min-h-10 items-center justify-center gap-1 rounded-full px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50'
export const btnPrimary = `${btn} bg-accent text-white hover:opacity-90`
export const btnGhost = `${btn} border border-line bg-card text-fg hover:border-accent`
export const input =
  'min-h-10 w-full rounded-lg border border-line bg-card px-3 text-[15px] text-fg outline-none focus:border-accent'
export const card = 'rounded-xl border border-line bg-card p-4'

export function StudioNav({ crumbs }: { crumbs: { label: string; href?: string }[] }) {
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <Link href="/studio" className="text-[17px] font-bold text-fg">
          Studio
        </Link>
        {crumbs.map((crumb) => (
          <span key={crumb.label} className="flex items-center gap-3 text-[14px] text-fg2">
            <span aria-hidden>/</span>
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-accent">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-fg">{crumb.label}</span>
            )}
          </span>
        ))}
        <Link href="/" className="ml-auto text-[14px] text-fg2 hover:text-accent">
          ← กลับไปหน้าอ่าน
        </Link>
      </div>
    </header>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: React.ReactNode }) {
  const style =
    tone === 'error'
      ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
      : tone === 'ok'
        ? 'border-accent/40 bg-bubble-me text-fg'
        : 'border-line bg-bg text-fg2'
  return <p className={`rounded-lg border px-3 py-2 text-[14px] ${style}`}>{children}</p>
}

export function Pill({ tone, children }: { tone: 'ok' | 'part' | 'none' | 'bad'; children: React.ReactNode }) {
  const style = {
    ok: 'bg-[#e1f0e7] text-[#1f5039]',
    part: 'bg-[#fbeed6] text-[#7a4a00]',
    none: 'bg-[#ece6dc] text-[#4a443c]',
    bad: 'bg-[#f8e0dd] text-[#8a1f14]',
  }[tone]
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${style}`}>{children}</span>
}

export function Stepper({
  label,
  value,
  min = 1,
  max = 9999,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)))
  return (
    <label className="flex flex-col gap-1 text-[13px] text-fg2">
      {label}
      <span className="flex items-center gap-1">
        <button type="button" className={`${btnGhost} w-10 px-0`} onClick={() => set(value - 1)} aria-label={`ลด ${label}`}>
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          className={`${input} w-20 text-center`}
          value={value}
          min={min}
          max={max}
          onChange={(e) => set(Number(e.target.value))}
        />
        <button type="button" className={`${btnGhost} w-10 px-0`} onClick={() => set(value + 1)} aria-label={`เพิ่ม ${label}`}>
          +
        </button>
      </span>
    </label>
  )
}
