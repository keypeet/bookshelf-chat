'use client'

// เพิ่ม/แก้หนังสือ + ปก 2 แบบ (D12): อัปโหลดรูป หรือสีพื้น + ชื่อเรื่อง — "จากหน้า PDF" มาหลังเฟส 4
import { useState } from 'react'
import { errorText, studioApi, type BookCard } from '@/lib/studio/api'
import { btnPrimary, card, input, Notice, Stepper } from './ui'

const COLORS: [string, string][] = [
  ['เขียว', '#2f6f4e'],
  ['น้ำเงิน', '#3f5f8f'],
  ['น้ำตาล', '#8a5a2b'],
  ['ม่วง', '#6a4a8a'],
  ['เทาเข้ม', '#4a443c'],
]

interface Props {
  book: BookCard | null // null = เพิ่มเรื่องใหม่
  onSaved: (book: BookCard, message: string) => void // ข้อความแสดงที่หน้าแม่ เพราะฟอร์มถูกสร้างใหม่หลังสร้างเรื่อง
}

export default function BookForm({ book, onSaved }: Props) {
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState(book?.title ?? '')
  const [author, setAuthor] = useState(book?.author ?? '')
  const [styleNotes, setStyleNotes] = useState(book?.styleNotes ?? '')
  const [coverMode, setCoverMode] = useState<'upload' | 'color' | 'page'>(book?.cover ? 'upload' : 'color')
  const [pageVolume, setPageVolume] = useState(1)
  const [pageImage, setPageImage] = useState(1)
  const [color, setColor] = useState(book?.coverColor ?? COLORS[0][1])
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      let saved: BookCard
      if (book) {
        saved = await studioApi.updateBook(book.slug, {
          title,
          author: author || null,
          styleNotes: styleNotes || null,
          coverColor: coverMode === 'color' ? color : book.coverColor ?? null,
          removeCover: coverMode === 'color',
        })
      } else {
        saved = await studioApi.createBook({
          slug,
          title,
          author: author || null,
          styleNotes: styleNotes || null,
          coverColor: coverMode === 'color' ? color : null,
        })
      }
      if (coverMode === 'upload' && file) saved = await studioApi.uploadCover(saved.slug, file)
      if (coverMode === 'page') saved = await studioApi.coverFromPage(saved.slug, pageVolume, pageImage)
      onSaved(saved, book ? 'บันทึกแล้ว' : `สร้าง ${saved.slug} แล้ว`)
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  const tab = (on: boolean) =>
    `min-h-10 flex-1 rounded-lg text-[14px] font-semibold ${on ? 'bg-card text-fg shadow' : 'text-fg2'}`

  return (
    <form onSubmit={submit} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-[17px] font-bold text-fg">{book ? `แก้ไข: ${book.title}` : 'เพิ่มหนังสือใหม่'}</h2>
      {!book ? (
        <label className="flex flex-col gap-1 text-[13px] text-fg2">
          slug (ชื่อโฟลเดอร์ใน library/ — a-z, 0-9, -)
          <input className={input} value={slug} onChange={(e) => setSlug(e.target.value.trim())} placeholder="เช่น my-novel" required />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-[13px] text-fg2">
        ชื่อเรื่อง
        <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-fg2">
        ผู้แต่ง
        <input className={input} value={author} onChange={(e) => setAuthor(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-fg2">
        ข้อสังเกตเฉพาะเรื่อง (ส่งให้ AI ทุกครั้ง)
        <textarea
          className={`${input} min-h-24 py-2`}
          value={styleNotes}
          onChange={(e) => setStyleNotes(e.target.value)}
          placeholder="เช่น สำนวนภาษา วิธีเขียนบทพูด ชื่อเฉพาะที่สะกดพิเศษ"
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] text-fg2">ปกหนังสือ</legend>
        <div className="flex gap-1 rounded-xl bg-bg p-1">
          <button type="button" className={tab(coverMode === 'upload')} onClick={() => setCoverMode('upload')}>
            อัปโหลดรูป
          </button>
          <button type="button" className={tab(coverMode === 'color')} onClick={() => setCoverMode('color')}>
            สีพื้น
          </button>
          {book ? (
            <button type="button" className={tab(coverMode === 'page')} onClick={() => setCoverMode('page')}>
              จากหน้า PDF
            </button>
          ) : null}
        </div>
        {coverMode === 'page' && book ? (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- ภาพหน้าจาก backend ผ่าน proxy */}
            <img
              src={studioApi.pageImageUrl(book.slug, pageVolume, pageImage)}
              alt={`หน้า ${pageImage} ของเล่ม ${pageVolume}`}
              className="h-32 w-24 rounded-md border border-line bg-bg object-cover"
            />
            <div className="flex flex-col gap-2">
              <Stepper label="เล่ม" value={pageVolume} max={999} onChange={setPageVolume} />
              <Stepper label="หน้า (ภาพ)" value={pageImage} max={9999} onChange={setPageImage} />
              <span className="text-[12px] text-fg2">ภาพยังไม่ขึ้น = หน้านี้ยังไม่ถูกแปลงจาก PDF — กดบันทึกแล้วระบบแปลงให้</span>
            </div>
          </div>
        ) : null}
        {coverMode === 'page' ? null : coverMode === 'upload' ? (
          <label className="flex flex-col gap-1 text-[13px] text-fg2">
            เลือกไฟล์ภาพ (JPG / PNG / WebP) — ย่อและแปลงเป็น webp ให้อัตโนมัติ
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <div className="flex items-center gap-3">
            <div
              className="flex h-32 w-24 items-center justify-center rounded-md p-2 text-center text-[14px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {title || '[ชื่อเรื่อง]'}
            </div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="สีพื้นปก">
              {COLORS.map(([name, hex]) => (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={color === hex}
                  aria-label={name}
                  onClick={() => setColor(hex)}
                  className={`h-10 w-10 rounded-full text-[14px] font-bold text-white ${color === hex ? 'ring-2 ring-fg ring-offset-2' : ''}`}
                  style={{ backgroundColor: hex }}
                >
                  {color === hex ? '✓' : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </fieldset>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? 'กำลังบันทึก…' : book ? 'บันทึกการแก้ไข' : 'สร้างหนังสือ'}
      </button>
    </form>
  )
}
