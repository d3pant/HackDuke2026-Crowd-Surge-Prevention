import { normalizeStreamMessage } from '../lib/normalizeStreamMessage'

/**
 * Single static snapshot for tests / fallback when no `scenes/*.json` exist.
 * Live mock “stream” cycles `fixtures/scenes/scene-*.json` — see `loadScenes.js`.
 */

const ROWS = 6
const COLS = 8
const CAPACITY = 80
const DENSITY_MAP_ROWS = 48
const DENSITY_MAP_COLS = 64

function cellId(row, col) {
  const letter = String.fromCharCode('A'.charCodeAt(0) + row)
  return `Z-${letter}${col + 1}`
}

function levelFromDensity(densityPct) {
  if (densityPct >= 0.95) return 'critical'
  if (densityPct >= 0.8) return 'warning'
  if (densityPct >= 0.6) return 'watch'
  return 'safe'
}

function buildCells() {
  const rowSpan = DENSITY_MAP_ROWS / ROWS
  const colSpan = DENSITY_MAP_COLS / COLS
  const cells = []

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const id = cellId(row, col)
      // Deterministic fake counts — ramp + hot spot at Z-C4
      let count =
        id === 'Z-C4'
          ? 78
          : Math.round((8 + row * 9 + col * 5 + (row + col) % 7) * 10) / 10
      count = Math.min(count, CAPACITY * 0.99)
      const densityPct = count / CAPACITY
      let level = levelFromDensity(densityPct)
      if (id === 'Z-C4') level = 'critical'

      const row_start = Math.round(row * rowSpan)
      const row_end = Math.round((row + 1) * rowSpan) - 1
      const col_start = Math.round(col * colSpan)
      const col_end = Math.round((col + 1) * colSpan) - 1

      cells.push({
        id,
        row,
        col,
        row_start,
        row_end,
        col_start,
        col_end,
        count,
        capacity: CAPACITY,
        level,
        density_pct: Math.round(densityPct * 1000) / 1000,
        growth_rate: Math.round((0.02 + ((row + col) % 5) * 0.04) * 1000) / 1000,
      })
    }
  }
  return cells
}

const CELLS = buildCells()

/** `matrices.density` — same values as `cells` density_pct (6×8). */
const DENSITY_MATRIX = Array.from({ length: ROWS }, (_, row) =>
  Array.from({ length: COLS }, (_, col) => CELLS[row * COLS + col].density_pct),
)

const TOTAL_COUNT =
  Math.round(CELLS.reduce((s, c) => s + c.count, 0) * 10) / 10

const ALERTS = CELLS.filter(
  (c) => c.level === 'warning' || c.level === 'critical',
).map((c) => ({
  zone_id: c.id,
  level: c.level,
  count: c.count,
  capacity: c.capacity,
  density_pct: c.density_pct,
  growth_rate: c.growth_rate,
  message: `Surge risk — ${c.id} at ${(c.density_pct * 100).toFixed(1)}% capacity`,
}))

/**
 * Static envelope ~ Person 2 WebSocket JSON (grid + matrices + alerts).
 * Omit `images` here so the UI uses `assets/hero.png` as venue placeholder; in production
 * Person 2 can send `images.frame` (or `frame_image`) with each tick for a live camera frame.
 * `timestamp` is filled in when emitting.
 */
export const MOCK_STREAM_MESSAGE = {
  venue_id: 'festival_demo',
  total_count: TOTAL_COUNT,
  venue_capacity: 12000,
  grid: {
    rows: ROWS,
    cols: COLS,
    cells: CELLS,
  },
  matrices: {
    density: DENSITY_MATRIX,
  },
  alerts: ALERTS,
}

/**
 * Same as a live tick: fresh timestamp + normalizer (cells coerced like real WS).
 * @returns {ReturnType<typeof normalizeStreamMessage>}
 */
export function getFreshMockNormalizedStream() {
  return normalizeStreamMessage({
    ...MOCK_STREAM_MESSAGE,
    timestamp: Math.floor(Date.now() / 1000),
    total_count: TOTAL_COUNT,
  })
}

/** @deprecated Prefer getFreshMockNormalizedStream; kept for callers that only need payload JSON. */
export function buildMockDensityPayload() {
  const n = getFreshMockNormalizedStream()
  return n ? n.payload : null
}
