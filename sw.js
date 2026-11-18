// Keeps a copy of Ross Note on the device, so it opens with no connection, and quickly with a poor one.
// The page itself (index.html) is asked of the site first, for at most 2.5 s, so a new version arrives;
// everything it loads carries ?v=<version> (or never changes: fonts, icons, the database reader), so the
// kept copy is used straight away, with no wait on the network. (The notes themselves are in your folder.)
const PREFIX = "ross-note-";
const CACHE = PREFIX + "1.6.8";
const V = "?v=1.6.8";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css" + V,
  "js/app.js" + V, "js/md.js" + V, "js/editor.js" + V, "js/store.js" + V, "js/wordio.js" + V, "js/notebooks.js" + V, "js/rwimport.js" + V, "js/spell.js" + V,
  "vendor/sqljs/sql-wasm.js", "vendor/sqljs/sql-wasm.wasm",
  "fonts/Caladea-Regular.woff2", "fonts/Caladea-Bold.woff2", "fonts/Caladea-Italic.woff2", "fonts/Caladea-BoldItalic.woff2",
  "fonts/literata-latin-400-normal.woff2", "fonts/literata-latin-400-italic.woff2", "fonts/literata-latin-700-normal.woff2",
  "fonts/literata-latin-700-italic.woff2", "fonts/inter-latin-400-normal.woff2", "fonts/inter-latin-500-normal.woff2",
  "fonts/inter-latin-600-normal.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  // a new version takes over at once
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const fixed = (url) => url.searchParams.has("v") || /\/(fonts|icons|vendor)\//.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (fixed(url)) {
      // versioned or unchanging: the kept copy at once; the site only if it isn't kept yet
      const kept = await cache.match(e.request);
      if (kept) return kept;
      try {
        const r = await fetch(e.request);
        if (r.ok) cache.put(e.request, r.clone());
        return r;
      } catch (err) {
        return (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
      }
    }
    try {
      // the page: the site first (never the browser's own stale copy), so a new version shows at once
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(e.request, { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    } catch (err) {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
    }
  })());
});
