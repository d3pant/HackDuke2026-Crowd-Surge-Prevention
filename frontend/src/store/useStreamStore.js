import { create } from 'zustand'
import * as streamApi from '../api/stream'

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

export const useStreamStore = create((set, get) => ({
  payload: null,
  /** Grid visualization: URL, path, or data URL (from Person 2). */
  gridImageSrc: null,
  /** Camera / raw frame: URL, path, or data URL. */
  frameImageSrc: null,
  selectedZoneId: null,
  connectionStatus: 'disconnected',
  setPayload: (payload) => set({ payload }),
  setStreamVisuals: ({ gridImageSrc, frameImageSrc }) =>
    set({
      gridImageSrc: gridImageSrc ?? null,
      frameImageSrc: frameImageSrc ?? null,
    }),
  applyStreamMessage: (normalized) => {
    if (!normalized) return
    set({
      payload: normalized.payload,
      gridImageSrc: normalized.gridImageSrc,
      frameImageSrc: normalized.frameImageSrc,
    })
  },
  setSelectedZone: (zoneId) => set({ selectedZoneId: zoneId }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  refreshSnapshot: async () => {
    const normalized = await streamApi.fetchNormalizedSnapshot()
    if (normalized) get().applyStreamMessage(normalized)
  },
  requestStreamAndRefresh: async (body) => {
    await streamApi.postStreamRequest(body)
    const normalized = await streamApi.fetchNormalizedSnapshot()
    if (normalized) get().applyStreamMessage(normalized)
  },
}))
