export function coverFallbackColor(title: string): string {
  let hash = 0
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) % 360
  return `hsl(${hash} 35% 40%)`
}
