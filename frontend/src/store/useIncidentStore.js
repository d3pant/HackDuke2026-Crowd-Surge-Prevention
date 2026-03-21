import { create } from 'zustand'
import * as api from '../api/incidents'

export const useIncidentStore = create((set, get) => ({
  incidents: [],
  guards: [],
  fetchIncidents: async () => {
    const incidents = await api.getIncidents()
    set({ incidents })
  },
  fetchGuards: async () => {
    const guards = await api.getGuards()
    set({ guards })
  },
  assignGuard: async (incidentId, guardId) => {
    await api.assignGuard(incidentId, guardId)
    await get().fetchIncidents()
    await get().fetchGuards()
  },
  resolveIncident: async (incidentId) => {
    await api.resolveIncident(incidentId)
    await get().fetchIncidents()
    await get().fetchGuards()
  },
  createIncident: async (data) => {
    const created = await api.createIncident(data)
    await get().fetchIncidents()
    return created
  },
}))
