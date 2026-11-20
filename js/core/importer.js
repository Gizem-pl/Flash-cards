// Imports Anki packages (.apkg / .colpkg) in all three formats: collection.anki2 (v1), collection.anki21 (v2) and
// collection.anki21b (zstd-compressed schema 18 with protobuf media map).
import { getJSZip, getSQL, getZstd, isZstd } from './libs.js';
import { Proto } from './protobuf.js';
import * as store from './storage.js';
import { DEFAULT_CONFIG } from './scheduler.js';
import { DEFAULT_DECK, DEFAULT_CONF, newCard } from './collection.js';
import { DEFAULT_CSS, LATEX_PRE, LATEX_POST } from './stock.js';
import { dayIndex, mimeFor } from './util.js';

export async function importPackage(file, col, opts = {}) {
  const { includeScheduling = true, updateNotes = true, includeConfigs = true, onProgress = () => {} } = opts;
  const summary = { notesAdded: 0, notesUpdated: 0, notesUnchanged: 0, cardsAdded: 0, mediaFiles: 0, notetypesAdded: 0, decks: [], warnings: [] };

  onProgress('Loading libraries…', 0.02);
  const [JSZip, SQL] = await Promise.all([getJSZip(), getSQL()]);
  onProgress('Unpacking…', 0.05);
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error('This file is not an Anki package (.apkg / .colpkg).'); }

  let dbBytes;
  if (zip.file('collection.anki21b')) {
    const zstd = await getZstd();
    dbBytes = zstd.decompress(await zip.file('collection.anki21b').async('uint8array'));
  } else if (zip.file('collection.anki21')) dbBytes = await zip.file('collection.anki21').async('uint8array');
  else if (zip.file('collection.anki2')) dbBytes = await zip.file('collection.anki2').async('uint8array');
  else throw new Error('This file is not an Anki package (.apkg / .colpkg).');

  // media map: zip entry name -> filename
  const mediaMap = new Map();
  let mediaCompressed = false;
  if (zip.file('media')) {
    const raw = await zip.file('media').async('uint8array');
    if (isZstd(raw)) {
      const zstd = await getZstd();
      mediaCompressed = true;
      new Proto(zstd.decompress(raw)).all(1).forEach((f, i) => {
        const e = new Proto(f[2]);
        const name = e.string(1);
        if (name) mediaMap.set(String(e.uint(255) ?? i), name);
      });
    } else {
      try { for (const [k, v] of Object.entries(JSON.parse(new TextDecoder().decode(raw)))) mediaMap.set(k, v); } catch { /* no media */ }
    }
  }

  const db = new SQL.Database(dbBytes);
  try {
    // ---- media ----
    const renames = new Map();
    const entries = [...mediaMap.entries()];
    const zstd = mediaCompressed ? await getZstd() : null;
    let batch = [];
    const flushBatch = async () => { if (batch.length) { await store.write(batch); batch = []; } };
    for (let i = 0; i < entries.length; i++) {
      const [zipName, rawName] = entries[i];
      if (i % 20 === 0) onProgress(`Importing media (${i}/${entries.length})…`, 0.1 + 0.45 * i / entries.length);
      const entry = zip.file(zipName);
      if (!entry) continue;
      let data = await entry.async('uint8array');
      if (zstd && isZstd(data)) data = zstd.decompress(data);
      const name = rawName.split('/').pop();
      if (col.mediaNames.has(name)) {
        await flushBatch();
        const stored = await col.addMedia(data, name);
        if (stored !== name) renames.set(name, stored);
      } else {
        batch.push({ store: 'media', put: new Blob([data], { type: mimeFor(name) }), key: name });
        col.mediaNames.add(name);
        if (batch.length >= 50) await flushBatch();
      }
      summary.mediaFiles++;
    }
    await flushBatch();

    onProgress('Importing notes…', 0.6);
    mergeCollection(db, col, { includeScheduling, updateNotes, includeConfigs, renames, summary, onProgress });
    onProgress('Saving…', 0.95);
    await col.flush();
  } finally {
    db.close();
  }
  onProgress('Done', 1);
  return summary;
}

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const out = [];
  try { stmt.bind(params); while (stmt.step()) out.push(stmt.getAsObject()); } finally { stmt.free(); }
  return out;
}
const tableExists = (db, name) => rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]).length > 0;
const num = (x, d = null) => { const n = typeof x === 'string' ? Number(x) : x; return Number.isFinite(n) ? n : d; };
const nums = (a) => (Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : null);
const parseJSON = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

