/* ============================================================
   Big Six Tracker — data model.

   Everything that decides what a saved state looks like: the
   calendar-day helpers, the default state, the sanitizers every
   load / restore / sync goes through, and the merge that
   reconciles two devices. Pure functions over plain objects — no
   DOM, no storage — so tests/ can run them in Node.

   app.js and sync.js use these through the MODEL object. Changing
   what a sanitizer outputs changes what every device stores: run
   sh tests/run.sh, and see ROADMAP.md before touching it.
   ============================================================ */

var MODEL = (function () {
  "use strict";

  var BUILD = "bigsix-v16";

  // The shape of the stored data. Any change to what the sanitizers output is a
  // change to what every device keeps: bump this, and see ROADMAP.md.
  var MODEL_VERSION = 4;

  var KNOWN_IDS = AREAS.map(function (a) { return a.id; });
  var DEFAULT_REST = 180; // seconds

  /* ---------- Dates / ids ---------- */

  function nowMs() { return new Date().getTime(); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dateStr(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /* Calendar-day arithmetic. Never step days by adding 86400000 ms: across a
     daylight-saving change consecutive local midnights are 23h or 25h apart,
     which silently drops or duplicates a day. setDate() moves whole calendar
     days regardless of clock changes. */
  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function addDays(date, n) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  // Whole calendar days between two local midnights (rounding absorbs 23h/25h days).
  function dayDelta(fromTs, toTs) {
    return Math.round((startOfDay(toTs).getTime() - startOfDay(fromTs).getTime()) / 86400000);
  }
  function genId() {
    return "s" + nowMs().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
  function dateFromKey(k) {
    var p = k.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
  }

  function variationByName(areaId, name) {
    var list = (typeof VARIATIONS !== "undefined" && VARIATIONS[areaId]) || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  /* ---------- State ---------- */

  function defaultState() {
    var areas = {};
    AREAS.forEach(function (a) { areas[a.id] = { step: 1, std: 0, mts: 0 }; });
    return {
      v: MODEL_VERSION,
      areas: areas,
      log: [],
      // ghostBase: a frozen { d, v } the "where I started" line measures from,
      // or null for "all of my history". It's a copy rather than a pointer at a
      // stored day because the day's snapshot keeps being rewritten as you
      // train — and it lives in settings rather than being done by deleting old
      // snapshots, because a sync merge unions snapshots by day and would just
      // bring the deleted ones back from the other device.
      settings: { restSeconds: DEFAULT_REST, ghostBase: null },
      routine: { enabled: false, daysPerWeek: 3, sessionIndex: 0 },
      snapshots: [],   // [{ d:"YYYY-MM-DD", v:[6 radar values] }] for the ghost radar
      milestones: [],  // [{ id, ts, type:"advance"|"master", areaId, step }]
      deleted: [],     // [{ id, ts }] tombstones so a delete survives a sync merge
      prefsMts: 0
    };
  }

  // Accepts a v1 (progress-only) or v2 (with log + settings) object and always
  // returns a clean v2 state. Invalid pieces are dropped, not fatal.
  function sanitizeState(s) {
    // areas must be a real object map — a truthy scalar/array would slip past a
    // bare `!s.areas` check and let a corrupt file zero out all progress.
    if (!s || typeof s !== "object" || !s.areas || typeof s.areas !== "object" || Array.isArray(s.areas)) return null;
    var out = defaultState();
    AREAS.forEach(function (a) {
      var st = s.areas[a.id];
      if (st && typeof st === "object") {
        var step = Math.round(Number(st.step));
        var std = Math.round(Number(st.std));
        if (step >= 1 && step <= 10) out.areas[a.id].step = step;
        if (std >= 0 && std <= 3) out.areas[a.id].std = std;
        var mts = Number(st.mts);
        if (isFinite(mts) && mts > 0) out.areas[a.id].mts = mts;
      }
    });
    if (Array.isArray(s.log)) {
      out.log = s.log.map(sanitizeLogEntry).filter(Boolean);
    }
    if (s.settings && typeof s.settings === "object") {
      var rs = Math.round(Number(s.settings.restSeconds));
      if (rs >= 5 && rs <= 3600) out.settings.restSeconds = rs;
      // Same { d, v } shape as a snapshot, so the same validator does.
      out.settings.ghostBase = sanitizeSnapshot(s.settings.ghostBase);
    }
    if (s.routine && typeof s.routine === "object") {
      var dpw = Math.round(Number(s.routine.daysPerWeek));
      if ([2, 3, 6].indexOf(dpw) !== -1) out.routine.daysPerWeek = dpw;
      out.routine.enabled = !!s.routine.enabled;
      var si = Math.round(Number(s.routine.sessionIndex));
      if (si >= 0 && si < 50) out.routine.sessionIndex = si;
    }
    if (Array.isArray(s.snapshots)) {
      out.snapshots = s.snapshots.map(sanitizeSnapshot).filter(Boolean).slice(-400);
    }
    // The first version of this feature stored only a date and read the values
    // back out of that day's snapshot; carry those settings over.
    if (!out.settings.ghostBase && s.settings && typeof s.settings.ghostFrom === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(s.settings.ghostFrom)) {
      for (var gi = 0; gi < out.snapshots.length; gi++) {
        if (out.snapshots[gi].d >= s.settings.ghostFrom) {
          out.settings.ghostBase = { d: out.snapshots[gi].d, v: out.snapshots[gi].v.slice() };
          break;
        }
      }
    }
    if (Array.isArray(s.milestones)) {
      out.milestones = s.milestones.map(sanitizeMilestone).filter(Boolean).slice(-500);
    }
    if (Array.isArray(s.deleted)) {
      out.deleted = s.deleted.map(sanitizeTombstone).filter(Boolean).slice(-400);
    }
    var pm = Number(s.prefsMts);
    if (isFinite(pm) && pm > 0) out.prefsMts = pm;
    return out;
  }

  function sanitizeTombstone(t) {
    if (!t || typeof t !== "object") return null;
    if (typeof t.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(t.id)) return null;
    var ts = Number(t.ts);
    if (!isFinite(ts) || ts <= 0) ts = nowMs();
    return { id: t.id, ts: ts };
  }

  function sanitizeSnapshot(sn) {
    if (!sn || typeof sn !== "object") return null;
    if (typeof sn.d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sn.d)) return null;
    if (!Array.isArray(sn.v) || sn.v.length !== AREAS.length) return null;
    var v = sn.v.map(function (x) { var n = Number(x); return (isFinite(n) && n >= 0 && n <= 10) ? n : 0; });
    return { d: sn.d, v: v };
  }

  function sanitizeMilestone(m) {
    if (!m || typeof m !== "object") return null;
    if (["advance", "master"].indexOf(m.type) === -1) return null;
    if (KNOWN_IDS.indexOf(m.areaId) === -1) return null;
    var step = Math.round(Number(m.step));
    if (!(step >= 1 && step <= 10)) return null;
    var ts = Number(m.ts); if (!isFinite(ts) || ts <= 0) ts = nowMs();
    var id = (typeof m.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(m.id)) ? m.id : genId();
    return { id: id, ts: ts, type: m.type, areaId: m.areaId, step: step };
  }

  function sanitizeLogEntry(e) {
    if (!e || typeof e !== "object") return null;
    if (KNOWN_IDS.indexOf(e.areaId) === -1) return null;
    var step = Math.round(Number(e.step));
    if (!(step >= 1 && step <= 10)) return null;
    if (!Array.isArray(e.sets)) return null;
    var sets = [];
    e.sets.forEach(function (x) {
      var v = Math.round(Number(x));
      if (isFinite(v) && v >= 0) sets.push(v);
    });
    if (!sets.length) return null;
    var ts = Number(e.ts);
    if (!isFinite(ts) || ts <= 0) ts = nowMs();
    var date = (typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) ? e.date : dateStr(ts);
    // Restrict ids to a safe charset so a hand-crafted backup can't inject markup.
    var id = (typeof e.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(e.id)) ? e.id : genId();
    var note = (typeof e.note === "string") ? e.note.slice(0, 280) : "";
    // Entries written before sync existed have no mts; treat the session time as
    // their last edit, so a genuinely edited copy on another device wins.
    var mts = Number(e.mts);
    if (!isFinite(mts) || mts <= 0) mts = ts;
    // Which variation was done, if not the step's own exercise. Only names the
    // data file knows are kept, so a hand-edited backup can't inject markup.
    var variant = (typeof e.variant === "string" && variationByName(e.areaId, e.variant)) ? e.variant : "";
    return { id: id, ts: ts, date: date, areaId: e.areaId, step: step, sets: sets, note: note, mts: mts, variant: variant };
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
      v: MODEL_VERSION,
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
    BUILD: BUILD,
    MODEL_VERSION: MODEL_VERSION,
    KNOWN_IDS: KNOWN_IDS,
    DEFAULT_REST: DEFAULT_REST,
    nowMs: nowMs,
    pad2: pad2,
    dateStr: dateStr,
    startOfDay: startOfDay,
    addDays: addDays,
    dayDelta: dayDelta,
    genId: genId,
    dateFromKey: dateFromKey,
    variationByName: variationByName,
    defaultState: defaultState,
    sanitizeState: sanitizeState,
    sanitizeTombstone: sanitizeTombstone,
    sanitizeSnapshot: sanitizeSnapshot,
    sanitizeMilestone: sanitizeMilestone,
    sanitizeLogEntry: sanitizeLogEntry,
    merge: merge
  };
})();
