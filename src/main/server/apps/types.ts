// The apps subsystem.
//
// An "app" is a piece of software that turns a small amount of operator
// configuration into a screen: Weather, a YouTube video, an Instagram wall, a
// countdown. An *instance* is one saved configuration of an app, and behaves
// exactly like any other asset — it goes in the playlist and plays on screens.
//
// Two decisions shape everything here, and both exist because there will be
// two dozen of these:
//
//   1. Config is declared as data (AppField[]), not as a bespoke React form.
//      One generic form renders every app's settings, so a new app is a server
//      file and nothing else. It also means one validator, so no app can
//      forget to check its input.
//
//   2. The manager fetches third-party data, never the TV. Fifty screens
//      showing one Instagram wall make one API call, not fifty; credentials
//      stay on the PC; there is no CORS to fight; and a cached copy keeps the
//      wall on screen when the network or the API is down. Old TV WebViews are
//      the worst possible HTTP client and the best possible dumb renderer.

export type AppFieldType =
  | 'text' | 'textarea' | 'url' | 'number' | 'select' | 'color'
  | 'checkbox' | 'slider' | 'connection' | 'note' | 'image'

export interface AppSelectOption {
  value: string
  label: string
  /** Shown under the option in the picker, where a choice needs explaining. */
  hint?: string
}

export interface AppField {
  key: string
  label: string
  type: AppFieldType
  /** One line under the control. Say what it does, not what it is. */
  help?: string
  placeholder?: string
  required?: boolean
  default?: unknown
  /** select */
  options?: AppSelectOption[]
  /** number / slider */
  min?: number
  max?: number
  step?: number
  /** slider tick labels, e.g. ['Slow', 'Medium', 'Fast'] */
  marks?: string[]
  /** text / textarea */
  maxLength?: number
  /** connection — which provider must be linked before this app can run. */
  provider?: string
  /** Only shown when another field currently holds one of these values. */
  showIf?: { key: string; equals: Array<string | number | boolean> }
  /** Lives under the collapsible "Advanced" disclosure. */
  advanced?: boolean
}

export interface AppInstance {
  id: string
  appId: string
  name: string
  /** Validated against the app's fields on every write. */
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** What an app's render/refresh hooks are handed. */
export interface AppContext {
  instance: AppInstance
  /** Whatever refresh() last stored for this instance, or null. */
  data: unknown
  /** @font-face block for the bundled display faces. */
  fontCss: string
  /** Absolute base for links back to the manager, e.g. http://192.168.1.10:3001 */
  baseUrl: string
  /** Credentials for the provider this app connects to, if any. */
  connection?: AppConnection
  /** Copies a remote image into the manager and returns a local path such as
   *  "/app-media/ab12.jpg", or null if it could not be fetched. Anything a
   *  screen must still show tomorrow should go through this. */
  mirror(url: string): Promise<string | null>
}

export interface AppRefreshResult {
  /** Stored and handed back to render() as ctx.data. */
  data: unknown
  /** Seconds until this should be refetched. */
  ttlSeconds: number
}

export interface AppDefinition {
  id: string
  name: string
  icon: string
  /** One line, shown on the card in the Add App picker. */
  description: string
  category: 'social' | 'media' | 'information' | 'productivity' | 'utility'
  fields: AppField[]
  /** Provider that must be connected first, if any. */
  provider?: string
  /** Default seconds an instance stays on screen in the playlist. */
  defaultDuration: number
  /** Extra validation beyond the field types — cross-field rules only. */
  validate?(config: Record<string, unknown>): string | null
  /** Fetch and cache third-party data. Omitted for apps that need none
   *  (a clock, a countdown), which therefore keep working with no network. */
  refresh?(ctx: AppContext): Promise<AppRefreshResult>
  /** The page a TV loads. Must be ES5 and Chrome 53 safe. */
  render(ctx: AppContext): string
  /** Shapes the cached data for the page that polls it. Defaults to the cache
   *  verbatim; apps override it to trim payloads and to absolutise the local
   *  media paths, which differ between the manager and the LAN address. */
  serializeData?(ctx: AppContext): unknown
  /** A better name than the app's own, learned from the first fetch — a video's
   *  title, a document's heading. Only adopted when the operator has not
   *  renamed the instance themselves. */
  suggestName?(ctx: AppContext): string | null
}

/** A linked third-party account. Tokens are secrets: they live in their own
 *  file with restrictive permissions, never in db.json, and never leave the
 *  manager — the TV is handed rendered output, never a credential. */
export interface AppConnection {
  provider: string
  /** Shown in the UI so the operator knows which account is linked. */
  accountName?: string
  accountId?: string
  accessToken: string
  /** Epoch ms. Absent means it does not expire on a schedule. */
  expiresAt?: number
  refreshToken?: string
  connectedAt: string
  /** Anything provider-specific the app needs to make calls. */
  meta?: Record<string, unknown>
}
