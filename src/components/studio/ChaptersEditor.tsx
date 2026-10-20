'use client'

// ขอบเขตบทเป็นข้อมูลของคน (book.json → volumes[].chapters): marker จาก OCR เป็นแค่ค่าเสนอ
// "จบเล่มที่หน้า N" ปิดบทสุดท้าย
import { useEffect, useState } from 'react'
import { errorText, studioApi, type BookCard, type PagesOut } from '@/lib/studio/api'
import { btnGhost, btnPrimary, card, input, Notice } from './ui'

interface Row {
  n: number
  startImage: number
  title?: string | null
}

export default function ChaptersEditor({
  book,
  volume,
  card: bookCard,
  pages,
  onSaved,
}: {
  book: string
  volume: number
  card: BookCard | null
  pages: PagesOut | null
  onSaved: () => void
}) {
  const saved = bookCard?.volumes?.find((v) => v.n === volume)
  const [rows, setRows] = useState<Row[]>([])
  const [endImage, setEndImage] = useState<string>('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  // ซิงก์จากไฟล์เมื่อค่าที่บันทึกเปลี่ยนจริง — ไม่ใช่ทุกครั้งที่หน้าโหลดข้อมูลใหม่ (ไม่งั้นทับที่ผู้ใช้กำลังแก้)
  const savedKey = JSON.stringify(saved ?? null)
  useEffect(() => {
    const value = JSON.parse(savedKey) as typeof saved | null
    setRows(value?.chapters?.map((c) => ({ n: c.n, startImage: c.startImage, title: c.title })) ?? [])
    setEndImage(value?.endImage ? String(value.endImage) : '')
  }, [savedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // บทละหนึ่งหน้าเริ่ม: หน้าที่มีหลาย marker ใช้ตัวแรก (ขอบเขตบทซ้ำหน้ากันไม่ได้); คงชื่อบทเดิมไว้
  function fromMarkers() {
    const found = new Map<number, number>()
    for (const page of pages?.pages ?? []) {
      const n = page.marker.find((m) => !found.has(m))
      if (n !== undefined) found.set(n, page.image)
    }
    const titles = new Map(rows.map((r) => [r.n, r.title]))
    setRows([...found.entries()].sort((a, b) => a[1] - b[1]).map(([n, startImage]) => ({ n, startImage, title: titles.get(n) })))
  }

  async function save() {
    setMessage(null)
    try {
      await studioApi.setChapters(book, volume, {
        chapters: rows.map((r) => ({ n: r.n, startImage: r.startImage, ...(r.title ? { title: r.title } : {}) })),
        endImage: endImage ? Number(endImage) : null,
      })
      setMessage({ tone: 'ok', text: 'บันทึกขอบเขตบทแล้ว (book.json — commit เองที่ library/)' })
      onSaved()
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) })
    }
  }

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <section className={`${card} flex flex-col gap-2`}>
      <h2 className="text-[15px] font-bold text-fg">ขอบเขตบท</h2>
      <p className="text-[12px] text-fg2">
        บทเริ่มที่หน้าไหน — ใช้กั้นการสแกน/แปลงทีละบท · เล่ม{saved?.closed ? `ปิดแล้วที่หน้า ${saved.endImage}` : 'ยังไม่ปิด'}
      </p>
      <table className="text-[13px]">
        <thead className="text-left text-fg2">
          <tr>
            <th className="font-normal">บทที่</th>
            <th className="font-normal">เริ่มหน้า</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <input type="number" min={1} className={`${input} min-h-9 w-16`} value={r.n} onChange={(e) => set(i, { n: Number(e.target.value) })} aria-label="เลขบท" />
              </td>
              <td className="py-1 pr-2">
                <input
                  type="number"
                  min={1}
                  className={`${input} min-h-9 w-20`}
                  value={r.startImage}
                  onChange={(e) => set(i, { startImage: Number(e.target.value) })}
                  aria-label={`หน้าเริ่มบทที่ ${r.n}`}
                />
              </td>
              <td>
                <button type="button" className="text-[13px] text-fg2 hover:text-red-700" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  ลบ
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${btnGhost} min-h-9`}
          onClick={() => setRows([...rows, { n: (rows.at(-1)?.n ?? 0) + 1, startImage: (rows.at(-1)?.startImage ?? 0) + 1 }])}
        >
          + เพิ่มบท
        </button>
        <button type="button" className={`${btnGhost} min-h-9`} onClick={fromMarkers}>
          ใช้ marker จาก OCR
        </button>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-fg2">
        จบเล่มที่หน้า
        <input type="number" min={1} className={`${input} min-h-9 w-20`} value={endImage} onChange={(e) => setEndImage(e.target.value)} placeholder="—" />
      </label>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <button type="button" className={btnPrimary} onClick={save}>
        บันทึกขอบเขตบท
      </button>
    </section>
  )
}
