import dgram from 'dgram'
import os from 'os'

const DISCOVERY_PORT = 47777
const INTERVAL_MS    = 5000

export function getLocalIP(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const a of ifaces ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return '127.0.0.1'
}

export function startDiscovery(serverPort: number, appVersion: string): () => void {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  let timer: NodeJS.Timeout | null = null

  socket.on('error', err => {
    console.warn('[discovery] socket error:', err.message)
    socket.close()
  })

  socket.bind(0, () => {
    try { socket.setBroadcast(true) } catch { /* ignore if unavailable */ }

    const send = () => {
      const payload = Buffer.from(JSON.stringify({
        type:    'signage-discovery',
        name:    'Signage Manager',
        ip:      getLocalIP(),
        port:    serverPort,
        version: appVersion,
      }))
      socket.send(payload, DISCOVERY_PORT, '255.255.255.255', err => {
        if (err) console.warn('[discovery] broadcast error:', err.message)
      })
    }

    send()
    timer = setInterval(send, INTERVAL_MS)
  })

  return () => {
    if (timer) { clearInterval(timer); timer = null }
    try { socket.close() } catch { /* ignore */ }
  }
}
