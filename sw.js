// Keeps a copy of Ross Invoices on the device, so it opens with no connection.
// A new version (a new CACHE name) is fetched in the background and used the
// next time the app is opened.
const CACHE = "ross-invoices-1.1.0";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/ui.js", "js/store.js", "js/money.js", "js/pdf.js", "js/files.js",
  "vendor/pdf-lib.min.js", "vendor/fontkit.umd.min.js",
  "fonts/Inter-Regular.ttf", "fonts/Inter-SemiBold.ttf", "fonts/Inter-Bold.ttf", "fonts/Inter-Italic.ttf",
  "fonts/Inter-Regular.woff2", "fonts/Inter-SemiBold.woff2", "fonts/Inter-Bold.woff2", "fonts/Inter-Italic.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() =>
    caches.match("index.html"))));
});
