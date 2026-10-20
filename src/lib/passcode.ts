// ประตู passcode ของเว็บที่ deploy (plan.md §3) — ตั้ง SITE_PASSCODE ใน env ของโฮสต์; ไม่ตั้ง = ไม่มีประตู (dev)
// cookie เก็บ hash ของ passcode ไม่ใช่ตัว passcode — เปลี่ยน passcode แล้ว cookie เดิมใช้ไม่ได้เอง
export const PASS_COOKIE = 'site_pass'
export const PASS_MAX_AGE = 60 * 60 * 24 * 30 // 30 วัน

export async function passToken(passcode: string): Promise<string> {
  const data = new TextEncoder().encode(`bookshelf-chat:${passcode}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ปลายทางหลังปลดล็อก: path ภายในเว็บเท่านั้น (กัน open redirect ไปเว็บอื่น)
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}
