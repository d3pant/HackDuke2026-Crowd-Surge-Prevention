import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useWebSocket,
  buildMockDensityPayload,
  resetMockSnapshotCounter,
  sendWsControl,
} from './hooks/useWebSocket'
import { useStreamStore, getZoneCellChrome } from './store/useStreamStore'
import { useIncidentStore } from './store/useIncidentStore'
import { computeSurgeMetrics } from './lib/surgeMetrics'

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
      {sorted.map((c) => {
        const chrome = getZoneCellChrome(sorted, c)
        const pct =
          c.density_pct != null ? (Number(c.density_pct) * 100).toFixed(0) : '—'
        return (
        <button
          key={c.id}
          type="button"
          title={`${c.id} · ${c.level} · ~${pct}% (relative heat in this snapshot)`}
          onClick={() => onSelectZone?.(c.id)}
          className="flex min-h-0 min-w-0 flex-col items-center justify-center rounded border border-border/60 px-0.5 py-0.5 text-[9px] font-mono leading-tight shadow-sm transition hover:brightness-110"
          style={{
            backgroundColor: chrome.backgroundColor,
            color: chrome.color,
          }}
        >
          <span className="truncate opacity-90">{c.id.replace('Z-', '')}</span>
        </button>
        )
      })}
    </div>
  )
}

const SURGE_BADGE = {
  critical: 'border-red-400/45 bg-red-500/25 text-red-50',
  warning: 'border-orange-400/40 bg-orange-500/20 text-orange-50',
}

