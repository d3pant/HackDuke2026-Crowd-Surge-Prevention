import { useMemo } from 'react'
import concertPlaceholder from './assets/hero.png'
import { useWebSocket } from './hooks/useWebSocket'
import { LEVEL_COLORS, useStreamStore } from './store/useStreamStore'

function DensityCells({ rows, cols, cells }) {
  return (
    <div
      className="grid w-full gap-1 rounded-md border border-border bg-surface p-2"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        aspectRatio: `${cols} / ${rows}`,
      }}
    >
      {Array.from({ length: rows * cols }, (_, i) => {
        const row = Math.floor(i / cols)
        const col = i % cols
        const cell = cells.find((c) => c.row === row && c.col === col)
        const level = cell?.level ?? 'safe'
        const bg = LEVEL_COLORS[level] ?? '#94a3b8'
        return (
          <div
            key={`${row}-${col}`}
            className="flex min-h-[2rem] items-center justify-center rounded-sm text-center text-[10px] font-medium leading-tight text-white shadow-sm"
            style={{ backgroundColor: bg }}
            title={
              cell
                ? `${cell.id} · ${(cell.density_pct * 100).toFixed(1)}% · ${cell.count}/${cell.capacity}`
                : 'No data'
            }
          >
            {cell?.id?.replace(/^Z-/, '') ?? '—'}
          </div>
        )
      })}
    </div>
  )
}

/** Same aspect ratio and row×col divisions as the density heat map (1:1 layout). */
function ConcertGridView({ rows, cols, imageSrc }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-border bg-black"
      style={{ aspectRatio: `${cols} / ${rows}` }}
    >
      <img
        key={imageSrc}
        src={imageSrc}
        alt="Venue / concert view"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {Array.from({ length: rows * cols }, (_, i) => (
          <div key={i} className="border border-white/45" />
        ))}
      </div>
    </div>
  )
}

export default function App() {
  useWebSocket()

  const payload = useStreamStore((s) => s.payload)
  const connectionStatus = useStreamStore((s) => s.connectionStatus)
  const frameImageSrc = useStreamStore((s) => s.frameImageSrc)
  const gridImageSrc = useStreamStore((s) => s.gridImageSrc)

  const { rows, cols, cells } = payload?.grid ?? {}
  const venueImageSrc = frameImageSrc || gridImageSrc || concertPlaceholder
  const dispersalAreas = useMemo(() => {
    if (!payload) return []
    if (Array.isArray(payload.alerts) && payload.alerts.length > 0) {
      return payload.alerts.map((a) => ({
        id: a.zone_id ?? a.zoneId,
        line: a.message ?? `${a.zone_id ?? a.zoneId} · ${((a.density_pct ?? a.densityPct ?? 0) * 100).toFixed(0)}% · ${a.level}`,
      }))
    }
    return (payload.grid?.cells ?? [])
      .filter((c) => c.level === 'warning' || c.level === 'critical')
      .map((c) => ({
        id: c.id,
        line: `${c.id} · ${(c.density_pct * 100).toFixed(0)}% density · needs dispersal (${c.level})`,
      }))
  }, [payload])

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-canvas p-4 font-sans text-ink">
      <p className="text-xs text-muted">
        Stream: <span className="font-mono text-ink">{connectionStatus}</span>
        {payload?.venue_id != null && (
          <span className="ml-2 font-mono text-ink">· {payload.venue_id}</span>
        )}
        {payload?.scene_file != null && (
          <span className="ml-2 font-mono text-watch">· {payload.scene_file}</span>
        )}
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-8">
        {rows > 0 && cols > 0 && Array.isArray(cells) ? (
          <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-2 lg:items-start">
            <section className="flex min-w-0 flex-col">
              <h2 className="mb-2 text-sm font-semibold text-ink">Density grid</h2>
              <DensityCells rows={rows} cols={cols} cells={cells} />
            </section>
            <section className="flex min-w-0 flex-col">
              <h2 className="mb-2 text-sm font-semibold text-ink">
                Venue view (grid aligned 1:1)
              </h2>
              <p className="mb-2 text-xs text-muted">
                Live frame from <span className="font-mono">frameImageSrc</span> when the backend
                sends it; otherwise placeholder.
              </p>
              <ConcertGridView rows={rows} cols={cols} imageSrc={venueImageSrc} />
            </section>
          </div>
        ) : (
          <p className="text-sm text-muted">Waiting for density data…</p>
        )}

        <section className="flex w-full max-w-lg shrink-0 flex-col">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Areas needing dispersal aid
          </h2>
          <div className="rounded-md border border-border bg-surface p-3">
            {dispersalAreas.length === 0 ? (
              <p className="text-sm text-muted">None right now.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {dispersalAreas.map((item, idx) => (
                  <li
                    key={`${item.id ?? 'zone'}-${idx}`}
                    className="border-b border-border pb-2 last:border-0 last:pb-0"
                  >
                    {item.line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
