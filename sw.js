/* Big Six Tracker — service worker.
   Strategy: precache the app shell; serve cache-first and refresh the
   cache in the background (stale-while-revalidate), so the app works
   offline and updates land on the next visit.
   Bump VERSION whenever any file changes, so clients pick up updates. */

var VERSION = "bigsix-v3";
var ASSETS = [
  ".",
  "index.html",
  "style.css",
  "app.js",
  "data.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // cache: "reload" bypasses the HTTP cache, so a new VERSION is always
      // seeded from the network — never with stale HTTP-cached copies.
      var requests;
      try {
        requests = ASSETS.map(function (u) { return new Request(u, { cache: "reload" }); });
      } catch (err) {
        requests = ASSETS;
      }
      return cache.addAll(requests);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(function (cache) {
      return cache.match(req, { ignoreSearch: req.mode === "navigate" }).then(function (cached) {
        var fetched = fetch(req).then(function (res) {
          if (res && res.ok) {
            return cache.put(req, res.clone()).then(function () { return res; });
          }
          return res;
        });
        if (cached) {
          // Keep the background refresh alive until cache.put finishes,
          // otherwise the browser may kill the worker mid-update and leave
          // a mixed-version cache.
          e.waitUntil(fetched.catch(function () { /* offline — keep cache */ }));
          return cached;
        }
        return fetched.catch(function () { return cached; });
      });
    })
  );
});
