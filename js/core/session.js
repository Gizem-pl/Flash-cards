// A study session following Anki's v3 queue rules: intraday learning cards when due, then reviews / interday learning /
// new cards mixed per the deck options, with daily limits applied through the deck tree.
import { answerCard, previewAll, CardType, Queue } from './scheduler.js';
import { deckParentName } from './collection.js';

export class StudySession {
  /** deckId: one deck id, or an array of deck ids (a custom deck) studied together with their subdecks. */
  constructor(col, deckId) {
    this.col = col;
    this.deckIds = Array.isArray(deckId) ? [...deckId] : [deckId];
    this.deckId = this.deckIds[0];
    this.learning = [];
    this.main = [];
    this.undoStack = [];
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
    const ctx = this.context(card);
    const result = answerCard(card, rating, ctx);
    const cfg = ctx.config;
    const entry = { before: { ...card }, revlogId: 0, siblings: [], noteTags: null, newDelta: 0, reviewDelta: 0, learning: [...this.learning], main: [...this.main] };
    const updated = result.card;
    if (result.leech) {
      const note = col.note(card.nid);
      if (note) { entry.noteTags = [...note.tags]; col.addTags(['leech'], [note.id]); }
      if (cfg.leechAction === 0) updated.queue = Queue.Suspended;
    }
    col.saveCard(updated);
    entry.revlogId = col.newId(col.revlog);
    col.addRevlog({ id: entry.revlogId, cid: card.id, ease: rating, ivl: result.revlog.ivl, lastIvl: result.revlog.lastIvl,
      factor: result.revlog.factor, time: Math.min(timeMs, cfg.maxAnswerSecs * 1000), type: result.revlog.type });
    if (card.queue === Queue.New) entry.newDelta = 1;
    if (card.queue === Queue.Review || card.queue === Queue.DayLearning) entry.reviewDelta = 1;
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
    this.undoStack.push(entry);
    if (this.undoStack.length > 30) this.undoStack.shift();
    return result;
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    const col = this.col;
    col.saveCard(e.before);
    col.removeRevlog(e.revlogId);
    e.siblings.forEach((s) => col.saveCard(s));
    if (e.noteTags) { const n = col.note(e.before.nid); if (n) { n.tags = e.noteTags; col._put('notes', n); } }
    if (e.newDelta + e.reviewDelta) col.incrementToday(e.before.did, -e.newDelta, -e.reviewDelta);
    this.learning = e.learning.filter((c) => c.id !== e.before.id);
    this.main = [col.card(e.before.id), ...e.main.filter((c) => c.id !== e.before.id)];
    return e.before;
  }

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

/**
 * Random round: up to `size` random cards from the given decks (and their subdecks), not just the due ones.
 * Cards never answered yet (new) are picked first, so every card shows up once before any repeats;
 * when fewer than `size` are left, the rest is filled with random already-seen cards.
 * Answers are scheduled with Anki's 4-button scheduler, exactly like a normal study session.
 */
export class PracticeSession extends StudySession {
  constructor(col, deckIds, size = 30) {
    super(col, deckIds);
    this.practice = true;
    this.size = size;
    const ids = new Set(this.deckIds.filter((id) => col.deck(id)).flatMap((id) => col.deckAndDescendantIds(id)));
    const pool = [...col.cards.values()].filter((c) => ids.has(c.did) && c.queue !== Queue.Suspended);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const unseen = shuffle(pool.filter((c) => c.type === CardType.New));
    const seen = unseen.length >= size ? [] : shuffle(pool.filter((c) => c.type !== CardType.New));
    this.learning = [];
    this.main = shuffle(unseen.concat(seen).slice(0, size));
    this.total = this.main.length;
  }

  get counts() { return { remaining: this.main.length + this.learning.length }; }
  rebuild() { /* the round is fixed once picked */ }
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
