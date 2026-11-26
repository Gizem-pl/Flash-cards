// A study session following Anki's v3 queue rules: intraday learning cards when due, then reviews / interday learning /
// new cards mixed per the deck options, with daily limits applied through the deck tree.
import { answerCard, previewAll, CardType, Queue } from './scheduler.js';
import { deckParentName, naturalQueue, LATER_TAG } from './collection.js';

export class StudySession {
  /** deckId: one deck id, or an array of deck ids (a custom deck) studied together with their subdecks. */
  constructor(col, deckId) {
    this.col = col;
    this.deckIds = Array.isArray(deckId) ? [...deckId] : [deckId];
    this.deckId = this.deckIds[0];
    this.learning = [];
    this.main = [];
    this.undoStack = [];
    this.front = null; // card id that Undo brought back
    this.rebuild();
  }

  config(did) { return this.col.configForDeck(did); }

  rebuild() {
    const col = this.col;
    col.unburyIfNeeded();
    const roots = this.deckIds.filter((id) => col.deck(id));
    if (!roots.length) { this.learning = []; this.main = []; return; }
    this.deckId = roots[0];
    const deckIds = new Set(roots.flatMap((id) => col.deckAndDescendantIds(id)));
    const today = col.today, dayEnd = col.nextDayAt;
    const relevant = col.allDecks().filter((d) => deckIds.has(d.id));
    const byName = new Map(relevant.map((d) => [d.name.toLowerCase(), d]));

    // remaining limits per deck (subtree done counts); parent limits above the selected decks are not applied (Anki default)
    const remNew = new Map(), remRev = new Map(), ignoreRev = new Map(), parentOf = new Map();
    for (const d of relevant) {
      const cfg = this.config(d.id);
      const prefix = d.name.toLowerCase() + '::';
      let n = 0, r = 0;
      for (const x of relevant) if (x.id === d.id || x.name.toLowerCase().startsWith(prefix)) { const t = col.doneToday(x.id); n += t.new; r += t.review; }
      remRev.set(d.id, Math.max(0, cfg.reviewsPerDay - r - (cfg.newIgnoreReviewLimit ? 0 : n)));
      remNew.set(d.id, Math.max(0, cfg.newPerDay - n));
      ignoreRev.set(d.id, cfg.newIgnoreReviewLimit);
      const p = deckParentName(d.name);
      if (p && byName.has(p.toLowerCase())) parentOf.set(d.id, byName.get(p.toLowerCase()).id);
    }
    const chain = (did) => { const out = [did]; let cur = did; while (parentOf.has(cur)) { cur = parentOf.get(cur); out.push(cur); } return out; };

    const all = [...col.cards.values()].filter((c) => deckIds.has(c.did));
    this.learning = all.filter((c) => c.queue === Queue.Learning && c.due < dayEnd).sort((a, b) => a.due - b.due);

    const buried = new Set();
    if (relevant.some((d) => { const c = this.config(d.id); return c.buryNew || c.buryReviews; })) this.learning.forEach((c) => buried.add(c.nid));

    // reviews + interday learning: due date, then a stable pseudo-random order
    const rnd = (c) => (c.id * 2654435761) % 1000003;
    const due = all.filter((c) => (c.queue === Queue.Review || c.queue === Queue.DayLearning) && c.due <= today)
      .sort((a, b) => a.due - b.due || rnd(a) - rnd(b));
    const reviews = [], interday = [];
    for (const c of due) {
      const ch = chain(c.did);
      if (!ch.every((d) => remRev.get(d) > 0)) continue;
      const cfg = this.config(c.did);
      if (c.queue === Queue.Review && cfg.buryReviews && buried.has(c.nid)) continue;
      if (c.queue === Queue.DayLearning && cfg.buryInterday && buried.has(c.nid)) continue;
      ch.forEach((d) => remRev.set(d, remRev.get(d) - 1));
      (c.queue === Queue.Review ? reviews : interday).push(c);
      if (cfg.buryReviews || cfg.buryNew) buried.add(c.nid);
    }

    // new cards: deck order, then position
    const newCards = [];
    for (const d of relevant) {
      const cfg = this.config(d.id);
      const ch = chain(d.id);
      const canTake = () => ch.every((x) => remNew.get(x) > 0 && (ignoreRev.get(x) || remRev.get(x) > 0));
      if (!canTake()) continue;
      const cards = all.filter((c) => c.did === d.id && c.queue === Queue.New)
        .sort(cfg.newOrder === 1 ? (a, b) => rnd(a) - rnd(b) : (a, b) => a.due - b.due || a.ord - b.ord);
      for (const c of cards) {
        if (!canTake()) break;
        if (cfg.buryNew && buried.has(c.nid)) continue;
        ch.forEach((x) => { remNew.set(x, remNew.get(x) - 1); if (!ignoreRev.get(x)) remRev.set(x, remRev.get(x) - 1); });
        newCards.push(c);
        if (cfg.buryNew || cfg.buryReviews) buried.add(c.nid);
      }
    }
    const rootCfg = this.config(this.deckId);
    this.main = mix(mix(reviews, interday, rootCfg.interdayMix), newCards, rootCfg.newMix);
  }

