interface SceneDividerProps {
  text: string
}

// คั่นฉาก — ใช้ --fg2 อ่อนกว่าเนื้อเรื่องหลัก ไม่ใช่ bubble ไม่ใช่บรรยาย
export default function SceneDivider({ text }: SceneDividerProps) {
  return (
    <div className="flex items-center gap-3 py-1 text-center">
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span className="shrink-0 text-xs font-medium tracking-wide text-fg2">{text}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  )
}
