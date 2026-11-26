// Offline support: the app shell is precached; app files come from the network when online
// (so a launch never mixes old and new files) and from the cache when offline;
// the CDN libraries (JSZip, sql.js, fzstd, MathJax) are cached the first time they're used.
const VERSION = 'v14';
const SHELL = `shell-${VERSION}`;
const CDN = 'cdn-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/core/util.js', 'js/core/storage.js', 'js/core/scheduler.js', 'js/core/template.js', 'js/core/stock.js', 'js/core/collection.js',
  'js/core/session.js', 'js/core/search.js', 'js/core/stats.js', 'js/core/libs.js', 'js/core/protobuf.js', 'js/core/importer.js', 'js/core/exporter.js',
  'js/ui/app.js', 'js/ui/dom.js', 'js/ui/cardframe.js', 'js/ui/decks.js', 'js/ui/overview.js', 'js/ui/custom.js', 'js/ui/later.js', 'js/ui/study.js', 'js/ui/editor.js',
  'js/ui/options.js', 'js/ui/browse.js', 'js/ui/statsview.js', 'js/ui/settings.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm',
  'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(FILES);
    // best effort: make importing work offline too
    const cdn = await caches.open(CDN);
    await Promise.all(LIBS.map((u) => cdn.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== CDN) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    if (!/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(url.host)) return;
    e.respondWith(caches.open(CDN).then(async (c) => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req.url, res.clone());
      return res;
    }));
    return;
  }
  // network first for the app itself, falling back to the cached copy when offline
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const key = url.pathname.endsWith('/') ? './' : req;
    const cached = () => c.match(key, { ignoreSearch: true });
    const network = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(key, res.clone()); return res; });
    // on a very slow connection, use the cached copy after a few seconds
    const slow = new Promise((r) => setTimeout(r, 3000)).then(cached);
    try {
      const res = await Promise.race([network, slow.then((hit) => hit || network)]);
      return res;
    } catch {
      return (await cached()) || Response.error();
    }
  }));
});
