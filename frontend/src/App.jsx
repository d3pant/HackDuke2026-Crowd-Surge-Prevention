import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  useWebSocket,
  buildMockDensityPayload,
  resetMockSnapshotCounter,
  sendWsControl,
} from './hooks/useWebSocket'
import { useStreamStore, LEVEL_COLORS } from './store/useStreamStore'
import { useIncidentStore } from './store/useIncidentStore'

function PanelShell({ title, children, className = '' }) {
  return (
    <div
      className={`flex flex-col rounded-md border border-border bg-surface p-3 text-ink ${className}`}
    >
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wide text-muted">
        {title}
      </p>
      <div className="min-h-0 flex-1 text-sm text-muted">{children}</div>
    </div>
  )
}

function ZoneGridPanel({ cells, onSelectZone }) {
  const sorted = useMemo(() => {
    if (!cells?.length) return []
    return [...cells].sort((a, b) => a.row - b.row || a.col - b.col)
  }, [cells])

  return (
    <div className="grid h-full min-h-[200px] grid-cols-8 grid-rows-6 gap-1">
      {sorted.map((c) => (
        <button
          key={c.id}
          type="button"
          title={`${c.id} · ${c.level}`}
          onClick={() => onSelectZone?.(c.id)}
          className="flex min-h-0 min-w-0 flex-col items-center justify-center rounded border border-border/60 px-0.5 py-0.5 text-[9px] font-mono leading-tight text-white shadow-sm transition hover:brightness-110"
          style={{ backgroundColor: LEVEL_COLORS[c.level] ?? LEVEL_COLORS.safe }}
        >
          <span className="truncate opacity-90">{c.id.replace('Z-', '')}</span>
        </button>
      ))}
    </div>
  )
}

