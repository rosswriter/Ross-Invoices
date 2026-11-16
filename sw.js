// Keeps a copy of Ross Note on the device, so it opens with no connection.
// A new version (a new CACHE name) is fetched in the background and used the
// next time the app is opened. (The notes themselves are in your folder, not here.)
const PREFIX = "ross-note-";
const CACHE = PREFIX + "1.0.0";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/md.js", "js/editor.js", "js/store.js",
  "fonts/Caladea-Regular.woff2", "fonts/Caladea-Bold.woff2", "fonts/Caladea-Italic.woff2", "fonts/Caladea-BoldItalic.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() =>
    caches.match("index.html"))));
});
