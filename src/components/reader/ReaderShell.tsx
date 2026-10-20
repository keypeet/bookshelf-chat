'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Block, IndexEntry } from '@/lib/types'
import type { ResolvedCharacter } from '@/lib/characters'
import { useReaderChrome } from '@/hooks/useReaderChrome'
import { useReadingProgress } from '@/hooks/useReadingProgress'
import { useReadingPosition } from '@/hooks/useReadingPosition'
import { useSettings } from '@/hooks/useSettings'
import { useTapReveal } from '@/hooks/useTapReveal'
import { useFontSizeAnchor } from '@/hooks/useFontSizeAnchor'
import ChapterBody from '@/components/chat/ChapterBody'
import ReaderHeader from './ReaderHeader'
import BottomNav from './BottomNav'
import ScrollTopButton from './ScrollTopButton'
import ChapterPickerButton from './ChapterPickerButton'
import FirstVisitHint from './FirstVisitHint'
import ContinueReadingCapsule from './ContinueReadingCapsule'
import EndOfChapterCard from './EndOfChapterCard'
import SettingsSheet from './SettingsSheet'
import { bookHref, chapterHref } from '@/lib/routes'

interface ReaderShellProps {
  book: string
  chapter: IndexEntry
  chapters: IndexEntry[]
  blocks: Block[]
  resolvedSpeakers: Record<string, ResolvedCharacter>
}

const TAP_MAX_DISTANCE = 10
const TAP_MAX_DURATION = 500

