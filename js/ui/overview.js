import { h, icon, actionSheet, promptDialog, confirmDialog, toast, sheet, switchEl, segmented } from './dom.js';
import { app, navigate, exportDeck } from './app.js';
import { stripHTML } from '../core/util.js';
import { openStudy } from './study.js';
import { openEditor } from './editor.js';
import { openDeckOptions } from './options.js';
import { createDeck } from './decks.js';

function findNode(nodes, id) {
  for (const n of nodes) { if (n.deck.id === id) return n; const c = findNode(n.children, id); if (c) return c; }
  return null;
}

export function overviewView(root, deckId) {
  const col = app.col;
  const node = findNode(col.deckTree(), deckId);
  if (!node) { navigate('/decks'); return; }
  const deck = node.deck;
  const c = node.counts;
  const total = c.new + c.learning + c.review;

  root.append(h('div.topbar',
    h('button.back', { onclick: () => history.length > 1 ? history.back() : navigate('/decks') }, icon('left'), 'Decks'),
    h('button.icon-btn', { 'aria-label': 'More', onclick: () => more(deck, node) }, icon('more'))));
  root.append(h('h1.large', deck.name.split('::').pop()));
  if (deck.name.includes('::')) root.lastChild.before(h('div.small.muted', deck.name.split('::').slice(0, -1).join(' › ')));

  const big = (k, v, color) => h('div', h('div.v', { style: { color: v ? color : 'var(--faint)' } }, String(v)), h('div.k', k));
  root.append(h('div.card.pad',
    h('div.bigcounts', big('New', c.new, 'var(--new)'), big('Learning', c.learning, 'var(--learn)'), big('Review', c.review, 'var(--review)')),
    total ? h('button.btn.primary', { onclick: () => openStudy(deckId) }, icon('play', 'sm'), 'Study now')
      : h('div.done-msg', icon('check'), h('div', 'Congratulations! You have finished this deck for now.')),
    node.total ? h('button.btn.tinted.block', { style: { marginTop: '10px' }, onclick: () => openStudy(deckId, { practice: true }) },
      icon('zap', 'sm'), 'Random 25') : null));
  if (node.total) root.append(h('p.hint', 'Random 25 picks cards you haven’t answered yet first, mixed from this whole deck. Once you’ve seen them all, it picks from every card. Your answers count toward your schedule.'));

  root.append(h('h2.section', 'New cards per day'), dailyLimitPicker(deckId));

  if (deck.desc) root.append(h('div.card.pad.small.muted', { style: { marginTop: '14px' } }, stripHTML(deck.desc)));

  root.append(h('h2.section', 'Deck'));
  const row = (label, ic, fn) => h('button.row.tap', { onclick: fn }, icon(ic, 'sm ic'), h('div.grow', label), icon('right', 'sm chev'));
  root.append(h('div.list',
    row('Add note', 'edit', () => openEditor({ deckId })),
    row('Browse cards', 'search', () => { sessionStorage.setItem('browseQuery', `"deck:${deck.name}"`); navigate('/browse'); }),
    row('Statistics', 'chart', () => { sessionStorage.setItem('statsDeck', String(deckId)); navigate('/stats'); }),
    row('Deck options', 'sliders', () => openDeckOptions(deckId)),
    row('Export deck (.apkg)', 'share', () => exportSheet(deckId))));
  root.append(h('p.small.muted.center', { style: { marginTop: '16px' } }, `${node.total} cards${node.children.length ? ' including subdecks' : ''}`));
}

export const DAILY_LIMITS = [20, 40, 50, 100];

/** Quick picker for the deck preset's "New cards/day". */
export function dailyLimitPicker(deckId) {
  const col = app.col;
  const cfg = col.configForDeck(deckId);
  const shared = col.allDecks().filter((d) => d.conf === cfg.id).length;
  const opts = DAILY_LIMITS.includes(cfg.newPerDay) ? DAILY_LIMITS : [...DAILY_LIMITS, cfg.newPerDay].sort((a, b) => a - b);
  return h('div.card.pad',
    segmented(opts.map((v) => [v, String(v)]), cfg.newPerDay, (v) => {
      col.saveConfig({ ...col.config(cfg.id), newPerDay: v });
      toast(`${v} new cards per day`);
      app.rerender();
    }),
    h('div.small.muted', { style: { marginTop: '10px' } },
      shared > 1 ? `Applies to every deck that uses the “${cfg.name}” preset (${shared} decks). You can set other numbers in Deck options.`
        : 'You can set any other number in Deck options.'));
}

function exportSheet(deckId) {
  const opts = { includeScheduling: true, includeMedia: true };
  const sh = sheet({ title: 'Export deck', right: 'Export', onRight: () => { sh.close(); exportDeck(deckId, opts); } });
  sh.body.append(h('div.list.form',
    h('div.row', h('label', 'Include scheduling & history'), switchEl(true, (v) => { opts.includeScheduling = v; })),
    h('div.row', h('label', 'Include media'), switchEl(true, (v) => { opts.includeMedia = v; }))),
  h('p.hint', 'Creates an .apkg file you can open in Anki, AnkiDroid, AnkiMobile or share with friends.'));
}

async function more(deck, node) {
  await actionSheet(deck.name, [
    { label: 'Rename', icon: 'edit', run: async () => {
      const n = await promptDialog('Rename deck', { value: deck.name, ok: 'Rename' });
      if (!n) return;
      try { app.col.renameDeck(deck.id, n); } catch (e) { toast(e.message); }
      app.rerender();
    } },
    { label: 'Add subdeck', icon: 'folderplus', run: () => createDeck(deck.name) },
    { label: 'Delete deck', icon: 'trash', danger: true, run: async () => {
      if (await confirmDialog(`Delete “${deck.name}”?`, `This deletes the deck${node.children.length ? ', its subdecks' : ''} and ${node.total} cards. This can't be undone.`, { ok: 'Delete', danger: true })) {
        app.col.deleteDeck(deck.id);
        toast('Deck deleted');
        navigate('/decks');
      }
    } },
  ]);
}
