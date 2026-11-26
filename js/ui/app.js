// App shell: boot, routing, tab bar, import/export.
import { Collection } from '../core/collection.js';
import { importPackage } from '../core/importer.js';
import { exportPackage } from '../core/exporter.js';
import { h, clear, icon, toast, progress, sheet, shareOrDownload } from './dom.js';
import { decksView } from './decks.js';
import { overviewView } from './overview.js';
import { customView } from './custom.js';
import { browseView } from './browse.js';
import { statsView } from './statsview.js';
import { settingsView, notetypesView, notetypeEditorView } from './settings.js';

export const app = {
  col: null,
  prefs: loadPrefs(),
  rerender: () => {},
};

function loadPrefs() {
  const defaults = { theme: 'system', tapToReveal: true, showIntervals: true, twoButtons: true, lastNotetype: null, lastDeck: 1 };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('prefs') || '{}') }; } catch { return defaults; }
}
export function savePrefs() {
  try { localStorage.setItem('prefs', JSON.stringify(app.prefs)); } catch { /* private mode */ }
  applyTheme();
}
function applyTheme() {
  const t = app.prefs.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#FAF7F2');
}
export const isDark = () => app.prefs.theme === 'dark' || (app.prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

// ---------------------------------------------------------------- routing

const TABS = [
  ['decks', 'Decks', 'stack'],
  ['browse', 'Browse', 'search'],
  ['stats', 'Stats', 'chart'],
  ['settings', 'Settings', 'gear'],
];
const TAB_OF = { deck: 'decks', custom: 'decks', notetypes: 'settings', notetype: 'settings' };

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'decks', arg: parts[1] ? decodeURIComponent(parts[1]) : null };
}
export function navigate(path) { location.hash = path; }

const stage = h('div.stage');
const tabbar = h('nav.tabbar');
const scrollPos = new Map();
let viewEl = null;
let currentKey = '';
let currentRoute = null;

// how deep a screen is inside its tab: pushing deeper slides in from the right, going back slides out
const DEPTH = { deck: 1, custom: 1, notetypes: 1, notetype: 2 };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function buildView(r) {
  const inner = h('div.view-inner');
  try {
    switch (r.name) {
      case 'deck': overviewView(inner, Number(r.arg)); break;
      case 'custom': customView(inner, Number(r.arg)); break;
      case 'browse': browseView(inner); break;
      case 'stats': statsView(inner); break;
      case 'settings': settingsView(inner); break;
      case 'notetypes': notetypesView(inner); break;
      case 'notetype': notetypeEditorView(inner, Number(r.arg)); break;
      default: decksView(inner);
    }
  } catch (e) {
    console.error(e);
    inner.append(h('div.card.pad', h('b', 'Something went wrong'), h('p.muted.small', String(e.message || e))));
  }
  return inner;
}

