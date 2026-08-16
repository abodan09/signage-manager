import type { AppContext, AppDefinition, AppField } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'
import { buildQrSvg } from '../../scenes'
import { QR_KINDS, buildQrData, validateQr } from '../../qr-kinds'
import { FB_GLYPH, IG_GLYPH } from '../social/wall'

// QR Code board.
//
// A full-screen code with a headline, a call to action and a row of contact
// details — the thing you put in a lobby or beside a till so people can reach
// you without typing anything.
//
// The encoder is the Designer's, not a second copy: the same kind-plus-fields
// model, the same payload builder, the same validation. A Wi-Fi code composed
// here and one composed in the Designer are byte-identical, which is the only
// acceptable outcome when both claim to produce "a QR code".
//
// For a code inside a designed poster — the first of the reference examples —
// the Designer is the right tool and already does it. This app is for when the
// code IS the screen.

/** The kind-specific inputs, declared once and shown by the chosen kind.
 *  Keys are shared where the meaning is shared: one "phone" serves the call,
 *  SMS and WhatsApp kinds rather than three near-identical fields. */
const KIND_FIELDS: AppField[] = [
  {
    // Plain text, not the url type: the shared encoder adds a missing scheme,
    // and the Designer's builder accepts a bare domain. Using the stricter
    // field here would reject "example.com" in the app while accepting it in
    // the Designer — the exact inconsistency this app exists to avoid.
    key: 'url', label: 'Web address', type: 'text', required: true, maxLength: 400,
    placeholder: 'https://www.example.com/',
    showIf: { key: 'qrKind', equals: ['url', 'appstore'] },
  },
  {
    key: 'text', label: 'Text', type: 'textarea', required: true, maxLength: 600,
    placeholder: 'Anything a camera should read',
    showIf: { key: 'qrKind', equals: ['text'] },
  },
  {
    key: 'to', label: 'Send to', type: 'text', required: true, maxLength: 120,
    placeholder: 'hello@example.com',
    showIf: { key: 'qrKind', equals: ['email'] },
  },
  {
    key: 'subject', label: 'Subject', type: 'text', maxLength: 120,
    showIf: { key: 'qrKind', equals: ['email'] },
  },
  {
    key: 'body', label: 'Message', type: 'textarea', maxLength: 400,
    showIf: { key: 'qrKind', equals: ['email'] },
  },
  {
    key: 'phone', label: 'Phone number', type: 'text', required: true, maxLength: 40,
    placeholder: '+15551234567',
    help: 'Include the country code, or phones outside your country cannot dial it.',
    showIf: { key: 'qrKind', equals: ['phone', 'sms', 'whatsapp'] },
  },
  {
    key: 'message', label: 'Prefilled message', type: 'text', maxLength: 200,
    showIf: { key: 'qrKind', equals: ['sms', 'whatsapp'] },
  },
  {
    key: 'ssid', label: 'Network name', type: 'text', required: true, maxLength: 64,
    placeholder: 'Guest Wi-Fi',
    showIf: { key: 'qrKind', equals: ['wifi'] },
  },
  {
    key: 'password', label: 'Wi-Fi password', type: 'text', maxLength: 128,
    help: 'Anyone who can see the screen can join the network. Use a guest network.',
    showIf: { key: 'qrKind', equals: ['wifi'] },
  },
  {
    key: 'security', label: 'Security', type: 'select', default: 'WPA',
    options: [
      { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
      { value: 'WEP', label: 'WEP' },
      { value: 'nopass', label: 'Open (no password)' },
    ],
    showIf: { key: 'qrKind', equals: ['wifi'] },
  },
  {
    key: 'handle', label: 'Handle or full link', type: 'text', required: true, maxLength: 120,
    placeholder: 'nasa',
    showIf: { key: 'qrKind', equals: ['facebook', 'instagram', 'x'] },
  },
]

/** Everything the QR builder needs, pulled out of the flat config. */
function fieldsFor(config: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['url', 'text', 'to', 'subject', 'body', 'phone', 'message', 'ssid', 'password', 'security', 'handle']) {
    out[key] = String(config[key] ?? '')
  }
  return out
}

