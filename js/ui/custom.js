// Custom decks: a saved group of regular decks (e.g. "Day 1" + "Day 51") that you study together.
import { h, clear, icon, sheet, toast, confirmDialog, actionSheet } from './dom.js';
import { app, navigate } from './app.js';
import { StudySession } from '../core/session.js';
import { openStudy } from './study.js';

/** Due counts for a custom deck, using the same rules as studying it. */
export function customCounts(cd) {
  if (!cd.deckIds.length) return { new: 0, learning: 0, review: 0 };
  return new StudySession(app.col, cd.deckIds).counts;
}

export function customView(root, id) {
  const col = app.col;
  const cd = col.customDeck(id);
  if (!cd) { navigate('/decks'); return; }
  const c = customCounts(cd);
  const total = c.new + c.learning + c.review;
  const cards = col.cardCount(cd.deckIds);

  root.append(h('div.topbar',
    h('button.back', { onclick: () => history.length > 1 ? history.back() : navigate('/decks') }, icon('left'), 'Decks'),
    h('button.icon-btn', { 'aria-label': 'More', onclick: () => more(cd) }, icon('more'))));
  root.append(h('div.small.muted', 'Custom deck'), h('h1.large', cd.name));

  const big = (k, v, color) => h('div', h('div.v', { style: { color: v ? color : 'var(--faint)' } }, String(v)), h('div.k', k));
  root.append(h('div.card.pad',
    h('div.bigcounts', big('New', c.new, 'var(--new)'), big('Learning', c.learning, 'var(--learn)'), big('Review', c.review, 'var(--review)')),
    total ? h('button.btn.primary', { onclick: () => openStudy(cd.deckIds) }, icon('play', 'sm'), 'Study now')
      : h('div.done-msg', icon('check'), h('div', cd.deckIds.length ? 'Nothing is due in these decks right now.' : 'Add some decks to this custom deck.')),
    cards ? h('button.btn.tinted.block', { style: { marginTop: '10px' }, onclick: () => openStudy(cd.deckIds, { practice: true }) }, icon('zap', 'sm'), 'Random 30') : null));
  root.append(h('p.hint', 'Study now follows your schedule for all the decks below together. Random 30 picks cards you haven’t answered yet first, mixed from all of them. Your answers count toward your schedule.'));

  root.append(h('h2.section', `Decks (${cd.deckIds.length})`));
  root.append(h('div.list',
    cd.deckIds.map((did) => {
      const d = col.deck(did);
      return h('button.row.tap', { onclick: () => navigate(`/deck/${did}`) }, icon('stack', 'sm ic'),
        h('div.grow', h('div', d.name.split('::').pop()), d.name.includes('::') ? h('div.sub', d.name.split('::').slice(0, -1).join(' › ')) : null),
        h('span.small.muted', String(col.cardCount([did]))), icon('right', 'sm chev'));
    }),
    h('button.row.tap', { onclick: () => editCustomDeck(cd) }, icon('edit', 'sm ic'), h('div.grow', 'Choose decks'), icon('right', 'sm chev'))));
  root.append(h('p.small.muted.center', { style: { marginTop: '16px' } }, `${cards} card${cards === 1 ? '' : 's'}`));
}

async function more(cd) {
  await actionSheet(cd.name, [
    { label: 'Edit custom deck', icon: 'edit', run: () => editCustomDeck(cd) },
    { label: 'Delete custom deck', icon: 'trash', danger: true, run: async () => {
      if (!await confirmDialog(`Delete “${cd.name}”?`, 'Only the custom deck is removed. The decks and cards in it are kept.', { ok: 'Delete', danger: true })) return;
      app.col.deleteCustomDeck(cd.id);
      toast('Custom deck deleted');
      navigate('/decks');
    } },
  ]);
}

/** Create (cd = null) or edit a custom deck. */
export function editCustomDeck(cd = null) {
  const col = app.col;
  const selected = new Set(cd?.deckIds || []);
  let name = cd?.name || '';
  let filter = '';
  const sh = sheet({ title: cd ? 'Edit custom deck' : 'New custom deck', right: 'Save', onRight: save, full: true });
  const countEl = h('p.hint');
  const listEl = h('div.list');
  const decks = col.allDecks().filter((d) => d.id !== 1 || col.cardCount([1]) > 0);

  sh.body.append(
    h('div.list.form', h('div.row', h('input', { type: 'text', value: name, placeholder: 'Name, e.g. Day 1 + Day 51', style: { width: '100%' },
      oninput: (e) => { name = e.target.value; } }))),
    h('h2.section', 'Decks to include'),
    h('input', { type: 'search', placeholder: 'Search decks', autocapitalize: 'off', style: { width: '100%', marginBottom: '10px' },
      oninput: (e) => { filter = e.target.value.trim().toLowerCase(); renderList(); } }),
    listEl, countEl);

  function renderList() {
    const shown = decks.filter((d) => !filter || d.name.toLowerCase().includes(filter));
    clear(listEl, shown.length ? shown.map((d) => {
      const depth = d.name.split('::').length - 1;
      const on = selected.has(d.id);
      return h('button.row.tap', { style: { paddingLeft: `${16 + depth * 18}px` }, onclick: () => { if (on) selected.delete(d.id); else selected.add(d.id); renderList(); } },
        h(`span.pick${on ? '.on' : ''}`, on ? icon('check') : null),
        h('div.grow', d.name.split('::').pop()),
        h('span.small.muted', String(col.cardCount([d.id]))));
    }) : h('div.row.muted', 'No decks match.'));
    clear(countEl, selected.size ? `${selected.size} deck${selected.size === 1 ? '' : 's'} selected · ${col.cardCount([...selected])} cards. Subdecks of a chosen deck are included.`
      : 'Tap the decks you want to study together.');
  }

  function save() {
    const ids = decks.map((d) => d.id).filter((id) => selected.has(id));
    if (!ids.length) { toast('Choose at least one deck'); return; }
    const finalName = name.trim() || ids.map((id) => col.deck(id).name.split('::').pop()).join(' + ');
    const saved = col.saveCustomDeck({ id: cd?.id, name: finalName, deckIds: ids });
    sh.close();
    toast(cd ? 'Custom deck saved' : 'Custom deck created');
    if (cd) app.rerender(); else navigate(`/custom/${saved.id}`);
  }

  renderList();
}
