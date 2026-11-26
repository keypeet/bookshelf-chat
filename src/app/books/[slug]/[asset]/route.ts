import { readFile, stat } from 'node:fs/promises'
import { resolveBookAsset } from '@/lib/book-assets'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ slug: string; asset: string }> }) {
  const { slug, asset } = await context.params
  const served = resolveBookAsset(slug, asset)
  if (!served) return new Response(null, { status: 404 })

  const info = await stat(served.filePath)
  const etag = `W/"${info.mtimeMs}-${info.size}"`
  const headers: Record<string, string> = {
    ETag: etag,
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  }
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }

  const body = await readFile(served.filePath)
  headers['Content-Type'] = served.contentType
  headers['Content-Length'] = String(body.byteLength)
  if (served.contentType === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  }
  return new Response(body, { headers })
}
