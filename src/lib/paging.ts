export const BROWSE_PAGE_SIZE = 48

export function parsePage(value: string | undefined): number {
  const page = Number(value)
  if (!Number.isInteger(page) || page < 1) return 1
  return page
}

export function pageSlice<T>(items: T[], page: number, pageSize: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(page, 1), pages)
  const start = (current - 1) * pageSize
  return { items: items.slice(start, start + pageSize), page: current, pages }
}
