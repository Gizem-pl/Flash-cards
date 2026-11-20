// Exports decks as .apkg in the widely compatible "collection.anki21" format (Anki 2.1+, AnkiDroid, AnkiMobile).
import { getJSZip, getSQL } from './libs.js';
import { mediaReferences, stripHTMLMedia, fieldChecksum } from './util.js';
import { DEFAULT_CONF, naturalQueue, deckParentName } from './collection.js';

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

/** deckId: deck to export with subdecks, or null for everything. Returns a Blob. */
export async function exportPackage(col, deckId, { includeScheduling = true, includeMedia = true, onProgress = () => {} } = {}) {
  onProgress('Loading libraries…', 0.05);
  const [JSZip, SQL] = await Promise.all([getJSZip(), getSQL()]);
  const deckIds = new Set(deckId ? col.deckAndDescendantIds(deckId) : [...col.decks.keys()]);
  const cards = [...col.cards.values()].filter((c) => deckIds.has(c.did));
  const notes = [...new Set(cards.map((c) => c.nid))].map((id) => col.note(id)).filter(Boolean);
  const notetypes = [...new Set(notes.map((n) => n.mid))].map((id) => col.notetype(id)).filter(Boolean);
  const decks = [...deckIds].map((id) => col.deck(id)).filter(Boolean);
  const names = new Set(decks.map((d) => d.name.toLowerCase()));
  for (const d of [...decks]) {
    for (let p = deckParentName(d.name); p && !names.has(p.toLowerCase()); p = deckParentName(p)) {
      const pd = col.deckByName(p);
      if (pd) { decks.push(pd); names.add(p.toLowerCase()); }
    }
  }
  const configs = [...new Set([...decks.map((d) => d.conf), DEFAULT_CONF])].map((id) => col.config(id)).filter(Boolean);
  const now = col.now;

  onProgress('Building collection…', 0.2);
  const db = new SQL.Database();
  db.run(SCHEMA);
  const models = Object.fromEntries(notetypes.map((nt) => [String(nt.id), legacyModel(nt, now)]));
  const deckJSON = Object.fromEntries(decks.map((d) => [String(d.id), legacyDeck(d, now)]));
  if (!deckJSON['1']) deckJSON['1'] = legacyDeck({ id: 1, name: 'Default', conf: 1, desc: '' }, now);
  const dconf = Object.fromEntries(configs.map((c) => [String(c.id), legacyConfig(c, now)]));
  const conf = { nextPos: col.meta.nextPos, schedVer: 2, sortType: 'noteFld', sortBackwards: false, activeDecks: [1], curDeck: deckId || 1,
    newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, curModel: notetypes[0]?.id || 0, addToCur: true,
    dayLearnFirst: false, rollover: col.rollover };
  db.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)',
    [col.crt, now * 1000, now * 1000, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(deckJSON), JSON.stringify(dconf), '{}']);

  db.run('BEGIN');
  const ins = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?)');
  for (const n of notes) {
    const nt = col.notetype(n.mid);
    const idx = Math.min(nt?.sortf || 0, Math.max(n.flds.length - 1, 0));
    ins.run([n.id, n.guid, n.mid, n.mod, n.tags.length ? ` ${n.tags.join(' ')} ` : '', n.flds.join('\x1f'), stripHTMLMedia(n.flds[idx] || ''), fieldChecksum(n.flds[0] || ''), '']);
  }
  ins.free();
  const insC = db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)');
  for (const c of cards) {
    if (includeScheduling) {
      const data = c.s > 0 ? JSON.stringify({ s: Math.round(c.s * 1e4) / 1e4, d: Math.round(c.d * 1e3) / 1e3, ...(c.lrt ? { lrt: c.lrt } : {}) }) : '{}';
      const queue = c.queue === -2 || c.queue === -3 ? naturalQueue(c) : c.queue;
      insC.run([c.id, c.nid, c.did, c.ord, c.mod, c.type, queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.flags, data]);
    } else {
      insC.run([c.id, c.nid, c.did, c.ord, c.mod, 0, 0, c.type === 0 ? c.due : 0, 0, 0, 0, 0, 0, 0, '{}']);
    }
  }
  insC.free();
  if (includeScheduling) {
    const insR = db.prepare('INSERT OR IGNORE INTO revlog VALUES (?, ?, -1, ?, ?, ?, ?, ?, ?)');
    for (const c of cards) for (const r of col.revlogFor(c.id)) insR.run([r.id, r.cid, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type]);
    insR.free();
  }
  db.run('COMMIT');
  const bytes = db.export();
  db.close();

  const zip = new JSZip();
  zip.file('collection.anki21', bytes);
  const mediaMap = {};
  if (includeMedia) {
    const files = new Set();
    for (const n of notes) for (const f of n.flds) mediaReferences(f).forEach((m) => files.add(m));
    for (const nt of notetypes) {
      const text = nt.css + nt.tmpls.map((t) => t.qfmt + t.afmt).join('');
      for (const m of col.mediaNames) if (m.startsWith('_') && text.includes(m)) files.add(m);
    }
    let i = 0;
    const list = [...files].filter((f) => col.mediaNames.has(f)).sort();
    for (const name of list) {
      if (i % 20 === 0) onProgress(`Adding media (${i}/${list.length})…`, 0.4 + 0.3 * i / Math.max(list.length, 1));
      const blob = await col.mediaBlob(name);
      if (!blob) continue;
      zip.file(String(i), blob);
      mediaMap[String(i)] = name;
      i++;
    }
  }
  zip.file('media', JSON.stringify(mediaMap));
  onProgress('Compressing…', 0.75);
  const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/octet-stream' },
    (m) => onProgress('Compressing…', 0.75 + 0.25 * m.percent / 100));
  onProgress('Done', 1);
  return out;
}

