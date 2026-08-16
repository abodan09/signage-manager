import crypto from 'crypto'
import http from 'http'

// The sign-in half of OAuth for a desktop app.
//
// The shape is RFC 8252: no client secret, a proof key instead, and a redirect
// back to a listener on this machine's loopback address. A desktop app cannot
// keep a secret — it ships to customers, and anything in the binary is public —
// so the proof key is what stops an intercepted authorisation code being worth
// anything to whoever intercepted it.
//
// Three details here are load-bearing rather than decorative:
//
//   * The listener binds 127.0.0.1, never 0.0.0.0. This product already runs an
//     Express server deliberately exposed to the LAN, and it would be very easy
//     to start a second one the same way by habit. This one must be reachable
//     only from this machine, or a device on the network could answer the
//     redirect and take the code.
//   * The port is whatever the OS gives us. Providers match loopback redirects
//     without regard to port precisely so an installed app does not have to
//     claim a fixed one and fail when something else has it.
//   * `state` is checked before the code is accepted, so a stray request to the
//     listener cannot inject one.

export interface Pkce {
  verifier: string
  challenge: string
}

export function makePkce(): Pkce {
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export interface LoopbackResult {
  code: string
  redirectUri: string
}

export interface LoopbackOptions {
  /** Builds the provider's authorize URL once the redirect address is known. */
  authorizeUrl: (redirectUri: string, state: string) => string
  /** Opens the URL. Injected so tests never reach for Electron. */
  open: (url: string) => void
  /** Give up after this long — an operator may simply walk away. */
  timeoutMs?: number
}

/** Runs the browser half of the flow and resolves with the authorisation code. */
export function awaitCode(o: LoopbackOptions): Promise<LoopbackResult> {
  const state = crypto.randomBytes(16).toString('hex')

  return new Promise<LoopbackResult>((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      // Closed on the next tick so the browser gets its response body first;
      // otherwise the operator is left looking at a connection-reset page.
      setTimeout(() => { try { server.close() } catch { /* already closing */ } }, 250)
      fn()
    }

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const err = url.searchParams.get('error')
      const got = url.searchParams.get('state')

      const reply = (title: string, body: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font:16px system-ui,-apple-system,Segoe UI,Arial;margin:0;display:flex;
  align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#e2e8f0">
<div style="text-align:center;max-width:30em;padding:2em">
<div style="font-size:2em;margin-bottom:.4em">${title}</div>
<div style="opacity:.75;line-height:1.5">${body}</div></div></body></html>`)
      }

      if (err) {
        reply('Sign-in cancelled', 'You can close this tab and try again in the app.')
        done(() => reject(new Error(url.searchParams.get('error_description') || err)))
        return
      }
      if (!code) { reply('Waiting…', 'Nothing to do here.'); return }
      // Rejecting rather than ignoring: a mismatch means this response did not
      // come from the request we started.
      if (got !== state) {
        reply('Sign-in could not be verified', 'Please try again from the app.')
        done(() => reject(new Error('The sign-in response did not match the request.')))
        return
      }

      reply('Signed in', 'You can close this tab and go back to the app.')
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      done(() => resolve({ code, redirectUri: `http://127.0.0.1:${port}` }))
    })

    server.on('error', e => done(() => reject(e)))

    // 127.0.0.1 explicitly — see the note at the top of this file.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const redirectUri = `http://127.0.0.1:${port}`
      try {
        o.open(o.authorizeUrl(redirectUri, state))
      } catch (e) {
        done(() => reject(e instanceof Error ? e : new Error('Could not open the browser.')))
        return
      }
      setTimeout(() => done(() => reject(new Error('Sign-in timed out. Please try again.'))),
        o.timeoutMs ?? 5 * 60_000)
    })
  })
}
