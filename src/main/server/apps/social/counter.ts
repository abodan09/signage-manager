// The follower counter, shared by the Instagram and Facebook counter apps.
//
// One board: a heading, a row of flip-card digits behind a brand icon, a
// call to action, the wordmark, and a QR code people can scan to follow. Only
// the palette, the icon and the wordmark differ between the two, so those are
// arguments rather than a second copy of the layout.
//
// Digits are drawn as separate tiles with a seam across the middle, which is
// what makes a number read as a counter rather than as text — and it means a
// changed digit can flip on its own without redrawing the row.

export interface CounterBrand {
  /** CSS background for the whole board. */
  background: string
  /** Colour of the digit tiles and the text on them. */
  tile: string
  tileText: string
  /** Everything outside the counter card. */
  foreground: string
  /** Colour of the icon on the white card. Stated rather than derived from the
   *  tile colour — that inference produced an invisible thumbs-up the moment
   *  the tiles changed shade. */
  badge: string
  /** Inline SVG shown to the left of the digits. */
  icon: string
  /** Small caps label under the icon, or '' for none. */
  iconLabel: string
  /** Inline SVG wordmark along the bottom. */
  wordmark: string
}

export const FB_BLUE = '#3b5998'

export const FB_BRAND: CounterBrand = {
  background: FB_BLUE,
  // Blue tiles on the white card. White-on-white made the tile edges vanish
  // and the number stopped reading as a counter at all.
  tile: FB_BLUE,
  tileText: '#ffffff',
  foreground: '#ffffff',
  badge: FB_BLUE,
  // A thumbs-up, drawn rather than fetched so the board works with no network.
  icon:
    '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">' +
    '<path d="M20 27h6v27h-6a4 4 0 0 1-4-4V31a4 4 0 0 1 4-4z"/>' +
    '<path d="M30 27l9-17a5 5 0 0 1 9 4l-3 13h11a5 5 0 0 1 4.9 6l-3.4 17A6 6 0 0 1 51.6 55H30V27z"/></svg>',
  iconLabel: '',
  wordmark:
    '<svg viewBox="0 0 260 56" fill="currentColor" aria-hidden="true">' +
    '<text x="0" y="43" font-family="Georgia,\'Times New Roman\',serif" font-size="46" font-weight="700" ' +
    'letter-spacing="-2">facebook</text></svg>',
}

export const IG_BRAND: CounterBrand = {
  background: 'linear-gradient(150deg,#8a3ab9 0%,#c13584 32%,#e1306c 60%,#f56040 82%,#fcaf45 100%)',
  tile: '#1a1a1a',
  tileText: '#ffffff',
  foreground: '#ffffff',
  badge: '#1a1a1a',
  icon:
    '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">' +
    '<circle cx="32" cy="22" r="11"/>' +
    '<path d="M12 58c0-11 9-19 20-19s20 8 20 19z"/></svg>',
  iconLabel: 'FOLLOWERS',
  wordmark:
    '<svg viewBox="0 0 300 60" fill="currentColor" aria-hidden="true">' +
    '<text x="0" y="45" font-family="Georgia,\'Times New Roman\',serif" font-size="46" font-style="italic">' +
    'Instagram</text></svg>',
}

export const counterCss = (b: CounterBrand) => `
body{background:${b.background};color:${b.foreground}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;
  display:flex;flex-direction:column;align-items:center;justify-content:center}

.heading{font-size:6vh;font-weight:300;letter-spacing:.06em;text-align:center;
  padding:0 6vw;margin-bottom:4vh;text-transform:uppercase}

.card{display:flex;align-items:center;background:#ffffff;border-radius:1.6vh;
  padding:1.6vh 2vh;box-shadow:0 1.4vh 4vh rgba(0,0,0,.22)}
.card .badge{display:flex;flex-direction:column;align-items:center;justify-content:center;
  margin-right:2vh;color:${b.badge}}
.card .badge svg{width:9vh;height:9vh}
.card .badge span{font-size:1.7vh;letter-spacing:.1em;margin-top:.4vh;font-weight:600}

.digits{display:flex}
.digit{position:relative;background:${b.tile};color:${b.tileText};
  width:8.4vh;height:12vh;margin-left:.7vh;border-radius:.8vh;
  font-size:9.4vh;font-weight:700;line-height:12vh;text-align:center;
  font-family:"Inter",Arial,Helvetica,sans-serif;overflow:hidden}
.digit:first-child{margin-left:0}
/* The seam is what makes a number read as a mechanical counter. */
.digit:after{content:'';position:absolute;left:0;right:0;top:50%;height:.2vh;
  background:rgba(0,0,0,.28)}

.caption{font-size:2.6vh;margin-top:4vh;opacity:.92;text-align:center;padding:0 6vw}
.wordmark{margin-top:5vh;height:6vh}
.wordmark svg{height:100%;width:auto}
.idle .wordmark{margin-top:0;height:8vh}

.qr{position:absolute;right:4vh;bottom:4vh;background:#fff;padding:1vh;border-radius:.6vh;
  width:13vh;height:13vh}
.qr svg{width:100%;height:100%;display:block}
`

/** ES5 runtime. Reads a single number from the manager and draws the board;
 *  with no number it falls back to the wordmark alone, which is a deliberate
 *  idle state rather than an error message on a wall. */
export const COUNTER_JS = `
var root = document.getElementById('root');
var current = null;

function digitsOf(n){
  var s = String(n);
  if (CFG.minDigits && s.length < CFG.minDigits) {
    while (s.length < CFG.minDigits) s = '0' + s;
  }
  return s.split('');
}

function draw(n){
  if (n === null || n === undefined) {
    /* No number yet: the wordmark alone, which reads as branding rather than
       as a broken screen. */
    root.className = 'idle';
    root.innerHTML = '<div class="wordmark">' + WORDMARK + '</div>';
    return;
  }
  root.className = '';
  var html = '';
  if (CFG.heading) html += '<div class="heading">' + esc(CFG.heading) + '</div>';

  html += '<div class="card"><div class="badge">' + ICON +
    (CFG.iconLabel ? '<span>' + esc(CFG.iconLabel) + '</span>' : '') + '</div><div class="digits">';
  var ds = digitsOf(n);
  for (var i = 0; i < ds.length; i++) html += '<div class="digit">' + ds[i] + '</div>';
  html += '</div></div>';

  if (CFG.caption) html += '<div class="caption">' + esc(CFG.caption) + '</div>';
  html += '<div class="wordmark">' + WORDMARK + '</div>';
  if (QR_SVG) html += '<div class="qr">' + QR_SVG + '</div>';
  root.innerHTML = html;
}

function onPayload(res){
  var d = res && res.data;
  var n = d && typeof d.count === 'number' ? d.count : null;
  if (n === current) return;
  current = n;
  draw(n);
}

draw(null);
if (SEED && SEED.data) onPayload(SEED);
pollData(CFG.dataUrl, 600000, onPayload);
`
