// Tiny DOM toolkit: element builder, icons, sheets, dialogs, toasts.

export function h(tag, props, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = name === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(name || 'div');
  for (const part of rest) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else if (part[0] === '#') el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { children.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') String(v).split(' ').filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'ref') v(el);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) { el.replaceChildren(); append(el, children); return el; }

// ---------------------------------------------------------------- icons (feather/lucide-style strokes)
const ICONS = {
  stack: '<rect x="3" y="8" width="18" height="13" rx="3"/><path d="M6 4.5h12M8.5 1.5h7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  flag: '<path d="M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/>',
  pause: '<circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.6 1.2 2.8 2.5 2.8z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  sort: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  folderplus: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2zM12 11v6M9 14h6"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
  brackets: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `i ${cls}`.trim());
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

// ---------------------------------------------------------------- overlays

/** Remove an overlay after a short closing animation (instantly if motion is reduced). */
export function dismiss(el) {
  if (!el.isConnected || el.classList.contains('leaving')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }
  el.classList.add('leaving');
  let gone = false;
  const rm = () => { if (!gone) { gone = true; el.remove(); } };
  el.addEventListener('animationend', (e) => { if (e.target === el) rm(); });
  setTimeout(rm, 400);
}

/** Bottom sheet. Returns {el, body, close}. */
export function sheet({ title, left = 'Cancel', right = null, onRight = null, onClose = null, full = false } = {}) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dismiss(backdrop);
    onClose?.();
  };
  const rightBtn = right ? h('button.txt-btn.right', { onclick: () => onRight?.() }, right) : h('span', { style: { minWidth: '60px' } });
  const body = h('div.sheet-body');
  const el = h(`div.sheet${full ? '.full' : ''}`, { onclick: (e) => e.stopPropagation() },
    h('div.grabber'),
    h('div.sheet-head', left ? h('button.txt-btn', { onclick: close }, left) : h('span', { style: { minWidth: '60px' } }), h('h3', title || ''), rightBtn),
    body);
  const backdrop = h('div.backdrop', { onclick: close }, el);
  document.body.appendChild(backdrop);
  return { el, body, close, rightBtn, setTitle: (t) => { el.querySelector('h3').textContent = t; } };
}

export function actionSheet(title, actions) {
  return new Promise((resolve) => {
    const done = (v) => { dismiss(backdrop); resolve(v); };
    const group = h('div.group', title ? h('div.title', title) : null,
      actions.filter(Boolean).map((a) => h(`button${a.danger ? '.danger' : ''}`, { onclick: () => { done(a.value ?? a.label); a.run?.(); } },
        a.icon ? icon(a.icon, 'sm') : null, a.label)));
    const backdrop = h('div.backdrop', { onclick: () => done(null) },
      h('div.action-sheet', { onclick: (e) => e.stopPropagation() }, group, h('div.group', h('button.cancel', { onclick: () => done(null) }, 'Cancel'))));
    document.body.appendChild(backdrop);
  });
}

export function confirmDialog(title, message, { ok = 'OK', danger = false, cancel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { dismiss(wrap); resolve(v); };
    const wrap = h('div.backdrop.dialog-wrap', h('div.dialog', h('h3', title), message ? h('p', message) : null,
      h('div.btn-row', cancel ? h('button.btn', { onclick: () => done(false) }, cancel) : null,
        h(`button.btn${danger ? '.danger' : '.tinted'}`, { onclick: () => done(true) }, ok))));
    document.body.appendChild(wrap);
  });
}

export function promptDialog(title, { value = '', placeholder = '', ok = 'OK', message = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value, placeholder, autocapitalize: 'off', onkeydown: (e) => { if (e.key === 'Enter') done(input.value); } });
    const done = (v) => { dismiss(wrap); resolve(v); };
    const wrap = h('div.backdrop.dialog-wrap', h('div.dialog', h('h3', title), message ? h('p', message) : null, input,
      h('div.btn-row', h('button.btn', { onclick: () => done(null) }, 'Cancel'), h('button.btn.tinted', { onclick: () => done(input.value) }, ok))));
    document.body.appendChild(wrap);
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

export function toast(text) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div.toast', text);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2300);
}

/** Blocking progress overlay. */
export function progress(message) {
  const label = h('div.small.muted', message);
  const fill = h('div');
  const bar = h('div.bar', fill);
  const box = h('div.progress-box', h('div.spinner'), bar, label);
  const wrap = h('div.backdrop.dialog-wrap', box);
  document.body.appendChild(wrap);
  return {
    update(msg, frac) { if (msg) label.textContent = msg; if (frac !== undefined && frac !== null) fill.style.width = `${Math.round(frac * 100)}%`; },
    close() { wrap.remove(); },
  };
}

export function switchEl(checked, onchange) {
  return h('label.switch', h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span'));
}

export function segmented(options, value, onchange) {
  const el = h('div.segmented');
  const render = (v) => clear(el, options.map(([val, label]) => h(`button${val === v ? '.on' : ''}`, { onclick: () => { render(val); onchange(val); } }, label)));
  render(value);
  return el;
}

export function countsPills(counts) {
  const p = (v, cls) => h(`span.pill.${v ? cls : 'zero'}`, String(v));
  return h('div.counts', p(counts.new, 'new'), p(counts.learning, 'learn'), p(counts.review, 'review'));
}

/** Auto-growing textarea. */
export function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return ta;
}

export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
