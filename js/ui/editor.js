// Add / edit notes.
import { h, clear, icon, sheet, toast, autoGrow, segmented } from './dom.js';
import { app, isDark, savePrefs } from './app.js';
import { Cloze } from '../core/template.js';
import { fieldIsEmpty } from '../core/util.js';
import { CardFrame } from './cardframe.js';

const toEditable = (s) => String(s).replace(/<br\s*\/?>/gi, '\n');
const toHTML = (s) => String(s).replace(/\n/g, '<br>');

/** opts: { note } to edit, or { deckId } to add. onSaved called after saving. */
export function openEditor({ note = null, deckId = null, onSaved = null } = {}) {
  const col = app.col;
  const editing = !!note;
  const notetypes = col.allNotetypes();
  const decks = col.allDecks();
  let mid = editing ? note.mid : (notetypes.find((n) => n.id === app.prefs.lastNotetype) || notetypes.find((n) => n.name === 'Basic') || notetypes[0])?.id;
  let did = deckId ?? (decks.find((d) => d.id === app.prefs.lastDeck)?.id ?? decks[0]?.id ?? 1);
  // fields that already contain raw new lines are edited verbatim so their HTML is preserved
  const verbatim = new Set(editing ? note.flds.map((f, i) => (f.includes('\n') ? i : -1)).filter((i) => i >= 0) : []);
  let fields = editing ? note.flds.map((f, i) => (verbatim.has(i) ? f : toEditable(f))) : [];
  let tags = editing ? note.tags.join(' ') : (sessionStorage.getItem('lastTags') || '');
  let lastFocus = 0, added = 0;

  const sh = sheet({ title: editing ? 'Edit note' : 'Add note', right: editing ? 'Save' : 'Add', onRight: save, full: true });
  const body = sh.body;
  const fileInput = h('input.hidden', { type: 'file', accept: 'image/*,audio/*,video/*', onchange: (e) => attach(e.target.files[0]) });
  body.append(fileInput);
  const content = h('div');
  body.append(content);

  const nt = () => col.notetype(mid);
  const buildNote = () => {
    const base = editing ? { ...note } : { id: 0, guid: '', mid, tags: [], flds: [] };
    base.mid = mid;
    base.flds = fields.map((f, i) => (verbatim.has(i) ? f : toHTML(f)));
    base.tags = tags.split(/[\s　]+/).filter(Boolean);
    return base;
  };

  function render() {
    const t = nt();
    if (!t) { clear(content, h('p', 'No note types.')); return; }
    while (fields.length < t.flds.length) fields.push('');
    const dupe = !editing && col.isDuplicate(buildNote());
    clear(content,
      editing ? null : h('div.list.form', { style: { marginBottom: '16px' } },
        h('div.row', h('label', 'Type'), h('select', { onchange: (e) => { mid = Number(e.target.value); app.prefs.lastNotetype = mid; savePrefs(); render(); } },
          notetypes.map((n) => h('option', { value: n.id, selected: n.id === mid }, n.name)))),
        h('div.row', h('label', 'Deck'), h('select', { onchange: (e) => { did = Number(e.target.value); app.prefs.lastDeck = did; savePrefs(); } },
          decks.map((d) => h('option', { value: d.id, selected: d.id === did }, d.name))))),
      t.flds.map((f, i) => h('div.field',
        h('div.lbl', f.name, f.sticky ? icon('target', 'xs') : null, i === 0 && dupe ? h('span.warn', 'Duplicate') : null),
        autoGrow(h('textarea', {
          rows: 2, placeholder: f.description || f.name, value: fields[i] ?? '', 'data-idx': i,
          onfocus: () => { lastFocus = i; },
          oninput: (e) => { fields[i] = e.target.value; if (i === 0 && !editing) updateDupe(); },
        })))),
      h('div.toolbar',
        t.type === 1 ? h('button.btn.tinted', { onclick: () => cloze(false) }, icon('brackets', 'sm'), 'Cloze') : null,
        t.type === 1 ? h('button.btn.tinted', { onclick: () => cloze(true) }, 'Same #') : null,
        h('button.btn.tinted', { onclick: () => fileInput.click() }, icon('image', 'sm'), 'Attach'),
        h('button.btn.tinted', { onclick: preview }, icon('eye', 'sm'), 'Preview')),
      h('div.field', h('div.lbl', 'Tags'), h('textarea', { rows: 1, placeholder: 'Separate tags with spaces', value: tags, autocapitalize: 'off',
        oninput: (e) => { tags = e.target.value; } })),
      t.type === 1 ? h('p.hint', 'Wrap text in {{c1::…}} to hide it. Use c2, c3… for more cards.') : h('p.hint', 'Fields support HTML. New lines become line breaks.'));
    if (!editing) setTimeout(() => content.querySelector('textarea')?.focus(), 80);
  }

  function updateDupe() {
    const lbl = content.querySelector('.field .lbl');
    lbl?.querySelector('.warn')?.remove();
    if (col.isDuplicate(buildNote())) lbl?.append(h('span.warn', 'Duplicate'));
  }

  function cloze(same) {
    const ta = content.querySelector(`textarea[data-idx="${lastFocus}"]`) || content.querySelector('textarea[data-idx]');
    if (!ta) return;
    const idx = Number(ta.dataset.idx);
    const max = Math.max(0, ...Cloze.ordinals(fields.join(' ')));
    const n = same ? Math.max(max, 1) : max + 1;
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
    const sel = ta.value.slice(s, e);
    ta.value = `${ta.value.slice(0, s)}{{c${n}::${sel}}}${ta.value.slice(e)}`;
    fields[idx] = ta.value;
    ta.focus();
    const caret = s + `{{c${n}::`.length + sel.length;
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event('input'));
  }

  async function attach(file) {
    fileInput.value = '';
    if (!file) return;
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const name = await col.addMedia(file, `paste-${Date.now().toString(36)}.${ext}`);
      const tag = file.type.startsWith('image/') ? `<img src="${name}">` : `[sound:${name}]`;
      const idx = Math.min(lastFocus, fields.length - 1);
      fields[idx] = (fields[idx] || '') + tag;
      render();
      toast('Attached');
    } catch (e) { toast(e.message); }
  }

  function preview() {
    const t = nt();
    const n = buildNote();
    const ords = col.generatedOrds(n.flds, t);
    if (!ords.length) { toast('This note would not create any cards yet.'); return; }
    let ord = ords[0], back = false;
    const p = sheet({ title: 'Preview', left: 'Close', full: true });
    const frame = new CardFrame(col, { onTap: () => { back = !back; show(); seg2.replaceWith(seg2 = side()); } });
    const wrap = h('div.card-frame-wrap', { style: { margin: '0', height: 'calc(100dvh - 210px)' } }, frame.el);
    const show = () => {
      const r = col.renderNote(n, t, ord, { did });
      frame.show(back ? r.answer : r.question, r.css, `card card${ord + 1}${isDark() ? ' nightMode night_mode' : ''}`, false);
    };
    const side = () => segmented([[false, 'Front'], [true, 'Back']], back, (v) => { back = v; show(); });
    let seg2 = side();
    p.body.append(
      ords.length > 1 ? h('div', { style: { marginBottom: '8px' } }, segmented(ords.map((o) => [o, t.type === 1 ? `Cloze ${o + 1}` : t.tmpls.find((x) => x.ord === o)?.name || `Card ${o + 1}`]), ord, (v) => { ord = v; show(); })) : null,
      h('div', { style: { marginBottom: '10px' } }, seg2), wrap);
    const obs = new MutationObserver(() => { if (!p.el.isConnected) { frame.destroy(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
    show();
  }

  function save() {
    const n = buildNote();
    if (n.flds.every((f) => fieldIsEmpty(f))) { toast('The note is empty.'); return; }
    try {
      if (editing) {
        col.updateNote(n);
        toast('Saved');
        sh.close();
      } else {
        col.addNote(n, did);
        added++;
        sessionStorage.setItem('lastTags', tags);
        const t = nt();
        fields = fields.map((v, i) => (t.flds[i]?.sticky ? v : ''));
        toast(`Added${added > 1 ? ` (${added})` : ''}`);
        render();
      }
      onSaved?.();
      app.rerender();
    } catch (e) { toast(e.message); }
  }

  render();
}
