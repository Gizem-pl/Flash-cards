// The user's collection, kept in memory and persisted to IndexedDB.
import * as store from './storage.js';
import { DEFAULT_CONFIG, CardType, Queue, FSRS } from './scheduler.js';
import { renderCard, fieldReferences, Cloze } from './template.js';
import { stockNotetypes } from './stock.js';
import {
  dayIndex, nextDayStart, dayStartUnix, nowSecs, stripHTMLMedia, fieldChecksum, newGuid, fieldIsEmpty, mimeFor, sha1Hex,
} from './util.js';

export const DEFAULT_DECK = 1;
export const DEFAULT_CONF = 1;
export const SEP = '::';

export const normalizeDeckName = (n) => String(n).split(SEP).map((s) => s.trim()).filter(Boolean).join(SEP);
export const deckBaseName = (n) => n.split(SEP).pop();
export const deckParentName = (n) => { const p = n.split(SEP); return p.length > 1 ? p.slice(0, -1).join(SEP) : null; };

export class Collection {
  constructor() {
    this.meta = null;
    this.decks = new Map();
    this.configs = new Map();
    this.notetypes = new Map();
    this.notes = new Map();
    this.cards = new Map();
    this.cardsByNote = new Map();
    this.guidIndex = new Map();
    this.revlog = new Map();        // id -> entry
    this.revlogByCard = new Map();  // cid -> [entries]
    this.todayCounts = new Map();   // "did:day" -> {new, review}
    this.mediaNames = new Set();
    this.pending = [];
    this.flushTimer = null;
    this.lastId = 0;
    this.clock = () => Date.now();
    this.listeners = new Set();
  }

  // ------------------------------------------------------------ load / persist

  static async load() {
    const col = new Collection();
    const [meta, decks, configs, notetypes, notes, cards, revlog, today, media] = await Promise.all([
      store.get('meta', 'col'), store.getAll('decks'), store.getAll('configs'), store.getAll('notetypes'),
      store.getAll('notes'), store.getAll('cards'), store.getAll('revlog'), store.getAllWithKeys('today'), store.getKeys('media'),
    ]);
    for (const d of decks) col.decks.set(d.id, d);
    for (const c of configs) col.configs.set(c.id, c);
    for (const n of notetypes) col.notetypes.set(n.id, n);
    for (const n of notes) { col.notes.set(n.id, n); col.guidIndex.set(n.guid, n.id); }
    for (const c of cards) col._indexCard(c);
    for (const r of revlog) col._indexRevlog(r);
    for (const [k, v] of today) col.todayCounts.set(k, v);
    for (const m of media) col.mediaNames.add(m);
    if (!meta) col._initialize();
    else col.meta = meta;
    await col.flush();
    return col;
  }

