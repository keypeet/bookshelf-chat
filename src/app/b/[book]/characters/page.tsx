import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBooks, getCharacters } from '@/lib/content'
import { bookHref } from '@/lib/routes'
import { resolveCharacter } from '@/lib/characters'
import Avatar from '@/components/chat/Avatar'
import type { Metadata } from 'next'

interface CharactersPageProps {
  params: Promise<{ book: string }>
}

export const dynamicParams = false

export function generateStaticParams() {
  return getBooks().map((book) => ({ book: book.slug }))
}

export async function generateMetadata({ params }: CharactersPageProps): Promise<Metadata> {
  const { book } = await params
  const found = getBooks().find((b) => b.slug === book)
  return found ? { title: `ตัวละคร · ${found.title}` } : {}
}

// F5.4 — ตัวละครหลัก (การ์ด avatar 48px) กับตัวประกอบ (generic: true, ข้อความล้วน) แยกกันชัด
// เรียงตาม order ถ้ามี ไม่มีก็ใช้ลำดับ key ใน characters.json (insertion order ของ JS object)
// "unknown" มีอยู่จริงเป็น key ใน characters.json (เป็น fallback ตัวละครไม่ระบุที่ resolveCharacter ใช้ตอน runtime)
// แต่ไม่ใช่ตัวละครที่ควรโชว์ในหน้านี้ — กรองออกด้วยชื่อ key ตรงๆ
export default async function CharactersPage({ params }: CharactersPageProps) {
  const { book } = await params
  if (!getBooks().some((b) => b.slug === book)) notFound()
  const characters = getCharacters(book)
  const entries = Object.keys(characters)
    .filter((key) => key !== 'unknown')
    .map((key) => resolveCharacter(book, key, characters))

  const mainCharacters = entries.filter((entry) => !entry.character.generic)
  const genericCharacters = entries.filter((entry) => entry.character.generic)

  const sortedMain = [...mainCharacters].sort((a, b) => {
    const orderA = a.character.order
    const orderB = b.character.order
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB
    if (orderA !== undefined) return -1
    if (orderB !== undefined) return 1
    return 0 // ทั้งคู่ไม่มี order — sort เสถียร คงลำดับ key เดิม
  })

  return (
    <div className="flex flex-1 flex-col items-center bg-bg">
      <main className="w-full max-w-[640px] flex-1 px-4 py-10 sm:py-16">
        <Link href={bookHref(book)} className="mb-6 inline-block text-[14px] text-fg2">
          ← กลับสารบัญ
        </Link>
        <h1 className="mb-8 text-center text-2xl font-bold text-fg">ตัวละคร</h1>

        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {sortedMain.map(({ key, character, avatar }) => (
            <li
              key={key}
              className="flex flex-col items-center gap-2 rounded-xl border border-line bg-card p-4 text-center"
            >
              <Avatar avatar={avatar} size={48} />
              <span className="text-[15px] font-semibold text-fg">{character.name}</span>
              {character.role ? (
                <span className="text-[13px] text-fg2">{character.role}</span>
              ) : null}
            </li>
          ))}
        </ul>

        {genericCharacters.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-3 text-[15px] font-semibold text-fg2">ตัวประกอบ</h2>
            <p className="text-[15px] leading-[1.9] text-fg2">
              {genericCharacters.map((entry) => entry.character.name).join(' · ')}
            </p>
          </section>
        ) : null}
      </main>
    </div>
  )
}