  get counts() {
    const dayEnd = this.col.nextDayAt;
    const c = { new: 0, learning: this.learning.filter((x) => x.due < dayEnd).length, review: 0 };
    for (const x of this.main) {
      if (x.queue === Queue.New) c.new++;
      else if (x.queue === Queue.Review) c.review++;
      else c.learning++;
    }
    return c;
  }

  nextCard() {
    const now = this.col.now;
    // a card brought back by Undo is shown again straight away (like Anki), even if a learning card is due
    if (this.front) {
      const c = this.main.find((x) => x.id === this.front) || this.learning.find((x) => x.id === this.front);
      if (c) return c;
      this.front = null;
    }
    if (this.learning[0] && this.learning[0].due <= now) return this.learning[0];
    if (this.main[0]) return this.main[0];
    if (this.learning[0] && this.learning[0].due <= now + this.col.learnAhead) return this.learning[0];
    return null;
  }

  get nextLearningDue() { return this.learning[0]?.due ?? null; }
  get canUndo() { return this.undoStack.length > 0; }

  context(card) {
    const col = this.col;
    const ctx = { config: this.config(card.did), fsrs: col.fsrs, now: col.now, today: col.today, nextDayAt: col.nextDayAt };
    if (card.lrt) ctx.lastReviewDay = col.dayIndex(card.lrt);
    else if (card.type !== CardType.New) {
      const log = col.revlogFor(card.id).filter((r) => r.ease > 0);
      if (log.length) ctx.lastReviewDay = col.dayIndex(Math.floor(log[log.length - 1].id / 1000));
    }
    return ctx;
  }

  previews(card) { return previewAll(card, this.context(card)); }

  answer(card, rating, timeMs) {
    const col = this.col;
    this.front = null;
    const ctx = this.context(card);
    const result = answerCard(card, rating, ctx);
    const cfg = ctx.config;
    const entry = { kind: 'answer', before: { ...card }, revlogId: 0, siblings: [], noteTags: null, newDelta: 0, reviewDelta: 0, learning: [...this.learning], main: [...this.main] };
    const updated = result.card;
    const note = col.note(card.nid);
    if (result.leech) {
      if (note) { entry.noteTags = [...note.tags]; col.addTags(['leech'], [note.id]); }
      if (cfg.leechAction === 0) updated.queue = Queue.Suspended;
    }
    // Good or Easy takes the card off the Later list
    if (rating >= 3 && col.isLater(note)) {
      if (!entry.noteTags) entry.noteTags = [...note.tags];
      col.removeTags([LATER_TAG], [note.id]);
      result.leftLater = true;
    }
    col.saveCard(updated);
    entry.revlogId = col.newId(col.revlog);
    col.addRevlog({ id: entry.revlogId, cid: card.id, ease: rating, ivl: result.revlog.ivl, lastIvl: result.revlog.lastIvl,
      factor: result.revlog.factor, time: Math.min(timeMs, cfg.maxAnswerSecs * 1000), type: result.revlog.type });
    // a card set aside earlier today is buried; count it by the queue it would be in
    const queue = card.queue < 0 ? naturalQueue(card) : card.queue;
    if (queue === Queue.New) entry.newDelta = 1;
    if (queue === Queue.Review || queue === Queue.DayLearning) entry.reviewDelta = 1;
    if (entry.newDelta + entry.reviewDelta) col.incrementToday(card.did, entry.newDelta, entry.reviewDelta);

    if (cfg.buryNew || cfg.buryReviews || cfg.buryInterday) {
      for (const s of col.cardsOfNote(card.nid)) {
        if (s.id === card.id) continue;
        const bury = (s.queue === Queue.New && cfg.buryNew) || (s.queue === Queue.Review && cfg.buryReviews && s.due <= ctx.today)
          || (s.queue === Queue.DayLearning && cfg.buryInterday && s.due <= ctx.today);
        if (bury) { entry.siblings.push({ ...s }); col.saveCard({ ...s, queue: Queue.SchedBuried }); }
      }
    }
    const buriedIds = new Set(entry.siblings.map((s) => s.id));
    this.learning = this.learning.filter((c) => c.id !== card.id);
    this.main = this.main.filter((c) => c.id !== card.id && !buriedIds.has(c.id));
    if (updated.queue === Queue.Learning && updated.due < ctx.nextDayAt) {
      const i = this.learning.findIndex((c) => c.due > updated.due);
      this.learning.splice(i < 0 ? this.learning.length : i, 0, updated);
    }
    this.pushUndo(entry);
    return result;
  }

