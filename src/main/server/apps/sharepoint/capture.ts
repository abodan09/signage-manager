// Taking a picture of a web page.
//
// This exists because SharePoint cannot be put on a screen any other way. It
// refuses to be framed by another site, and its page bundle is written in a
// dialect of JavaScript that every TV browser we support fails to parse — so a
// panel would show a blank page, not a broken one. The manager runs a current
// Chromium, so it opens the page here, photographs it, and sends the screens an
// image they can all draw.
//
// Nothing in this file may be reached from a test that loads the app registry
// in bare node, so `electron` is required inside the functions rather than at
// the top. A top-level import here would break every existing app suite.

export interface CaptureOptions {
  url: string
  /** Viewport width in CSS pixels. Height follows from the mode. */
  width: number
  /** Page zoom as a percentage; 100 is untouched. */
  zoom: number
  /** Capture the full scrollable page rather than the first screenful. */
  whole: boolean
  background: string
  /** Append the undocumented ?env=Embedded, which hides SharePoint's own
   *  navigation. If Microsoft ever drops it the parameter is simply ignored and
   *  we get the page with its chrome — cosmetic, not a failure. */
  hideChrome: boolean
}

export interface CaptureResult {
  png: Buffer
  width: number
  height: number
  finalUrl: string
}

/** Above this the PNG costs more than the detail is worth on a panel that will
 *  downscale it anyway. */
const MAX_HEIGHT = 6000
/** The whole attempt, including sign-in redirects and a slow intranet. The
 *  store has no timeout of its own: it holds an in-flight lock that is only
 *  released in a `finally`, so a capture that never settles would stop that
 *  instance refreshing again until the manager restarts. */
const DEADLINE_MS = 45_000

/** Captures run one at a time, process-wide.
 *
 *  The store's sweeper refreshes every instance in a bare loop, so six
 *  SharePoint screens would otherwise open six Chromium windows at the same
 *  moment on the operator's PC. */
let queue: Promise<unknown> = Promise.resolve()
function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.then(() => undefined, () => undefined)
  return run
}

export function captureUrl(o: CaptureOptions, partition: string): Promise<CaptureResult> {
  return serialise(() => runCapture(o, partition))
}

async function runCapture(o: CaptureOptions, partition: string): Promise<CaptureResult> {
  // Required lazily: see the note at the top of this file.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BrowserWindow } = require('electron') as typeof import('electron')

  const width = Math.max(640, Math.min(2560, Math.round(o.width) || 1920))
  const height = Math.round(width * 9 / 16)
  const target = o.hideChrome ? addParam(o.url, 'env', 'Embedded') : o.url

  const win = new BrowserWindow({
    width, height, show: false,
    backgroundColor: o.background,
    webPreferences: {
      partition,
      offscreen: true,
      // A hidden window is throttled to a crawl by default, which turns a
      // ten-second page into a timeout.
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      // The captured page is a third party's; it must not be able to open
      // anything or reach anything of ours.
      sandbox: true,
    },
  })

  let frame: Electron.NativeImage | null = null
  win.webContents.on('paint', (_e, _dirty, image) => { frame = image })
  win.webContents.setFrameRate(10)
  // Popups (a consent prompt, a "open in app" nudge) would be new windows we
  // never see and never close.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const timer = setTimeout(() => { try { win.destroy() } catch { /* gone */ } }, DEADLINE_MS)

  try {
    const result = await Promise.race([
      capture(win, () => frame, target, o, width),
      new Promise<never>((_r, reject) =>
        setTimeout(() => reject(new Error(
          'The page did not finish loading in time. If it is a large SharePoint page, try again, ' +
          'or point this app at a simpler page.')), DEADLINE_MS)),
    ])
    return result
  } finally {
    clearTimeout(timer)
    try { if (!win.isDestroyed()) win.destroy() } catch { /* already gone */ }
  }
}