function mergeCollection(db, col, { includeScheduling, updateNotes, includeConfigs, renames, summary, onProgress }) {
  const modern = tableExists(db, 'notetypes');
  const colRow = rows(db, 'SELECT * FROM col')[0] || {};
  const srcCrt = num(colRow.crt, col.crt);
  const notetypes = modern ? readModernNotetypes(db) : readLegacyNotetypes(colRow);
  const decks = modern ? readModernDecks(db) : readLegacyDecks(colRow);
  const configs = modern ? readModernConfigs(db) : readLegacyConfigs(colRow);

  // ---- deck presets ----
  const confMap = new Map();
  for (const cfg of configs) {
    if (col.config(cfg.id)) confMap.set(cfg.id, cfg.id);
    else if (includeConfigs) { col.saveConfig(cfg); confMap.set(cfg.id, cfg.id); }
    else confMap.set(cfg.id, DEFAULT_CONF);
  }

  // ---- note types ----
  const ntMap = new Map();
  const existingAll = col.allNotetypes();
  const sameShape = (a, b) => JSON.stringify(a.flds.map((f) => f.name)) === JSON.stringify(b.flds.map((f) => f.name));
  for (const nt of notetypes) {
    const existing = col.notetype(nt.id);
    if (existing) {
      if (sameShape(existing, nt) && existing.tmpls.length === nt.tmpls.length) {
        ntMap.set(nt.id, existing.id);
        if (nt.mod > existing.mod) col.saveNotetype({ ...existing, tmpls: nt.tmpls, css: nt.css, name: nt.name, sortf: nt.sortf, mod: nt.mod });
        continue;
      }
      const copy = { ...nt, id: col.newId(col.notetypes) };
      col.saveNotetype(copy);
      ntMap.set(nt.id, copy.id);
      summary.notetypesAdded++;
      continue;
    }
    const same = existingAll.find((x) => x.name === nt.name && sameShape(x, nt) && x.css === nt.css
      && JSON.stringify(x.tmpls.map((t) => [t.qfmt, t.afmt])) === JSON.stringify(nt.tmpls.map((t) => [t.qfmt, t.afmt])));
    if (same) { ntMap.set(nt.id, same.id); continue; }
    col.saveNotetype(nt);
    ntMap.set(nt.id, nt.id);
    summary.notetypesAdded++;
  }

  // ---- decks ----
  const deckMap = new Map();
  const srcDecks = new Map(decks.map((d) => [d.id, d]));
  const used = new Set(rows(db, 'SELECT DISTINCT did AS d FROM cards UNION SELECT DISTINCT odid AS d FROM cards WHERE odid != 0').map((r) => r.d));
  for (const d of [...decks].sort((a, b) => a.name.length - b.name.length)) {
    if (d.filtered) continue;
    if (d.id === 1 && !used.has(1)) continue;
    const conf = confMap.get(d.conf) ?? DEFAULT_CONF;
    const isNew = !col.deckByName(d.name);
    const deck = col.getOrCreateDeck(d.name, conf, d.id);
    if (isNew) { deck.conf = conf; deck.desc = d.desc; col.saveDeck(deck); }
    deckMap.set(d.id, deck.id);
    if (used.has(d.id)) summary.decks.push(deck.name);
  }
  const targetDeck = (srcDid) => {
    if (deckMap.has(srcDid)) return deckMap.get(srcDid);
    const sd = srcDecks.get(srcDid);
    if (sd && !sd.filtered) return col.getOrCreateDeck(sd.name).id;
    return DEFAULT_DECK;
  };

  // ---- notes ----
  const applyRenames = (s) => {
    if (!renames.size) return s;
    for (const [o, n] of renames) {
      if (!s.includes(o)) continue;
      for (const [a, b] of [[`"${o}"`, `"${n}"`], [`'${o}'`, `'${n}'`], [`[sound:${o}]`, `[sound:${n}]`], [`=${o}>`, `=${n}>`], [`=${o} `, `=${n} `]]) s = s.split(a).join(b);
    }
    return s;
  };
  const noteMap = new Map();
  const srcNotes = rows(db, 'SELECT id, guid, mid, mod, tags, flds FROM notes');
  srcNotes.forEach((r, i) => {
    if (i % 1000 === 0) onProgress(`Importing notes (${i}/${srcNotes.length})…`, 0.6 + 0.2 * i / srcNotes.length);
    const mid = ntMap.get(r.mid);
    const nt = mid && col.notetype(mid);
    if (!nt) { summary.warnings.push('Skipped a note with a missing note type.'); return; }
    let flds = String(r.flds).split('\x1f').map(applyRenames);
    while (flds.length < nt.flds.length) flds.push('');
    flds = flds.slice(0, nt.flds.length);
    const tags = String(r.tags || '').split(/[\s　]+/).filter(Boolean);
    const existing = col.noteByGuid(r.guid);
    if (existing) {
      noteMap.set(r.id, existing.id);
      const changed = JSON.stringify(existing.flds) !== JSON.stringify(flds) || [...existing.tags].sort().join(' ') !== [...tags].sort().join(' ');
      if (updateNotes && existing.mid === mid && r.mod > existing.mod && changed) {
        col.writeNote({ ...existing, flds, tags, mod: r.mod });
        summary.notesUpdated++;
      } else summary.notesUnchanged++;
    } else {
      const id = col.notes.has(r.id) ? col.newId(col.notes) : r.id;
      col.writeNote({ id, guid: r.guid, mid, mod: r.mod, tags, flds });
      noteMap.set(r.id, id);
      summary.notesAdded++;
    }
  });

  // ---- cards ----
  onProgress('Importing cards…', 0.82);
  const dayOffset = col.today - dayIndex(col.now, srcCrt, col.rollover);
  const minNewDue = num(rows(db, 'SELECT min(due) AS m FROM cards WHERE type=0')[0]?.m, 0);
  let maxPos = col.meta.nextPos;
  const imported = new Map();
  const existingOrds = new Set([...col.cards.values()].map((c) => `${c.nid}:${c.ord}`));
  for (const r of rows(db, 'SELECT * FROM cards ORDER BY id')) {
    const nid = noteMap.get(r.nid);
    if (nid === undefined || existingOrds.has(`${nid}:${r.ord}`)) continue;
    const cid = col.cards.has(r.id) ? col.newId(col.cards) : r.id;
    const did = targetDeck(r.odid ? r.odid : r.did);
    const card = newCard(cid, nid, did, r.ord, 0, r.mod);
    let due = r.odid && r.odue ? r.odue : r.due;
    if (includeScheduling && r.type !== 0) {
      const isTs = due > 1e9;
      if (!isTs) due += dayOffset;
      Object.assign(card, { type: r.type, ivl: r.ivl, factor: r.factor, reps: r.reps, lapses: r.lapses, left: r.left % 1000, flags: r.flags, due });
      if (r.queue === -1) card.queue = -1;
      else if (r.queue === 1 || r.queue === 4) card.queue = isTs ? 1 : 3;
      else if (r.queue === 3) card.queue = 3;
      else if (r.queue === 2) card.queue = 2;
      else card.queue = r.type === 2 ? 2 : isTs ? 1 : 3;
      if (r.type === 2 && card.ivl <= 0) card.ivl = 1;
      const data = parseJSON(r.data);
      if (data.s > 0 && data.d > 0) { card.s = data.s; card.d = data.d; }
      if (data.lrt > 0) card.lrt = data.lrt;
    } else {
      card.queue = r.queue === -1 && includeScheduling ? -1 : 0;
      card.due = col.meta.nextPos + Math.max(0, (r.type === 0 ? due : 0) - minNewDue);
      maxPos = Math.max(maxPos, card.due + 1);
      card.flags = includeScheduling ? r.flags : 0;
    }
    col.saveCard(card);
    existingOrds.add(`${nid}:${r.ord}`);
    imported.set(r.id, cid);
    summary.cardsAdded++;
  }
  col.meta.nextPos = maxPos;
  col._saveMeta();

  // ---- review log ----
  if (includeScheduling && imported.size) {
    onProgress('Importing review history…', 0.9);
    for (const r of rows(db, 'SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog')) {
      const cid = imported.get(r.cid);
      if (cid === undefined || col.revlog.has(r.id)) continue;
      col.addRevlog({ id: r.id, cid, ease: r.ease, ivl: r.ivl, lastIvl: r.lastIvl, factor: r.factor, time: r.time, type: r.type });
    }
  }
  if (col.fsrs && includeScheduling) col.recomputeMemoryStates();
}

