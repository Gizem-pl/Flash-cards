// Renders Anki card HTML inside a sandboxed iframe (deck JavaScript can't reach your data),
// with media inlined as data URLs, and handles audio / text-to-speech in the parent page.
import { decodeEntities } from '../core/util.js';

const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; padding: 22px 18px 48px; min-height: 100vh; box-sizing: border-box; overflow-wrap: anywhere; -webkit-tap-highlight-color: transparent; }
html body.nightMode.card { background-color: #1c1c1e; color: #f2f2f7; }
body.nightMode a { color: #8ab4ff; }
img { max-width: 100%; height: auto; }
hr#answer { border: none; height: 1px; background: rgba(128,128,128,.35); margin: 20px 0; }
.replay-button { display: inline-block; vertical-align: middle; margin: 4px; text-decoration: none; }
.replay-button svg { width: 40px; height: 40px; }
.replay-button svg circle { fill: rgba(110,92,250,.14); }
.replay-button svg path { fill: #6e5cfa; }
#typeans { width: 100%; max-width: 520px; box-sizing: border-box; font-size: 18px; padding: 12px 14px; border-radius: 12px; border: 1.5px solid rgba(128,128,128,.4); background: transparent; color: inherit; font-family: inherit; }
code#typeans { display: inline-block; border: none; text-align: left; font-family: ui-monospace, Menlo, monospace; white-space: pre-wrap; }
.typeGood { background: rgba(52,199,89,.3); border-radius: 3px; } .typeBad { background: rgba(255,59,48,.3); border-radius: 3px; } .typeMissed { background: rgba(142,142,147,.3); border-radius: 3px; }
.cloze { font-weight: bold; color: blue; } .nightMode .cloze { color: lightblue; }
a.hint { color: #6e5cfa; }
#qa { transition: opacity .16s ease; }
.template-error { color: #ff3b30; font-size: 14px; }
</style><style id="cardcss"></style></head>
<body class="card"><div id="qa"></div>
<script>
var mj = null;
function loadMathJax() {
  if (window.MathJax && MathJax.typesetPromise) return Promise.resolve();
  if (mj) return mj;
  window.MathJax = { tex: { inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] }, startup: { typeset: false } };
  mj = new Promise(function (res) { var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js';
    s.onload = function () { MathJax.startup.promise.then(res); }; s.onerror = res; document.head.appendChild(s); });
  return mj;
}
function send(m) { parent.postMessage(m, '*'); }
window.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'show') {
    document.getElementById('cardcss').textContent = d.css;
    document.body.className = d.cls;
    var qa = document.getElementById('qa');
    qa.style.opacity = 0;
    qa.innerHTML = d.html;
    qa.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      s.textContent = old.textContent; old.parentNode.replaceChild(s, old);
    });
    if (/\\\\\\(|\\\\\\[/.test(d.html)) loadMathJax().then(function () { if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([qa]); });
    requestAnimationFrame(function () { qa.style.opacity = 1; });
    var ans = document.getElementById('answer');
    if (ans && ans.getBoundingClientRect().top > innerHeight * 0.6) scrollTo({ top: ans.offsetTop - 40, behavior: 'smooth' });
    else if (!ans) scrollTo(0, 0);
    var t = document.getElementById('typeans');
    if (t && t.tagName === 'INPUT') { t.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); send({ type: 'ans' }); } }); if (d.focus) setTimeout(function () { t.focus(); }, 60); }
  } else if (d.type === 'getTyped') {
    var el = document.getElementById('typeans');
    send({ type: 'typed', id: d.id, value: el && el.value !== undefined ? el.value : '' });
  }
});
document.addEventListener('click', function (e) {
  var play = e.target.closest('[data-play]');
  if (play) { e.preventDefault(); var p = play.getAttribute('data-play').split(':'); send({ type: 'play', side: p[0], idx: +p[1] }); return; }
  if (e.target.closest('a, button, input, textarea, select, summary, details, audio, video, label, [onclick]')) return;
  send({ type: 'tap' });
});
document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  send({ type: 'key', key: e.key, ctrl: e.ctrlKey || e.metaKey });
});
function pycmd(c) { send({ type: 'pycmd', cmd: c }); }
send({ type: 'ready' });
<\/script></body></html>`;

// data-URL cache for media (shared by all frames)
const cache = new Map();
let cacheSize = 0;
const CACHE_LIMIT = 60 * 1024 * 1024;

async function dataURL(col, name) {
  if (cache.has(name)) { const v = cache.get(name); cache.delete(name); cache.set(name, v); return v; }
  const blob = await col.mediaBlob(name);
  if (!blob) return null;
  const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
  if (!url) return null;
  cache.set(name, url);
  cacheSize += url.length;
  while (cacheSize > CACHE_LIMIT && cache.size > 1) { const [k, v] = cache.entries().next().value; cache.delete(k); cacheSize -= v.length; }
  return url;
}

const SRC_RE = /(<(?:img|source|audio|video|script|input|embed|track)\b[^>]*?\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const URL_RE = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi;

function lookupName(raw, col) {
  const candidates = [raw, decodeEntities(raw)];
  try { candidates.push(decodeURIComponent(decodeEntities(raw))); } catch { /* ignore */ }
  return candidates.find((c) => col.mediaNames.has(c)) || null;
}

/** Replaces references to collection media with data URLs. */
export async function inlineMedia(col, html, css) {
  const names = new Set();
  for (const m of html.matchAll(SRC_RE)) { const n = lookupName(m[2] ?? m[3] ?? m[4], col); if (n) names.add(n); }
  for (const m of (html + css).matchAll(URL_RE)) { const n = lookupName(m[2], col); if (n) names.add(n); }
  const urls = new Map();
  await Promise.all([...names].map(async (n) => { const u = await dataURL(col, n); if (u) urls.set(n, u); }));
  const rep = (raw) => { const n = lookupName(raw, col); return n && urls.get(n); };
  const fixHTML = html.replace(SRC_RE, (m, pre, a, b, c) => { const u = rep(a ?? b ?? c); return u ? `${pre}"${u}"` : m; })
    .replace(URL_RE, (m, q, name) => { const u = rep(name); return u ? `url("${u}")` : m; });
  const fixCSS = css.replace(URL_RE, (m, q, name) => { const u = rep(name); return u ? `url("${u}")` : m; });
  return [fixHTML, fixCSS];
}

export class CardFrame {
  /** handlers: { onTap, onPlay(side, idx), onAnswerKey, onKey(key, ctrl) } */
  constructor(col, handlers = {}) {
    this.col = col;
    this.handlers = handlers;
    this.ready = false;
    this.queued = null;
    this.waiters = new Map();
    this.seq = 0;
    this.el = document.createElement('iframe');
    this.el.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    this.el.setAttribute('title', 'Card');
    this.el.srcdoc = SHELL;
    this.onMessage = (e) => {
      if (e.source !== this.el.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'ready') { this.ready = true; if (this.queued) { this.post(this.queued); this.queued = null; } }
      else if (d.type === 'tap') this.handlers.onTap?.();
      else if (d.type === 'ans') this.handlers.onAnswerKey?.();
      else if (d.type === 'play') this.handlers.onPlay?.(d.side, d.idx);
      else if (d.type === 'key') this.handlers.onKey?.(d.key, d.ctrl);
      else if (d.type === 'typed') { this.waiters.get(d.id)?.(d.value); this.waiters.delete(d.id); }
    };
    window.addEventListener('message', this.onMessage);
  }
  post(msg) { this.el.contentWindow?.postMessage(msg, '*'); }
  async show(html, css, cls, focus = true) {
    const token = ++this.seq;
    const [h2, c2] = await inlineMedia(this.col, html, css);
    if (token !== this.seq) return; // a newer card was requested meanwhile
    const msg = { type: 'show', html: h2, css: c2, cls, focus };
    if (this.ready) this.post(msg); else this.queued = msg;
  }
  typedAnswer() {
    if (!this.ready) return Promise.resolve('');
    return new Promise((resolve) => {
      const id = ++this.seq;
      this.waiters.set(id, resolve);
      this.post({ type: 'getTyped', id });
      setTimeout(() => { if (this.waiters.has(id)) { this.waiters.delete(id); resolve(''); } }, 800);
    });
  }
  destroy() { window.removeEventListener('message', this.onMessage); this.el.remove(); }
}

// ---------------------------------------------------------------- audio

/** Plays [sound:] files and TTS tags in sequence. One shared <audio> element is "unlocked" by the first tap (iOS). */
class AudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = [];
    this.url = null;
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => this.next());
    const unlock = () => {
      this.audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      this.audio.play().catch(() => {});
      if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
      window.removeEventListener('touchend', unlock, true);
      window.removeEventListener('click', unlock, true);
    };
    window.addEventListener('touchend', unlock, true);
    window.addEventListener('click', unlock, true);
  }
  play(col, tags) {
    this.stop();
    this.col = col;
    this.queue = [...tags];
    this.next();
  }
  stop() {
    this.queue = [];
    this.audio.pause();
    if (window.speechSynthesis) speechSynthesis.cancel();
  }
  async next() {
    const tag = this.queue.shift();
    if (!tag) return;
    if (tag.sound) {
      const blob = await this.col.mediaBlob(tag.sound);
      if (!blob) return this.next();
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(blob);
      this.audio.src = this.url;
      this.audio.play().catch(() => this.next());
    } else if (tag.tts !== undefined && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(tag.tts);
      u.lang = tag.lang.replace('_', '-');
      u.rate = Math.min(Math.max(tag.speed || 1, 0.5), 2);
      const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase() === u.lang.toLowerCase());
      if (voice) u.voice = voice;
      u.onend = () => this.next();
      u.onerror = () => this.next();
      speechSynthesis.speak(u);
    } else this.next();
  }
}
export const audio = new AudioPlayer();
