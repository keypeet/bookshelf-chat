'use client'

import { useState, type ReactNode } from 'react'

interface VolumeSwitcherProps {
  volumes: { volume: number; label: string }[]
  // สารบัญของแต่ละเล่ม render ที่ server แล้ว — ลำดับตรงกับ volumes
  panels: ReactNode[]
}

// ตัวสลับเล่มในหน้าเรื่อง — เล่มเดียวไม่แสดงแถบ (หน้าเรื่องเรียกเฉพาะเมื่อมีหลายเล่ม)
export default function VolumeSwitcher({ volumes, panels }: VolumeSwitcherProps) {
  const [selected, setSelected] = useState(0)

  return (
    <>
      <div role="tablist" aria-label="เลือกเล่ม" className="mb-6 flex gap-2 overflow-x-auto">
        {volumes.map((v, i) => (
          <button
            key={v.volume}
            type="button"
            role="tab"
            aria-selected={i === selected}
            onClick={() => setSelected(i)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-[13px] font-medium ${
              i === selected ? 'border-accent bg-accent text-white' : 'border-line bg-card text-fg2'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{panels[selected]}</div>
    </>
  )
}
