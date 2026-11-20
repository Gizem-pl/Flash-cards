// Deck options presets — the same settings as Anki's deck options screen.
import { h, clear, icon, sheet, switchEl, promptDialog, confirmDialog, toast, actionSheet } from './dom.js';
import { app } from './app.js';
import { DEFAULT_CONFIG } from '../core/scheduler.js';

export function parseSteps(s) {
  const out = [];
  for (const part of String(s).split(/[\s,]+/).filter(Boolean)) {
    const m = part.match(/^(\d+(?:\.\d+)?)([smhd]?)$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!(n > 0)) return null;
    out.push({ s: n / 60, m: n, h: n * 60, d: n * 1440, '': n }[m[2].toLowerCase()]);
  }
  return out;
}
export function formatSteps(steps) {
  const f = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
  return (steps || []).map((m) => {
    if (m < 1) return `${f(m * 60)}s`;
    if (m >= 1440 && Number.isInteger(m / 1440)) return `${f(m / 1440)}d`;
    if (m >= 60 && Number.isInteger(m / 60)) return `${f(m / 60)}h`;
    return `${f(m)}m`;
  }).join(' ');
}

export function openDeckOptions(deckId) {
  const col = app.col;
  const deck = col.deck(deckId);
  let cfg = { ...col.configForDeck(deckId) };
  const sh = sheet({ title: deck.name.split('::').pop(), right: 'Save', onRight: save, full: true });
  const content = h('div');
  sh.body.append(content);

  const num = (label, key, min, max, step = 1) => h('div.row', h('label', label), h('input', {
    type: 'number', inputmode: step < 1 ? 'decimal' : 'numeric', min, max, step, value: cfg[key],
    onchange: (e) => { let v = parseFloat(e.target.value); if (!Number.isFinite(v)) v = DEFAULT_CONFIG[key]; v = Math.min(Math.max(v, min), max); cfg[key] = v; e.target.value = v; },
  }));
  const steps = (label, key) => h('div.row', h('label', label), h('input.steps', {
    type: 'text', value: formatSteps(cfg[key]), autocapitalize: 'off', placeholder: 'none',
    oninput: (e) => { const v = parseSteps(e.target.value); e.target.classList.toggle('bad', v === null); if (v) cfg[key] = v; },
  }));
  const toggle = (label, key) => h('div.row', h('label', label), switchEl(cfg[key], (v) => { cfg[key] = v; }));
  const select = (label, key, options) => h('div.row', h('label', label), h('select', { onchange: (e) => { cfg[key] = Number(e.target.value); } },
    options.map(([v, t]) => h('option', { value: v, selected: cfg[key] === v }, t))));
  const mixOpts = [[0, 'Mix with reviews'], [1, 'After reviews'], [2, 'Before reviews']];

  function render() {
    const users = col.allDecks().filter((d) => d.conf === cfg.id).length;
    clear(content,
      h('div.list.form',
        h('div.row', h('label', 'Preset'), h('select', { onchange: (e) => switchPreset(Number(e.target.value)) },
          col.allConfigs().map((c) => h('option', { value: c.id, selected: c.id === cfg.id }, c.name)))),
        h('button.row.tap', { onclick: managePresets }, icon('sliders', 'sm ic'), h('div.grow', 'Manage presets'), icon('right', 'sm chev'))),
      h('p.hint', users > 1 ? `This preset is shared by ${users} decks.` : 'Presets can be shared between decks.'),

      h('h2.section', 'Daily limits'),
      h('div.list.form', num('New cards/day', 'newPerDay', 0, 9999), num('Maximum reviews/day', 'reviewsPerDay', 0, 99999),
        toggle('New cards ignore review limit', 'newIgnoreReviewLimit')),

      h('h2.section', 'New cards'),
      h('div.list.form', steps('Learning steps', 'learnSteps'),
        col.fsrs ? null : num('Graduating interval (days)', 'graduatingInterval', 1, 365),
        col.fsrs ? null : num('Easy interval (days)', 'easyInterval', 1, 365),
        select('Insertion order', 'newOrder', [[0, 'Sequential'], [1, 'Random']])),
      h('p.hint', 'Steps use s, m, h or d, e.g. “1m 10m 1d”.'),

      h('h2.section', 'Lapses'),
      h('div.list.form', steps('Relearning steps', 'relearnSteps'), num('Minimum interval (days)', 'minimumLapseInterval', 1, 365),
        num('Leech threshold', 'leechThreshold', 1, 99), select('Leech action', 'leechAction', [[0, 'Suspend card'], [1, 'Tag only']])),

      h('h2.section', 'Display order'),
      h('div.list.form', select('New / review order', 'newMix', mixOpts), select('Interday learning order', 'interdayMix', mixOpts)),

      h('h2.section', 'Burying'),
      h('div.list.form', toggle('Bury new siblings', 'buryNew'), toggle('Bury review siblings', 'buryReviews'), toggle('Bury interday learning siblings', 'buryInterday')),

      h('h2.section', 'Audio & timer'),
      h('div.list.form', toggle('Play audio automatically', 'autoplay'), toggle('Replay question audio with answer', 'replayQuestion'),
        num('Maximum answer seconds', 'maxAnswerSecs', 10, 600)),

      col.fsrs ? [
        h('h2.section', 'FSRS'),
        h('div.list.form', num('Desired retention', 'desiredRetention', 0.7, 0.99, 0.01),
          h('div.row.stack', h('label', 'Parameters'), h('textarea.code', { style: { minHeight: '70px' }, placeholder: 'Default parameters', value: (cfg.fsrsParams || []).join(', '),
            oninput: (e) => { const p = e.target.value.split(/[\s,]+/).filter(Boolean).map(Number); cfg.fsrsParams = [17, 19, 21].includes(p.length) && p.every(Number.isFinite) ? p : []; } }))),
        h('p.hint', 'Paste parameters optimised in Anki desktop (17, 19 or 21 numbers), or leave empty for the defaults.'),
      ] : null,

      h('h2.section', 'Advanced'),
      h('div.list.form', num('Maximum interval (days)', 'maximumInterval', 1, 36500),
        col.fsrs ? null : [num('Starting ease', 'startingEase', 1.31, 5, 0.01), num('Easy bonus', 'easyBonus', 1, 5, 0.01),
          num('Interval modifier', 'intervalModifier', 0.5, 2, 0.01), num('Hard interval', 'hardInterval', 0.5, 1.3, 0.01), num('New interval', 'newInterval', 0, 1, 0.01)]));
  }

  function switchPreset(id) {
    col.saveConfig(cfg);
    cfg = { ...DEFAULT_CONFIG, ...col.config(id) };
    render();
  }

  async function managePresets() {
    await actionSheet('Presets', [
      { label: 'Add preset', icon: 'plus', run: async () => {
        const name = await promptDialog('New preset', { ok: 'Add' });
        if (!name?.trim()) return;
        col.saveConfig(cfg);
        cfg = { ...col.addConfig(name.trim()) };
        render();
      } },
      { label: 'Clone preset', icon: 'layers', run: async () => {
        const name = await promptDialog('Clone preset', { value: `${cfg.name} copy`, ok: 'Clone' });
        if (!name?.trim()) return;
        cfg = { ...col.addConfig(name.trim(), cfg) };
        render();
      } },
      { label: 'Rename preset', icon: 'edit', run: async () => {
        const name = await promptDialog('Rename preset', { value: cfg.name, ok: 'Rename' });
        if (name?.trim()) { cfg.name = name.trim(); render(); }
      } },
      cfg.id !== 1 ? { label: 'Delete preset', icon: 'trash', danger: true, run: async () => {
        if (!await confirmDialog(`Delete “${cfg.name}”?`, 'Decks using it will switch to the Default preset.', { ok: 'Delete', danger: true })) return;
        col.deleteConfig(cfg.id);
        cfg = { ...col.configForDeck(deckId) };
        render();
      } } : null,
    ]);
  }

  function save() {
    const old = col.config(cfg.id);
    col.saveConfig(cfg);
    if (deck.conf !== cfg.id) { deck.conf = cfg.id; col.saveDeck(deck); }
    if (col.fsrs && JSON.stringify(old?.fsrsParams || []) !== JSON.stringify(cfg.fsrsParams || [])) col.recomputeMemoryStates();
    toast('Options saved');
    sh.close();
    app.rerender();
  }

  render();
}