function legacyModel(nt, now) {
  return {
    id: nt.id, name: nt.name, type: nt.type, mod: nt.mod || now, usn: -1, sortf: nt.sortf || 0, did: null, css: nt.css,
    latexPre: nt.latexPre, latexPost: nt.latexPost, latexsvg: false, tags: [], vers: [],
    req: nt.tmpls.map((t) => [t.ord, 'any', [0]]),
    flds: nt.flds.map((f, i) => ({ name: f.name, ord: i, sticky: !!f.sticky, rtl: !!f.rtl, font: f.font || 'Arial', size: f.size || 20, description: f.description || '', media: [] })),
    tmpls: nt.tmpls.map((t, i) => ({ name: t.name, ord: i, qfmt: t.qfmt, afmt: t.afmt, bqfmt: t.bqfmt || '', bafmt: t.bafmt || '', did: t.did || null, bfont: '', bsize: 0 })),
  };
}

function legacyDeck(d, now) {
  return { id: d.id, name: d.name, desc: d.desc || '', conf: d.conf, dyn: 0, collapsed: !!d.collapsed, browserCollapsed: false,
    extendNew: 0, extendRev: 0, usn: -1, mod: now, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0] };
}

function legacyConfig(c, now) {
  return {
    id: c.id, name: c.name, mod: now, usn: -1, maxTaken: c.maxAnswerSecs, autoplay: c.autoplay, timer: 0, replayq: c.replayQuestion, dyn: false,
    new: { delays: c.learnSteps, ints: [c.graduatingInterval, c.easyInterval, 0], initialFactor: Math.round(c.startingEase * 1000), perDay: c.newPerDay,
      order: c.newOrder === 1 ? 0 : 1, bury: c.buryNew },
    rev: { perDay: c.reviewsPerDay, ease4: c.easyBonus, ivlFct: c.intervalModifier, maxIvl: c.maximumInterval, hardFactor: c.hardInterval, bury: c.buryReviews },
    lapse: { delays: c.relearnSteps, mult: c.newInterval, minInt: c.minimumLapseInterval, leechFails: c.leechThreshold, leechAction: c.leechAction === 0 ? 0 : 1 },
    buryInterdayLearning: c.buryInterday, newMix: c.newMix, interdayLearningMix: c.interdayMix, desiredRetention: c.desiredRetention,
    ...(c.fsrsParams?.length === 21 ? { fsrsParams6: c.fsrsParams } : {}),
  };
}
