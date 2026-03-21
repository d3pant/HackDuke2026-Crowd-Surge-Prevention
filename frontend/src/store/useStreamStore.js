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
  setPayload: (payload) => set({ payload }),
  setSelectedZone: (zoneId) => set({ selectedZoneId: zoneId }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}))
