// Settings, note type manager.
import { h, clear, icon, switchEl, segmented, confirmDialog, promptDialog, toast, progress, actionSheet } from './dom.js';
import { app, savePrefs, navigate, pickImportFile, exportDeck } from './app.js';
import { stockNotetypes } from '../core/stock.js';
import { fieldReferences } from '../core/template.js';

export function settingsView(root) {
  const col = app.col;
  root.append(h('div.topbar'), h('h1.large', 'Settings'));
  const storageEl = h('span.muted.small', '…');

  root.append(
    h('h2.section', 'Scheduling'),
    h('div.list.form',
      h('div.row', h('div.grow', h('div', 'FSRS'), h('div.sub', { style: { whiteSpace: 'normal' } }, 'Modern scheduler from Anki 23.10+. Off uses Anki’s classic SM-2.')),
        switchEl(col.fsrs, (v) => {
          col.fsrs = v;
          if (v) { const p = progress('Computing memory states…'); setTimeout(() => { col.recomputeMemoryStates(); p.close(); toast('FSRS enabled'); }, 30); }
        })),
      h('div.row', h('label', 'Next day starts at'), h('select', { onchange: (e) => { col.rollover = Number(e.target.value); } },
        Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: col.rollover === i }, `${String(i).padStart(2, '0')}:00`)))),
      h('div.row', h('label', 'Learn ahead limit'), h('select', { onchange: (e) => { col.learnAhead = Number(e.target.value) * 60; } },
        [0, 5, 10, 20, 30, 45, 60, 90, 120].map((m) => h('option', { value: m, selected: col.learnAhead === m * 60 }, `${m} min`))))),

    h('h2.section', 'Review'),
    h('div.list.form',
      h('div.row', h('label', 'Tap card to show answer'), switchEl(app.prefs.tapToReveal, (v) => { app.prefs.tapToReveal = v; savePrefs(); })),
      h('div.row', h('label', 'Show intervals on buttons'), switchEl(app.prefs.showIntervals, (v) => { app.prefs.showIntervals = v; savePrefs(); }))),

    h('h2.section', 'Appearance'),
    h('div.card.pad', segmented([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], app.prefs.theme, (v) => { app.prefs.theme = v; savePrefs(); })),

    h('h2.section', 'Note types'),
    h('div.list', h('button.row.tap', { onclick: () => navigate('/notetypes') }, icon('note', 'sm ic'), h('div.grow', 'Manage note types'), icon('right', 'sm chev'))),

    h('h2.section', 'Data'),
    h('div.list',
      h('button.row.tap', { onclick: pickImportFile }, icon('import', 'sm ic'), h('div.grow', 'Import .apkg / .colpkg'), icon('right', 'sm chev')),
      h('button.row.tap', { onclick: () => exportDeck(null) }, icon('share', 'sm ic'), h('div.grow', h('div', 'Back up everything'), h('div.sub', 'Exports all decks with progress and media as .apkg')), icon('right', 'sm chev')),
      h('button.row.tap', { onclick: () => { const p = col.checkDatabase(); toast(p.length ? p.join(' ') : 'No problems found'); } }, icon('database', 'sm ic'), h('div.grow', 'Check database')),
      h('div.row', icon('layers', 'sm ic'), h('div.grow', 'Storage used'), storageEl),
      h('button.row.tap.danger', { onclick: erase }, icon('trash', 'sm ic'), h('div.grow', 'Erase all data'))),
    h('p.hint', 'Your decks, progress and media are stored only on this device, in this browser. Back up regularly, especially before clearing Safari website data.'),
    h('p.small.muted.center', { style: { marginTop: '24px' } }, `Flashcards · ${col.cards.size.toLocaleString()} cards · ${col.notes.size.toLocaleString()} notes`));

  navigator.storage?.estimate?.().then(async (e) => {
    const persisted = await navigator.storage.persisted?.().catch(() => false);
    storageEl.textContent = `${(e.usage / 1048576).toFixed(1)} MB${persisted ? ' · persistent' : ''}`;
  }).catch(() => { storageEl.textContent = '—'; });
}

async function erase() {
  if (!await confirmDialog('Erase all data?', 'This permanently deletes all decks, cards, review history and media on this device.', { ok: 'Erase', danger: true })) return;
  if (!await confirmDialog('Are you sure?', 'Consider backing up first. This cannot be undone.', { ok: 'Erase everything', danger: true })) return;
  app.col = await app.col.eraseEverything();
  location.hash = '#/decks';
  location.reload();
}

// ---------------------------------------------------------------- note types

