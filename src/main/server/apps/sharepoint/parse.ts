// Reading a pasted SharePoint address.
//
// Kept free of Electron and of the app definition so it can be tested in bare
// node. Everything here is about telling the operator, at save time, that what
// they pasted is not what they think it is — a wrong address here becomes a
// screen showing a Microsoft error page for a fortnight before anyone mentions
// it.

export interface SharePointUrl {
  kind: 'site' | 'page' | 'other'
  host: string
  /** '/sites/Marketing' — empty for a tenant root. */
  sitePath: string
  /** Rebuilt rather than echoed back: a pasted address carries fragments and
   *  tracking parameters that mean nothing to a capture and everything to a
   *  cache key. */
  canonicalUrl: string
}

export function parseSharePointUrl(input: unknown): SharePointUrl | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname) return null

  const parts = u.pathname.split('/').filter(Boolean)
  let sitePath = ''
  if (parts.length >= 2 && (parts[0] === 'sites' || parts[0] === 'teams')) {
    sitePath = `/${parts[0]}/${parts[1]}`
  }

  const kind: SharePointUrl['kind'] =
    /\.aspx$/i.test(u.pathname) ? 'page'
      : sitePath || parts.length === 0 ? 'site'
        : 'other'

  // The fragment never reaches a server, and the query is kept because some
  // pages genuinely need it (a filtered list view, a specific news post).
  u.hash = ''

  return { kind, host: u.hostname, sitePath, canonicalUrl: u.toString() }
}

/** The operator-facing reason a pasted address will not work, or null.
 *
 *  Each of these is something that looks close enough to right that it would
 *  otherwise be found on a wall rather than in the form. */
export function sharePointUrlProblem(input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null   // `required` already covers emptiness

  const parsed = parseSharePointUrl(raw)
  if (!parsed) return 'That is not a web address. Paste the address from your browser\'s address bar.'

  const host = parsed.host.toLowerCase()

  if (/(^|\.)login\.microsoftonline\.com$/.test(host) || /(^|\.)login\.microsoft\.com$/.test(host)) {
    return 'That is the Microsoft sign-in address. Paste the address of the SharePoint page itself.'
  }
  if (/-my\.sharepoint\.com$/.test(host)) {
    return 'That is a personal OneDrive, not a SharePoint site.'
  }
  if (host === '1drv.ms' || /\/:[a-z]:\//i.test(raw)) {
    return 'That is a link to a single file. Paste the address of the site or page.'
  }
  if (/\.sharepoint\.com$/.test(host) && raw.toLowerCase().startsWith('http://')) {
    return 'SharePoint Online is always https. Change http:// to https://.'
  }
  return null
}
