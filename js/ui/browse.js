// Card browser with Anki search syntax.
import { h, clear, icon, actionSheet, confirmDialog, toast, sheet } from './dom.js';
import { app } from './app.js';
import { findCards, SORTS } from '../core/search.js';
import { formatInterval } from '../core/util.js';
import { RATING_NAMES } from '../core/scheduler.js';
import { openEditor } from './editor.js';
import { FLAG_COLORS } from './study.js';

const FILTERS = [
  ['All', ''], ['Due', 'is:due'], ['New', 'is:new'], ['Learning', 'is:learn'], ['Review', 'is:review'],
  ['Suspended', 'is:suspended'], ['Flagged', '-flag:0'], ['Leeches', 'tag:leech'], ['Added today', 'added:1'], ['Studied today', 'rated:1'],
];
const state = { query: '', filter: '', sort: 'created', asc: false, limit: 200 };

export function browseView(root) {
  const col = app.col;
  const preset = sessionStorage.getItem('browseQuery');
  if (preset !== null) { state.query = preset; state.filter = ''; sessionStorage.removeItem('browseQuery'); }

  const listEl = h('div');
  const countEl = h('h2.section');
  const input = h('input', { type: 'search', placeholder: 'Search  (e.g. dog  deck:Spanish  tag:verb)', value: state.query, autocapitalize: 'off', autocorrect: 'off',
    oninput: (e) => { state.query = e.target.value; state.limit = 200; clearTimeout(timer); timer = setTimeout(refresh, 180); } });
  let timer;
  const chips = h('div.chipbar', FILTERS.map(([label, q]) => h(`button.chip${state.filter === q ? '.on' : ''}`, {
    onclick: (e) => { state.filter = q; state.limit = 200; chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); e.currentTarget.classList.add('on'); refresh(); },
  }, label)));

  root.append(h('div.topbar', h('span'), h('button.icon-btn', { 'aria-label': 'Sort', onclick: sortMenu }, icon('sort', 'sm'))),
    h('h1.large', 'Browse'), h('div.search', icon('search', 'sm'), input), chips, countEl, listEl);

  async function sortMenu() {
    const v = await actionSheet('Sort by', [...Object.entries(SORTS).map(([k, s]) => ({ label: `${s.title}${state.sort === k ? '  ✓' : ''}`, value: k })),
      { label: state.asc ? 'Descending order' : 'Ascending order', value: '__dir' }]);
    if (!v) return;
    if (v === '__dir') state.asc = !state.asc; else state.sort = v;
    refresh();
  }

  function refresh() {
    const q = [state.filter, state.query].filter(Boolean).join(' ');
    let cards;
    try { cards = findCards(col, q, state.sort, state.asc); } catch { cards = []; }
    countEl.textContent = `${cards.length.toLocaleString()} card${cards.length === 1 ? '' : 's'}`;
    if (!cards.length) {
      clear(listEl, h('div.card', h('div.empty', h('div.art', icon('search')), h('h3', 'No cards'), h('p', state.query ? 'Try a different search.' : 'Import a deck or add notes to see them here.'))));
      return;
    }
    const today = col.today;
    const decks = new Map([...col.decks.values()].map((d) => [d.id, d.name]));
    const list = h('div.list', cards.slice(0, state.limit).map((c) => {
      const n = col.note(c.nid);
      const color = c.type === 0 ? 'var(--new)' : c.type === 2 ? 'var(--review)' : 'var(--learn)';
      return h(`div.row.b-row.tap${c.queue === -1 ? '.susp' : ''}`, { onclick: () => edit(c) },
        h('span.dot', { style: { background: color } }),
        h('div.grow', h('div.t', displayText(n?.sfld) || '(empty)'), h('div.sub', `${decks.get(c.did) || ''} · ${dueText(c, today)}`)),
        (c.flags & 7) ? h('span', { style: { color: FLAG_COLORS[c.flags & 7] } }, icon('flag', 'xs')) : null,
        c.queue === -1 ? h('span', { style: { color: 'var(--hard)' } }, icon('pause', 'xs')) : null,
        h('button.more-btn', { 'aria-label': 'Card actions', onclick: (e) => { e.stopPropagation(); actions(c); } }, icon('more', 'sm')));
    }));
    clear(listEl, list, cards.length > state.limit ? h('button.btn.block', { style: { marginTop: '12px' }, onclick: () => { state.limit += 300; refresh(); } }, `Show more (${cards.length - state.limit} left)`) : null);
  }

  function edit(c) { const n = col.note(c.nid); if (n) openEditor({ note: n, onSaved: refresh }); }

  async function actions(c) {
    const run = (fn, msg) => () => { fn(); toast(msg); refresh(); };
    await actionSheet(null, [
      { label: 'Edit note', icon: 'edit', run: () => edit(c) },
      { label: 'Card info', icon: 'info', run: () => cardInfo(c.id) },
      { label: (c.flags & 7) === 1 ? 'Remove flag' : 'Flag red', icon: 'flag', run: run(() => col.setFlag((c.flags & 7) === 1 ? 0 : 1, [c.id]), 'Flag updated') },
      { label: c.queue === -1 ? 'Unsuspend' : 'Suspend', icon: 'pause', run: run(() => col.setSuspended(c.queue !== -1, [c.id]), c.queue === -1 ? 'Unsuspended' : 'Suspended') },
      { label: 'Make due today', icon: 'calendar', run: run(() => col.setDueDate([c.id], 0), 'Due today') },
      { label: 'Reset to new', icon: 'reset', run: run(() => col.resetToNew([c.id]), 'Reset to new') },
      { label: 'Move to deck…', icon: 'folderplus', run: async () => {
        const d = await actionSheet('Move to', col.allDecks().map((x) => ({ label: x.name, value: String(x.id) })));
        if (d) { col.moveCards([c.id], Number(d)); toast('Moved'); refresh(); }
      } },
      { label: 'Delete note', icon: 'trash', danger: true, run: async () => {
        if (await confirmDialog('Delete note?', 'This deletes the note and all its cards.', { ok: 'Delete', danger: true })) { col.deleteNotes([c.nid]); toast('Deleted'); refresh(); }
      } },
    ]);
  }

  refresh();
}

