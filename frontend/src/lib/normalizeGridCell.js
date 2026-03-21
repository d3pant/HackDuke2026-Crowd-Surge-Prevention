/**
 * One zone cell from the backend (Person 2). Canonical keys are snake_case.
 *
 * @typedef {object} DensityGridCell
 * @property {string} id
 * @property {number} row
 * @property {number} col
 * @property {number} row_start
 * @property {number} row_end
 * @property {number} col_start
 * @property {number} col_end
 * @property {number} capacity
 * @property {number} count
 * @property {number} density_pct
 * @property {number} growth_rate
 * @property {'safe' | 'watch' | 'warning' | 'critical'} level
 */

function num(c, snake, camel) {
  const v = c[snake] ?? (camel != null ? c[camel] : undefined)
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Coerces one cell and accepts camelCase aliases from some serializers.
 * @param {unknown} raw
 * @returns {DensityGridCell | null}
 */
export function normalizeGridCell(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id
  if (id == null || id === '') return null

  const level = typeof raw.level === 'string' ? raw.level : undefined

  return {
    id: String(id),
    row: num(raw, 'row'),
    col: num(raw, 'col'),
    row_start: num(raw, 'row_start', 'rowStart'),
    row_end: num(raw, 'row_end', 'rowEnd'),
    col_start: num(raw, 'col_start', 'colStart'),
    col_end: num(raw, 'col_end', 'colEnd'),
    capacity: num(raw, 'capacity'),
    count: num(raw, 'count'),
    density_pct: num(raw, 'density_pct', 'densityPct'),
    growth_rate: num(raw, 'growth_rate', 'growthRate'),
    level,
  }
}

/**
 * @param {unknown} payload
 * @returns {object}
 */
export function normalizePayloadGridCells(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const grid = payload.grid
  if (!grid || typeof grid !== 'object' || !Array.isArray(grid.cells)) return payload

  return {
    ...payload,
    grid: {
      ...grid,
      cells: grid.cells.map(normalizeGridCell).filter(Boolean),
    },
  }
}
