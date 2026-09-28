/* ============================================================
   Milo — data model.

   Everything that decides what a saved state looks like: the
   calendar-day helpers, the default state, the sanitizers every
   load / restore / sync goes through, and the merge that
   reconciles two devices. Pure functions over plain objects — no
   DOM, no storage — so tests/ can run them in Node.

   app.js and sync.js use these through the MODEL object. Changing
   what a sanitizer outputs changes what every device stores: run
   sh tests/run.sh, and see ROADMAP.md before touching it.

   Stored shape, data v5 (keys in this order):
   {
     v: 5,
     areas:      { [areaId]: { step 1..10, std 0..3, mts } },
     log:        entries sorted by (ts, id), one per exercise done:
                   bodyweight  { id, ts, date, areaId, step, sets, note, mts, variant }
                   gym         { id, ts, kind:"gym",   exId, sets:[reps], kg:[weight], note, mts }
                   quick       { id, ts, kind:"quick", groups:{ group: sets }, note, mts }
                   body        { id, ts, kind:"body",  kg, waist, note, mts }
     settings:   { restSeconds, restGym, autoRest, ghostBase, vol:[lo,hi], keepAwake }
     routine:    { split, mode, sessionIndex, override }
     pm:         { field: last-changed ms } for every settings/routine field
     snapshots:  [{ d, v:[6 radar values] }]
     milestones: [{ id, ts, type, areaId, step }]
     deleted:    [{ id, ts }]   tombstones, so a delete survives a merge
     exercises:  custom gym exercises ("x_" ids) and tweaks to built-in ones
   }
   ============================================================ */

