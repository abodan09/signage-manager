import { useState } from 'react'
import type { IssueReport, IssueReportResult } from '../types'

interface Props {
  version: string
  onClose: () => void
}

const CATEGORIES = [
  { value: 'bug',     label: '🐛 Bug / Something broken' },
  { value: 'feature', label: '✨ Feature request' },
  { value: 'question',label: '❓ Question / Help' },
  { value: 'other',   label: '📋 Other' },
]

export default function ReportIssueDialog({ version, onClose }: Props) {
  const [title, setTitle]           = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps]           = useState('')
  const [category, setCategory]     = useState('bug')
  const [contact, setContact]       = useState('')
  const [submitted, setSubmitted]   = useState(false)
  const [sending, setSending]       = useState(false)
  const [error, setError]           = useState('')
  const [result, setResult]         = useState<IssueReportResult | null>(null)

  const payload = (): IssueReport => ({
    category,
    title: title.trim(),
    description: description.trim(),
    steps: steps.trim(),
    contact: contact.trim(),
  })

  async function handleSubmit() {
    if (!title.trim() || sending) return
    setSending(true); setError('')
    const res = await window.electronAPI.submitReport(payload())
    setSending(false)

    if (res.ok) { setResult(res); setSubmitted(true); return }

    // A refusal we can explain is shown as-is. Being unable to reach the relay
    // at all is the only case that falls back to the browser, because then the
    // report exists nowhere yet.
    if (res.unreachable) {
      await window.electronAPI.openReportOnGithub(payload())
      setResult({ ok: false, unreachable: true }); setSubmitted(true); return
    }
    setError(res.error || 'The report could not be sent.')
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-primary, #0f172a)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '28px 32px',
        width: 480,
        maxHeight: '85vh',
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Report an Issue</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18 }}
          >✕</button>
        </div>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 40 }}>{result?.unreachable ? '📨' : '✅'}</div>
            <div style={{ fontWeight: 600 }}>
              {result?.unreachable ? 'GitHub opened in your browser'
                : result?.filed ? 'Report sent' : 'Report received'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {result?.unreachable ? (
                <>We could not reach the report service, so your report has been pre-filled on GitHub instead. Review it and click <strong>Submit new issue</strong> to publish it.</>
              ) : result?.filed ? (
                <>Thank you — it has been filed and we can see it. Nothing else is needed from you.</>
              ) : (
                <>Thank you — we have your report. It could not be posted to the issue tracker just now, so it is being held and will be picked up from there.</>
              )}
            </div>
            {result?.issueUrl && (
              <button
                onClick={() => window.electronAPI.openExternal(result.issueUrl as string)}
                style={{ padding: '7px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12.5 }}
              >View it on GitHub ↗</button>
            )}
            <button
              onClick={onClose}
              style={{ marginTop: 8, padding: '9px 24px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary, #f1f5f9)', cursor: 'pointer', fontSize: 13 }}
            >Close</button>
          </div>
        ) : (
          <>
            {/* Category */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    style={{
                      padding: '9px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      border: category === c.value ? '1px solid #3b82f6' : '1px solid var(--border)',
                      background: category === c.value ? 'rgba(59,130,246,0.12)' : 'transparent',
                      color: 'var(--text-primary, #f1f5f9)', textAlign: 'left',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Title <span style={{ color: '#f87171' }}>*</span>
              </label>
              <input
                className="form-input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Brief summary of the issue…"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Description
              </label>
              <textarea
                className="form-textarea"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What happened? What did you expect?"
              />
            </div>

            {/* Steps */}
            {category === 'bug' && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                  Steps to Reproduce
                </label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={steps}
                  onChange={e => setSteps(e.target.value)}
                  placeholder="1. Open the app&#10;2. Go to…&#10;3. Click…"
                />
              </div>
            )}

            {/* Optional, because a report we cannot reply to is a dead end. */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Your email <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>— optional, only so we can reply</span>
              </label>
              <input
                className="form-input"
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
              This is sent straight from the app — you do not need a GitHub account.
              Version <strong>{version}</strong> and your platform are attached automatically.
            </div>

            {error && (
              <div style={{ fontSize: 12.5, color: 'var(--danger)', background: 'rgba(239,68,68,.10)', border: '1px solid var(--danger)', borderRadius: 8, padding: '9px 14px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                disabled={sending}
                style={{ padding: '9px 20px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: sending ? 'not-allowed' : 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!title.trim() || sending}
                style={{
                  padding: '9px 20px', borderRadius: 6,
                  background: title.trim() && !sending ? '#3b82f6' : '#334155',
                  border: 'none', color: '#fff', fontWeight: 600, fontSize: 13,
                  cursor: title.trim() && !sending ? 'pointer' : 'not-allowed',
                }}
              >
                {sending ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
