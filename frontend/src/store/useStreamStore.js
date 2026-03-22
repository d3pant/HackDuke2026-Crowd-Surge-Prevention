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

export const useStreamStore = create((set) => ({
  payload: null,
  selectedZoneId: null,
  connectionStatus: 'disconnected',
  /** When false, the dashboard freezes grid/heatmap to the last frame (video paused). */
  videoPlaying: false,
  /** Mock mode: run live matrix/heatmap without a working HTML5 video (API down or no MP4). */
  demoLiveMode: false,
  /** Real API: stay “live” until the server finishes the last-frame density snapshot after video ends. */
  awaitingFinalDensity: false,
  setPayload: (payload) => set({ payload }),
  setSelectedZone: (zoneId) => set({ selectedZoneId: zoneId }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setVideoPlaying: (videoPlaying) => set({ videoPlaying }),
  setDemoLiveMode: (demoLiveMode) => set({ demoLiveMode }),
  setAwaitingFinalDensity: (awaitingFinalDensity) => set({ awaitingFinalDensity }),
}))
