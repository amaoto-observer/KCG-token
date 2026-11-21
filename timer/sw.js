const CACHE = "tcg-timer-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./timer.css",
  "./deco.js",
  "./timer.js",
  "./manifest.webmanifest",
  "../fonts/orbitron-700.woff2",
  "./fonts/mplus1p-700-subset-timer.woff2",
  "../icons/icon-192.png",
  "../icons/apple-touch-icon.png",
  "../icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tcg-timer-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先 + 失敗時キャッシュ(通信できるときは常に最新を表示、圏外ではキャッシュで動作)
// ブラウザの HTTP キャッシュに古いファイルが残っていても使わないよう、毎回サーバーに確認する(cache: "no-cache")
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    (e.request.mode === "navigate" ? fetch(e.request.url, { cache: "no-cache" }) : fetch(e.request, { cache: "no-cache" }))
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
