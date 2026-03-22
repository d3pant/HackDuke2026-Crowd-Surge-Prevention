import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { computeSurgeMetrics } from './surgeMetrics'

/** Fixed pool of 10 security guards (UI + assignment logic). */
export const GUARD_IDS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10']

export const GUARD_LABELS = Object.fromEntries(
  GUARD_IDS.map((id, i) => [id, `Guard ${i + 1}`]),
)

export function createInitialGuardState() {
  return Object.fromEntries(GUARD_IDS.map((id) => [id, null]))
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Sticky assignment: guard → zone stays until that zone leaves the target set.
 * Target zones = surge “Zones to monitor” chips (highest risk first), max 10.
 * New zones get random guards from the unassigned pool.
 *
 * @param {Record<string, string | null>} prev
 * @param {Array<{ id: string }>} targetZones
 */
export function syncGuardAssignments(prev, targetZones) {
  const next = { ...prev }
  const targetIds = new Set(targetZones.map((z) => z.id))

  for (const g of GUARD_IDS) {
    const z = next[g]
    if (z && !targetIds.has(z)) next[g] = null
  }

  const zoneToGuard = {}
  for (const g of GUARD_IDS) {
    const z = next[g]
    if (z) zoneToGuard[z] = g
  }

  const zonesNeeding = targetZones.filter((z) => !zoneToGuard[z.id])
  const assignedGuards = new Set(
    GUARD_IDS.filter((g) => {
      const z = next[g]
      return Boolean(z)
    }),
  )
  const available = GUARD_IDS.filter((g) => !assignedGuards.has(g))
  shuffleInPlace(available)

  const n = Math.min(zonesNeeding.length, available.length)
  for (let i = 0; i < n; i++) {
    next[available[i]] = zonesNeeding[i].id
  }

  let unchanged = true
  for (const g of GUARD_IDS) {
    if (prev[g] !== next[g]) {
      unchanged = false
      break
    }
  }
  return unchanged ? prev : next
}

/**
 * Sticky guard↔zone map when the set of top surge zones (by risk) changes.
 * Updates only when the ordered list of target zone ids changes (see `zoneSig`).
 */
export function useSurgeGuardAssignments(displayPayload) {
  const payloadRef = useRef(displayPayload)

  useLayoutEffect(() => {
    payloadRef.current = displayPayload
  })

  const zoneSig = useMemo(() => {
    const cells = displayPayload?.grid?.cells
    if (!cells?.length) return ''
    const m = computeSurgeMetrics(cells)
    return m.criticalBlocks
      .slice(0, 10)
      .map((z) => z.id)
      .join('|')
  }, [displayPayload])

  const [guardToZone, setGuardToZone] = useState(createInitialGuardState)

  /* Sticky assignments must persist across renders until the surge target list (zoneSig) changes;
     functional updates need a layout effect so we read the latest payload ref. */
  /* eslint-disable react-hooks/set-state-in-effect -- intentional sync when zoneSig changes */
  useLayoutEffect(() => {
    const cells = payloadRef.current?.grid?.cells
    if (!zoneSig || !cells?.length) {
      setGuardToZone(createInitialGuardState())
      return
    }
    const m = computeSurgeMetrics(cells)
    const targetZones = m.criticalBlocks.slice(0, 10)
    if (targetZones.length === 0) {
      setGuardToZone(createInitialGuardState())
      return
    }
    setGuardToZone((prev) => syncGuardAssignments(prev, targetZones))
  }, [zoneSig])
  /* eslint-enable react-hooks/set-state-in-effect */

  return guardToZone
}
