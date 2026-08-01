/* ============================================================
   Big Six Tracker — optional cloud sync.

   What this is: a thin client for a Firebase Realtime Database,
   spoken over plain HTTPS with fetch(). No SDK, no build step,
   no account, no password.

   How it works:
   - Your whole state is a small JSON blob (tens of KB), so there
     is no clever per-record protocol: the device pushes the whole
     thing and pulls the whole thing.
   - It lives at  <database>/u/<code>.json  where <code> is a long
     random string generated once and carried to your other device
     by QR. Knowing the code is what grants access — that is the
     entire security model, so treat the code like a password.
   - localStorage stays the source of truth. Sync is a background
     extra: with no network, the app behaves exactly as before.
   - Two devices are reconciled by merge(), never by overwrite.

   Everything here is deliberately dependency-free and side-effect
   free apart from the two localStorage calls for the config.
   ============================================================ */

var SYNC = (function () {
  "use strict";

  // Deliberately a different key from the app data ("bigsix.v1"): the sync
  // code must never travel inside a backup file or a shared progress link.
  var CONFIG_KEY = "bigsix.sync";
  var TIMEOUT_MS = 15000;
  var MAX_BLOB = 900000; // keep well under the 1 MB the database rules allow

  // A pairing link may be scanned from a QR code, i.e. it is untrusted input.
  // Restricting the host to Firebase's own domains means a doctored QR can't
  // repoint the app at someone else's server and harvest the training data.
  var ALLOWED_HOSTS = /(^|\.)(firebasedatabase\.app|firebaseio\.com)$/;

  /* ---------- Config (database URL + secret code) ---------- */

  function getConfig() {
    var raw;
    try { raw = localStorage.getItem(CONFIG_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var c = JSON.parse(raw);
      var url = normalizeURL(c && c.url);
      if (!url || !validCode(c && c.code)) return null;
      return { url: url, code: c.code, lastSync: Number(c.lastSync) || 0 };
    } catch (e) { return null; }
  }

  function setConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); return true; }
    catch (e) { return false; }
  }

  function clearConfig() {
    try { localStorage.removeItem(CONFIG_KEY); } catch (e) { /* nothing to do */ }
  }

  function markSynced(cfg, when) {
    cfg.lastSync = when;
    setConfig(cfg);
  }

  /* ---------- Codes and URLs ---------- */

  // 24 chars of [A-Za-z0-9] ≈ 143 bits — not guessable, and short enough that
  // the pairing QR stays inside the generator's version-10 capacity.
  function makeCode() {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var out = "";
    var bytes = new Uint8Array(24);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      // Only reachable on very old browsers; still fine for a personal app.
      for (var j = 0; j < bytes.length; j++) bytes[j] = Math.floor(Math.random() * 256);
    }
    for (var i = 0; i < bytes.length; i++) out += alphabet.charAt(bytes[i] % alphabet.length);
    return out;
  }

  function validCode(code) {
    return typeof code === "string" && /^[A-Za-z0-9]{20,64}$/.test(code);
  }

  // Accepts whatever the Firebase console shows and returns a clean origin,
  // or null if it isn't a Firebase database URL.
  function normalizeURL(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    if (s.indexOf("://") === -1) s = "https://" + s;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== "https:") return null;
    if (!ALLOWED_HOSTS.test(u.hostname)) return null;
    return "https://" + u.hostname;
  }

  function recordURL(cfg) {
    return cfg.url + "/u/" + cfg.code + ".json";
  }

  /* ---------- Pairing (carry the config to the second device) ---------- */

  // Kept as plain text rather than base64: base64 would inflate it by a third
  // and push the QR past what the generator can encode.
  function pairingHash(cfg) {
    return "#sync=" + cfg.url + "," + cfg.code;
  }

  function parsePairing(text) {
    var s = String(text || "").trim();
    var at = s.indexOf("#sync=");
    if (at !== -1) s = s.slice(at + 6);
    var comma = s.lastIndexOf(",");
    if (comma === -1) return null;
    var url = normalizeURL(s.slice(0, comma));
    var code = s.slice(comma + 1).trim();
    if (!url || !validCode(code)) return null;
    return { url: url, code: code, lastSync: 0 };
  }

  /* ---------- Network ---------- */

  function withTimeout(url, options) {
    var opts = options || {};
    var ctrl = null;
    if (window.AbortController) {
      ctrl = new AbortController();
      opts.signal = ctrl.signal;
    }
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function () {
      clearTimeout(timer);
      // A rejected fetch means the request never got an answer: offline, DNS
      // failure, blocked, or our own timeout. The browser's own text for this
      // ("Failed to fetch") isn't worth showing anyone.
      throw new Error(timedOut
        ? "The database took too long to answer."
        : "Couldn't reach the database — you may be offline.");
    });
  }

  function httpError(res) {
    if (res.status === 401 || res.status === 403) {
      return new Error("The database refused the request — check the security rules.");
    }
    if (res.status === 404) return new Error("Database not found — check the URL.");
    return new Error("The database replied " + res.status + ".");
  }

  // Resolves to { raw, etag } where raw is the stored state object, or null
  // when this code has never been written to (a fresh pairing).
  function pull(cfg) {
    return withTimeout(recordURL(cfg), {
      method: "GET",
      headers: { "X-Firebase-ETag": "true" },
      cache: "no-store"
    }).then(function (res) {
      if (!res.ok) throw httpError(res);
      // The ETag is only readable if Firebase exposes it through CORS. When it
      // isn't, push() simply falls back to an unconditional write.
      var etag = res.headers.get("ETag");
      return res.json().then(function (body) {
        if (!body || typeof body !== "object" || typeof body.blob !== "string") {
          return { raw: null, etag: etag };
        }
        var parsed = null;
        try { parsed = JSON.parse(body.blob); } catch (e) { parsed = null; }
        return { raw: parsed, etag: etag };
      });
    });
  }

  // Writes the state. When an etag is supplied the write is conditional, so a
  // change another device made in the meantime can't be silently clobbered —
  // a 412 comes back instead and the caller re-pulls, re-merges and retries.
  function push(cfg, stateObj, etag) {
    var blob = JSON.stringify(stateObj);
    if (blob.length > MAX_BLOB) {
      return Promise.reject(new Error("Your data got too big to sync."));
    }
    var headers = { "Content-Type": "application/json" };
    if (etag) headers["if-match"] = etag;
    return withTimeout(recordURL(cfg), {
      method: "PUT",
      headers: headers,
      body: JSON.stringify({ blob: blob, updatedAt: new Date().getTime() })
    }).then(function (res) {
      if (res.status === 412) {
        var conflict = new Error("Another device wrote first.");
        conflict.conflict = true;
        throw conflict;
      }
      if (!res.ok) throw httpError(res);
      return { etag: res.headers.get("ETag") };
    });
  }

  /* ---------- Merge ---------- */

  /* Reconciles two states without a server-side arbiter. Every rule below is
     commutative and idempotent, so both devices reach the same result no
     matter which one merges first or how often:

       sessions    union by id; the copy with the newer mts wins an edit clash
       deletions   tombstones win, unless the entry was edited after the delete
       areas       the side with the newer mts wins (ties: the higher position)
       milestones  union by id, then de-duplicated by what they commemorate
       snapshots   one per day, component-wise maximum
       prefs       settings and routine move together, newest prefsMts wins
  */
  function merge(local, remote) {
    if (!remote) return local;
    if (!local) return remote;

    var out = {
      v: 4,
      areas: {},
      log: [],
      settings: null,
      routine: null,
      snapshots: [],
      milestones: [],
      deleted: [],
      prefsMts: Math.max(Number(local.prefsMts) || 0, Number(remote.prefsMts) || 0)
    };

    // --- areas ---
    Object.keys(local.areas).forEach(function (id) {
      var a = local.areas[id];
      var b = remote.areas && remote.areas[id];
      out.areas[id] = b ? pickArea(a, b) : a;
    });

    // --- tombstones ---
    var tomb = {};
    concat(local.deleted, remote.deleted).forEach(function (t) {
      if (!tomb[t.id] || t.ts > tomb[t.id]) tomb[t.id] = t.ts;
    });

    // --- sessions ---
    var byId = {};
    concat(local.log, remote.log).forEach(function (e) {
      var prev = byId[e.id];
      if (!prev || newerEntry(e, prev)) byId[e.id] = e;
    });
    Object.keys(byId).forEach(function (id) {
      var e = byId[id];
      // A delete beats the entry it removed, but not an edit made afterwards.
      if (tomb[id] && tomb[id] >= (e.mts || e.ts)) return;
      out.log.push(e);
    });
    // Every sort here falls back to the id. Sorting on the timestamp alone is
    // not a total order — two sessions logged in the same millisecond would
    // come out in a different order on each device, the two copies would never
    // compare equal, and they would push at each other forever.
    out.log.sort(function (x, y) { return (x.ts - y.ts) || cmp(x.id, y.id); });

    // Tombstones for entries nobody has any more are still worth keeping for a
    // while: a device that has been offline for months may still hold the entry.
    var tombIds = Object.keys(tomb);
    tombIds.sort(function (x, y) { return (tomb[x] - tomb[y]) || cmp(x, y); });
    out.deleted = tombIds.slice(-400).map(function (id) { return { id: id, ts: tomb[id] }; });

    // --- milestones ---
    var mById = {};
    concat(local.milestones, remote.milestones).forEach(function (m) {
      if (!mById[m.id] || m.ts < mById[m.id].ts) mById[m.id] = m;
    });
    // The same achievement earned on two devices gets two different random ids,
    // so collapse by what it commemorates and keep the earliest.
    var mByWhat = {};
    Object.keys(mById).sort().forEach(function (id) {
      var m = mById[id];
      var key = m.type + "|" + m.areaId + "|" + m.step;
      var prev = mByWhat[key];
      if (!prev || m.ts < prev.ts || (m.ts === prev.ts && m.id < prev.id)) mByWhat[key] = m;
    });
    out.milestones = Object.keys(mByWhat).map(function (k) { return mByWhat[k]; })
      .sort(function (x, y) { return (x.ts - y.ts) || cmp(x.id, y.id); })
      .slice(-500);

    // --- snapshots ---
    var byDay = {};
    concat(local.snapshots, remote.snapshots).forEach(function (sn) {
      var prev = byDay[sn.d];
      if (!prev) { byDay[sn.d] = { d: sn.d, v: sn.v.slice() }; return; }
      for (var i = 0; i < sn.v.length && i < prev.v.length; i++) {
        if (sn.v[i] > prev.v[i]) prev.v[i] = sn.v[i];
      }
    });
    out.snapshots = Object.keys(byDay).sort().map(function (d) { return byDay[d]; }).slice(-400);

    // --- settings + routine ---
    var localNewer = (Number(local.prefsMts) || 0) >= (Number(remote.prefsMts) || 0);
    var prefsFrom = localNewer ? local : remote;
    out.settings = prefsFrom.settings;
    out.routine = prefsFrom.routine;

    return out;
  }

  function concat(a, b) {
    return (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []);
  }

  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  function pickArea(a, b) {
    var am = Number(a.mts) || 0, bm = Number(b.mts) || 0;
    if (am > bm) return a;
    if (bm > am) return b;
    // Same millisecond (or both pre-date sync): break the tie by position so
    // the two devices can't disagree about the winner.
    var av = (a.step - 1) + a.std / 3, bv = (b.step - 1) + b.std / 3;
    return bv > av ? b : a;
  }

  function newerEntry(e, prev) {
    var em = e.mts || e.ts, pm = prev.mts || prev.ts;
    if (em !== pm) return em > pm;
    // Deterministic tie-break, so the merge is order-independent.
    return JSON.stringify(e) > JSON.stringify(prev);
  }

  return {
    getConfig: getConfig,
    setConfig: setConfig,
    clearConfig: clearConfig,
    markSynced: markSynced,
    makeCode: makeCode,
    normalizeURL: normalizeURL,
    pairingHash: pairingHash,
    parsePairing: parsePairing,
    pull: pull,
    push: push,
    merge: merge
  };
})();
