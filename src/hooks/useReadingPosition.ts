'use client'

import { useEffect, useRef, useState } from 'react'
import { getPosition, setPosition } from '@/lib/storage'

// D2 ตาม plan.md §4.4
// - throttle 500ms หา element แรกที่ rect.bottom > 0 เก็บ data-block-index ลง positions[chapterId]
// - ตอนกลับเข้ามา: ห้ามเลื่อนเอง — ถ้า positions[chapterId] > 0 ให้ผู้เรียก (ContinueReadingCapsule)
//   โชว์ปุ่มเอง แล้วเรียก scrollToSaved() เมื่อผู้ใช้กด
export function useReadingPosition(book: string, chapterId: string) {
  const [savedPosition, setSavedPosition] = useState<number | null>(null)
  const throttleRef = useRef(false)
  const dismissedRef = useRef(false)

  // อ่านตำแหน่งที่ค้างไว้ตอน mount ของตอนนี้ (ไม่เลื่อนจอเอง แค่โชว์ตัวเลข)
  useEffect(() => {
    const pos = getPosition(book, chapterId)
    setSavedPosition(pos > 0 ? pos : null)
    dismissedRef.current = false
  }, [book, chapterId])

  // บันทึกตำแหน่งปัจจุบันขณะเลื่อน (throttle 500ms ผ่าน requestAnimationFrame + setTimeout)
  useEffect(() => {
    // ReaderShell สั่ง scrollTo(0) ตอน mount/เปลี่ยนตอน (J3) — ยิง scroll event เดียวกันนี้
    // ถ้าเริ่มฟังทันทีจะเข้าใจผิดว่า "ผู้ใช้เลื่อนเอง" แล้วซ่อนแคปซูลก่อนผู้ใช้ทันเห็น
    // เลื่อน 1 animation frame ให้ scrollTo(0) ที่เกิดจากโปรแกรมจบก่อนค่อยเริ่มฟัง
    let listening = false
    const raf = requestAnimationFrame(() => {
      listening = true
    })

    const recordPosition = () => {
      if (!listening) return
      if (throttleRef.current) return
      throttleRef.current = true
      setTimeout(() => {
        throttleRef.current = false
      }, 500)

      const blocks = document.querySelectorAll<HTMLElement>('[data-block-index]')
      for (const el of blocks) {
        if (el.getBoundingClientRect().bottom > 0) {
          const index = Number(el.dataset.blockIndex)
          if (!Number.isNaN(index)) setPosition(book, chapterId, index)
          break
        }
      }

      // ผู้ใช้เลื่อนเอง — ซ่อนแคปซูล "อ่านต่อจากที่ค้าง"
      if (!dismissedRef.current) {
        dismissedRef.current = true
        setSavedPosition(null)
      }
    }

    window.addEventListener('scroll', recordPosition, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', recordPosition)
    }
  }, [book, chapterId])

  const dismiss = () => setSavedPosition(null)

  const scrollToSaved = () => {
    if (savedPosition === null) return
    const el = document.querySelector(`[data-block-index="${savedPosition}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setSavedPosition(null)
  }

  return { savedPosition, scrollToSaved, dismiss }
}
