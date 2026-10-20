'use client'

import { useEffect, useRef } from 'react'
import type { FontSize, ReadMode, Settings, Theme } from '@/lib/storage'

interface SettingsSheetProps {
  open: boolean
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
  onClose: () => void
}

const FONT_OPTIONS: { value: FontSize; label: string }[] = [
  { value: 'sm', label: 'เล็ก' },
  { value: 'md', label: 'ปกติ' },
  { value: 'lg', label: 'ใหญ่' },
  { value: 'xl', label: 'ใหญ่มาก' },
]

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'สว่าง' },
  { value: 'dark', label: 'มืด' },
  { value: 'system', label: 'ตามเครื่อง' },
]

const READ_MODE_OPTIONS: { value: ReadMode; label: string }[] = [
  { value: 'scroll', label: 'เลื่อนอ่าน' },
  { value: 'tap', label: 'แตะไล่' },
]

// Phase 4 — bottom sheet บนมือถือ / dialog กลางจอบนเดสก์ท็อป (ตัดสินด้วย CSS media query ล้วน)
// แตะข้างนอก/Escape ปิดได้เหมือน ChapterPicker · ทุกปุ่มติด data-no-tap + พื้นที่กด >=44px
export default function SettingsSheet({ open, settings, onChange, onClose }: SettingsSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-fg/30 sm:items-center" data-no-tap>
      <div
        ref={panelRef}
        data-no-tap
        role="dialog"
        aria-modal="true"
        aria-label="ตั้งค่าการอ่าน"
        className="w-full max-w-[420px] rounded-t-2xl border border-line bg-card p-5 shadow-lg sm:rounded-2xl"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-fg">ตั้งค่าการอ่าน</h2>
          <button
            type="button"
            data-no-tap
            onClick={onClose}
            aria-label="ปิด"
            className="flex h-11 w-11 items-center justify-center rounded-full text-fg2"
          >
            ✕
          </button>
        </div>

        <fieldset className="mb-5">
          <legend className="mb-2 text-[13px] font-medium text-fg2">ขนาดตัวอักษร</legend>
          <div className="grid grid-cols-4 gap-2">
            {FONT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-no-tap
                aria-pressed={settings.fontSize === opt.value}
                onClick={() => onChange({ fontSize: opt.value })}
                className={`min-h-11 rounded-lg border px-2 py-2 text-[14px] ${
                  settings.fontSize === opt.value
                    ? 'border-accent bg-bubble-me font-semibold text-accent'
                    : 'border-line text-fg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-2 text-[13px] font-medium text-fg2">ธีม</legend>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-no-tap
                aria-pressed={settings.theme === opt.value}
                onClick={() => onChange({ theme: opt.value })}
                className={`min-h-11 rounded-lg border px-2 py-2 text-[14px] ${
                  settings.theme === opt.value
                    ? 'border-accent bg-bubble-me font-semibold text-accent'
                    : 'border-line text-fg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-fg2">โหมดอ่าน</legend>
          <div className="grid grid-cols-2 gap-2">
            {READ_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-no-tap
                aria-pressed={settings.readMode === opt.value}
                onClick={() => onChange({ readMode: opt.value })}
                className={`min-h-11 rounded-lg border px-2 py-2 text-[14px] ${
                  settings.readMode === opt.value
                    ? 'border-accent bg-bubble-me font-semibold text-accent'
                    : 'border-line text-fg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  )
}
