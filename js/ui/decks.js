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

  // random practice from everything
  root.append(h('h2.section', 'Practice'));
  root.append(h('div.list',
    h('button.row.tap', { onclick: () => openStudy(tree.map((n) => n.deck.id), { practice: true }) }, icon('zap', 'sm ic'),
      h('div.grow', h('div', 'Random 30'), h('div.sub', 'Unseen cards first, from all your decks')), icon('right', 'sm chev'))));

  root.append(h('h2.section', 'Your decks'));
  const dropTop = h('div.drop-top.hidden', icon('left', 'sm'), 'Move out of folder');
  const list = h('div.list');
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const open = !n.deck.collapsed;
      list.append(h(`div.deck-row${depth ? '.child' : ''}`, { 'data-did': n.deck.id, style: { paddingLeft: `${6 + depth * 18}px`, '--indent': `${32 + depth * 18}px` } },
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
  root.append(dropTop, list, h('p.hint', 'Touch and hold a deck, then drag it onto another deck to put them in a folder.'));
  enableDeckDrag(list, dropTop);

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
}

// ---------------------------------------------------------------- drag a deck into a folder
// Folders are parent decks ("Folder::Deck"), exactly like Anki, so they survive export/import.

const leaf = (name) => name.split('::').pop();
const parentOf = (name) => name.split('::').slice(0, -1).join('::');
const isInside = (name, anc) => name.toLowerCase().startsWith(`${anc.toLowerCase()}::`);

function enableDeckDrag(list, dropTop) {
  const HOLD_MS = 380;
  let st = null; // { row, deck, x, y, timer, ghost, dx, dy, target, mouse }

  const begin = () => {
    const { row } = st;
    const r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.append(ghost);
    row.classList.add('lifted');
    st.ghost = ghost;
    st.dx = st.x - r.left;
    st.dy = st.y - r.top;
    if (parentOf(st.deck.name)) dropTop.classList.remove('hidden');
    navigator.vibrate?.(10);
    autoScroll();
  };

  const move = (x, y) => {
    st.x = x; st.y = y;
    st.ghost.style.left = `${x - st.dx}px`;
    st.ghost.style.top = `${y - st.dy}px`;
    const hit = document.elementFromPoint(x, y);
    let target = null;
    const zr = dropTop.classList.contains('hidden') ? null : dropTop.getBoundingClientRect();
    if (zr && x >= zr.left && x <= zr.right && y >= zr.top - 10 && y <= zr.bottom + 10) target = 'top';
    else {
      const row = hit?.closest?.('.deck-row[data-did]');
      if (row && list.contains(row)) {
        const d = app.col.deck(Number(row.dataset.did));
        if (d && d.id !== st.deck.id && !isInside(d.name, st.deck.name)) target = row;
      }
    }
    if (target !== st.target) {
      (st.target === 'top' ? dropTop : st.target)?.classList.remove('drop-into');
      (target === 'top' ? dropTop : target)?.classList.add('drop-into');
      st.target = target;
    }
  };

  const autoScroll = () => {
    if (!st?.ghost) return;
    const view = list.closest('.view');
    if (view) {
      const r = view.getBoundingClientRect();
      const edge = 70;
      const bottom = r.bottom - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabbar-h') || 58) - 20;
      let v = 0;
      if (st.y < r.top + edge) v = -Math.ceil((r.top + edge - st.y) / 6);
      else if (st.y > bottom - edge) v = Math.ceil((st.y - (bottom - edge)) / 6);
      if (v && st.target !== 'top') { view.scrollTop += v; move(st.x, st.y); }
    }
    requestAnimationFrame(autoScroll);
  };

  const end = (drop) => {
    if (!st) return;
    clearTimeout(st.timer);
    const s = st;
    st = null;
    if (!s.ghost) return false;
    s.ghost.remove();
    s.row.classList.remove('lifted');
    (s.target === 'top' ? dropTop : s.target)?.classList.remove('drop-into');
    dropTop.classList.add('hidden');
    // swallow the click that follows the drag
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 350);
    if (drop && s.target) {
      const target = s.target === 'top' ? null : app.col.deck(Number(s.target.dataset.did));
      setTimeout(() => dropDeck(s.deck, target), 0);
    }
    return true;
  };

  const start = (e, x, y, mouse) => {
    const row = e.target.closest('.deck-row[data-did]');
    if (!row || e.target.closest('.more-btn, .toggle')) return;
    const deck = app.col.deck(Number(row.dataset.did));
    if (!deck) return;
    st = { row, deck, x, y, sx: x, sy: y, mouse, target: null, ghost: null };
    if (!mouse) st.timer = setTimeout(() => { if (st && !st.ghost) begin(); }, HOLD_MS);
  };

  // touch: hold, then drag (moving before the hold scrolls the page as usual)
  list.addEventListener('touchstart', (e) => { if (e.touches.length === 1) start(e, e.touches[0].clientX, e.touches[0].clientY, false); else end(false); }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!st) return;
    const t = e.touches[0];
    if (!st.ghost) {
      if (Math.hypot(t.clientX - st.sx, t.clientY - st.sy) > 8) { clearTimeout(st.timer); st = null; }
      return;
    }
    e.preventDefault();
    move(t.clientX, t.clientY);
  }, { passive: false });
  list.addEventListener('touchend', (e) => { if (end(true)) e.preventDefault(); });
  list.addEventListener('touchcancel', () => end(false));
  list.addEventListener('contextmenu', (e) => { if (st) e.preventDefault(); });

  // mouse: press and drag
  list.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    start(e, e.clientX, e.clientY, true);
    if (!st) return;
    const mm = (ev) => {
      if (!st) return;
      if (!st.ghost) {
        if (Math.hypot(ev.clientX - st.sx, ev.clientY - st.sy) < 6) return;
        begin();
      }
      ev.preventDefault();
      move(ev.clientX, ev.clientY);
    };
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); end(true); };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  });
}

