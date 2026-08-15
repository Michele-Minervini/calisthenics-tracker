/* ============================================================
   Big Six Tracker — app logic
   Plain JavaScript, no dependencies.
   State shape (v4, migrates from v1/v2/v3 automatically):
   {
     v: 4,
     areas: { [areaId]: { step: 1..10, std: 0..3, mts } },
     log:   [ { id, ts, date:"YYYY-MM-DD", areaId, step, sets:[n,...], note, mts } ],
     settings: { restSeconds },
     routine: { enabled, daysPerWeek: 2|3|6, sessionIndex },
     snapshots: [ { d:"YYYY-MM-DD", v:[6 radar values] } ],   // ghost radar
     milestones: [ { id, ts, type:"advance"|"master", areaId, step } ],
     deleted: [ { id, ts } ],   // tombstones for deleted sessions
     prefsMts: 0                // last change to settings/routine
   }
   The `mts` (modified-at) fields and `deleted` exist only for cloud sync
   (sync.js): they let two devices be merged without losing or resurrecting
   anything. Nothing in the UI reads them.
   std: 0 = working on it, 1 = beginner met, 2 = intermediate met,
        3 = progression (or elite) met.
   Radar value per area = (step - 1) + std / 3  →  0..10 rings filled.

   Interaction model (no browser-history coupling — the panel stack
   is purely in-app):
   - Radar: area name label OR the area's wedge → that area's step list;
     the colored value dot → that area's current exercise directly.
   - Card → the area's step list. Step row → exercise detail.
   ============================================================ */

