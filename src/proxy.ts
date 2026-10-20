// ประตู passcode ทุกหน้า (Next 16: proxy.ts แทน middleware.ts) — ไม่ตั้ง SITE_PASSCODE = เปิดโล่ง (dev / Studio ในเครื่อง)
import { NextResponse, type NextRequest } from 'next/server'
import { PASS_COOKIE, passToken } from '@/lib/passcode'

export async function proxy(request: NextRequest) {
  const passcode = process.env.SITE_PASSCODE
  if (!passcode) return NextResponse.next()
  const { pathname, search } = request.nextUrl
  if (pathname === '/unlock' || pathname === '/unlock/submit') return NextResponse.next()
  if (request.cookies.get(PASS_COOKIE)?.value === (await passToken(passcode))) return NextResponse.next()
  const url = new URL('/unlock', request.url)
  url.searchParams.set('next', pathname + search)
  return NextResponse.redirect(url)
}

export const config = {
  // ไฟล์ build ของ Next และ favicon ไม่มีเนื้อหา; ปก/avatar ใน /books/* ถูกกั้นด้วย
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
