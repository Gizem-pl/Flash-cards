// The Later list (cards set aside while studying) and the Hardest cards.
import { h, icon, actionSheet, confirmDialog, toast } from './dom.js';
import { app, navigate } from './app.js';
import { LATER_TAG } from '../core/collection.js';
import { hardestCards } from '../core/stats.js';
import { openStudy } from './study.js';
import { openEditor } from './editor.js';
import { cardInfo, displayText } from './browse.js';

const ROUND = 25;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const typeColor = (c) => (c.type === 0 ? 'var(--new)' : c.type === 2 ? 'var(--review)' : 'var(--learn)');

function header(root, title) {
  root.append(h('div.topbar',
    h('button.back', { onclick: () => history.length > 1 ? history.back() : navigate('/decks') }, icon('left'), 'Decks'),
    title === 'Later' ? h('button.icon-btn', { 'aria-label': 'More', onclick: laterMore }, icon('more')) : h('span')));
  root.append(h('div.small.muted', 'Practice'), h('h1.large', title));
}

function cardRow(c, { lead = null, sub, extra = null, marker = null, onTap }) {
  const n = app.col.note(c.nid);
  return h(`div.row.b-row.tap${c.queue === -1 ? '.susp' : ''}`, { onclick: onTap },
    lead || h('span.dot', { style: { background: typeColor(c) } }),
    h('div.grow', h('div.t', displayText(n?.sfld) || '(empty)'), extra, h('div.sub', sub)),
    marker,
    c.queue === -1 ? h('span', { style: { color: 'var(--hard)' } }, icon('pause', 'xs')) : null,
    icon('right', 'sm chev'));
}

function deckName(c) { return (app.col.deck(c.did)?.name || '').split('::').pop(); }

function editNote(c) { const n = app.col.note(c.nid); if (n) openEditor({ note: n, onSaved: () => app.rerender() }); }

// ---------------------------------------------------------------- Later

export function laterView(root) {
  const col = app.col;
  const cards = col.laterCards();
  const studyable = cards.filter((c) => c.queue !== -1).length;
  const today = col.today;
  const todayCount = cards.filter((c) => { const at = col.setAsideInfo(c.id).at; return at && col.dayIndex(at) === today; }).length;
  header(root, 'Later');

  const big = (k, v, color) => h('div', h('div.v', { style: { color: v ? color : 'var(--faint)' } }, String(v)), h('div.k', k));
  root.append(h('div.card.pad',
    h('div.bigcounts', big('On the list', cards.length, 'var(--accent)'), big('Set aside today', todayCount, 'var(--learn)')),
    studyable ? h('button.btn.primary', { onclick: () => openStudy(null, { later: true, size: ROUND }) },
      icon('play', 'sm'), studyable > ROUND ? `Study ${ROUND} of ${studyable}` : 'Study later cards')
      : h('div.done-msg', icon('check'), h('div', cards.length ? 'The cards on your list are suspended.' : 'Nothing set aside right now.'))));
  root.append(h('p.hint', 'Tap Later while studying to set a card aside without answering it. It comes back in normal study tomorrow, and stays on this list until you answer it Good or Easy.'));

  if (!cards.length) return;
  root.append(h('h2.section', `Cards (${cards.length})`));
  root.append(h('div.list', cards.map((c) => {
    const info = col.setAsideInfo(c.id);
    const parts = [deckName(c)];
    if (info.count) parts.push(`set aside ${info.count}×`, whenText(col.dayIndex(info.at), today));
    return cardRow(c, { sub: parts.filter(Boolean).join(' · '), onTap: () => laterActions(c) });
  })));
}

function whenText(day, today) {
  const d = today - day;
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

async function laterActions(c) {
  const col = app.col;
  await actionSheet(null, [
    { label: 'Edit note', icon: 'edit', run: () => editNote(c) },
    { label: 'Card info', icon: 'info', run: () => cardInfo(c.id) },
    { label: 'Remove from Later list', icon: 'check', run: () => { col.removeFromLater([c.nid]); toast('Removed from Later list'); app.rerender(); } },
  ]);
}

async function laterMore() {
  const col = app.col;
  const cards = col.laterCards();
  await actionSheet('Later', [
    { label: 'Show in Browse', icon: 'search', run: () => { sessionStorage.setItem('browseQuery', `tag:${LATER_TAG}`); navigate('/browse'); } },
    cards.length ? { label: 'Clear the list', icon: 'trash', danger: true, run: async () => {
      if (!await confirmDialog('Clear the Later list?', `${plural(cards.length, 'card')} will be taken off the list. Their schedule doesn’t change.`, { ok: 'Clear', danger: true })) return;
      col.removeFromLater([...new Set(cards.map((c) => c.nid))]);
      toast('Later list cleared');
      app.rerender();
    } } : null,
  ].filter(Boolean));
}

// ---------------------------------------------------------------- Hardest cards

export function hardestView(root) {
  const col = app.col;
  const list = hardestCards(col, { limit: 50 });
  header(root, 'Hardest cards');

  const pick = list.map((x) => x.card).filter((c) => c.queue >= 0).slice(0, ROUND);
  root.append(h('div.card.pad',
    pick.length ? h('button.btn.primary', { onclick: () => openStudy(null, { cards: pick, title: 'hard card' }) },
      icon('zap', 'sm'), `Practise the hardest ${pick.length}`)
      : h('div.done-msg', icon('check'), h('div', list.length ? 'These cards are suspended or set aside until tomorrow.' : 'No hard cards yet.'))));
  root.append(h('p.hint', 'Cards get a point for each Again, one more each time you forget a card you already knew, and one for each time you set it aside with Later. Practice answers count toward your schedule.'));

  if (!list.length) return;
  root.append(h('h2.section', `Top ${list.length}`));
  root.append(h('div.list', list.map((x, i) => {
    const why = h('div.why',
      x.again ? h('span.w-again', `Again ${x.again}×`) : null,
      x.lapses ? h('span.w-forgot', `Forgot ${x.lapses}×`) : null,
      x.setAside ? h('span.w-later', `Later ${x.setAside}×`) : null);
    const listed = col.isLater(col.note(x.card.nid))
      ? h('span', { style: { color: 'var(--accent)' }, title: 'On your Later list', 'aria-label': 'On your Later list' }, icon('clock', 'xs')) : null;
    return cardRow(x.card, { lead: h('span.rank.num', String(i + 1)), extra: why, marker: listed, sub: deckName(x.card), onTap: () => hardActions(x.card) });
  })));
}

async function hardActions(c) {
  const col = app.col;
  const onList = col.isLater(col.note(c.nid));
  await actionSheet(null, [
    { label: 'Edit note', icon: 'edit', run: () => editNote(c) },
    { label: 'Card info', icon: 'info', run: () => cardInfo(c.id) },
    onList ? { label: 'Remove from Later list', icon: 'check', run: () => { col.removeFromLater([c.nid]); toast('Removed from Later list'); app.rerender(); } }
      : { label: 'Add to Later list', icon: 'clock', run: () => { col.addTags([LATER_TAG], [c.nid]); toast('Added to Later list'); app.rerender(); } },
  ]);
}
