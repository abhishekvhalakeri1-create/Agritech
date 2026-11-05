import { useCallback, useEffect, useRef, useState } from 'react'
import { api, cacheGet, cacheSet } from './api'

/** Small fetch hook with loading / error / offline-cache behaviour. */
export function useApi<T>(path: string | null, options: { cacheKey?: string } = {}) {
  const [data, setData] = useState<T | null>(() => (options.cacheKey ? cacheGet<T>(options.cacheKey) : null))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const mounted = useRef(true)

  const load = useCallback(
    async (silent = false) => {
      if (!path) return
      if (!silent) setLoading(true)
      try {
        const result = await api.get<T>(path)
        if (!mounted.current) return
        setData(result)
        setError(null)
        setStale(false)
        if (options.cacheKey) cacheSet(options.cacheKey, result)
      } catch (err) {
        if (!mounted.current) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setStale(true)
      } finally {
        if (mounted.current) setLoading(false)
      }
    },
    [path, options.cacheKey],
  )

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
    }
  }, [load])

  return { data, loading, error, stale, refresh: () => load(true), reload: () => load(false), setData }
}

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export function useToast() {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone: 'forest' | 'amber' | 'red' }>>([])
  const push = useCallback((message: string, tone: 'forest' | 'amber' | 'red' = 'forest') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4600)
  }, [])
  return { toasts, push }
}

export function useGreeting(name = 'Hemish') {
  const [greeting, setGreeting] = useState('Good morning')
  useEffect(() => {
    const hour = new Date().getHours()
    setGreeting(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening')
  }, [])
  return `${greeting}, ${name}`
}