/** Dropped `deck` onto `target` (null = the "move out of folder" area). */
async function dropDeck(deck, target) {
  const col = app.col;
  const run = (fn, msg) => { try { fn(); toast(msg); } catch (e) { toast(e.message); } app.rerender(); };
  const moveTo = (d, parent) => col.renameDeck(d.id, parent ? `${parent}::${leaf(d.name)}` : leaf(d.name));

  if (!target) {
    const up = parentOf(parentOf(deck.name));
    run(() => moveTo(deck, up), up ? `Moved to ${leaf(up)}` : 'Moved out of folder');
    return;
  }
  const canMoveInto = parentOf(deck.name).toLowerCase() !== target.name.toLowerCase();
  const canGroup = !isInside(deck.name, target.name);
  const choice = await actionSheet(`Move “${leaf(deck.name)}”`, [
    canMoveInto ? { label: `Put inside “${leaf(target.name)}”`, icon: 'right', value: 'into' } : null,
    canGroup ? { label: `New folder with “${leaf(target.name)}”`, icon: 'folderplus', value: 'group' } : null,
  ]);
  if (choice === 'into') {
    run(() => moveTo(deck, target.name), `Moved into ${leaf(target.name)}`);
  } else if (choice === 'group') {
    const name = (await promptDialog('New folder', { placeholder: 'Folder name', ok: 'Create' }))?.trim().replace(/::/g, ' ');
    if (!name) return;
    const parent = parentOf(target.name);
    const folder = parent ? `${parent}::${name}` : name;
    if (leaf(deck.name).toLowerCase() === leaf(target.name).toLowerCase()) { toast('Both decks have the same name'); return; }
    const clash = [deck, target].find((d) => { const x = col.deckByName(`${folder}::${leaf(d.name)}`); return x && x.id !== d.id; });
    if (clash) { toast(`${name} already has a deck named ${leaf(clash.name)}`); return; }
    run(() => {
      // the target's id stays fixed, so fetch both by id after each rename
      const t = col.deck(target.id);
      moveTo(t, folder);
      moveTo(col.deck(deck.id), folder);
    }, `Created folder ${name}`);
  }
}

async function customActions(cd) {
  const c = customCounts(cd);
  await actionSheet(cd.name, [
    c.new + c.learning + c.review ? { label: 'Study now', icon: 'play', run: () => openStudy(cd.deckIds) } : null,
    { label: 'Random 30', icon: 'zap', run: () => openStudy(cd.deckIds, { practice: true }) },
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
    { label: 'Random 30', icon: 'zap', run: () => openStudy(n.deck.id, { practice: true }) },
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
