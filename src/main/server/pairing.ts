import crypto from 'crypto'
import type { DevicePlatform } from './types'

// Screen pairing, modelled on the OAuth 2.0 Device Authorization Grant
// (RFC 8628). Two credentials per attempt:
//   userCode   — short, shown ON the TV, typed by the operator into this app
//   deviceCode — 256-bit, held only by the screen, never displayed
// The split is what stops someone who can merely SEE the code from claiming the
// screen: redeeming it requires the deviceCode, which only the process that
// called /api/pair/start ever received.
//
// State lives in memory on purpose. JsonDB.save() rewrites the entire db.json on
// every mutation, so persisting per-poll counters would rewrite the file every
// few seconds per unpaired TV — and short-lived secrets should not sit in a
// plaintext file. Losing pending pairings on restart is correct behaviour.

// RFC 8628 §6.1's recommended alphabet: no vowels (so no accidental words), and
// none of the 0/O, 1/I/l, 5/S, 8/B pairs that get misread across a room.
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
const CODE_LEN = 8
export const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/

const TTL_MS         = 15 * 60_000   // a displayed code is only ever 15 min old
const BASE_INTERVAL  = 5             // seconds; RFC 8628 §3.5 default
const MAX_PENDING    = 20
const MAX_FAILURES   = 5             // RFC 8628 §5.1: 5 attempts on 8 base-20 chars
const LOCKOUT_MS     = 15 * 60_000
const DELIVERED_MS   = 60_000        // keep a paired record briefly for retries
const START_PER_10S  = 1
const START_PER_HOUR = 10

export interface PendingPairing {
  userCode: string
  deviceCodeHash: string
  platform: DevicePlatform
  playerVersion?: string
  suggestedName?: string
  ip: string
  createdAt: number
  expiresAt: number
  interval: number
  lastPolledAt: number
  status: 'pending' | 'approved' | 'denied'
  deviceId?: string
  token?: string
  deliveredAt?: number
}

export type StartResult =
  | { ok: true; userCode: string; deviceCode: string; expiresIn: number; interval: number }
  | { ok: false; error: string; retryAfterSeconds: number }

export type PollResult =
  | { status: 'authorization_pending'; interval: number }
  | { status: 'slow_down'; interval: number }
  | { status: 'denied' }
  | { status: 'paired'; deviceId: string; token: string }
  | { status: 'expired' }

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
export const formatCode = (c: string) => c.slice(0, 4) + '-' + c.slice(4)
export const normalizeCode = (input: unknown) =>
  String(input ?? '').replace(/[^A-Za-z]/g, '').toUpperCase()

export class PairingStore {
  private byHash = new Map<string, PendingPairing>()
  private byCode = new Map<string, string>()
  private startHits = new Map<string, number[]>()
  private approveFailures = 0
  private approveLockedUntil = 0
  private timer: NodeJS.Timeout | null = null

  constructor(private now: () => number = Date.now) {}

  /** Drops expired requests and delivered tokens. Safe to call at any time. */
  sweep() {
    const t = this.now()
    for (const [hash, p] of this.byHash) {
      const delivered = p.deliveredAt !== undefined && t - p.deliveredAt > DELIVERED_MS
      if (t > p.expiresAt || delivered) {
        this.byHash.delete(hash)
        if (this.byCode.get(p.userCode) === hash) this.byCode.delete(p.userCode)
      }
    }
  }

  startSweeper() {
    if (this.timer) return
    this.timer = setInterval(() => this.sweep(), 30_000)
    this.timer.unref?.()
  }

