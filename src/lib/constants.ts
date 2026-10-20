// ค่าเดียวกันทั้งโปรเจกต์ — วางไว้ที่ src/lib/constants.ts
export const CHROME_HIDE_DELTA = 10   // เลื่อนลงสะสมเกินนี้ → ซ่อน
export const CHROME_SHOW_DELTA = 10   // เลื่อนขึ้นสะสมเกินนี้ → โชว์
export const CHROME_TOP_LOCK  = 8     // scrollY น้อยกว่านี้ → โชว์ค้าง ไม่ต้องคิด
export const TAP_COOLDOWN     = 250   // ms หลังแตะ ห้าม scroll handler สั่งซ่อน
export const SCROLLTOP_SHOW   = 400   // px ที่ปุ่มขึ้นบนสุดโผล่
