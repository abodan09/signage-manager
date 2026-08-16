import type { QrKind } from './types'

// What a QR code stands for, and how that becomes the string a phone reads.
//
// The encodings are genuinely unobvious — a Wi-Fi code is not a URL, an SMS
// code is not a phone number, and getting the escaping wrong produces a code
// that scans to nonsense rather than one that fails visibly. So the operator
// picks a kind and fills in plain fields, and this turns those into a payload.
//
// Shared by the server (which validates and encodes) and the Designer (which
// previews), so the two can never disagree about what a code will contain.

export interface QrFieldSpec {
  key: string
  label: string
  placeholder?: string
  /** Rendered as a select rather than a text box. */
  options?: Array<{ value: string; label: string }>
  optional?: boolean
}

export interface QrKindSpec {
  kind: QrKind
  label: string
  icon: string
  fields: QrFieldSpec[]
  /** One line telling the operator what the code will do when scanned. */
  hint: string
}

export const QR_KINDS: QrKindSpec[] = [
  {
    kind: 'url', label: 'Website URL', icon: '🔗', hint: 'Opens a web page.',
    fields: [{ key: 'url', label: 'Website URL', placeholder: 'https://www.example.com/' }],
  },
  {
    kind: 'text', label: 'Text', icon: '📝', hint: 'Shows a message on the phone.',
    fields: [{ key: 'text', label: 'Text', placeholder: 'Anything a camera should read' }],
  },
  {
    kind: 'email', label: 'Email', icon: '✉️', hint: 'Starts an email, subject and body prefilled.',
    fields: [
      { key: 'to', label: 'Send to', placeholder: 'hello@example.com' },
      { key: 'subject', label: 'Subject', placeholder: 'Enquiry', optional: true },
      { key: 'body', label: 'Message', placeholder: 'Hello…', optional: true },
    ],
  },
  {
    kind: 'phone', label: 'Call', icon: '📞', hint: 'Dials a number.',
    fields: [{ key: 'phone', label: 'Phone number', placeholder: '+15551234567' }],
  },
  {
    kind: 'sms', label: 'SMS', icon: '💬', hint: 'Opens a text message, ready to send.',
    fields: [
      { key: 'phone', label: 'Phone number', placeholder: '+15551234567' },
      { key: 'message', label: 'Message', placeholder: 'JOIN', optional: true },
    ],
  },
  {
    kind: 'wifi', label: 'Wi-Fi', icon: '📶', hint: 'Joins your network without typing a password.',
    fields: [
      { key: 'ssid', label: 'Network name', placeholder: 'Guest Wi-Fi' },
      { key: 'password', label: 'Password', placeholder: '', optional: true },
      {
        key: 'security', label: 'Security', optional: true,
        options: [
          { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
          { value: 'WEP', label: 'WEP' },
          { value: 'nopass', label: 'Open (no password)' },
        ],
      },
      {
        key: 'hidden', label: 'Hidden network', optional: true,
        options: [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }],
      },
    ],
  },
  {
    kind: 'whatsapp', label: 'WhatsApp', icon: '🟢', hint: 'Opens a WhatsApp chat with you.',
    fields: [
      { key: 'phone', label: 'Phone number', placeholder: '+15551234567' },
      { key: 'message', label: 'Message', placeholder: 'Hi!', optional: true },
    ],
  },
  {
    kind: 'facebook', label: 'Facebook', icon: '📘', hint: 'Opens your Facebook page.',
    fields: [{ key: 'handle', label: 'Page name or full URL', placeholder: 'yourpage' }],
  },
  {
    kind: 'instagram', label: 'Instagram', icon: '📸', hint: 'Opens your Instagram profile.',
    fields: [{ key: 'handle', label: 'Handle or full URL', placeholder: 'yourhandle' }],
  },
  {
    kind: 'x', label: 'X', icon: '✖️', hint: 'Opens your X profile.',
    fields: [{ key: 'handle', label: 'Handle or full URL', placeholder: 'yourhandle' }],
  },
  {
    kind: 'appstore', label: 'App Store', icon: '📱', hint: 'Sends the phone to your app.',
    fields: [{ key: 'url', label: 'App link', placeholder: 'https://apps.apple.com/app/id000000000' }],
  },
]