export function notetypesView(root) {
  const col = app.col;
  root.append(h('div.topbar',
    h('button.back', { onclick: () => navigate('/settings') }, icon('left'), 'Settings'),
    h('button.icon-btn.accent', { 'aria-label': 'Add note type', onclick: add }, icon('plus'))),
  h('h1.large', 'Note types'));
  root.append(h('div.list', col.allNotetypes().map((nt) => h('button.row.tap', { onclick: () => navigate(`/notetype/${nt.id}`) },
    h('div.grow', h('div', nt.name), h('div.sub', `${col.noteCount(nt.id)} notes · ${nt.type === 1 ? 'Cloze' : `${nt.tmpls.length} card type${nt.tmpls.length === 1 ? '' : 's'}`}`)),
    icon('right', 'sm chev')))));

  async function add() {
    const base = await actionSheet('Start from', [...stockNotetypes(0).map((s) => ({ label: s.name, value: s.name })),
      ...col.allNotetypes().map((n) => ({ label: `Clone: ${n.name}`, value: `id:${n.id}` }))]);
    if (!base) return;
    const name = await promptDialog('Name', { value: base.startsWith('id:') ? `${col.notetype(Number(base.slice(3))).name} copy` : base, ok: 'Add' });
    if (!name?.trim()) return;
    const src = base.startsWith('id:') ? col.notetype(Number(base.slice(3))) : stockNotetypes(0).find((s) => s.name === base);
    const nt = JSON.parse(JSON.stringify(src));
    nt.id = col.newId(col.notetypes);
    nt.name = name.trim();
    nt.mod = col.now;
    col.saveNotetype(nt);
    navigate(`/notetype/${nt.id}`);
  }
}