// ---------------------------------------------------------------- legacy (schema 11)

function readLegacyNotetypes(colRow) {
  return Object.values(parseJSON(colRow.models)).map((m) => ({
    id: num(m.id),
    name: m.name || 'Imported',
    type: num(m.type, 0) === 1 ? 1 : 0,
    flds: (m.flds || []).sort((a, b) => a.ord - b.ord).map((f, i) => ({
      name: f.name || `Field ${i + 1}`, ord: i, sticky: !!f.sticky, rtl: !!f.rtl, font: f.font || 'Arial', size: num(f.size, 20), description: f.description || '',
    })),
    tmpls: (m.tmpls || []).sort((a, b) => a.ord - b.ord).map((t, i) => ({
      name: t.name || `Card ${i + 1}`, ord: i, qfmt: t.qfmt || '', afmt: t.afmt || '', bqfmt: t.bqfmt || '', bafmt: t.bafmt || '', did: num(t.did) || null,
    })),
    css: m.css ?? DEFAULT_CSS,
    sortf: num(m.sortf, 0),
    latexPre: m.latexPre ?? LATEX_PRE,
    latexPost: m.latexPost ?? LATEX_POST,
    mod: num(m.mod, 0),
  })).filter((m) => m.id);
}

function readLegacyDecks(colRow) {
  return Object.values(parseJSON(colRow.decks)).map((d) => ({
    id: num(d.id), name: String(d.name || 'Imported'), conf: num(d.conf, 1), desc: d.desc || '', filtered: !!num(d.dyn, 0),
  })).filter((d) => d.id);
}

