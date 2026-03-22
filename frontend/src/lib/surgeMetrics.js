/**
 * Pipeline tier = API risk (header). Chip *depth* (how many cells) can follow the baked
 * video segment (1st / 2nd / 3rd of timeline) so counts change when you scrub — otherwise
 * pipeline tier alone often stays “surge” every frame and chip count never moved.
 *
 * Chips: non-blue band (same relativeHeatT as grid), priority-sorted: critical → warning →
 * watch → safe, then relative heat, then density.
 */

import { relativeHeatT } from '../store/useStreamStore'

const BLUE_BAND_BOTTOM_SHARE = 0.28

/** API severity (higher = respond first) */
const LEVEL_RANK = { critical: 4, warning: 3, watch: 2, safe: 1 }

/** Depth 1 = few, 2 = more, 3 = most — numeric spread is intentionally wide */
const DEPTH = {
  1: { maxChips: 2, share: 0.05 },
  2: { minChips: 3, share: 0.42 },
  3: { all: true },
}

export const PIPELINE_DENSITY_BANDS = {
  watch: 0.6,
  warning: 0.8,
  critical: 0.95,
}

const TIER = {
  NONE: 1,
  RISKY: 2,
  SURGE: 3,
}

const LABEL = {
  1: 'No risk',
  2: 'Risky',
  3: 'Crowd surge happening',
}

export function effectiveSurgeLevel(cell) {
  const lv = cell.level
  if (lv === 'critical' || lv === 'warning' || lv === 'watch' || lv === 'safe') {
    return lv
  }
  const d = Number(cell.density_pct ?? 0)
  if (d >= PIPELINE_DENSITY_BANDS.critical) return 'critical'
  if (d >= PIPELINE_DENSITY_BANDS.warning) return 'warning'
  if (d >= PIPELINE_DENSITY_BANDS.watch) return 'watch'
  return 'safe'
}

function compareRowPriority(a, b) {
  const ra = LEVEL_RANK[a.surgeLevel] ?? 0
  const rb = LEVEL_RANK[b.surgeLevel] ?? 0
  if (rb !== ra) return rb - ra
  if (b.t !== a.t) return b.t - a.t
  return Number(b.cell.density_pct ?? 0) - Number(a.cell.density_pct ?? 0)
}

/**
 * Non-blue cells, **highest priority first** (severity → relative heat → density).
 */
function nonBlueRowsPrioritySorted(cells) {
  if (!cells?.length) return []
  const n = cells.length
  const rows = cells.map((c) => ({
    cell: c,
    t: relativeHeatT(cells, c),
    surgeLevel: effectiveSurgeLevel(c),
  }))
  const blueCount = Math.min(n, Math.max(0, Math.floor(n * BLUE_BAND_BOTTOM_SHARE)))
  const pool = rows.slice(0, Math.max(0, n - blueCount))
  pool.sort(compareRowPriority)
  return pool
}

function sliceForChipDepth(nonBlueRows, depthTier) {
  const L = nonBlueRows.length
  if (L === 0) return []
  const d = DEPTH[depthTier] ?? DEPTH[3]
  if (d.all) {
    return nonBlueRows.slice(0, L)
  }
  if (depthTier === 1) {
    const want = Math.max(1, Math.min(d.maxChips, Math.ceil(L * d.share)))
    return nonBlueRows.slice(0, Math.min(want, L))
  }
  if (depthTier === 2) {
    const want = Math.max(d.minChips, Math.ceil(L * d.share))
    return nonBlueRows.slice(0, Math.min(want, L))
  }
  return nonBlueRows.slice(0, L)
}

/**
 * @param {Array<{ id: string, level?: string, density_pct?: number }> | undefined} cells
 * @param {{ chipDepthTier?: 1 | 2 | 3 }} [options] — when set (e.g. baked segment 0→1, 1→2, 2→3), drives how many chips; else uses pipeline tier.
 */
export function computeSurgeMetrics(cells, options = {}) {
  const { chipDepthTier: chipDepthTierOverride } = options

  if (!cells?.length) {
    return {
      tier: TIER.NONE,
      tierLabel: LABEL[1],
      sub: 'Waiting for zone grid…',
      redOrangeBlocks: [],
      chipCount: 0,
      nonBlueCount: 0,
      sliceTierUsed: 1,
      chipDepthSource: 'pipeline',
      watchCount: 0,
      criticalCount: 0,
      warningCount: 0,
      hue: 200,
      hueAccent: 210,
    }
  }

  let criticalCount = 0
  let warningCount = 0
  let watchCount = 0

  for (const c of cells) {
    const el = effectiveSurgeLevel(c)
    if (el === 'critical') criticalCount += 1
    else if (el === 'warning') warningCount += 1
    else if (el === 'watch') watchCount += 1
  }

  let tier
  if (criticalCount > 0) {
    tier = TIER.SURGE
  } else if (warningCount > 0 || watchCount > 0) {
    tier = TIER.RISKY
  } else {
    tier = TIER.NONE
  }

  const pipelineTier = tier
  const sliceTierUsed = chipDepthTierOverride ?? pipelineTier
  const chipDepthSource = chipDepthTierOverride != null ? 'segment' : 'pipeline'

  const nonBlue = nonBlueRowsPrioritySorted(cells)
  const picked = sliceForChipDepth(nonBlue, sliceTierUsed)

  const redOrangeBlocks = picked.map(({ cell, surgeLevel }, i) => ({
    ...cell,
    surgeLevel,
    priorityRank: i + 1,
  }))

  const nonBlueCount = nonBlue.length
  const chipCount = redOrangeBlocks.length

  let sub
  if (chipDepthSource === 'segment') {
    sub = `Risk label = pipeline · chip depth = video segment ${sliceTierUsed}/3 (first/mid/last third of timeline). ${chipCount} of ${nonBlueCount} non-blue cells, highest priority first.`
  } else if (pipelineTier === TIER.SURGE) {
    sub = `Pipeline surge — depth ${sliceTierUsed}/3. ${chipCount} of ${nonBlueCount} non-blue cells (priority order).`
  } else if (pipelineTier === TIER.RISKY) {
    sub = `Pipeline risky — depth ${sliceTierUsed}/3. ${chipCount} of ${nonBlueCount} non-blue cells.`
  } else {
    sub = `All safe — depth ${sliceTierUsed}/3. ${chipCount} of ${nonBlueCount} non-blue cells.`
  }

  const hue =
    pipelineTier === TIER.NONE ? 145 : pipelineTier === TIER.RISKY ? 38 : 0
  const hueAccent =
    pipelineTier === TIER.NONE ? 165 : pipelineTier === TIER.RISKY ? 28 : 352

  return {
    tier: pipelineTier,
    tierLabel: LABEL[pipelineTier],
    sub,
    redOrangeBlocks,
    chipCount,
    nonBlueCount,
    sliceTierUsed,
    chipDepthSource,
    watchCount,
    criticalCount,
    warningCount,
    hue,
    hueAccent,
  }
}