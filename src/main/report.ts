import { app, ipcMain, shell } from 'electron'
import os from 'os'
import { getInstallId } from './telemetry'

// Submitting a report used to mean opening GitHub in a browser with the form
// pre-filled, which asked the operator to own a GitHub account and finish the
// job somewhere else. Most of them have neither.
//
// It now posts to the relay on signage-api.frozenbit.eu, which stores the
// report and files the issue on our behalf. Two things about that are
// deliberate:
//
//   * The report is stored server-side before GitHub is touched, so "we filed
//     it" and "we have it" are different answers. The relay tells us which it
//     managed, and the dialog says so honestly rather than claiming success.
//   * If the relay cannot be reached at all, the caller falls back to the old
//     browser flow. A report nobody can send is worse than a clumsy one.

const REPORT_URL = 'https://signage-api.frozenbit.eu/report'

// Shared with the worker's REPORT_KEY secret. This ships inside a desktop
// binary, so it is not a secret in any strong sense — it only stops the
// endpoint being trivially scripted by someone who finds the URL. The real
// protection is the per-install and per-IP daily caps the worker enforces.
const REPORT_KEY = 'sm-report-2026-08'

const TIMEOUT_MS = 15_000

export interface ReportInput {
  category: string
  title: string
  description?: string
  steps?: string
  contact?: string
}

export interface ReportResult {
  ok: boolean
  /** Stored by the relay. True even when the GitHub issue could not be created. */
  stored?: boolean
  /** A GitHub issue exists for this report. */
  filed?: boolean
  issueUrl?: string | null
  /** Set when we could not reach the relay at all — the caller should fall back. */
  unreachable?: boolean
  error?: string
}

async function post(input: ReportInput): Promise<ReportResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-report-key': REPORT_KEY },
      body: JSON.stringify({
        category: input.category,
        title: input.title,
        description: input.description ?? '',
        steps: input.steps ?? '',
        contact: input.contact ?? '',
        installId: getInstallId(),
        appVersion: app.getVersion(),
        os: `${os.type()} ${os.release()} (${process.arch})`,
      }),
      signal: ctrl.signal,
    })

    const data = (await res.json().catch(() => ({}))) as {
      error?: string; stored?: boolean; filed?: boolean; issueUrl?: string | null
    }
    if (!res.ok) {
      // The relay answered, so the report was seen and rejected for a reason we
      // can repeat back — a cap, a missing title. Not a fallback case.
      return { ok: false, error: String(data.error || `The report was refused (${res.status}).`) }
    }
    return {
      ok: true,
      stored: data.stored !== false,
      filed: !!data.filed,
      issueUrl: data.issueUrl ?? null,
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      unreachable: true,
      error: aborted ? 'The report service did not answer in time.' : 'Could not reach the report service.',
    }
  } finally {
    clearTimeout(timer)
  }
}

/** The old flow, kept as the fallback when the relay cannot be reached. */
function githubUrl(input: ReportInput): string {
  const body = [
    input.description ?? '',
    input.steps ? `## Steps to reproduce\n${input.steps}` : '',
    `## Environment\n- App version: ${app.getVersion()}\n- Platform: ${os.type()} ${os.release()}`,
  ].filter(Boolean).join('\n\n')
  const label = { bug: 'bug', feature: 'enhancement', question: 'question' }[input.category]
  return `https://github.com/abodan09/signage-manager/issues/new`
    + `?title=${encodeURIComponent(input.title)}`
    + `&body=${encodeURIComponent(body)}`
    + (label ? `&labels=${encodeURIComponent(label)}` : '')
}

export function initReporting() {
  ipcMain.handle('report:submit', async (_e, raw: unknown): Promise<ReportResult> => {
    const input = raw as ReportInput
    if (!input || typeof input.title !== 'string' || !input.title.trim()) {
      return { ok: false, error: 'A title is required.' }
    }
    return post(input)
  })

  ipcMain.handle('report:open-github', (_e, raw: unknown) => {
    return shell.openExternal(githubUrl(raw as ReportInput))
  })
}
