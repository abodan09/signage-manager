import dgram from 'dgram'
import os from 'os'

const DISCOVERY_PORT = 47777
const INTERVAL_MS    = 5000

interface LanInterface {
  name: string
  address: string
  netmask: string
  broadcast: string   // subnet-directed broadcast address
  score: number
}

// Interface names that are (almost) never the LAN the TVs live on.
const VIRTUAL_NAME = /tailscale|zerotier|hamachi|vethernet|wsl|virtualbox|vmware|docker|hyper-v|npcap|loopback|tun|tap|wireguard|openvpn/i

function directedBroadcast(address: string, netmask: string): string {
  const a = address.split('.').map(Number)
  const m = netmask.split('.').map(Number)
  return a.map((oct, i) => (oct & m[i]) | (~m[i] & 0xff)).join('.')
}

/**
 * All plausible LAN interfaces, best first. Machines routinely have VPN
 * (Tailscale = CGNAT 100.64/10), link-local (169.254/16) and virtual adapters
 * that enumerate BEFORE the real NIC — naively taking the first IPv4 broke
 * discovery and showed users an unreachable "server IP".
 */
export function listLanInterfaces(): LanInterface[] {
  const result: LanInterface[] = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const [o1, o2] = a.address.split('.').map(Number)
      if (o1 === 169 && o2 === 254) continue              // link-local (dead adapter)
      if (o1 === 100 && o2 >= 64 && o2 <= 127) continue   // CGNAT — Tailscale et al.

      let score = 0
      if (o1 === 192 && o2 === 168) score = 3             // typical home/office LAN
      else if (o1 === 10) score = 2
      else if (o1 === 172 && o2 >= 16 && o2 <= 31) score = 1
      if (VIRTUAL_NAME.test(name)) score -= 10

      result.push({
        name,
        address: a.address,
        netmask: a.netmask,
        broadcast: directedBroadcast(a.address, a.netmask),
        score,
      })
    }
  }
  return result.sort((x, y) => y.score - x.score)
}

export function getLocalIP(): string {
  const best = listLanInterfaces()[0]
  if (best) return best.address
  // Nothing survived the filters — fall back to any non-internal IPv4
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
  let closed = false

  socket.on('error', err => {
    console.warn('[discovery] socket error:', err.message)
  })

  socket.bind(0, () => {
    try { socket.setBroadcast(true) } catch { /* ignore if unavailable */ }

    const send = () => {
      if (closed) return
      // Re-enumerated every tick so plugging/unplugging networks just works.
      const lans = listLanInterfaces()
      const allIps = lans.map(l => l.address)

      const payloadFor = (ip: string) => Buffer.from(JSON.stringify({
        type:    'signage-discovery',
        name:    'Signage Manager',
        ip,                    // the address reachable FROM the subnet this packet lands on
        ips:     allIps,       // every candidate, best first (fallback for clients)
        port:    serverPort,
        version: appVersion,
      }))

      // Subnet-directed broadcasts (e.g. 192.168.1.255) follow the routing
      // table, so each one leaves through the right adapter — unlike
      // 255.255.255.255, which Windows sends out ONE arbitrary interface.
      for (const lan of lans) {
        socket.send(payloadFor(lan.address), DISCOVERY_PORT, lan.broadcast, err => {
          if (err) console.warn(`[discovery] broadcast to ${lan.broadcast} failed:`, err.message)
        })
      }

      // Limited broadcast kept as a best-effort extra path.
      const bestIp = allIps[0] ?? getLocalIP()
      socket.send(payloadFor(bestIp), DISCOVERY_PORT, '255.255.255.255', () => { /* best effort */ })
    }

    send()
    timer = setInterval(send, INTERVAL_MS)
  })

  return () => {
    closed = true
    if (timer) { clearInterval(timer); timer = null }
    try { socket.close() } catch { /* ignore */ }
  }
}