// ReaderShell — client component เดียวที่เป็นเจ้าของ state ของหน้าอ่าน (plan.md §4.1, §4.2, Phase 3/4)
// รับ blocks/resolvedSpeakers เป็น props จาก server component (page.tsx) เพื่อควบคุม revealCount ของโหมดแตะไล่
// resolvedSpeakers ต้อง resolve ที่ server มาแล้ว (characters.ts ใช้ fs, ห้ามเรียกในนี้)
// ไม่ import content.ts ตรงๆ (ยังคง compliant กับ §3 — เนื้อหามาจาก props เท่านั้น)
export default function ReaderShell({ book, chapter, chapters, blocks, resolvedSpeakers }: ReaderShellProps) {
  const router = useRouter()
  const { visible: chromeVisible, toggle: toggleChrome, setEndLock } = useReaderChrome()
  const { savedPosition, scrollToSaved, dismiss: dismissPosition } = useReadingPosition(book, chapter.id)
  const { settings, update: updateSettings } = useSettings()
  const { revealedCount, revealNext, revealAll } = useTapReveal(book, chapter.id, blocks.length)
  const { captureAnchor, restoreAnchor } = useFontSizeAnchor()

  const isTapMode = settings.readMode === 'tap'
  // โหมดแตะยังไม่ใช้ sentinel scroll-based (§4.3 ท้ายหัวข้อ) — useReadingProgress ยังทำงานได้
  // ปกติเพราะ ChapterBody ไม่ render sentinel จนกว่าจะเผยครบ (ดู ChapterBody.tsx)
  useReadingProgress(book, chapter.id)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [atEnd, setAtEnd] = useState(false)

  const pointerDownRef = useRef<{ x: number; y: number; t: number; overlayWasOpen: boolean } | null>(
    null
  )

  const currentIndex = chapters.findIndex((c) => c.id === chapter.id)
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null
  const nextChapter =
    currentIndex >= 0 && currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null

  const navigate = useCallback(
    (chapterId: string) => {
      router.push(chapterHref(book, chapterId))
    },
    [router, book]
  )

  // เปลี่ยนตอน = ขึ้นบนสุดเสมอ (J3, plan.md §3.12) — ห้ามอ่านตำแหน่งค้างอัตโนมัติ
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    setPickerOpen(false)
    setSettingsOpen(false)
    setAtEnd(false)
  }, [book, chapter.id])

  // sentinel ท้ายตอน — ล็อก chrome ให้โชว์ค้าง + โชว์ EndOfChapterCard (§4.2, §3.11)
  // โหมดแตะที่ยังไม่เผยครบจะไม่มี sentinel นี้ใน DOM (ดู ChapterBody) — effect นี้ต้องรัน
  // ใหม่ทุกครั้งที่ revealedCount เปลี่ยน เพื่อ observe sentinel ที่เพิ่งถูก mount ตอนเผยครบ
  useEffect(() => {
    const sentinel = document.querySelector('[data-end-sentinel]')
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setAtEnd(entry.isIntersecting)
          setEndLock(entry.isIntersecting)
        }
      },
      { threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [book, chapter.id, setEndLock, revealedCount])

  // หมายเหตุ: Escape ปิด dropdown/sheet จัดการอยู่ใน ChapterPicker.tsx / SettingsSheet.tsx เอง
  // (คู่กับ pointerdown-outside) ไม่ต้องมี handler ซ้ำที่นี่

  // ลูกศร ← → (F2.3, §3.6) — ไม่ทำงานเมื่อ dropdown/sheet เปิดอยู่ หรือมี modifier key ค้าง
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (pickerOpen || settingsOpen) return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return

      if (e.key === 'ArrowLeft' && prevChapter) {
        navigate(prevChapter.id)
      } else if (e.key === 'ArrowRight' && nextChapter) {
        navigate(nextChapter.id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pickerOpen, settingsOpen, prevChapter, nextChapter, navigate])

  // handler แตะเดียวตาม §4.1 — onPointerDown/onPointerUp บน container เนื้อหา
  // จำสถานะ picker/settings ไว้ตอน pointerdown เพราะทั้งคู่ปิดตัวเองผ่าน document
  // pointerdown listener ก่อน (§4.1 "แตะข้างนอก = ปิด dropdown") — ถ้าอ่านค่าสดตอน pointerup
  // มันจะเป็น false ไปแล้ว ทำให้ toggle chrome ซ้อนการปิด overlay (บั๊ก)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      pointerDownRef.current = {
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        overlayWasOpen: pickerOpen || settingsOpen,
      }
    },
    [pickerOpen, settingsOpen]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const down = pointerDownRef.current
      pointerDownRef.current = null
      if (!down) return

      const dx = Math.abs(e.clientX - down.x)
      const dy = Math.abs(e.clientY - down.y)
      const dt = Date.now() - down.t

      const isTap =
        dx < TAP_MAX_DISTANCE &&
        dy < TAP_MAX_DISTANCE &&
        dt < TAP_MAX_DURATION &&
        window.getSelection()?.isCollapsed !== false &&
        !(e.target as HTMLElement).closest('button, a, input, [data-no-tap]')

      if (!isTap) return

      if (down.overlayWasOpen) {
        // dropdown/sheet เปิดอยู่ตอนเริ่มแตะ — ปิดตัวนั้น จบ ไม่ toggle chrome (§4.1)
        setPickerOpen(false)
        setSettingsOpen(false)
        return
      }

      if (isTapMode) {
        // โหมดแตะไล่ (§4.1, J6) — เผย block ถัดไป แทน toggle chrome (ไม่ทำทั้งสองอย่าง)
        revealNext()
        return
      }

      toggleChrome()
    },
    [isTapMode, revealNext, toggleChrome]
  )

  // เปลี่ยนขนาดฟอนต์แล้วต้องไม่กระเด็น (plan.md §4.5) — anchor ที่ block ก่อนเปลี่ยน --text-body
  // แล้วคืนตำแหน่งหลัง re-layout ด้วย requestAnimationFrame (อยู่ใน useFontSizeAnchor แล้ว)
  const handleFontSizeChange = useCallback(
    (fontSize: typeof settings.fontSize) => {
      captureAnchor()
      updateSettings({ fontSize })
      restoreAnchor()
    },
    [captureAnchor, restoreAnchor, updateSettings]
  )

  return (
    <>
      <ReaderHeader
        title={chapter.title}
        backHref={bookHref(book)}
        visible={chromeVisible}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className="mx-auto min-h-dvh w-full max-w-[640px] px-4 pb-24 pt-20"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 4.5rem)' }}
      >
        <h1 className="mb-6 text-lg font-semibold">{chapter.title}</h1>
        <ChapterBody
          blocks={blocks}
          resolvedSpeakers={resolvedSpeakers}
          revealCount={isTapMode ? revealedCount : undefined}
        />

        {isTapMode && revealedCount < blocks.length ? (
          <button
            type="button"
            data-no-tap
            onClick={revealAll}
            className="mx-auto mt-6 block rounded-full border border-line px-5 py-3 text-[14px] font-medium text-fg2"
          >
            แสดงทั้งหมด
          </button>
        ) : null}

        {atEnd ? (
          <EndOfChapterCard
            nextChapterId={nextChapter?.id ?? null}
            nextChapterTitle={nextChapter?.title ?? null}
            backHref={bookHref(book)}
            onNavigate={navigate}
          />
        ) : null}
      </div>

      <BottomNav
        prevChapter={prevChapter}
        nextChapter={nextChapter}
        visible={chromeVisible}
        onNavigate={navigate}
      />

      <ScrollTopButton chromeVisible={chromeVisible} />

      <ChapterPickerButton
        book={book}
        chapters={chapters}
        currentChapterId={chapter.id}
        visible={chromeVisible}
        open={pickerOpen}
        onToggle={() => setPickerOpen((v) => !v)}
        onClose={() => setPickerOpen(false)}
        onNavigate={navigate}
      />

      {savedPosition !== null ? (
        <ContinueReadingCapsule
          onClick={() => {
            scrollToSaved()
            dismissPosition()
          }}
        />
      ) : null}

      <FirstVisitHint />

      <SettingsSheet
        open={settingsOpen}
        settings={settings}
        onChange={(partial) => {
          if (partial.fontSize) {
            handleFontSizeChange(partial.fontSize)
          } else {
            updateSettings(partial)
          }
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  )
}