export default function App() {
  useWebSocket()

  const selectedZoneId = useStreamStore((s) => s.selectedZoneId)
  const setSelectedZone = useStreamStore((s) => s.setSelectedZone)
  const livePayload = useStreamStore((s) => s.payload)
  const videoPlaying = useStreamStore((s) => s.videoPlaying)
  const setVideoPlaying = useStreamStore((s) => s.setVideoPlaying)
  const demoLiveMode = useStreamStore((s) => s.demoLiveMode)
  const setDemoLiveMode = useStreamStore((s) => s.setDemoLiveMode)
  const awaitingFinalDensity = useStreamStore((s) => s.awaitingFinalDensity)
  const setAwaitingFinalDensity = useStreamStore((s) => s.setAwaitingFinalDensity)
  const connectionStatus = useStreamStore((s) => s.connectionStatus)

  const frozenPayloadRef = useRef(null)
  const lastHeatmapB64Ref = useRef(null)
  const videoCleanupRef = useRef(null)

  const liveMode = videoPlaying || demoLiveMode || awaitingFinalDensity

  useEffect(() => {
    if (livePayload?.density_phase === 'session_final_ready') {
      setAwaitingFinalDensity(false)
    }
  }, [livePayload?.density_phase, setAwaitingFinalDensity])

  useEffect(() => {
    if (!liveMode) {
      frozenPayloadRef.current = useStreamStore.getState().payload
    }
  }, [liveMode])

  useEffect(() => {
    if (!liveMode) return
    if (livePayload?.heatmap_jpeg_b64) {
      lastHeatmapB64Ref.current = livePayload.heatmap_jpeg_b64
    }
  }, [liveMode, livePayload?.heatmap_jpeg_b64])

  /**
   * Sync dashboard “live” mode from the real media element (play/pause from
   * the control bar, Space, touch, etc.). React onPlay/onPause can miss some
   * paths; native listeners match browser behavior.
   */
  const videoRefCallback = useCallback(
    (el) => {
      videoCleanupRef.current?.()
      videoCleanupRef.current = null
      if (!el) return

      const mock = import.meta.env.VITE_MOCK_WS === 'true'

      const sync = () => {
        const playing = !el.paused
        const wasPlaying = useStreamStore.getState().videoPlaying
        setVideoPlaying(playing)
        if (mock) {
          if (playing && !wasPlaying) {
            resetMockSnapshotCounter()
            useStreamStore.setState({ payload: buildMockDensityPayload() })
          }
          return
        }
        if (playing && !wasPlaying) {
          el.currentTime = 0
          setAwaitingFinalDensity(false)
          sendWsControl({ playback_playing: true, session_restart: true })
        } else {
          sendWsControl({ playback_playing: playing })
        }
      }

      const onEnded = () => {
        setVideoPlaying(false)
        if (mock) return
        sendWsControl({ playback_playing: false, video_ended: true })
        setAwaitingFinalDensity(true)
      }

      el.addEventListener('play', sync)
      el.addEventListener('pause', sync)
      el.addEventListener('playing', sync)
      el.addEventListener('ended', onEnded)
      sync()

      videoCleanupRef.current = () => {
        el.removeEventListener('play', sync)
        el.removeEventListener('pause', sync)
        el.removeEventListener('playing', sync)
        el.removeEventListener('ended', onEnded)
      }
    },
    [setVideoPlaying, setAwaitingFinalDensity],
  )

  const displayPayload = liveMode ? livePayload : frozenPayloadRef.current

  const heatmapB64ForDisplay =
    displayPayload?.heatmap_jpeg_b64 ?? lastHeatmapB64Ref.current

  const startMockDemo = () => {
    resetMockSnapshotCounter()
    setDemoLiveMode(true)
    useStreamStore.setState({ payload: buildMockDensityPayload() })
  }

  const pauseMockDemo = () => {
    setDemoLiveMode(false)
  }

  const fetchIncidents = useIncidentStore((s) => s.fetchIncidents)
  const fetchGuards = useIncidentStore((s) => s.fetchGuards)

  useEffect(() => {
    const run = () => {
      fetchIncidents().catch(() => {})
      fetchGuards().catch(() => {})
    }
    run()
    const id = setInterval(run, 10_000)
    return () => clearInterval(id)
  }, [fetchIncidents, fetchGuards])

  const snapshotImageSrc = useMemo(() => {
    if (!heatmapB64ForDisplay) return null
    return `data:image/jpeg;base64,${heatmapB64ForDisplay}`
  }, [heatmapB64ForDisplay])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas font-sans text-ink">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-4">
        <span className="font-semibold text-primary">CrowdSense</span>
        <span className="ml-4 text-xs text-muted">
          WS: {connectionStatus}
          {displayPayload?.timestamp != null && (
            <span className="ml-2 font-mono text-safe">
              · t={displayPayload.timestamp}
              {displayPayload.snapshot_index != null && displayPayload.snapshot_index > 0 && (
                <span className="ml-2 text-muted">
                  · snap #{displayPayload.snapshot_index}
                </span>
              )}
            </span>
          )}
          <span className="ml-2 text-muted">
            · live {liveMode ? 'on' : 'off'}
            {awaitingFinalDensity && ' · final snapshot…'}
            {demoLiveMode && !videoPlaying && ' · demo (no video)'}
          </span>
        </span>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* B: Left — zone grid */}
        <aside className="flex w-[min(100%,22rem)] shrink-0 flex-col">
          <PanelShell title="Zone grid" className="min-h-0 flex-1">
            {!displayPayload?.grid?.cells?.length ? (
              <div className="space-y-2 text-xs leading-relaxed text-muted">
                <p>
                  Press play on the video, or use <strong className="text-ink">Start demo</strong>{' '}
                  below if the video fails to load (backend must be running for the file).
                </p>
              </div>
            ) : (
              <ZoneGridPanel
                cells={displayPayload.grid.cells}
                onSelectZone={setSelectedZone}
              />
            )}
          </PanelShell>
        </aside>

        {/* B: Center — live video (independent of ML frame rate) */}
        <main className="flex min-w-0 flex-1 flex-col">
          <PanelShell title="Live feed" className="min-h-0 flex-1">
            {import.meta.env.VITE_MOCK_WS === 'true' && (
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-primary bg-primary/10 px-2 py-1 text-[11px] font-medium text-ink"
                  onClick={startMockDemo}
                >
                  Start demo (matrix + heatmap, no video needed)
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-ink"
                  onClick={pauseMockDemo}
                  disabled={!demoLiveMode}
                >
                  Pause demo
                </button>
              </div>
            )}
            <div className="relative flex h-full min-h-[240px] items-center justify-center overflow-hidden rounded bg-black/40">
              <video
                ref={videoRefCallback}
                className="h-full max-h-full w-full object-contain"
                src="/api/video/demo"
                controls
                playsInline
                muted
                preload="auto"
                loop={false}
                onError={() => {
                  if (import.meta.env.VITE_MOCK_WS === 'true') startMockDemo()
                }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Each play starts from the beginning and resets the zone matrix and heatmap session.
              While playing, the API emits at most <strong>three</strong> density JPEGs (tune with{' '}
              <code className="text-ink/80">DENSITY_PLAY_SNAPSHOT_MAX</code>
              ). When the clip <strong>ends</strong> (not pause), the server runs one more infer on
              the last frame; the UI waits for that snapshot so the grid matches the heatmap. Pause
              does not end the session.
            </p>
          </PanelShell>
        </main>

        {/* B: Right — density snapshot (same style as test_local PNG: blend + grid + color bar) */}
        <aside className="flex w-[min(100%,min(90vw,40rem))] shrink-0 flex-col">
          <PanelShell title="Density snapshot" className="min-h-0 flex-1">
            {snapshotImageSrc ? (
              <div className="flex min-h-[200px] flex-1 items-center justify-center overflow-auto rounded bg-black/30">
                <img
                  key={`snap-${displayPayload?.snapshot_index ?? 0}-${heatmapB64ForDisplay?.length ?? 0}`}
                  src={snapshotImageSrc}
                  alt="Density snapshot: frame blend, zone grid, and density color scale"
                  className="max-h-full w-full max-w-full object-contain object-top"
                />
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-muted">
                No snapshot yet. Set <code className="text-ink/80">VITE_MOCK_WS=false</code>, run
                the API with CSRNet weights and <code className="text-ink/80">test.mp4</code> in{' '}
                <code className="text-ink/80">data/demo_footage/</code>. Each snapshot is a JPEG
                like the <code className="text-ink/80">heatmap_highest.png</code> pipeline from{' '}
                <code className="text-ink/80">test_local</code>.
              </p>
            )}
          </PanelShell>
        </aside>
      </div>

      {selectedZoneId != null && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50"
          role="presentation"
        >
          <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-surface p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Zone detail</h2>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-sm text-muted hover:bg-canvas hover:text-ink"
                onClick={() => setSelectedZone(null)}
              >
                ×
              </button>
            </div>
            <p className="text-sm text-muted">
              Selected zone:{' '}
              <span className="font-mono text-watch">{selectedZoneId}</span>
            </p>
            <button
              type="button"
              className="mt-4 self-start text-sm text-primary underline"
              onClick={() => setSelectedZone(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
