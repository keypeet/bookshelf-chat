import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Avatar from '@/components/chat/Avatar'
import SiteBar from '@/components/site/SiteBar'
import { getBooksForRequest, getCharacters } from '@/lib/content'
import { resolveCharacter } from '@/lib/characters'
import { isSiteV2 } from '@/lib/site-v2'

interface CharactersPageProps {
  params: Promise<{ book: string }>
}

export async function generateMetadata({ params }: CharactersPageProps): Promise<Metadata> {
  if (!isSiteV2()) return {}
  const { book } = await params
  const found = (await getBooksForRequest()).find((item) => item.slug === book)
  return found ? { title: `ตัวละคร · ${found.title}` } : {}
}

export default async function CharactersPage({ params }: CharactersPageProps) {
  if (!isSiteV2()) notFound()
  const { book } = await params
  const info = (await getBooksForRequest()).find((item) => item.slug === book)
  if (!info) notFound()
  const characters = getCharacters(book)
  const entries = Object.keys(characters)
    .filter((key) => key !== 'unknown')
    .map((key) => resolveCharacter(book, key, characters))
  const mainCharacters = entries
    .filter((entry) => !entry.character.generic)
    .sort((a, b) => {
      const orderA = a.character.order
      const orderB = b.character.order
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB
      if (orderA !== undefined) return -1
      if (orderB !== undefined) return 1
      return 0
    })
  const genericCharacters = entries.filter((entry) => entry.character.generic)

  return (
    <div className="min-h-dvh overflow-x-hidden bg-paper bg-[radial-gradient(900px_420px_at_70%_-10%,rgba(255,255,255,0.72),transparent_62%)] text-ink">
      <SiteBar />
      <main className="mx-auto mb-[72px] w-[min(880px,calc(100%-40px))]">
        <Link href={`/book/${book}`} className="text-sm text-ink-soft no-underline">
          ← {info.title}
        </Link>
        <h1 className="mt-2 font-serif text-[clamp(28px,4vw,36px)] font-medium">ตัวละคร</h1>
        <ul className="mt-6 flex list-none flex-wrap gap-2.5 p-0">
          {mainCharacters.map(({ key, character, avatar }) => (
            <li key={key} className="flex items-center gap-2.5 rounded-full bg-paper-deep py-2 pr-3 pl-2">
              <Avatar avatar={avatar} size={28} />
              <span>
                {character.name}
                {character.role ? ` · ${character.role}` : ''}
              </span>
            </li>
          ))}
        </ul>
        {genericCharacters.length > 0 ? (
          <p className="mt-8 text-sm text-ink-soft">ตัวประกอบ · {genericCharacters.map((entry) => entry.character.name).join(' · ')}</p>
        ) : null}
      </main>
    </div>
  )
}
