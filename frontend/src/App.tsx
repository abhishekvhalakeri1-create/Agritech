import { useCallback, useEffect, useMemo, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { flushQueue, readQueue } from './lib/api'
import { useOnline, useToast } from './lib/hooks'
import { AppContext } from './components/ui'
import { Shell, useSyncOnReconnect } from './components/Shell'
import Overview from './pages/Overview'
import Fields from './pages/Fields'
import Warnings from './pages/Warnings'
import Observations from './pages/Observations'
import Acoustic from './pages/Acoustic'
import Plant from './pages/Plant'
import Soil from './pages/Soil'
import Network from './pages/Network'

function Toasts({ toasts }: { toasts: Array<{ id: number; message: string; tone: string }> }) {
  if (!toasts.length) return null
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone === 'forest' ? '' : toast.tone}`}>
          {toast.message}
        </div>
      ))}
    </div>
  )
}

function Syncer() {
  useSyncOnReconnect()
  return null
}

export default function App() {
  const online = useOnline()
  const { toasts, push } = useToast()
  const [queueCount, setQueueCount] = useState(() => readQueue().length)
  const [refreshKey, setRefreshKey] = useState(0)

  const bump = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const update = () => setQueueCount(readQueue().length)
    window.addEventListener('fieldzy:queue', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('fieldzy:queue', update)
      window.removeEventListener('storage', update)
    }
  }, [])

  const syncNow = useCallback(async () => {
    const result = await flushQueue()
    setQueueCount(readQueue().length)
    if (result.sent) {
      push(`${result.sent} queued observation${result.sent === 1 ? '' : 's'} delivered.`)
      bump()
    } else if (result.failed) {
      push(`${result.failed} record(s) could not be delivered yet.`, 'amber')
    } else {
      push('Nothing is waiting in the local queue.')
    }
  }, [push, bump])

  const value = useMemo(
    () => ({ online, queueCount, push, syncNow, refreshKey, bump }),
    [online, queueCount, push, syncNow, refreshKey, bump],
  )

  return (
    <AppContext.Provider value={value}>
      <Syncer />
      <Shell>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/fields" element={<Fields />} />
          <Route path="/warnings" element={<Warnings />} />
          <Route path="/observations" element={<Observations />} />
          <Route path="/acoustic" element={<Acoustic />} />
          <Route path="/plant" element={<Plant />} />
          <Route path="/soil" element={<Soil />} />
          <Route path="/network" element={<Network />} />
          <Route path="*" element={<Overview />} />
        </Routes>
      </Shell>
      <Toasts toasts={toasts} />
    </AppContext.Provider>
  )
}
