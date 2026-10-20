'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHROME_HIDE_DELTA,
  CHROME_SHOW_DELTA,
  CHROME_TOP_LOCK,
  TAP_COOLDOWN,
} from '@/lib/constants'

// กฎ scroll ตาม plan.md §4.2 — scroll container คือ window เท่านั้น
// - listener { passive: true }, อัปเดต state ใน requestAnimationFrame (ไม่ใช่ setState ตรงทุก event)
// - ไม่ทำงานช่วง overscroll (scrollY <= CHROME_TOP_LOCK หรือใกล้ scrollHeight สุด)
// - ท้ายตอน sentinel intersect → ล็อกโชว์ค้าง จนกว่าจะเลื่อนขึ้น (ผู้เรียกสั่งผ่าน lockVisible)
export function useReaderChrome() {
  const [visible, setVisible] = useState(true)
  const lastYRef = useRef(0)
  const accumRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const tapCooldownUntilRef = useRef(0)
  const endLockRef = useRef(false)

  useEffect(() => {
    lastYRef.current = window.scrollY
  }, [])

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null

      const y = window.scrollY
      const delta = y - lastYRef.current
      lastYRef.current = y

      // ช่วง overscroll (rubber-band บนสุด/ล่างสุด) — เมิน ไม่ตัดสินใจอะไร
      const atTop = y <= CHROME_TOP_LOCK
      const atBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 2

      if (atTop) {
        accumRef.current = 0
        setVisible(true)
        return
      }

      if (atBottom) {
        // overscroll ล่างสุด — ไม่สั่งซ่อน/โชว์จากตรงนี้ (กัน rubber-band กระตุก)
        return
      }

      if (endLockRef.current) {
        // ท้ายตอนล็อกโชว์ค้าง จนกว่าจะเลื่อนขึ้น (delta < 0)
        if (delta < 0) {
          endLockRef.current = false
          accumRef.current = 0
          setVisible(true)
        }
        return
      }

      // cooldown หลังแตะ toggle เอง — ห้าม scroll handler สั่งซ่อน
      if (Date.now() < tapCooldownUntilRef.current) {
        return
      }

      // สะสม delta ไปในทิศทางเดียวกัน ถ้าเปลี่ยนทิศ ให้เริ่มนับใหม่
      if ((delta > 0 && accumRef.current < 0) || (delta < 0 && accumRef.current > 0)) {
        accumRef.current = 0
      }
      accumRef.current += delta

      if (accumRef.current > CHROME_HIDE_DELTA) {
        setVisible(false)
        accumRef.current = 0
      } else if (accumRef.current < -CHROME_SHOW_DELTA) {
        setVisible(true)
        accumRef.current = 0
      }
    })
  }, [])

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [handleScroll])

  // เรียกจาก gesture handler (§4.1) ตอน toggle chrome ด้วยการแตะ
  const toggle = useCallback(() => {
    tapCooldownUntilRef.current = Date.now() + TAP_COOLDOWN
    setVisible((v) => !v)
  }, [])

  // เรียกตอน end-sentinel intersect / ออกจากระยะ intersect
  const setEndLock = useCallback((locked: boolean) => {
    endLockRef.current = locked
    if (locked) setVisible(true)
  }, [])

  return { visible, toggle, setEndLock }
}