var MODEL = (function () {
  "use strict";

  var BUILD = "milo-v19";

  // The shape of the stored data. Any change to what the sanitizers output is a
  // change to what every device keeps: bump this, and see ROADMAP.md.
  var MODEL_VERSION = 5;

  var KNOWN_IDS = AREAS.map(function (a) { return a.id; });
  var DEFAULT_REST = 180; // seconds

  // Muscle groups, in their canonical order. Part of the stored format (quick
  // logs and exercises name them), so this list is tied to MODEL_VERSION.
  var GROUPS = ["chest", "back", "shoulders", "arms", "abs", "legs"];

  // Every preference, each merged on its own (see merge()).
  var SETTINGS_FIELDS = ["restSeconds", "restGym", "autoRest", "ghostBase", "vol", "keepAwake"];
  var ROUTINE_FIELDS = ["split", "mode", "sessionIndex", "override"];
  var PREF_FIELDS = SETTINGS_FIELDS.concat(ROUTINE_FIELDS);

  var CAPS = { snapshots: 400, milestones: 500, deleted: 1000, exercises: 300, setsPerEntry: 30 };

  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  // Preferences carried over from data v4 count as made no later than this
  // instant (the v5 release), and every change made in v5 is stamped after it.
  // So an old copy of the app that keeps running for a while after the update
  // can never undo a choice made in the new version.
  var MIGRATED_PREFS_MAX = Date.UTC(2026, 8, 27, 21, 0);
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // Checked by format, not against data.js: renaming a variation there must
  // never erase what someone logged. Always rendered escaped.
  var VARIANT_RE = /^[^<>"&\u0000-\u001f]{0,40}$/;

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

  // A "last changed" stamp that always moves forward, even if this device's
  // clock is behind the one that wrote the previous value — otherwise a fresh
  // edit could lose a merge to an older one.
  function stamp(prev) {
    var p = Number(prev);
    return Math.max(nowMs(), (isFinite(p) ? p : 0) + 1);
  }
  // The same for a preference, which must also beat anything migrated from v4.
  function stampPref(prev) { return Math.max(stamp(prev), MIGRATED_PREFS_MAX + 1); }

  // Names checked by format can still collide with what every object inherits
  // ("constructor", "__proto__"), which would break a lookup table keyed by
  // them. Such a name is never valid.
  function plainName(x, re) {
    return typeof x === "string" && re.test(x) && !(x in Object.prototype);
  }
  // A lookup table keyed by ids from stored data: no inherited keys at all.
  function dict() { return Object.create(null); }

  function variationByName(areaId, name) {
    var list = (typeof VARIATIONS !== "undefined" && VARIATIONS[areaId]) || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  /* ---------- Numbers ---------- */

  // Weights typed on an Italian keypad arrive as "62,5".
  function parseKg(x) {
    if (typeof x === "number") return x;
    if (typeof x !== "string") return NaN;
    var t = x.trim().replace(",", ".");
    return t === "" ? NaN : Number(t);
  }
  // Nearest 0.25 kg, 0–1000.
  function roundKg(x) {
    if (!isFinite(x)) return 0;
    return Math.min(1000, Math.max(0, Math.round(x * 4) / 4));
  }
  function posNumber(x) {
    var n = Number(x);
    return (isFinite(n) && n > 0) ? n : 0;
  }
  function intIn(x, lo, hi) {
    if (x === null || x === "" || typeof x === "boolean") return null;
    var n = Math.round(Number(x));
    return (isFinite(n) && n >= lo && n <= hi) ? n : null;
  }

  /* ---------- Defaults ---------- */

  function defaultSettings() {
    return { restSeconds: DEFAULT_REST, restGym: 120, autoRest: true, ghostBase: null, vol: [10, 20], keepAwake: false };
  }
  function defaultRoutine() {
    return { split: "off", mode: "bw", sessionIndex: 0, override: null };
  }
  function defaultPm() {
    var pm = {};
    PREF_FIELDS.forEach(function (f) { pm[f] = 0; });
    return pm;
  }

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
      settings: defaultSettings(),
      routine: defaultRoutine(),
      pm: defaultPm(),
      snapshots: [],   // [{ d:"YYYY-MM-DD", v:[6 radar values] }] for the ghost radar
      milestones: [],  // [{ id, ts, type:"advance"|"master", areaId, step }]
      deleted: [],     // [{ id, ts }] tombstones so a delete survives a sync merge
      exercises: []
    };
  }

  // True for data written by a newer version of the app. Such data must never
  // be sanitized down to this version and written back: that would strip
  // whatever the newer version added.
  function isNewer(raw) {
    return !!raw && typeof raw === "object" && Number(raw.v) > MODEL_VERSION;
  }

  /* ---------- Entry kinds ---------- */

  // A skill-ladder session: the only kind with areaId, step, sets and variant.
  function isBodyweight(e) { return !!e && !e.kind; }
  // Any training: everything except a weigh-in (and kinds this version
  // doesn't know, which the sanitizer drops anyway).
  function isTraining(e) { return !!e && (!e.kind || e.kind === "gym" || e.kind === "quick"); }

  /* ---------- Sanitizing ---------- */

  // Accepts any older shape (v1 progress-only through v4) or a v5 state and
  // returns a clean v5 state; invalid pieces are dropped, not fatal. Returns
  // null for something that isn't a state at all, and for newer data.
  function sanitizeState(s) {
    // areas must be a real object map — a truthy scalar/array would slip past a
    // bare `!s.areas` check and let a corrupt file zero out all progress.
    if (!s || typeof s !== "object" || !s.areas || typeof s.areas !== "object" || Array.isArray(s.areas)) return null;
    if (isNewer(s)) return null;
    // Before v5 there were no per-field stamps: one prefsMts covered everything.
    var legacyShape = !s.pm || typeof s.pm !== "object" || Array.isArray(s.pm);
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
      out.log = sortLog(dedupeById(s.log.map(sanitizeLogEntry).filter(Boolean), newerEntry));
    }

    var hasSettings = !!s.settings && typeof s.settings === "object";
    var hasRoutine = !!s.routine && typeof s.routine === "object";
    var ss = hasSettings ? s.settings : {};
    var rr = hasRoutine ? s.routine : {};

    var rs = intIn(ss.restSeconds, 5, 3600);
    if (rs !== null) out.settings.restSeconds = rs;
    var rg = intIn(ss.restGym, 5, 3600);
    if (rg !== null) out.settings.restGym = rg;
    if (typeof ss.autoRest === "boolean") out.settings.autoRest = ss.autoRest;
    // Same { d, v } shape as a snapshot, so the same validator does.
    if (hasSettings) out.settings.ghostBase = sanitizeSnapshot(ss.ghostBase);
    var vol = sanitizeVol(ss.vol);
    if (vol) out.settings.vol = vol;
    if (typeof ss.keepAwake === "boolean") out.settings.keepAwake = ss.keepAwake;

    if (legacyShape) {
      // v1–v4: { enabled, daysPerWeek, sessionIndex }. An enabled routine with
      // an unknown day count ran as 3 days a week, so it migrates as that.
      if (hasRoutine && rr.enabled) {
        var dpw = Math.round(Number(rr.daysPerWeek));
        out.routine.split = "bb" + ([2, 3, 6].indexOf(dpw) !== -1 ? dpw : 3);
      }
    } else {
      if (plainName(rr.split, /^[a-z0-9_]{1,16}$/)) out.routine.split = rr.split;
      if (plainName(rr.mode, /^[a-z]{1,8}$/)) out.routine.mode = rr.mode;
      out.routine.override = sanitizeOverride(rr.override);
    }
    var si = intIn(rr.sessionIndex, 0, 49);
    if (si !== null) out.routine.sessionIndex = si;

    if (Array.isArray(s.snapshots)) {
      out.snapshots = collapseSnapshots(s.snapshots.map(sanitizeSnapshot).filter(Boolean)).slice(-CAPS.snapshots);
    }
    // The first version of this feature stored only a date and read the values
    // back out of that day's snapshot; carry those settings over.
    if (!out.settings.ghostBase && hasSettings && typeof ss.ghostFrom === "string" && DATE_RE.test(ss.ghostFrom)) {
      for (var gi = 0; gi < out.snapshots.length; gi++) {
        if (out.snapshots[gi].d >= ss.ghostFrom) {
          out.settings.ghostBase = { d: out.snapshots[gi].d, v: out.snapshots[gi].v.slice() };
          break;
        }
      }
    }
    if (Array.isArray(s.milestones)) {
      out.milestones = collapseMilestones(s.milestones.map(sanitizeMilestone).filter(Boolean)).slice(-CAPS.milestones);
    }
    if (Array.isArray(s.deleted)) {
      out.deleted = collapseTombstones(s.deleted.map(sanitizeTombstone).filter(Boolean)).slice(-CAPS.deleted);
    }
    // An entry whose delete is newer than its last edit is gone (the same rule
    // merge() applies), so a sanitized state is never self-contradictory.
    out.log = dropDeleted(out.log, tombIndex(out.deleted));

    // Preference stamps.
    if (legacyShape) {
      // Everything carried over from an older version counts as a real choice
      // made at the old prefsMts — at least 1, so it always beats the untouched
      // defaults (stamp 0) of a freshly paired device, and at most the release
      // instant, so it never beats a choice made in v5 (see stampPref).
      var base = Math.min(Math.max(posNumber(s.prefsMts), 1), MIGRATED_PREFS_MAX);
      if (hasSettings) { out.pm.restSeconds = base; out.pm.ghostBase = base; }
      if (hasRoutine) { out.pm.split = base; out.pm.sessionIndex = base; }
    } else {
      PREF_FIELDS.forEach(function (f) { out.pm[f] = posNumber(s.pm[f]); });
    }
    // Invariant: a value that isn't the default always carries a stamp, so an
    // untouched default can never win a merge against a real choice.
    var defs = defaultSettings(), defr = defaultRoutine();
    SETTINGS_FIELDS.forEach(function (f) {
      if (out.pm[f] === 0 && JSON.stringify(out.settings[f]) !== JSON.stringify(defs[f])) out.pm[f] = 1;
    });
    ROUTINE_FIELDS.forEach(function (f) {
      if (out.pm[f] === 0 && JSON.stringify(out.routine[f]) !== JSON.stringify(defr[f])) out.pm[f] = 1;
    });

    if (Array.isArray(s.exercises)) out.exercises = sanitizeExercises(s.exercises, out.log);
    return out;
  }

  function sanitizeVol(v) {
    if (!Array.isArray(v) || v.length !== 2) return null;
    var lo = intIn(v[0], 1, 60), hi = intIn(v[1], 1, 60);
    return (lo !== null && hi !== null && lo <= hi) ? [lo, hi] : null;
  }

  function sanitizeOverride(o) {
    if (!o || typeof o !== "object") return null;
    if (typeof o.d !== "string" || !DATE_RE.test(o.d)) return null;
    var day = intIn(o.day, 0, 19);
    return day === null ? null : { d: o.d, day: day };
  }

  function sanitizeTombstone(t) {
    if (!t || typeof t !== "object") return null;
    if (typeof t.id !== "string" || !ID_RE.test(t.id)) return null;
    var ts = Number(t.ts);
    if (!isFinite(ts) || ts <= 0) ts = nowMs();
    return { id: t.id, ts: ts };
  }

  function sanitizeSnapshot(sn) {
    if (!sn || typeof sn !== "object") return null;
    if (typeof sn.d !== "string" || !DATE_RE.test(sn.d)) return null;
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
    var id = (typeof m.id === "string" && ID_RE.test(m.id)) ? m.id : genId();
    return { id: id, ts: ts, type: m.type, areaId: m.areaId, step: step };
  }

  // Fields every log entry shares.
  function entryId(e) { return (typeof e.id === "string" && ID_RE.test(e.id)) ? e.id : genId(); }
  function entryTs(e) { var ts = Number(e.ts); return (!isFinite(ts) || ts <= 0) ? nowMs() : ts; }
  function entryNote(e) { return (typeof e.note === "string") ? e.note.slice(0, 280) : ""; }
  function entryMts(e, ts) {
    // Entries written before sync existed have no mts; treat the session time as
    // their last edit, so a genuinely edited copy on another device wins.
    var mts = Number(e.mts);
    return (!isFinite(mts) || mts <= 0) ? ts : mts;
  }

  function sanitizeLogEntry(e) {
    if (!e || typeof e !== "object") return null;
    if (e.kind === undefined) return sanitizeBodyweight(e);
    if (e.kind === "gym") return sanitizeGym(e);
    if (e.kind === "quick") return sanitizeQuick(e);
    if (e.kind === "body") return sanitizeBody(e);
    return null;
  }

  // Calisthenics ladder sessions: exactly the v4 rules, apart from the variant.
  function sanitizeBodyweight(e) {
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
    var ts = entryTs(e);
    var date = (typeof e.date === "string" && DATE_RE.test(e.date)) ? e.date : dateStr(ts);
    // Restrict ids to a safe charset so a hand-crafted backup can't inject markup.
    var id = entryId(e);
    var note = entryNote(e);
    var mts = entryMts(e, ts);
    var variant = (typeof e.variant === "string" && VARIANT_RE.test(e.variant)) ? e.variant : "";
    return { id: id, ts: ts, date: date, areaId: e.areaId, step: step, sets: sets, note: note, mts: mts, variant: variant };
  }

  // One gym exercise: reps per set with the weight lifted for each set.
  function sanitizeGym(e) {
    if (typeof e.exId !== "string" || !ID_RE.test(e.exId)) return null;
    if (!Array.isArray(e.sets)) return null;
    var kgIn = Array.isArray(e.kg) ? e.kg : [];
    var sets = [], kg = [];
    e.sets.forEach(function (x, i) {
      if (sets.length >= CAPS.setsPerEntry) return;
      var r = intIn(x, 0, 3600);
      if (r === null) return;       // an unreadable set is dropped with its weight
      sets.push(r);
      kg.push(roundKg(parseKg(kgIn[i])));
    });
    if (!sets.length) return null;
    var ts = entryTs(e);
    return { id: entryId(e), ts: ts, kind: "gym", exId: e.exId, sets: sets, kg: kg, note: entryNote(e), mts: entryMts(e, ts) };
  }

  // A quick log: which muscle groups were trained, and roughly how many sets.
  function sanitizeQuick(e) {
    if (!e.groups || typeof e.groups !== "object" || Array.isArray(e.groups)) return null;
    var groups = {}, any = false;
    GROUPS.forEach(function (g) {
      var n = intIn(e.groups[g], 1, 50);
      if (n !== null) { groups[g] = n; any = true; }
    });
    if (!any) return null;
    var ts = entryTs(e);
    return { id: entryId(e), ts: ts, kind: "quick", groups: groups, note: entryNote(e), mts: entryMts(e, ts) };
  }

  // A weigh-in: body weight, optionally waist.
  function sanitizeBody(e) {
    var kg = Math.round(parseKg(e.kg) * 10) / 10;
    if (!isFinite(kg) || kg < 20 || kg > 300) return null;
    var waist = null;
    if (e.waist !== null && e.waist !== undefined && e.waist !== "") {
      var w = Math.round(parseKg(e.waist) * 10) / 10;
      if (isFinite(w) && w >= 30 && w <= 250) waist = w;
    }
    var ts = entryTs(e);
    return { id: entryId(e), ts: ts, kind: "body", kg: kg, waist: waist, note: entryNote(e), mts: entryMts(e, ts) };
  }

  /* ---------- Exercises ---------- */

  var DEFAULT_INC = { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5, kettlebell: 4, bodyweight: 2.5, other: 2.5 };

  function validInc(x) {
    var n = parseKg(x);
    if (!isFinite(n)) return null;
    var k = roundKg(n);
    return (k >= 0.25 && k <= 50) ? k : null;
  }
  function validRange(lo, hi) {
    var l = intIn(lo, 1, 600), h = intIn(hi, 1, 600);
    return (l !== null && h !== null && l <= h) ? [l, h] : null;
  }

  // Custom exercises ("x_" ids) carry everything; any other id is a tweak to a
  // built-in exercise (its rep range, weight step or setup note). Bad values
  // are clamped, never fatal — log entries point at these ids.
  function sanitizeExercise(r) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !ID_RE.test(r.id)) return null;
    var mts = posNumber(r.mts);
    var note = (typeof r.note === "string") ? r.note.slice(0, 80) : "";
    if (r.id.indexOf("x_") === 0) {
      var name = (typeof r.name === "string") ? r.name.replace(/\s+/g, " ").trim().slice(0, 40).trim() : "";
      var group = GROUPS.indexOf(r.group) !== -1 ? r.group : "";
      var sec = Array.isArray(r.sec) ? GROUPS.filter(function (g) { return g !== group && r.sec.indexOf(g) !== -1; }).slice(0, 3) : [];
      var equip = plainName(r.equip, /^[a-z]{1,12}$/) ? r.equip : "other";
      var load = plainName(r.load, /^[a-z]{1,8}$/) ? r.load : "ext";
      var timed = r.timed === true;
      var inc = validInc(r.inc);
      var range = validRange(r.lo, r.hi) || (timed ? [20, 60] : [8, 12]);
      return {
        id: r.id, name: name || "Unnamed exercise", group: group, sec: sec, equip: equip, load: load,
        timed: timed, perHand: r.perHand === true, inc: inc === null ? (DEFAULT_INC[equip] || 2.5) : inc,
        lo: range[0], hi: range[1], note: note, del: r.del === true, mts: mts
      };
    }
    var rangeO = validRange(r.lo, r.hi);
    return { id: r.id, inc: validInc(r.inc), lo: rangeO ? rangeO[0] : null, hi: rangeO ? rangeO[1] : null, note: note, mts: mts };
  }

  function sanitizeExercises(list, log) {
    var recs = dedupeById(list.map(sanitizeExercise).filter(Boolean), newerRecord);
    recs.sort(function (x, y) { return cmp(x.id, y.id); });
    if (recs.length <= CAPS.exercises) return recs;
    // Over the cap: drop what nothing refers to, deleted ones first, then the
    // longest untouched. An exercise the log still uses is never dropped.
    var used = dict();
    (log || []).forEach(function (e) { if (e.kind === "gym") used[e.exId] = true; });
    var spare = recs.filter(function (r) { return !used[r.id]; })
      .sort(function (x, y) { return ((y.del ? 1 : 0) - (x.del ? 1 : 0)) || (x.mts - y.mts) || cmp(x.id, y.id); });
    var drop = dict(), dropped = 0;
    for (var i = 0; i < spare.length && recs.length - dropped > CAPS.exercises; i++) { drop[spare[i].id] = true; dropped++; }
    return recs.filter(function (r) { return !drop[r.id]; });
  }

  /* ---------- Ordering helpers ---------- */

  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function jsonCmp(a, b) { return cmp(JSON.stringify(a), JSON.stringify(b)); }

  function sortLog(log) { return log.sort(function (x, y) { return (x.ts - y.ts) || cmp(x.id, y.id); }); }
  function sortByTsId(list) { return list.sort(function (x, y) { return (x.ts - y.ts) || cmp(x.id, y.id); }); }

  // Keep one record per id, the one `wins(candidate, current)` prefers.
  function dedupeById(list, wins) {
    var byId = dict(), order = [];
    list.forEach(function (x) {
      if (!byId[x.id]) { byId[x.id] = x; order.push(x.id); }
      else if (wins(x, byId[x.id])) byId[x.id] = x;
    });
    return order.map(function (id) { return byId[id]; });
  }
  // One tombstone per id, the latest; sorted.
  function collapseTombstones(list) {
    var byId = dict();
    list.forEach(function (t) { if (!byId[t.id] || t.ts > byId[t.id].ts) byId[t.id] = { id: t.id, ts: t.ts }; });
    return sortByTsId(Object.keys(byId).map(function (id) { return byId[id]; }));
  }
  function tombIndex(deleted) {
    var t = dict();
    deleted.forEach(function (d) { t[d.id] = d.ts; });
    return t;
  }
  // A delete beats the entry it removed, but not an edit made afterwards.
  function dropDeleted(log, tomb) {
    return log.filter(function (e) { return !(tomb[e.id] && tomb[e.id] >= (e.mts || e.ts)); });
  }
  // One milestone per id (the earliest), then one per achievement: the same
  // step reached on two devices gets two random ids, so keep the earliest.
  function collapseMilestones(list) {
    var byId = dict();
    list.forEach(function (m) {
      var prev = byId[m.id];
      if (!prev || m.ts < prev.ts || (m.ts === prev.ts && jsonCmp(m, prev) < 0)) byId[m.id] = m;
    });
    var byWhat = dict();
    Object.keys(byId).forEach(function (id) {
      var m = byId[id];
      var key = m.type + "|" + m.areaId + "|" + m.step;
      var prev = byWhat[key];
      if (!prev || m.ts < prev.ts || (m.ts === prev.ts && m.id < prev.id)) byWhat[key] = m;
    });
    return sortByTsId(Object.keys(byWhat).map(function (k) { return byWhat[k]; }));
  }
  // One snapshot per day, component-wise maximum; sorted by day.
  function collapseSnapshots(list) {
    var byDay = dict();
    list.forEach(function (sn) {
      var prev = byDay[sn.d];
      if (!prev) { byDay[sn.d] = { d: sn.d, v: sn.v.slice() }; return; }
      for (var i = 0; i < sn.v.length && i < prev.v.length; i++) {
        if (sn.v[i] > prev.v[i]) prev.v[i] = sn.v[i];
      }
    });
    return Object.keys(byDay).sort().map(function (d) { return byDay[d]; });
  }

  // Edit clash on one entry: the later edit wins; identical stamps fall back
  // to comparing the content, so every device picks the same one.
  function newerEntry(e, prev) {
    var em = e.mts || e.ts, pm = prev.mts || prev.ts;
    if (em !== pm) return em > pm;
    return jsonCmp(e, prev) > 0;
  }
  function newerRecord(x, prev) {
    if (x.mts !== prev.mts) return x.mts > prev.mts;
    return jsonCmp(x, prev) > 0;
  }

  /* ---------- Merge ---------- */

  /* Reconciles two states without a server-side arbiter. Every rule is a
     union plus a total-order choice, so the result is the same whichever
     device merges first, however often, and in whatever grouping
     (commutative, idempotent, associative — tests/merge-test.js checks all
     three on hundreds of random states):

       sessions    union by id; the newer edit wins (tie: larger JSON)
       deletions   a tombstone beats the entry unless it was edited after the delete
       areas       the newer change wins (ties: the higher position, then larger JSON)
       milestones  union by id (earliest), then one per achievement (earliest)
       snapshots   one per day, component-wise maximum
       exercises   union by id; the newer change wins (tie: larger JSON)
       prefs       EACH setting on its own: the newer stamp wins (tie: larger
                   JSON); a side that lacks the field entirely never wins

     Inputs should be sanitized states; callers sanitize the output (caps).
  */
  function merge(a, b) {
    if (!b) return a;
    if (!a) return b;

    var out = {
      v: MODEL_VERSION,
      areas: {},
      log: [],
      settings: {},
      routine: {},
      pm: {},
      snapshots: [],
      milestones: [],
      deleted: [],
      exercises: []
    };

    // --- areas ---
    AREAS.forEach(function (ar) {
      var x = a.areas && a.areas[ar.id], y = b.areas && b.areas[ar.id];
      out.areas[ar.id] = !x ? y : (!y ? x : pickArea(x, y));
    });

    // --- tombstones, then the log they apply to ---
    out.deleted = collapseTombstones(concat(a.deleted, b.deleted));
    out.log = dropDeleted(sortLog(dedupeById(concat(a.log, b.log), newerEntry)), tombIndex(out.deleted));

    // --- milestones, snapshots ---
    out.milestones = collapseMilestones(concat(a.milestones, b.milestones));
    out.snapshots = collapseSnapshots(concat(a.snapshots, b.snapshots));

    // --- exercises ---
    var xById = dict();
    concat(a.exercises, b.exercises).forEach(function (r) {
      if (!xById[r.id] || newerRecord(r, xById[r.id])) xById[r.id] = r;
    });
    out.exercises = Object.keys(xById).sort().map(function (id) { return xById[id]; });

    // --- preferences, one field at a time ---
    var defs = defaultSettings(), defr = defaultRoutine();
    PREF_FIELDS.forEach(function (f) {
      var box = SETTINGS_FIELDS.indexOf(f) !== -1 ? "settings" : "routine";
      var ta = prefStamp(a, box, f), tb = prefStamp(b, box, f);
      var value;
      if (ta < 0 && tb < 0) value = (box === "settings" ? defs : defr)[f];
      else if (ta !== tb) value = (ta > tb ? a : b)[box][f];
      else {
        var va = a[box][f], vb = b[box][f];
        value = jsonCmp(va, vb) >= 0 ? va : vb;
      }
      out[box][f] = value === undefined ? null : JSON.parse(JSON.stringify(value));
      out.pm[f] = Math.max(ta, tb, 0);
    });

    return out;
  }

  // A side's claim on one preference: its stamp, 0 for an unstamped value,
  // or -1 when the side doesn't carry the field at all (so it can't win).
  function prefStamp(side, box, f) {
    var c = side[box];
    if (!c || typeof c !== "object" || !Object.prototype.hasOwnProperty.call(c, f)) return -1;
    var t = side.pm && Number(side.pm[f]);
    return (isFinite(t) && t > 0) ? t : 0;
  }

  function concat(a, b) {
    return (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []);
  }

  function pickArea(a, b) {
    var am = Number(a.mts) || 0, bm = Number(b.mts) || 0;
    if (am > bm) return a;
    if (bm > am) return b;
    // Same millisecond (or both pre-date sync): break the tie by position, then
    // by content, so the two devices can't disagree about the winner.
    var av = (a.step - 1) + a.std / 3, bv = (b.step - 1) + b.std / 3;
    if (av !== bv) return bv > av ? b : a;
    return jsonCmp(b, a) > 0 ? b : a;
  }

  /* ---------- Sync decisions ---------- */

  // The old-format cloud record (written by devices still on data v4) is read
  // for its training — sessions, positions, milestones, deletions — but never
  // for preferences: those now sync per field, and an old device's settings
  // would otherwise reset newer choices.
  function legacyForMerge(s) {
    var out = {};
    Object.keys(s).forEach(function (k) {
      if (k !== "settings" && k !== "routine" && k !== "pm") out[k] = s[k];
    });
    return out;
  }

  /* One sync round's decision, as a pure function.
       local   this device's (sanitized) state
       remote  { status: "absent" | "ok" | "unreadable", raw } for the cloud record
       legacy  the same for the old-format record, or null when not fetched
     Returns { newer } when the cloud holds data from a newer version (do
     nothing: this device must update first), { blocked } when the cloud copy
     can't be read (never overwrite what we can't read), otherwise
     { state, changed, push }. */
  function reconcile(local, remote, legacy) {
    var r = null;
    if (remote && remote.status === "unreadable") return { blocked: true };
    if (remote && remote.status === "ok") {
      if (isNewer(remote.raw)) return { newer: true };
      r = sanitizeState(remote.raw);
      if (!r) return { blocked: true };
    }
    var l = null;
    if (legacy && legacy.status === "ok" && !isNewer(legacy.raw)) {
      var ls = sanitizeState(legacy.raw);
      if (ls) l = legacyForMerge(ls);
    }
    var m = local;
    if (r) m = merge(m, r);
    if (l) m = merge(m, l);
    m = sanitizeState(m);
    var mJ = JSON.stringify(m);
    return { state: m, changed: mJ !== JSON.stringify(local), push: !r || JSON.stringify(r) !== mJ };
  }

  /* Another tab on this device saved. Take its changes in; write back only if
     this tab holds something the other one lacks (so two tabs can never keep
     rewriting each other). */
  function absorb(local, raw) {
    if (!raw || typeof raw !== "object") return { state: local, changed: false, save: false };
    if (isNewer(raw)) return { state: local, changed: false, save: false, readOnly: true };
    var incoming = sanitizeState(raw);
    if (!incoming) return { state: local, changed: false, save: false };
    var m = sanitizeState(merge(local, incoming));
    var mJ = JSON.stringify(m);
    return { state: m, changed: mJ !== JSON.stringify(local), save: mJ !== JSON.stringify(incoming) };
  }

  return {
    BUILD: BUILD,
    MODEL_VERSION: MODEL_VERSION,
    KNOWN_IDS: KNOWN_IDS,
    DEFAULT_REST: DEFAULT_REST,
    GROUPS: GROUPS,
    SETTINGS_FIELDS: SETTINGS_FIELDS,
    ROUTINE_FIELDS: ROUTINE_FIELDS,
    PREF_FIELDS: PREF_FIELDS,
    CAPS: CAPS,
    MIGRATED_PREFS_MAX: MIGRATED_PREFS_MAX,
    nowMs: nowMs,
    pad2: pad2,
    dateStr: dateStr,
    startOfDay: startOfDay,
    addDays: addDays,
    dayDelta: dayDelta,
    genId: genId,
    dateFromKey: dateFromKey,
    stamp: stamp,
    stampPref: stampPref,
    parseKg: parseKg,
    roundKg: roundKg,
    variationByName: variationByName,
    defaultSettings: defaultSettings,
    defaultRoutine: defaultRoutine,
    defaultState: defaultState,
    isNewer: isNewer,
    isBodyweight: isBodyweight,
    isTraining: isTraining,
    sanitizeState: sanitizeState,
    sanitizeTombstone: sanitizeTombstone,
    sanitizeSnapshot: sanitizeSnapshot,
    sanitizeMilestone: sanitizeMilestone,
    sanitizeLogEntry: sanitizeLogEntry,
    sortLog: sortLog,
    sanitizeExercise: sanitizeExercise,
    merge: merge,
    legacyForMerge: legacyForMerge,
    reconcile: reconcile,
    absorb: absorb
  };
})();
