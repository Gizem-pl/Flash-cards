// Anki's v3 scheduler: SM-2 (Anki's default) and FSRS-6, ported from Anki's Rust code
// (rslib/src/scheduler/states) and fsrs-rs.
import { clamp, round } from './util.js';

export const CardType = { New: 0, Learning: 1, Review: 2, Relearning: 3 };
export const Queue = { UserBuried: -3, SchedBuried: -2, Suspended: -1, New: 0, Learning: 1, Review: 2, DayLearning: 3, Preview: 4 };
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
export const RATINGS = [1, 2, 3, 4];
export const RATING_NAMES = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
export const RevlogKind = { Learning: 0, Review: 1, Relearning: 2, Filtered: 3, Manual: 4 };

export const DEFAULT_CONFIG = Object.freeze({
  newPerDay: 20, reviewsPerDay: 200, newIgnoreReviewLimit: false,
  learnSteps: [1, 10], graduatingInterval: 1, easyInterval: 4, newOrder: 0,
  relearnSteps: [10], minimumLapseInterval: 1, leechThreshold: 8, leechAction: 1,
  newMix: 0, interdayMix: 0,
  buryNew: false, buryReviews: false, buryInterday: false,
  autoplay: true, replayQuestion: true, maxAnswerSecs: 60,
  maximumInterval: 36500, startingEase: 2.5, easyBonus: 1.3, intervalModifier: 1.0, hardInterval: 1.2, newInterval: 0.0,
  desiredRetention: 0.9, fsrsParams: [],
});

// ---------------------------------------------------------------- FSRS

export const FSRS6_DEFAULTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
const S_MIN = 0.0001, S_MAX = 36500;

export class FSRS {
  constructor(params = []) {
    let p = [...params];
    if (p.length === 17) p = p.concat([0, 0, 0, 0.5]);
    else if (p.length === 19) p = p.concat([0, 0.5]);
    else if (p.length !== 21) p = FSRS6_DEFAULTS;
    this.w = p;
    this.decay = -p[20];
    this.factor = Math.pow(0.9, 1 / this.decay) - 1;
  }
  retrievability(t, s) {
    return Math.pow(1 + this.factor * Math.round(Math.max(t, 0)) / Math.max(s, S_MIN), this.decay);
  }
  nextInterval(s, r) {
    r = clamp(r, 0.0001, 0.9999);
    return clamp(Math.max(s, S_MIN) / this.factor * (Math.pow(r, 1 / this.decay) - 1), 0, S_MAX);
  }
  initStability(g) { return Math.max(this.w[g - 1], S_MIN); }
  initDifficulty(g) { return this.w[4] - Math.exp(this.w[5] * (g - 1)) + 1; }
  nextDifficulty(d, g) {
    const w = this.w;
    const delta = -w[6] * (g - 3);
    const damped = d + delta * (10 - d) / 9;
    return clamp(w[7] * this.initDifficulty(4) + (1 - w[7]) * damped, 1, 10);
  }
  recallStability(d, s, r, g) {
    const w = this.w;
    const hard = g === 2 ? w[15] : 1, easy = g === 4 ? w[16] : 1;
    return clamp(s * (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy + 1), S_MIN, S_MAX);
  }
  forgetStability(d, s, r) {
    const w = this.w;
    const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
    return clamp(Math.min(sf, s / Math.exp(w[17] * w[18])), S_MIN, S_MAX);
  }
  shortTermStability(s, g) {
    const w = this.w;
    let inc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19]);
    if (g >= 2) inc = Math.max(inc, 1);
    return clamp(s * inc, S_MIN, S_MAX);
  }
  /** state: {s, d} or null for a new card */
  nextState(state, elapsedDays, g) {
    if (!state || !(state.s > 0)) return { s: this.initStability(g), d: clamp(this.initDifficulty(g), 1, 10) };
    const d = clamp(state.d, 1, 10), s = clamp(state.s, S_MIN, S_MAX);
    const t = Math.round(Math.max(elapsedDays, 0));
    let ns;
    if (t === 0) ns = this.shortTermStability(s, g);
    else {
      const r = this.retrievability(t, s);
      ns = g === 1 ? this.forgetStability(d, s, r) : this.recallStability(d, s, r, g);
    }
    return { s: ns, d: this.nextDifficulty(d, g) };
  }
  /** fsrs-rs memory_state_from_sm2 */
  fromSM2(ease, interval, r) {
    const w = this.w;
    const s = clamp(Math.max(interval, 0.1) / (Math.pow(r, 1 / this.decay) - 1) * this.factor, S_MIN, S_MAX);
    const denom = Math.exp(w[8]) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1);
    const d = denom > 0 ? 11 - (ease - 1) / denom : 5;
    return { s, d: clamp(d, 1, 10) };
  }
  /** reviews: [{day, rating}] oldest first */
  fromHistory(reviews) {
    let state = null, last = null;
    for (const r of reviews) {
      state = this.nextState(state, last === null ? 0 : r.day - last, r.rating);
      last = r.day;
    }
    return state;
  }
}

