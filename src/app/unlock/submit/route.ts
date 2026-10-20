// รับรหัสจากหน้า /unlock → ถูก = ตั้ง cookie (hash ของรหัส, httpOnly) แล้วกลับไปหน้าที่ตั้งใจเปิด
import { NextResponse, type NextRequest } from 'next/server'
import { PASS_COOKIE, PASS_MAX_AGE, passToken, safeNext } from '@/lib/passcode'

export async function POST(request: NextRequest) {
  const form = await request.formData()
  const next = safeNext(String(form.get('next') ?? '/'))
  const passcode = process.env.SITE_PASSCODE
  if (!passcode) return NextResponse.redirect(new URL(next, request.url), 303)
  const given = String(form.get('passcode') ?? '')
  if ((await passToken(given)) !== (await passToken(passcode))) {
    const back = new URL('/unlock', request.url)
    back.searchParams.set('next', next)
    back.searchParams.set('e', '1')
    return NextResponse.redirect(back, 303)
  }
  const response = NextResponse.redirect(new URL(next, request.url), 303)
  response.cookies.set(PASS_COOKIE, await passToken(passcode), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PASS_MAX_AGE,
  })
  return response
}
