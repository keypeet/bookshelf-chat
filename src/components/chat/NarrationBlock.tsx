interface NarrationBlockProps {
  text: string
}

// ไม่มีกรอบ ไม่มีพื้น — ดูเป็นหน้าหนังสือ ไม่ใช่การ์ด (plan.md §2.5, §4.11)
export default function NarrationBlock({ text }: NarrationBlockProps) {
  return (
    <p
      className="text-[length:var(--text-body)]"
      style={{ color: 'color-mix(in oklab, var(--fg) 88%, transparent)', lineHeight: 1.9 }}
    >
      {text}
    </p>
  )
}
