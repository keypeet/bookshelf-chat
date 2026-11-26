// URL ของหน้าเรื่อง/ตอน ที่เดียว — ใช้ได้ทั้ง server และ client component

// siteV2 = หน้าใหม่หลัง SITE_V2=1 (ส่งเป็นค่าเข้ามา เพราะ client component อ่าน env ฝั่ง server ไม่ได้)
export function bookHref(book: string, siteV2 = false): string {
  return siteV2 ? `/book/${book}` : `/b/${book}`
}

// id สังเคราะห์ของโหมดอ่านทั้งบท `v{n}-book{m}` ไม่มีไฟล์ตอน → ชี้ไป route ทั้งบทแทน
// อ่านทีละช่วงยังอยู่ที่ /b/ จนกว่าจะมีหน้าอ่านใหม่ /read/
export function chapterHref(book: string, id: string, siteV2 = false): string {
  const whole = parseBookChapterId(id)
  if (whole) return `${bookHref(book, siteV2)}/chapter/${whole.volume}/${whole.bookChapter}`
  return `/b/${book}/${id}`
}

export function bookChapterId(volume: number, bookChapter: number): string {
  return `v${volume}-book${bookChapter}`
}

export function parseBookChapterId(id: string): { volume: number; bookChapter: number } | null {
  const whole = /^v(\d+)-book(\d+)$/.exec(id)
  return whole ? { volume: Number(whole[1]), bookChapter: Number(whole[2]) } : null
}

// เรื่องหลายเล่มต้องมีเลขเล่ม ไม่งั้น "บทที่ 1" ของแต่ละเล่มแยกกันไม่ออกใน dropdown
export function bookChapterTitle(volume: number, bookChapter: number, multiVolume: boolean): string {
  return `${multiVolume ? `เล่ม ${volume} · ` : ''}บทที่ ${bookChapter} (ทั้งบท)`
}