// ---------------------------------------------------------------- learning steps (steps.rs)

export class LearningSteps {
  constructor(minutes) { this.steps = (minutes || []).filter((m) => m > 0).map((m) => Math.floor(m * 60)); }
  get count() { return this.steps.length; }
  index(remaining) { const t = this.steps.length; return Math.max(0, Math.min(t - 1, t - (remaining % 1000))); }
  get againDelay() { return this.steps.length ? this.steps[0] : null; }
  currentDelay(remaining) { return this.steps.length ? this.steps[this.index(remaining)] : 0; }
  hardDelay(remaining) {
    if (!this.steps.length) return null;
    const idx = this.index(remaining);
    const cur = this.steps[idx];
    if (idx !== 0) return cur;
    const secs = this.steps.length > 1 ? Math.floor((cur + this.steps[1]) / 2) : Math.min(Math.floor(cur * 3 / 2), cur + 86400);
    return secs > 86400 ? round(secs / 86400) * 86400 : secs;
  }
  goodDelay(remaining) { const i = this.index(remaining) + 1; return i < this.steps.length ? this.steps[i] : null; }
  remainingForGood(remaining) { return Math.max(0, this.steps.length - (this.index(remaining) + 1)); }
}

// ---------------------------------------------------------------- fuzz (fuzz.rs)

const FUZZ_RANGES = [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]];
function fuzzDelta(ivl) {
  if (ivl < 2.5) return 0;
  return FUZZ_RANGES.reduce((d, [start, end, f]) => d + f * Math.max(Math.min(ivl, end) - start, 0), 1);
}
export function fuzzBounds(interval, minimum, maximum) {
  minimum = Math.min(minimum, maximum);
  const ivl = clamp(interval, minimum, maximum);
  const delta = fuzzDelta(ivl);
  let lower = clamp(round(ivl - delta), minimum, maximum);
  let upper = clamp(round(ivl + delta), minimum, maximum);
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;
  if (lower > upper) lower = upper;
  return [lower, upper];
}
export function withFuzz(interval, minimum, maximum, fuzz) {
  if (fuzz === null || fuzz === undefined) return clamp(round(interval), minimum, maximum);
  const [lo, hi] = fuzzBounds(interval, minimum, maximum);
  return clamp(Math.floor(lo + fuzz * (1 + hi - lo)), lo, hi);
}
function minimumReviewFuzzInterval(interval, previous, maximum) {
  const rounded = round(interval);
  const [, upper] = fuzzBounds(interval, 1, maximum);
  if (rounded > previous) return previous + 1;
  if (previous <= upper) return previous;
  return 0;
}

export function isLeech(lapses, threshold) {
  if (threshold <= 0 || lapses < threshold) return false;
  const half = Math.max(Math.ceil(threshold / 2), 1);
  return (lapses - threshold) % half === 0;
}

function minMax(minimum, c) {
  const maximum = Math.max(c.maximumInterval, 1);
  return [clamp(minimum, 1, maximum), maximum];
}

// deterministic per-card randomness so previews match what gets scheduled
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- answering

/**
 * ctx: { config, fsrs: bool, now: unix secs, today: day index, nextDayAt: unix secs, lastReviewDay?: int, fuzz?: bool }
 * Returns { card, secs (interval for button labels), revlog: {type, ivl, lastIvl, factor}, leech }
 */
