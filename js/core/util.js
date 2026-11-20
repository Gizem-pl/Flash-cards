// Shared helpers: HTML handling, hashing, ids, dates.

const ENTITIES = {
  '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&ndash;': '–', '&mdash;': '—', '&hellip;': '…', '&laquo;': '«', '&raquo;': '»', '&copy;': '©',
};

export function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  s = s.replace(/&(nbsp|lt|gt|quot|#39|apos|ndash|mdash|hellip|laquo|raquo|copy);/g, (m) => ENTITIES[m] ?? m);
  s = s.replace(/&#(x?)([0-9a-fA-F]+);/g, (_, hex, n) => {
    const v = parseInt(n, hex ? 16 : 10);
    try { return String.fromCodePoint(v); } catch { return ''; }
  });
  return s.replace(/&amp;/g, '&');
}

export function stripHTML(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, ' ');
  s = s.replace(/<\/?div[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s).trim();
}

/** Strips HTML but keeps image file names (sort field / duplicate check, like Anki). */
export function stripHTMLMedia(html) {
  return stripHTML(String(html || '').replace(/<img[^>]*src=["']?([^"'>]+)["']?[^>]*>/gi, ' $1 '));
}

export function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Anki's definition of an empty field. */
export function fieldIsEmpty(s) {
  return !String(s ?? '').replace(/<br\s*\/?>|<\/?div>|&nbsp;|​/gi, '').trim();
}

/** Media files referenced from field / template HTML. */
export function mediaReferences(html) {
  const out = new Set();
  const res = [
    /<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*"([^"]+)"/gi,
    /<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*'([^']+)'/gi,
    /<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*([^\s"'>]+)/gi,
    /\[sound:([^\]]+)\]/g,
  ];
  for (const re of res) {
    for (const m of String(html || '').matchAll(re)) {
      const name = decodeEntities(m[1]);
      if (!name.includes('://') && !name.startsWith('data:')) out.add(name);
    }
  }
  return [...out];
}

// ---- SHA-1 (synchronous; used for Anki checksums and LaTeX image names) ----
export function sha1Hex(str) {
  const bytes = typeof str === 'string' ? new TextEncoder().encode(str) : str;
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[i + t];
    for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Anki's first-field checksum. */
export function fieldChecksum(s) {
  return parseInt(sha1Hex(stripHTMLMedia(s)).slice(0, 8), 16);
}

const GUID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
export function newGuid() {
  const r = crypto.getRandomValues(new Uint32Array(2));
  let n = BigInt(r[0]) * 4294967296n + BigInt(r[1]);
  let out = '';
  do { out = GUID_CHARS[Number(n % 91n)] + out; n /= 91n; } while (n > 0n);
  return out;
}

// ---- dates ("Anki days" honour the rollover hour, in local time) ----
function localMidnightUTC(unixSecs) {
  const d = new Date(unixSecs * 1000);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dayIndex(unix, crt, rollover) {
  const shift = rollover * 3600;
  return Math.round((localMidnightUTC(unix - shift) - localMidnightUTC(crt - shift)) / 86400000);
}

/** Unix seconds at which the Anki day containing `unix` ends. */
export function nextDayStart(unix, rollover) {
  const d = new Date((unix - rollover * 3600) * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, rollover).getTime() / 1000);
}

/** Unix seconds at the start of day index `day`. */
export function dayStartUnix(day, crt, rollover) {
  const d = new Date((crt - rollover * 3600) * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() + day, rollover).getTime() / 1000);
}

export const nowSecs = () => Math.floor(Date.now() / 1000);

export function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

/** Rust-style round (half away from zero). */
export function round(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }

export function formatInterval(seconds) {
  const s = Math.max(seconds, 0);
  const one = (v) => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
  if (s < 60) return '<1m';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${one(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
  if (s < 86400 * 365) return `${one(s / 86400 / 30)}mo`;
  return `${one(s / 86400 / 365)}y`;
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', heic: 'image/heic',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  flac: 'audio/flac', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', css: 'text/css', js: 'text/javascript',
  json: 'application/json', txt: 'text/plain', html: 'text/html',
};
export function mimeFor(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
