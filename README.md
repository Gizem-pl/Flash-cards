# Flashcards

A spaced-repetition flashcard web app for iPhone (and any browser) that works with Anki decks. It uses Anki's scheduling algorithms and imports real `.apkg` files directly on your phone. Everything is stored on your device and it works offline.

## Put it online with GitHub Pages

1. Create a new repository on GitHub (for example `flashcards`).
2. Upload everything in this folder (`index.html`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, and the `css`, `js` and `icons` folders) to the repository's main branch.
3. In the repository go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. After a minute your app is live at `https://<your-username>.github.io/flashcards/`.

## Add it to your iPhone Home Screen

1. Open the link in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch it from the Home Screen icon. It opens full screen like a normal app and works offline after the first visit.

## Importing decks

Tap **+ → Import .apkg** and pick a file from the Files app (iCloud Drive, Downloads, etc.). Shared decks from AnkiWeb and exports from Anki, AnkiDroid or AnkiMobile all work, including the newest Anki format. Scheduling, review history and media (images, audio) come along. Importing the same deck again updates changed notes instead of duplicating them.

## Your data

- Decks, progress and media are saved in this browser on this device (IndexedDB). Nothing is uploaded anywhere.
- Data saved by the Home Screen app is separate from data in a Safari tab, so import your decks inside the Home Screen app.
- **Back up** regularly with **Settings → Back up everything**. This exports an `.apkg` with all decks, progress and media, which you can re-import here or open in Anki. Clearing Safari's website data deletes the app's data.

## What's included

- **Scheduling:** Anki's SM-2 scheduler, ported from Anki's own source code and checked against Anki's unit tests. FSRS can be switched on in Settings. Learning and relearning steps, interval randomization ("fuzz"), leeches, burying related cards, daily limits through subdecks and the day-rollover hour all work like Anki.
- **Deck options:** Anki's settings, organised in presets. Each deck screen also has a quick picker for new cards per day (20 / 40 / 50 / 100).
- **Custom decks:** combine several decks (for example *Day 1* + *Day 51*) and study them together.
- **Random 30:** a practice round of 30 random cards from a deck, a custom deck or everything. Cards you haven't answered yet come first, so every card shows up once before any repeats. Answers are scheduled with the same 4 buttons as normal study.
- **Cards:** card templates with HTML/CSS/JavaScript, cloze deletions (including nested and hints), type-in answers, images, audio, text-to-speech, furigana, math (MathJax) and night mode.
- **Card browser:** uses Anki's search syntax (`dog`, `deck:Spanish`, `tag:verb`, `is:due`, `-is:new`, `front:h*`, `prop:ivl>30`, `OR`, parentheses) and has filters and card actions.
- **Statistics:** today's reviews, streak, retention, upcoming reviews, an activity heatmap, card counts and answer buttons.
- **Editing:** a note editor with attachments and card preview, and a note type editor.

## Not included (yet)

AnkiWeb sync, Anki-style filtered decks, FSRS parameter optimisation (paste parameters from Anki desktop into deck options instead), Anki 24.11's load balancing and easy days, interactive image-occlusion cards, and a rich-text editor.

## How it's built

These are plain static files with no build step. They load three libraries from public CDNs only when you import or export:

- [JSZip](https://stuk.github.io/jszip/) opens `.apkg` files.
- [sql.js](https://sql.js.org/) reads the SQLite database inside them.
- [fzstd](https://github.com/101arrowz/fzstd) decompresses the zstd format used by Anki 2.1.50+.

The service worker caches them for offline use.

```
js/core/   scheduler (SM-2 + FSRS), template engine, collection storage, search, import/export, stats
js/ui/     screens (decks, study, browse, stats, settings, editor, deck options)
css/       styles (light + dark)
```