function SurgeGlassPanel({ cells, onSelectZone }) {
  const m = useMemo(() => computeSurgeMetrics(cells), [cells])

  return (
    <div
      className="relative mt-1 shrink-0 overflow-hidden rounded-2xl border border-white/15"
      style={{
        background: `linear-gradient(155deg, hsla(${m.hue}, 58%, 48%, 0.16), hsla(${m.hueAccent}, 48%, 40%, 0.06))`,
        boxShadow:
          'inset 0 1px 0 0 rgba(255,255,255,0.14), 0 12px 40px rgba(0,0,0,0.45)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.12] via-transparent to-slate-900/20"
        aria-hidden
      />
      <div className="relative backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-3 py-2.5">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-white/55">
              Surge risk
            </p>
            <p className="mt-0.5 text-sm font-semibold leading-snug text-white/95">{m.tierLabel}</p>
          </div>
          <div
            className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-center shadow-inner"
            style={{
              boxShadow: `inset 0 0 24px hsla(${m.hue}, 70%, 50%, 0.12)`,
            }}
          >
            <span className="font-mono text-2xl font-bold tabular-nums leading-none text-white">
              {m.tier}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wide text-white/45">tier</span>
          </div>
        </div>
        <div className="space-y-2 px-3 pb-3 pt-2">
          <p className="text-[11px] leading-relaxed text-white/70">{m.sub}</p>
          {m.redOrangeBlocks.length > 0 ? (
            <div>
              <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-white/45">
                Warning + critical blocks
              </p>
              <div className="flex flex-wrap gap-1.5">
                {m.redOrangeBlocks.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => onSelectZone?.(z.id)}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[10px] transition hover:brightness-110 ${SURGE_BADGE[z.surgeLevel] ?? SURGE_BADGE.warning}`}
                    title={`${z.id} · ${z.surgeLevel} · ${((Number(z.density_pct) || 0) * 100).toFixed(0)}%`}
                  >
                    {z.id.replace('Z-', '')}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="font-mono text-[10px] text-white/55">
              {m.tier === 2 && m.watchCount > 0
                ? 'No orange/red-class blocks — watch-tier (yellow) only.'
                : 'No warning or critical-class blocks in this snapshot.'}
            </p>
          )}
        </div>
      </div>
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
  const connectionStatus = useStreamStore((s) => s.connectionStatus)
  const bakeGateReady = useStreamStore((s) => s.bakeGateReady)
  const densitySource = useStreamStore((s) => s.densitySource)
  const bakedBundle = useStreamStore((s) => s.bakedBundle)
  const bakeError = useStreamStore((s) => s.bakeError)

  const frozenPayloadRef = useRef(null)
  const lastHeatmapB64Ref = useRef(null)
  const videoCleanupRef = useRef(null)
  const videoDomRef = useRef(null)
  const [bakedSegmentIndex, setBakedSegmentIndex] = useState(0)
  /** Real API: only the first Play after load should reset the backend session (~15s/snap). Loop/buffer glitches must not call session_restart. */
  const mlSessionStartedRef = useRef(false)

  const mockWs = import.meta.env.VITE_MOCK_WS === 'true'
  /** Mock: freeze grid/heatmap when video/demo stops. Real API: always show latest WS (pass/snap updates keep flowing). */
  const freezeDashboard = mockWs && !videoPlaying && !demoLiveMode

  useEffect(() => {
    if (mockWs) return
    let cancelled = false
    ;(async () => {
      while (!cancelled) {
        try {
          const r = await fetch('/api/density/bake-status')
          const j = await r.json()
          if (j.status === 'ready') {
            if (j.ok) {
              const br = await fetch('/api/density/bake')
              if (br.ok) {
                const bundle = await br.json()
                useStreamStore.setState({
                  bakeGateReady: true,
                  bakedBundle: bundle,
                  densitySource: 'baked',
                  bakeError: null,
                })
              } else {
                const errText = await br.text()
                useStreamStore.setState({
                  bakeGateReady: true,
                  bakedBundle: null,
                  densitySource: 'live_ws',
                  bakeError: errText || 'bake_fetch_failed',
                })
              }
            } else {
              useStreamStore.setState({
                bakeGateReady: true,
                bakedBundle: null,
                densitySource: 'live_ws',
                bakeError: j.error ?? 'bake_failed',
              })
            }
            return
          }
        } catch {
          /* keep polling */
        }
        await new Promise((res) => setTimeout(res, 400))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mockWs])

  useEffect(() => {
    if (mockWs || densitySource !== 'baked') return
    const el = videoDomRef.current
    if (!el) return
    const sync = () => {
      const d = el.duration
      if (!Number.isFinite(d) || d <= 0) return
      const t = el.currentTime / d
      const idx = t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2
      setBakedSegmentIndex(idx)
    }
    sync()
    el.addEventListener('timeupdate', sync)
    el.addEventListener('seeked', sync)
    el.addEventListener('loadedmetadata', sync)
    return () => {
      el.removeEventListener('timeupdate', sync)
      el.removeEventListener('seeked', sync)
      el.removeEventListener('loadedmetadata', sync)
    }
  }, [densitySource, mockWs, bakeGateReady])

  useEffect(() => {
    if (freezeDashboard) {
      frozenPayloadRef.current = useStreamStore.getState().payload
    } else {
      frozenPayloadRef.current = null
    }
  }, [freezeDashboard])

  useEffect(() => {
    if (freezeDashboard) return
    if (livePayload?.heatmap_jpeg_b64) {
      lastHeatmapB64Ref.current = livePayload.heatmap_jpeg_b64
    }
  }, [freezeDashboard, livePayload?.heatmap_jpeg_b64])

  /**
   * Sync dashboard “live” mode from the real media element (play/pause from
   * the control bar, Space, touch, etc.). React onPlay/onPause can miss some
   * paths; native listeners match browser behavior.
   */
  const videoRefCallback = useCallback(
    (el) => {
      videoDomRef.current = el
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
        const src = useStreamStore.getState().densitySource
        if (src === 'baked') {
          return
        }
        if (playing && !wasPlaying) {
          if (!mlSessionStartedRef.current) {
            mlSessionStartedRef.current = true
            el.currentTime = 0
            sendWsControl({ playback_playing: true, session_restart: true })
          } else {
            sendWsControl({ playback_playing: true, session_restart: false })
          }
        } else {
          sendWsControl({ playback_playing: playing })
        }
      }

      el.addEventListener('play', sync)
      el.addEventListener('pause', sync)
      sync()

      videoCleanupRef.current = () => {
        el.removeEventListener('play', sync)
        el.removeEventListener('pause', sync)
      }
    },
    [setVideoPlaying],
  )

  const bakedDisplayPayload = useMemo(() => {
    if (densitySource !== 'baked' || !bakedBundle?.segments?.length) return null
    const i = Math.min(bakedSegmentIndex, bakedBundle.segments.length - 1)
    const seg = bakedBundle.segments[i]
    if (!seg?.payload) return null
    return {
      ...seg.payload,
      heatmap_jpeg_b64: seg.heatmap_jpeg_b64,
      snapshot_index: seg.payload.snapshot_index ?? i + 1,
      heatmap_slot_label: seg.label ?? seg.key,
    }
  }, [bakedBundle, bakedSegmentIndex, densitySource])

  const displayPayload = mockWs
    ? freezeDashboard
      ? frozenPayloadRef.current ?? livePayload
      : livePayload
    : densitySource === 'baked' && bakedDisplayPayload
      ? bakedDisplayPayload
      : livePayload

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
      {!mockWs && !bakeGateReady && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-canvas/95 px-6 text-center"
          role="status"
          aria-live="polite"
        >
          <p className="text-lg font-semibold text-ink">Preparing density maps…</p>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Running CSRNet exactly three times on the demo video (beginning, middle, end). The
            dashboard stays blocked until this finishes—it may take a minute on CPU.
          </p>
        </div>
      )}
      {!mockWs && bakeGateReady && densitySource === 'live_ws' && bakeError && (
        <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-center text-xs text-ink">
          Pre-baked density unavailable ({String(bakeError)}). Showing live WebSocket updates instead.
        </div>
      )}
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
                  {displayPayload.heatmap_slot_label != null && (
                    <span className="ml-1">({displayPayload.heatmap_slot_label})</span>
                  )}
                </span>
              )}
            </span>
          )}
          <span className="ml-2 text-muted">
            {mockWs ? (
              <>
                · live {videoPlaying || demoLiveMode ? 'on' : 'off'}
                {demoLiveMode && !videoPlaying && ' · demo (no video)'}
              </>
            ) : (
              <>
                · video {videoPlaying ? 'playing' : 'paused'}
                {densitySource === 'baked' && (
                  <span className="ml-1">
                    · baked segment{' '}
                    <span className="font-mono">
                      {bakedSegmentIndex === 0 ? '1/3' : bakedSegmentIndex === 1 ? '2/3' : '3/3'}
                    </span>
                  </span>
                )}
              </>
            )}
            {displayPayload?.playback_loop != null && densitySource !== 'baked' && (
              <span className="ml-1 font-mono">· pass {displayPayload.playback_loop}</span>
            )}
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
                loop
                onError={() => {
                  if (import.meta.env.VITE_MOCK_WS === 'true') startMockDemo()
                }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted">
              {import.meta.env.VITE_MOCK_WS === 'true' ? (
                <>
                  Mock mode: matrix/heatmap tick without the API. For the real pipeline, set{' '}
                  <code className="text-ink/80">VITE_MOCK_WS=false</code>.
                </>
              ) : densitySource === 'baked' ? (
                <>
                  Density is <strong>pre-baked</strong>: three CSRNet runs at startup (start / middle /
                  end of the file). Scrub or play—the heatmap and grid switch by <strong>thirds</strong> of
                  timeline position. No per-frame inference during playback.
                </>
              ) : (
                <>
                  Live WebSocket density (pre-bake failed or unavailable). The feed <strong>loops</strong>;
                  the backend can stream updated counts while the simulator runs.
                </>
              )}
            </p>
          </PanelShell>
        </main>

        {/* B: Right — density snapshot + liquid-glass surge tab */}
        <aside className="flex w-[min(100%,min(90vw,40rem))] shrink-0 flex-col">
          <PanelShell title="Density snapshot" className="min-h-0 flex-1">
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {snapshotImageSrc ? (
                <div className="flex min-h-[120px] flex-1 flex-col overflow-hidden rounded-lg bg-black/30">
                  <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto">
                    <img
                      key={`snap-${displayPayload?.playback_loop ?? 0}-${displayPayload?.snapshot_index ?? 0}-${heatmapB64ForDisplay?.length ?? 0}`}
                      src={snapshotImageSrc}
                      alt="Density snapshot: frame blend, zone grid, and density color scale"
                      className="h-auto w-full max-w-full object-contain object-top"
                    />
                  </div>
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
              {displayPayload?.grid?.cells?.length ? (
                <SurgeGlassPanel
                  cells={displayPayload.grid.cells}
                  onSelectZone={setSelectedZone}
                />
              ) : null}
            </div>
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
