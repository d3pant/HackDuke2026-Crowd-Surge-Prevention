import { useEffect } from 'react'
import { useStreamStore } from '../store/useStreamStore'

const ROWS = 6
const COLS = 8
const CAPACITY = 80

function cellId(row, col) {
  const letter = String.fromCharCode('A'.charCodeAt(0) + row)
  return `Z-${letter}${col + 1}`
}

function levelFromDensity(densityPct) {
  if (densityPct >= 0.95) return 'critical'
  if (densityPct >= 0.8) return 'warning'
  if (densityPct >= 0.6) return 'watch'
  return 'safe'
}

/**
 * Mock density payload (PRD TASK 3.2): 48 cells, Z-C4 forced critical @ count 78,
 * growth_rate in [0, 0.3].
 */
export function buildMockDensityPayload() {
  const cells = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const id = cellId(row, col)
      let count =
        id === 'Z-C4'
          ? 78
          : Math.round(Math.random() * 90 * 10) / 10
      const growthRate = Math.round(Math.random() * 300) / 1000
      const densityPct = count / CAPACITY
      let level = levelFromDensity(densityPct)
      if (id === 'Z-C4') level = 'critical'

      cells.push({
        id,
        row,
        col,
        count,
        capacity: CAPACITY,
        level,
        density_pct: Math.round(densityPct * 1000) / 1000,
        growth_rate: growthRate,
      })
    }
  }

  const total_count = Math.round(cells.reduce((s, c) => s + c.count, 0) * 10) / 10

  const alerts = cells
    .filter((c) => c.level === 'warning' || c.level === 'critical')
    .map((c) => ({
      zone_id: c.id,
      level: c.level,
      count: c.count,
      capacity: c.capacity,
      density_pct: c.density_pct,
      growth_rate: c.growth_rate,
      message: `Surge risk — ${c.id} at ${(c.density_pct * 100).toFixed(1)}% capacity`,
    }))

  return {
    timestamp: Math.floor(Date.now() / 1000),
    venue_id: 'festival_v1',
    total_count,
    venue_capacity: 12000,
    grid: {
      rows: ROWS,
      cols: COLS,
      cells,
    },
    alerts,
  }
}

const WS_URL = 'ws://localhost:8000/ws/density'

export function useWebSocket() {
  useEffect(() => {
    const mock = import.meta.env.VITE_MOCK_WS === 'true'
    const setState = useStreamStore.setState

    if (mock) {
      setState({ connectionStatus: 'connected' })
      const tick = () => {
        setState({ payload: buildMockDensityPayload(), connectionStatus: 'connected' })
      }
      tick()
      const id = setInterval(tick, 1000)
      return () => clearInterval(id)
    }

    let ws
    let reconnectTimer
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      setState({ connectionStatus: 'connecting' })

      ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        setState({ connectionStatus: 'connected' })
      }

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          setState({ payload: data })
        } catch {
          /* ignore malformed */
        }
      }

      ws.onclose = () => {
        setState({ connectionStatus: 'disconnected' })
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimeout(reconnectTimer)
      if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    }
  }, [])
}
