import { useEffect } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useStreamStore } from './store/useStreamStore'
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

export default function App() {
  useWebSocket()

  const selectedZoneId = useStreamStore((s) => s.selectedZoneId)
  const setSelectedZone = useStreamStore((s) => s.setSelectedZone)
  const payload = useStreamStore((s) => s.payload)
  const connectionStatus = useStreamStore((s) => s.connectionStatus)

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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas font-sans text-ink">
      {/* TopNav placeholder (TASK 3.6) */}
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-4">
        <span className="font-semibold text-primary">TopNav</span>
        <span className="ml-4 text-xs text-muted">
          WS: {connectionStatus}
          {payload?.timestamp != null && (
            <span className="ml-2 font-mono text-safe">
              · payload t={payload.timestamp}
            </span>
          )}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* Left w-60 */}
        <aside className="flex w-60 shrink-0 flex-col gap-3">
          <PanelShell title="VenueCapacityBar (placeholder)" className="min-h-[120px]">
            Phase 4–6
          </PanelShell>
          <PanelShell title="GuardRoster (placeholder)" className="min-h-[200px] flex-1">
            Phase 4–6
          </PanelShell>
        </aside>

        {/* Center flex-1 */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          <PanelShell title="CameraHeatmapView (placeholder)" className="min-h-[200px] flex-1">
            <p>
              Latest grid cells:{' '}
              <span className="font-mono text-ink">
                {payload?.grid?.cells?.length ?? '—'}
              </span>
            </p>
          </PanelShell>
          <PanelShell title="ZoneGrid (placeholder)" className="h-40 shrink-0">
            Phase 4–6
          </PanelShell>
        </main>

        {/* Right w-85 */}
        <aside className="flex w-85 shrink-0 flex-col gap-3">
          <PanelShell title="AlertPanel (placeholder)" className="min-h-[140px]">
            Phase 4–6
          </PanelShell>
          <PanelShell title="IncidentLog (placeholder)" className="min-h-[140px]">
            Phase 4–6
          </PanelShell>
          <PanelShell title="ZoneTrendChart (placeholder)" className="min-h-[160px] flex-1">
            Phase 4–6
          </PanelShell>
        </aside>
      </div>

      {/* ZoneDetailDrawer overlay (placeholder) */}
      {selectedZoneId != null && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50"
          role="presentation"
        >
          <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-surface p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">ZoneDetailDrawer</h2>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-sm text-muted hover:bg-canvas hover:text-ink"
                onClick={() => setSelectedZone(null)}
              >
                ×
              </button>
            </div>
            <p className="text-sm text-muted">
              Placeholder — selected zone:{' '}
              <span className="font-mono text-watch">{selectedZoneId}</span>
            </p>
            <button
              type="button"
              className="mt-4 self-start text-sm text-primary underline"
              onClick={() => setSelectedZone(null)}
            >
              Close drawer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
