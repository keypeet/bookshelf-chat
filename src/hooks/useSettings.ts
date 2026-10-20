'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSettings, setSettings as saveSettings } from '@/lib/storage'
import type { Settings } from '@/lib/storage'

// ค่า default ฝั่ง server/ก่อน mount — ต้องตรงกับ DEFAULT_SETTINGS ใน storage.ts (§4.6 ข้อ 4:
// ห้าม render จาก localStorage ตรงๆ ตอน initial render)
const INITIAL_SETTINGS: Settings = { fontSize: 'md', theme: 'system', readMode: 'scroll' }

// theme มี 3 ค่าฝั่ง JS แต่ data-theme ที่ CSS เห็นต้องมีแค่ 'light'/'dark' เท่านั้น (plan.md §4.6 ข้อ 1)
function resolveTheme(theme: Settings['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

function applyToHtml(settings: Settings) {
  const html = document.documentElement
  html.setAttribute('data-theme', resolveTheme(settings.theme))
  html.setAttribute('data-font', settings.fontSize)
}

// plan.md §4.1 Phase 4 — เขียน data-theme/data-font ที่ <html> ทุกครั้งที่ settings เปลี่ยน
// resolve system เป็นค่าจริงเสมอ + ผูก matchMedia ให้สลับตามเมื่อเลือก system แล้วเครื่องเปลี่ยนธีมกลางคัน
// ค่าคงอยู่ข้ามการเปิดใหม่ผ่าน storage.ts เท่านั้น
export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(INITIAL_SETTINGS)

  // เติมค่าจริงจาก localStorage หลัง mount (ห้าม render จาก localStorage ตรงๆ ตอน initial render)
  useEffect(() => {
    const stored = getSettings()
    setSettingsState(stored)
    applyToHtml(stored)
  }, [])

  // ทุกครั้งที่ settings เปลี่ยน (รวมครั้งแรกหลัง mount) ให้เขียน attribute ที่ <html>
  useEffect(() => {
    applyToHtml(settings)
  }, [settings])

  // ผู้ใช้เลือก system แล้วเครื่องสลับธีมกลางคัน — ต้องตามทันทีโดยไม่ต้อง reload
  useEffect(() => {
    if (settings.theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => applyToHtml(settings)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [settings])

  const update = useCallback((partial: Partial<Settings>) => {
    setSettingsState((current) => {
      const next = { ...current, ...partial }
      saveSettings(partial)
      return next
    })
  }, [])

  return { settings, update }
}