function render() {
  const r = route();
  const key = `${r.name}/${r.arg ?? ''}`;
  const tab = TAB_OF[r.name] || r.name;

  // same screen (data changed): swap the contents in place, keeping the scroll position
  if (viewEl && key === currentKey) {
    const top = viewEl.scrollTop;
    clear(viewEl, buildView(r));
    viewEl.scrollTop = top;
    updateTabbar(tab);
    return;
  }

  const prev = viewEl;
  const prevRoute = currentRoute;
  if (prev) scrollPos.set(currentKey, prev.scrollTop);
  // finish any transition that is still running
  stage.querySelectorAll('.view.leaving').forEach((v) => v.remove());

  const prevTab = prevRoute ? TAB_OF[prevRoute.name] || prevRoute.name : null;
  const d0 = prevRoute ? DEPTH[prevRoute.name] || 0 : 0;
  const d1 = DEPTH[r.name] || 0;
  const kind = !prev || reduceMotion.matches || prevTab !== tab || d0 === d1 ? 'swap' : d1 > d0 ? 'push' : 'pop';

  const next = h('main.view', buildView(r));
  if (kind === 'pop') stage.insertBefore(next, prev); else stage.append(next);
  next.scrollTop = kind === 'push' ? 0 : scrollPos.get(key) || 0;
  viewEl = next;
  currentKey = key;
  currentRoute = r;
  updateTabbar(tab);

  if (!prev) return;
  if (kind === 'swap') { prev.remove(); return; }
  prev.classList.add('leaving');
  const opts = { duration: 380, easing: 'cubic-bezier(.2,.85,.25,1)' };
  const top = kind === 'push' ? next : prev; // the screen that slides over the other one
  const under = kind === 'push' ? prev : next;
  top.classList.add('sliding');
  const frames = kind === 'push'
    ? [[{ transform: 'translateX(100%)' }, { transform: 'none' }], [{ transform: 'none' }, { transform: 'translateX(-28%)' }]]
    : [[{ transform: 'none' }, { transform: 'translateX(100%)' }], [{ transform: 'translateX(-28%)' }, { transform: 'none' }]];
  const a = top.animate(frames[0], opts);
  under.animate(frames[1], opts);
  const done = () => { prev.remove(); top.classList.remove('sliding'); };
  a.onfinish = done;
  a.oncancel = done;
}

function updateTabbar(tab) {
  if (!tabbar.children.length) {
    tabbar.append(...TABS.map(([id, label, ic]) => h('button', { 'data-tab': id,
      onclick: () => { if (route().name === id) viewEl?.scrollTo({ top: 0, behavior: 'smooth' }); else navigate(`/${id}`); },
    }, icon(ic), label)));
  }
  for (const b of tabbar.children) b.classList.toggle('active', b.dataset.tab === tab);
}
app.rerender = render;

// ---------------------------------------------------------------- import / export

const fileInput = h('input', { type: 'file', multiple: true, class: 'hidden', onchange: (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  importFiles(files);
} });

export function pickImportFile() { fileInput.click(); }

export function importFile(file) { return importFiles([file]); }

/** Imports one or many packages under a single progress box, then shows one summary. */
let importing = false;
export async function importFiles(list) {
  const files = [...list].filter((f) => /\.(apkg|colpkg|zip)$/i.test(f.name));
  const skipped = list.length - files.length;
  if (!files.length) { toast('Choose an Anki package (.apkg or .colpkg)'); return; }
  if (importing) { toast('Please wait for the current import to finish'); return; }
  importing = true;
  navigator.storage?.persist?.().catch(() => {});
  const n = files.length;
  const p = progress(n === 1 ? `Importing ${files[0].name}…` : `Importing 1 of ${n}…`);
  const total = { notesAdded: 0, notesUpdated: 0, notesUnchanged: 0, cardsAdded: 0, mediaFiles: 0, notetypesAdded: 0, decks: [], warnings: [], failed: [], files: n };
  try {
    for (let i = 0; i < n; i++) {
      const file = files[i];
      const head = n === 1 ? '' : `Importing ${i + 1} of ${n}\n`;
      p.update(`${head}${file.name}`, i / n);
      try {
        const s = await importPackage(file, app.col, { onProgress: (m, f) => p.update(`${head}${m}`, (i + (f ?? 0)) / n) });
        for (const k of ['notesAdded', 'notesUpdated', 'notesUnchanged', 'cardsAdded', 'mediaFiles', 'notetypesAdded']) total[k] += s[k] || 0;
        total.decks.push(...s.decks);
        total.warnings.push(...s.warnings);
      } catch (e) {
        console.error(e);
        total.failed.push(`${file.name}: ${e.message || e}`);
      }
    }
  } finally {
    importing = false;
  }
  if (skipped) total.warnings.push(`${skipped} file${skipped === 1 ? ' was' : 's were'} skipped because ${skipped === 1 ? 'it isn’t' : 'they aren’t'} an Anki package.`);
  // update the screen underneath first, then swap the progress box for the one result sheet
  // on the same dimmed background, so nothing blinks
  resetViewport();
  render();
  if (n === 1 && total.failed.length) toast(`Import failed: ${total.failed[0].split(': ').slice(1).join(': ')}`);
  else showImportResult(total);
  p.close();
}

