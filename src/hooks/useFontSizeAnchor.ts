'use client'

import { useCallback, useRef } from 'react'

// plan.md §4.5 — เปลี่ยนขนาดฟอนต์แล้วต้องไม่กระเด็น ห้ามเก็บ scrollY ไว้คืนค่า
// ใช้ block-anchor: หา el แรกที่ rect.bottom > 0 เก็บ index + ratio ก่อนเปลี่ยนค่า --text-body
// แล้วหลัง re-layout หา el เดิมจาก data-block-index แล้ว scrollTo ตามสูตรเป๊ะๆ ตามที่ plan.md ให้ไว้
export function useFontSizeAnchor() {
  const anchorRef = useRef<{ index: number; ratio: number } | null>(null)

  // เรียกก่อนเปลี่ยน --text-body (ก่อน setState ที่ trigger การเปลี่ยนฟอนต์)
  const captureAnchor = useCallback(() => {
    const blocks = document.querySelectorAll<HTMLElement>('[data-block-index]')
    for (const el of blocks) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > 0) {
        const index = Number(el.dataset.blockIndex)
        if (!Number.isNaN(index)) {
          anchorRef.current = { index, ratio: (0 - rect.top) / rect.height }
        }
        break
      }
    }
  }, [])

  // หลัง re-layout (useLayoutEffect ของผู้เรียก → requestAnimationFrame) ให้เรียกอันนี้เพื่อคืนตำแหน่ง
  const restoreAnchor = useCallback(() => {
    const anchor = anchorRef.current
    anchorRef.current = null
    if (!anchor) return

    requestAnimationFrame(() => {
      const el2 = document.querySelector<HTMLElement>(`[data-block-index="${anchor.index}"]`)
      if (!el2) return
      window.scrollTo({
        top: el2.offsetTop + anchor.ratio * el2.offsetHeight,
        behavior: 'instant' as ScrollBehavior,
      })
    })
  }, [])

  return { captureAnchor, restoreAnchor }
}
