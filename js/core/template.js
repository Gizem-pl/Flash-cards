// Anki card template engine.
import { stripHTML, escapeHTML, fieldIsEmpty, decodeEntities, sha1Hex } from './util.js';

// ---------------------------------------------------------------- cloze

function clozeTokenize(s) {
  const tokens = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { tokens.push({ t: 'text', v: buf }); buf = ''; } };
  while (i < s.length) {
    if (s.startsWith('{{c', i)) {
      let j = i + 3, digits = '';
      while (j < s.length && s[j] >= '0' && s[j] <= '9') digits += s[j++];
      if (digits && s.startsWith('::', j)) {
        flush();
        tokens.push({ t: 'open', n: parseInt(digits, 10), raw: s.slice(i, j + 2) });
        i = j + 2;
        continue;
      }
    }
    if (s.startsWith('}}', i)) { flush(); tokens.push({ t: 'close' }); i += 2; continue; }
    buf += s[i++];
  }
  flush();
  return tokens;
}

function clozeParse(s) {
  const stack = [{ ord: 0, raw: '', children: [] }];
  for (const t of clozeTokenize(s)) {
    const top = stack[stack.length - 1];
    if (t.t === 'text') top.children.push({ text: t.v });
    else if (t.t === 'open') stack.push({ ord: t.n, raw: t.raw, children: [] });
    else if (stack.length > 1) {
      const f = stack.pop();
      let hint = null;
      for (let k = f.children.length - 1; k >= 0; k--) {
        const ch = f.children[k];
        if (ch.text !== undefined && ch.text.includes('::')) {
          const idx = ch.text.lastIndexOf('::');
          hint = ch.text.slice(idx + 2);
          f.children[k] = { text: ch.text.slice(0, idx) };
          f.children = f.children.slice(0, k + 1);
          break;
        }
      }
      stack[stack.length - 1].children.push({ ord: f.ord, children: f.children, hint });
    } else top.children.push({ text: '}}' });
  }
  while (stack.length > 1) {
    const f = stack.pop();
    stack[stack.length - 1].children.push({ text: f.raw }, ...f.children);
  }
  return stack[0].children;
}

const plain = (nodes) => nodes.map((n) => (n.text !== undefined ? n.text : plain(n.children))).join('');

export const Cloze = {
  ordinals(s) {
    const out = new Set();
    const walk = (nodes) => nodes.forEach((n) => { if (n.ord) { out.add(n.ord); walk(n.children); } });
    walk(clozeParse(s || ''));
    return [...out].sort((a, b) => a - b);
  },
  render(s, ord, question) {
    const nodes = clozeParse(s || '');
    const has = (ns) => ns.some((n) => n.ord !== undefined && (n.ord === ord || has(n.children)));
    if (!has(nodes)) return '';
    const r = (ns) => ns.map((n) => {
      if (n.text !== undefined) return n.text;
      if (n.ord === ord) {
        if (question) {
          const ans = escapeHTML(renderPlain(n.children));
          return `<span class="cloze" data-cloze="${ans}" data-ordinal="${n.ord}">${n.hint !== null ? `[${n.hint}]` : '[...]'}</span>`;
        }
        return `<span class="cloze" data-ordinal="${n.ord}">${r(n.children)}</span>`;
      }
      return `<span class="cloze-inactive" data-ordinal="${n.ord}">${r(n.children)}</span>`;
    }).join('');
    const renderPlain = (ns) => ns.map((n) => (n.text !== undefined ? n.text : `<span class="cloze-inactive" data-ordinal="${n.ord}">${renderPlain(n.children)}</span>`)).join('');
    return r(nodes);
  },
  only(s, ord) {
    const parts = [];
    const walk = (ns) => ns.forEach((n) => { if (n.ord !== undefined) { if (n.ord === ord) parts.push(plain(n.children)); else walk(n.children); } });
    walk(clozeParse(s || ''));
    return parts.join(', ');
  },
};

// ---------------------------------------------------------------- template parsing

function parseTemplate(tpl) {
  let pos = 0;
  const parseUntil = (closing) => {
    const nodes = [];
    while (pos < tpl.length) {
      const open = tpl.indexOf('{{', pos);
      if (open < 0) { nodes.push({ text: tpl.slice(pos) }); pos = tpl.length; break; }
      if (open > pos) nodes.push({ text: tpl.slice(pos, open) });
      const close = tpl.indexOf('}}', open + 2);
      if (close < 0) { nodes.push({ text: tpl.slice(open) }); pos = tpl.length; break; }
      const inner = tpl.slice(open + 2, close).trim();
      pos = close + 2;
      if (inner[0] === '#' || inner[0] === '^') {
        const name = inner.slice(1).trim();
        nodes.push({ cond: name, neg: inner[0] === '^', children: parseUntil(name) });
      } else if (inner[0] === '/') {
        if (inner.slice(1).trim() === closing) return nodes;
      } else if (inner[0] === '!') {
        // comment
      } else {
        const parts = inner.split(':');
        const field = parts.pop().trim();
        nodes.push({ field, filters: parts.reverse() });
      }
    }
    return nodes;
  };
  return parseUntil(null);
}

