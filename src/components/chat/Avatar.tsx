import type { ResolvedAvatar } from '@/lib/characters'

interface AvatarProps {
  avatar: ResolvedAvatar
  size?: number
}

// 4 ชั้นตาม plan.md §4.9 — server component ล้วน ไม่มี JS ติดไปกับ bubble
export default function Avatar({ avatar, size = 32 }: AvatarProps) {
  const style = { width: size, height: size }

  if (avatar.kind === 'none') {
    // ตัวประกอบ (generic) — ไม่แสดงภาพ แต่กันที่ไว้ไม่ให้ bubble เลื่อนไปชิดซ้าย
    return <div className="shrink-0" style={style} aria-hidden />
  }

  if (avatar.kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar.src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={style}
      />
    )
  }

  if (avatar.kind === 'unknown') {
    // key ไม่พบใน characters.json — วงกลมเทา ต้องเห็นว่าผิด
    return (
      <div
        className="avatar-fill shrink-0 flex items-center justify-center rounded-full text-xs font-semibold"
        style={{ ...style, ['--char' as string]: '#9ca3af' }}
        aria-hidden
      >
        ?
      </div>
    )
  }

  // kind === 'initials'
  return (
    <div
      className="avatar-fill shrink-0 flex items-center justify-center rounded-full text-xs font-semibold"
      style={{ ...style, ['--char' as string]: avatar.color }}
      aria-hidden
    >
      {avatar.initials}
    </div>
  )
}
