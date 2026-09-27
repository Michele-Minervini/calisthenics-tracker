/* ============================================================
   Big Six Tracker — optional cloud sync.

   What this is: a thin client for a Firebase Realtime Database,
   spoken over plain HTTPS with fetch(). No SDK, no build step,
   no account, no password.

   How it works:
   - Your whole state is a small JSON blob (tens of KB), so there
     is no clever per-record protocol: the device pushes the whole
     thing and pulls the whole thing.
   - It lives at  <database>/u/<code>m5.json  where <code> is a long
     random string generated once and carried to your other device
     by QR. Knowing the code is what grants access — that is the
     entire security model, so treat the code like a password.
     (Data v5 moved to that record from <code>.json: devices still
     running the older app keep writing the old record, which is now
     only ever READ, so they can never strip newer data. See
     app.js syncRound and MODEL.reconcile.)
   - localStorage stays the source of truth. Sync is a background
     extra: with no network, the app behaves exactly as before.
   - Two devices are reconciled by MODEL.merge() (model.js), never
     by overwrite.

   Everything here is deliberately dependency-free and side-effect
   free apart from the two localStorage calls for the config.
   ============================================================ */

var SYNC = (function () {
  "use strict";

  // Deliberately a different key from the app data ("bigsix.v1"): the sync
  // code must never travel inside a backup file or a shared progress link.
  var CONFIG_KEY = "bigsix.sync";
  var TIMEOUT_MS = 15000;
  var BUILD = "bigsix-v17";

  // The cloud record for data v5, next to the old one at plain <code>. The
  // security rules accept any key of 20+ characters, so no rule change and
  // no re-pairing is needed.
  var RECORD_SUFFIX = "m5";
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
      return {
        url: url, code: c.code, lastSync: Number(c.lastSync) || 0,
        // When this device first wrote the v5 record, and the old record's
        // updatedAt as of the last time its sessions were merged in.
        cutAt: Number(c.cutAt) || 0, legacyAt: Number(c.legacyAt) || 0
      };
    } catch (e) { return null; }
  }

  function setConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); return true; }
    catch (e) { return false; }
  }

  function clearConfig() {
    try { localStorage.removeItem(CONFIG_KEY); } catch (e) { /* nothing to do */ }
  }

  // Updates fields of the stored config — re-reading it first, so a change
  // made meanwhile in another tab (sync turned off, a new pairing) is never
  // undone by this tab's stale copy. Returns false when the stored config no
  // longer matches this one.
  function updateConfig(cfg, patch) {
    var cur = getConfig();
    if (!cur || cur.url !== cfg.url || cur.code !== cfg.code) return false;
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; cfg[k] = patch[k]; });
    return setConfig(cur);
  }

  function markSynced(cfg, when) {
    return updateConfig(cfg, { lastSync: when });
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

  function recordURL(cfg, legacy) {
    return cfg.url + "/u/" + cfg.code + (legacy ? "" : RECORD_SUFFIX) + ".json";
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

  /* Resolves to { status, raw, etag, updatedAt }:
       "absent"      nothing stored yet (a fresh pairing, or before cutover)
       "ok"          raw is the stored state object
       "unreadable"  something is stored but it isn't a state we can read —
                     the caller must NOT overwrite it (it may be data from a
                     newer app, a hand edit, or a partial write).
     legacy: read the old-format record instead of the v5 one. */
  function pull(cfg, legacy) {
    return withTimeout(recordURL(cfg, legacy), {
      method: "GET",
      headers: { "X-Firebase-ETag": "true" },
      cache: "no-store"
    }).then(function (res) {
      if (!res.ok) throw httpError(res);
      // The ETag is only readable if Firebase exposes it through CORS. When it
      // isn't, push() simply falls back to an unconditional write.
      var etag = res.headers.get("ETag");
      return res.text().then(function (text) {
        var body;
        try { body = JSON.parse(text); } catch (e) { return { status: "unreadable", raw: null, etag: etag, updatedAt: 0 }; }
        if (body === null) return { status: "absent", raw: null, etag: etag, updatedAt: 0 };
        var parsed = null;
        if (body && typeof body === "object" && typeof body.blob === "string") {
          try { parsed = JSON.parse(body.blob); } catch (e) { parsed = null; }
        }
        if (!parsed || typeof parsed !== "object") return { status: "unreadable", raw: null, etag: etag, updatedAt: 0 };
        return { status: "ok", raw: parsed, etag: etag, updatedAt: Number(body.updatedAt) || 0 };
      });
    });
  }

  // The old record's updatedAt alone — a few bytes — so the whole old record
  // is only downloaded when an older device has actually written to it.
  // Resolves to a number, or null when there is no old record.
  function legacyStamp(cfg) {
    return withTimeout(cfg.url + "/u/" + cfg.code + "/updatedAt.json", { method: "GET", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw httpError(res);
        return res.json().then(function (v) { var n = Number(v); return (v === null || !isFinite(n)) ? null : n; });
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

  return {
    getConfig: getConfig,
    setConfig: setConfig,
    clearConfig: clearConfig,
    markSynced: markSynced,
    updateConfig: updateConfig,
    legacyStamp: legacyStamp,
    RECORD_SUFFIX: RECORD_SUFFIX,
    makeCode: makeCode,
    normalizeURL: normalizeURL,
    pairingHash: pairingHash,
    parsePairing: parsePairing,
    pull: pull,
    push: push,
    // The merge lives with the rest of the data model; kept here so callers
    // and tests that know it as SYNC.merge keep working.
    merge: function (local, remote) { return MODEL.merge(local, remote); },
    BUILD: BUILD
  };
})();
