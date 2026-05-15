const CACHE = "lundercover-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/words.js",
  "/firebase-config.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/og-image.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((r) =>
      r || fetch(e.request).catch(() => {
        if (e.request.mode === "navigate") {
          return caches.match("/index.html");
        }
        return new Response("Offline", { status: 503 });
      })
    )
  );
});