/** Sort field without cloze markup: {{c1::Paris::hint}} → Paris */
const displayText = (s) => String(s || '').replace(/\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g, '$1');

function dueText(c, today) {
  if (c.type === 0) return `New #${c.due}`;
  if (c.queue === 1) return 'Learning';
  const d = c.due - today;
  const when = d === 0 ? 'due today' : d < 0 ? `${-d}d overdue` : `due in ${formatInterval(d * 86400)}`;
  return `${when} · ivl ${formatInterval(c.ivl * 86400)}`;
}

export function cardInfo(cid) {
  const col = app.col;
  const c = col.card(cid);
  if (!c) return;
  const sh = sheet({ title: 'Card info', left: null, right: 'Done', onRight: () => sh.close() });
  const row = (k, v) => h('div.row', h('div.grow', k), h('div.muted', v));
  const rows = [row('Added', new Date(c.nid).toLocaleDateString()), row('Reviews', String(c.reps)), row('Lapses', String(c.lapses))];
  if (c.type === 2 || c.type === 3) {
    rows.push(row('Interval', formatInterval(c.ivl * 86400)), row('Ease', `${Math.round(c.factor / 10)}%`));
    const d = c.due - col.today;
    rows.push(row('Due', d === 0 ? 'Today' : d > 0 ? `In ${d} days` : `${-d} days ago`));
  }
  if (c.s > 0) rows.push(row('Stability', `${c.s.toFixed(1)} days`), row('Difficulty', `${Math.round((c.d - 1) / 9 * 100)}%`));
  sh.body.append(h('div.list', rows));
  const log = col.revlogFor(cid).reverse();
  if (log.length) {
    sh.body.append(h('h2.section', 'History'), h('div.list', log.slice(0, 100).map((r) => h('div.row',
      h('div.grow.small', new Date(r.id).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })),
      h('b.small', { style: { color: r.ease ? `var(--${['', 'again', 'hard', 'good', 'easy'][r.ease]})` : 'var(--muted)' } }, RATING_NAMES[r.ease] || 'Manual'),
      h('span.small.muted', { style: { width: '52px', textAlign: 'right' } }, r.ivl < 0 ? formatInterval(-r.ivl) : formatInterval(r.ivl * 86400))))));
  }
}