export function answerCard(card, rating, ctx) {
  const c = { ...DEFAULT_CONFIG, ...ctx.config };
  const rand = rng((card.id % 4294967296) ^ Math.imul(card.reps + 1, 2654435761));
  const reviewFuzz = rand(), learnFuzz = rand();
  const fuzzFactor = ctx.fuzz === false ? null : reviewFuzz;
  const maxIvl = Math.max(c.maximumInterval, 1);

  // FSRS memory states
  let fsrs = null, states = null;
  if (ctx.fsrs) {
    fsrs = new FSRS(c.fsrsParams);
    let current = null;
    if (card.s > 0 && card.d > 0) current = { s: card.s, d: card.d };
    else if (card.type === CardType.Review || card.type === CardType.Relearning) {
      current = fsrs.fromSM2(Math.max(card.factor, 1300) / 1000, Math.max(card.ivl, 1), c.desiredRetention);
    }
    let elapsed = 0;
    if (card.type !== CardType.New) {
      if (ctx.lastReviewDay !== undefined && ctx.lastReviewDay !== null) elapsed = Math.max(0, ctx.today - ctx.lastReviewDay);
      else if (card.type === CardType.Review) elapsed = Math.max(0, ctx.today - (card.due - card.ivl));
    }
    states = {};
    for (const g of RATINGS) states[g] = fsrs.nextState(current, elapsed, g);
  }
  const fsrsIvl = (g) => (states ? fsrs.nextInterval(states[g].s, c.desiredRetention) : null);
  const fuzz = (ivl, minimum = 1) => { const [lo, hi] = minMax(minimum, c); return withFuzz(ivl, lo, hi, fuzzFactor); };
  const fuzzRounded = (ivl, minimum = 1) => fuzz(Math.max(round(ivl), 1), minimum);

  const out = { ...card, reps: card.reps + 1, mod: ctx.now, lrt: ctx.now };
  if (states) { out.s = states[rating].s; out.d = states[rating].d; }
  let revType, leech = false, lastIvl = 0, next;
  const learn = (remaining, secs, relearn) => ({ learn: true, remaining, secs, relearn });
  const review = (days, ease) => ({ learn: false, days, ease });

  const failingInterval = (scheduled) => {
    const fa = fsrsIvl(1);
    if (fa !== null) return Math.max(round(fa), 1);
    return Math.max(fuzz(Math.max(scheduled, 1) * c.newInterval, c.minimumLapseInterval), 1);
  };

  if (card.type === CardType.New || card.type === CardType.Learning) {
    revType = 0;
    const steps = new LearningSteps(c.learnSteps);
    const remaining = card.type === CardType.New ? steps.count : card.left % 1000;
    lastIvl = card.type === CardType.New ? 0 : -steps.currentDelay(remaining);
    const ease = c.startingEase;
    const graduate = (g) => review(fuzzRounded(fsrsIvl(g) ?? c.graduatingInterval), ease);
    if (rating === 1) next = steps.againDelay !== null ? learn(steps.count, steps.againDelay, false) : graduate(1);
    else if (rating === 2) { const d = steps.hardDelay(remaining); next = d !== null ? learn(remaining, d, false) : graduate(2); }
    else if (rating === 3) { const d = steps.goodDelay(remaining); next = d !== null ? learn(steps.remainingForGood(remaining), d, false) : graduate(3); }
    else if (states) { const good = fuzz(fsrsIvl(3)); next = review(fuzz(Math.max(round(fsrsIvl(4)), 1), good + 1), ease); }
    else next = review(fuzz(c.easyInterval), ease);
  } else if (card.type === CardType.Review) {
    revType = 1;
    lastIvl = card.ivl;
    const ease = Math.max(card.factor, 1300) / 1000;
    const scheduled = card.ivl;
    const daysLate = ctx.today - card.due;
    if (rating === 1) {
      out.lapses = card.lapses + 1;
      leech = isLeech(out.lapses, c.leechThreshold);
      const newEase = Math.max(ease - 0.2, 1.3);
      const lapseDays = failingInterval(scheduled);
      const steps = new LearningSteps(c.relearnSteps);
      out.ivl = lapseDays;
      out.factor = Math.round(newEase * 1000);
      next = steps.againDelay !== null ? learn(steps.count, steps.againDelay, true) : review(lapseDays, newEase);
    } else {
      const [h, g, e] = passingIntervals(scheduled, daysLate, ease, c, fuzzFactor, states ? [fsrsIvl(2), fsrsIvl(3), fsrsIvl(4)] : null);
      if (rating === 2) next = review(h, Math.max(ease - 0.15, 1.3));
      else if (rating === 3) next = review(g, ease);
      else next = review(e, ease + 0.15);
    }
  } else {
    revType = 2;
    const steps = new LearningSteps(c.relearnSteps);
    const remaining = card.left % 1000;
    lastIvl = -steps.currentDelay(remaining);
    const ease = Math.max(card.factor, 1300) / 1000;
    const reviewDays = Math.min(Math.max(card.ivl, 1), maxIvl);
    const leave = (g) => { const f = fsrsIvl(g); return f !== null ? review(fuzzRounded(f), ease) : review(reviewDays, ease); };
    if (rating === 1) {
      if (steps.againDelay !== null) { out.ivl = failingInterval(card.ivl); next = learn(steps.count, steps.againDelay, true); }
      else next = leave(1);
    } else if (rating === 2) { const d = steps.hardDelay(remaining); next = d !== null ? learn(remaining, d, true) : leave(2); }
    else if (rating === 3) { const d = steps.goodDelay(remaining); next = d !== null ? learn(steps.remainingForGood(remaining), d, true) : leave(3); }
    else if (states) { const good = fuzz(fsrsIvl(3)); next = review(fuzzRounded(fsrsIvl(4), good + 1), ease); }
    else next = review(card.ivl + 1, ease);
  }

  let secs, revIvl;
  if (next.learn) {
    out.type = next.relearn ? CardType.Relearning : CardType.Learning;
    out.left = next.remaining;
    if (!next.relearn) out.ivl = 0;
    if (card.type === CardType.New && !out.factor) out.factor = Math.round(c.startingEase * 1000);
    // Anki adds up to 25% (max 5 min) to learning delays so cards don't always come back in the same order.
    const fuzzed = ctx.fuzz === false ? next.secs : next.secs + learnFuzz * Math.min(next.secs * 0.25, 300);
    if (next.secs < 86400) {
      out.queue = Queue.Learning;
      out.due = ctx.now + Math.round(fuzzed);
      secs = next.secs;
    } else {
      const days = Math.max(1, round(next.secs / 86400));
      out.queue = Queue.DayLearning;
      out.due = ctx.today + days;
      secs = days * 86400;
    }
    revIvl = -Math.round(next.secs);
  } else {
    out.type = CardType.Review;
    out.queue = Queue.Review;
    out.left = 0;
    out.ivl = next.days;
    out.due = ctx.today + next.days;
    out.factor = Math.round(next.ease * 1000);
    secs = next.days * 86400;
    revIvl = next.days;
  }
  return { card: out, secs, leech, revlog: { type: revType, ivl: revIvl, lastIvl, factor: out.factor } };
}

