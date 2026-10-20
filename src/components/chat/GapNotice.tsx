interface GapNoticeProps {
  note: string
}

// เนื้อหาขาดหาย (เช่น หน้าหนังสือหาย) — ต้องเห็นชัดว่าขาด ไม่ปนกับ narration ปกติ
export default function GapNotice({ note }: GapNoticeProps) {
  return (
    <div className="my-2 rounded-md border border-dashed border-line px-4 py-3 text-center text-sm text-fg2">
      {note}
    </div>
  )
}