export function fieldReferences(tpl) {
  const out = [];
  const walk = (ns) => ns.forEach((n) => {
    if (n.field !== undefined) out.push({ field: n.field, filters: n.filters });
    else if (n.cond !== undefined) { out.push({ field: n.cond, filters: [] }); walk(n.children); }
  });
  walk(parseTemplate(tpl || ''));
  return out;
}

// ---------------------------------------------------------------- furigana / type answer

const FURI = / ?([^ >]+?)\[(.+?)\]/g;
const furiganaMap = (s, f) => String(s).replace(FURI, (m, base, reading) => (reading.startsWith('sound:') ? m : f(base, reading)));
export const Furigana = {
  furigana: (s) => furiganaMap(s, (b, r) => `<ruby><rb>${b}</rb><rt>${r}</rt></ruby>`),
  kana: (s) => furiganaMap(s, (b, r) => r),
  kanji: (s) => furiganaMap(s, (b) => b),
};

export function compareAnswer(expectedRaw, providedRaw) {
  const expected = expectedRaw.trim().normalize('NFC');
  const provided = providedRaw.trim().normalize('NFC');
  const wrap = (x) => `<div id="typeans"><code id="typeans">${x}</code></div>`;
  if (!provided) return wrap(escapeHTML(expected));
  if (provided === expected) return wrap(`<span class="typeGood">${escapeHTML(expected)}</span>`);
  const e = [...expected], p = [...provided];
  const n = e.length, m = p.length;
  if (n * m > 1e6) return wrap(`<span class="typeBad">${escapeHTML(provided)}</span><br><span id="typearrow">&darr;</span><br><span class="typeMissed">${escapeHTML(expected)}</span>`);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = e[i] === p[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const typed = [], wanted = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && e[i] === p[j]) { typed.push([p[j], true]); wanted.push([e[i], true]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { typed.push([p[j], false]); j++; }
    else { wanted.push([e[i], false]); i++; }
  }
  const spans = (chars, good, bad) => {
    let out = '', cur = null, buf = '';
    for (const [ch, ok] of chars) {
      if (cur !== null && cur !== ok) { out += `<span class="${cur ? good : bad}">${escapeHTML(buf)}</span>`; buf = ''; }
      cur = ok; buf += ch;
    }
    if (cur !== null) out += `<span class="${cur ? good : bad}">${escapeHTML(buf)}</span>`;
    return out;
  };
  return wrap(spans(typed, 'typeGood', 'typeBad') + '<br><span id="typearrow">&darr;</span><br>' + spans(wanted, 'typeGood', 'typeMissed'));
}

// ---------------------------------------------------------------- rendering

const TYPE_INPUT = '<center><input type="text" id="typeans" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Type answer"></center>';

function fieldValue(name, st) {
  const c = st.ctx;
  switch (name) {
    case 'FrontSide': return st.question ? '' : st.frontSide;
    case 'Tags': return (c.tags || []).join(' ');
    case 'Type': return c.notetypeName || '';
    case 'Deck': return c.deckName || '';
    case 'Subdeck': return (c.deckName || '').split('::').pop();
    case 'Card': return c.templateName || '';
    case 'CardFlag': return c.flag ? `flag${c.flag}` : '';
    case 'CardID': return String(c.cardId || '');
    default: return Object.prototype.hasOwnProperty.call(c.fields, name) ? c.fields[name] : undefined;
  }
}

function applyFilters(field, filters, st) {
  let text = fieldValue(field, st);
  if (text === undefined) {
    if (!field && filters.some((f) => f.startsWith('tts'))) return '';
    return `<span class="template-error">{{${escapeHTML(field)}}}: unknown field</span>`;
  }
  const ord = st.ctx.ord + 1;
  for (const raw of filters) {
    const filter = raw.trim();
    const name = filter.split(' ')[0];
    switch (name) {
      case 'text': text = stripHTML(text); break;
      case 'cloze': if (st.ctx.isCloze) text = Cloze.render(text, ord, st.question); break;
      case 'cloze-only': text = Cloze.only(text, ord); break;
      case 'hint': {
        if (fieldIsEmpty(text)) break;
        const id = `hint${++st.hints}`;
        text = `<a class="hint" href="#" onclick="this.style.display='none';document.getElementById('${id}').style.display='block';return false;" draggable="false">${escapeHTML(field)}</a><div id="${id}" class="hint" style="display: none">${text}</div>`;
        break;
      }
      case 'type': {
        st.hasType = true;
        const src = st.ctx.fields[field] ?? text;
        const expected = filters.includes('cloze') ? stripHTML(Cloze.only(src, ord)) : stripHTML(src);
        return st.question ? TYPE_INPUT : compareAnswer(expected, st.typed || '');
      }
      case 'furigana': text = Furigana.furigana(text); break;
      case 'kana': text = Furigana.kana(text); break;
      case 'kanji': text = Furigana.kanji(text); break;
      case 'nc': text = text.normalize('NFD').replace(/[̀-ͯ]/g, ''); break;
      case 'tts': text = `[anki:tts lang=${filter.slice(3).trim()}]${stripHTML(text)}[/anki:tts]`; break;
      default: break; // unknown (add-on) filters pass text through
    }
  }
  return text;
}

function renderNodes(nodes, st) {
  let out = '';
  for (const n of nodes) {
    if (n.text !== undefined) out += n.text;
    else if (n.cond !== undefined) {
      const empty = fieldIsEmpty(fieldValue(n.cond, st) ?? '');
      if (n.neg ? empty : !empty) out += renderNodes(n.children, st);
    } else out += applyFilters(n.field, n.filters, st);
  }
  return out;
}

const PLAY_SVG = '<svg class="playImage" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"></circle><path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z"></path></svg>';

/** Replaces [sound:] and TTS tags with play buttons, returning the AV list. */
export function extractAV(html, side) {
  const tags = [];
  const out = html.replace(/\[sound:([^\]]+)\]|\[anki:tts([^\]]*)\]([\s\S]*?)\[\/anki:tts\]/g, (m, sound, opts, text) => {
    if (sound !== undefined) tags.push({ sound: decodeEntities(sound) });
    else {
      const tag = { tts: text, lang: 'en_US', speed: 1 };
      for (const part of (opts || '').trim().split(/\s+/)) {
        const [k, v] = part.split('=');
        if (k === 'lang' && v) tag.lang = v;
        if (k === 'speed' && v) tag.speed = parseFloat(v) || 1;
      }
      tags.push(tag);
    }
    return `<a class="replay-button soundLink" href="#" data-play="${side}:${tags.length - 1}">${PLAY_SVG}</a>`;
  });
  return [out, tags];
}

