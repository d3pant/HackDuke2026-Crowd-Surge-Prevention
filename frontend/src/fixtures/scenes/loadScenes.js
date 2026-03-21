import { normalizeStreamMessage } from '../../lib/normalizeStreamMessage'

const DENSITY_MAP_ROWS = 48
const DENSITY_MAP_COLS = 64

const rawModules = import.meta.glob('./*.json', { eager: true })

/** Sorted paths so scene-01, scene-02, … play in order. */
const SCENE_PATHS = Object.keys(rawModules).sort()

function getDefault(mod) {
  return mod?.default ?? mod
}

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

/**
 * @param {object} raw — shape from scene-*.json
 */
function expandSceneJson(raw) {
  const { frame_url, grid, ...rest } = raw
  const rows = grid.rows
  const cols = grid.cols
  const capacity = grid.capacity ?? 80
  const matrix = grid.density_matrix
  const rowSpan = DENSITY_MAP_ROWS / rows
  const colSpan = DENSITY_MAP_COLS / cols

  const cells = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const density_pct = Number(matrix[row][col])
      const count = Math.min(
        capacity * 0.999,
        Math.round(density_pct * capacity * 10) / 10,
      )
      const id = cellId(row, col)
      const level = levelFromDensity(density_pct)
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
        capacity,
        level,
        density_pct: Math.round(density_pct * 1000) / 1000,
        growth_rate:
          Math.round((0.02 + ((row + col + Math.floor(density_pct * 10)) % 5) * 0.045) * 1000) /
          1000,
      })
    }
  }

  const total_count =
    Math.round(cells.reduce((s, c) => s + c.count, 0) * 10) / 10

  const alerts = cells
    .filter((c) => c.level === 'warning' || c.level === 'critical')
    .map((c) => ({
      zone_id: c.id,
      level: c.level,
      count: c.count,
      capacity: c.capacity,
      density_pct: c.density_pct,
      growth_rate: c.growth_rate,
      message: `Surge risk — ${c.id} at ${(c.density_pct * 100).toFixed(1)}% capacity`,
    }))

  return {
    ...rest,
    total_count,
    timestamp: 0,
    grid: { rows, cols, cells },
    matrices: { density: matrix },
    alerts,
    ...(frame_url ? { images: { frame: frame_url } } : {}),
  }
}

export const MOCK_SCENE_COUNT = SCENE_PATHS.length

/**
 * @param {number} index — cycles with modulo
 * @returns {ReturnType<typeof normalizeStreamMessage>}
 */
export function getMockSceneNormalized(index) {
  if (SCENE_PATHS.length === 0) return null
  const path = SCENE_PATHS[index % SCENE_PATHS.length]
  const raw = getDefault(rawModules[path])
  const envelope = expandSceneJson(raw)
  envelope.timestamp = Math.floor(Date.now() / 1000)
  envelope.scene_index = index % SCENE_PATHS.length
  envelope.scene_file = path.split('/').pop()
  return normalizeStreamMessage(envelope)
}
