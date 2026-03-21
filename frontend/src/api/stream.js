import { normalizeStreamMessage } from '../lib/normalizeStreamMessage'

const jsonHeaders = { 'Content-Type': 'application/json' }

async function parseJsonOrThrow(res) {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText || `HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * Latest density JSON + image references (whatever Person 2 exposes).
 * Typical: GET /api/stream/snapshot
 */
export const getStreamSnapshot = () =>
  fetch('/api/stream/snapshot').then(parseJsonOrThrow)

/**
 * Optional: trigger work on the backend / ML side (Person 4 orchestration via FastAPI).
 * Body is opaque; Person 2 defines the contract.
 */
export const postStreamRequest = (body = {}) =>
  fetch('/api/stream/request', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  }).then(parseJsonOrThrow)

/** @returns {Promise<ReturnType<typeof normalizeStreamMessage>>} */
export async function fetchNormalizedSnapshot() {
  const raw = await getStreamSnapshot()
  return normalizeStreamMessage(raw)
}
