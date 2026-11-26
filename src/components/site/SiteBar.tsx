'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/', label: 'ห้องสมุด' },
  { href: '/browse', label: 'สารบัญ' },
  { href: '/studio', label: 'สตูดิโอ' },
] as const

function sectionOf(pathname: string): string {
  if (pathname.startsWith('/studio')) return '/studio'
  if (pathname.startsWith('/browse') || pathname.startsWith('/book')) return '/browse'
  return '/'
}

export default function SiteBar() {
  const section = sectionOf(usePathname())
  return (
    <header className="flex items-center justify-between gap-4 px-5 py-[22px] sm:px-14">
      <Link href="/" className="font-serif text-[22px] font-medium text-ink no-underline">
        ชั้นหนังสือแชท
      </Link>
      <nav className="flex gap-[18px]">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={section === item.href ? 'page' : undefined}
            className="border-b border-transparent text-sm font-semibold text-ink no-underline aria-[current=page]:border-current"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
