import { h, icon, countsPills, actionSheet, promptDialog, toast } from './dom.js';
import { app, navigate, pickImportFile } from './app.js';
import { collectionStats } from '../core/stats.js';
import { openStudy } from './study.js';
import { openEditor } from './editor.js';
import { customCounts, editCustomDeck } from './custom.js';

export function decksView(root) {
  const col = app.col;
  const tree = col.deckTree();
  const due = tree.reduce((a, n) => ({ new: a.new + n.counts.new, learning: a.learning + n.counts.learning, review: a.review + n.counts.review }), { new: 0, learning: 0, review: 0 });
  const total = due.new + due.learning + due.review;
  const stats = collectionStats(col, null, 1, 1);

  const add = h('button.icon-btn.accent', { 'aria-label': 'Add', onclick: () => addMenu() }, icon('plus'));
  root.append(h('div.topbar', h('span'), add), h('h1.large', 'Decks'));

  const best = [...tree].sort((a, b) => (b.counts.new + b.counts.learning + b.counts.review) - (a.counts.new + a.counts.learning + a.counts.review))[0];
  root.append(h('section.hero',
    stats.streak ? h('div.streak', icon('flame', 'sm'), String(stats.streak)) : null,
    h('div.label', 'Due today'),
    h('div.big', String(total)),
    h('div.stats',
      stat('New', due.new), stat('Learning', due.learning), stat('Review', due.review),
      h('div.studied', h('div', h('b', `${stats.today.reviews}`), ' studied'), h('div', fmtTime(stats.today.time)))),
    total && best ? h('button.study-btn', { onclick: () => openStudy(tree.length === 1 ? tree[0].deck.id : best.deck.id) },
      icon('play', 'sm'), tree.length === 1 ? 'Study now' : `Study ${best.deck.name}`) : null));

  const isEmpty = !tree.length || (tree.length === 1 && tree[0].total === 0 && !tree[0].children.length);
  if (isEmpty) {
    root.append(h('div.card', { style: { marginTop: '20px' } }, h('div.empty',
      h('div.art', icon('layers')), h('h3', 'Start learning'),
      h('p', 'Import a shared Anki deck (.apkg) or create your own cards.'),
      h('button.btn.primary', { onclick: pickImportFile }, icon('import', 'sm'), 'Import .apkg'),
      h('div.btn-row', { style: { marginTop: '10px' } },
        h('button.btn', { onclick: createDeck }, icon('folderplus', 'sm'), 'New deck'),
        h('button.btn', { onclick: () => openEditor({ deckId: null }) }, icon('edit', 'sm'), 'Add note')))));
    return;
  }

  root.append(h('h2.section', 'Your decks'));
  const list = h('div.list');
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const open = !n.deck.collapsed;
      list.append(h(`div.deck-row${depth ? '.child' : ''}`, { style: { paddingLeft: `${6 + depth * 18}px`, '--indent': `${32 + depth * 18}px` } },
        n.children.length
          ? h(`button.toggle${open ? '.open' : ''}`, { 'aria-label': open ? 'Collapse' : 'Expand', onclick: () => { n.deck.collapsed = open; col.saveDeck(n.deck); app.rerender(); } }, icon('right', 'sm'))
          : h('span.toggle'),
        h('div.name', { onclick: () => navigate(`/deck/${n.deck.id}`) },
          h('div.t', n.deck.name.split('::').pop()), h('div.sub', `${n.total} card${n.total === 1 ? '' : 's'}`)),
        countsPills(n.counts),
        h('button.more-btn', { 'aria-label': 'Deck actions', onclick: () => deckActions(n) }, icon('more', 'sm'))));
      if (open) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  root.append(list);

  // custom decks: groups of decks studied together
  root.append(h('h2.section', 'Custom decks'));
  const customs = col.customDecks();
  root.append(h('div.list',
    customs.map((cd) => {
      const n = col.cardCount(cd.deckIds);
      return h('div.deck-row', { style: { paddingLeft: '6px', '--indent': '32px' } },
        h('span.toggle', { style: { color: 'var(--accent)' } }, icon('layers', 'sm')),
        h('div.name', { onclick: () => navigate(`/custom/${cd.id}`) },
          h('div.t', cd.name), h('div.sub', `${cd.deckIds.length} deck${cd.deckIds.length === 1 ? '' : 's'} · ${n} card${n === 1 ? '' : 's'}`)),
        countsPills(customCounts(cd)),
        h('button.more-btn', { 'aria-label': 'Custom deck actions', onclick: () => customActions(cd) }, icon('more', 'sm')));
    }),
    h('button.row.tap', { onclick: () => editCustomDeck() }, icon('folderplus', 'sm ic'),
      h('div.grow', h('div', 'Create custom deck'), h('div.sub', 'Combine decks, e.g. Day 1 + Day 51')), icon('right', 'sm chev'))));

  // random practice from everything
  root.append(h('h2.section', 'Practice'));
  root.append(h('div.list',
    h('button.row.tap', { onclick: () => openStudy(tree.map((n) => n.deck.id), { practice: true }) }, icon('zap', 'sm ic'),
      h('div.grow', h('div', 'Random 25'), h('div.sub', 'Mixed from all your decks · doesn’t change your schedule')), icon('right', 'sm chev'))));
}

async function customActions(cd) {
  const c = customCounts(cd);
  await actionSheet(cd.name, [
    c.new + c.learning + c.review ? { label: 'Study now', icon: 'play', run: () => openStudy(cd.deckIds) } : null,
    { label: 'Random 25', icon: 'zap', run: () => openStudy(cd.deckIds, { practice: true }) },
    { label: 'Open', icon: 'right', run: () => navigate(`/custom/${cd.id}`) },
    { label: 'Edit', icon: 'edit', run: () => editCustomDeck(cd) },
  ]);
}

function stat(k, v) { return h('div', h('div.v', String(v)), h('div.k', k)); }
function fmtTime(s) { return s < 60 ? `${s}s today` : `${Math.round(s / 60)} min today`; }

async function deckActions(n) {
  const total = n.counts.new + n.counts.learning + n.counts.review;
  await actionSheet(n.deck.name, [
    total ? { label: 'Study now', icon: 'play', run: () => openStudy(n.deck.id) } : null,
    { label: 'Random 25', icon: 'zap', run: () => openStudy(n.deck.id, { practice: true }) },
    { label: 'Open deck', icon: 'right', run: () => navigate(`/deck/${n.deck.id}`) },
    { label: 'Add note', icon: 'edit', run: () => openEditor({ deckId: n.deck.id }) },
  ]);
}

async function addMenu() {
  await actionSheet(null, [
    { label: 'Add note', icon: 'edit', run: () => openEditor({ deckId: null }) },
    { label: 'Create deck', icon: 'folderplus', run: createDeck },
    { label: 'Create custom deck', icon: 'layers', run: () => editCustomDeck() },
    { label: 'Import .apkg / .colpkg', icon: 'import', run: pickImportFile },
  ]);
}

export async function createDeck(parent = null) {
  const name = await promptDialog('New deck', { placeholder: 'Name (use :: for subdecks)', value: typeof parent === 'string' ? `${parent}::` : '', ok: 'Create' });
  if (!name?.trim()) return;
  try { app.col.getOrCreateDeck(name); toast('Deck created'); } catch (e) { toast(e.message); }
  app.rerender();
}
