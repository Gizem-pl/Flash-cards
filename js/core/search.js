// Anki search syntax: text, "phrases", -negation, OR, (groups), deck:, tag:, is:new|learn|review|due|suspended|buried|leech,
// flag:N, card:N|Name, note:Name, field:value, added:N, rated:N[:ease], prop:ivl>N (ivl, due, reps, lapses, ease), nid:, cid:
import { stripHTML } from './util.js';
import { Queue } from './scheduler.js';

function tokenize(s) {
  const tokens = [];
  let cur = '', inQuote = false;
  const flush = () => {
    if (!cur) return;
    if (cur.toUpperCase() === 'OR') tokens.push({ t: 'or' });
    else if (cur.toUpperCase() !== 'AND') tokens.push({ t: 'word', v: cur });
    cur = '';
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ' ' || ch === '　') flush();
    else if (ch === '(' && !cur) tokens.push({ t: '(' });
    else if (ch === ')') { flush(); tokens.push({ t: ')' }); }
    else if (ch === '-' && !cur) tokens.push({ t: '-' });
    else cur += ch;
  }
  flush();
  return tokens;
}

function parse(s) {
  const tokens = tokenize(s);
  let pos = 0;
  const orExpr = () => {
    const items = [andExpr()];
    while (tokens[pos]?.t === 'or') { pos++; items.push(andExpr()); }
    return items.length === 1 ? items[0] : { or: items };
  };
  const andExpr = () => {
    const items = [];
    while (pos < tokens.length && tokens[pos].t !== 'or' && tokens[pos].t !== ')') items.push(unary());
    return items.length === 1 ? items[0] : { and: items };
  };
  const unary = () => {
    const t = tokens[pos];
    if (t.t === '-') { pos++; return pos < tokens.length ? { not: unary() } : { and: [] }; }
    if (t.t === '(') { pos++; const e = orExpr(); if (tokens[pos]?.t === ')') pos++; return e; }
    pos++;
    return t.t === 'word' ? { term: t.v } : { and: [] };
  };
  return tokens.length ? orExpr() : { and: [] };
}

/** Converts a pattern with * (any) and _ (one char) into a RegExp. */
function wildcard(pattern, whole = true) {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.');
  return new RegExp(whole ? `^${esc}$` : esc, 'i');
}

