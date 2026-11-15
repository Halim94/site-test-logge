const CACHE = "stl-v22";
const FILES = ["./", "index.html", "app.js", "report.js", "manifest.json", "icon-180.png", "icon-192.png", "icon-512.png",
  "lib/jszip.min.js", "lib/xlsx.min.js", "lib/docx.js"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
// network first (so updates arrive when online), cache fallback when offline on site
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // "no-cache" = always ask GitHub for the newest copy (the browser's 10-minute cache was serving old app.js with new index.html)
  const same = new URL(e.request.url).origin === location.origin;
  let req = e.request;
  try { if (same) req = e.request.mode === "navigate" ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" }) : new Request(e.request, { cache: "no-cache" }); } catch {}
  e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
});
