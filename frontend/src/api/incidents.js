const jsonHeaders = { 'Content-Type': 'application/json' }

async function parseJsonOrThrow(res) {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText || `HTTP ${res.status}`)
  }
  return res.json()
}

export const getIncidents = (status) =>
  fetch(`/api/incidents?status=${status ?? ''}`).then(parseJsonOrThrow)

export const createIncident = (data) =>
  fetch('/api/incidents', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(data),
  }).then(parseJsonOrThrow)

export const assignGuard = (incidentId, guardId) =>
  fetch(`/api/incidents/${incidentId}/assign`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ guard_id: guardId }),
  }).then(parseJsonOrThrow)

export const resolveIncident = (incidentId) =>
  fetch(`/api/incidents/${incidentId}/resolve`, { method: 'POST' }).then(parseJsonOrThrow)

export const getGuards = () => fetch('/api/guards').then(parseJsonOrThrow)

export const getZoneHistory = (zoneId, limit = 60) =>
  fetch(`/api/zones/${zoneId}/history?limit=${limit}`).then(parseJsonOrThrow)

export const controlStream = (action, speed) =>
  fetch('/api/stream/control', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ action, speed }),
  }).then(parseJsonOrThrow)
