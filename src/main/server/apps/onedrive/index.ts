import type { AppContext, AppDefinition } from '../types'
import { FOLDER_FIELDS, renderFolderPage } from '../folder/page'
import { serializeFolder, syncFolder } from '../folder/sync'
import type { RawItem } from '../folder/core'
import { refreshTokens } from '../../oauth/entra'

// OneDrive.
//
// The other half of the folder pair, and the one that gets a real sign-in.
// Microsoft's Files.Read scope stayed off the 2025 default-managed consent
// blocklist, so an ordinary person can agree to it without an administrator,
// and refresh tokens last ninety days with rotation — an unattended screen
// stays signed in. Google's equivalent would have cost an annual security
// assessment, which is why its half of this pair reads a shared link instead.
//
// The client id is the operator's own, pasted once. Shipping ours would have
// been kinder, but it needs a registration in a verified publisher's tenant,
// and without publisher verification Microsoft's step-up consent blocks work
// and school accounts outright — so a client id we could ship today would fail
// for exactly the customers most likely to use OneDrive.

const GRAPH = 'https://graph.microsoft.com/v1.0'

/** The item id out of a shared OneDrive link, or a folder path. Empty means
 *  the root of the signed-in account's drive. */
export function parseFolderRef(input: unknown): { kind: 'root' | 'path'; value: string } {
  const raw = String(input ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!raw) return { kind: 'root', value: '' }
  return { kind: 'path', value: raw }
}

export function folderPathProblem(input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (/^https?:/i.test(raw)) {
    return 'Paste the folder\'s name or path, not a link — for example: Signage/Lobby'
  }
  if (/[<>:"|?*]/.test(raw)) return 'A folder path cannot contain < > : " | ? *'
  return null
}

/** A valid access token, refreshing it first if it is close to expiry.
 *
 *  Refreshed five minutes early rather than on failure: a sync that starts with
 *  fifty seconds left on the token would otherwise die halfway through copying
 *  a folder, and leave the screen on a half-updated list. */
async function accessToken(ctx: AppContext): Promise<string> {
  const conn = ctx.connection
  if (!conn?.accessToken) {
    throw new Error('Not signed in to Microsoft. Open this app\'s settings and sign in.')
  }
  const clientId = String(conn.meta?.clientId ?? '')
  if (!conn.expiresAt || conn.expiresAt - Date.now() > 5 * 60_000) return conn.accessToken
  if (!clientId || !conn.refreshToken) return conn.accessToken

  const fresh = await refreshTokens(clientId, conn.refreshToken)
  ctx.updateConnection({
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken,
    expiresAt: fresh.expiresAt,
  })
  return fresh.accessToken
}

interface DriveItem {
  id: string
  name: string
  size?: number
  lastModifiedDateTime?: string
  cTag?: string
  eTag?: string
  file?: { mimeType?: string }
  folder?: unknown
  '@microsoft.graph.downloadUrl'?: string
}

async function listFolder(ctx: AppContext, ref: ReturnType<typeof parseFolderRef>): Promise<RawItem[]> {
  const token = await accessToken(ctx)
  const base = ref.kind === 'root'
    ? `${GRAPH}/me/drive/root/children`
    : `${GRAPH}/me/drive/root:/${ref.value.split('/').map(encodeURIComponent).join('/')}:/children`

  const out: RawItem[] = []
  let url = `${base}?$top=200&$select=id,name,size,lastModifiedDateTime,cTag,file,folder`
  // The download URL is only handed out on the item itself, so it has to be in
  // the select list even though it looks like metadata.
  url += ',@microsoft.graph.downloadUrl'

  for (let page = 0; page < 5 && url; page++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('The Microsoft sign-in has expired. Open this app\'s settings and sign in again.')
      }
      if (res.status === 404) {
        throw new Error('That folder is not in this account\'s OneDrive. Check the path.')
      }
      if (res.status === 403) {
        throw new Error('This account is not allowed to read that folder.')
      }
      throw new Error(`OneDrive returned ${res.status}.`)
    }
    const body = await res.json() as { value?: DriveItem[]; '@odata.nextLink'?: string }

    for (const it of body.value ?? []) {
      // Subfolders are listed but not descended into; the shared filter reports
      // everything it skipped, and a recursive sync is a different feature.
      if (it.folder || !it.file) continue
      const dl = it['@microsoft.graph.downloadUrl']
      if (!dl) continue
      out.push({
        id: it.id,
        name: it.name,
        mimeType: String(it.file.mimeType ?? ''),
        size: Number(it.size ?? 0),
        modifiedAt: it.lastModifiedDateTime ?? '',
        // cTag changes when the contents change; eTag also moves on a rename,
        // which would re-download a file for no reason.
        version: it.cTag ?? it.lastModifiedDateTime ?? '',
        downloadUrl: dl,
      })
    }
    url = body['@odata.nextLink'] ?? ''
  }
  return out
}

export const onedrive: AppDefinition = {
  id: 'onedrive',
  name: 'OneDrive',
  icon: '☁️',
  description: 'Play the pictures and videos in a OneDrive folder, and keep them in step.',
  category: 'media',
  provider: 'onedrive',
  defaultDuration: 60,

  fields: [
    {
      key: 'howto', label: 'How this works', type: 'note',
      help: 'This computer signs in to OneDrive, copies the pictures and videos onto itself, and ' +
        'serves them to your screens over your local network without a password — so only put ' +
        'things in the folder that are safe on a wall. Your screens never see the sign-in.',
    },
    {
      key: 'account', label: 'Microsoft account', type: 'connection', provider: 'onedrive',
      help: 'Personal, work or school. Sign-in opens your normal web browser.',
    },
    {
      key: 'folderPath', label: 'Folder', type: 'text', maxLength: 300,
      placeholder: 'Signage/Lobby',
      help: 'The folder inside your OneDrive. Leave empty to use the top level.',
    },
    ...FOLDER_FIELDS,
  ],

  validate(config) {
    return folderPathProblem(config.folderPath)
  },

  async refresh(ctx: AppContext) {
    const ref = parseFolderRef(ctx.instance.config.folderPath)
    return syncFolder(ctx, { list: () => listFolder(ctx, ref) })
  },

  serializeData: serializeFolder,

  render(ctx: AppContext): string {
    return renderFolderPage(ctx, 'OneDrive',
      'Nothing to show yet. Add pictures or videos to the OneDrive folder.')
  },
}
