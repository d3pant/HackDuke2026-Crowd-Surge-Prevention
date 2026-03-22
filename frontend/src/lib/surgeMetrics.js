/**
 * Surge UI tiers — derived from the same density bands as backend/ml/pipeline.py
 * `compute_levels` (density_pct = count / cell capacity). Growth/hysteresis rules in
 * Python are not replayed here; we use `level` from the payload when present, else
 * static density cutoffs matching the non-growth branches in that function.
 */

/** Mirrors pipeline.py: elif density_pct >= 0.80 / 0.60 / implicit safe */
export const PIPELINE_DENSITY_BANDS = {
  watch: 0.6,
  warning: 0.8,
  critical: 0.95,
}

/**
 * Surge risk chips: normalized count/capacity must be ≥ this (fraction; 3.5 = 350% of cell capacity).
 * Raised well above the pipeline “critical” band (0.95) so only the most overloaded zones appear.
 */
export const SURGE_CHIP_MIN_DENSITY = 3.5

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

/**
 * Backend `compute_levels` uses density = count/capacity (fraction, can exceed 1).
 * Some snapshots expose the same quantity as 0–100+ (e.g. 53 for 53%). Detect once
 * per grid so thresholds match pipeline.py.
 *
 * @param {Array<{ density_pct?: number }>} cells
 * @returns {(cell: { density_pct?: number }) => number}
 */
export function densityFracFromSnapshot(cells) {
  const vals = cells
    .map((c) => Number(c.density_pct ?? 0))
    .filter((v) => !Number.isNaN(v))
  const max = vals.length ? Math.max(...vals) : 0
  // Fraction overload is rarely > ~10×; 0–100 scale has typical values 5–95+.
  const looksLikePercentScale = max > 30
  return (cell) => {
    const d = Number(cell.density_pct ?? 0)
    if (Number.isNaN(d)) return 0
    return looksLikePercentScale ? d / 100 : d
  }
}

/**
 * Map a cell to a level using server `level` if set, else density_pct vs pipeline bands
 * (same thresholds as compute_levels, without prev_level / growth_rate hysteresis).
 *
 * @param {{ level?: string, density_pct?: number }} cell
 * @param {(cell: { density_pct?: number }) => number} [frac]
 */
export function effectiveSurgeLevel(cell, frac) {
  const lv = cell.level
  if (lv === 'critical' || lv === 'warning' || lv === 'watch' || lv === 'safe') {
    return lv
  }
  const d = frac ? frac(cell) : Number(cell.density_pct ?? 0)
  if (d >= PIPELINE_DENSITY_BANDS.critical) return 'critical'
  if (d >= PIPELINE_DENSITY_BANDS.warning) return 'warning'
  if (d >= PIPELINE_DENSITY_BANDS.watch) return 'watch'
  return 'safe'
}

export function isSurgeChipDensity(cell, frac) {
  return frac(cell) >= SURGE_CHIP_MIN_DENSITY
}

/**
 * @param {Array<{ id: string, level?: string, density_pct?: number }> | undefined} cells
 */
export function computeSurgeMetrics(cells) {
  if (!cells?.length) {
    return {
      tier: TIER.NONE,
      tierLabel: LABEL[1],
      sub: 'Waiting for zone grid…',
      redOrangeBlocks: [],
      criticalBlocks: [],
      surgeChipMinPct: Math.round(SURGE_CHIP_MIN_DENSITY * 100),
      watchCount: 0,
      criticalCount: 0,
      warningCount: 0,
      hue: 200,
      hueAccent: 210,
    }
  }

  const frac = densityFracFromSnapshot(cells)

  let criticalCount = 0
  let warningCount = 0
  let watchCount = 0

  for (const c of cells) {
    const el = effectiveSurgeLevel(c, frac)
    if (el === 'critical') criticalCount += 1
    else if (el === 'warning') warningCount += 1
    else if (el === 'watch') watchCount += 1
  }

  /** Tier: surge if any critical; else risky if any watch/warning; else none */
  let tier
  if (criticalCount > 0) {
    tier = TIER.SURGE
  } else if (warningCount > 0 || watchCount > 0) {
    tier = TIER.RISKY
  } else {
    tier = TIER.NONE
  }

  const enriched = [...cells].map((c) => {
    const el = effectiveSurgeLevel(c, frac)
    return { ...c, surgeLevel: el, densityFrac: frac(c) }
  })

  const redOrangeBlocks = enriched
    .filter((c) => c.surgeLevel === 'critical' || c.surgeLevel === 'warning')
    .sort(
      (a, b) =>
        (b.surgeLevel === 'critical' ? 1 : 0) - (a.surgeLevel === 'critical' ? 1 : 0) ||
        (Number(b.densityFrac ?? 0) - Number(a.densityFrac ?? 0)),
    )

  const criticalBlocks = enriched
    .filter((c) => isSurgeChipDensity(c, frac))
    .sort((a, b) => Number(b.densityFrac ?? 0) - Number(a.densityFrac ?? 0))

  const chipPct = Math.round(SURGE_CHIP_MIN_DENSITY * 100)
  let sub
  if (tier === TIER.SURGE) {
    sub = `Chips list zones at ≥${chipPct}% of cell capacity (extreme overload only).`
  } else if (tier === TIER.RISKY) {
    if (redOrangeBlocks.length > 0) {
      sub = `Chips use ≥${chipPct}% capacity, not API tier labels. ${watchCount} watch-tier zone(s) elsewhere.`
    } else {
      sub = `Watch-tier only (≥${Math.round(PIPELINE_DENSITY_BANDS.watch * 100)}% capacity); chips need ≥${chipPct}% capacity.`
    }
  } else {
    sub = `Below watch threshold (<${Math.round(PIPELINE_DENSITY_BANDS.watch * 100)}% of cell capacity per pipeline).`
  }

  /** Hue: calm green / amber / red — tied to tier, not a 0–100 score */
  const hue =
    tier === TIER.NONE ? 145 : tier === TIER.RISKY ? 38 : 0
  const hueAccent = tier === TIER.NONE ? 165 : tier === TIER.RISKY ? 28 : 352

  return {
    tier,
    tierLabel: LABEL[tier],
    sub,
    redOrangeBlocks,
    criticalBlocks,
    surgeChipMinPct: chipPct,
    watchCount,
    criticalCount,
    warningCount,
    hue,
    hueAccent,
  }
}
