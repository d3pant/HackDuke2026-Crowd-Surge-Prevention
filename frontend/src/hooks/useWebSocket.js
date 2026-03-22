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
 * Per playback session: reset when the user presses play so snap #1,2,3… are
 * easy to see (≥3 heatmap refreshes in a few seconds at 800ms ticks).
 */
let mockSnapshotSeq = 0

export function resetMockSnapshotCounter() {
  mockSnapshotSeq = 0
}

/**
 * Mock density payload (PRD TASK 3.2): 48 cells, Z-C4 forced critical @ count 78,
 * growth_rate in [0, 0.3].
 */
export function buildMockDensityPayload() {
  mockSnapshotSeq += 1
  const snapAt = Date.now() / 1000
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
    heatmap_jpeg_b64: null,
    snapshot_index: mockSnapshotSeq,
    snapshot_at_sec: snapAt,
  }
}

function wsDensityUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws/density`
}

/** Real WS only: send playback / session flags (set by video element sync in App). */
const wsControlRef = { send: null }

/**
 * @param {Partial<{ playback_playing: boolean, session_restart: boolean }>} overrides
 */
export function sendWsControl(overrides = {}) {
  const send = wsControlRef.send
  if (!send) return
  const s = useStreamStore.getState()
  send({
    playback_playing: overrides.playback_playing ?? s.videoPlaying,
    session_restart: overrides.session_restart ?? false,
  })
}

export function useWebSocket() {
  useEffect(() => {
    const mock = import.meta.env.VITE_MOCK_WS === 'true'
    const setState = useStreamStore.setState

    if (mock) {
      setState({ connectionStatus: 'connected', payload: null })
      const tick = () => {
        const s = useStreamStore.getState()
        if (!s.videoPlaying && !s.demoLiveMode) return
        setState({ payload: buildMockDensityPayload(), connectionStatus: 'connected' })
      }
      const tickMs = Number(import.meta.env.VITE_MOCK_TICK_MS) || 800
      const id = setInterval(tick, tickMs)
      return () => clearInterval(id)
    }

    let ws
    let reconnectTimer
    let cancelled = false
    let gateTimer

    const connect = () => {
      if (cancelled) return
      setState({ connectionStatus: 'connecting' })

      ws = new WebSocket(wsDensityUrl())

      ws.onopen = () => {
        setState({ connectionStatus: 'connected' })
        wsControlRef.send = (msg) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify(msg))
            } catch {
              /* ignore */
            }
          }
        }
        sendWsControl({})
      }

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          const src = useStreamStore.getState().densitySource
          if (src === 'baked') return
          setState({ payload: data })
        } catch {
          /* ignore malformed */
        }
      }

      ws.onclose = () => {
        wsControlRef.send = null
        setState({ connectionStatus: 'disconnected' })
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    const waitGateAndConnect = () => {
      if (cancelled) return
      if (useStreamStore.getState().bakeGateReady) {
        connect()
        return
      }
      gateTimer = window.setTimeout(waitGateAndConnect, 150)
    }

    waitGateAndConnect()

    return () => {
      cancelled = true
      wsControlRef.send = null
      clearTimeout(gateTimer)
      clearTimeout(reconnectTimer)
      if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    }
  }, [])
}
