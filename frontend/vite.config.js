import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function ignoreBenignProxySocketErr(err) {
  const c = err && err.code
  if (c === 'EPIPE' || c === 'ECONNRESET') return true
  const m = String(err && err.message || '')
  if (m.includes('EPIPE') || m.includes('ECONNRESET')) return true
  return false
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (ignoreBenignProxySocketErr(err)) return
            console.warn('[vite] /api proxy:', err.message)
          })
        },
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (ignoreBenignProxySocketErr(err)) return
            console.warn('[vite] ws proxy:', err.message)
          })
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', (err) => {
              if (ignoreBenignProxySocketErr(err)) return
              console.warn('[vite] ws client socket:', err.message)
            })
          })
        },
      },
    },
  },
})
