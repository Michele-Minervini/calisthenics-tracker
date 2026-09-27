/* Big Six Tracker — service worker.
   Strategy: the whole app is downloaded into one cache when a new version
   installs, checked, and served from that cache — so every launch runs one
   consistent release, online or offline.

   Updates arrive ONLY through a VERSION bump: nothing is re-cached in the
   background. (The old background refresh wrote new files into the running
   version's cache, which could leave a mix of two releases — and a blank app
   offline.) Set VERSION with `sh tools/set-build.sh <build>`, which also
   updates the matching stamp in every script; tests/static-test.js checks
   they agree. */

var VERSION = "bigsix-v16";
var ASSETS = [
  ".",
  "index.html",
  "style.css",
  "app.js",
  "data.js",
  "model.js",
  "qrcode.js",
  "sync.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png"
];

// Files that carry the release stamp. A download is only accepted when every
// one of them really belongs to VERSION — GitHub's CDN can briefly keep
// serving an old copy of a file after a deploy, and caching that would pin a
// mixed release on the phone until the next one.
var STAMPED = [".", "index.html", "app.js", "data.js", "model.js", "qrcode.js", "sync.js"];

// Cache Storage is shared by every app on the origin (all of
// michele-minervini.github.io), not just this folder. Cache names therefore
// carry the path this worker controls, and cleanup only touches caches of
// that same path — so two apps (or the old and new address of this one)
// can't delete each other's offline copy.
var SCOPE = self.registration.scope;
var SCOPE_PATH = new URL(SCOPE).pathname;
var SUFFIX = "@" + SCOPE_PATH;
var CACHE = VERSION + SUFFIX;

// Before build stamps, caches were named plainly "bigsix-vN". Only the app at
// this path ever created those, so only this path cleans them up.
var LEGACY_PATH = "/calisthenics-tracker/";

function ownedOldCache(name) {
  if (name === CACHE) return false;
  if (name.slice(-SUFFIX.length) === SUFFIX) return true;   // an older version at this path
  return SCOPE_PATH === LEGACY_PATH && /^bigsix-v\d+$/.test(name);
}

var ASSET_URLS = ASSETS.map(function (p) { return new URL(p, SCOPE).href; });

// Asks for the file under a URL the CDN has never seen, so it can't answer
// from its own cache, and skips the browser's HTTP cache too.
function fetchFresh(path) {
  var url = new URL(path, SCOPE);
  url.searchParams.set("build", VERSION);
  return fetch(url.href, { cache: "reload" }).then(function (res) {
    if (!res.ok) throw new Error(path + ": HTTP " + res.status);
    // Safari refuses to serve a page response that went through a redirect.
    if (!res.redirected) return res;
    return res.blob().then(function (body) {
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    });
  });
}

// Download the whole release, check the stamps, and only then store it. If
// anything fails, nothing of this attempt is kept, and the browser tries again
// on a later launch — while the previous release keeps working.
function precache() {
  return Promise.all(ASSETS.map(function (path) {
    return fetchFresh(path).then(function (res) {
      if (STAMPED.indexOf(path) === -1) return { path: path, res: res };
      return res.clone().text().then(function (text) {
        if (text.indexOf('"' + VERSION + '"') === -1) throw new Error(path + " is not " + VERSION);
        return { path: path, res: res };
      });
    });
  })).then(function (items) {
    return caches.open(CACHE).then(function (cache) {
      return Promise.all(items.map(function (it) {
        return cache.put(new URL(it.path, SCOPE).href, it.res);
      }));
    });
  }).catch(function (err) {
    return caches.delete(CACHE).then(function () { throw err; });
  });
}

// If this release's cache disappears (another app on the origin clearing
// caches, or the browser reclaiming space), fetch it again the next time a
// file is missing — otherwise the app would stay online-only until the next
// release. One repair at a time.
var repairing = null;
function repair() {
  if (!repairing) {
    repairing = precache().catch(function () { /* try again next time */ })
      .then(function () { repairing = null; });
  }
  return repairing;
}

self.addEventListener("install", function (e) {
  e.waitUntil(precache().then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(ownedOldCache).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: req.mode === "navigate" }).then(function (cached) {
        if (cached) return cached;
        var bare = req.url.split("#")[0].split("?")[0];
        if (req.mode === "navigate" || ASSET_URLS.indexOf(bare) !== -1) e.waitUntil(repair());
        return fetch(req);
      });
    })
  );
});
