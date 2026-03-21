import { useEffect } from 'react'
import { getFreshMockNormalizedStream } from '../fixtures/mockDensitySnapshot'
import {
  getMockSceneNormalized,
  MOCK_SCENE_COUNT,
} from '../fixtures/scenes/loadScenes'
import { normalizeStreamMessage } from '../lib/normalizeStreamMessage'
import { useStreamStore } from '../store/useStreamStore'

/** @deprecated Import from `../fixtures/mockDensitySnapshot` instead. */
export { buildMockDensityPayload } from '../fixtures/mockDensitySnapshot'

const WS_URL = 'ws://localhost:8000/ws/density'

const MOCK_SCENE_MS = Number(import.meta.env.VITE_MOCK_SCENE_MS ?? 1800)

export function useWebSocket() {
  useEffect(() => {
    const mock = import.meta.env.VITE_MOCK_WS === 'true'
    const setState = useStreamStore.setState

    if (mock) {
      setState({ connectionStatus: 'connected' })
      let sceneIndex = 0
      const tick = () => {
        const normalized =
          MOCK_SCENE_COUNT > 0
            ? getMockSceneNormalized(sceneIndex++)
            : getFreshMockNormalizedStream()
        if (normalized) {
          useStreamStore.getState().applyStreamMessage(normalized)
        }
        setState({ connectionStatus: 'connected' })
      }
      tick()
      const id = setInterval(tick, Number.isFinite(MOCK_SCENE_MS) ? MOCK_SCENE_MS : 1800)
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
          const normalized = normalizeStreamMessage(data)
          if (normalized) {
            useStreamStore.getState().applyStreamMessage(normalized)
          }
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