function readLegacyConfigs(colRow) {
  return Object.values(parseJSON(colRow.dconf)).filter((c) => c && num(c.id)).map((c) => {
    const n = c.new || {}, r = c.rev || {}, l = c.lapse || {};
    const cfg = { ...DEFAULT_CONFIG, id: num(c.id), name: c.name || 'Imported' };
    if (nums(n.delays)) cfg.learnSteps = nums(n.delays);
    if (nums(n.ints)) { const ints = nums(n.ints); if (ints[0]) cfg.graduatingInterval = ints[0]; if (ints[1]) cfg.easyInterval = ints[1]; }
    if (num(n.initialFactor)) cfg.startingEase = num(n.initialFactor) / 1000;
    if (num(n.perDay) !== null) cfg.newPerDay = num(n.perDay);
    if (num(n.order) !== null) cfg.newOrder = num(n.order) === 0 ? 1 : 0;
    if (typeof n.bury === 'boolean') cfg.buryNew = n.bury;
    if (num(r.perDay) !== null) cfg.reviewsPerDay = num(r.perDay);
    if (num(r.ease4)) cfg.easyBonus = num(r.ease4);
    if (num(r.ivlFct)) cfg.intervalModifier = num(r.ivlFct);
    if (num(r.maxIvl)) cfg.maximumInterval = num(r.maxIvl);
    if (num(r.hardFactor)) cfg.hardInterval = num(r.hardFactor);
    if (typeof r.bury === 'boolean') cfg.buryReviews = r.bury;
    if (nums(l.delays)) cfg.relearnSteps = nums(l.delays);
    if (num(l.mult) !== null) cfg.newInterval = num(l.mult);
    if (num(l.minInt)) cfg.minimumLapseInterval = num(l.minInt);
    if (num(l.leechFails)) cfg.leechThreshold = num(l.leechFails);
    if (num(l.leechAction) !== null) cfg.leechAction = num(l.leechAction) === 0 ? 0 : 1;
    if (typeof c.autoplay === 'boolean') cfg.autoplay = c.autoplay;
    if (typeof c.replayq === 'boolean') cfg.replayQuestion = c.replayq;
    if (num(c.maxTaken)) cfg.maxAnswerSecs = num(c.maxTaken);
    if (typeof c.buryInterdayLearning === 'boolean') cfg.buryInterday = c.buryInterdayLearning;
    if ([0, 1, 2].includes(c.newMix)) cfg.newMix = c.newMix;
    if ([0, 1, 2].includes(c.interdayLearningMix)) cfg.interdayMix = c.interdayLearningMix;
    if (num(c.desiredRetention) > 0.5 && num(c.desiredRetention) < 1) cfg.desiredRetention = num(c.desiredRetention);
    const p = nums(c.fsrsParams6) || nums(c.fsrsParams5) || nums(c.fsrsWeights);
    if (p && [17, 19, 21].includes(p.length)) cfg.fsrsParams = p;
    return cfg;
  });
}

// ---------------------------------------------------------------- modern (schema 18, protobuf configs)

