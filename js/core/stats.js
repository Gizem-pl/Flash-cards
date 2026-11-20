// Statistics computed from cards and the review log.
export function collectionStats(col, deckId = null, forecastDays = 30, historyDays = 182) {
  const ids = deckId ? new Set(col.deckAndDescendantIds(deckId)) : null;
  const cards = [...col.cards.values()].filter((c) => !ids || ids.has(c.did));
  const cardIds = new Set(cards.map((c) => c.id));
  const revs = [...col.revlog.values()].filter((r) => r.ease > 0 && (!ids || cardIds.has(r.cid)));
  const t = col.today;
  const startToday = col.dayStart(t) * 1000;

  const today = { reviews: 0, time: 0, again: 0 };
  const hist = new Map();
  const historyStart = col.dayStart(t - historyDays + 1) * 1000;
  const monthStart = col.dayStart(t - 29) * 1000;
  const buttons = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let retTotal = 0, retPass = 0;
  const days = new Set();
  for (const r of revs) {
    const day = col.dayIndex(Math.floor(r.id / 1000));
    days.add(day);
    if (r.id >= startToday) { today.reviews++; today.time += r.time; if (r.ease === 1) today.again++; }
    if (r.id >= historyStart) hist.set(day - t, (hist.get(day - t) || 0) + 1);
    if (r.id >= monthStart) {
      buttons[r.ease] = (buttons[r.ease] || 0) + 1;
      if (r.type === 1) { retTotal++; if (r.ease > 1) retPass++; }
    }
  }
  let streak = 0;
  for (let d = days.has(t) ? t : t - 1; days.has(d); d--) streak++;

  const counts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0, buried: 0 };
  const fc = new Array(forecastDays).fill(0);
  for (const c of cards) {
    if (c.queue === -1) counts.suspended++;
    else if (c.queue === -2 || c.queue === -3) counts.buried++;
    else if (c.queue === 0) counts.new++;
    else if (c.queue === 1 || c.queue === 3) counts.learning++;
    else if (c.ivl >= 21) counts.mature++;
    else counts.young++;
    if ((c.queue === 2 || c.queue === 3) && c.due < t + forecastDays) fc[Math.max(0, c.due - t)]++;
    else if (c.queue === 1) fc[0]++;
  }
  return {
    today: { ...today, time: Math.round(today.time / 1000), correct: today.reviews ? (today.reviews - today.again) / today.reviews * 100 : null },
    streak,
    counts,
    total: cards.length,
    forecast: fc,
    history: Array.from({ length: historyDays }, (_, i) => hist.get(i - historyDays + 1) || 0),
    buttons,
    retention: retTotal ? retPass / retTotal * 100 : null,
    totalReviews: revs.length,
  };
}
