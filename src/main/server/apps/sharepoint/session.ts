// Signing in to Microsoft, without ever handling a password.
//
// The alternative was an OAuth app registration, and it is worth writing down
// why we are not doing that. Reading SharePoint content through Microsoft Graph
// needs Sites.Read.All, which Microsoft moved onto the default admin-consent
// exclusion list in 2025 — an ordinary operator clicking Sign In is told "Need
// admin approval" and stops. This way there is no app registration, no tenant
// id, no consent screen and no administrator: a real browser window does a real
// top-level sign-in, exactly as if the operator had opened the site themselves,
// and MFA, passkeys and Conditional Access prompts all work because it is a
// real browser.
//
// What we keep is a cookie jar in a private session partition, not credentials.
//
// Electron is required lazily here for the same reason as in capture.ts: the
// app registry is loaded by tests running in bare node.

/** Chromium keeps this under <userData>/Partitions/sharepoint and encrypts the
 *  cookie store with the OS keychain (DPAPI on Windows). */
export const PARTITION = 'persist:sharepoint'

export interface SignInResult {
  /** The host the window finished on, for the caller to sanity-check. */
  host: string
  signedIn: boolean
}

/** Opens a visible window for the operator to sign in, and resolves when they
 *  land back on the site they asked for.
 *
 *  Visible, and deliberately so: this is the one moment the operator must see
 *  and drive. Everything after it is silent. */
export function signIn(url: string): Promise<SignInResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BrowserWindow } = require('electron') as typeof import('electron')

  let target = ''
  try { target = new URL(url).hostname.toLowerCase() } catch { /* validated upstream */ }

  return new Promise<SignInResult>(resolve => {
    const win = new BrowserWindow({
      width: 980, height: 800,
      title: 'Sign in to Microsoft',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    let done = false
    const finish = (signedIn: boolean, host: string) => {
      if (done) return
      done = true
      resolve({ signedIn, host })
      // Closing from inside the navigation handler crashes Chromium mid-commit.
      setTimeout(() => { try { if (!win.isDestroyed()) win.close() } catch { /* gone */ } }, 400)
    }

    // Landing back on the target host means the sign-in completed and the
    // cookie jar now holds a session. There is no other reliable signal —
    // Microsoft's flow is many redirects long and varies by tenant.
    win.webContents.on('did-navigate', (_e, navUrl) => {
      let host = ''
      try { host = new URL(navUrl).hostname.toLowerCase() } catch { return }
      if (target && host === target) finish(true, host)
    })

    // The operator closing the window themselves is a legitimate outcome: they
    // may have given up, or signed in and closed it before we noticed.
    win.on('closed', () => { if (!done) { done = true; resolve({ signedIn: false, host: '' }) } })

    void win.loadURL(url)
  })
}

/** Signs out for real.
 *
 *  Removing only the stored record — which is all the existing DELETE route
 *  did — would leave the cookie jar intact and every capture would keep
 *  succeeding. A sign-out that does not sign you out is worse than none. */
export async function signOut(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { session } = require('electron') as typeof import('electron')
  try {
    await session.fromPartition(PARTITION).clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
    })
  } catch { /* nothing stored yet */ }
}
