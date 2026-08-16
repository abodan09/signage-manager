import type { AppContext, AppDefinition } from '../types'
import { FOLDER_FIELDS, renderFolderPage } from '../folder/page'
import { serializeFolder, syncFolder } from '../folder/sync'
import type { RawItem } from '../folder/core'

// Google Drive.
//
// This app reads a link-shared folder with an API key rather than signing in,
// and that is a decision worth recording because it looks like a shortcut and
// is not.
//
// Listing a folder the operator owns needs the drive.readonly scope, which
// Google classifies as *restricted*: a distributed desktop app using it needs
// brand verification and an annual third-party security assessment, renewed
// forever, and the first thing an assessor would look at is this product's
// architecture — folder media served unauthenticated over a customer's LAN.
// Skipping verification caps the whole product at a hundred users for its
// lifetime, and an OAuth client left in "Testing" hands out refresh tokens that
// expire after seven days, which would sign every unattended signage PC out
// every week.
//
// A link-shared folder read with an API key has none of that: no consent
// screen, no review, no user cap, and no token to expire. What it costs is
// honesty in the UI — the key is not a login, it sees exactly what a logged-out
// browser sees, so a private folder stays invisible even to its owner.

const LIST = 'https://www.googleapis.com/drive/v3/files'

/** The folder id out of any of the forms Drive hands people. */
export function parseFolderId(input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  // A bare id, pasted from the address bar.
  if (/^[A-Za-z0-9_-]{10,}$/.test(raw)) return raw
  const m = /\/folders\/([A-Za-z0-9_-]+)/.exec(raw)
  if (m) return m[1]
  const q = /[?&]id=([A-Za-z0-9_-]+)/.exec(raw)
  if (q) return q[1]
  return null
}

/** The operator-facing reason a pasted link will not work, or null. */
export function folderLinkProblem(input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (/\/file\/d\//.test(raw)) {
    return 'That is a link to one file. Open the folder that contains it and copy that link instead.'
  }
  if (/docs\.google\.com/.test(raw)) {
    return 'That is a Google document, not a folder of pictures.'
  }
  if (!parseFolderId(raw)) {
    return 'That does not look like a Drive folder link. In Drive, open the folder, then Share → Copy link.'
  }
  return null
}

async function listFolder(folderId: string, apiKey: string): Promise<RawItem[]> {
  const out: RawItem[] = []
  let pageToken = ''

  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum)',
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      key: apiKey,
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(`${LIST}?${params.toString()}`)
    if (!res.ok) {
      // The three failures an operator can actually fix, named as such.
      if (res.status === 403) {
        throw new Error('Google refused the key. Check it allows the Drive API, and that it has not expired.')
      }
      if (res.status === 404) {
        throw new Error('That folder is not shared. In Drive: Share → General access → Anyone with the link.')
      }
      if (res.status === 400) {
        throw new Error('Google did not recognise that folder link.')
      }
      throw new Error(`Google Drive returned ${res.status}.`)
    }
    const body = await res.json() as {
      nextPageToken?: string
      files?: Array<{
        id: string; name: string; mimeType: string; size?: string
        modifiedTime?: string; md5Checksum?: string
      }>
    }

    for (const f of body.files ?? []) {
      out.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: Number(f.size ?? 0),
        modifiedAt: f.modifiedTime ?? '',
        // md5 is absent for Google-native files, which are filtered out anyway;
        // the modified time is enough to notice a change for anything else.
        version: f.md5Checksum ?? f.modifiedTime ?? '',
        downloadUrl: `${LIST}/${encodeURIComponent(f.id)}?alt=media&key=${encodeURIComponent(apiKey)}`,
      })
    }
    pageToken = body.nextPageToken ?? ''
    if (!pageToken) break
  }
  return out
}

export const gdrive: AppDefinition = {
  id: 'gdrive',
  name: 'Google Drive',
  icon: '📁',
  description: 'Play the pictures and videos in a Google Drive folder, and keep them in step.',
  category: 'media',
  provider: 'googledrive',
  defaultDuration: 60,

  fields: [
    {
      key: 'howto', label: 'How this works', type: 'note',
      help: 'The folder must be shared as "Anyone with the link". This computer copies the ' +
        'pictures and videos onto itself and serves them to your screens over your local ' +
        'network without a password, so only put things in the folder that are safe on a wall.',
    },
    {
      key: 'apiKey', label: 'Google API key', type: 'connection', provider: 'googledrive',
      help: 'A free key from your own Google account. It is not a sign-in — it only lets this ' +
        'computer read folders that are already shared with anyone who has the link.',
    },
    {
      key: 'folderUrl', label: 'Google Drive folder link', type: 'url', required: true,
      placeholder: 'https://drive.google.com/drive/folders/1AbC…',
      help: 'In Drive: right-click the folder → Share → General access → Anyone with the link → Copy link.',
    },
    ...FOLDER_FIELDS,
  ],

  validate(config) {
    return folderLinkProblem(config.folderUrl)
  },

  async refresh(ctx: AppContext) {
    const folderId = parseFolderId(ctx.instance.config.folderUrl)
    if (!folderId) throw new Error('No folder link set.')

    // The key lives with the connections, not in config: it is a credential,
    // and config is exported and copied around.
    const apiKey = String(ctx.connection?.accessToken ?? '').trim()
    if (!apiKey) throw new Error('No Google API key yet. Add one in this app\'s settings.')

    return syncFolder(ctx, { list: () => listFolder(folderId, apiKey) })
  },

  serializeData: serializeFolder,

  render(ctx: AppContext): string {
    return renderFolderPage(ctx, 'Google Drive',
      'Nothing to show yet. Add pictures or videos to the shared Drive folder.')
  },
}