  stopSweeper() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private newUserCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let s = ''
      // crypto.randomInt is rejection-sampled, so there is no modulo bias.
      for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
      if (!this.byCode.has(s)) return s
    }
    throw new Error('could not allocate a unique pairing code')
  }

  private rateLimitStart(ip: string): { ok: true } | { ok: false; error: string; retryAfterSeconds: number } {
    const t = this.now()
    const hits = (this.startHits.get(ip) ?? []).filter(x => t - x < 3_600_000)
    const recent = hits.filter(x => t - x < 10_000)
    if (recent.length >= START_PER_10S) return { ok: false, error: 'rate_limited', retryAfterSeconds: 10 }
    if (hits.length >= START_PER_HOUR) {
      const oldest = hits[0]
      return { ok: false, error: 'rate_limited_hourly', retryAfterSeconds: Math.max(1, Math.ceil((3_600_000 - (t - oldest)) / 1000)) }
    }
    hits.push(t)
    this.startHits.set(ip, hits)
    return { ok: true }
  }

  start(opts: {
    ip: string
    platform?: string
    playerVersion?: string
    name?: string
  }): StartResult {
    this.sweep()
    const limited = this.rateLimitStart(opts.ip)
    if (!limited.ok) return { ok: false, error: limited.error, retryAfterSeconds: limited.retryAfterSeconds }
    if (this.byHash.size >= MAX_PENDING) {
      return { ok: false, error: 'too_many_pending', retryAfterSeconds: 30 }
    }

    const t = this.now()
    const userCode = this.newUserCode()
    const deviceCode = crypto.randomBytes(32).toString('base64url')
    const hash = sha256(deviceCode)
    const platforms: DevicePlatform[] = ['android', 'webos', 'tizen', 'browser']
    const platform = platforms.includes(opts.platform as DevicePlatform)
      ? (opts.platform as DevicePlatform)
      : 'unknown'

    const rec: PendingPairing = {
      userCode,
      deviceCodeHash: hash,
      platform,
      playerVersion: typeof opts.playerVersion === 'string' ? opts.playerVersion.slice(0, 32) : undefined,
      suggestedName: typeof opts.name === 'string' && opts.name.trim() ? opts.name.trim().slice(0, 60) : undefined,
      ip: opts.ip,
      createdAt: t,
      expiresAt: t + TTL_MS,
      interval: BASE_INTERVAL,
      lastPolledAt: 0,
      status: 'pending',
    }
    this.byHash.set(hash, rec)
    this.byCode.set(userCode, hash)

    return {
      ok: true,
      userCode: formatCode(userCode),
      deviceCode,
      expiresIn: Math.floor(TTL_MS / 1000),
      interval: BASE_INTERVAL,
    }
  }

  poll(deviceCode: string): PollResult {
    const rec = this.byHash.get(sha256(String(deviceCode ?? '')))
    const t = this.now()
    if (!rec || t > rec.expiresAt) return { status: 'expired' }

    if (rec.status === 'approved' && rec.token && rec.deviceId) {
      // Re-answer with the same token for a short window so a dropped response
      // can't strand a screen that is, as far as the server knows, paired.
      if (rec.deliveredAt === undefined) rec.deliveredAt = t
      return { status: 'paired', deviceId: rec.deviceId, token: rec.token }
    }
    if (rec.status === 'denied') return { status: 'denied' }

    // Polling faster than the advertised interval ratchets it up permanently
    // (RFC 8628 §3.5), which is what makes guessing a deviceCode pointless.
    if (rec.lastPolledAt && t - rec.lastPolledAt < rec.interval * 1000 - 500) {
      rec.interval += 5
      rec.lastPolledAt = t
      return { status: 'slow_down', interval: rec.interval }
    }
    rec.lastPolledAt = t
    return { status: 'authorization_pending', interval: rec.interval }
  }

  listPending() {
    this.sweep()
    const out: Array<Omit<PendingPairing, 'deviceCodeHash' | 'token'> & { userCodeFormatted: string }> = []
    for (const p of this.byHash.values()) {
      if (p.status !== 'pending') continue
      const { deviceCodeHash, token, ...rest } = p
      out.push({ ...rest, userCodeFormatted: formatCode(p.userCode) })
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  }

  get lockout() {
    const remaining = this.approveLockedUntil - this.now()
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0
  }

  /** Looks a well-formed code up, counting failures toward the lockout. */
  resolve(rawCode: string): { ok: true; rec: PendingPairing } | { ok: false; reason: 'locked' | 'unknown'; retryAfterSeconds?: number; attemptsRemaining?: number } {
    this.sweep()
    if (this.lockout > 0) return { ok: false, reason: 'locked', retryAfterSeconds: this.lockout }

    const hash = this.byCode.get(rawCode)
    const rec = hash ? this.byHash.get(hash) : undefined
    if (!rec || rec.status !== 'pending' || this.now() > rec.expiresAt) {
      this.approveFailures++
      // MAX_FAILURES guesses are allowed; the one after that locks. RFC 8628
      // §5.1 puts 5 attempts against an 8-char base-20 code at 2^-32.
      if (this.approveFailures > MAX_FAILURES) {
        this.approveLockedUntil = this.now() + LOCKOUT_MS
        this.approveFailures = 0
        return { ok: false, reason: 'locked', retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000) }
      }
      return { ok: false, reason: 'unknown', attemptsRemaining: MAX_FAILURES - this.approveFailures }
    }
    this.approveFailures = 0
    return { ok: true, rec }
  }

  approve(rec: PendingPairing, deviceId: string): string {
    const token = crypto.randomBytes(32).toString('base64url')
    rec.status = 'approved'
    rec.deviceId = deviceId
    rec.token = token
    this.byCode.delete(rec.userCode)
    return token
  }

  deny(rec: PendingPairing) {
    rec.status = 'denied'
    this.byCode.delete(rec.userCode)
  }

  /** Test seam. */
  _reset() {
    this.byHash.clear(); this.byCode.clear(); this.startHits.clear()
    this.approveFailures = 0; this.approveLockedUntil = 0
  }
}