  pushUndo(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  /**
   * Runs a change to some cards made from the study menu (bury, suspend, flag, reset, set aside) so that Undo can revert it.
   * `showId` is the card on screen, which comes back first after the undo.
   */
  change(label, ids, showId, fn) {
    const col = this.col;
    const cards = ids.map((id) => col.card(id)).filter(Boolean).map((c) => ({ ...c }));
    const oldLog = new Set(ids.flatMap((id) => col.revlogFor(id).map((r) => r.id)));
    const notes = [...new Set(cards.map((c) => c.nid))].map((id) => col.note(id)).filter(Boolean).map((n) => ({ id: n.id, tags: [...n.tags] }));
    const setAside = ids.map((id) => [id, col.setAsideInfo(id)]);
    const entry = { kind: 'change', label, cards, notes, setAside, showId, learning: [...this.learning], main: [...this.main] };
    fn();
    entry.revlogIds = ids.flatMap((id) => col.revlogFor(id).map((r) => r.id)).filter((id) => !oldLog.has(id));
    this.pushUndo(entry);
  }

  /** What the next Undo would revert, for the toast. */
  get undoLabel() { const e = this.undoStack[this.undoStack.length - 1]; return e ? (e.kind === 'change' ? e.label : 'answer') : null; }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    const col = this.col;
    // the saved queues hold the cards as they were; use the current copies and drop any that were buried,
    // suspended or deleted since
    const fresh = (list, ok) => list.map((c) => col.card(c.id)).filter((c) => c && ok(c));
    const inMain = (c) => this.canShow(c);
    const inLearning = (c) => c.queue === Queue.Learning;
    if (e.kind === 'change') {
      e.cards.forEach((c) => col.saveCard({ ...c }));
      e.revlogIds.forEach((id) => col.removeRevlog(id));
      e.notes.forEach(({ id, tags }) => { const n = col.note(id); if (n) { n.tags = tags; col._put('notes', n); } });
      e.setAside.forEach(([id, info]) => col.restoreSetAside(id, info));
      this.learning = fresh(e.learning, inLearning);
      this.main = fresh(e.main, inMain);
      const shown = col.card(e.showId);
      if (shown && this.canShow(shown) && !this.main.some((c) => c.id === shown.id) && !this.learning.some((c) => c.id === shown.id)) this.main.unshift(shown);
      this.front = shown ? shown.id : null;
      return shown;
    }
    col.saveCard({ ...e.before });
    col.removeRevlog(e.revlogId);
    e.siblings.forEach((s) => col.saveCard({ ...s }));
    if (e.noteTags) { const n = col.note(e.before.nid); if (n) { n.tags = e.noteTags; col._put('notes', n); } }
    if (e.newDelta + e.reviewDelta) col.incrementToday(e.before.did, -e.newDelta, -e.reviewDelta);
    this.learning = fresh(e.learning.filter((c) => c.id !== e.before.id), inLearning);
    this.main = [col.card(e.before.id), ...fresh(e.main.filter((c) => c.id !== e.before.id), inMain)];
    this.front = e.before.id;
    return e.before;
  }

