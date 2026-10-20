# Context pack — สิ่งที่แนบไปกับงาน convert / summarize

ไม่ใช่ prompt ที่ส่งตรง — เป็น spec ว่าผู้เรียก (backend หรือ agent wrapper) ประกอบช่อง `{{context}}`, `{{roster}}`, `{{names}}`, `{{styleNotes}}` อย่างไร
ขนาดต้องคงที่แม้หนังสือยาว: **ห้ามแนบข้อความดิบของบทเก่า**

## ช่องและแหล่งที่มา

| ช่อง | มาจาก | ใช้ใน |
|---|---|---|
| `{{bookTitle}}` | `library/<book>/book.json` → `title` | ทุก prompt |
| `{{styleNotes}}` | `book.json` → `styleNotes` (ไม่มี → `ไม่มี`) | ทุก prompt |
| `{{names}}` | `characters.json` → `name` + `aliases` ของตัวที่ไม่ใช่ `generic` (บรรทัดละคน) | `ocr` |
| `{{roster}}` | `characters.json` คัดตามด้านล่าง เป็น JSON ย่อ: `key`, `name`, `short`, `aliases`, `role`, `generic`, สถานะ | `convert`, `scan`, `summarize` |
| `{{context}}` | สรุปบท/เล่มใน `library/<book>/summaries/vN.json` (เฟส 6c); ก่อนมีสรุป → `storyline/index.md` + ไฟล์เล่มปัจจุบัน | `convert`, `summarize` |
| `{{previousTail}}` | ~600 ตัวอักษรท้ายหน้าก่อนหน้าของ call นี้ (ไม่มี → `ไม่มี — เป็นหน้าแรกของบท`) | `convert` |
| `{{pages}}` | ต่อหน้า: `### image NNN` + ข้อความ raw (ตัดหัว comment ออก) | `convert` |

## roster ต่อการแปลงบท N

1. ตัวละครที่สแกนพบในบท N (ผล `scan` ที่รับแล้ว)
2. ตัวหลักที่ยังมีชีวิต / ยังอยู่ในเรื่อง
3. key `generic: true` ทั้งหมด + `unknown`

ไม่ใส่ `appearance`, `imagePrompt`, สี — ไม่ช่วยระบุผู้พูดและเปลืองงบ

## context ต่อการแปลงบท N (เรียงจากใกล้ไปไกล)

| ส่วน | งบตัวอักษร |
|---|---|
| สรุปบท N−1 และ N−2 แบบเต็ม | ≤1,500 ต่อบท |
| สรุปบทที่เหลือก่อนหน้าในเล่มเดียวกัน แบบย่อ (บรรทัดเดียวต่อบท) | รวม ≤1,500 |
| สรุปเล่มก่อนหน้า | ≤4,000 |
| สรุปเล่มที่ไกลกว่า 2 เล่ม | ≤800 ต่อเล่ม |

งบบังคับในโค้ด: สรุปที่เกินงบ = reject แล้วสั่งย่อใหม่ ไม่ตัดท้าย

## สิ่งที่ต้องเก็บกับทุกผล (เฟส 3+)

prompt ที่ประกอบแล้ว · hash ของ template (`prompts/<ชื่อ>.md`) · id ของสรุปที่ใช้ใน context
