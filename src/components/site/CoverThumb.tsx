import { coverFallbackColor } from '@/lib/cover-color'

interface CoverThumbProps {
  title: string
  color?: string
  src?: string
  size?: 'sm' | 'md' | 'fill'
  className?: string
}

const WIDTH = {
  sm: 'w-[52px]',
  md: 'w-[200px]',
  fill: 'w-full',
} as const

const PAD = {
  sm: 'p-1.5',
  md: 'p-[18px]',
  fill: 'p-3',
} as const

export default function CoverThumb({ title, color, src, size = 'md', className = '' }: CoverThumbProps) {
  const frame = `aspect-[2/3] overflow-hidden rounded-[3px_10px_10px_3px] shadow-[6px_10px_22px_rgba(37,35,31,0.16)] ${WIDTH[size]} ${className}`
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={`ปกหนังสือ ${title}`} className={`${frame} object-cover`} />
    )
  }
  return (
    <div
      className={`${frame} flex items-end font-serif font-medium text-[#f4ead7] ${PAD[size]} ${size === 'md' ? 'text-2xl' : 'text-[15px]'} ${size === 'sm' ? '[&_strong]:hidden' : ''}`}
      style={{ backgroundColor: color ?? coverFallbackColor(title) }}
      aria-hidden="true"
    >
      <strong className="leading-snug">{title}</strong>
    </div>
  )
}