function readModernNotetypes(db) {
  const fieldsBy = new Map(), tmplsBy = new Map();
  for (const r of rows(db, 'SELECT ntid, ord, name, config FROM fields ORDER BY ntid, ord')) {
    const p = new Proto(r.config);
    if (!fieldsBy.has(r.ntid)) fieldsBy.set(r.ntid, []);
    fieldsBy.get(r.ntid).push({ name: r.name, ord: 0, sticky: !!p.bool(1), rtl: !!p.bool(2), font: p.string(3) || 'Arial', size: p.uint(4) || 20, description: p.string(5) || '' });
  }
  for (const r of rows(db, 'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord')) {
    const p = new Proto(r.config);
    if (!tmplsBy.has(r.ntid)) tmplsBy.set(r.ntid, []);
    const did = p.int64(5);
    tmplsBy.get(r.ntid).push({ name: r.name, ord: 0, qfmt: p.string(1) || '', afmt: p.string(2) || '', bqfmt: p.string(3) || '', bafmt: p.string(4) || '', did: did > 0 ? did : null });
  }
  return rows(db, 'SELECT id, name, mtime_secs, config FROM notetypes').map((r) => {
    const p = new Proto(r.config);
    return {
      id: r.id, name: r.name, type: p.uint(1) === 1 ? 1 : 0,
      flds: (fieldsBy.get(r.id) || []).map((f, i) => ({ ...f, ord: i })),
      tmpls: (tmplsBy.get(r.id) || []).map((t, i) => ({ ...t, ord: i })),
      css: p.string(3) ?? DEFAULT_CSS, sortf: p.uint(2) || 0,
      latexPre: p.string(5) || LATEX_PRE, latexPost: p.string(6) || LATEX_POST, mod: r.mtime_secs,
    };
  });
}

function readModernDecks(db) {
  return rows(db, 'SELECT id, name, kind FROM decks').map((r) => {
    const kind = new Proto(r.kind);
    const name = String(r.name).split('\x1f').join('::');
    const normal = kind.message(1);
    if (normal) return { id: r.id, name, conf: normal.int64(1) || 1, desc: normal.string(4) || '', filtered: false };
    return { id: r.id, name, conf: 1, desc: '', filtered: !!kind.message(2) };
  });
}

function readModernConfigs(db) {
  return rows(db, 'SELECT id, name, config FROM deck_config').map((r) => {
    const p = new Proto(r.config);
    const c = { ...DEFAULT_CONFIG, id: r.id, name: r.name };
    const f = (n) => p.float(n);
    c.learnSteps = p.floats(1);
    c.relearnSteps = p.floats(2);
    const p6 = p.floats(6), p5 = p.floats(5), p4 = p.floats(3);
    if (p6.length === 21) c.fsrsParams = p6; else if (p5.length === 19) c.fsrsParams = p5; else if (p4.length === 17) c.fsrsParams = p4;
    c.newPerDay = p.uint(9) ?? 0;
    c.reviewsPerDay = p.uint(10) ?? 0;
    if (f(11) > 0) c.startingEase = round3(f(11));
    if (f(12) > 0) c.easyBonus = round3(f(12));
    if (f(13) > 0) c.hardInterval = round3(f(13));
    c.newInterval = round3(f(14) ?? 0);
    if (f(15) > 0) c.intervalModifier = round3(f(15));
    if (p.uint(16)) c.maximumInterval = p.uint(16);
    if (p.uint(17)) c.minimumLapseInterval = p.uint(17);
    if (p.uint(18)) c.graduatingInterval = p.uint(18);
    if (p.uint(19)) c.easyInterval = p.uint(19);
    c.newOrder = p.uint(20) === 1 ? 1 : 0;
    c.leechAction = p.uint(21) === 1 ? 1 : 0;
    if (p.uint(22) !== null) c.leechThreshold = p.uint(22);
    c.autoplay = !p.bool(23);
    if (p.uint(24)) c.maxAnswerSecs = p.uint(24);
    c.replayQuestion = !p.bool(26);
    c.buryNew = !!p.bool(27);
    c.buryReviews = !!p.bool(28);
    c.buryInterday = !!p.bool(29);
    c.newMix = p.uint(30) ?? 0;
    c.interdayMix = p.uint(31) ?? 0;
    if (f(37) > 0.5 && f(37) < 1) c.desiredRetention = round3(f(37));
    return c;
  });
}
const round3 = (x) => Math.round(x * 1000) / 1000;
