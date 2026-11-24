// Full-screen review session.
import { h, clear, icon, actionSheet, confirmDialog, toast, dismiss } from './dom.js';
import { app, isDark } from './app.js';
import { StudySession, PracticeSession } from '../core/session.js';
import { RATINGS, RATING_NAMES } from '../core/scheduler.js';
import { formatInterval } from '../core/util.js';
import { CardFrame, audio } from './cardframe.js';
import { openEditor } from './editor.js';

const FLAG_NAMES = ['No flag', 'Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'];
export const FLAG_COLORS = ['transparent', '#ff3b30', '#ff9500', '#34c759', '#007aff', '#ff2d92', '#30c5c5', '#af52de'];

/**
 * deckId: a deck id, or an array of deck ids (custom deck).
 * practice: a random round of `size` cards from those decks (unseen cards first), scheduled like a normal session.
 */
export function openStudy(deckId, { practice = false, size = 25 } = {}) {
  const col = app.col;
  let session;
  try { session = practice ? new PracticeSession(col, deckId, size) : new StudySession(col, deckId); } catch (e) { toast(e.message); return; }
  if (practice && !session.total) { toast('There are no cards to practise here.'); return; }

  let card = null, rendered = null, showingAnswer = false, previews = null, shownAt = Date.now(), reviewed = 0, waitTimer = null, cfg = null;

  const frame = new CardFrame(col, {
    onTap: () => { if (!showingAnswer && app.prefs.tapToReveal) reveal(); },
    onAnswerKey: () => { if (!showingAnswer) reveal(); },
    onPlay: (side, idx) => { const tags = side === 'q' ? rendered?.questionAV : rendered?.answerAV; if (tags?.[idx]) audio.play(col, [tags[idx]]); },
    onKey: (key, ctrl) => handleKey(key, ctrl),
  });

  const countsEl = h('div');
  const undoBtn = h('button.icon-btn', { 'aria-label': 'Undo', onclick: () => undo() }, icon('undo', 'sm'));
  const flagEl = h('div.flag');
  const frameWrap = h('div.card-frame-wrap', frame.el, flagEl);
  const bar = h('div.answer-bar');
  const body = h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } });
  const overlay = h('div.overlay',
    h('div.study-top',
      h('button.icon-btn', { 'aria-label': 'Close', onclick: close }, icon('x', 'sm')),
      h('div.study-counts', countsEl),
      h('button.icon-btn', { 'aria-label': 'More', onclick: menu }, icon('more', 'sm')),
      undoBtn),
    body);
  document.body.appendChild(overlay);
  const keyHandler = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || document.querySelector('.backdrop:not(.leaving)')) return;
    if (handleKey(e.key, e.ctrlKey || e.metaKey)) e.preventDefault();
  };
  document.addEventListener('keydown', keyHandler);

  function handleKey(key, ctrl) {
    if (document.querySelector('.backdrop:not(.leaving)')) return false;
    if (ctrl && key.toLowerCase() === 'z') { undo(); return true; }
    if (key === 'Escape') { close(); return true; }
    if (!card) return false;
    if (!showingAnswer && (key === ' ' || key === 'Enter')) { reveal(); return true; }
    if (showingAnswer && (key === ' ' || key === 'Enter')) { answer(3); return true; }
    if (showingAnswer && shownRatings().map(String).includes(key)) { answer(Number(key)); return true; }
    if (key === 'r') { replay(); return true; }
    return false;
  }

  function renderCounts() {
    undoBtn.disabled = !session.canUndo;
    if (session.practice) {
      clear(countsEl, h('span', { style: { color: 'var(--accent)' } }, `${session.counts.remaining} left`));
      return;
    }
    const c = session.counts;
    const q = card?.queue;
    clear(countsEl,
      h(`span.c-new${q === 0 ? '.active' : ''}`, String(c.new)),
      h(`span.c-learn${q === 1 || q === 3 ? '.active' : ''}`, String(c.learning)),
      h(`span.c-review${q === 2 ? '.active' : ''}`, String(c.review)));
  }

  function cls() {
    return `card card${card.ord + 1}${isDark() ? ' nightMode night_mode' : ''} mobile${/iPhone|iPad/.test(navigator.userAgent) ? ' iphone' : ''}`;
  }

  function loadNext() {
    clearTimeout(waitTimer);
    audio.stop();
    card = session.nextCard();
    if (!card) return finished();
    cfg = col.configForDeck(card.did);
    showingAnswer = false;
    try {
      rendered = col.render(card);
      previews = session.previews(card);
    } catch (e) {
      toast(e.message);
      session.remove([card.id]);
      return loadNext();
    }
    if (!frameWrap.isConnected) clear(body, frameWrap, bar);
    flagEl.innerHTML = '';
    if (card.flags & 7) flagEl.append(h('span', { style: { color: FLAG_COLORS[card.flags & 7] } }, icon('flag', 'sm')));
    frame.show(rendered.question, rendered.css, cls(), true);
    shownAt = Date.now();
    renderBar();
    renderCounts();
    if (cfg.autoplay) audio.play(col, rendered.questionAV);
  }

  async function reveal() {
    if (!card || showingAnswer) return;
    if (rendered.hasTypeAnswer) {
      const typed = await frame.typedAnswer();
      rendered = col.render(card, typed);
    }
    showingAnswer = true;
    frame.show(rendered.answer, rendered.css, cls(), false);
    renderBar();
    if (cfg.autoplay) audio.play(col, rendered.answerAV);
  }

  // "Two buttons" setting: only Again and Good.
  function shownRatings() { return app.prefs.twoButtons ? [1, 3] : RATINGS; }

  function renderBar() {
    if (!showingAnswer) {
      clear(bar, h('button.btn.primary.show', { onclick: reveal }, 'Show answer'));
      return;
    }
    clear(bar, shownRatings().map((r, i) => h(`button.rate.r${r}`, { style: { animationDelay: `${i * 25}ms` }, onclick: () => answer(r) },
      app.prefs.showIntervals ? h('span.ivl', formatInterval(previews[r].secs)) : null,
      h('span.lbl', RATING_NAMES[r]))));
  }

  function answer(rating) {
    if (!card || !showingAnswer) return;
    try {
      const res = session.answer(card, rating, Date.now() - shownAt);
      reviewed++;
      if (res.leech) toast(cfg.leechAction === 0 ? 'Leech — card suspended' : 'Card marked as leech');
    } catch (e) { toast(e.message); }
    loadNext();
  }

  function undo() {
    if (!session.canUndo) return;
    session.undo();
    reviewed = Math.max(0, reviewed - 1);
    toast('Undone');
    loadNext();
  }

  function replay() {
    if (!rendered) return;
    audio.play(col, showingAnswer ? [...(cfg.replayQuestion ? rendered.questionAV : []), ...rendered.answerAV] : rendered.questionAV);
  }

  function finished() {
    card = null;
    renderCounts();
    const due = session.nextLearningDue;
    if (due && due < col.nextDayAt) {
      const until = due - col.learnAhead;
      const timerEl = h('div.timer');
      const tick = () => {
        const left = Math.max(0, due - col.now);
        timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (col.now >= until) loadNext(); else waitTimer = setTimeout(tick, 1000);
      };
      clear(body, h('div.finished', h('div', { style: { color: 'var(--learn)' } }, icon('hourglass')),
        h('h2', 'Coming up'), h('p.muted', 'Learning cards are due soon. They’ll appear automatically.'), timerEl,
        h('button.btn.tinted', { onclick: close }, 'Close')));
      tick();
      return;
    }
    if (session.practice) {
      clear(body, h('div.finished',
        h('div.badge', icon('check')),
        h('h2', 'Round done!'),
        h('p.muted', `You went through ${session.total} random card${session.total === 1 ? '' : 's'}.`),
        h('button.btn.primary', { style: { maxWidth: '320px', marginTop: '16px' }, onclick: () => { close(); openStudy(deckId, { practice, size }); } }, icon('zap', 'sm'), `Another ${size}`),
        h('button.btn', { style: { maxWidth: '320px', width: '100%' }, onclick: close }, 'Done')));
      return;
    }
    clear(body, h('div.finished',
      h('div.badge', icon('check')),
      h('h2', 'All done!'),
      h('p.muted', reviewed ? `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}. Come back tomorrow for more.` : 'There are no more cards due in this deck today.'),
      h('button.btn.primary', { style: { maxWidth: '320px', marginTop: '16px' }, onclick: close }, 'Done')));
  }

  async function menu() {
    if (!card) return;
    const c = card;
    const act = (fn, msg) => () => { fn(); if (msg) toast(msg); session.rebuild(); loadNext(); };
    await actionSheet(null, [
      { label: 'Edit note', icon: 'edit', run: () => openEditor({ note: col.note(c.nid), onSaved: () => {
        session.refresh(c.id);
        rendered = col.render(col.card(c.id));
        frame.show(showingAnswer ? rendered.answer : rendered.question, rendered.css, cls(), false);
      } }) },
      { label: 'Replay audio', icon: 'volume', run: replay },
      { label: (c.flags & 7) ? 'Change flag' : 'Flag card', icon: 'flag', run: flagMenu },
      { label: 'Bury card', icon: 'eyeoff', run: act(() => { col.bury([c.id]); session.remove([c.id]); }, 'Card buried') },
      { label: 'Bury note', icon: 'eyeoff', run: act(() => { const ids = col.cardsOfNote(c.nid).map((x) => x.id); col.bury(ids); session.remove(ids); }, 'Note buried') },
      { label: 'Suspend card', icon: 'pause', run: act(() => { col.setSuspended(true, [c.id]); session.remove([c.id]); }, 'Card suspended') },
      { label: 'Reset to new', icon: 'reset', run: act(() => { col.resetToNew([c.id]); session.remove([c.id]); }, 'Card reset') },
      { label: 'Delete note', icon: 'trash', danger: true, run: async () => {
        if (!await confirmDialog('Delete note?', 'This deletes the note and all its cards.', { ok: 'Delete', danger: true })) return;
        const ids = col.cardsOfNote(c.nid).map((x) => x.id);
        col.deleteNotes([c.nid]);
        session.remove(ids);
        session.undoStack = [];
        toast('Note deleted');
        loadNext();
      } },
    ]);
  }

  async function flagMenu() {
    const c = card;
    const f = await actionSheet('Flag', FLAG_NAMES.map((name, i) => ({ label: name, value: String(i) })));
    if (f === null) return;
    col.setFlag(Number(f), [c.id]);
    session.refresh(c.id);
    card = col.card(c.id);
    flagEl.innerHTML = '';
    if (card.flags & 7) flagEl.append(h('span', { style: { color: FLAG_COLORS[card.flags & 7] } }, icon('flag', 'sm')));
  }

  function close() {
    dismiss(overlay);
    document.removeEventListener('keydown', keyHandler);
    clearTimeout(waitTimer);
    try { audio.stop(); } catch (e) { console.error(e); }
    try { frame.destroy(); } catch (e) { console.error(e); }
    col.flush();
    app.rerender();
  }

  clear(body, frameWrap, bar);
  loadNext();
}