const STYLES: Record<string, { bg: string; fg: string; glyph: string }> = {
  facebook: { bg: 'linear-gradient(170deg,#4a6ea9,#3b5998)', fg: '#ffffff', glyph: FB_GLYPH },
  instagram: {
    bg: 'linear-gradient(140deg,#f0a03a 0%,#e1306c 40%,#c13584 68%,#7b4bc4 100%)',
    fg: '#ffffff', glyph: IG_GLYPH,
  },
  dark: { bg: 'linear-gradient(160deg,#1f2937,#0f172a)', fg: '#ffffff', glyph: '' },
  light: { bg: 'linear-gradient(160deg,#ffffff,#e8eaed)', fg: '#1f2937', glyph: '' },
}

export const qrcode: AppDefinition = {
  id: 'qrcode',
  name: 'QR Code',
  icon: '🔳',
  description: 'A full-screen QR code with a headline and your contact details.',
  category: 'utility',
  defaultDuration: 20,

  fields: [
    {
      key: 'qrKind', label: 'What the code does', type: 'select', required: true, default: 'url',
      options: QR_KINDS.map(k => ({ value: k.kind, label: `${k.icon}  ${k.label}`, hint: k.hint })),
    },
    ...KIND_FIELDS,

    {
      key: 'style', label: 'Style', type: 'select', required: true, default: 'dark',
      options: [
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
        { value: 'facebook', label: 'Facebook', hint: 'Facebook blue, with the logo' },
        { value: 'instagram', label: 'Instagram', hint: 'Instagram gradient, with the logo' },
        { value: 'custom', label: 'Custom colours' },
      ],
    },
    {
      key: 'backgroundColor', label: 'Background Colour', type: 'color', default: '#0f172a',
      showIf: { key: 'style', equals: ['custom'] },
    },
    {
      key: 'textColor', label: 'Text Colour', type: 'color', default: '#ffffff',
      showIf: { key: 'style', equals: ['custom'] },
    },
    {
      key: 'caption', label: 'Small line', type: 'text', maxLength: 90,
      placeholder: 'Follow us for latest news',
    },
    {
      key: 'headline', label: 'Big line', type: 'text', maxLength: 70,
      placeholder: 'instagram.com/nasa',
      help: 'Leave empty and the app writes a sensible one from the code itself.',
    },

    // ── Advanced ──
    {
      key: 'contactWebsite', label: 'Footer: website', type: 'text', maxLength: 120, advanced: true,
      placeholder: 'https://www.nasa.gov/',
    },
    {
      key: 'contactEmail', label: 'Footer: email', type: 'text', maxLength: 120, advanced: true,
      placeholder: 'space@nasa.gov',
    },
    {
      key: 'contactPhone', label: 'Footer: phone', type: 'text', maxLength: 60, advanced: true,
      placeholder: '1-800-111-1111',
    },
    {
      key: 'qrSize', label: 'Code size', type: 'select', default: 'medium', advanced: true,
      options: [
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ],
      help: 'Bigger is scannable from further away. A code should be at least 300px on a 1080p screen.',
    },
    {
      key: 'showLogo', label: 'Show the network logo', type: 'checkbox', default: true, advanced: true,
      showIf: { key: 'style', equals: ['facebook', 'instagram'] },
    },
  ],

  validate(config) {
    const kind = String(config.qrKind ?? 'url')
    const problem = validateQr(kind, fieldsFor(config))
    if (problem) return problem
    if (!buildQrData(kind, fieldsFor(config))) return 'That code would be empty. Fill in the field above.'
    return null
  },

  // Nothing to fetch: a QR code is made from what the operator typed, so this
  // app works with no network at all, forever.

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const kind = String(c.qrKind ?? 'url')
    const data = buildQrData(kind, fieldsFor(c))

    const styleName = String(c.style ?? 'dark')
    const preset = STYLES[styleName]
    const bg = preset ? preset.bg : (/^#[0-9a-fA-F]{6}$/.test(String(c.backgroundColor)) ? String(c.backgroundColor) : '#0f172a')
    const fg = preset ? preset.fg : (/^#[0-9a-fA-F]{6}$/.test(String(c.textColor)) ? String(c.textColor) : '#ffffff')
    const glyph = preset && c.showLogo !== false ? preset.glyph : ''

    // A headline nobody typed is better written from the code than left blank:
    // a bare QR with no words gets scanned far less often.
    const auto = (() => {
      if (String(c.headline ?? '').trim()) return String(c.headline).trim()
      if (kind === 'wifi') return String(c.ssid ?? '')
      if (kind === 'phone' || kind === 'sms' || kind === 'whatsapp') return String(c.phone ?? '')
      if (kind === 'email') return String(c.to ?? '')
      if (kind === 'facebook') return `facebook.com/${String(c.handle ?? '').replace(/^@/, '')}`
      if (kind === 'instagram') return `instagram.com/${String(c.handle ?? '').replace(/^@/, '')}`
      if (kind === 'x') return `x.com/${String(c.handle ?? '').replace(/^@/, '')}`
      return data.replace(/^https?:\/\//, '').replace(/\/$/, '')
    })()

    const sizes: Record<string, string> = { small: '28vh', medium: '38vh', large: '50vh' }

    const cfg = {
      caption: String(c.caption ?? '').trim(),
      headline: auto,
      website: String(c.contactWebsite ?? '').trim(),
      email: String(c.contactEmail ?? '').trim(),
      phone: String(c.contactPhone ?? '').trim(),
    }

    return appPage({
      title: `QR Code — ${escapeHtml(ctx.instance.name)}`,
      bg: preset ? (styleName === 'light' ? '#ffffff' : '#0f172a') : bg,
      fontCss: ctx.fontCss,
      css: `
body{background:${bg};color:${fg}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;
  display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5vh 6vw}
.logo{width:8vh;height:8vh;margin-bottom:2.4vh;flex-shrink:0}
.logo svg{width:100%;height:100%;display:block}
.caption{font-size:2.4vh;opacity:.9;margin-bottom:1.4vh;text-align:center}
.headline{font-size:5vh;font-weight:600;margin-bottom:3vh;text-align:center;
  word-break:break-word;line-height:1.15}
.code{background:#ffffff;padding:1.6vh;border-radius:1vh;width:${sizes[String(c.qrSize ?? 'medium')] ?? '38vh'};
  height:${sizes[String(c.qrSize ?? 'medium')] ?? '38vh'};flex-shrink:0}
.code svg{width:100%;height:100%;display:block}
.contacts{display:flex;justify-content:center;margin-top:4vh;flex-wrap:wrap}
.chip{display:flex;align-items:center;margin:0 1.6vh;font-size:2vh;opacity:.95}
.chip .ico{width:3.4vh;height:3.4vh;border-radius:50%;background:rgba(255,255,255,.22);
  display:flex;align-items:center;justify-content:center;margin-right:.9vh;flex-shrink:0}
.chip .ico svg{width:1.9vh;height:1.9vh;display:block}
`,
      body: '<div id="root"></div>',
      script:
        `var CFG = ${jsonLiteral(cfg)};\n` +
        `var QR_SVG = ${jsonLiteral(buildQrSvg(data, '#111111', '#ffffff'))};\n` +
        `var LOGO = ${jsonLiteral(glyph)};\n` +
        QRCODE_JS,
    })
  },
}

const QRCODE_JS = `
var root = document.getElementById('root');

var LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
  '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/>' +
  '<path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
var MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">' +
  '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 6.5l9 6 9-6"/></svg>';
var PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">' +
  '<path d="M6 3h4l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3z"/></svg>';

function chip(icon, label){
  return '<div class="chip"><div class="ico">' + icon + '</div>' + esc(label) + '</div>';
}

var html = '';
if (LOGO) html += '<div class="logo">' + LOGO + '</div>';
if (CFG.caption) html += '<div class="caption">' + esc(CFG.caption) + '</div>';
if (CFG.headline) html += '<div class="headline">' + esc(CFG.headline) + '</div>';
html += '<div class="code">' + QR_SVG + '</div>';

var chips = '';
if (CFG.website) chips += chip(LINK, CFG.website);
if (CFG.email) chips += chip(MAIL, CFG.email);
if (CFG.phone) chips += chip(PHONE, CFG.phone);
if (chips) html += '<div class="contacts">' + chips + '</div>';

root.innerHTML = html;
`