async function capture(
  win: Electron.BrowserWindow,
  getFrame: () => Electron.NativeImage | null,
  target: string,
  o: CaptureOptions,
  width: number,
): Promise<CaptureResult> {
  const wc = win.webContents

  try {
    await wc.loadURL(target)
  } catch (e: unknown) {
    // A redirect chain that ends somewhere unexpected aborts the load; the URL
    // check below gives a far better message than the raw Chromium error.
    const msg = e instanceof Error ? e.message : String(e)
    if (!/ERR_ABORTED/.test(msg)) throw new Error(`Could not open the page (${msg}).`)
  }

  if (o.zoom !== 100) wc.setZoomFactor(Math.max(0.5, Math.min(2, o.zoom / 100)))

  const finalUrl = wc.getURL()
  const landedOn = hostOf(finalUrl)
  const wanted = hostOf(target)
  // The primary signal that a capture is worthless. An unauthenticated request
  // is redirected to Microsoft, and a screenshot of a login page is a perfectly
  // valid-looking image that would sit on a wall for a fortnight.
  if (landedOn && wanted && landedOn !== wanted) {
    if (/login\.microsoft|login\.microsoftonline|login\.windows/.test(landedOn)) {
      throw new Error('Not signed in. Open this app\'s settings and use Sign In.')
    }
    throw new Error(`The address redirected to ${landedOn}, which is not the site you asked for.`)
  }

  await settle(wc)

  let height = Math.round(width * 9 / 16)
  if (o.whole) {
    const full = await measure(wc)
    height = Math.max(360, Math.min(MAX_HEIGHT, full))
    win.setContentSize(width, height)
    // The resize reflows the page and repaints; without a second settle the
    // frame is the old viewport stretched.
    await settle(wc)
  }

  const image = await grab(wc, getFrame)
  const size = image.getSize()
  if (!size.width || !size.height) throw new Error('The page produced no picture.')
  if (isFlat(image)) {
    throw new Error('The page did not finish drawing — the capture came back blank.')
  }

  return { png: image.toPNG(), width: size.width, height: size.height, finalUrl }
}

/** Waits for the page to stop changing shape. Two consecutive identical
 *  measurements beat any fixed sleep: a news page with lazy images grows for
 *  several seconds after `load` fires. */
async function settle(wc: Electron.WebContents): Promise<void> {
  let last = -1
  let stable = 0
  for (let i = 0; i < 40 && stable < 2; i++) {
    await wait(250)
    let h = -1
    try {
      h = await wc.executeJavaScript(
        'document.readyState === "complete" ? document.body.scrollHeight : -1', true)
    } catch { /* mid-navigation; try again */ }
    if (h > 0 && h === last) stable++
    else stable = 0
    last = h
  }
}

async function measure(wc: Electron.WebContents): Promise<number> {
  try {
    return await wc.executeJavaScript(
      'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)', true)
  } catch { return 0 }
}

/** Prefers the offscreen paint frame and falls back to capturePage(). On a
 *  locked or disconnected Windows session capturePage() fails outright with
 *  "Current display surface not available", which is exactly the state an
 *  unattended signage PC is usually in. */
async function grab(
  wc: Electron.WebContents,
  getFrame: () => Electron.NativeImage | null,
): Promise<Electron.NativeImage> {
  wc.invalidate()
  for (let i = 0; i < 40; i++) {
    const f = getFrame()
    if (f && !f.isEmpty()) return f
    await wait(150)
  }
  const shot = await wc.capturePage()
  if (shot.isEmpty()) throw new Error('The page produced no picture.')
  return shot
}

/** True when every sampled pixel is the same colour — a window that never
 *  painted. It does not catch a rendered error page; the URL check above is
 *  what does that. */
function isFlat(image: Electron.NativeImage): boolean {
  let bmp: Buffer
  try { bmp = image.toBitmap() } catch { return false }
  if (bmp.length < 16) return true
  const first = bmp.readUInt32LE(0)
  const step = Math.max(4, Math.floor(bmp.length / 4000) * 4)
  for (let i = 0; i + 4 <= bmp.length; i += step) {
    if (bmp.readUInt32LE(i) !== first) return false
  }
  return true
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

function addParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url)
    if (!u.searchParams.has(key)) u.searchParams.set(key, value)
    return u.toString()
  } catch { return url }
}

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
