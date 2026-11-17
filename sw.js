// Keeps a copy of Ross Note on the device, so it opens with no connection.
// With a connection it always takes the newest files from the site (and keeps
// them); with none, the kept copy. (The notes themselves are in your folder.)
const PREFIX = "ross-note-";
const CACHE = PREFIX + "2.1.2";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/md.js", "js/editor.js", "js/store.js", "js/wordio.js", "js/project.js", "js/wordpatch.js",
  "fonts/Caladea-Regular.woff2", "fonts/Caladea-Bold.woff2", "fonts/Caladea-Italic.woff2", "fonts/Caladea-BoldItalic.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  // a new version takes over at once (the page then reloads itself)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // the site first (never the browser's own stale copy), so a new version shows at once
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(e.request, { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    } catch (err) {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
    }
  })());
});
