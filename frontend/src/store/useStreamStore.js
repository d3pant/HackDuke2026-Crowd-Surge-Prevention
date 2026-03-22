import { create } from 'zustand'

/**
 * Density level → display color (PRD Design Tokens)
 * safe: #22C55E | watch: #EAB308 | warning: #F97316 | critical: #EF4444
 */
export const LEVEL_COLORS = {
  safe: '#22C55E',
  watch: '#EAB308',
  warning: '#F97316',
  critical: '#EF4444',
}

/** RGB stops for relative (per-snapshot) heat — low → high density within the grid */
const HEAT_STOPS = [
  [37, 99, 235],
  [16, 185, 129],
  [234, 179, 8],
  [249, 115, 22],
  [220, 38, 38],
]

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ]
}

function heatSpectrumRgb(t) {
  const x = Math.min(1, Math.max(0, t))
  const n = HEAT_STOPS.length - 1
  const f = x * n
  const i = Math.min(Math.floor(f), n - 1)
  const u = f - i
  return lerpRgb(HEAT_STOPS[i], HEAT_STOPS[i + 1], u)
}

function relativeLuminanceCss(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function cellSortValue(c) {
  if (c.density_pct != null && !Number.isNaN(Number(c.density_pct))) {
    return Number(c.density_pct)
  }
  return Number(c.count ?? 0)
}

/**
 * Per-snapshot relative coloring so the grid shows a full spectrum even when raw
 * CSRNet counts push most zones into the same discrete level (often critical/red).
 */
export function getZoneCellChrome(cells, cell) {
  if (!cells?.length) {
    return {
      backgroundColor: LEVEL_COLORS.safe,
      color: '#f8fafc',
    }
  }
  const values = cells.map(cellSortValue)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const v = cellSortValue(cell)
  const t = span < 1e-12 ? 0.5 : (v - min) / span
  const rgb = heatSpectrumRgb(t)
  const bg = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
  const lum = relativeLuminanceCss(rgb)
  const color = lum > 0.55 ? '#0f172a' : '#f8fafc'
  return { backgroundColor: bg, color }
}

const isMockWs = import.meta.env.VITE_MOCK_WS === 'true'

export const useStreamStore = create((set) => ({
  payload: null,
  selectedZoneId: null,
  connectionStatus: 'disconnected',
  /** When false, the dashboard freezes grid/heatmap to the last frame (video paused). */
  videoPlaying: false,
  /** Mock mode: run live matrix/heatmap without a working HTML5 video (API down or no MP4). */
  demoLiveMode: false,
  /**
   * mock: VITE_MOCK_WS · bake_pending: waiting for /api/density/bake-status ·
   * baked: three precomputed segments · live_ws: realtime WS density
   */
  densitySource: isMockWs ? 'mock' : 'bake_pending',
  /** False until backend bake-status is ready (real API only). Mock skips the gate. */
  bakeGateReady: isMockWs,
  bakedBundle: null,
  bakeError: null,
  setPayload: (payload) => set({ payload }),
  setSelectedZone: (zoneId) => set({ selectedZoneId: zoneId }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setVideoPlaying: (videoPlaying) => set({ videoPlaying }),
  setDemoLiveMode: (demoLiveMode) => set({ demoLiveMode }),
}))
