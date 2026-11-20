// Statistics screen with inline SVG charts.
import { h, clear, icon } from './dom.js';
import { app } from './app.js';
import { collectionStats } from '../core/stats.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

export function statsView(root) {
  const col = app.col;
  let deckId = Number(sessionStorage.getItem('statsDeck')) || null;
  if (deckId && !col.deck(deckId)) deckId = null;
  const body = h('div');
  const select = h('select', { style: { maxWidth: '55%' }, onchange: (e) => { deckId = Number(e.target.value) || null; sessionStorage.setItem('statsDeck', deckId || ''); draw(); } },
    h('option', { value: '' }, 'All decks'), col.allDecks().map((d) => h('option', { value: d.id, selected: d.id === deckId }, d.name)));
  root.append(h('div.topbar', h('span'), select), h('h1.large', 'Statistics'), body);

  function draw() {
    const st = collectionStats(col, deckId);
    const metric = (ic, v, k) => h('div', icon(ic, 'sm'), h('div.v', v), h('div.k', k));
    const time = st.today.time < 60 ? `${st.today.time}s` : `${Math.round(st.today.time / 60)}m`;
    clear(body,
      h('div.card.pad', h('div.chart-title', h('h3', 'Today')),
        h('div.metrics', metric('layers', String(st.today.reviews), 'Reviews'), metric('clock', time, 'Time'),
          metric('target', st.today.correct === null ? '—' : `${Math.round(st.today.correct)}%`, 'Correct'), metric('flame', String(st.streak), 'Day streak')),
        st.retention !== null ? h('div.row', { style: { padding: '14px 0 0' } }, h('div.grow.small.muted', 'Retention (last 30 days)'), h('b', `${st.retention.toFixed(1)}%`)) : null),
      section('Upcoming reviews', `${st.forecast.reduce((a, b) => a + b, 0)} in 30 days`, bars(st.forecast)),
      section('Activity', `${st.totalReviews.toLocaleString()} reviews total`, heatmap(st.history)),
      section('Card counts', `${st.total.toLocaleString()} cards`, donut(st.counts)),
      section('Answer buttons', 'last 30 days', buttons(st.buttons)));
  }
  draw();
}

function section(title, sub, content) {
  return h('div.card.pad', { style: { marginTop: '14px' } }, h('div.chart-title', h('h3', title), h('span.small.muted', sub)), h('div.chart', content));
}

function bars(values) {
  const W = 340, H = 150, max = Math.max(1, ...values);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 18}` });
  const defs = s('defs');
  const g = s('linearGradient', { id: 'barg', x1: 0, y1: 0, x2: 0, y2: 1 });
  g.append(s('stop', { offset: '0', 'stop-color': '#5ccbfa' }), s('stop', { offset: '1', 'stop-color': '#2e9cf2' }));
  defs.append(g);
  svg.append(defs);
  const bw = W / values.length;
  for (const frac of [0.5, 1]) svg.append(s('line', { x1: 0, x2: W, y1: H - H * frac, y2: H - H * frac, stroke: 'currentColor', 'stroke-opacity': 0.08 }));
  values.forEach((v, i) => {
    const bh = v ? Math.max(2, (v / max) * (H - 6)) : 0;
    const r = s('rect', { x: i * bw + 1.5, y: H - bh, width: bw - 3, height: bh, rx: 3, fill: 'url(#barg)' });
    r.append(s('title')); r.firstChild.textContent = `${i === 0 ? 'Today' : `+${i}d`}: ${v}`;
    svg.append(r);
  });
  for (const i of [0, 7, 14, 21, 28]) {
    if (i >= values.length) continue;
    const t = s('text', { x: i * bw + bw / 2, y: H + 15, 'text-anchor': i === 0 ? 'start' : 'middle', 'font-size': 11, fill: 'currentColor', opacity: 0.55 });
    t.textContent = i === 0 ? 'Today' : `+${i}d`;
    svg.append(t);
  }
  const lbl = s('text', { x: W, y: 10, 'text-anchor': 'end', 'font-size': 11, fill: 'currentColor', opacity: 0.55 });
  lbl.textContent = String(max);
  svg.append(lbl);
  return svg;
}

function heatmap(days) {
  const max = Math.max(1, ...days);
  const wrap = h('div.heat');
  // columns are weeks; last column ends today
  const cols = [];
  for (let end = days.length; end > 0; end -= 7) cols.unshift(days.slice(Math.max(0, end - 7), end));
  for (const week of cols.reverse()) {
    wrap.append(h('div', week.map((v) => h('i', { title: `${v} reviews`, style: v ? { background: `color-mix(in srgb, var(--accent) ${25 + Math.round(75 * v / max)}%, transparent)` } : {} }))));
  }
  return wrap;
}

function donut(counts) {
  const items = [['New', counts.new, 'var(--new)'], ['Learning', counts.learning, 'var(--learn)'], ['Young', counts.young, '#7fd9ab'],
    ['Mature', counts.mature, 'var(--review)'], ['Suspended', counts.suspended, '#f5c518'], ['Buried', counts.buried, '#9a9aa2']].filter((x) => x[1] > 0);
  const total = items.reduce((a, x) => a + x[1], 0);
  if (!total) return h('p.muted', 'No cards yet');
  const R = 52, C = 2 * Math.PI * R;
  const svg = s('svg', { viewBox: '0 0 130 130', style: 'width:130px;height:130px;flex:none;transform:rotate(-90deg)' });
  let offset = 0;
  for (const [, v, color] of items) {
    const len = (v / total) * C;
    svg.append(s('circle', { cx: 65, cy: 65, r: R, fill: 'none', stroke: color, 'stroke-width': 18, 'stroke-dasharray': `${Math.max(len - 1.5, 0.5)} ${C}`, 'stroke-dashoffset': -offset }));
    offset += len;
  }
  return h('div.donut-wrap', svg, h('div.legend', items.map(([k, v, c]) => h('div', h('i', { style: { background: c } }), k, h('b', v.toLocaleString())))));
}

function buttons(b) {
  const total = Math.max(1, b[1] + b[2] + b[3] + b[4]);
  return h('div', [[1, 'Again', 'again'], [2, 'Hard', 'hard'], [3, 'Good', 'good'], [4, 'Easy', 'easy']].map(([k, label, c]) => h('div.hbar',
    h('span', { style: { width: '50px' } }, label),
    h('div.track', { style: { background: `color-mix(in srgb, var(--${c}) 15%, transparent)` } }, h('div', { style: { width: `${(b[k] / total) * 100}%`, background: `var(--${c})` } })),
    h('span.n', `${b[k]}`))));
}
