import type { Metadata } from 'next'
import { safeNext } from '@/lib/passcode'

export const metadata: Metadata = { title: 'ใส่รหัสผ่าน · ชั้นหนังสือแชท' }

// หน้าใส่ passcode — proxy.ts ส่งมาที่นี่เมื่อตั้ง SITE_PASSCODE และยังไม่มี cookie ที่ถูก
export default async function Unlock({ searchParams }: { searchParams: Promise<{ next?: string; e?: string }> }) {
  const { next, e } = await searchParams
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-bg px-4 py-16">
      <form method="post" action="/unlock/submit" className="flex w-full max-w-[360px] flex-col gap-3 rounded-xl border border-line bg-card p-5">
        <h1 className="text-[20px] font-bold text-fg">ชั้นหนังสือแชท</h1>
        <p className="text-[14px] text-fg2">เว็บนี้เปิดเฉพาะคนที่มีรหัส</p>
        <input type="hidden" name="next" value={safeNext(next)} />
        <label className="flex flex-col gap-1 text-[13px] text-fg2">
          รหัสผ่าน
          <input
            name="passcode"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            className="min-h-11 rounded-lg border border-line bg-bg px-3 text-[16px] text-fg outline-none focus:border-accent"
          />
        </label>
        {e ? <p className="text-[14px] text-[#8a1f14] dark:text-red-300">รหัสไม่ถูกต้อง</p> : null}
        <button type="submit" className="min-h-11 rounded-full bg-accent text-[15px] font-semibold text-white hover:opacity-90">
          เข้าอ่าน
        </button>
      </form>
    </main>
  )
}
