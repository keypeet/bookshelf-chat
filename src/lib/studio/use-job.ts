'use client'

// polling งานเบื้องหลังแบบ use-run-detail.ts ของ smc_eval — ถามซ้ำทุก 1.5 วิขณะงานยังรัน แล้วหยุดเอง
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText, studioApi, type JobOut } from './api'

const POLL_MS = 1500

export function useJob(jobId: string | null, onSettled?: (job: JobOut) => void) {
  const [job, setJob] = useState<JobOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const settled = useRef(onSettled)
  settled.current = onSettled

  const refresh = useCallback(async () => {
    if (!jobId) return null
    try {
      const next = await studioApi.job(jobId)
      setJob(next)
      setError(null)
      return next
    } catch (err) {
      setError(errorText(err))
      return null
    }
  }, [jobId])

  useEffect(() => {
    if (!jobId) {
      setJob(null)
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const next = await refresh()
      if (stopped) return
      if (next && !next.running) {
        settled.current?.(next)
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [jobId, refresh])

  return { job, error, refresh }
}
