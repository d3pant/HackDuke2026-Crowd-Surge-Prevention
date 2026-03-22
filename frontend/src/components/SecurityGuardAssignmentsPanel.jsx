import { GUARD_IDS, GUARD_LABELS } from '../lib/guardAssignments'

export function SecurityGuardAssignmentsPanel({ guardToZone }) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-2xl border border-white/15"
      style={{
        background:
          'linear-gradient(155deg, hsla(210, 52%, 46%, 0.14), hsla(230, 42%, 38%, 0.06))',
        boxShadow:
          'inset 0 1px 0 0 rgba(255,255,255,0.12), 0 10px 32px rgba(0,0,0,0.22)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-slate-900/15"
        aria-hidden
      />
      <div className="relative backdrop-blur-2xl">
        <div className="flex flex-col gap-3 border-b border-white/10 p-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-white/55">
            Security guard assignments
          </p>
          <p className="text-[11px] leading-snug text-white/65">
            Surge zones (highest risk first, max ten) are covered first. Assignments
            stick while a zone stays in that list.
          </p>
        </div>
        <ul className="grid max-h-[min(40vh,22rem)] grid-cols-1 gap-3 overflow-y-auto p-3 pt-0 sm:grid-cols-2">
          {GUARD_IDS.map((id) => {
            const zoneId = guardToZone[id]
            const assigned = Boolean(zoneId)
            return (
              <li
                key={id}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] ${
                  assigned
                    ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-50'
                    : 'border-white/10 bg-black/20 text-white/55'
                }`}
              >
                <span className="truncate font-medium">{GUARD_LABELS[id]}</span>
                <span className="shrink-0 tabular-nums text-white/90">
                  {assigned ? zoneId : 'Unassigned'}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