export function notetypeEditorView(root, id) {
  const col = app.col;
  const original = col.notetype(id);
  if (!original) { navigate('/notetypes'); return; }
  const nt = JSON.parse(JSON.stringify(original));
  const fieldOps = []; // [{op:'add'}|{op:'del', idx}] applied to notes on save
  let tIdx = 0;
  const body = h('div');
  root.append(h('div.topbar',
    h('button.back', { onclick: () => navigate('/notetypes') }, icon('left'), 'Note types'),
    h('button.btn.tinted', { onclick: save }, 'Save')),
  h('h1.large', nt.name), body);

  function render() {
    clear(body,
      h('h2.section', 'Name'),
      h('div.card', h('input', { type: 'text', value: nt.name, style: { width: '100%', background: 'transparent' }, oninput: (e) => { nt.name = e.target.value; } })),
      h('h2.section', 'Fields'),
      h('div.list.form', nt.flds.map((f, i) => h('div.row',
        h('input', { type: 'text', value: f.name, style: { flex: 1, background: 'transparent', padding: '6px 0' }, onchange: (e) => renameField(i, e.target.value) }),
        h('span.small.muted', 'Sticky'), switchEl(f.sticky, (v) => { f.sticky = v; }),
        nt.flds.length > 1 ? h('button.more-btn', { 'aria-label': 'Delete field', onclick: () => deleteField(i) }, icon('trash', 'sm')) : null)),
        h('button.row.tap', { onclick: addField }, icon('plus', 'sm ic'), h('div.grow', 'Add field')),
        h('div.row', h('label', 'Sort field'), h('select', { onchange: (e) => { nt.sortf = Number(e.target.value); } },
          nt.flds.map((f, i) => h('option', { value: i, selected: nt.sortf === i }, f.name))))),
      h('p.hint', 'Sticky fields keep their content after adding a note. Renaming a field updates the templates.'),
      h('h2.section', 'Card templates'),
      nt.tmpls.length > 1 ? h('div.card.pad', { style: { marginBottom: '10px' } }, segmented(nt.tmpls.map((t, i) => [i, t.name]), tIdx, (v) => { tIdx = v; render(); })) : null,
      h('div.field', h('div.lbl', 'Front template'), h('textarea.code', { value: nt.tmpls[tIdx].qfmt, spellcheck: 'false', autocapitalize: 'off', oninput: (e) => { nt.tmpls[tIdx].qfmt = e.target.value; } })),
      h('div.field', h('div.lbl', 'Back template'), h('textarea.code', { value: nt.tmpls[tIdx].afmt, spellcheck: 'false', autocapitalize: 'off', oninput: (e) => { nt.tmpls[tIdx].afmt = e.target.value; } })),
      nt.type === 0 ? h('div.btn-row', { style: { marginBottom: '8px' } },
        h('button.btn.tinted', { onclick: addTemplate }, icon('plus', 'sm'), 'Add card type'),
        nt.tmpls.length > 1 ? h('button.btn.danger', { onclick: deleteTemplate }, icon('trash', 'sm'), 'Delete card type') : null) : null,
      h('h2.section', 'Styling (CSS)'),
      h('div.field', h('textarea.code', { value: nt.css, spellcheck: 'false', autocapitalize: 'off', oninput: (e) => { nt.css = e.target.value; } })),
      h('div.btn-row', { style: { marginTop: '10px' } },
        h('button.btn.primary', { onclick: save }, 'Save changes')),
      h('div', { style: { marginTop: '22px' } }, h('button.btn.danger.block', { onclick: del }, icon('trash', 'sm'), 'Delete note type')));
  }

  function renameField(i, name) {
    name = name.trim();
    const old = nt.flds[i].name;
    if (!name || name === old) return render();
    if (nt.flds.some((f, j) => j !== i && f.name === name)) { toast('A field with that name exists'); return render(); }
    nt.flds[i].name = name;
    const esc = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\{\\{([#^/]?)((?:[^}:]*:)*)${esc}\\}\\}`, 'g');
    for (const t of nt.tmpls) { t.qfmt = t.qfmt.replace(re, `{{$1$2${name}}}`); t.afmt = t.afmt.replace(re, `{{$1$2${name}}}`); }
    render();
  }
  async function addField() {
    const name = await promptDialog('New field', { ok: 'Add' });
    if (!name?.trim() || nt.flds.some((f) => f.name === name.trim())) return;
    nt.flds.push({ name: name.trim(), ord: nt.flds.length, sticky: false, rtl: false, font: 'Arial', size: 20, description: '' });
    fieldOps.push({ op: 'add' });
    render();
  }
  async function deleteField(i) {
    const used = nt.tmpls.some((t) => [...fieldReferences(t.qfmt), ...fieldReferences(t.afmt)].some((r) => r.field === nt.flds[i].name));
    if (!await confirmDialog(`Delete field “${nt.flds[i].name}”?`, `Its contents will be removed from all notes${used ? ' and the templates that use it will show an error until you edit them' : ''}.`, { ok: 'Delete', danger: true })) return;
    nt.flds.splice(i, 1);
    nt.flds.forEach((f, j) => { f.ord = j; });
    if (nt.sortf >= nt.flds.length) nt.sortf = 0;
    fieldOps.push({ op: 'del', idx: i });
    render();
  }
  function addTemplate() {
    const n = nt.tmpls.length + 1;
    const front = nt.flds[1]?.name || nt.flds[0].name;
    nt.tmpls.push({ name: `Card ${n}`, ord: n - 1, qfmt: `{{${front}}}`, afmt: `{{FrontSide}}\n\n<hr id=answer>\n\n{{${nt.flds[0].name}}}`, bqfmt: '', bafmt: '', did: null });
    tIdx = n - 1;
    render();
  }
  async function deleteTemplate() {
    const t = nt.tmpls[tIdx];
    const count = [...col.cards.values()].filter((c) => c.ord === t.ord && col.note(c.nid)?.mid === nt.id).length;
    if (!await confirmDialog(`Delete “${t.name}”?`, `${count} cards using it will be deleted when you save.`, { ok: 'Delete', danger: true })) return;
    nt._deletedOrds = [...(nt._deletedOrds || []), t.ord];
    nt.tmpls.splice(tIdx, 1);
    tIdx = 0;
    render();
  }

  function save() {
    const deletedOrds = nt._deletedOrds || [];
    delete nt._deletedOrds;
    // remap template ords
    const ordMap = new Map();
    nt.tmpls.forEach((t, i) => { ordMap.set(t.ord, i); t.ord = i; });
    nt.mod = col.now;
    col.saveNotetype(nt);
    const notes = [...col.notes.values()].filter((n) => n.mid === nt.id);
    for (const n of notes) {
      for (const op of fieldOps) {
        if (op.op === 'add') n.flds.push('');
        else n.flds.splice(op.idx, 1);
      }
      for (const c of col.cardsOfNote(n.id)) {
        if (nt.type === 1) continue;
        if (deletedOrds.includes(c.ord)) col.deleteCards([c.id]);
        else if (ordMap.has(c.ord) && ordMap.get(c.ord) !== c.ord) { c.ord = ordMap.get(c.ord); col.saveCard(c); }
      }
      if (col.notes.has(n.id)) col.updateNote(n);
    }
    fieldOps.length = 0;
    toast('Saved');
    navigate('/notetypes');
  }

  async function del() {
    const count = col.noteCount(nt.id);
    if (!await confirmDialog(`Delete “${nt.name}”?`, `This also deletes its ${count} notes and their cards.`, { ok: 'Delete', danger: true })) return;
    col.deleteNotetype(nt.id);
    toast('Deleted');
    navigate('/notetypes');
  }

  render();
}
