import { normalizePayloadGridCells } from './normalizeGridCell'

/**
 * Maps backend stream payloads (WebSocket or HTTP) into UI-ready state.
 * Supports several naming conventions so Person 2 can evolve the API without breaking Phase 4.
 *
 * Expected shapes (any one):
 * - images: { grid?: string, frame?: string }
 * - grid_image / frame_image (URL path or data URL)
 * - grid_image_b64 / frame_image_b64 (raw base64 → wrapped as PNG data URLs)
 *
 * Density matrices: top-level `matrices: Record<string, number[][]>` or nested under `data`.
 *
 * Each `grid.cells[]` item (after normalization): id, row, col, row_start, row_end, col_start,
 * col_end, capacity, count, density_pct, growth_rate, level (safe | watch | warning | critical).
 */

function toImageSrc(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v) return null
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/')) return v
  if (v.startsWith('data:')) return v
  return `data:image/png;base64,${v}`
}

function stripImageFields(obj) {
  if (!obj || typeof obj !== 'object') return {}
  const {
    images,
    grid_image,
    frame_image,
    grid_image_b64,
    frame_image_b64,
    ...rest
  } = obj
  return rest
}

/**
 * @param {unknown} raw
 * @returns {{ payload: object, gridImageSrc: string | null, frameImageSrc: string | null } | null}
 */
export function normalizeStreamMessage(raw) {
  const body = raw && typeof raw === 'object' && raw.data != null ? raw.data : raw
  if (!body || typeof body !== 'object') return null

  const img =
    body.images && typeof body.images === 'object' ? body.images : {}

  const gridImageSrc = toImageSrc(
    img.grid ?? body.grid_image ?? body.grid_image_b64,
  )
  const frameImageSrc = toImageSrc(
    img.frame ?? body.frame_image ?? body.frame_image_b64,
  )

  const payload = normalizePayloadGridCells(stripImageFields(body))

  return {
    payload,
    gridImageSrc,
    frameImageSrc,
  }
}