  _initialize() {
    const now = nowSecs();
    const d = new Date((now - 4 * 3600) * 1000);
    const crt = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4).getTime() / 1000);
    this.meta = { crt, rollover: 4, fsrs: false, learnAhead: 1200, nextPos: 1, lastUnbury: -1 };
    this._saveMeta();
    this.saveConfig({ ...DEFAULT_CONFIG, id: DEFAULT_CONF, name: 'Default' });
    this.saveDeck({ id: DEFAULT_DECK, name: 'Default', conf: DEFAULT_CONF, desc: '', collapsed: false, mod: now });
    for (const nt of stockNotetypes(Date.now())) this.saveNotetype(nt);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(); }

  _queue(op) {
    if (this._closed) return;
    this.pending.push(op);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 0);
  }
  _put(storeName, obj) { this._queue({ store: storeName, put: obj }); }
  _del(storeName, key) { this._queue({ store: storeName, del: key }); }
  _saveMeta() { this._queue({ store: 'meta', put: this.meta, key: 'col' }); }

  async flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const ops = this.pending;
    this.pending = [];
    if (!ops.length) return;
    // de-duplicate writes to the same record (last write wins)
    const last = new Map();
    ops.forEach((o, i) => { const key = o.store + ':' + (o.key ?? o.del ?? o.put?.id ?? i); last.set(key, o); });
    const deduped = [...last.values()];
    for (let i = 0; i < deduped.length; i += 5000) await store.write(deduped.slice(i, i + 5000));
  }

  // ------------------------------------------------------------ settings

  get crt() { return this.meta.crt; }
  get rollover() { return this.meta.rollover; }
  set rollover(v) { this.meta.rollover = v; this._saveMeta(); }
  get fsrs() { return this.meta.fsrs; }
  set fsrs(v) { this.meta.fsrs = !!v; this._saveMeta(); }
  get learnAhead() { return this.meta.learnAhead; }
  set learnAhead(v) { this.meta.learnAhead = v; this._saveMeta(); }

  // ------------------------------------------------------------ time

  get now() { return Math.floor(this.clock() / 1000); }
  dayIndex(unix) { return dayIndex(unix, this.crt, this.rollover); }
  get today() { return this.dayIndex(this.now); }
  get nextDayAt() { return nextDayStart(this.now, this.rollover); }
  dayStart(day) { return dayStartUnix(day, this.crt, this.rollover); }

  unburyIfNeeded() {
    const t = this.today;
    if (this.meta.lastUnbury >= t) return;
    for (const c of this.cards.values()) {
      if (c.queue === Queue.SchedBuried || c.queue === Queue.UserBuried) { c.queue = naturalQueue(c); this._put('cards', c); }
    }
    for (const k of this.todayCounts.keys()) {
      if (Number(k.split(':')[1]) < t - 1) { this.todayCounts.delete(k); this._del('today', k); }
    }
    this.meta.lastUnbury = t;
    this._saveMeta();
  }

  newId(map) {
    let id = Math.max(this.clock(), this.lastId + 1);
    while (map.has(id)) id++;
    this.lastId = id;
    return id;
  }

  // ------------------------------------------------------------ deck configs

  allConfigs() { return [...this.configs.values()].sort((a, b) => a.id - b.id); }
  config(id) { return this.configs.get(id); }
  configForDeck(did) {
    const d = this.decks.get(did);
    return { ...DEFAULT_CONFIG, ...(this.configs.get(d?.conf) || this.configs.get(DEFAULT_CONF)) };
  }
  saveConfig(c) { const cfg = { ...DEFAULT_CONFIG, ...c, mod: this.now }; this.configs.set(cfg.id, cfg); this._put('configs', cfg); return cfg; }
  addConfig(name, base) {
    const cfg = { ...DEFAULT_CONFIG, ...(base || {}), id: this.newId(this.configs), name };
    return this.saveConfig(cfg);
  }
  deleteConfig(id) {
    if (id === DEFAULT_CONF) return;
    for (const d of this.decks.values()) if (d.conf === id) { d.conf = DEFAULT_CONF; this._put('decks', d); }
    this.configs.delete(id);
    this._del('configs', id);
  }

  // ------------------------------------------------------------ decks

  allDecks() { return [...this.decks.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); }
  deck(id) { return this.decks.get(id); }
  deckByName(name) {
    const n = normalizeDeckName(name).toLowerCase();
    for (const d of this.decks.values()) if (d.name.toLowerCase() === n) return d;
    return null;
  }
  getOrCreateDeck(rawName, conf = null, preferredId = null) {
    const name = normalizeDeckName(rawName);
    if (!name) throw new Error("Deck name can't be empty.");
    const existing = this.deckByName(name);
    if (existing) return existing;
    let parentConf = conf ?? DEFAULT_CONF;
    const parent = deckParentName(name);
    if (parent) { const p = this.getOrCreateDeck(parent, conf); parentConf = conf ?? p.conf; }
    const id = preferredId && !this.decks.has(preferredId) ? preferredId : this.newId(this.decks);
    const d = { id, name, conf: parentConf, desc: '', collapsed: false, mod: this.now };
    this.saveDeck(d);
    return d;
  }
  saveDeck(d) { d.mod = this.now; this.decks.set(d.id, d); this._put('decks', d); }
  descendants(id) {
    const d = this.decks.get(id);
    if (!d) return [];
    const prefix = d.name.toLowerCase() + SEP;
    return [...this.decks.values()].filter((x) => x.name.toLowerCase().startsWith(prefix));
  }
  deckAndDescendantIds(id) { return [id, ...this.descendants(id).map((d) => d.id)]; }
  renameDeck(id, raw) {
    const d = this.decks.get(id);
    const name = normalizeDeckName(raw);
    if (!d || !name) throw new Error("Deck name can't be empty.");
    const other = this.deckByName(name);
    if (other && other.id !== id) throw new Error(`A deck named ${name} already exists.`);
    const old = d.name;
    for (const c of this.descendants(id)) { c.name = name + c.name.slice(old.length); this.saveDeck(c); }
    d.name = name;
    this.saveDeck(d);
    const parent = deckParentName(name);
    if (parent) this.getOrCreateDeck(parent);
  }
  deleteDeck(id) {
    const ids = new Set(this.deckAndDescendantIds(id));
    this.deleteCards([...this.cards.values()].filter((c) => ids.has(c.did)).map((c) => c.id));
    for (const did of ids) if (did !== DEFAULT_DECK) { this.decks.delete(did); this._del('decks', did); }
  }

  // ------------------------------------------------------------ notetypes

  allNotetypes() { return [...this.notetypes.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  notetype(id) { return this.notetypes.get(id); }
  saveNotetype(nt) { if (!nt.mod) nt.mod = this.now; this.notetypes.set(nt.id, nt); this._put('notetypes', nt); }
  noteCount(mid) { let n = 0; for (const x of this.notes.values()) if (x.mid === mid) n++; return n; }
  deleteNotetype(id) {
    this.deleteNotes([...this.notes.values()].filter((n) => n.mid === id).map((n) => n.id));
    this.notetypes.delete(id);
    this._del('notetypes', id);
  }

  // ------------------------------------------------------------ notes

  note(id) { return this.notes.get(id); }
  noteByGuid(guid) { const id = this.guidIndex.get(guid); return id ? this.notes.get(id) : null; }
  writeNote(n) {
    const nt = this.notetypes.get(n.mid);
    const idx = Math.min(nt?.sortf || 0, Math.max(n.flds.length - 1, 0));
    n.sfld = stripHTMLMedia(n.flds[idx] || '');
    n.csum = fieldChecksum(n.flds[0] || '');
    this.notes.set(n.id, n);
    this.guidIndex.set(n.guid, n.id);
    this._put('notes', n);
  }
  addNote(input, did) {
    const nt = this.notetypes.get(input.mid);
    if (!nt) throw new Error('Note type not found.');
    const n = { id: 0, guid: '', tags: [], ...input, flds: [...input.flds] };
    while (n.flds.length < nt.flds.length) n.flds.push('');
    const ords = this.generatedOrds(n.flds, nt);
    if (!ords.length) throw new Error('This note would not create any cards. Fill in the front of the card (or add a cloze such as {{c1::text}}).');
    if (!n.id) n.id = this.newId(this.notes);
    if (!n.guid) n.guid = newGuid();
    n.mod = this.now;
    this.writeNote(n);
    return this._generateCards(n, nt, ords, did);
  }
  updateNote(input) {
    const nt = this.notetypes.get(input.mid);
    const n = { ...input, mod: this.now };
    this.writeNote(n);
    const existing = new Set(this.cardsOfNote(n.id).map((c) => c.ord));
    const missing = this.generatedOrds(n.flds, nt).filter((o) => !existing.has(o));
    if (missing.length) {
      const did = this.cardsOfNote(n.id)[0]?.did ?? DEFAULT_DECK;
      this._generateCards(n, nt, missing, did);
    }
    return n;
  }
  deleteNotes(ids) {
    for (const nid of ids) {
      for (const c of this.cardsOfNote(nid)) this._removeCard(c.id);
      const n = this.notes.get(nid);
      if (n) { this.guidIndex.delete(n.guid); this.notes.delete(nid); this._del('notes', nid); }
    }
  }
  addTags(tags, nids) {
    for (const id of nids) {
      const n = this.notes.get(id);
      if (!n) continue;
      for (const t of tags) if (!n.tags.some((x) => x.toLowerCase() === t.toLowerCase())) n.tags.push(t);
      n.mod = this.now;
      this._put('notes', n);
    }
  }
  allTags() {
    const set = new Set();
    for (const n of this.notes.values()) n.tags.forEach((t) => set.add(t));
    return [...set].sort((a, b) => a.localeCompare(b));
  }
  isDuplicate(note) {
    const first = note.flds[0];
    if (fieldIsEmpty(first)) return false;
    const csum = fieldChecksum(first), stripped = stripHTMLMedia(first);
    for (const n of this.notes.values()) {
      if (n.id !== note.id && n.mid === note.mid && n.csum === csum && stripHTMLMedia(n.flds[0]) === stripped) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ card generation

  generatedOrds(fields, nt) {
    const map = {};
    nt.flds.forEach((f, i) => { map[f.name] = fields[i] ?? ''; });
    if (nt.type === 1) {
      const t = nt.tmpls[0];
      if (!t) return [];
      const clozeFields = fieldReferences(t.qfmt).filter((r) => r.filters.includes('cloze')).map((r) => r.field);
      const ords = new Set();
      for (const f of clozeFields) Cloze.ordinals(map[f] || '').forEach((o) => ords.add(o));
      return [...ords].sort((a, b) => a - b).map((o) => o - 1);
    }
    return nt.tmpls.filter((t) => !renderCard(t.qfmt, '', '', { fields: map, ord: t.ord, isCloze: false }).isEmpty).map((t) => t.ord);
  }

  _generateCards(n, nt, ords, did) {
    const pos = this.meta.nextPos++;
    this._saveMeta();
    const valid = this.decks.has(did) ? did : DEFAULT_DECK;
    return ords.map((ord) => {
      let deck = valid;
      const target = nt.type === 0 ? nt.tmpls[ord]?.did : null;
      if (target && this.decks.has(target)) deck = target;
      const c = newCard(this.newId(this.cards), n.id, deck, ord, pos, this.now);
      this.saveCard(c);
      return c;
    });
  }

  // ------------------------------------------------------------ cards

  _indexCard(c) {
    this.cards.set(c.id, c);
    let list = this.cardsByNote.get(c.nid);
    if (!list) { list = []; this.cardsByNote.set(c.nid, list); }
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = c; else list.push(c);
  }
  _removeCard(id) {
    const c = this.cards.get(id);
    if (!c) return;
    this.cards.delete(id);
    this._del('cards', id);
    const list = this.cardsByNote.get(c.nid);
    if (list) { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); if (!list.length) this.cardsByNote.delete(c.nid); }
    for (const r of this.revlogByCard.get(id) || []) { this.revlog.delete(r.id); this._del('revlog', r.id); }
    this.revlogByCard.delete(id);
  }
  card(id) { return this.cards.get(id); }
  cardsOfNote(nid) { return [...(this.cardsByNote.get(nid) || [])].sort((a, b) => a.ord - b.ord); }
  saveCard(c) { this._indexCard(c); this._put('cards', c); }
  deleteCards(ids) {
    const nids = new Set();
    for (const id of ids) { const c = this.cards.get(id); if (c) { nids.add(c.nid); this._removeCard(id); } }
    for (const nid of nids) if (!this.cardsByNote.has(nid)) this.deleteNotes([nid]);
  }
  setSuspended(suspend, ids) {
    for (const id of ids) {
      const c = this.cards.get(id);
      if (!c) continue;
      c.queue = suspend ? Queue.Suspended : naturalQueue(c);
      c.mod = this.now;
      this.saveCard(c);
    }
  }
  bury(ids) { for (const id of ids) { const c = this.cards.get(id); if (c) { c.queue = Queue.UserBuried; c.mod = this.now; this.saveCard(c); } } }
  setFlag(flag, ids) { for (const id of ids) { const c = this.cards.get(id); if (c) { c.flags = (c.flags & ~7) | (flag & 7); c.mod = this.now; this.saveCard(c); } } }
  moveCards(ids, did) { for (const id of ids) { const c = this.cards.get(id); if (c) { c.did = did; c.mod = this.now; this.saveCard(c); } } }
  resetToNew(ids) {
    for (const id of ids) {
      const c = this.cards.get(id);
      if (!c) continue;
      const last = c.ivl;
      Object.assign(c, { type: 0, queue: 0, due: this.meta.nextPos++, ivl: 0, factor: 0, left: 0, reps: 0, lapses: 0, s: null, d: null, lrt: null, mod: this.now });
      this.saveCard(c);
      this.addRevlog({ id: this.newId(this.revlog), cid: id, ease: 0, ivl: 0, lastIvl: last, factor: 0, time: 0, type: 4 });
    }
    this._saveMeta();
  }
  setDueDate(ids, days) {
    const t = this.today;
    for (const id of ids) {
      const c = this.cards.get(id);
      if (!c) continue;
      if (c.type === CardType.New || c.type === CardType.Learning) {
        c.ivl = Math.max(days, 1);
        c.factor = Math.round(this.configForDeck(c.did).startingEase * 1000);
      }
      Object.assign(c, { type: 2, queue: 2, due: t + days, left: 0, mod: this.now });
      this.saveCard(c);
      this.addRevlog({ id: this.newId(this.revlog), cid: id, ease: 0, ivl: c.ivl, lastIvl: c.ivl, factor: c.factor, time: 0, type: 4 });
    }
  }

  // ------------------------------------------------------------ revlog

  _indexRevlog(r) {
    this.revlog.set(r.id, r);
    let list = this.revlogByCard.get(r.cid);
    if (!list) { list = []; this.revlogByCard.set(r.cid, list); }
    list.push(r);
  }
  addRevlog(r) { this._indexRevlog(r); this._put('revlog', r); }
  removeRevlog(id) {
    const r = this.revlog.get(id);
    if (!r) return;
    this.revlog.delete(id);
    const list = this.revlogByCard.get(r.cid);
    if (list) { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); }
    this._del('revlog', id);
  }
  revlogFor(cid) { return [...(this.revlogByCard.get(cid) || [])].sort((a, b) => a.id - b.id); }

  // ------------------------------------------------------------ today counts

  incrementToday(did, nw, rv) {
    const key = `${did}:${this.today}`;
    const v = this.todayCounts.get(key) || { new: 0, review: 0 };
    v.new += nw; v.review += rv;
    this.todayCounts.set(key, v);
    this._queue({ store: 'today', put: v, key });
  }
  doneToday(did) { return this.todayCounts.get(`${did}:${this.today}`) || { new: 0, review: 0 }; }

  // ------------------------------------------------------------ rendering

  render(card, typed = null) {
    const n = this.notes.get(card.nid);
    const nt = n && this.notetypes.get(n.mid);
    if (!nt) throw new Error('Note or note type missing.');
    return this.renderNote(n, nt, card.ord, { did: card.did, flag: card.flags & 7, cardId: card.id, typed });
  }
  renderNote(n, nt, ord, { did = null, flag = 0, cardId = 0, typed = null } = {}) {
    const fields = {};
    nt.flds.forEach((f, i) => { fields[f.name] = n.flds[i] ?? ''; });
    const t = nt.type === 1 ? nt.tmpls[0] : nt.tmpls.find((x) => x.ord === ord) || nt.tmpls[0];
    return renderCard(t.qfmt, t.afmt, nt.css, {
      fields, ord, isCloze: nt.type === 1, tags: n.tags, notetypeName: nt.name, deckName: this.decks.get(did)?.name || '',
      templateName: t.name, flag, cardId, latexPre: nt.latexPre, latexPost: nt.latexPost, mediaExists: (m) => this.mediaNames.has(m),
    }, typed);
  }

  // ------------------------------------------------------------ media

  async mediaBlob(name) { return store.get('media', name); }

  /** Stores a file, returning its (possibly renamed) name. */
  async addMedia(data, preferredName) {
    let name = String(preferredName).replace(/[\/\\:*?"<>|]/g, '_') || 'file';
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeFor(name) });
    if (this.mediaNames.has(name)) {
      const existing = await this.mediaBlob(name);
      if (existing && existing.size === blob.size && await sameBytes(existing, blob)) return name;
      const buf = new Uint8Array(await blob.arrayBuffer());
      const hash = sha1Hex(buf).slice(0, 8);
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)}-${hash}${name.slice(dot)}` : `${name}-${hash}`;
    }
    await store.write([{ store: 'media', put: blob, key: name }]);
    this.mediaNames.add(name);
    return name;
  }

  // ------------------------------------------------------------ deck tree

  deckTree() {
    this.unburyIfNeeded();
    const t = this.today, dayEnd = this.nextDayAt;
    const newC = new Map(), revC = new Map(), lrnC = new Map(), total = new Map();
    const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (const c of this.cards.values()) {
      inc(total, c.did);
      if (c.queue === Queue.New) inc(newC, c.did);
      else if (c.queue === Queue.Review && c.due <= t) inc(revC, c.did);
      else if ((c.queue === Queue.Learning && c.due < dayEnd) || (c.queue === Queue.DayLearning && c.due <= t)) inc(lrnC, c.did);
    }
    const decks = this.allDecks();
    const byName = new Map(decks.map((d) => [d.name.toLowerCase(), d]));
    const children = new Map();
    const roots = [];
    for (const d of decks) {
      const p = deckParentName(d.name);
      const parent = p && byName.get(p.toLowerCase());
      if (parent) { if (!children.has(parent.id)) children.set(parent.id, []); children.get(parent.id).push(d); } else roots.push(d);
    }
    const doneSub = (d) => {
      const x = this.doneToday(d.id);
      let n = x.new, r = x.review;
      for (const c of children.get(d.id) || []) { const y = doneSub(c); n += y[0]; r += y[1]; }
      return [n, r];
    };
    const build = (d) => {
      const kids = (children.get(d.id) || []).map(build);
      const cfg = this.configForDeck(d.id);
      const [dn, dr] = doneSub(d);
      const revRemaining = Math.max(0, cfg.reviewsPerDay - dr - (cfg.newIgnoreReviewLimit ? 0 : dn));
      const newRemaining = Math.max(0, cfg.newPerDay - dn);
      const sum = (k) => kids.reduce((a, x) => a + x.counts[k], 0);
      const review = Math.min(revRemaining, (revC.get(d.id) || 0) + sum('review'));
      const newLimit = cfg.newIgnoreReviewLimit ? newRemaining : Math.min(newRemaining, Math.max(0, revRemaining - review));
      const nw = Math.min(newLimit, (newC.get(d.id) || 0) + sum('new'));
      const learning = (lrnC.get(d.id) || 0) + sum('learning');
      const tot = (total.get(d.id) || 0) + kids.reduce((a, x) => a + x.total, 0);
      return { deck: d, counts: { new: nw, learning, review }, total: tot, children: kids };
    };
    let tree = roots.map(build);
    if (tree.length > 1) tree = tree.filter((n) => !(n.deck.id === DEFAULT_DECK && n.total === 0 && !n.children.length));
    return tree;
  }

  // ------------------------------------------------------------ FSRS

  recomputeMemoryStates() {
    for (const c of this.cards.values()) {
      if (c.type === CardType.New) continue;
      const cfg = this.configForDeck(c.did);
      const fsrs = new FSRS(cfg.fsrsParams);
      let history = [];
      for (const r of this.revlogFor(c.id)) {
        if (r.type === 4 && r.ease === 0) { history = []; continue; }
        if (r.ease >= 1 && r.ease <= 4) history.push({ day: this.dayIndex(Math.floor(r.id / 1000)), rating: r.ease });
      }
      const m = history.length ? fsrs.fromHistory(history) : fsrs.fromSM2(Math.max(c.factor, 1300) / 1000, Math.max(c.ivl, 1), cfg.desiredRetention);
      c.s = m.s; c.d = m.d;
      this._put('cards', c);
    }
  }

  // ------------------------------------------------------------ maintenance

  checkDatabase() {
    const problems = [];
    let n = 0;
    for (const c of [...this.cards.values()]) if (!this.notes.has(c.nid)) { this._removeCard(c.id); n++; }
    if (n) problems.push(`Deleted ${n} cards with missing notes.`);
    n = 0;
    for (const note of [...this.notes.values()]) if (!this.cardsByNote.has(note.id)) { this.deleteNotes([note.id]); n++; }
    if (n) problems.push(`Deleted ${n} notes without cards.`);
    n = 0;
    for (const c of this.cards.values()) if (!this.decks.has(c.did)) { c.did = DEFAULT_DECK; this._put('cards', c); n++; }
    if (n) problems.push(`Moved ${n} cards with missing decks to Default.`);
    n = 0;
    for (const d of this.decks.values()) if (!this.configs.has(d.conf)) { d.conf = DEFAULT_CONF; this._put('decks', d); n++; }
    if (n) problems.push(`Fixed ${n} decks with missing presets.`);
    n = 0;
    for (const r of [...this.revlog.values()]) if (!this.cards.has(r.cid)) { this.removeRevlog(r.id); n++; }
    if (n) problems.push(`Removed ${n} orphaned review entries.`);
    for (const n2 of this.notes.values()) {
      const nt = this.notetypes.get(n2.mid);
      if (nt && n2.flds.length < nt.flds.length) { while (n2.flds.length < nt.flds.length) n2.flds.push(''); this._put('notes', n2); }
    }
    return problems;
  }

  async eraseEverything() {
    // drop pending writes so they can't land in the fresh database
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pending = [];
    this._closed = true;
    await store.clearAll();
    const fresh = new Collection();
    fresh._initialize();
    await fresh.flush();
    return fresh;
  }
}

export function newCard(id, nid, did, ord, due, mod) {
  return { id, nid, did, ord, mod, type: 0, queue: 0, due, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, odue: 0, odid: 0, flags: 0, s: null, d: null, lrt: null };
}

export function naturalQueue(c) {
  if (c.type === CardType.New) return Queue.New;
  if (c.type === CardType.Review) return Queue.Review;
  return c.due > 1e9 ? Queue.Learning : Queue.DayLearning;
}

async function sameBytes(a, b) {
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return false;
  const u = new Uint8Array(x), v = new Uint8Array(y);
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}
