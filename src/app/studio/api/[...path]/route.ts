// Studio → backend proxy: /studio/api/<path> → http://127.0.0.1:8000/api/<path>
// เปิดเฉพาะ STUDIO=1; แนบ STUDIO_TOKEN (อยู่ฝั่ง server เท่านั้น) และส่ง Origin ต่อให้ backend ตรวจซ้ำ
// ใช้ route handler แทน next.config rewrites เพราะ rewrites แนบ header ไม่ได้
import { notFound } from 'next/navigation'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const BACKEND = `http://127.0.0.1:${process.env.STUDIO_API_PORT ?? '8000'}`
const FORWARD_HEADERS = ['content-type', 'accept', 'origin']
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (process.env.STUDIO !== '1') notFound()

  // proxy นี้แนบ token ให้ทุก request จึงต้องกันเอง: Host ต้องเป็นเครื่องนี้ (กัน DNS rebinding / เครื่องอื่นใน LAN)
  // และ request ที่เปลี่ยนสถานะต้องมี Origin ของเว็บนี้ (เบราว์เซอร์ส่งเสมอ; ไม่มี = ไม่ใช่หน้า Studio)
  const hostHeader = (request.headers.get('host') ?? '').toLowerCase()
  if (!LOCAL_HOSTS.has(hostHeader.replace(/:\d+$/, ''))) {
    return Response.json({ detail: 'Host not allowed.' }, { status: 400 })
  }
  // เทียบกับ Host ที่เบราว์เซอร์ส่งมา (nextUrl.origin ถูก Next แปลง 127.0.0.1 เป็น localhost)
  const origin = request.headers.get('origin')
  const originHost = origin === null ? null : URL.canParse(origin) ? new URL(origin).host.toLowerCase() : ''
  const changesState = request.method !== 'GET' && request.method !== 'HEAD'
  if ((changesState && origin === null) || (originHost !== null && originHost !== hostHeader)) {
    return Response.json({ detail: 'Origin not allowed.' }, { status: 403 })
  }

  const { path } = await params
  const target = `${BACKEND}/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`
  const headers = new Headers({ 'x-studio-token': process.env.STUDIO_TOKEN ?? '' })
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // @ts-expect-error duplex is required by Node fetch for streamed request bodies
      duplex: hasBody ? 'half' : undefined,
      cache: 'no-store',
    })
    const out = new Headers()
    for (const name of ['content-type', 'content-length', 'cache-control']) {
      const value = response.headers.get(name)
      if (value !== null) out.set(name, value)
    }
    return new Response(response.body, { status: response.status, headers: out })
  } catch {
    return Response.json(
      { detail: 'ติดต่อ backend ไม่ได้ — รัน npm run studio หรือ uv run --directory backend uvicorn app.main:app' },
      { status: 502 },
    )
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE }
