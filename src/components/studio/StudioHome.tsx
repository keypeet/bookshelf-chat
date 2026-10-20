'use client'

// หน้าแรก Studio: หนังสือ + สถานะต่อเล่ม (คำนวณจากไฟล์ที่ backend) + ฟอร์มเพิ่ม/แก้ + แผงโมเดล CLI
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { errorText, studioApi, type BookCard, type BookStatus } from '@/lib/studio/api'
import BookForm from './BookForm'
import ModelPanel from './ModelPanel'
import { btnGhost, card, Notice, Pill, StudioNav } from './ui'

function chatPill(ocr: number, chat: number) {
  if (ocr === 0) return <Pill tone="none">ยังไม่มีให้แปลง</Pill>
  if (chat === 0) return <Pill tone="none">ยังไม่ได้แปลง</Pill>
  if (chat >= ocr) return <Pill tone="ok">แปลงครบแล้ว</Pill>
  return <Pill tone="part">แปลงบางส่วน</Pill>
}

export default function StudioHome() {
  const [books, setBooks] = useState<BookCard[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, BookStatus>>({})
  const [editing, setEditing] = useState<string | null>(null) // slug หรือ '' = เพิ่มใหม่
  const [newVolume, setNewVolume] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await studioApi.books()
      setBooks(list)
      setError(null)
      const entries = await Promise.all(list.map(async (b) => [b.slug, await studioApi.status(b.slug)] as const))
      setStatuses(Object.fromEntries(entries))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const editingBook = editing ? (books?.find((b) => b.slug === editing) ?? null) : null

  return (
    <>
      <StudioNav crumbs={[{ label: 'หนังสือ & สถานะ' }]} />
      <main className="mx-auto grid w-full max-w-[1100px] gap-4 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={`${card} flex flex-col gap-3`}>
            <div className="flex items-center gap-3">
              <h1 className="text-[20px] font-bold text-fg">หนังสือ</h1>
              <button
                type="button"
                className={`${btnGhost} ml-auto min-h-9`}
                onClick={() => {
                  setSaved(null)
                  setEditing('')
                }}
              >
                + เพิ่มหนังสือ
              </button>
            </div>
            {error ? <Notice tone="error">{error}</Notice> : null}
            {books === null && !error ? <p className="text-[14px] text-fg2">กำลังโหลด…</p> : null}
            {books?.length === 0 ? <p className="text-[14px] text-fg2">ยังไม่มีหนังสือใน library/</p> : null}
            <ul className="flex flex-col gap-3">
              {books?.map((book) => {
                const status = statuses[book.slug]
                const next = newVolume[book.slug] ?? (status ? Math.max(0, ...status.volumes.map((v) => v.n)) + 1 : 1)
                return (
                  <li key={book.slug} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="text-[16px] font-semibold text-fg">{book.title}</p>
                      <p className="text-[13px] text-fg2">
                        {book.author ?? '—'} · {book.slug}
                      </p>
                      <button
                        type="button"
                        className="ml-auto text-[13px] text-accent"
                        onClick={() => {
                          setSaved(null)
                          setEditing(book.slug)
                        }}
                      >
                        แก้ไข / ปก
                      </button>
                    </div>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left text-[13px]">
                        <thead className="text-fg2">
                          <tr>
                            <th className="py-1 font-normal">เล่ม</th>
                            <th className="py-1 font-normal">หน้า / OCR</th>
                            <th className="py-1 font-normal">แปลงเป็นแชท</th>
                            <th className="py-1 font-normal">Publish</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {status?.volumes.map((v) => (
                            <tr key={v.n} className="border-t border-line">
                              <td className="py-2 text-fg">
                                เล่ม {v.n}
                                {v.title ? <span className="text-fg2"> · {v.title}</span> : null}
                              </td>
                              <td className="py-2 text-fg">
                                {v.ocrPages} / {v.pages || '?'} หน้า
                                {!v.hasSource ? <span className="block text-[12px] text-fg2">ยังไม่มี PDF</span> : null}
                              </td>
                              <td className="py-2">
                                {chatPill(v.ocrPages, v.chatPages)}
                                {v.ocrPages ? <span className="ml-1 text-fg2">{v.chatPages} / {v.ocrPages}</span> : null}
                              </td>
                              <td className="py-2 text-fg">{v.publishedChapters} ตอน</td>
                              <td className="py-2 text-right">
                                <Link className="font-semibold text-accent" href={`/studio/books/${book.slug}/v/${v.n}`}>
                                  ทำงาน →
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[13px] text-fg2">
                      เล่มใหม่
                      <input
                        type="number"
                        min={1}
                        className="min-h-9 w-16 rounded-lg border border-line bg-card px-2 text-fg"
                        value={next}
                        onChange={(e) => setNewVolume({ ...newVolume, [book.slug]: Number(e.target.value) })}
                      />
                      <Link className="font-semibold text-accent" href={`/studio/books/${book.slug}/v/${next}`}>
                        เปิดเล่ม {next} →
                      </Link>
                      <Link className="ml-auto font-semibold text-accent" href={`/studio/books/${book.slug}/story`}>
                        ตัวละคร & เนื้อเรื่อง →
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="text-[12px] text-fg2">
              ข้อมูลนี้อ่านจาก library/ (ขึ้น git) · ภาพหน้า/PDF อยู่ workdir/ (ไม่ขึ้น git) · commit/push เป็นของคุณ
            </p>
          </section>
          <ModelPanel />
        </div>
        <aside className="flex flex-col gap-4">
          {editing !== null ? (
            <>
              {saved ? <Notice tone="ok">{saved}</Notice> : null}
              <BookForm
                key={editing}
                book={editingBook}
                onSaved={(card, message) => {
                  // ใส่เรื่องที่บันทึกลงรายการทันที ให้ฟอร์มที่สร้างใหม่ได้ค่าล่าสุด แล้วค่อยโหลดสถานะ
                  setBooks((list) =>
                    [...(list ?? []).filter((b) => b.slug !== card.slug), card].sort((a, b) => a.slug.localeCompare(b.slug)),
                  )
                  setSaved(message)
                  setEditing(card.slug)
                  load()
                }}
              />
            </>
          ) : (
            <section className={card}>
              <p className="text-[14px] text-fg2">กด “แก้ไข / ปก” ที่หนังสือ หรือ “+ เพิ่มหนังสือ” เพื่อเปิดฟอร์ม</p>
            </section>
          )}
        </aside>
      </main>
    </>
  )
}
