# ชั้นหนังสือแชท (bookshelf-chat)

เว็บอ่านนิยายในรูปแบบแชท: บทพูดเป็นฟองแชทพร้อมชื่อและรูปตัวละคร ส่วนบรรยายเป็นบล็อกข้อความ
มีหลายเรื่อง หลายเล่ม และ **Studio** ที่รันในเครื่องสำหรับทำเนื้อหาใหม่ ตั้งแต่ PDF ไปจนเป็นแชทที่ publish แล้ว

repo นี้มีแต่โค้ด **ไม่มีเนื้อหาหนังสือ** เนื้อหาอยู่ใน repo แยก (private) ที่ clone ไว้เป็นโฟลเดอร์ `library/`
ถ้าไม่มี `library/` เว็บยังรันและ build ได้ (ชั้นหนังสือว่าง) และมีเรื่องตัวอย่างสั้น ๆ ใน `library.example/` ไว้ลอง

## ส่วนประกอบ

| ส่วน | อยู่ที่ | ทำอะไร |
| --- | --- | --- |
| Reader | `src/` (Next.js 16, React 19, Tailwind 4) | อ่านไฟล์ใน `library/` อย่างเดียว แล้วแสดงเป็นแชท; deploy ได้ |
| Studio UI | `src/app/studio/`, `src/components/studio/` | เปิดเฉพาะเมื่อมี `STUDIO=1`; ใช้ในเครื่องเท่านั้น |
| Backend | `backend/` (FastAPI + uv) | ตัวเขียน `library/` ตัวเดียว; เรียก CLI ของโมเดล AI ให้ OCR, สแกนตัวละคร, แปลงเป็นแชท และสรุป |
| Prompts | `prompts/` | กฎงานเนื้อหาที่ไม่ผูกกับเรื่องใด |
| ไฟล์ทำงาน | `workdir/` (ไม่ขึ้น git) | PDF, ภาพหน้า, ผล AI ทุกโมเดล, งานเบื้องหลัง |

## สิ่งที่ต้องมี

- Node.js 20 ขึ้นไป
- สำหรับ Studio: Python 3.12 ขึ้นไป และ [uv](https://docs.astral.sh/uv/) รวมถึง CLI ของโมเดลอย่างน้อยหนึ่งตัว
  (Claude Code, Codex, Antigravity หรือ Grok) ที่ล็อกอินแล้ว

## อ่านอย่างเดียว (Reader)

```bash
npm install
npm run dev                                   # อ่านจาก ./library
LIBRARY_DIR=./library.example npm run dev     # ลองกับเรื่องตัวอย่าง
```

เปิด http://localhost:3000

## Studio

1. สร้างไฟล์ `.env.local` ที่ราก repo แล้วใส่ค่าสุ่มยาว ๆ:

   ```
   STUDIO_TOKEN=<ค่าสุ่ม>
   ```

   backend และ proxy ของ Next อ่านค่าเดียวกัน; ไม่ตั้งค่า = API ปิด
2. ติดตั้ง backend: `uv sync --directory backend`
3. เปิดทั้งคู่: `npm run studio` แล้วไปที่ http://localhost:3000/studio

backend bind `127.0.0.1` เท่านั้น รัน 1 worker และห้ามใช้ `--reload` (บน Windows ทำให้ spawn CLI ไม่ได้)
เพราะ backend สั่ง CLI ที่มีสิทธิ์สูงในเครื่อง จึงไม่ควร deploy ขึ้นที่ใด

ขั้นตอนต่อเล่มใน Studio:

1. อัปโหลด PDF แล้วสั่ง OCR เป็นช่วงหน้า เลือกได้หลายโมเดลเพื่อเทียบผล
2. เลือกผลที่ถูกต่อหน้า และตั้งขอบเขตบท
3. ทีละบท: สแกนตัวละคร (รับหรือไม่รับข้อเสนอทีละข้อ) → แปลงเป็นแชท → ตรวจ → publish
4. สรุปบท แล้วสรุปเล่ม สรุปที่อนุมัติแล้วใช้เป็นบริบทให้การแปลงบทถัดไป

Studio เขียนไฟล์ลง `library/` แต่ไม่ commit ให้; commit และ push เนื้อหาที่ `git -C library ...` เอง

## ตัวแปร env

| ชื่อ | ใช้ที่ | ความหมาย |
| --- | --- | --- |
| `LIBRARY_DIR` | Reader, backend, `check:content` | โฟลเดอร์เนื้อหา (ค่าเริ่ม `./library`; path สัมพัทธ์ resolve จากราก repo) |
| `STUDIO` | Next | `1` = เปิดหน้า `/studio` |
| `STUDIO_TOKEN` | backend + proxy | token ระหว่าง Next กับ backend |
| `STUDIO_API_PORT` | proxy | port ของ backend (ค่าเริ่ม 8000) |
| `WORKDIR` | backend | โฟลเดอร์ไฟล์ทำงาน (ค่าเริ่ม `./workdir`) |
| `STUDIO_ALLOWED_ORIGINS` | backend | origin ที่ยอมให้ส่งคำสั่ง (ค่าเริ่ม localhost:3000) |
| `STUDIO_<PROVIDER>_BINARY` | backend | path ของ CLI ถ้าหาเองไม่เจอ (`CLAUDE`, `CODEX`, `AGY`, `GROK`) |
| `SITE_PASSCODE` | Reader ที่ deploy | ตั้งแล้วทุกหน้าต้องใส่รหัสที่ `/unlock` ก่อน; ไม่ตั้ง = เปิดโล่ง |

## ตรวจก่อนส่งงาน

```bash
npx tsc --noEmit
npm run check:content
npm run build
npm run api:check
node scripts/coverage.mjs --test
uv run --directory backend pytest
uv run --directory backend ruff check
```

เทสต์ backend ไม่เรียก CLI จริง (ใช้ผลที่อัดไว้ใน `backend/tests/golden/`)

## Deploy (Reader เท่านั้น)

1. ตั้ง `SITE_PASSCODE` ใน env ของโฮสต์ ทุกหน้าใส่ `noindex` อยู่แล้ว
2. build command ของโฮสต์ต้อง clone repo เนื้อหาไว้เป็น `library/` ก่อน ด้วย token ที่อ่านได้อย่างเดียวและเข้าถึงได้เฉพาะ repo นั้น
   แล้วจึงรัน `npm run build` (ขั้น prebuild คัดลอกปกและรูปตัวละครไป `public/books/`)
3. ตั้ง deploy hook ให้ build ใหม่เมื่อ push เนื้อหา
4. ตรวจว่า build บนโฮสต์อ่าน `library/` จริง ไม่ใช่ `library.example/`

passcode กันคนทั่วไปได้ แต่ไม่ใช่การกันเด็ดขาด: คนที่ได้รหัสไปก็อ่านเนื้อหาได้

## สองรีโป

| repo | เก็บอะไร |
| --- | --- |
| `bookshelf-chat` (public, repo นี้) | โค้ด, prompts, เรื่องตัวอย่าง `library.example/` |
| `book-library` (private) | เนื้อหาทุกเรื่อง: `book.json`, ตัวละคร, บทที่ publish, raw OCR, สรุป, ปก |

`library/`, `workdir/` และ `.env*` อยู่ใน `.gitignore`; ห้าม commit เนื้อหาหนังสือเข้า repo นี้
