/* Switches off the old copy of Milo at /calisthenics-tracker/.

   Milo moved to https://michele-minervini.github.io/milo/. Every copy of the
   app installed from this old address has a service worker that keeps serving
   the old app from its offline copy. On its next update check it downloads
   this file instead, which:
   - deletes the old app's offline copy at this path (never the saved data,
     and never another app's cache: the new /milo/ one ends in "@/milo/");
   - removes itself;
   - after a short grace period (so the old app can finish its last sync),
     reloads the open pages, which then load index.html from the network —
     the "Milo has moved" page.

   It has no fetch handler, so nothing is ever served from here again.
   Keep this file online for as long as any old copy might still be opened. */

var SUFFIX = "@" + new URL(self.registration.scope).pathname;   // "@/calisthenics-tracker/"

// Caches the old app made here: "milo-vN@/calisthenics-tracker/" and, from
// before cache names carried their path, "bigsix-vN".
function oldCache(name) {
  return name.slice(-SUFFIX.length) === SUFFIX || /^bigsix-v\d+$/.test(name);
}

// Before anything is switched off, make sure the "Milo has moved" page can be
// reached (this also leaves it in the browser's cache). If it can't, the
// install fails and the old app keeps working; the browser tries again later.
self.addEventListener("install", function (e) {
  e.waitUntil(
    fetch(new URL("./?moved=1", self.registration.scope).href, { cache: "reload" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return self.skipWaiting();
    })
  );
});

// How long the open old app keeps running before it is reloaded: enough for
// the sync it starts when it opens to send its last changes to the cloud.
// (Its sync requests don't pass through here, so they aren't held up.)
var GRACE_MS = 12000;

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(oldCache).map(function (k) { return caches.delete(k); })); })
      .catch(function () { /* the moved page cleans up again */ })
      .then(function () { return self.clients.claim(); })
      // Removed first: if the browser stops this worker during the wait, the
      // next launch still loads the moved page.
      .then(function () { return self.registration.unregister(); })
      .then(function () { return new Promise(function (r) { setTimeout(r, GRACE_MS); }); })
      .then(function () { return self.clients.matchAll({ type: "window" }); })
      .then(function (wins) {
        return Promise.all(wins.map(function (c) {
          // A different address from the current one, so it is a real
          // reload even when the old page's address ends in a #fragment.
          var u = new URL(c.url);
          u.searchParams.set("moved", "1");
          return c.navigate(u.href).catch(function () { /* the next launch shows the page anyway */ });
        }));
      })
      .catch(function () { /* nothing more to do */ })
  );
});