const BY_KIND = new Map(QR_KINDS.map(k => [k.kind, k]))
export const getQrKind = (kind: string): QrKindSpec | undefined => BY_KIND.get(kind as QrKind)

/** Wi-Fi payloads use ; and : as separators, so those characters inside an
 *  SSID or password have to be escaped or the code silently truncates. */
function wifiEscape(v: string): string {
  return v.replace(/([\\;,:"])/g, '\\$1')
}

const socialUrl = (base: string, raw: string) => {
  const v = raw.trim().replace(/^@/, '')
  if (/^https?:\/\//i.test(v)) return v
  return base + encodeURIComponent(v)
}

/** Turns a kind plus its fields into the string encoded in the symbol. */
export function buildQrData(kind: string, fields: Record<string, string>): string {
  const f = (k: string) => String(fields?.[k] ?? '').trim()

  switch (kind) {
    case 'text':
      return f('text')

    case 'email': {
      const to = f('to')
      const params: string[] = []
      if (f('subject')) params.push('subject=' + encodeURIComponent(f('subject')))
      if (f('body')) params.push('body=' + encodeURIComponent(f('body')))
      return `mailto:${to}${params.length ? '?' + params.join('&') : ''}`
    }

    case 'phone':
      return 'tel:' + f('phone').replace(/[^\d+]/g, '')

    case 'sms': {
      const num = f('phone').replace(/[^\d+]/g, '')
      const msg = f('message')
      return `sms:${num}${msg ? '?body=' + encodeURIComponent(msg) : ''}`
    }

    case 'wifi': {
      const security = f('security') || 'WPA'
      const parts = [`T:${security === 'nopass' ? 'nopass' : security}`, `S:${wifiEscape(f('ssid'))}`]
      if (security !== 'nopass' && f('password')) parts.push(`P:${wifiEscape(f('password'))}`)
      if (f('hidden') === 'true') parts.push('H:true')
      return `WIFI:${parts.join(';')};;`
    }

    case 'whatsapp': {
      const num = f('phone').replace(/[^\d]/g, '')
      const msg = f('message')
      return `https://wa.me/${num}${msg ? '?text=' + encodeURIComponent(msg) : ''}`
    }

    case 'facebook':  return socialUrl('https://facebook.com/', f('handle'))
    case 'instagram': return socialUrl('https://instagram.com/', f('handle'))
    case 'x':         return socialUrl('https://x.com/', f('handle'))

    case 'appstore':
    case 'url':
    default: {
      const v = f('url') || f('text')
      if (!v) return ''
      // A bare domain is what people paste; without a scheme a camera treats
      // it as plain text and offers no link at all.
      return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v
    }
  }
}

/** Human-readable check before a code goes on a wall — an unscannable code is
 *  worse than none, because nobody reports it. */
export function validateQr(kind: string, fields: Record<string, string>): string | null {
  const f = (k: string) => String(fields?.[k] ?? '').trim()
  switch (kind) {
    case 'url':
    case 'appstore':
      if (!f('url')) return 'Enter the web address the code should open.'
      return null
    case 'text':
      if (!f('text')) return 'Enter the text the code should show.'
      return null
    case 'email':
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f('to'))) return 'Enter a valid email address.'
      return null
    case 'phone':
    case 'sms':
    case 'whatsapp':
      if (f('phone').replace(/[^\d]/g, '').length < 6) return 'Enter a phone number, including the country code.'
      return null
    case 'wifi':
      if (!f('ssid')) return 'Enter the network name.'
      if (f('security') !== 'nopass' && !f('password')) return 'Enter the Wi-Fi password, or choose Open.'
      return null
    case 'facebook':
    case 'instagram':
    case 'x':
      if (!f('handle')) return 'Enter the handle or the full link.'
      return null
    default:
      return null
  }
}