export function compileSearch(query, col) {
  const textCache = new Map();
  const noteText = (n) => {
    let t = textCache.get(n.id);
    if (t === undefined) { t = stripHTML(n.flds.join(' ')).toLowerCase() + ' ' + n.flds.join(' ').toLowerCase(); textCache.set(n.id, t); }
    return t;
  };
  const today = col.today, now = col.now;

  const term = (raw) => {
    const colon = raw.indexOf(':');
    if (colon <= 0) {
      const re = wildcard(raw.toLowerCase(), false);
      return (c, n) => re.test(noteText(n));
    }
    const key = raw.slice(0, colon).toLowerCase();
    const value = raw.slice(colon + 1);
    switch (key) {
      case 'deck': {
        if (value === '*') return () => true;
        const re = wildcard(value);
        const ids = new Set();
        for (const d of col.decks.values()) if (re.test(d.name)) col.deckAndDescendantIds(d.id).forEach((x) => ids.add(x));
        return (c) => ids.has(c.did);
      }
      case 'tag': {
        if (value.toLowerCase() === 'none') return (c, n) => n.tags.length === 0;
        const re = wildcard(value), child = wildcard(value + '::*');
        return (c, n) => n.tags.some((t) => re.test(t) || child.test(t));
      }
      case 'is':
        switch (value.toLowerCase()) {
          case 'new': return (c) => c.type === 0;
          case 'learn': return (c) => c.queue === Queue.Learning || c.queue === Queue.DayLearning;
          case 'review': return (c) => c.type === 2 || c.type === 3;
          case 'due': return (c) => ((c.queue === 2 || c.queue === 3) && c.due <= today) || (c.queue === 1 && c.due <= now);
          case 'suspended': return (c) => c.queue === -1;
          case 'buried': return (c) => c.queue === -2 || c.queue === -3;
          case 'leech': return (c, n) => n.tags.some((t) => t.toLowerCase() === 'leech');
          default: return () => true;
        }
      case 'flag': { const f = parseInt(value, 10) || 0; return (c) => (c.flags & 7) === f; }
      case 'card': {
        const num = parseInt(value, 10);
        if (String(num) === value) return (c) => c.ord === num - 1;
        const re = wildcard(value);
        return (c, n) => { const nt = col.notetype(n.mid); return nt?.type === 0 && re.test(nt.tmpls.find((t) => t.ord === c.ord)?.name || ''); };
      }
      case 'note': case 'notetype': {
        const re = wildcard(value);
        return (c, n) => re.test(col.notetype(n.mid)?.name || '');
      }
      case 'added': {
        const since = col.dayStart(today - Math.max(parseInt(value, 10) || 1, 1) + 1) * 1000;
        return (c) => c.id > since;
      }
      case 'rated': {
        const [d, e] = value.split(':');
        const since = col.dayStart(today - Math.max(parseInt(d, 10) || 1, 1) + 1) * 1000;
        const ease = e ? parseInt(e, 10) : null;
        return (c) => col.revlogFor(c.id).some((r) => r.id > since && r.ease > 0 && (ease === null || r.ease === ease));
      }
      case 'prop': {
        const m = value.match(/^(ivl|due|reps|lapses|ease)(<=|>=|!=|=|<|>)(-?[\d.]+)$/);
        if (!m) return () => true;
        const [, prop, op, numS] = m;
        const num = parseFloat(numS);
        const cmp = { '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '=': (a, b) => a === b, '!=': (a, b) => a !== b }[op];
        if (prop === 'due') return (c) => (c.queue === 2 || c.queue === 3) && cmp(c.due - today, num);
        if (prop === 'ease') return (c) => cmp(c.factor / 1000, num);
        const k = { ivl: 'ivl', reps: 'reps', lapses: 'lapses' }[prop];
        return (c) => cmp(c[k], num);
      }
      case 'nid': { const ids = new Set(value.split(',').map(Number)); return (c, n) => ids.has(n.id); }
      case 'cid': { const ids = new Set(value.split(',').map(Number)); return (c) => ids.has(c.id); }
      default: {
        // field search: name:value
        const fieldRe = wildcard(raw.slice(0, colon));
        const valRe = wildcard(value);
        return (c, n) => {
          const nt = col.notetype(n.mid);
          if (!nt) return false;
          return nt.flds.some((f, i) => fieldRe.test(f.name) && valRe.test(stripHTML(n.flds[i] || '')));
        };
      }
    }
  };

  const compile = (e) => {
    if (e.term !== undefined) return term(e.term);
    if (e.not) { const f = compile(e.not); return (c, n) => !f(c, n); }
    if (e.or) { const fs = e.or.map(compile); return (c, n) => fs.some((f) => f(c, n)); }
    const fs = e.and.map(compile);
    return (c, n) => fs.every((f) => f(c, n));
  };
  return compile(parse(query || ''));
}

export const SORTS = {
  created: { title: 'Created', key: (c) => c.id },
  sortField: { title: 'Sort Field', key: (c, n) => (n.sfld || '').toLowerCase() },
  due: { title: 'Due', key: (c) => (c.type === 0 ? 1e12 + c.due : c.due > 1e9 ? c.due / 86400 : c.due) },
  interval: { title: 'Interval', key: (c) => c.ivl },
  ease: { title: 'Ease', key: (c) => c.factor },
  reps: { title: 'Reviews', key: (c) => c.reps },
  lapses: { title: 'Lapses', key: (c) => c.lapses },
  modified: { title: 'Modified', key: (c) => c.mod },
};

export function findCards(col, query, sort = 'created', ascending = false) {
  const pred = compileSearch(query, col);
  const key = SORTS[sort]?.key || SORTS.created.key;
  const out = [];
  for (const c of col.cards.values()) {
    const n = col.note(c.nid);
    if (n && pred(c, n)) out.push([key(c, n), c]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * (ascending ? 1 : -1));
  return out.map((x) => x[1]);
}

export function findNotes(col, query) {
  return [...new Set(findCards(col, query).map((c) => c.nid))];
}
