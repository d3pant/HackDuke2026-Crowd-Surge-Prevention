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
 * Map a cell to a level using server `level` if set, else density_pct vs pipeline bands
 * (same thresholds as compute_levels, without prev_level / growth_rate hysteresis).
 *
 * @param {{ level?: string, density_pct?: number }} cell
 */
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

/**
 * @param {Array<{ id: string, level?: string, density_pct?: number }> | undefined} cells
 */
export function computeSurgeMetrics(cells) {
  if (!cells?.length) {
    return {
      tier: TIER.NONE,
      tierLabel: LABEL[1],
      sub: 'Waiting for zone grid…',
      /** critical + warning only (red / orange on grid) */
      redOrangeBlocks: [],
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

  /** Tier: surge if any critical; else risky if any watch/warning; else none */
  let tier
  if (criticalCount > 0) {
    tier = TIER.SURGE
  } else if (warningCount > 0 || watchCount > 0) {
    tier = TIER.RISKY
  } else {
    tier = TIER.NONE
  }

  const redOrangeBlocks = [...cells]
    .map((c) => {
      const el = effectiveSurgeLevel(c)
      return { ...c, surgeLevel: el }
    })
    .filter((c) => c.surgeLevel === 'critical' || c.surgeLevel === 'warning')
    .sort(
      (a, b) =>
        (b.surgeLevel === 'critical' ? 1 : 0) - (a.surgeLevel === 'critical' ? 1 : 0) ||
        (Number(b.density_pct ?? 0) - Number(a.density_pct ?? 0)),
    )

  let sub
  if (tier === TIER.SURGE) {
    sub = `Critical band (≥${Math.round(PIPELINE_DENSITY_BANDS.critical * 100)}% of cell capacity, same rule as the API).`
  } else if (tier === TIER.RISKY) {
    if (redOrangeBlocks.length > 0) {
      sub = `Warning/critical-class zones below; ${watchCount} watch-tier zone(s) elsewhere on the grid.`
    } else {
      sub = `Watch-tier only (≥${Math.round(PIPELINE_DENSITY_BANDS.watch * 100)}% capacity); chips list warning + critical only.`
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
    watchCount,
    criticalCount,
    warningCount,
    hue,
    hueAccent,
  }
}
