'use client'

interface ContinueReadingCapsuleProps {
  onClick: () => void
}

// D2/§4.4 — แคปซูลลอย "อ่านต่อจากที่ค้าง ↓" ติด data-no-tap กันชนกับ gesture toggle chrome (§4.1)
export default function ContinueReadingCapsule({ onClick }: ContinueReadingCapsuleProps) {
  return (
    <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
      <button
        type="button"
        data-no-tap
        onClick={onClick}
        className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-white shadow-lg"
      >
        อ่านต่อจากที่ค้าง ↓
      </button>
    </div>
  )
}