// iOS can leave the page scrolled after the file picker or keyboard closes, which makes
// taps land in the wrong place until the app is restarted. The page itself never scrolls.
function resetViewport() {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0;
  if (document.body.scrollTop) document.body.scrollTop = 0;
}

function showImportResult(s) {
  const sh = sheet({ title: 'Import complete', left: null, right: 'Done', onRight: () => sh.close(), instant: true });
  const row = (label, v, ic) => h('div.row', icon(ic, 'sm ic'), h('div.grow', label), h('b.num', String(v)));
  sh.body.append(
    h('div.center', { style: { padding: '8px 0 18px' } },
      h('div.empty', h('div.art', icon('check')), h('h3', `${s.notesAdded} new note${s.notesAdded === 1 ? '' : 's'}`),
        h('p', s.files > 1 ? `${s.files - s.failed.length} of ${s.files} files imported`
          : s.decks.length ? s.decks.slice(0, 6).join(' · ') + (s.decks.length > 6 ? ' …' : '') : 'Your collection is up to date.'))),
    h('div.list', row('Notes added', s.notesAdded, 'plus'), s.notesUpdated ? row('Notes updated', s.notesUpdated, 'reset') : null,
      s.notesUnchanged ? row('Already in collection', s.notesUnchanged, 'check') : null, row('Cards added', s.cardsAdded, 'layers'),
      row('Media files', s.mediaFiles, 'image'), s.notetypesAdded ? row('Note types added', s.notetypesAdded, 'note') : null),
    s.failed.length ? h('p.small', { style: { marginTop: '12px', color: 'var(--danger)' } }, `Couldn’t import: ${s.failed.join(' · ')}`) : '',
    s.warnings.length ? h('p.small.muted', { style: { marginTop: '12px' } }, [...new Set(s.warnings)].join(' ')) : '',
    h('button.btn.primary', { style: { marginTop: '18px' }, onclick: () => { sh.close(); navigate('/decks'); } }, 'Start studying'));
}

export async function exportDeck(deckId, { includeScheduling = true, includeMedia = true } = {}) {
  const deck = deckId ? app.col.deck(deckId) : null;
  const name = (deck ? deck.name.replace(/::/g, ' - ') : `Flashcards backup ${new Date().toISOString().slice(0, 10)}`).replace(/[\/\\:*?"<>|]/g, '_');
  const p = progress('Exporting…');
  try {
    await app.col.flush();
    const blob = await exportPackage(app.col, deckId, { includeScheduling, includeMedia, onProgress: (m, f) => p.update(m, f) });
    p.close();
    await shareOrDownload(blob, `${name}.apkg`);
  } catch (e) {
    p.close();
    toast(`Export failed: ${e.message || e}`);
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  const root = document.getElementById('app');
  root.append(h('div', { style: { flex: 1, display: 'grid', placeItems: 'center' } }, h('div.spinner')));
  try {
    app.col = await Collection.load();
  } catch (e) {
    clear(root, h('div.view', h('div.view-inner', h('div.card.pad', { style: { marginTop: '40px' } }, h('h3', 'Storage unavailable'),
      h('p.muted', `This browser blocked on-device storage (${e.message || e}). Private browsing modes don't allow saving decks.`)))));
    return;
  }
  clear(root, stage, tabbar, fileInput);
  window.addEventListener('hashchange', render);
  // keep data safe when the app is backgrounded
  // (coming back refreshes the due counts, but not the note type editor, which holds unsaved edits)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { app.col.flush(); return; }
    resetViewport();
    if (route().name !== 'notetype') render();
  });
  window.addEventListener('focus', resetViewport);
  window.addEventListener('pagehide', () => app.col.flush());
  // drag & drop import (desktop)
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) importFiles([...e.dataTransfer.files]);
  });
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  window.__app = app; // handy for debugging
}

boot();