/** [latex] → Anki's pre-rendered images if present in the media folder, else MathJax. */
function processLatex(html, ctx) {
  if (!/\[latex\]|\[\$\]|\[\$\$\]/.test(html)) return html;
  return html.replace(/\[latex\]([\s\S]+?)\[\/latex\]|\[\$\]([\s\S]+?)\[\/\$\]|\[\$\$\]([\s\S]+?)\[\/\$\$\]/g, (m, a, b, c) => {
    let body, mj;
    if (a !== undefined) { body = a; mj = `\\(${stripHTML(a)}\\)`; }
    else if (b !== undefined) { body = `$${b}$`; mj = `\\(${stripHTML(b)}\\)`; }
    else { body = `\\[${c}\\]`; mj = `\\[${stripHTML(c)}\\]`; }
    const latex = decodeEntities(body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
    const digest = sha1Hex((ctx.latexPre ?? '') + latex + (ctx.latexPost ?? ''));
    for (const ext of ['svg', 'png']) {
      const name = `latex-${digest}.${ext}`;
      if (ctx.mediaExists?.(name)) return `<img class="latex" src="${name}">`;
    }
    return mj;
  });
}

/**
 * ctx: { fields: {name: value}, ord, isCloze, tags, notetypeName, deckName, templateName, flag, cardId,
 *        latexPre, latexPost, mediaExists(name) }
 */
export function renderCard(qfmt, afmt, css, ctx, typed = null) {
  const qs = { ctx, question: true, frontSide: '', hints: 0, hasType: false };
  let q = renderNodes(parseTemplate(qfmt || ''), qs);
  let isEmpty;
  if (ctx.isCloze) isEmpty = !q.includes('class="cloze"');
  else {
    const emptyFields = Object.fromEntries(Object.keys(ctx.fields).map((k) => [k, '']));
    const e = renderNodes(parseTemplate(qfmt || ''), { ctx: { ...ctx, fields: emptyFields }, question: true, frontSide: '', hints: 0 });
    isEmpty = stripHTML(q) === stripHTML(e) && !/<img/i.test(q);
  }
  q = processLatex(q, ctx);
  const [qHTML, qAV] = extractAV(q, 'q');
  const front = qHTML.replace(TYPE_INPUT, '');
  const as = { ctx, question: false, frontSide: front, hints: 100, typed };
  let a = processLatex(renderNodes(parseTemplate(afmt || ''), as), ctx);
  const [aHTML, aAV] = extractAV(a, 'a');
  return { question: qHTML, answer: aHTML, css: css || '', questionAV: qAV, answerAV: aAV, hasTypeAnswer: qs.hasType, isEmpty };
}
