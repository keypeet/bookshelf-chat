'use client'

import { useEffect, useState } from 'react'
import { SCROLLTOP_SHOW } from '@/lib/constants'

interface ScrollTopButtonProps {
  chromeVisible: boolean
}

// F3.4 — โผล่หลัง scroll เกิน SCROLLTOP_SHOW (400px) และเฉพาะตอน chrome โชว์อยู่
export default function ScrollTopButton({ chromeVisible }: ScrollTopButtonProps) {
  const [pastThreshold, setPastThreshold] = useState(false)

  useEffect(() => {
    let raf: number | null = null
    function handleScroll() {
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        setPastThreshold(window.scrollY > SCROLLTOP_SHOW)
      })
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  const visible = pastThreshold && chromeVisible

  return (
    <button
      type="button"
      data-no-tap
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={`fixed bottom-20 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-fg shadow-md transition-[transform,opacity] duration-200 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      ↑
    </button>
  )
}