(function () {
  "use strict";

  var STORE_KEY = "bigsix.v1";
  var SVGNS = "http://www.w3.org/2000/svg";

  // Backup links encode progress as an ordered list. This order is FROZEN to
  // the original v1 payload layout so that old backup links import correctly,
  // no matter how the areas are displayed on screen.
  var PAYLOAD_ORDER = ["pushup", "squat", "pullup", "legraise", "bridge", "hspu"];

  // Display order of the area cards (pairs: row 1, row 2, row 3).
  var CARD_ORDER = ["pushup", "pullup", "hspu", "bridge", "legraise", "squat"];

  function areaIndexById(id) {
    for (var i = 0; i < AREAS.length; i++) if (AREAS[i].id === id) return i;
    return -1;
  }

  var KNOWN_IDS = AREAS.map(function (a) { return a.id; });
  var DEFAULT_REST = 180; // seconds

  // Guided routine presets: each is a list of sessions (a session = the areas
  // trained that day). Every preset covers all six movements once per cycle.
  var ROUTINE_PRESETS = {
    2: [["pushup", "pullup", "legraise"], ["squat", "bridge", "hspu"]],
    3: [["pushup", "squat"], ["pullup", "legraise"], ["hspu", "bridge"]],
    6: [["pushup"], ["squat"], ["pullup"], ["legraise"], ["bridge"], ["hspu"]]
  };
  function routineSessions() { return ROUTINE_PRESETS[state.routine.daysPerWeek] || ROUTINE_PRESETS[3]; }

  /* ---------- State ---------- */

  var memoryFallback = null;
  var storageOk = true;

  function defaultState() {
    var areas = {};
    AREAS.forEach(function (a) { areas[a.id] = { step: 1, std: 0, mts: 0 }; });
    return {
      v: 4,
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

  // True when stored data existed but could not be read/understood. We then
  // avoid auto-writing over it, so a recoverable file isn't destroyed on load.
  var loadFailed = false;

  function loadState() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      // Storage itself is unavailable (blocked/disabled) — distinct from bad data.
      storageOk = false;
      return memoryFallback || defaultState();
    }
    if (!raw) return defaultState();
    try {
      var clean = sanitizeState(JSON.parse(raw));
      if (!clean) { loadFailed = true; return defaultState(); }
      return clean;
    } catch (e) {
      loadFailed = true;
      return defaultState();
    }
  }

  // Returns true when the write actually landed. (User-initiated saves always
  // proceed; only the automatic boot-time write is suppressed after a bad load.)
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageOk = true;
      // Single hook for cloud sync: every change to the state lands here.
      scheduleSync();
      return true;
    } catch (e) {
      storageOk = false;
      memoryFallback = state;
      return false;
    }
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

  var state = loadState();

  function areaValue(areaId) {
    var st = state.areas[areaId];
    return (st.step - 1) + st.std / 3;
  }

  /* ---------- Helpers ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }

  function el(tag, attrs, text) {
    var node = document.createElementNS(SVGNS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    return node;
  }

  // Safe for both text and attribute contexts (escapes quotes too).
  function esc(s) {
    return String(s)
      .replace(/&(?!#?\w+;)/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function areaColorVar(a) { return "var(--c-" + a.id + ")"; }

  function stdLabelFor(area, stepIdx, stdIdx) {
    return area.steps[stepIdx].standards[stdIdx - 1].label;
  }

  function shortAreaName(a) {
    return a.id === "hspu" ? "Handstands" : a.name;
  }

  function videoURL(area, step) {
    var q = (step.name + " exercise tutorial")
      .replace(/½/g, "half ")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  function prettyDate(ts) {
    var dd = dateStr(ts);
    var today = startOfDay(nowMs());
    if (dd === dateStr(today.getTime())) return "Today";
    if (dd === dateStr(addDays(today, -1).getTime())) return "Yesterday";
    try {
      return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    } catch (e) { return dd; }
  }

  /* ---------- Standards parsing + auto-detection ---------- */

  // Turn a goal string ("2 sets of 25", "hold 1 minute") into something
  // comparable against a logged session.
  function parseStandard(target) {
    var t = String(target);
    var tm = t.match(/hold\s+(\d+)\s*(second|minute)/i);
    if (tm) {
      var n = parseInt(tm[1], 10);
      return { kind: "time", seconds: /min/i.test(tm[2]) ? n * 60 : n };
    }
    var rm = t.match(/(\d+)\s*sets?\s*of\s*(\d+)/i);
    if (rm) return { kind: "reps", sets: parseInt(rm[1], 10), reps: parseInt(rm[2], 10) };
    return { kind: "unknown" };
  }

  function sessionMeets(parsed, sets) {
    if (!parsed) return false;
    if (parsed.kind === "time") {
      return sets.some(function (v) { return v >= parsed.seconds; });
    }
    if (parsed.kind === "reps") {
      var qualifying = sets.filter(function (v) { return v >= parsed.reps; }).length;
      return qualifying >= parsed.sets;
    }
    return false;
  }

  // Highest standard (1=Beginner, 2=Intermediate, 3=Progression/Elite) a session
  // satisfies, or 0 if none. Standards rise in difficulty (the two step-10 Elite
  // goals use fewer sets, but reaching them still counts as topping the ladder).
  function detectStandard(step, sets) {
    var best = 0;
    for (var i = 0; i < step.standards.length; i++) {
      if (sessionMeets(parseStandard(step.standards[i].target), sets)) best = i + 1;
    }
    return best;
  }

  /* ---------- Training log ---------- */

  function addLogEntry(areaId, step, sets, note, variant) {
    var ts = nowMs();
    var entry = { id: genId(), ts: ts, date: dateStr(ts), areaId: areaId, step: step, sets: sets, note: note || "", mts: ts, variant: variant || "" };
    state.log.push(entry);
    saveState();
    return entry;
  }
  function deleteLogEntry(id) {
    state.log = state.log.filter(function (e) { return e.id !== id; });
    // Remember the deletion. Without this, syncing with a device that still has
    // the entry would quietly bring it back.
    state.deleted.push({ id: id, ts: nowMs() });
    if (state.deleted.length > 400) state.deleted = state.deleted.slice(-400);
    saveState();
  }
  function sessionsForStep(areaId, step) {
    return state.log.filter(function (e) { return e.areaId === areaId && e.step === step; })
      .sort(function (a, b) { return b.ts - a.ts; });
  }
  function allSessionsSorted() {
    return state.log.slice().sort(function (a, b) { return b.ts - a.ts; });
  }
  // Sessions on one calendar day, oldest-first. Keyed by dateStr(ts) so it lines
  // up exactly with the heatmap, which groups by trainingDaySet().
  function sessionsForDate(dateKey) {
    return state.log.filter(function (e) { return dateStr(e.ts) === dateKey; })
      .sort(function (a, b) { return a.ts - b.ts; });
  }
  function setsSummary(e, step) {
    var unit = (step && step.timed) ? "sec" : "reps";
    if (e.sets.length === 1) return e.sets[0] + " " + unit;
    return e.sets.length + " sets: " + e.sets.join(", ") + " " + unit;
  }
  function topSet(e) { return e.sets.reduce(function (m, v) { return v > m ? v : m; }, 0); }
  function lastSessionTs(areaId) {
    var last = 0;
    state.log.forEach(function (e) { if (e.areaId === areaId && e.ts > last) last = e.ts; });
    return last;
  }
  function trainedToday(areaId) {
    var today = dateStr(nowMs());
    return state.log.some(function (e) { return e.areaId === areaId && dateStr(e.ts) === today; });
  }

  /* ---------- Snapshots (ghost radar) ---------- */

  function currentRadarVals() { return AREAS.map(function (a) { return areaValue(a.id); }); }

  // Keep one snapshot per calendar day (latest values win). Called on boot and
  // after any progress change, so the ghost radar reflects real history.
  function recordSnapshot() {
    var d = dateStr(nowMs());
    var v = currentRadarVals();
    var last = state.snapshots[state.snapshots.length - 1];
    if (last && last.d === d) { last.v = v; }
    else state.snapshots.push({ d: d, v: v });
    if (state.snapshots.length > 400) state.snapshots = state.snapshots.slice(-400);
    saveState();
  }
  // The oldest snapshot that actually differs from today's shape (else no ghost).
  function ghostSnapshot() {
    var now = currentRadarVals();
    // A baseline you set yourself wins over the automatic one. Being frozen,
    // it differs the moment you move a step — no waiting for the day to turn
    // over, which a live snapshot of today would need.
    var base = state.settings.ghostBase;
    if (base) return differsFrom(base.v, now) ? base : null;
    if (state.snapshots.length < 2) return null;
    var oldest = state.snapshots[0];
    return differsFrom(oldest.v, now) ? oldest : null;
  }
  function differsFrom(v, now) {
    return v.some(function (x, i) { return Math.abs(x - now[i]) > 0.001; });
  }

  /* ---------- Milestones ---------- */

  function recordMilestone(type, areaId, step) {
    state.milestones.push({ id: genId(), ts: nowMs(), type: type, areaId: areaId, step: step });
  }
  // Record a "mastered" milestone once, when an area first reaches step 10 + Elite.
  function checkMaster(areaId) {
    var st = state.areas[areaId];
    if (st.step === 10 && st.std === 3) {
      var has = state.milestones.some(function (m) { return m.type === "master" && m.areaId === areaId; });
      if (!has) recordMilestone("master", areaId, 10);
    }
  }
  // Stamp an area / the preferences as changed now, so a sync merge can tell
  // which device's version of a conflicting value is the newer one.
  function touchArea(areaId) { state.areas[areaId].mts = nowMs(); }
  function touchPrefs() { state.prefsMts = nowMs(); }

  // Central point for changing an area's step/std so milestones are recorded once.
  function setAreaProgress(areaId, newStep, newStd) {
    var old = state.areas[areaId];
    var oldStep = old.step;
    state.areas[areaId] = { step: newStep, std: newStd, mts: nowMs() };
    if (newStep > oldStep) {
      // Don't re-record a step already in the timeline (e.g. stepping back down
      // with "set as my current step" and then climbing again).
      var already = state.milestones.some(function (m) {
        return m.type === "advance" && m.areaId === areaId && m.step === newStep;
      });
      if (!already) recordMilestone("advance", areaId, newStep);
    }
    checkMaster(areaId);
    saveState();
    recordSnapshot();
  }

  /* ---------- The plan: what to actually do today ----------

     Everything here is derived from where you are right now — current step and
     highest standard met — and nothing is stored. That is what makes the plan
     follow you: move up a step and the next render prescribes the new
     exercise's targets, with no plan to regenerate and nothing to go stale.  */

  // The movements scheduled for today, or [] when no routine is set.
  function todaysMovements() {
    if (!state.routine.enabled) return [];
    var sessions = routineSessions();
    return sessions[state.routine.sessionIndex % sessions.length] || [];
  }

  function variationsFor(areaId, step) {
    var list = (typeof VARIATIONS !== "undefined" && VARIATIONS[areaId]) || [];
    return list.filter(function (v) { return step >= v.from && step <= v.to; });
  }

  function variationByName(areaId, name) {
    var list = (typeof VARIATIONS !== "undefined" && VARIATIONS[areaId]) || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  function warmupFor(areaId) {
    return (typeof WARMUPS !== "undefined" && WARMUPS[areaId]) || [];
  }

  // What to do for one movement today.
  function prescribe(areaId) {
    var ai = areaIndexById(areaId);
    var a = AREAS[ai];
    var st = state.areas[areaId];
    var stepIdx = st.step - 1;
    var stepObj = a.steps[stepIdx];

    // Chase the lowest standard you haven't met. Having met all three, the work
    // is to hold that level until you take the next step up.
    var goalIdx = st.std < 3 ? st.std : 2;
    var goal = stepObj.standards[goalIdx];
    var parsed = parseStandard(goal.target);
    var perSide = /each side/i.test(goal.target);

    var atTop = st.step >= AREAS[ai].steps.length;
    var readyToAdvance = st.std >= 3 && !atTop;

    var sets = parsed.kind === "reps" ? parsed.sets : 1;
    var reps = parsed.kind === "reps" ? parsed.reps : 0;
    var seconds = parsed.kind === "time" ? parsed.seconds : 0;

    // One easy set first, at roughly half the working number.
    var warmupReps = parsed.kind === "reps" ? Math.max(3, Math.round(reps / 2)) : 0;
    var warmupSecs = parsed.kind === "time" ? Math.max(10, Math.round(seconds / 2)) : 0;

    return {
      areaId: areaId, areaIdx: ai, area: a,
      step: st.step, stepIdx: stepIdx, stepObj: stepObj,
      stdMet: st.std,
      goalIdx: goalIdx, goalLabel: goal.label, goalTarget: goal.target,
      kind: parsed.kind, sets: sets, reps: reps, seconds: seconds,
      perSide: perSide, timed: !!stepObj.timed || parsed.kind === "time",
      warmupReps: warmupReps, warmupSecs: warmupSecs,
      warmup: warmupFor(areaId),
      variations: variationsFor(areaId, st.step),
      readyToAdvance: readyToAdvance,
      nextStep: readyToAdvance ? a.steps[stepIdx + 1] : null,
      mastered: atTop && st.std >= 3,
      done: trainedToday(areaId)
    };
  }

  // "2 sets of 12" / "hold 45 seconds (each side)" — the one line that says
  // what to do. Kept identical everywhere it appears.
  function prescriptionLine(p) {
    var side = p.perSide ? " each side" : "";
    if (p.kind === "time") return "hold " + fmtDuration(p.seconds) + side;
    if (p.kind !== "reps") return p.goalTarget;
    return p.sets + (p.sets === 1 ? " set of " : " sets of ") + p.reps + side;
  }

  // Rough minutes for a whole session, so the card can say what it will cost
  // you. Working sets are counted at ~40 seconds plus your rest setting.
  function sessionMinutes(list) {
    var rest = state.settings.restSeconds;
    var total = 0;
    list.forEach(function (p) {
      var work = p.kind === "time" ? Math.max(p.seconds, 20) : 40;
      var setCount = p.sets + 1; // + the warm-up set
      total += setCount * work + (setCount - 1) * rest + 45; // 45s to set up
    });
    return Math.max(1, Math.round(total / 60));
  }

  /* ---------- Streak + training days ---------- */

  function trainingDaySet() {
    var s = {};
    state.log.forEach(function (e) { s[dateStr(e.ts)] = (s[dateStr(e.ts)] || 0) + 1; });
    return s;
  }
  function currentStreak() {
    var days = trainingDaySet();
    var d = startOfDay(nowMs());
    // Today not trained yet shouldn't break a streak — count from yesterday.
    if (!days[dateStr(d.getTime())]) d = addDays(d, -1);
    var streak = 0;
    while (days[dateStr(d.getTime())]) { streak++; d = addDays(d, -1); }
    return streak;
  }
  function longestStreak() {
    var days = Object.keys(trainingDaySet()).sort();
    var best = 0, run = 0, prev = null;
    days.forEach(function (k) {
      var cur = dateFromKey(k);
      // Round the delta: a DST day is 23h or 25h, still one calendar day apart.
      if (prev !== null && Math.round((cur - prev) / 86400000) === 1) run++;
      else run = 1;
      if (run > best) best = run;
      prev = cur;
    });
    return best;
  }
  function dateFromKey(k) {
    var p = k.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
  }

  /* ---------- Smart nudge ---------- */

  function smartNudge() {
    if (!state.log.length) return "";
    var today = nowMs();
    var worst = null, worstGap = -1, worstNever = false;
    AREAS.forEach(function (a) {
      var last = lastSessionTs(a.id);
      // Whole calendar days, so this agrees with the streaks and the heatmap.
      var gap = last ? Math.max(0, dayDelta(last, today)) : Infinity;
      if (gap > worstGap) { worstGap = gap; worst = a; worstNever = !last; }
    });
    if (worst && worstNever) return "You haven't logged " + shortAreaName(worst) + " yet — give it a try.";
    if (worst && worstGap >= 5) return "You haven't trained " + shortAreaName(worst) + " in " + worstGap + " days.";
    var st = currentStreak();
    if (st >= 2) return "🔥 " + st + "-day streak — keep it going!";
    return "";
  }

  /* ---------- Rest timer (global, foreground countdown) ---------- */

  var restEnd = 0, restInterval = null, audioCtx = null;

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ":" + pad2(sec % 60);
  }
  // Clock format reads badly mid-sentence ("hold 0:30"), so prose gets this.
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + " seconds";
    var m = Math.floor(sec / 60), s = sec % 60;
    var mins = m + (m === 1 ? " minute" : " minutes");
    return s ? mins + " " + s + "s" : mins;
  }
  function ensureAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx && AC) audioCtx = new AC();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* no audio available */ }
  }
  function beep() {
    try {
      if (!audioCtx) return;
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      var t = audioCtx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t); o.stop(t + 0.5);
    } catch (e) { /* ignore */ }
  }
  function vibrate(pat) { try { if (navigator.vibrate) navigator.vibrate(pat); } catch (e) { /* ignore */ } }

  function startRest(seconds) {
    restEnd = nowMs() + seconds * 1000;
    if (state.settings.restSeconds !== seconds) { state.settings.restSeconds = seconds; touchPrefs(); saveState(); }
    var sr = $("#sr-live"); if (sr) sr.textContent = ""; // reset so the next "complete" re-announces
    ensureAudio();
    var pill = $("#restpill");
    pill.hidden = false;
    pill.classList.remove("done");
    updateRestPill();
    clearInterval(restInterval);
    restInterval = setInterval(updateRestPill, 250);
  }
  function updateRestPill() {
    var pill = $("#restpill");
    var label = $("#restpill-time");
    var remain = (restEnd - nowMs()) / 1000;
    if (remain <= 0) {
      clearInterval(restInterval); restInterval = null;
      pill.classList.add("done");
      label.textContent = "Rest done";
      var sr = $("#sr-live"); if (sr) sr.textContent = "Rest complete";
      beep(); vibrate([120, 60, 120]);
      setTimeout(function () { if (pill.classList.contains("done")) hideRestPill(); }, 4000);
      return;
    }
    label.textContent = "Rest " + fmtTime(remain);
  }
  function cancelRest() { clearInterval(restInterval); restInterval = null; hideRestPill(); }
  function hideRestPill() { var p = $("#restpill"); p.hidden = true; p.classList.remove("done"); }

  /* ---------- Backup file (full state: progress + history) ---------- */

  function downloadBackup() {
    try {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "bigsix-backup-" + dateStr(nowMs()) + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast("Backup downloaded ✓");
    } catch (e) { toast("Couldn't create the backup file"); }
  }

  /* ---------- QR code for the backup link ---------- */

  // Returns true when a QR was actually drawn.
  function renderQR(container, text, caption) {
    container.innerHTML = "";
    if (typeof QR === "undefined") { container.textContent = "QR generator unavailable."; return false; }
    var m = QR.generate(text);
    if (!m) { container.textContent = "Link is too long for a QR code."; return false; }
    var n = m.length, quiet = 4, scale = 6, px = (n + quiet * 2) * scale;
    var canvas = document.createElement("canvas");
    canvas.width = px; canvas.height = px;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "QR code of your backup link");
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#000000";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (m[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
    container.appendChild(canvas);
    var cap = document.createElement("p");
    cap.className = "qrcap";
    cap.textContent = caption || "Scan with the other device's camera to open your progress.";
    container.appendChild(cap);
    return true;
  }

  /* ---------- Radar ---------- */

  var CX = 210, CY = 196, R = 134;
  var displayVals = AREAS.map(function (a) { return areaValue(a.id); });
  var animFrame = null;

  function axisAngle(i) { return -Math.PI / 2 + i * Math.PI / 3; }

  function polar(angleIdx, radius) {
    var a = axisAngle(angleIdx);
    return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
  }

  function polarAt(angleRad, radius) {
    return [CX + radius * Math.cos(angleRad), CY + radius * Math.sin(angleRad)];
  }

  function pressable(node, fn, label) {
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", label);
    node.addEventListener("click", fn);
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    });
  }

  function buildRadar() {
    var svg = $("#radar");
    svg.textContent = "";

    // Clickable wedge behind each axis: the whole slice opens that area.
    // Triangle through the two ±30° points at R/cos(30°) exactly covers the slice.
    var RW = R / Math.cos(Math.PI / 6);
    AREAS.forEach(function (a, i) {
      var p1 = polarAt(axisAngle(i) - Math.PI / 6, RW);
      var p2 = polarAt(axisAngle(i) + Math.PI / 6, RW);
      var wedge = el("polygon", {
        points: CX + "," + CY + " " + p1.join(",") + " " + p2.join(","),
        "class": "wedge"
      });
      pressable(wedge, function () { openArea(i); }, "Open " + a.name);
      attachTooltip(wedge, i);
      svg.appendChild(wedge);
    });

    // Rings (hexagonal), every step; rings 5 and 10 slightly stronger.
    // All chart chrome is pointer-transparent (CSS) so clicks reach the wedges.
    for (var ring = 1; ring <= 10; ring++) {
      var pts = [];
      for (var i = 0; i < 6; i++) pts.push(polar(i, R * ring / 10).join(","));
      svg.appendChild(el("polygon", {
        points: pts.join(" "),
        "class": "ring" + (ring === 5 || ring === 10 ? " major" : "")
      }));
    }

    // Spokes
    for (i = 0; i < 6; i++) {
      var p = polar(i, R);
      svg.appendChild(el("line", { x1: CX, y1: CY, x2: p[0], y2: p[1], "class": "spoke" }));
    }

    // Ring numbers along the top spoke
    [2, 4, 6, 8, 10].forEach(function (n) {
      var pos = polar(0, R * n / 10);
      svg.appendChild(el("text", { x: pos[0] + 5, y: pos[1] + 3, "class": "ringnum" }, String(n)));
    });

    // Ghost shape (a past snapshot), drawn behind the current shape.
    svg.appendChild(el("polygon", { points: "", "class": "ghost", id: "ghost" }));

    // Data shape (pointer-transparent)
    svg.appendChild(el("polygon", { points: "", "class": "shape", id: "shape" }));

    // Value dots: tap one to jump straight to that area's current exercise.
    AREAS.forEach(function (a, i) {
      svg.appendChild(el("circle", { r: 6, fill: areaColorVar(a), "class": "dot", id: "dot-" + a.id }));
      var dothit = el("circle", { r: 15, "class": "dothit", id: "dothit-" + a.id });
      pressable(dothit, function () { openCurrentStep(i); }, "Open your current " + a.name + " exercise");
      attachTooltip(dothit, i);
      svg.appendChild(dothit);
    });

    // Axis labels: tap to open the area's step list.
    AREAS.forEach(function (a, i) {
      var lp = polar(i, R + 16);
      var anchor = "middle";
      var cos = Math.cos(axisAngle(i));
      var sin = Math.sin(axisAngle(i));
      if (cos > 0.25) anchor = "start";
      if (cos < -0.25) anchor = "end";

      var lx = lp[0] + (cos > 0.25 ? 4 : cos < -0.25 ? -4 : 0);
      var nameY, stepY;
      if (sin < -0.5) { nameY = lp[1] - 16; stepY = lp[1] - 4; }
      else if (sin > 0.5) { nameY = lp[1] + 12; stepY = lp[1] + 24; }
      else { nameY = lp[1] - 1; stepY = lp[1] + 11; }

      var g = el("g", { "class": "axis-label" });
      g.appendChild(el("text", { x: lx, y: nameY, "text-anchor": anchor }, shortAreaName(a)));
      g.appendChild(el("text", { x: lx, y: stepY, "text-anchor": anchor, "class": "stepnum", id: "axstep-" + a.id }, ""));
      pressable(g, function () { openArea(i); }, "Open " + a.name);
      svg.appendChild(g);
    });

    paintRadar();
  }

  function paintRadar() {
    var pts = [];
    AREAS.forEach(function (a, i) {
      var pos = polar(i, R * Math.max(0, Math.min(10, displayVals[i])) / 10);
      pts.push(pos.join(","));
      var dot = $("#dot-" + a.id);
      dot.setAttribute("cx", pos[0]);
      dot.setAttribute("cy", pos[1]);
      var hit = $("#dothit-" + a.id);
      hit.setAttribute("cx", pos[0]);
      hit.setAttribute("cy", pos[1]);
      // Near the hub the six hit circles would stack on top of each other and
      // steal taps from the wedges — disable them until the dot clears the center.
      hit.setAttribute("r", displayVals[i] >= 2.2 ? 15 : 0);
    });
    $("#shape").setAttribute("points", pts.join(" "));
    AREAS.forEach(function (a) {
      var t = $("#axstep-" + a.id);
      if (t) t.textContent = "Step " + state.areas[a.id].step;
    });
    paintGhost();
  }

  var ghostOn = false;
  function paintGhost() {
    var g = $("#ghost");
    if (!g) return;
    var gs = ghostOn ? ghostSnapshot() : null;
    if (!gs) { g.style.display = "none"; return; }
    var gpts = AREAS.map(function (a, i) {
      return polar(i, R * Math.max(0, Math.min(10, gs.v[i])) / 10).join(",");
    });
    g.setAttribute("points", gpts.join(" "));
    g.style.display = "";
  }
  function shortDate(dkey) {
    try { return new Date(dateFromKey(dkey)).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
    catch (e) { return dkey; }
  }
  function updateGhostControl() {
    var btn = $("#ghostToggle");
    if (!btn) return;
    var gs = ghostSnapshot();
    if (gs) {
      btn.hidden = false;
      btn.disabled = false;
      btn.removeAttribute("title");
      btn.setAttribute("aria-pressed", ghostOn ? "true" : "false");
      btn.textContent = ghostOn ? ("Hide start (" + shortDate(gs.d) + ")") : "Show where I started";
      return;
    }
    ghostOn = false;
    var base = state.settings.ghostBase;
    if (base) {
      // You've set a starting point but haven't moved off it yet. Say that,
      // rather than removing the control — a control that vanishes after you
      // press a button reads as something having broken.
      btn.hidden = false;
      btn.disabled = true;
      btn.removeAttribute("aria-pressed");
      btn.textContent = "Starting point: " + shortDate(base.d);
      btn.title = "The dashed line appears here as soon as you move up a step or meet a new standard.";
      return;
    }
    btn.hidden = true;
    btn.disabled = false;
  }

  function animateRadar() {
    var targets = AREAS.map(function (a) { return areaValue(a.id); });
    if (reducedMotion) { displayVals = targets; paintRadar(); return; }
    var from = displayVals.slice();
    var t0 = performance.now(), DUR = 260;
    cancelAnimationFrame(animFrame);
    function tick(now) {
      var t = Math.min(1, (now - t0) / DUR);
      var e = 1 - Math.pow(1 - t, 3);
      displayVals = from.map(function (v, i) { return v + (targets[i] - v) * e; });
      paintRadar();
      if (t < 1) animFrame = requestAnimationFrame(tick);
    }
    animFrame = requestAnimationFrame(tick);
  }

  /* ---------- Tooltip (pointer devices only) ---------- */

  var canHover = window.matchMedia("(hover: hover)").matches;

  function attachTooltip(node, areaIdx) {
    if (!canHover) return;
    node.addEventListener("mouseenter", function (e) { showTip(e, areaIdx); });
    node.addEventListener("mousemove", function (e) { showTip(e, areaIdx); });
    node.addEventListener("mouseleave", hideTip);
  }

  function showTip(e, areaIdx) {
    var a = AREAS[areaIdx];
    var st = state.areas[a.id];
    var step = a.steps[st.step - 1];
    var tip = $("#tooltip");
    var stdTxt = st.std === 0 ? "working on it" : stdLabelFor(a, st.step - 1, st.std) + " standard met";
    tip.innerHTML = '<div class="t-title">' + esc(a.name) + " — Step " + st.step + "</div>" +
      '<div class="t-sub">' + esc(step.name) + " · " + esc(stdTxt) + "</div>";
    tip.classList.add("show");
    var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 10);
    var y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 10);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function hideTip() { $("#tooltip").classList.remove("show"); }

  /* ---------- Cards ---------- */

  function renderCards() {
    var host = $("#cards");
    var html = CARD_ORDER.map(function (id) {
      var i = areaIndexById(id);
      var a = AREAS[i];
      var st = state.areas[a.id];
      var step = a.steps[st.step - 1];
      var v = areaValue(a.id);
      var segs = "";
      for (var s = 1; s <= 10; s++) {
        var fill = Math.max(0, Math.min(1, v - (s - 1)));
        segs += "<span><i style=\"transform:scaleX(" + fill.toFixed(3) + ")\"></i></span>";
      }
      var readyTag = "";
      if (st.std === 3 && st.step < 10) readyTag = '<span class="ready">READY &#8593;</span>';
      if (st.std === 3 && st.step === 10) readyTag = '<span class="ready">&#9733; MASTER</span>';
      var stdTxt = st.std === 0 ? "working on it" : stdLabelFor(a, st.step - 1, st.std) + " met";
      return '<button class="card" data-area="' + i + '" style="--area:' + areaColorVar(a) + '">' +
        '<span class="head"><span class="swatch"></span>' + a.icon + " " + esc(a.name) + readyTag + "</span>" +
        '<span class="stepline"><span class="n">' + st.step + '</span><span class="name">' + esc(step.name) + "</span></span>" +
        '<span class="std">' + esc(stdTxt) + "</span>" +
        '<span class="track">' + segs + "</span>" +
        "</button>";
    }).join("");
    host.innerHTML = html;
  }

  /* ---------- Today card + smart nudge (home) ---------- */

  // The Today card depends on "what did I train today", so it goes stale if the
  // app is left open past midnight (common for an installed home-screen app).
  var renderedDay = null;

  function refreshIfDayChanged() {
    var k = dateStr(nowMs());
    if (renderedDay && k !== renderedDay) refresh();
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshIfDayChanged();
  });
  window.addEventListener("focus", refreshIfDayChanged);

  function renderToday() {
    var host = $("#today");
    if (!host) return;
    renderedDay = dateStr(nowMs());
    var parts = [];

    if (state.routine.enabled) {
      var sessions = routineSessions();
      var idx = state.routine.sessionIndex % sessions.length;
      var sess = sessions[idx];
      var plan = sess.map(prescribe);
      var allDone = plan.every(function (p) { return p.done; });
      var leftToDo = plan.filter(function (p) { return !p.done; });
      var rows = plan.map(function (p) {
        return '<button class="td-move' + (p.done ? " done" : "") + '" data-area="' + p.areaIdx + '" style="--area:' + areaColorVar(p.area) + '">' +
          '<span class="tdcheck">' + (p.done ? "&#10003;" : "") + "</span>" +
          '<span class="tdinfo"><span class="tdname">' + p.area.icon + " " + esc(p.stepObj.name) + "</span>" +
          '<span class="tdstep">' + esc(prescriptionLine(p)) + " &middot; " + esc(p.goalLabel) + " goal</span>" +
          (p.readyToAdvance ? '<span class="tdready">Ready for Step ' + (p.step + 1) + " &#8212; " + esc(p.nextStep.name) + "</span>" : "") +
          "</span>" +
          '<span class="chev">&#8250;</span></button>';
      }).join("");
      var mins = sessionMinutes(leftToDo.length ? leftToDo : plan);
      parts.push('<div class="today-card">' +
        '<div class="today-head"><span class="today-title">Today&#8217;s session</span>' +
        '<span class="today-count">Day ' + (idx + 1) + " of " + sessions.length +
        (allDone ? "" : " &middot; ~" + mins + " min") + "</span></div>" +
        '<div class="td-moves">' + rows + "</div>" +
        (allDone
          ? '<button class="btn primary wide" id="nextSessionBtn">Session done &#8212; queue the next one &#8594;</button>'
          : '<button class="btn primary wide" id="startSessionBtn">&#9654; Start session</button>' +
            '<button class="btn wide" id="nextSessionBtn">Skip to next session &#8594;</button>') +
        "</div>");
    } else {
      parts.push('<button class="today-card setup" id="setupRoutineBtn">' +
        '<span class="today-title">&#43; Set up a weekly routine</span>' +
        '<span class="today-sub">Get a &#8220;today&#8217;s session&#8221; plan across your week.</span></button>');
    }

    // Outside the routine branch on purpose: the library is a reference you may
    // want whether or not you've set a routine up.
    parts.push('<div class="today-links">' +
      (state.routine.enabled ? '<button class="tdlink" id="weekBtn">&#128198; This week</button>' : "") +
      '<button class="tdlink" id="libraryBtn">&#128218; Exercise library</button></div>');

    var nudge = smartNudge();
    if (nudge) parts.push('<div class="nudge">' + esc(nudge) + "</div>");
    host.innerHTML = parts.join("");

    host.querySelectorAll(".td-move").forEach(function (b) {
      b.addEventListener("click", function () { openCurrentStep(Number(b.getAttribute("data-area"))); });
    });
    var ns = $("#nextSessionBtn", host);
    if (ns) ns.addEventListener("click", function () {
      var sessions2 = routineSessions();
      state.routine.sessionIndex = (state.routine.sessionIndex + 1) % sessions2.length;
      touchPrefs();
      saveState();
      renderToday();
      toast("Next session ready");
    });
    var setup = $("#setupRoutineBtn", host);
    if (setup) setup.addEventListener("click", openSettings);
    var start = $("#startSessionBtn", host);
    if (start) start.addEventListener("click", openSession);
    var week = $("#weekBtn", host);
    if (week) week.addEventListener("click", openWeek);
    var lib = $("#libraryBtn", host);
    if (lib) lib.addEventListener("click", openLibrary);
  }

  /* ---------- Sheet navigation (in-app stack, no browser history) ---------- */

  var uiStack = [];
  var hideTimer = null;
  var openedAt = 0;
  var lastViewKey = null;

  function sameView(v, w) { return !!w && v.t === w.t && v.a === w.a && v.s === w.s && v.d === w.d; }

  function pushView(v) {
    // Dedupe: a double-tap must not stack two identical panes
    if (sameView(v, uiStack[uiStack.length - 1])) { renderSheet(); return; }
    uiStack.push(v);
    renderSheet();
  }

  function openArea(areaIdx) { pushView({ t: "area", a: areaIdx }); }
  function openStep(areaIdx, stepIdx) { pushView({ t: "step", a: areaIdx, s: stepIdx }); }
  function openSettings() { pushView({ t: "settings" }); }

  function openCurrentStep(areaIdx) {
    var a = AREAS[areaIdx];
    pushView({ t: "area", a: areaIdx });
    pushView({ t: "step", a: areaIdx, s: state.areas[a.id].step - 1 });
  }

  function openHistory() { pushView({ t: "history" }); }
  function openStats() { pushView({ t: "stats" }); }
  function openDay(dateKey) { pushView({ t: "day", d: dateKey }); }
  function openWeek() { pushView({ t: "week" }); }
  function openLibrary() { pushView({ t: "library" }); }
  function openSession() { sessionCursor = -1; pushView({ t: "session" }); }

  // Which movement the guided session is on. -1 means "whichever you haven't
  // logged yet", so closing the app mid-workout and coming back lands you in
  // the right place with nothing stored.
  var sessionCursor = -1;

  function sessionPlan() { return todaysMovements().map(prescribe); }

  function sessionAt(plan) {
    if (sessionCursor >= 0 && sessionCursor < plan.length) return sessionCursor;
    for (var i = 0; i < plan.length; i++) if (!plan[i].done) return i;
    return -1; // everything logged
  }

  // Draft for the in-progress log/edit form, so re-renders keep values.
  var logDraft = { key: "", sets: [], note: "", editId: null, variant: "" };

  function openLog(areaIdx, stepIdx, variant) {
    var a = AREAS[areaIdx];
    var step = a.steps[stepIdx];
    logDraft = { key: areaIdx + ":" + stepIdx, sets: [], note: "", editId: null, variant: variant || "" };
    // Open with one row per prescribed set, so the form already has the shape
    // of the workout you were just told to do.
    var rows = step.timed ? 1 : 2;
    if (!step.timed && state.areas[a.id].step === stepIdx + 1) {
      rows = Math.max(1, Math.min(6, prescribe(a.id).sets));
    }
    for (var i = 0; i < rows; i++) logDraft.sets.push("");
    pushView({ t: "log", a: areaIdx, s: stepIdx });
  }

  function openEditSession(id) {
    var e = null;
    state.log.forEach(function (x) { if (x.id === id) e = x; });
    if (!e) return;
    var ai = areaIndexById(e.areaId);
    logDraft = { key: "edit:" + id, sets: e.sets.map(String), note: e.note || "", editId: id, variant: e.variant || "" };
    pushView({ t: "log", a: ai, s: e.step - 1 });
  }

  function readLogInputs() {
    var sheet = $("#sheet");
    var inputs = sheet.querySelectorAll(".setinput");
    logDraft.sets = Array.prototype.map.call(inputs, function (i) { return i.value; });
    var note = $("#logNote", sheet);
    if (note) logDraft.note = note.value;
  }

  function saveLog(areaIdx, stepIdx) {
    var a = AREAS[areaIdx], step = a.steps[stepIdx], n = stepIdx + 1;
    readLogInputs();
    var sets = [];
    logDraft.sets.forEach(function (v) {
      var num = Math.round(Number(v));
      if (isFinite(num) && num > 0) sets.push(num);
    });
    if (!sets.length) { toast("Enter at least one set"); return; }

    // Edit mode: just update the existing entry's numbers/note.
    if (logDraft.editId) {
      var target = null;
      state.log.forEach(function (x) { if (x.id === logDraft.editId) target = x; });
      var savedOk = true;
      if (target) {
        target.sets = sets;
        target.note = logDraft.note;
        target.variant = logDraft.variant || "";
        target.mts = nowMs();
        savedOk = saveState();
      }
      logDraft = { key: "", sets: [], note: "", editId: null, variant: "" };
      refresh();
      goBack();
      toast(savedOk ? "Session updated ✓" : "Updated in this tab only — storage is full or blocked");
      return;
    }

    var isCurrent = state.areas[a.id].step === n;
    var prevStd = state.areas[a.id].std;
    var variant = variationByName(a.id, logDraft.variant);
    addLogEntry(a.id, n, sets, logDraft.note, logDraft.variant);

    var msg = "Session logged ✓";
    // An easier swap is real training and worth recording, but it isn't the
    // work the standard asks for — so it must never award one.
    var countsForStandard = !variant || variant.effort !== "easier";
    if (isCurrent && countsForStandard) {
      var det = detectStandard(step, sets);
      if (det > prevStd) {
        state.areas[a.id].std = det;
        touchArea(a.id);
        checkMaster(a.id);
        saveState();
        recordSnapshot();
        var label = step.standards[det - 1].label;
        msg = (det === 3 && n < 10) ? (label + " standard met — ready to move up!") : (label + " standard met!");
      }
    }
    if (variant && variant.effort === "easier" && isCurrent) {
      msg = "Logged " + variant.name + " ✓ — practice, so your standard is unchanged";
    }
    logDraft = { key: "", sets: [], note: "", editId: null, variant: "" };
    refresh();
    goBack(); // back to the step detail, which now reflects any new standard
    // Don't claim success if the write never landed.
    toast(storageOk ? msg : "Saved in this tab only — storage is full or blocked");
  }

  function goBack() {
    if (!uiStack.length) return;
    uiStack.pop();
    renderSheet();
  }

  function closeAll() {
    if (!uiStack.length) return;
    uiStack.length = 0;
    renderSheet();
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") goBack();
  });

  function renderSheet() {
    var sheet = $("#sheet");
    var scrim = $("#scrim");
    if (!uiStack.length) {
      sheet.classList.remove("show");
      scrim.classList.remove("show");
      lastViewKey = null;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        if (!uiStack.length) { sheet.hidden = true; sheet.innerHTML = ""; }
      }, 280);
      return;
    }
    clearTimeout(hideTimer);
    hideTip();
    sheet.hidden = false;
    // Force layout so the slide-in transition plays on first show
    void sheet.offsetHeight;
    sheet.classList.add("show");
    scrim.classList.add("show");
    openedAt = performance.now();

    var view = uiStack[uiStack.length - 1];
    // Re-rendering the same pane (e.g. after a chip tap) keeps the scroll position
    var viewKey = view.t + ":" + (view.a != null ? view.a : "") + ":" + (view.s != null ? view.s : "") + ":" + (view.d != null ? view.d : "");
    var prevBody = $(".sheet-body", sheet);
    var keepScroll = (viewKey === lastViewKey && prevBody) ? prevBody.scrollTop : 0;

    if (view.t === "area") sheet.innerHTML = areaPaneHTML(view.a);
    else if (view.t === "step") sheet.innerHTML = stepPaneHTML(view.a, view.s);
    else if (view.t === "log") sheet.innerHTML = logPaneHTML(view.a, view.s);
    else if (view.t === "history") sheet.innerHTML = historyPaneHTML();
    else if (view.t === "day") sheet.innerHTML = dayPaneHTML(view.d);
    else if (view.t === "stats") sheet.innerHTML = statsPaneHTML();
    else if (view.t === "session") sheet.innerHTML = sessionPaneHTML();
    else if (view.t === "week") sheet.innerHTML = weekPaneHTML();
    else if (view.t === "library") sheet.innerHTML = libraryPaneHTML();
    else sheet.innerHTML = settingsPaneHTML();
    wireSheet(view);
    var body = $(".sheet-body", sheet);
    if (body) body.scrollTop = keepScroll;
    lastViewKey = viewKey;
  }

  /* ---------- Area pane (step list) ---------- */

  function areaPaneHTML(areaIdx) {
    var a = AREAS[areaIdx];
    var st = state.areas[a.id];
    var rows = a.steps.map(function (step, i) {
      var n = i + 1;
      var cls = "";
      var numHTML = String(n);
      if (n < st.step || (n === st.step && st.std === 3)) { cls += " done"; numHTML = "&#10003;"; }
      if (n === st.step) cls += " current";
      var tags = "";
      if (n === st.step) tags += ' <span class="tag cur">CURRENT</span>';
      if (step.master) tags += ' <span class="tag master">MASTER</span>';
      // All three goals, labelled — this list doubles as the reference for
      // "what do I have to do at this level".
      var goals = step.standards.map(function (s) {
        return '<span class="goalpill"><b>' + esc(s.label.charAt(0)) + "</b> " +
          esc(s.target.replace(/\s*\(each side\)/, "")) + "</span>";
      }).join("");
      return '<button class="rung' + cls + '" data-step="' + i + '" style="--area:' + areaColorVar(a) + '">' +
        '<span class="num">' + numHTML + "</span>" +
        '<span class="info"><span class="nm">' + esc(step.name) + tags + "</span>" +
        '<span class="tg">' + esc(step.why) + "</span>" +
        '<span class="goals">' + goals + "</span>" +
        (step.perSide || step.timed
          ? '<span class="tgnote">' + (step.perSide ? "each side" : "") +
            (step.perSide && step.timed ? " · " : "") + (step.timed ? "timed hold" : "") + "</span>"
          : "") +
        "</span>" +
        '<span class="chev">&#8250;</span></button>';
    }).join("");

    var vars = variationsFor(a.id, st.step);
    var varHTML = vars.length
      ? "<h4>Swaps for step " + st.step + "</h4>" +
        '<p class="hint">Alternatives that fit where you are now. &#8220;Practice&#8221; ones build the movement but don&#8217;t award a standard.</p>' +
        '<div class="varlist">' + vars.map(function (v) {
          return '<div class="varcard"><div class="varname">' + esc(v.name) +
            ' <span class="swaptag ' + v.effort + '">' + (v.effort === "easier" ? "practice" : v.effort) + "</span></div>" +
            '<div class="varwhy">' + esc(v.why) + "</div></div>";
        }).join("") + "</div>"
      : "";

    return sheetHead({
      title: a.icon + " " + esc(a.name),
      sub: esc(a.tagline),
      areaColor: areaColorVar(a),
      back: false
    }) + '<div class="sheet-body" style="--area:' + areaColorVar(a) + '"><div class="ladder">' + rows + "</div>" + varHTML + "</div>";
  }

  /* ---------- Step pane (exercise detail) ---------- */

  function stepPaneHTML(areaIdx, stepIdx) {
    var a = AREAS[areaIdx];
    var st = state.areas[a.id];
    var step = a.steps[stepIdx];
    var n = stepIdx + 1;
    var isCurrent = st.step === n;
    var isDone = n < st.step;
    var color = areaColorVar(a);

    var how = step.how.map(function (h) { return "<li>" + esc(h) + "</li>"; }).join("");

    var stdRows = step.standards.map(function (s, i) {
      var met = (isDone) || (isCurrent && st.std >= i + 1);
      return '<div class="stdrow"><span class="lb">' + (met ? '<span class="met">&#10003;</span>' : "") + esc(s.label) + " standard</span><strong>" + esc(s.target) + "</strong></div>";
    }).join("");

    var progressHTML = "";
    if (isCurrent) {
      var opts = ['<button class="chip' + (st.std === 0 ? " sel" : "") + '" data-std="0">Not yet</button>'];
      step.standards.forEach(function (s, i) {
        opts.push('<button class="chip' + (st.std === i + 1 ? " sel" : "") + '" data-std="' + (i + 1) + '">' + esc(s.label) + " &#10003;</button>");
      });
      progressHTML = '<h4>Your progress on this step</h4><div class="chips">' + opts.join("") + "</div>";
      if (st.std === 3 && n < 10) {
        var next = a.steps[n];
        progressHTML += '<div class="advance"><span><b>' + esc(step.standards[2].label) + " standard met!</b> You're ready for the next step." +
          "</span><button class=\"btn primary\" id=\"advanceBtn\">Move up to Step " + (n + 1) + ": " + esc(next.name) + " &#8593;</button></div>";
      }
      if (st.std === 3 && n === 10) {
        progressHTML += '<div class="advance"><span><b>&#9733; ' + esc(a.name) + " mastered.</b> You have climbed all ten steps. Respect.</span></div>";
      }
    } else {
      progressHTML = '<h4>Your progress</h4>';
      if (isDone) progressHTML += '<p class="completed-note">&#10003; You have completed this step (you are on Step ' + st.step + ").</p>";
      progressHTML += '<button class="btn wide" id="setCurrentBtn" style="--area:' + color + '">Set this as my current step</button>';
    }

    var stepSessions = sessionsForStep(a.id, n);
    var recent = stepSessions.slice(0, 3);
    var sparkHTML = stepSessions.length >= 2
      ? '<div class="sparkwrap"><span class="sparklabel">' + (step.timed ? "Best hold" : "Top set") + " over time</span>" + sparklineSVG(stepSessions) + "</div>"
      : "";
    var recentHTML = recent.length
      ? '<div class="recent">' + recent.map(function (e) {
          return '<div class="recent-row"><span class="rdate">' + esc(prettyDate(e.ts)) + "</span><span class=\"rsets\">" + esc(setsSummary(e, step)) + "</span></div>";
        }).join("") + "</div>"
      : '<p class="muted-note">No sessions logged for this exercise yet.</p>';
    var logSection = "<h4>Log training</h4>" +
      '<button class="btn primary wide" id="logBtn" style="--area:' + color + '">&#65291; Log a session</button>' +
      sparkHTML + recentHTML;

    return sheetHead({
      title: esc(step.name) + (step.master ? ' <span class="tag master" style="--area:' + color + '">MASTER</span>' : ""),
      sub: "Step " + n + " of 10 · " + esc(a.name),
      areaColor: color,
      back: true
    }) +
      '<div class="sheet-body"><div class="detail" style="--area:' + color + '">' +
      '<p class="why">' + esc(step.why) + "</p>" +
      "<h4>Training goals</h4><div class=\"stdtable\">" + stdRows + "</div>" +
      progressHTML +
      logSection +
      "<h4>How to do it</h4><ol class=\"howlist\">" + how + "</ol>" +
      "<h4>If it's too hard</h4><div class=\"hintbox\">" + esc(step.easier) + "</div>" +
      '<h4>See it done</h4><a class="videolink" target="_blank" rel="noopener" href="' + videoURL(a, step) + '">&#9654; Watch demos on YouTube</a>' +
      "</div></div>";
  }

  /* ---------- Log pane ---------- */

  // "What did you actually do?" — the step's own exercise, or one of the
  // variations that fits this step.
  function variantPickerHTML(areaId, step) {
    var list = variationsFor(areaId, step);
    if (!list.length) return "";
    var sel = logDraft.variant;
    var chips = '<button class="chip vchip' + (!sel ? " sel" : "") + '" data-variant="">As prescribed</button>' +
      list.map(function (v) {
        return '<button class="chip vchip' + (sel === v.name ? " sel" : "") + '" data-variant="' + esc(v.name) + '">' + esc(v.name) + "</button>";
      }).join("");
    var chosen = variationByName(areaId, sel);
    return '<h4 class="tight">What did you do?</h4>' +
      '<div class="chips">' + chips + "</div>" +
      (chosen
        ? '<p class="vnote">' + esc(chosen.why) + (chosen.effort === "easier"
            ? " <strong>Practice work — this won&#8217;t award a standard.</strong>" : "") + "</p>"
        : "");
  }

  function logPaneHTML(areaIdx, stepIdx) {
    var a = AREAS[areaIdx], step = a.steps[stepIdx], color = areaColorVar(a);
    var n = stepIdx + 1;
    var isCurrent = state.areas[a.id].step === n;
    var timed = !!step.timed;
    var unit = timed ? "seconds" : "reps";

    // Placeholder = the reps/seconds of the goal you're aiming at next.
    var std = state.areas[a.id].std;
    var goalParsed = parseStandard(step.standards[Math.min(std, 2)].target);
    var placeholder = timed ? (goalParsed.seconds || "") : (goalParsed.reps || "");

    var setRows = logDraft.sets.map(function (v, i) {
      return '<div class="setrow">' +
        '<span class="setlabel">' + (timed ? "Hold" : "Set") + " " + (i + 1) + "</span>" +
        '<input class="setinput" type="number" inputmode="numeric" min="0" step="1" value="' + esc(v) + '" placeholder="' + esc(String(placeholder)) + '" aria-label="' + (timed ? "Hold" : "Set") + " " + (i + 1) + '">' +
        '<span class="setunit">' + unit + "</span>" +
        '<button class="removeSet" data-i="' + i + '" aria-label="Remove this ' + (timed ? "hold" : "set") + '">&#10005;</button></div>';
    }).join("");

    var presets = [60, 120, 180, 300].map(function (sec) {
      return '<button class="restpreset" data-sec="' + sec + '">' + fmtTime(sec) + "</button>";
    }).join("");

    var goalRef = step.standards.map(function (s) {
      return esc(s.label) + ": " + esc(s.target.replace(/\s*\(each side\)/, ""));
    }).join("  &middot;  ");

    var editing = !!logDraft.editId;
    var notCurrentNote = (isCurrent || editing) ? "" :
      '<p class="hintbox">You are logging Step ' + n + ", which isn't your current step. It will be saved in your history but won't change your current step.</p>";

    return sheetHead({
      title: (editing ? "Edit &middot; " : "Log &middot; ") + esc(step.name),
      sub: "Step " + n + " of 10 &middot; " + esc(a.name),
      areaColor: color,
      back: true,
      backLabel: "Cancel"
    }) +
      '<div class="sheet-body logpane" style="--area:' + color + '">' +
      notCurrentNote +
      '<p class="goalref">Goals &mdash; ' + goalRef + (step.perSide ? "  (each side)" : "") + "</p>" +
      variantPickerHTML(a.id, n) +
      "<h4>" + (timed ? "Your holds" : "Your sets") + "</h4>" +
      '<div class="setlist">' + setRows + "</div>" +
      '<button class="btn addset" id="addSet">&#65291; Add ' + (timed ? "hold" : "set") + "</button>" +
      "<h4>Rest timer</h4>" +
      '<div class="restrow">' + presets + "</div>" +
      "<h4>Note (optional)</h4>" +
      '<textarea id="logNote" class="lognote" rows="2" placeholder="How did it feel?">' + esc(logDraft.note || "") + "</textarea>" +
      '<button class="btn primary wide" id="saveLog" style="--area:' + color + '">Save session</button>' +
      "</div>";
  }

  /* ---------- Guided session ---------- */

  function sessionPaneHTML() {
    var plan = sessionPlan();
    if (!plan.length) {
      return sheetHead({ title: "Session", sub: "", back: true, backLabel: "Home" }) +
        '<div class="sheet-body"><p class="empty">No routine set up yet.<br>Choose how many days a week you train in Settings.</p></div>';
    }
    var i = sessionAt(plan);
    if (i === -1) return sessionDonePaneHTML(plan);

    var p = plan[i];
    var color = areaColorVar(p.area);
    var dots = plan.map(function (q, k) {
      return '<span class="sdot' + (q.done ? " done" : "") + (k === i ? " now" : "") + '" style="--area:' + areaColorVar(q.area) + '"></span>';
    }).join("");

    var warm = p.warmup.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("");
    var cues = p.stepObj.how.map(function (h) { return "<li>" + esc(h) + "</li>"; }).join("");
    var swaps = p.variations.length
      ? '<details class="swaps"><summary>Swap for something else (' + p.variations.length + ")</summary>" +
        p.variations.map(function (v) {
          return '<button class="swap" data-variant="' + esc(v.name) + '">' +
            '<span class="swapname">' + esc(v.name) +
            ' <span class="swaptag ' + v.effort + '">' + (v.effort === "same" ? "same" : v.effort) + "</span></span>" +
            '<span class="swapwhy">' + esc(v.why) + "</span></button>";
        }).join("") + "</details>"
      : "";

    return sheetHead({
      title: esc(p.stepObj.name),
      sub: p.area.icon + " " + esc(p.area.name) + " &middot; Step " + p.step + " of 10",
      areaColor: color, back: true, backLabel: "Home"
    }) +
      '<div class="sheet-body session" style="--area:' + color + '">' +
      '<div class="sdots">' + dots + '<span class="scount">' + (i + 1) + " of " + plan.length + "</span></div>" +

      '<div class="rx"><span class="rxlabel">Do this</span>' +
      '<span class="rxbig">' + esc(prescriptionLine(p)) + "</span>" +
      '<span class="rxgoal">to meet the ' + esc(p.goalLabel) + " standard" +
      (p.mastered ? " &mdash; you&#8217;ve topped this ladder, keep it" : "") + "</span></div>" +

      (p.readyToAdvance
        ? '<div class="advance"><b>You&#8217;ve cleared this step.</b> Next up is Step ' + (p.step + 1) +
          " &mdash; " + esc(p.nextStep.name) + '.<button class="btn wide" id="sessionAdvance">Move up now</button></div>'
        : "") +

      (warm ? '<h4>Warm up first</h4><ul class="cues">' + warm + "</ul>" : "") +
      (p.kind === "reps" && p.warmupReps
        ? '<p class="hint">Then one easy set of about ' + p.warmupReps + " before the working sets.</p>" : "") +
      (p.kind === "time" && p.warmupSecs
        ? '<p class="hint">Then one easy hold of about ' + esc(fmtDuration(p.warmupSecs)) + " before the working holds.</p>" : "") +

      "<h4>Form cues</h4><ul class=\"cues\">" + cues + "</ul>" +
      swaps +

      '<div class="sactions">' +
      '<button class="btn primary wide" id="sessionLog">Log this movement</button>' +
      '<div class="btnrow"><button class="btn" id="sessionRest">&#9201; Rest ' + fmtTime(state.settings.restSeconds) + "</button>" +
      '<button class="btn" id="sessionSkip">' + (i + 1 < plan.length ? "Next movement &#8594;" : "Finish &#8594;") + "</button></div>" +
      "</div></div>";
  }

  function sessionDonePaneHTML(plan) {
    var rows = plan.map(function (p) {
      var todays = state.log.filter(function (e) {
        return e.areaId === p.areaId && dateStr(e.ts) === dateStr(nowMs());
      });
      var best = todays.reduce(function (m, e) { return Math.max(m, topSet(e)); }, 0);
      return '<div class="donerow" style="--area:' + areaColorVar(p.area) + '">' +
        '<span class="doneicon">&#10003;</span>' +
        '<span class="doneinfo"><span class="donename">' + p.area.icon + " " + esc(p.stepObj.name) + "</span>" +
        '<span class="donesets">best ' + best + (p.timed ? " sec" : " reps") + "</span></span></div>";
    }).join("");
    var streak = currentStreak();
    return sheetHead({ title: "Session complete", sub: "", back: true, backLabel: "Home" }) +
      '<div class="sheet-body session">' +
      '<p class="bigdone">&#127881;</p>' +
      '<div class="donelist">' + rows + "</div>" +
      "<p>" + (streak > 1 ? "That&#8217;s <strong>" + streak + " days</strong> in a row." : "Logged and counted.") + "</p>" +
      '<button class="btn primary wide" id="sessionNext">Queue the next session &#8594;</button>' +
      "</div>";
  }

  /* ---------- The week, and where each area is heading ---------- */

  function weekPaneHTML() {
    if (!state.routine.enabled) {
      return sheetHead({ title: "&#128198; This week", sub: "", back: true, backLabel: "Home" }) +
        '<div class="sheet-body"><p class="empty">No routine set up yet.<br>Choose 2, 3 or 6 days a week in Settings and your plan appears here.</p></div>';
    }
    var sessions = routineSessions();
    var cur = state.routine.sessionIndex % sessions.length;

    var days = sessions.map(function (sess, i) {
      var moves = sess.map(function (id) {
        var p = prescribe(id);
        return '<div class="wkmove" style="--area:' + areaColorVar(p.area) + '">' +
          '<span class="wkdot"></span>' +
          '<span class="wkname">' + p.area.icon + " " + esc(p.stepObj.name) + "</span>" +
          '<span class="wkrx">' + esc(prescriptionLine(p)) + "</span></div>";
      }).join("");
      return '<div class="wkday' + (i === cur ? " now" : "") + '">' +
        '<div class="wkhead"><span class="wkdaylabel">Day ' + (i + 1) + "</span>" +
        (i === cur ? '<span class="wknow">today</span>' : "") + "</div>" + moves + "</div>";
    }).join("");

    // Where each area is going next: what to hit here, and the rungs beyond.
    var map = AREAS.map(function (a) {
      var p = prescribe(a.id);
      var ahead = a.steps.slice(p.step, p.step + 2).map(function (s, k) {
        return '<li>Step ' + (p.step + 1 + k) + " &mdash; " + esc(s.name) + "</li>";
      }).join("");
      var need = p.mastered
        ? "Ladder complete — nothing left above this."
        : (p.readyToAdvance
          ? "Cleared. Move up whenever you're ready."
          : "Hit " + prescriptionLine(p) + " to reach the " + p.goalLabel + " standard.");
      return '<div class="mapcard" style="--area:' + areaColorVar(a) + '">' +
        '<div class="maphead">' + a.icon + " " + esc(a.name) + "</div>" +
        '<div class="mapnow">Step ' + p.step + " &middot; " + esc(p.stepObj.name) + "</div>" +
        '<div class="mapneed">' + esc(need) + "</div>" +
        (ahead ? '<div class="maplabel">Ahead</div><ul class="mapahead">' + ahead + "</ul>" : "") +
        "</div>";
    }).join("");

    return sheetHead({ title: "&#128198; This week", sub: "", back: true, backLabel: "Home" }) +
      '<div class="sheet-body week">' +
      "<p>Your " + sessions.length + "-day rotation. It advances when you finish a session, so rest days are yours to take whenever you like.</p>" +
      '<div class="wkdays">' + days + "</div>" +
      "<h4>Where each area is heading</h4>" +
      '<div class="mapgrid">' + map + "</div>" +
      "</div>";
  }

  /* ---------- Exercise library ---------- */

  function libraryPaneHTML() {
    var rows = CARD_ORDER.map(function (id) {
      var ai = areaIndexById(id);
      var a = AREAS[ai];
      var st = state.areas[id];
      return '<button class="librow" data-area="' + ai + '" style="--area:' + areaColorVar(a) + '">' +
        '<span class="libicon">' + a.icon + "</span>" +
        '<span class="libinfo"><span class="libname">' + esc(a.name) + "</span>" +
        '<span class="libsub">' + esc(a.tagline) + "</span>" +
        '<span class="libwhere">You&#8217;re on step ' + st.step + " &middot; " + esc(a.steps[st.step - 1].name) + "</span></span>" +
        '<span class="chev">&#8250;</span></button>';
    }).join("");
    return sheetHead({ title: "&#128218; Exercise library", sub: "", back: true, backLabel: "Home" }) +
      '<div class="sheet-body library">' +
      "<p>Every movement, all ten steps, with the reps and sets that count at each level. Pick an area.</p>" +
      '<div class="librows">' + rows + "</div>" +
      "</div>";
  }

  /* ---------- History pane ---------- */

  function historyPaneHTML() {
    var sessions = allSessionsSorted();
    var body;
    if (!sessions.length) {
      body = '<p class="empty">No sessions logged yet.<br>Open an exercise and tap &ldquo;Log a session&rdquo; to start your history.</p>';
    } else {
      // Group and label from the same source (the timestamp, in the viewer's
      // timezone) so a header can never disagree with its group's contents.
      var groups = [], lastKey = null;
      sessions.forEach(function (e) {
        var key = dateStr(e.ts);
        if (key !== lastKey) { groups.push({ ts: e.ts, items: [] }); lastKey = key; }
        groups[groups.length - 1].items.push(e);
      });
      body = groups.map(function (g) {
        var rows = g.items.map(function (e) {
          var a = AREAS[areaIndexById(e.areaId)];
          var step = a.steps[e.step - 1];
          return '<div class="hitem" style="--area:' + areaColorVar(a) + '">' +
            // No aria-label here: it would mask the exercise/sets text inside,
            // which is exactly what a screen-reader user needs to hear.
            '<button class="hopen" data-id="' + esc(e.id) + '">' +
            '<span class="hswatch"></span>' +
            '<span class="hinfo"><span class="hname">' + a.icon + " " + esc(step.name) + "</span>" +
            '<span class="hsets">' + esc(setsSummary(e, step)) + (e.note ? " &middot; " + esc(e.note) : "") + "</span></span></button>" +
            '<button class="hdel" data-id="' + esc(e.id) + '" aria-label="Delete this entry">&#128465;</button></div>';
        }).join("");
        return '<div class="hgroup"><div class="hdate">' + esc(prettyDate(g.ts)) + "</div>" + rows + "</div>";
      }).join("");
    }
    return sheetHead({ title: "&#128197; Training history", sub: "", back: false }) +
      '<div class="sheet-body history">' + (sessions.length ? '<p class="muted-note">Tap a session to edit it.</p>' : "") + body + "</div>";
  }

  /* ---------- Day pane (one calendar day, opened from the heatmap) ---------- */

  function dayPaneHTML(dateKey) {
    var sessions = sessionsForDate(dateKey);
    // Fall back to the key itself for the header if the day emptied out (e.g. the
    // last session was just deleted from this very pane).
    var ts = sessions.length ? sessions[0].ts : dateFromKey(dateKey);
    var n = sessions.length;
    var body;
    if (!n) {
      body = '<p class="empty">No sessions logged on this day.</p>';
    } else {
      // Same row markup as the history pane, so a day's sessions are editable and
      // deletable in place.
      body = sessions.map(function (e) {
        var a = AREAS[areaIndexById(e.areaId)];
        var step = a.steps[e.step - 1];
        return '<div class="hitem" style="--area:' + areaColorVar(a) + '">' +
          '<button class="hopen" data-id="' + esc(e.id) + '">' +
          '<span class="hswatch"></span>' +
          '<span class="hinfo"><span class="hname">' + a.icon + " " + esc(step.name) + "</span>" +
          '<span class="hsets">' + esc(setsSummary(e, step)) + (e.note ? " &middot; " + esc(e.note) : "") + "</span></span></button>" +
          '<button class="hdel" data-id="' + esc(e.id) + '" aria-label="Delete this entry">&#128465;</button></div>';
      }).join("");
    }
    return sheetHead({
      title: "&#128197; " + esc(prettyDate(ts)),
      sub: n ? (n + " session" + (n === 1 ? "" : "s")) : "",
      back: true,
      backLabel: "Progress"
    }) +
      '<div class="sheet-body history">' + (n ? '<p class="muted-note">Tap a session to edit it.</p>' : "") + body + "</div>";
  }

  /* ---------- Sparkline (per-exercise, top set over time) ---------- */

  function sparklineSVG(entries) {
    var arr = entries.slice().reverse().map(topSet); // oldest -> newest
    if (arr.length < 2) return "";
    var w = 240, h = 46, pad = 5;
    var max = Math.max.apply(null, arr), min = Math.min.apply(null, arr);
    var flat = (max === min);
    var range = flat ? 1 : (max - min);
    var pts = arr.map(function (v, i) {
      var x = pad + (w - 2 * pad) * (i / (arr.length - 1));
      // An all-equal series sits on the mid-line rather than flat on the floor.
      var frac = flat ? 0.5 : ((v - min) / range);
      var y = h - pad - (h - 2 * pad) * frac;
      return { x: x, y: y, v: v };
    });
    var line = pts.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
    var dots = pts.map(function (p, i) {
      // Keep the label inside the box so it can't collide with the heading above.
      var ly = Math.max(p.y - 6, 9);
      var lbl = (i === 0 || i === pts.length - 1) ? '<text class="spark-lbl" x="' + p.x.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + (i === 0 ? "start" : "end") + '">' + p.v + "</text>" : "";
      return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.6"/>' + lbl;
    }).join("");
    // No preserveAspectRatio="none": that stretched the dots and labels into ovals.
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" width="100%" height="' + h + '" role="img" aria-label="Top set over time"><polyline points="' + line + '"/>' + dots + "</svg>";
  }

  /* ---------- Stats / progress pane ---------- */

  function statCard(value, label) {
    return '<div class="statcard"><span class="statval">' + value + '</span><span class="statlab">' + esc(label) + "</span></div>";
  }

  function heatmapSVG() {
    var counts = trainingDaySet();
    var weeks = 26, cell = 13, size = 10;
    var today = startOfDay(nowMs());
    var startOfWeek = addDays(today, -today.getDay());
    var start = addDays(startOfWeek, -(weeks - 1) * 7);
    var wpx = weeks * cell, hpx = 7 * cell;
    var rects = "";
    // Opacity levels rather than color-mix(): universally supported, and still
    // theme-aware because --good is themed.
    var OPACITY = [0, 0.28, 0.5, 0.72, 1];
    for (var w = 0; w < weeks; w++) {
      for (var dd = 0; dd < 7; dd++) {
        var day = addDays(start, w * 7 + dd); // calendar-day step, DST-safe
        if (day.getTime() > today.getTime()) continue;
        var key = dateStr(day.getTime());
        var c = counts[key] || 0;
        var lvl = c === 0 ? 0 : (c >= 4 ? 4 : c);
        var fillAttr = c === 0
          ? 'fill="var(--grid)"'
          : 'fill="var(--good)" fill-opacity="' + OPACITY[lvl] + '"';
        // Only trained days are interactive: tap/Enter opens that day's sessions.
        // Empty days stay inert so keyboard users don't tab through 180 blanks.
        var interactive = c > 0
          ? ' class="hm-cell" data-date="' + key + '" role="button" tabindex="0" aria-label="' +
              esc(prettyDate(day.getTime()) + ": " + c + " session" + (c === 1 ? "" : "s") + ". View details.") + '"'
          : "";
        rects += '<rect x="' + (w * cell) + '" y="' + (dd * cell) + '" width="' + size + '" height="' + size + '" rx="2" ' + fillAttr + interactive + '><title>' + key + ": " + c + " session" + (c === 1 ? "" : "s") + "</title></rect>";
      }
    }
    return '<div class="heatmap-scroll"><svg class="heatmap" width="' + wpx + '" height="' + hpx + '" viewBox="0 0 ' + wpx + " " + hpx + '" role="img" aria-label="Training calendar, last 26 weeks">' + rects + "</svg></div>";
  }

  function milestonesHTML() {
    var ms = state.milestones.slice().sort(function (a, b) { return b.ts - a.ts; });
    if (!ms.length) return '<p class="muted-note">Milestones will appear here as you reach new steps.</p>';
    return '<div class="mlist">' + ms.map(function (m) {
      var a = AREAS[areaIndexById(m.areaId)];
      var txt = m.type === "master"
        ? ("Mastered " + esc(a.name) + " &#8212; all ten steps!")
        : ("Reached " + esc(a.steps[m.step - 1].name) + " (" + esc(a.name) + ")");
      return '<div class="mrow" style="--area:' + areaColorVar(a) + '"><span class="mswatch"></span>' +
        '<span class="minfo"><span class="mtxt">' + a.icon + " " + txt + "</span>" +
        '<span class="mdate">' + esc(prettyDate(m.ts)) + "</span></span></div>";
    }).join("") + "</div>";
  }

  function statsPaneHTML() {
    var cur = currentStreak(), lng = longestStreak();
    var totalSessions = state.log.length;
    var daysTrained = Object.keys(trainingDaySet()).length;
    var cards = '<div class="statcards">' +
      statCard(cur, "day streak") +
      statCard(lng, "longest streak (days)") +
      statCard(totalSessions, totalSessions === 1 ? "session" : "sessions") +
      statCard(daysTrained, daysTrained === 1 ? "day trained" : "days trained") +
      "</div>";
    return sheetHead({ title: "&#128202; Progress", sub: "", back: false }) +
      '<div class="sheet-body stats">' +
      cards +
      "<h4>Training calendar</h4>" + heatmapSVG() +
      '<p class="hm-legend">Less <span class="hm-l hm-l0"></span><span class="hm-l hm-l1"></span><span class="hm-l hm-l2"></span><span class="hm-l hm-l3"></span><span class="hm-l hm-l4"></span> More</p>' +
      '<p class="muted-note">Tap a colored day to see what you trained.</p>' +
      "<h4>Milestones</h4>" + milestonesHTML() +
      "</div>";
  }

  /* ---------- Settings pane ---------- */

  function routinePreviewHTML() {
    var sessions = ROUTINE_PRESETS[state.routine.daysPerWeek] || ROUTINE_PRESETS[3];
    return sessions.map(function (sess, i) {
      return '<div class="rp-row"><span class="rp-day">Day ' + (i + 1) + "</span><span class=\"rp-moves\">" +
        sess.map(function (id) { var a = AREAS[areaIndexById(id)]; return a.icon + " " + esc(shortAreaName(a)); }).join(", ") +
        "</span></div>";
    }).join("");
  }

  // Lets you re-zero the dashed "where I started" line — useful at the start of
  // a new training block, when comparing against months ago stops being the
  // interesting comparison.
  function ghostSectionHTML() {
    var base = state.settings.ghostBase;
    var oldest = state.snapshots.length ? state.snapshots[0].d : "";
    var day = base ? shortDate(base.d) : (oldest ? shortDate(oldest) : "");
    return "<h4>&#8220;Where I started&#8221; line</h4>" +
      "<p>The dashed shape on your chart is your level" +
      (day ? " on <strong>" + esc(day) + "</strong>" : " on your first day") + ".</p>" +
      '<div class="btnrow"><button class="btn" id="ghostResetBtn">&#8635; Start from today&#8217;s levels</button>' +
      (base ? '<button class="btn" id="ghostAllBtn">Back to my first day</button>' : "") +
      "</div>";
  }

  // Two faces: an off state that walks you through the one-off setup, and an on
  // state that just reports and lets you add another device.
  function syncSectionHTML() {
    if (typeof SYNC === "undefined") return "";
    var head = "<h4>Sync across your devices</h4>";
    if (!syncCfg) {
      return head +
        "<p>Log a session on your phone, see it on your laptop. Free, and the app still works offline.</p>" +
        '<div class="copyrow"><input type="text" id="syncUrl" placeholder="Paste your database URL&#8230;" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn" id="syncOnBtn">Turn on</button></div>' +
        '<p class="hint">One-off setup: make your own free database — four steps, under <strong>Cloud sync setup</strong> in the README — then paste the address from its <em>Data</em> tab above.</p>' +
        '<div class="copyrow"><input type="text" id="pairCode" placeholder="&#8230;or paste a sync link" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn" id="pairBtn">Connect</button></div>';
    }
    return head +
      '<p id="syncStatus">' + esc(syncStatusText()) + "</p>" +
      '<div class="btnrow"><button class="btn" id="syncNowBtn">&#8635; Sync now</button>' +
      '<button class="btn" id="pairQrBtn">&#9636; Connect another device</button></div>' +
      '<div id="pairbox" class="qrbox"></div>' +
      '<p class="hint">Happens by itself when you open the app and after you log a session.</p>';
  }

  function settingsPaneHTML() {
    var url = shareURL();
    var routineChips = '<button class="chip' + (!state.routine.enabled ? " sel" : "") + '" data-routine="off">Off</button>' +
      [2, 3, 6].map(function (d) {
        return '<button class="chip' + ((state.routine.enabled && state.routine.daysPerWeek === d) ? " sel" : "") + '" data-routine="' + d + '">' + d + " days/week</button>";
      }).join("");
    // Anything wrong with saving goes first — it's the one thing here that
    // can't wait to be scrolled to.
    var warnings =
      (storageOk ? "" : '<p class="warn"><strong>Saving isn&#8217;t working</strong> in this browser (storage blocked, or full). Changes will be lost when you close the tab — download a backup file now.</p>') +
      (loadFailed ? '<p class="warn"><strong>The data on this device couldn&#8217;t be read</strong>, so the app started empty. Nothing has been overwritten yet — restore a backup file before logging anything new.</p>' : "");

    return sheetHead({ title: "&#9881;&#65039; Settings", sub: "", back: false }) +
      '<div class="sheet-body settings">' +
      warnings +
      "<h4>Weekly routine</h4>" +
      "<p>Pick how many days a week you train; the app spreads the six movements across them and shows today&#8217;s session on the home screen.</p>" +
      '<div class="chips">' + routineChips + "</div>" +
      '<div class="routine-preview">' + routinePreviewHTML() + "</div>" +
      syncSectionHTML() +
      ghostSectionHTML() +
      "<h4>Backup</h4>" +
      "<p>A file with everything — your steps and every session you&#8217;ve logged.</p>" +
      '<div class="btnrow"><button class="btn" id="downloadBtn">&#11015; Download backup</button><button class="btn" id="restoreBtn">&#11014; Restore from file</button></div>' +
      '<input type="file" id="restoreFile" accept="application/json,.json" hidden>' +
      // The rest is either rarely needed or destructive. Collapsed by default
      // with a plain <details> — no JavaScript, and nothing is taken away.
      "<details><summary>More</summary>" +
      '<div class="more-body">' +
      "<p>Browsers can clear data for sites you haven&#8217;t opened in a while, so keep a backup file somewhere safe. On iPhone, the home-screen app holds onto data more reliably than a Safari tab.</p>" +
      "<h5>Progress link</h5>" +
      "<p>Carries your six step numbers only — no sessions, no history. The backup file above is better for moving to a new device; this is for sending someone your positions.</p>" +
      '<div class="copyrow"><input type="text" readonly id="shareUrl" value="' + esc(url) + '"><button class="btn" id="copyBtn">Copy</button></div>' +
      '<div class="btnrow"><button class="btn" id="qrBtn">&#9636; Show QR code</button></div>' +
      '<div id="qrbox" class="qrbox"></div>' +
      '<div class="copyrow"><input type="text" id="importCode" placeholder="Paste a progress link&#8230;" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn" id="importBtn">Import</button></div>' +
      "<h5>Start over</h5>" +
      '<div class="btnrow">' +
      (syncCfg ? '<button class="btn danger" id="syncOffBtn">Turn off sync here</button>' : "") +
      '<button class="btn danger" id="resetBtn">Reset all progress</button></div>' +
      "</div></details>" +
      "</div>";
  }

  function wireSyncSection(sheet) {
    if (typeof SYNC === "undefined") return;

    var onBtn = $("#syncOnBtn", sheet);
    if (onBtn) onBtn.addEventListener("click", function () {
      var url = SYNC.normalizeURL($("#syncUrl", sheet).value);
      if (!url) { toast("That doesn't look like a Firebase database URL"); return; }
      // First device: it invents the secret code the others will be given.
      startSync({ url: url, code: SYNC.makeCode(), lastSync: 0 }, "Sync turned on ✓");
      renderSheet();
    });

    var pairBtn = $("#pairBtn", sheet);
    if (pairBtn) pairBtn.addEventListener("click", function () {
      var cfg = SYNC.parsePairing($("#pairCode", sheet).value);
      if (!cfg) { toast("That doesn't look like a sync link"); return; }
      startSync(cfg, "Device connected ✓");
      renderSheet();
    });

    var nowBtn = $("#syncNowBtn", sheet);
    if (nowBtn) nowBtn.addEventListener("click", function () { syncNow(true); });

    var qrBtn = $("#pairQrBtn", sheet);
    if (qrBtn) qrBtn.addEventListener("click", function () {
      var box = $("#pairbox", sheet);
      if (box.childNodes.length) { box.innerHTML = ""; this.innerHTML = "&#9636; Connect another device"; return; }
      var link = location.origin + location.pathname + SYNC.pairingHash(syncCfg);
      var drew = renderQR(box, link, "Scan this with your other device to connect it. Anyone who scans it can read and change your training data, so don't share it.");
      if (drew) this.innerHTML = "&#9636; Hide the code";
      // The text link is the fallback when a camera can't be pointed at a screen.
      // (el() builds SVG nodes for the radar — this is plain HTML.)
      var row = document.createElement("div");
      row.className = "copyrow";
      var input = document.createElement("input");
      input.type = "text";
      input.readOnly = true;
      input.value = link;
      var copy = document.createElement("button");
      copy.className = "btn";
      copy.textContent = "Copy";
      copy.addEventListener("click", function () {
        var fallback = function () {
          input.select();
          input.setSelectionRange(0, 99999);
          var ok = false;
          try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
          toast(ok ? "Sync link copied ✓" : "Copy failed — select the text and copy it manually");
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(function () { toast("Sync link copied ✓"); }, fallback);
        } else { fallback(); }
      });
      row.appendChild(input);
      row.appendChild(copy);
      box.appendChild(row);
    });

    var offBtn = $("#syncOffBtn", sheet);
    if (offBtn) offBtn.addEventListener("click", function () {
      if (!confirm("Stop syncing on this device? Your training data stays here and stays in the cloud — they just stop updating each other.")) return;
      stopSync();
      renderSheet();
      toast("Sync turned off");
    });
  }

  /* ---------- Sheet chrome + wiring ---------- */

  function sheetHead(o) {
    var backLabel = o.backLabel || "Steps";
    return '<div class="sheet-head"' + (o.areaColor ? ' style="--area:' + o.areaColor + '"' : "") + ">" +
      (o.back ? '<button class="back" id="backBtn" aria-label="Back">&#8249; ' + backLabel + "</button>" : "") +
      '<div class="headings"><h2>' + o.title + "</h2>" + (o.sub ? '<p class="sub">' + o.sub + "</p>" : "") + "</div>" +
      '<button class="close" id="closeBtn" aria-label="Close">&#10005;</button></div>';
  }

  function wireSheet(view) {
    var sheet = $("#sheet");
    var closeBtn = $("#closeBtn", sheet);
    if (closeBtn) closeBtn.addEventListener("click", closeAll);
    var backBtn = $("#backBtn", sheet);
    if (backBtn) backBtn.addEventListener("click", goBack);

    if (view.t === "area") {
      sheet.querySelectorAll(".rung").forEach(function (r) {
        r.addEventListener("click", function () {
          openStep(view.a, Number(r.getAttribute("data-step")));
        });
      });
    }

    if (view.t === "step") {
      var a = AREAS[view.a];
      var logB = $("#logBtn", sheet);
      if (logB) logB.addEventListener("click", function () { openLog(view.a, view.s); });
      sheet.querySelectorAll(".chip").forEach(function (c) {
        c.addEventListener("click", function () {
          state.areas[a.id].std = Number(c.getAttribute("data-std"));
          touchArea(a.id);
          checkMaster(a.id);
          recordSnapshot(); // saves state (incl. any milestone)
          refresh();
          renderSheet();
        });
      });
      var setBtn = $("#setCurrentBtn", sheet);
      if (setBtn) setBtn.addEventListener("click", function () {
        setAreaProgress(a.id, view.s + 1, 0);
        refresh();
        renderSheet();
        toast(a.name + ": current step set to " + (view.s + 1));
      });
      var adv = $("#advanceBtn", sheet);
      if (adv) adv.addEventListener("click", function () {
        setAreaProgress(a.id, view.s + 2, 0);
        refresh();
        // Show the newly-current step in place of this one
        uiStack[uiStack.length - 1] = { t: "step", a: view.a, s: view.s + 1 };
        renderSheet();
        toast("Moved up! Now on Step " + (view.s + 2) + ".");
      });
    }

    if (view.t === "log") {
      var la = view.a, ls = view.s;
      var addBtn = $("#addSet", sheet);
      if (addBtn) addBtn.addEventListener("click", function () {
        readLogInputs();
        logDraft.sets.push("");
        renderSheet();
      });
      sheet.querySelectorAll(".removeSet").forEach(function (b) {
        b.addEventListener("click", function () {
          readLogInputs();
          logDraft.sets.splice(Number(b.getAttribute("data-i")), 1);
          if (!logDraft.sets.length) logDraft.sets.push("");
          renderSheet();
        });
      });
      sheet.querySelectorAll(".restpreset").forEach(function (b) {
        b.addEventListener("click", function () {
          startRest(Number(b.getAttribute("data-sec")));
          toast("Rest timer started");
        });
      });
      sheet.querySelectorAll(".vchip").forEach(function (b) {
        b.addEventListener("click", function () {
          readLogInputs();   // keep anything already typed
          logDraft.variant = b.getAttribute("data-variant") || "";
          renderSheet();
        });
      });
      var saveBtn = $("#saveLog", sheet);
      if (saveBtn) saveBtn.addEventListener("click", function () { saveLog(la, ls); });
    }

    if (view.t === "session") {
      var plan = sessionPlan();
      var si = sessionAt(plan);
      var cur = si >= 0 ? plan[si] : null;

      var logB = $("#sessionLog", sheet);
      if (logB && cur) logB.addEventListener("click", function () {
        openLog(cur.areaIdx, cur.stepIdx);
      });
      var restB = $("#sessionRest", sheet);
      if (restB) restB.addEventListener("click", function () {
        startRest(state.settings.restSeconds);
        toast("Rest timer started");
      });
      var skipB = $("#sessionSkip", sheet);
      if (skipB) skipB.addEventListener("click", function () {
        // Move past this one by hand; -1 hands control back to "first unlogged".
        sessionCursor = (si + 1 < plan.length) ? si + 1 : -1;
        renderSheet();
      });
      var advB = $("#sessionAdvance", sheet);
      if (advB && cur) advB.addEventListener("click", function () {
        setAreaProgress(cur.areaId, cur.step + 1, 0);
        refresh();
        renderSheet();
        toast("Moved up to step " + (cur.step + 1) + " ✓");
      });
      sheet.querySelectorAll(".swap").forEach(function (b) {
        b.addEventListener("click", function () {
          if (cur) openLog(cur.areaIdx, cur.stepIdx, b.getAttribute("data-variant"));
        });
      });
      var nextB = $("#sessionNext", sheet);
      if (nextB) nextB.addEventListener("click", function () {
        var sessions3 = routineSessions();
        state.routine.sessionIndex = (state.routine.sessionIndex + 1) % sessions3.length;
        touchPrefs();
        saveState();
        sessionCursor = -1;
        renderToday();
        closeAll();
        toast("Next session ready");
      });
    }

    if (view.t === "library") {
      sheet.querySelectorAll(".librow").forEach(function (b) {
        b.addEventListener("click", function () { openArea(Number(b.getAttribute("data-area"))); });
      });
    }

    // The history pane and the per-day pane share the same session-row markup.
    if (view.t === "history" || view.t === "day") {
      sheet.querySelectorAll(".hopen").forEach(function (b) {
        b.addEventListener("click", function () { openEditSession(b.getAttribute("data-id")); });
      });
      sheet.querySelectorAll(".hdel").forEach(function (b) {
        b.addEventListener("click", function () {
          if (confirm("Delete this logged session?")) {
            deleteLogEntry(b.getAttribute("data-id"));
            refresh();
            renderSheet();
          }
        });
      });
    }

    if (view.t === "stats") {
      sheet.querySelectorAll(".hm-cell").forEach(function (r) {
        var open = function () { openDay(r.getAttribute("data-date")); };
        r.addEventListener("click", open);
        r.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        });
      });
    }

    if (view.t === "settings") {
      wireSyncSection(sheet);

      var ghostReset = $("#ghostResetBtn", sheet);
      if (ghostReset) ghostReset.addEventListener("click", function () {
        // Freeze today's shape as the baseline.
        state.settings.ghostBase = { d: dateStr(nowMs()), v: currentRadarVals() };
        touchPrefs();
        saveState();
        ghostOn = false;
        refresh();
        renderSheet();
        toast("Today's levels are now your starting point ✓");
      });

      var ghostAll = $("#ghostAllBtn", sheet);
      if (ghostAll) ghostAll.addEventListener("click", function () {
        state.settings.ghostBase = null;
        touchPrefs();
        saveState();
        refresh();
        renderSheet();
        toast("Back to your first day");
      });

      sheet.querySelectorAll("[data-routine]").forEach(function (b) {
        b.addEventListener("click", function () {
          var val = b.getAttribute("data-routine");
          if (val === "off") { state.routine.enabled = false; }
          else {
            var days = Number(val);
            // Only rewind the rotation when the split actually changes.
            if (!state.routine.enabled || state.routine.daysPerWeek !== days) state.routine.sessionIndex = 0;
            state.routine.enabled = true;
            state.routine.daysPerWeek = days;
          }
          touchPrefs();
          saveState();
          renderToday();
          renderSheet();
        });
      });
      $("#copyBtn", sheet).addEventListener("click", function () {
        var input = $("#shareUrl", sheet);
        var fallback = function () {
          input.select();
          input.setSelectionRange(0, 99999);
          var ok = false;
          try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
          toast(ok ? "Progress link copied ✓" : "Copy failed — select the text and copy it manually");
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value).then(function () { toast("Progress link copied ✓"); }, fallback);
        } else {
          fallback();
        }
      });
      $("#qrBtn", sheet).addEventListener("click", function () {
        var box = $("#qrbox", sheet);
        if (box.childNodes.length) { box.innerHTML = ""; this.innerHTML = "&#9636; Show QR code"; }
        // Only flip to "Hide" if a code actually rendered.
        else { this.innerHTML = renderQR(box, shareURL()) ? "&#9636; Hide QR code" : "&#9636; Show QR code"; }
      });
      $("#importBtn", sheet).addEventListener("click", function () {
        var incoming = decodeBackup($("#importCode", sheet).value);
        if (!incoming) { toast("That doesn't look like a progress link"); return; }
        if (confirm("Import this progress? It will replace the progress saved on this device.")) {
          applyImport(incoming);
          renderSheet();
        }
      });
      $("#downloadBtn", sheet).addEventListener("click", downloadBackup);
      $("#restoreBtn", sheet).addEventListener("click", function () { $("#restoreFile", sheet).click(); });
      $("#restoreFile", sheet).addEventListener("change", function () {
        var f = this.files && this.files[0];
        var input = this;
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          var parsed = null;
          try { parsed = JSON.parse(String(reader.result)); } catch (e) { parsed = null; }
          var incoming = parsed ? sanitizeState(parsed) : null;
          if (!incoming) { toast("That file isn't a valid backup"); input.value = ""; return; }
          if (confirm("Restore this backup? It will replace ALL current progress and history on this device.")) {
            applyFullState(incoming, "Backup restored ✓");
            renderSheet();
          }
          input.value = "";
        };
        reader.onerror = function () { toast("Couldn't read that file"); input.value = ""; };
        reader.readAsText(f);
      });
      $("#resetBtn", sheet).addEventListener("click", function () {
        if (confirm("Reset ALL progress AND history on this device? This cannot be undone.")) {
          state = defaultState();
          saveState();
          refresh();
          renderSheet();
          toast("Everything reset");
        }
      });
    }
  }

  $("#scrim").addEventListener("click", function () {
    // A fast double-tap's second click lands on the scrim that just appeared;
    // don't let it instantly close the sheet the first tap opened.
    if (performance.now() - openedAt < 350) return;
    closeAll();
  });
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#historyBtn").addEventListener("click", openHistory);
  $("#statsBtn").addEventListener("click", openStats);
  $("#restpill").addEventListener("click", cancelRest);
  var ghostBtn = $("#ghostToggle");
  if (ghostBtn) ghostBtn.addEventListener("click", function () {
    ghostOn = !ghostOn;
    paintGhost();
    updateGhostControl();
  });

  /* ---------- Share / import ---------- */

  function shareURL() {
    var p = PAYLOAD_ORDER.map(function (id) { return [state.areas[id].step, state.areas[id].std]; });
    var payload = btoa(JSON.stringify({ v: 1, p: p }));
    return location.origin + location.pathname + "#s=" + payload;
  }

  // Accepts a full backup URL or just the raw code; returns a state or null.
  function decodeBackup(text) {
    var s = String(text || "").trim();
    var at = s.indexOf("#s=");
    if (at !== -1) s = s.slice(at + 3);
    if (!s) return null;
    try {
      var data = JSON.parse(atob(s));
      if (!data || data.v !== 1 || !Array.isArray(data.p) || data.p.length !== PAYLOAD_ORDER.length) return null;
      var incoming = defaultState();
      PAYLOAD_ORDER.forEach(function (id, i) {
        var pair = data.p[i] || [];
        var step = Math.round(Number(pair[0])), std = Math.round(Number(pair[1]));
        if (step >= 1 && step <= 10) incoming.areas[id].step = step;
        if (std >= 0 && std <= 3) incoming.areas[id].std = std;
      });
      return incoming;
    } catch (e) { return null; }
  }

  var booted = false;

  // Progress-only import (URL link / pasted code): merge the six area positions,
  // preserving any training history already on this device.
  function applyImport(incoming) {
    AREAS.forEach(function (a) {
      if (incoming.areas[a.id]) {
        state.areas[a.id] = incoming.areas[a.id];
        touchArea(a.id);
      }
      // An imported position can already be a mastered area — record it so the
      // milestone timeline isn't silently missing it.
      checkMaster(a.id);
    });
    saveState();
    displayVals = AREAS.map(function (a) { return areaValue(a.id); });
    if (booted) { recordSnapshot(); paintRadar(); renderCards(); renderToday(); updateGhostControl(); }
    toast("Progress imported ✓");
  }

  // Full restore (backup file): replace everything, including history.
  function applyFullState(incoming, msg) {
    state = incoming;
    saveState();
    displayVals = AREAS.map(function (a) { return areaValue(a.id); });
    if (booted) { recordSnapshot(); paintRadar(); renderCards(); renderToday(); updateGhostControl(); }
    toast(msg || "Restored ✓");
  }

  function tryImportFromHash() {
    if (!location.hash || location.hash.indexOf("#s=") !== 0) return;
    var incoming = decodeBackup(location.hash);
    if (!incoming) {
      // Malformed payload — clear it so it doesn't linger in the URL
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    if (confirm("Import progress from this link? It will replace the progress saved on this device — your logged sessions are kept.")) {
      applyImport(incoming);
      history.replaceState(null, "", location.pathname + location.search);
    }
    // On cancel the hash stays, so reloading the page offers the import again.
  }

  // A backup link opened into an already-loaded tab only changes the fragment —
  // no page load happens, so catch it here too.
  window.addEventListener("hashchange", tryImportFromHash);

  /* ---------- Cloud sync (optional — off until you set it up) ---------- */

  var syncCfg = (typeof SYNC !== "undefined") ? SYNC.getConfig() : null;
  var syncBusy = false;      // a round is in flight
  var syncAgain = false;     // something changed while it was in flight
  var syncErr = "";
  var syncTimer = null;
  var applyingSync = false;  // guards against a sync's own save re-triggering it

  function syncOn() { return !!syncCfg; }

  function logPaneOpen() {
    var top = uiStack[uiStack.length - 1];
    return !!top && top.t === "log";
  }

  // Every change goes through saveState(), so that is the only place this needs
  // to be called from. The delay coalesces the burst of saves one action makes.
  function scheduleSync() {
    if (!syncCfg || applyingSync) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow(false); }, 2500);
  }

  function syncNow(manual) {
    if (!syncCfg) return;
    // Never re-render the log form out from under someone mid-entry.
    if (!manual && logPaneOpen()) { syncAgain = true; return; }
    if (syncBusy) { syncAgain = true; return; }
    syncBusy = true;
    syncAgain = false;
    updateSyncUI();

    syncRound(1).then(function (changed) {
      syncBusy = false;
      syncErr = "";
      SYNC.markSynced(syncCfg, nowMs());
      if (changed) {
        refresh();
        if (uiStack.length && !logPaneOpen()) renderSheet();
      }
      if (manual) toast(changed ? "Synced — new data pulled in ✓" : "Synced ✓");
      updateSyncUI();
      if (syncAgain && !logPaneOpen()) { syncAgain = false; syncNow(false); }
    }, function (err) {
      syncBusy = false;
      syncErr = (err && err.message) ? err.message : "Sync failed.";
      if (manual) toast(syncErr);
      updateSyncUI();
    });
  }

  // One pull → merge → push round. Resolves to true when the merge actually
  // changed anything locally. `triesLeft` covers the compare-and-set retry.
  function syncRound(triesLeft) {
    return SYNC.pull(syncCfg).then(function (res) {
      // Anything off the network is untrusted input: it goes through exactly
      // the same validation as a restored backup file before it is merged.
      var remote = res.raw ? sanitizeState(res.raw) : null;
      var changed = false;

      if (remote) {
        var before = JSON.stringify(state);
        var merged = sanitizeState(SYNC.merge(state, remote));
        if (merged && JSON.stringify(merged) !== before) {
          state = merged;
          applyingSync = true;
          saveState();
          applyingSync = false;
          displayVals = AREAS.map(function (a) { return areaValue(a.id); });
          changed = true;
        }
      }

      // Only spend a write when the cloud copy isn't already what we hold.
      if (remote && JSON.stringify(remote) === JSON.stringify(state)) return changed;

      return SYNC.push(syncCfg, state, res.etag).then(function () {
        return changed;
      }, function (err) {
        // Another device wrote between our read and our write — take its
        // version into account and try once more.
        if (err && err.conflict && triesLeft > 0) return syncRound(triesLeft - 1);
        throw err;
      });
    });
  }

  function syncStatusText() {
    if (!syncCfg) return "";
    if (syncBusy) return "Syncing…";
    if (syncErr) return "Last attempt failed: " + syncErr;
    if (!syncCfg.lastSync) return "Set up — not synced yet.";
    return "Last synced " + agoText(syncCfg.lastSync) + ".";
  }

  function agoText(ts) {
    var mins = Math.floor((nowMs() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + (mins === 1 ? " minute ago" : " minutes ago");
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    return "on " + dateStr(ts);
  }

  function updateSyncUI() {
    var line = document.getElementById("syncStatus");
    if (line) line.textContent = syncStatusText();
    var btn = document.getElementById("syncNowBtn");
    if (btn) btn.disabled = syncBusy;
    var foot = document.getElementById("footNote");
    if (foot) {
      foot.textContent = syncCfg
        ? "Your training data is saved on this device and synced to your other devices."
        : "Your progress is stored only on this device. Use Settings → backup link to move it to another device.";
    }
  }

  function startSync(cfg, msg) {
    syncCfg = cfg;
    syncErr = "";
    if (!SYNC.setConfig(cfg)) { toast("Couldn't save the sync settings"); return; }
    updateSyncUI();
    toast(msg || "Sync turned on");
    syncNow(true);
  }

  function stopSync() {
    syncCfg = null;
    syncErr = "";
    clearTimeout(syncTimer);
    SYNC.clearConfig();
    updateSyncUI();
  }

  // Pairing arrives as a #sync=<database>,<code> fragment — normally by
  // scanning the QR the first device shows.
  function tryPairFromHash() {
    if (typeof SYNC === "undefined") return;
    if (!location.hash || location.hash.indexOf("#sync=") !== 0) return;
    var cfg = SYNC.parsePairing(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    if (!cfg) { toast("That sync link isn't valid"); return; }
    if (syncCfg && syncCfg.url === cfg.url && syncCfg.code === cfg.code) {
      toast("This device is already synced");
      return;
    }
    if (confirm("Sync this device with your other one? Your training data will be combined, not replaced.")) {
      startSync(cfg, "Device connected ✓");
    }
  }

  window.addEventListener("hashchange", tryPairFromHash);

  /* ---------- Refresh + boot ---------- */

  function refresh() {
    renderCards();
    animateRadar();
    renderToday();
    updateGhostControl();
  }

  $("#cards").addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (card) openArea(Number(card.getAttribute("data-area")));
  });

  tryImportFromHash();
  tryPairFromHash();
  buildRadar();
  renderCards();
  renderToday();
  // Capture today's shape for the ghost radar — but never auto-write over
  // stored data we failed to read, so a recoverable backup isn't destroyed.
  if (!loadFailed) recordSnapshot();
  updateGhostControl();
  updateSyncUI();
  booted = true;

  // Pull whatever the other device logged while this one was closed. Also on
  // coming back to the tab, which on a phone is what "opening the app" is.
  if (syncOn()) syncNow(false);
  window.addEventListener("focus", function () { if (syncOn()) syncNow(false); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && syncOn()) syncNow(false);
  });
  // A phone that was offline mid-workout should catch up as soon as it can.
  window.addEventListener("online", function () { if (syncOn()) syncNow(false); });

  // Ask the browser to protect our saved data from automatic eviction
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () { /* best effort */ });
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline support is optional */ });
    });
  }
})();