function constrainPassing(interval, minimum, c, fuzz, isFsrs = false) {
  const ivl = isFsrs ? interval : interval * c.intervalModifier;
  const [lo, hi] = minMax(minimum, c);
  return withFuzz(ivl, lo, hi, fuzz);
}

export function passingIntervals(scheduled, daysLate, ease, c, fuzz, fsrsIvls) {
  if (fsrsIvls) {
    const [fh, fg, fe] = fsrsIvls;
    const max = Math.max(c.maximumInterval, 1);
    const hard = constrainPassing(fh, Math.max(minimumReviewFuzzInterval(fh, scheduled, max), 1), c, fuzz, true);
    const good = constrainPassing(fg, Math.max(minimumReviewFuzzInterval(fg, scheduled, max), hard + 1), c, fuzz, true);
    const easy = constrainPassing(fe, Math.max(minimumReviewFuzzInterval(fe, scheduled, max), good + 1), c, fuzz, true);
    return [hard, good, easy];
  }
  const current = Math.max(scheduled, 1);
  if (daysLate < 0) {
    const elapsed = Math.max(0, scheduled + daysLate);
    const hard = constrainPassing(Math.max(elapsed * c.hardInterval, current * c.hardInterval / 2), 0, c, null);
    const good = constrainPassing(Math.max(elapsed * ease, current), 0, c, null);
    const reduced = c.easyBonus - (c.easyBonus - 1) / 2;
    const easy = constrainPassing(Math.max(elapsed * ease, current) * reduced, 0, c, null);
    return [hard, good, easy];
  }
  const late = Math.max(daysLate, 0);
  const hardMin = c.hardInterval <= 1 ? 0 : scheduled + 1;
  const hard = constrainPassing(current * c.hardInterval, hardMin, c, fuzz);
  const goodMin = c.hardInterval <= 1 ? scheduled + 1 : hard + 1;
  const good = constrainPassing((current + late / 2) * ease, goodMin, c, fuzz);
  const easy = constrainPassing((current + late) * ease * c.easyBonus, good + 1, c, fuzz);
  return [hard, good, easy];
}

export function previewAll(card, ctx) {
  const out = {};
  for (const r of RATINGS) out[r] = answerCard(card, r, ctx);
  return out;
}