  /** Whether a card may be in this session's queue (after an undo). */
  canShow(c) { return c.queue >= 0; }

  remove(ids) {
    const set = new Set(ids);
    this.learning = this.learning.filter((c) => !set.has(c.id));
    this.main = this.main.filter((c) => !set.has(c.id));
  }

  refresh(id) {
    const fresh = this.col.card(id);
    if (!fresh) return this.remove([id]);
    this.learning = this.learning.map((c) => (c.id === id ? fresh : c));
    this.main = this.main.map((c) => (c.id === id ? fresh : c));
  }
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * A fixed round of cards (random practice, the Later list, the hardest cards), not just the due ones.
 * Answers are scheduled with Anki's 4-button scheduler, exactly like a normal study session.
 */
export class RoundSession extends StudySession {
  constructor(col, cards, deckIds = []) {
    super(col, deckIds);
    this.practice = true;
    this.learning = [];
    this.main = cards;
    this.total = cards.length;
  }

  get counts() { return { remaining: this.main.length + this.learning.length }; }
  rebuild() { /* the round is fixed once picked */ }
}

/**
 * Random round: up to `size` random cards from the given decks (and their subdecks).
 * Cards never answered yet (new) are picked first, so every card shows up once before any repeats;
 * when fewer than `size` are left, the rest is filled with random already-seen cards.
 */
export class PracticeSession extends RoundSession {
  constructor(col, deckIds, size = 25) {
    const roots = (Array.isArray(deckIds) ? deckIds : [deckIds]).filter((id) => col.deck(id));
    const ids = new Set(roots.flatMap((id) => col.deckAndDescendantIds(id)));
    // like Anki's filtered decks: suspended and buried cards are left out
    const pool = [...col.cards.values()].filter((c) => ids.has(c.did) && c.queue >= 0);
    const unseen = shuffle(pool.filter((c) => c.type === CardType.New));
    const seen = unseen.length >= size ? [] : shuffle(pool.filter((c) => c.type !== CardType.New));
    super(col, shuffle(unseen.concat(seen).slice(0, size)), deckIds);
    this.size = size;
  }
}

/**
 * The Later list, `size` cards at a time, shuffled: the ones you haven't touched for longest come first
 * (set aside or answered longest ago), so "Next 25" moves on to other cards.
 * Unlike Random practice it includes cards set aside today (which are buried until tomorrow).
 */
export class LaterSession extends RoundSession {
  constructor(col, size = 25) {
    const touched = (c) => Math.max(col.setAsideInfo(c.id).at, ...(col.revlogByCard.get(c.id) || []).map((r) => Math.floor(r.id / 1000)));
    const cards = col.laterCards().filter((c) => c.queue !== Queue.Suspended)
      .map((c) => [touched(c), c]).sort((x, y) => x[0] - y[0]).map(([, c]) => c);
    super(col, shuffle(cards.slice(0, size)));
    this.size = size;
  }

  canShow(c) { return c.queue !== Queue.Suspended; }
}

/** Practice for the given cards (e.g. the hardest ones), shuffled; suspended and buried cards are left out. */
export class CardsSession extends RoundSession {
  constructor(col, cards) {
    super(col, shuffle(cards.filter((c) => c.queue >= 0)));
  }
}

/** Interleaves `extra` evenly into `base` (or before / after it). */
export function mix(base, extra, mode) {
  if (mode === 1) return base.concat(extra);
  if (mode === 2) return extra.concat(base);
  if (!base.length || !extra.length) return base.concat(extra);
  const out = [];
  const total = base.length + extra.length, ratio = total / extra.length;
  let bi = 0, ei = 0;
  for (let i = 0; i < total; i++) {
    if (ei < extra.length && (i + 1 >= ratio * (ei + 1) - 1e-4 || bi >= base.length)) out.push(extra[ei++]);
    else out.push(base[bi++]);
  }
  return out;
}
