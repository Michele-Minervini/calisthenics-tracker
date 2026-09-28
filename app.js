/* ============================================================
   Milo — app logic
   Plain JavaScript, no dependencies.
   The stored state (data v5) is described at the top of model.js, which
   also holds everything that validates, migrates and merges it. Older
   shapes migrate automatically on load. The `mts` / `pm` stamps and
   `deleted` tombstones exist only for sync: they let two devices merge
   without losing or resurrecting anything. Nothing in the UI reads them.
   Log entries come in kinds: skill-ladder sessions (no `kind`) and quick
   gym logs ("quick") are logged here; gym-exercise and weigh-in entries
   are only displayed so far. Volume per muscle group is in training.js.
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

  var BUILD = "milo-v19";
  var UPDATE_TRIES_KEY = "bigsix.updateTries";   // must be set before the check below uses it

  // Every file carries the same build stamp. If they disagree, the browser has
  // handed us parts of two different releases (possible for one launch while an
  // update installs). Running like that could store data in a shape half the
  // code doesn't understand, so stop before touching storage and ask for a
  // reload instead. Nothing below may run before this check.
  var buildParts = {
    page: document.documentElement.getAttribute("data-build"),
    data: typeof DATA_BUILD === "undefined" ? null : DATA_BUILD,
    model: typeof MODEL === "undefined" ? null : MODEL.BUILD,
    training: typeof TRAINING === "undefined" ? null : TRAINING.BUILD,
    radar: typeof RADAR === "undefined" ? null : RADAR.BUILD,
    qr: typeof QR === "undefined" ? null : QR.BUILD,
    sync: typeof SYNC === "undefined" ? null : SYNC.BUILD
  };
  var staleParts = Object.keys(buildParts).filter(function (k) { return buildParts[k] !== BUILD; });
  if (staleParts.length) { showUpdateScreen(staleParts); return; }
  try { sessionStorage.removeItem(UPDATE_TRIES_KEY); } catch (e) { /* not important */ }

  // The pure data code lives in model.js, where tests/ can run it; these are
  // local names for it so the rest of this file reads as before.
  var KNOWN_IDS = MODEL.KNOWN_IDS, DEFAULT_REST = MODEL.DEFAULT_REST;
  var nowMs = MODEL.nowMs, pad2 = MODEL.pad2, dateStr = MODEL.dateStr, dateFromKey = MODEL.dateFromKey;
  var startOfDay = MODEL.startOfDay, addDays = MODEL.addDays, dayDelta = MODEL.dayDelta, genId = MODEL.genId;
  var defaultState = MODEL.defaultState, sanitizeState = MODEL.sanitizeState;
  var variationByName = MODEL.variationByName;
  var isBodyweight = MODEL.isBodyweight, isTraining = MODEL.isTraining;

  // Plain DOM and inline styles on purpose: this runs when the other files —
  // style.css included — can't be trusted to be from this release.
  function showUpdateScreen(parts) {
    var shell = document.querySelector(".wrap");
    if (shell) shell.style.display = "none";   // don't leave a dead, empty app behind it
    var offline = navigator.onLine === false;
    var box = document.createElement("div");
    box.className = "updatescreen";
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;" +
      "padding:24px;background:var(--page,#f9f9f7);color:var(--ink,#0b0b0b);font-family:system-ui,-apple-system,sans-serif";
    var inner = document.createElement("div");
    inner.style.cssText = "max-width:420px;display:flex;flex-direction:column;gap:12px";
    var h = document.createElement("h2");
    h.style.margin = "0";
    h.textContent = "Finishing an update";
    var p = document.createElement("p");
    p.style.margin = "0";
    p.textContent = offline
      ? "You're offline, and part of the app is still from the previous version. Connect to the internet and it will finish updating by itself. Your data is safe — nothing has been changed."
      : "Part of the app is still from the previous version. Reload to finish updating — your data is safe, nothing has been changed.";
    var b = document.createElement("button");
    b.className = "btn primary wide";
    b.style.cssText = "padding:12px;border-radius:12px;font-weight:700";
    b.textContent = "Reload";
    b.addEventListener("click", finishUpdate);
    var d = document.createElement("p");
    d.style.cssText = "margin:0;font-size:12px;opacity:.7";
    d.textContent = "Out of date: " + parts.join(", ") + " (expected " + BUILD + ")";
    inner.appendChild(h); inner.appendChild(p); inner.appendChild(b); inner.appendChild(d);
    box.appendChild(inner);
    document.body.appendChild(box);
    if (offline) window.addEventListener("online", function () { finishUpdate(); });
  }

  // A strip at the top of the page for conditions that stop the app saving.
  function showBanner(kind) {
    var b = document.getElementById("banner");
    var text = {
      // Stored data here is newer than this code: nothing may be saved.
      newer: "This device has data from a newer version of the app. Nothing is saved or synced here until it updates.",
      // Only the cloud is newer: this device keeps saving, sync waits.
      "newer-remote": "Milo was updated on another device. Reload to update this one too — until then it saves here but doesn't sync."
    }[kind];
    if (!b || !text) return;
    b.innerHTML = "<span>" + text + "</span>" +
      '<button class="btn" type="button">Reload</button>';
    b.querySelector("button").addEventListener("click", finishUpdate);
    b.hidden = false;
  }

  // First try: ask for the new release, then reload. If the same thing
  // happens again straight after, the offline copy itself is inconsistent:
  // drop this app's offline copy (never its data) and load from the network,
  // after which the app installs itself again.
  function finishUpdate() {
    var tries = 0;
    try {
      tries = Number(sessionStorage.getItem(UPDATE_TRIES_KEY)) || 0;
      sessionStorage.setItem(UPDATE_TRIES_KEY, String(tries + 1));
    } catch (e) { /* no sessionStorage: behave as a first try */ }
    var sw = navigator.serviceWorker;
    if (!sw || navigator.onLine === false) { location.reload(); return; }
    sw.getRegistration().then(function (reg) {
      if (!reg) { location.reload(); return; }
      if (tries < 1) {
        return reg.update().catch(function () { /* offline */ }).then(function () { location.reload(); });
      }
      var suffix = "@" + new URL(reg.scope).pathname;
      return reg.unregister().then(function () { return caches.keys(); }).then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.slice(-suffix.length) === suffix; })
          .map(function (k) { return caches.delete(k); }));
      }).then(function () { location.reload(); });
    }).catch(function () { location.reload(); });
  }

  var STORE_KEY = "bigsix.v1";

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

  // Guided routine presets: each is a list of sessions (a session = the areas
  // trained that day). Every preset covers all six movements once per cycle.
  // Keyed by the stored split name. A split this version doesn't know (added by
  // a newer version) shows as no routine here, but is kept as it is.
  var ROUTINE_PRESETS = {
    bb2: [["pushup", "pullup", "legraise"], ["squat", "bridge", "hspu"]],
    bb3: [["pushup", "squat"], ["pullup", "legraise"], ["hspu", "bridge"]],
    bb6: [["pushup"], ["squat"], ["pullup"], ["legraise"], ["bridge"], ["hspu"]]
  };
  function routineSessions() {
    var s = state.routine.split;
    return Object.prototype.hasOwnProperty.call(ROUTINE_PRESETS, s) ? ROUTINE_PRESETS[s] : null;
  }
  function routineOn() { return !!routineSessions(); }

  // Every preference change goes through here: the stamp lets each setting
  // sync on its own, so changing the rest timer on the phone can't undo a
  // routine chosen on the laptop.
  function setPref(field, value) {
    var box = MODEL.SETTINGS_FIELDS.indexOf(field) !== -1 ? state.settings : state.routine;
    box[field] = value;
    state.pm[field] = MODEL.stampPref(state.pm[field]);
  }

  /* ---------- State ---------- */

  var memoryFallback = null;
  var storageOk = true;

  // True when stored data existed but could not be read/understood. We then
  // avoid auto-writing over it, so a recoverable file isn't destroyed on load.
  var loadFailed = false;

  // True when this device holds data written by a NEWER version of the app
  // (another tab, or a half-finished update). Saving would strip what the
  // newer version added, so nothing is saved or synced until a reload.
  var readOnly = false;

  var RECOVER_KEY = "milo.recover";     // stored data that couldn't be read
  var PRE_UPDATE_KEY = "milo.pre5";     // the data as it was before data v5

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
      var parsed = JSON.parse(raw);
      if (MODEL.isNewer(parsed)) {
        // Show what we can (a copy, read as this version), but never save it.
        readOnly = true;
        var view = JSON.parse(raw);
        view.v = MODEL.MODEL_VERSION;
        return sanitizeState(view) || defaultState();
      }
      var clean = sanitizeState(parsed);
      if (!clean) { loadFailed = true; keepCopy(RECOVER_KEY, raw, true); return defaultState(); }
      return clean;
    } catch (e) {
      loadFailed = true;
      keepCopy(RECOVER_KEY, raw, true);
      return defaultState();
    }
  }

  // Why a change wasn't saved, in the words the user needs.
  function notSavedMsg() {
    return readOnly
      ? "Not saved — this device needs the newer version of the app first (see the top of the page)"
      : "Saved in this tab only — storage is full or blocked";
  }

  // A deliberate "replace everything" (restore-replace, reset). Other open tabs
  // normally MERGE what this tab saves — which would put back everything just
  // removed. This marker tells them to adopt the new data as it is instead.
  var REPLACE_KEY = "milo.replaceAt";
  var seenReplaceAt = 0;
  try { seenReplaceAt = Number(localStorage.getItem(REPLACE_KEY)) || 0; } catch (e) { /* no storage */ }
  function setReplaceMarker(at) {
    seenReplaceAt = at;
    try { localStorage.setItem(REPLACE_KEY, String(at)); } catch (e) { /* best effort */ }
  }
  // Saves the state as a replacement. The marker goes first (other tabs read
  // it when the data arrives), and is put back if the save fails, so a later
  // ordinary save isn't mistaken for a replace.
  function saveReplacing() {
    var prev = seenReplaceAt;
    setReplaceMarker(MODEL.stamp(prev));
    if (saveState()) return true;
    setReplaceMarker(prev);
    return false;
  }

  // With sync on, removing things only works on this device: the others still
  // have them and merge them back in. Say so where it matters.
  function syncCaveat() {
    return syncCfg ? "\n\nSync is on: your other devices still have their sessions and will add them back here. To start over everywhere, turn sync off on every device first." : "";
  }

  // Keeps a raw copy under a side key. once: never replace an existing copy.
  function keepCopy(key, raw, replace) {
    try {
      var cur = localStorage.getItem(key);
      if (cur === raw || (cur && !replace)) return;
      localStorage.setItem(key, raw);
    } catch (e) { /* storage full: the copy is a nicety, not required */ }
  }

  // The data version at the start of a stored string, without parsing it all.
  function storedVersion(raw) {
    var m = /^\{"v":"?(\d+)/.exec(raw);
    if (m) return Number(m[1]);
    try { var p = JSON.parse(raw); return Number(p && p.v) || 0; } catch (e) { return 0; }
  }

  // Returns true when the write actually landed. (User-initiated saves always
  // proceed; only the automatic boot-time write is suppressed after a bad load.)
  function saveState() {
    if (readOnly) { showBanner("newer"); return false; }
    try {
      var stored = localStorage.getItem(STORE_KEY);
      if (stored) {
        var sv = storedVersion(stored);
        // Another tab may have written newer data since this one loaded.
        if (sv > MODEL.MODEL_VERSION) { readOnly = true; showBanner("newer"); return false; }
        // The first save in the new format keeps the old data once, untouched,
        // so the update can always be undone by hand (Settings → More).
        if (sv < MODEL.MODEL_VERSION) keepCopy(PRE_UPDATE_KEY, stored, false);
      }
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

  var state = loadState();

  function areaValue(areaId) {
    var st = state.areas[areaId];
    return (st.step - 1) + st.std / 3;
  }

  /* ---------- Helpers ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }

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
  // Muscle groups: colour tokens in style.css (--g-*), names in data.js.
  function groupColorVar(g) { return "var(--g-" + g + ")"; }
  function groupName(g) { return (GROUP_INFO[g] && GROUP_INFO[g].name) || g; }

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
    t.classList.remove("act");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    var gone = null;
    state.log = state.log.filter(function (e) { if (e.id === id) gone = e; return e.id !== id; });
    // Remember the deletion. Without this, syncing with a device that still has
    // the entry would quietly bring it back. The stamp is later than the
    // entry's last edit even if this device's clock runs behind, so the delete
    // is guaranteed to win.
    state.deleted.push({ id: id, ts: MODEL.stamp(gone ? (gone.mts || gone.ts) : 0) });
    if (state.deleted.length > MODEL.CAPS.deleted) state.deleted = state.deleted.slice(-MODEL.CAPS.deleted);
    saveState();
  }
  function sessionsForStep(areaId, step) {
    return state.log.filter(function (e) { return e.areaId === areaId && e.step === step; })
      .sort(function (a, b) { return b.ts - a.ts; });
  }
  // Entries on one calendar day, oldest-first. Keyed by dateStr(ts), like the
  // calendar and the week strip.
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
  function touchArea(areaId) { state.areas[areaId].mts = MODEL.stamp(state.areas[areaId].mts); }

  // Central point for changing an area's step/std so milestones are recorded once.
  function setAreaProgress(areaId, newStep, newStd) {
    var old = state.areas[areaId];
    var oldStep = old.step;
    state.areas[areaId] = { step: newStep, std: newStd, mts: MODEL.stamp(old.mts) };
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
    if (!routineOn()) return [];
    var sessions = routineSessions();
    return sessions[state.routine.sessionIndex % sessions.length] || [];
  }

  function variationsFor(areaId, step) {
    var list = (typeof VARIATIONS !== "undefined" && VARIATIONS[areaId]) || [];
    return list.filter(function (v) { return step >= v.from && step <= v.to; });
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

  /* ---------- The skill nudge (Skills tab) ---------- */

  // The ladder you haven't practised for longest, once it's 5 days or more
  // (or one you've never logged, once you've logged any). About the skills
  // only: muscle groups have their own nudge on Today.
  function skillNudgeText() {
    if (!state.log.some(isBodyweight)) return "";
    var today = nowMs();
    var worst = null, worstGap = -1, worstNever = false;
    AREAS.forEach(function (a) {
      var last = lastSessionTs(a.id);
      // Whole calendar days, so this agrees with the calendar.
      var gap = last ? Math.max(0, dayDelta(last, today)) : Infinity;
      if (gap > worstGap) { worstGap = gap; worst = a; worstNever = !last; }
    });
    if (worst && worstNever) return "You haven't logged " + shortAreaName(worst) + " yet — give it a try.";
    if (worst && worstGap >= 5) return "You haven't practised " + shortAreaName(worst) + " in " + worstGap + " days.";
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
    if (state.settings.restSeconds !== seconds) { setPref("restSeconds", seconds); saveState(); }
    var sr = $("#sr-live"); if (sr) sr.textContent = ""; // reset so the next "complete" re-announces
    ensureAudio();
    var pill = $("#restpill");
    pill.hidden = false;
    pill.classList.remove("done");
    document.body.classList.add("pill-on");
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
  function hideRestPill() { var p = $("#restpill"); p.hidden = true; p.classList.remove("done"); document.body.classList.remove("pill-on"); }

  /* ---------- Backup file (full state: progress + history) ---------- */

  // Saves text as a file. In an installed iPhone app a plain download can do
  // nothing at all, so there the share sheet is used ("Save to Files").
  function saveTextFile(text, filename, doneMsg) {
    try {
      var standalone = navigator.standalone === true ||
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
      if (standalone && typeof File !== "undefined" && navigator.canShare) {
        var file = new File([text], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: filename }).then(function () { toast(doneMsg); }, function () { /* cancelled */ });
          return;
        }
      }
      var blob = new Blob([text], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast(doneMsg);
    } catch (e) { toast("Couldn't create the file"); }
  }

  function downloadBackup() {
    var text = JSON.stringify(state, null, 2);
    // When the stored data couldn't be read, or is from a newer version, the
    // state in memory isn't the whole story: save exactly what is stored.
    if (readOnly || loadFailed) {
      try { text = localStorage.getItem(STORE_KEY) || text; } catch (e) { /* keep the in-memory copy */ }
    }
    saveTextFile(text, "milo-backup-" + dateStr(nowMs()) + ".json", "Backup saved ✓");
  }

  // Side copies kept automatically (see loadState / saveState).
  function sideCopy(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
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

  // Drawn by radar.js; this decides what it shows: an axis per ladder area
  // (value = step - 1 + std / 3, so 0..10), "Step N" under each name, and
  // the ghost of where you started.
  var radar = null;

  function buildRadar() {
    radar = RADAR.make($("#radar"), {
      axes: AREAS.map(function (a) {
        return {
          id: a.id,
          label: shortAreaName(a),
          color: areaColorVar(a),
          // The name or the area's wedge → its step list; the dot → its
          // current exercise directly.
          onLabel: openArea,
          labelAria: "Open " + a.name,
          onDot: openCurrentStep,
          dotAria: "Open your current " + a.name + " exercise"
        };
      }),
      max: 10,
      rings: 10,                  // a ring for every step; 5 and 10 slightly stronger
      majorRings: [5, 10],
      ringLabels: [2, 4, 6, 8, 10],
      cx: 210, cy: 196, r: 134,   // fits the 420 × 400 viewBox in index.html
      hitMin: 2.2,
      idPrefix: "",               // keeps the ids it has always had (#shape, #dot-pushup…)
      animate: !reducedMotion,
      onHover: canHover ? function (i, e) { showTip(e, i); } : null,
      onHoverEnd: hideTip,
      // Every frame, with the dots: the step numbers and the ghost.
      onPaint: function (chart) {
        AREAS.forEach(function (a, i) { chart.setSub(i, "Step " + state.areas[a.id].step); });
        paintGhost();
      }
    });
    radar.paint(currentRadarVals());
  }

  function paintRadar() { if (radar) radar.paint(); }
  function animateRadar() { if (radar) radar.animateTo(currentRadarVals()); }
  // Data arrived from elsewhere: show it from the next paint on, without
  // animating towards it.
  function jumpRadar() { if (radar) radar.set(currentRadarVals()); }

  var ghostOn = false;
  function paintGhost() {
    if (!radar) return;
    var gs = ghostOn ? ghostSnapshot() : null;
    radar.paintGhost(gs ? gs.v : null);
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

  /* ---------- Tooltip (pointer devices only) ---------- */

  var canHover = window.matchMedia("(hover: hover)").matches;

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

  var STD_DONE = ["No goal done yet", "Beginner goal done", "Intermediate goal done", "All three goals done"];

  // Where each ladder is heading, one line per card.
  function nextLine(p) {
    if (p.mastered) return "<b>Top of the ladder.</b>";
    if (p.readyToAdvance) return "<b>Ready:</b> step " + (p.step + 1) + ", " + esc(p.nextStep.name);
    if (p.goalIdx === 2 && p.step < p.area.steps.length) return "<b>Next:</b> " + esc(prescriptionLine(p)) + ", then step " + (p.step + 1);
    return "<b>Next:</b> " + esc(prescriptionLine(p)) + " for the " + esc(p.goalLabel.toLowerCase()) + " goal";
  }

  function renderSkillNudge() {
    var host = $("#skillNudge");
    if (!host) return;
    var text = skillNudgeText();
    host.innerHTML = text ? '<p class="nudge">' + esc(text) + "</p>" : "";
  }

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
      return '<button class="card" type="button" data-area="' + i + '" style="--area:' + areaColorVar(a) + '">' +
        '<span class="head"><span class="swatch"></span>' + a.icon + " " + esc(shortAreaName(a)) + readyTag + "</span>" +
        '<span class="stepline"><span class="n">' + st.step + '</span><span class="name">' + esc(step.name) + "</span></span>" +
        '<span class="std">' + STD_DONE[st.std] + "</span>" +
        '<span class="track">' + segs + "</span>" +
        '<span class="sk-next">' + nextLine(prescribe(a.id)) + "</span>" +
        "</button>";
    }).join("");
    host.innerHTML = html;
  }

  /* ---------- Tabs: Today · Body · Skills · History ----------
     One page, four panes; the ＋ in the middle of the tab bar opens the log
     picker. Each tab keeps its own scroll position, and tapping the open
     tab scrolls it back to the top. The open tab is remembered for this
     browser session (a Reload from a banner keeps you where you were) —
     never in the URL: sync and progress links use the hash. */

  var TABS = ["today", "body", "skills", "history"];
  var TAB_NAMES = { today: "Today", body: "Body", skills: "Skills", history: "History" };
  var TAB_KEY = "milo.tab";
  var currentTab = null;
  var tabScroll = {};

  var DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function initialTab() {
    try {
      var t = sessionStorage.getItem(TAB_KEY);
      if (TABS.indexOf(t) !== -1) return t;
    } catch (e) { /* no storage */ }
    return "today";
  }

  // Today's title is the date; the others are their names.
  function paintTabTitle() {
    var h = $("#tabTitle");
    if (!h || !currentTab) return;
    if (currentTab === "today") {
      var d = new Date(nowMs());
      h.innerHTML = '<span class="d-long">' + DOW_LONG[d.getDay()] + " " + d.getDate() + " " + MON_LONG[d.getMonth()] + "</span>" +
        '<span class="d-short">' + DOW_SHORT[d.getDay()] + " " + d.getDate() + " " + MON_SHORT[d.getMonth()] + "</span>";
    } else {
      h.textContent = TAB_NAMES[currentTab];
    }
    var b = $("#brandTab");
    if (b) b.textContent = currentTab === "today" ? " · Today" : "";
    document.title = currentTab === "today" ? "Milo" : TAB_NAMES[currentTab] + " · Milo";
  }

  function showTab(t, tapped) {
    if (TABS.indexOf(t) === -1) t = "today";
    if (t === currentTab) {
      if (tapped) window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
      return;
    }
    if (currentTab) tabScroll[currentTab] = window.scrollY;
    currentTab = t;
    TABS.forEach(function (x) {
      var pane = $("#pane-" + x), b = $("#tab-" + x);
      if (pane) pane.hidden = x !== t;
      if (b) { if (x === t) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
    });
    document.documentElement.setAttribute("data-tab", t);
    paintTabTitle();
    hideTip();
    try { sessionStorage.setItem(TAB_KEY, t); } catch (e) { /* no storage */ }
    window.scrollTo(0, tabScroll[t] || 0);
  }

  /* ---------- Shared pieces: dates, set counts, the target bar, day dots ---------- */

  function shortDay(ts) { var d = new Date(ts); return DOW_SHORT[d.getDay()] + " " + d.getDate() + " " + MON_SHORT[d.getMonth()]; }
  function longDay(ts) { var d = new Date(ts); return DOW_LONG[d.getDay()] + " " + d.getDate() + " " + MON_LONG[d.getMonth()]; }
  // "Today", "Yesterday", else "Tue 22 Sep".
  function dayLabel(ts) {
    var k = dateStr(ts), t0 = startOfDay(nowMs());
    if (k === dateStr(t0.getTime())) return "Today";
    if (k === dateStr(addDays(t0, -1).getTime())) return "Yesterday";
    return shortDay(ts);
  }
  function agoPhrase(ts) {
    var d = dayDelta(ts, nowMs());
    return d <= 0 ? "today" : (d === 1 ? "yesterday" : d + " days ago");
  }
  function fmtSets(n) { return TRAINING.fmtSets(n); }
  function setsWord(n) { return fmtSets(n) + (n === 1 ? " set" : " sets"); }
  // "6 chest sets", "3 shoulder sets".
  var SET_WORD = { chest: "chest", back: "back", shoulders: "shoulder", arms: "arm", abs: "abs", legs: "leg" };
  function ico(html) { return '<span class="ico" aria-hidden="true">' + html + "</span>"; }

  // A bar against the group's own target: track 1.25 × the top, the target
  // as a tinted band with two ticks, the sets done in the group's colour, and
  // a small ▴ where an even pace would be by today.
  function tbar(sets, lo, hi, pace) {
    var max = hi * 1.25;
    var p = function (x) { return Math.max(0, Math.min(1, x / max)) * 100; };
    return '<span class="tb" aria-hidden="true"><span class="tb-track"></span>' +
      '<span class="tb-band" style="left:' + p(lo).toFixed(1) + "%;right:" + (100 - p(hi)).toFixed(1) + '%"></span>' +
      (sets > 0 ? '<span class="tb-fill" style="width:' + p(sets).toFixed(1) + '%"></span>' : "") +
      '<span class="tb-tick" style="left:' + p(lo).toFixed(1) + '%"></span><span class="tb-tick" style="left:' + p(hi).toFixed(1) + '%"></span>' +
      (pace ? '<span class="tb-pace" style="left:' + p(pace).toFixed(1) + '%"></span>' : "") + "</span>";
  }
  var TB_LEGEND = '<p class="tb-legend" aria-hidden="true"><span><i class="lg-tband"></i>target</span>' +
    '<span><i class="lg-pace"></i>an even pace by today</span></p>';

  // Six fixed slots, 3 × 2, in the order of the bars: a dot's place says
  // which group it is, not only its colour.
  function slots(groups) {
    return '<span class="slots" aria-hidden="true">' + MODEL.GROUPS.map(function (g) {
      return groups.indexOf(g) !== -1 ? '<i class="on" style="--area:' + groupColorVar(g) + '"></i>' : "<i></i>";
    }).join("") + "</span>";
  }
  function slotKeyHTML() {
    var G = MODEL.GROUPS;
    return '<div class="slot-key" aria-hidden="true">' + slots(G) +
      '<span class="sk-rows"><span>' + G.slice(0, 3).map(groupName).join(" &middot; ") + "</span><span>" +
      G.slice(3).map(groupName).join(" &middot; ") + "</span></span></div>";
  }

  // This week, group by group: sets, target, zone, and where an even pace
  // would be by now. standing: "target" (in the range or above it), "pace"
  // (short of the target but at or past an even pace), or "behind".
  function weekState(now) {
    var rows = TRAINING.weekSummary(state.log, now, state.settings.vol);
    var by = {};
    rows.forEach(function (r) {
      r.pace = TRAINING.pace(r.lo, now);
      r.standing = (r.zone === "on" || r.zone === "above") ? "target" : (r.sets > 0 && r.sets >= r.pace ? "pace" : "behind");
      by[r.group] = r;
    });
    return { rows: rows, by: by };
  }

  // A device with nothing on it yet: no log, every ladder at the start, no sync.
  function untouched() {
    if (state.log.length || syncCfg) return false;
    return AREAS.every(function (a) { return state.areas[a.id].step === 1 && state.areas[a.id].std === 0; });
  }

  /* Per-device flags (localStorage, never synced):
       milo.whatsnew  "show" until "What's new" is dismissed ("done"). Set to
                      "show" only if this device had data before its first
                      launch of this version; a new device never sees it.
       milo.come      "done" once "Coming from another device?" is answered. */
  var WHATSNEW_KEY = "milo.whatsnew", COME_KEY = "milo.come";
  function flag(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function setFlag(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* best effort */ } }

  /* ---------- Today ---------- */

  var renderedDay = null;

  // The Today tab depends on "what did I train today", so it goes stale if the
  // app is left open past midnight (common for an installed home-screen app).
  function refreshIfDayChanged() {
    var k = dateStr(nowMs());
    if (!renderedDay || k === renderedDay) return;
    refresh();
    // An open gym-day sheet keeps the day it was started on; redrawn, its
    // chips say what that day now is ("Yesterday"), so Save can't surprise.
    var top = uiStack[uiStack.length - 1];
    if (top && top.t === "quick" && quickDraft) { readQuickInputs(); renderSheet(); }
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshIfDayChanged();
  });
  window.addEventListener("focus", refreshIfDayChanged);

  function renderToday() {
    var host = $("#today");
    if (!host) return;
    var now = nowMs();
    renderedDay = dateStr(now);
    paintTabTitle();
    var ws = weekState(now), fresh = untouched(), parts = [];
    if (fresh && flag(COME_KEY) !== "done") parts.push(comeCardHTML());
    if (!fresh) parts.push(todayNudgeHTML(ws, now));
    parts.push(routineOn() ? sessionCardHTML() : setupCardHTML());
    if (flag(WHATSNEW_KEY) === "show" && !fresh) parts.push(whatsNewLineHTML());
    parts.push(state.log.some(isTraining) ? weekCardHTML(ws, now) : weekEmptyHTML());
    host.innerHTML = parts.join("");
    wireToday(host);
  }

  function todaysPlan() {
    if (!routineOn()) return [];
    var sessions = routineSessions();
    return sessions[state.routine.sessionIndex % sessions.length].map(prescribe);
  }

  // The one nudge, about muscle groups (TRAINING.groupNudge). When today's
  // session trains that group, it says so and the session card is the
  // action; otherwise the nudge opens the group's sheet.
  function todayNudgeHTML(ws, now) {
    var n = TRAINING.groupNudge(state.log, now, state.settings.vol);
    if (!n || !Object.prototype.hasOwnProperty.call(GROUP_INFO, n.group)) return "";
    var g = n.group, r = ws.by[g], text;
    if (n.kind === "untrained") {
      text = n.days == null
        ? (r.sets > 0 ? "no day with a full hard set yet, and " + fmtSets(r.sets) + " of " + r.lo + " sets so far this week." : "no hard sets for them yet.")
        : "last trained " + n.days + " days ago, and " + fmtSets(r.sets) + " of " + r.lo + " sets so far this week.";
    } else {
      text = fmtSets(n.sets) + " of " + n.lo + " sets, with " + n.daysLeft + (n.daysLeft === 1 ? " day" : " days") + " left this week.";
    }
    var plan = todaysPlan(), idx = -1;
    if (!plan.every(function (p) { return p.done; })) {
      plan.forEach(function (p, i) {
        if (idx !== -1 || p.done) return;
        var w = TRAINING.setWeights(p.areaId, p.step, "");
        if (w[g] >= 1) idx = i;
      });
    }
    var inner = '<span class="swatch"></span><span class="nd-text"><b>' + esc(groupName(g)) + ":</b> " + esc(text) +
      (idx !== -1 ? " Today&#8217;s session " + (idx === 0 ? "starts with " : "includes ") + esc(shortAreaName(plan[idx].area).toLowerCase()) + "." : "") + "</span>";
    return idx !== -1
      ? '<p class="nudge gnudge" style="--area:' + groupColorVar(g) + '">' + inner + "</p>"
      : '<button class="nudge gnudge" type="button" data-group="' + g + '" style="--area:' + groupColorVar(g) + '">' + inner +
        '<span class="chev" aria-hidden="true">&#8250;</span></button>';
  }

  function sessionCardHTML() {
    var sessions = routineSessions();
    var idx = state.routine.sessionIndex % sessions.length;
    var plan = todaysPlan();
    var allDone = plan.every(function (p) { return p.done; });
    var leftToDo = plan.filter(function (p) { return !p.done; });
    var rows = plan.map(function (p) {
      return '<button class="td-move' + (p.done ? " done" : "") + '" type="button" data-area="' + p.areaIdx + '" style="--area:' + areaColorVar(p.area) + '">' +
        '<span class="tdcheck">' + (p.done ? "&#10003;" : "") + "</span>" +
        '<span class="tdinfo"><span class="tdname">' + p.area.icon + " " + esc(p.stepObj.name) + "</span>" +
        '<span class="tdstep">' + esc(prescriptionLine(p)) + " &middot; " + esc(goalPhrase(p)) + "</span>" +
        (p.readyToAdvance ? '<span class="tdready">Ready for Step ' + (p.step + 1) + " &#8212; " + esc(p.nextStep.name) + "</span>" : "") +
        "</span>" +
        '<span class="chev">&#8250;</span></button>';
    }).join("");
    var mins = sessionMinutes(leftToDo.length ? leftToDo : plan);
    return '<div class="today-card session">' +
      '<div class="today-head"><h2 class="today-title">Today&#8217;s session</h2>' +
      '<button class="ws-link" id="weekBtn" type="button">Week plan &#8250;</button></div>' +
      '<p class="today-sub ses-sub">Day ' + (idx + 1) + " of your " + sessions.length + "-day routine" +
      (allDone ? " &middot; done" : " &middot; about " + mins + " min") + "</p>" +
      '<div class="td-moves">' + rows + "</div>" +
      (allDone
        ? '<button class="btn primary wide" id="nextSessionBtn" type="button">Session done &#8212; queue the next one &#8594;</button>'
        : '<button class="btn primary wide" id="startSessionBtn" type="button">&#9654; Start session</button>' +
          '<button class="linkbtn skip" id="skipSessionBtn" type="button">Skip to next session</button>') +
      "</div>";
  }

  // "intermediate goal", or for the third one "last goal before step 6".
  function goalPhrase(p) {
    if (p.goalIdx === 2 && p.step < p.area.steps.length) return "last goal before step " + (p.step + 1);
    return p.goalLabel.toLowerCase() + " goal";
  }

  function setupCardHTML() {
    return '<button class="today-card setup" id="setupRoutineBtn" type="button">' +
      '<span class="today-title">&#43; Set up a weekly routine</span>' +
      '<span class="today-sub">Get a &#8220;today&#8217;s session&#8221; plan across your week.</span></button>';
  }

  function whatsNewLineHTML() {
    return '<div class="today-card wnline">' +
      '<button class="wn-open" id="whatsNewBtn" type="button">' + ico("&#10024;") +
      '<span class="wn-text"><b>Milo has tabs now.</b> See what&#8217;s new</span><span class="chev" aria-hidden="true">&#8250;</span></button>' +
      '<button class="nc-x" id="whatsNewX" type="button" aria-label="Hide what&#8217;s new">&#10005;</button></div>';
  }

  function comeCardHTML() {
    return '<div class="today-card comecard">' +
      '<h2 class="today-title">Coming from another device?</h2>' +
      '<p class="cc-text">Bring your workouts and skill steps over: connect sync, or restore a backup file.</p>' +
      '<div class="cc-btns"><button class="btn primary" id="comeSyncBtn" type="button">Connect sync</button>' +
      '<button class="btn" id="comeRestoreBtn" type="button">Restore a backup</button></div>' +
      '<button class="linkbtn" id="comeNoBtn" type="button">No, I&#8217;m starting fresh</button></div>';
  }

  function weekEmptyHTML() {
    return '<div class="today-card wk"><h2 class="today-title">This week</h2>' +
      '<p class="wk-empty">Nothing logged yet. Tap <b>&#65291; Log</b> below after a workout: a quick gym log or a skill session. Both count.</p></div>';
  }

  function weekCardHTML(ws, now) {
    var days = TRAINING.weekStrip(state.log, now).map(function (d) {
      var hidden = '<span class="visually-hidden">' + esc(longDay(d.ts)) + (d.today ? ", today" : "") +
        (d.groups.length ? ": " + d.groups.map(groupName).join(", ") : (d.future ? "" : (d.trained ? ": trained" : ": nothing logged"))) + "</span>";
      var inner = '<span class="ws-wd" aria-hidden="true">' + DOW_SHORT[new Date(d.ts).getDay()].charAt(0) + "</span>" +
        '<span class="ws-n" aria-hidden="true">' + new Date(d.ts).getDate() + "</span>" + slots(d.groups) + hidden;
      var cls = "ws-day" + (d.today ? " today" : "") + (d.future ? " future" : "");
      return "<li>" + (d.trained
        ? '<button class="' + cls + '" type="button" data-day="' + d.key + '">' + inner + "</button>"
        : '<span class="' + cls + '">' + inner + "</span>") + "</li>";
    }).join("");
    var rows = ws.rows.map(function (r) {
      var num = r.sets === 0 ? '<span class="tr-num none" aria-hidden="true">none yet</span>'
        : '<span class="tr-num" aria-hidden="true">' + (r.standing === "target" ? "&#10003; " : "") + "<b>" + esc(fmtSets(r.sets)) + "</b>/" + r.lo + "&#8211;" + r.hi + "</span>";
      return '<li class="tr st-' + r.standing + '" style="--area:' + groupColorVar(r.group) + '">' +
        '<span class="visually-hidden">' + esc(groupName(r.group) + ": " + setsWord(r.sets) + " of a " + r.lo + " to " + r.hi + " target, " +
          (r.standing === "target" ? "on target." : r.standing === "pace" ? "on pace." : "behind pace.")) + "</span>" +
        '<span class="tr-name" aria-hidden="true"><span class="swatch"></span>' + esc(groupName(r.group)) + "</span>" +
        tbar(r.sets, r.lo, r.hi, r.pace) + num + "</li>";
    }).join("");
    var n = TRAINING.workoutsInWeek(state.log, now);
    return '<div class="today-card wk">' +
      '<div class="wk-head"><div><h2 class="today-title">This week</h2>' +
      '<span class="today-sub">' + esc(TRAINING.weekLabel(now, true)) + " &middot; " + n + (n === 1 ? " workout" : " workouts") + " so far</span></div>" +
      '<button class="ws-link" id="toBodyBtn" type="button">Body &#8250;</button></div>' +
      '<ol class="ws-days" aria-label="This week, Monday to Sunday">' + days + "</ol>" + slotKeyHTML() +
      '<h3 class="wk-sub">Hard sets per muscle group</h3>' +
      '<ul class="tr-list" aria-label="Hard sets this week, by muscle group">' + rows + "</ul>" + TB_LEGEND + "</div>";
  }

  function wireToday(host) {
    host.querySelectorAll(".td-move").forEach(function (b) {
      b.addEventListener("click", function () { openCurrentStep(Number(b.getAttribute("data-area"))); });
    });
    var ns = $("#nextSessionBtn", host);
    if (ns) ns.addEventListener("click", function () {
      setPref("sessionIndex", (state.routine.sessionIndex + 1) % routineSessions().length);
      saveState();
      renderToday();
      toast("Next session ready");
    });
    var skip = $("#skipSessionBtn", host);
    if (skip) skip.addEventListener("click", function () {
      var was = state.routine.sessionIndex;
      setPref("sessionIndex", (was + 1) % routineSessions().length);
      saveState();
      renderToday();
      var undo = toastAction("Next session ready", "Undo", function () {
        setPref("sessionIndex", was);
        saveState();
        renderToday();
      });
      try { undo.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    });
    var on = function (id, fn) { var b = $(id, host); if (b) b.addEventListener("click", fn); };
    on("#setupRoutineBtn", openSettings);
    on("#startSessionBtn", openSession);
    on("#weekBtn", openWeek);
    on("#toBodyBtn", function () { showTab("body", true); });
    on("#whatsNewBtn", function () { pushView({ t: "whatsnew" }); });
    on("#whatsNewX", function () { setFlag(WHATSNEW_KEY, "done"); renderToday(); restoreFocus(null, ""); });
    on("#comeSyncBtn", openSettings);
    on("#comeRestoreBtn", openSettings);
    on("#comeNoBtn", function () { setFlag(COME_KEY, "done"); renderToday(); });
    host.querySelectorAll("[data-group]").forEach(function (b) {
      b.addEventListener("click", function () { openGroup(b.getAttribute("data-group")); });
    });
    host.querySelectorAll("[data-day]").forEach(function (b) {
      b.addEventListener("click", function () { openDay(b.getAttribute("data-day")); });
    });
  }

  /* ---------- Body: this week's six muscle groups ---------- */

  var BODY_AXES = ["chest", "back", "abs", "legs", "arms", "shoulders"];   // the Skills radar's slots
  var bodyChart = null, bodyChartShare = null;

  function openGroup(g) {
    if (!Object.prototype.hasOwnProperty.call(GROUP_INFO, g)) return;
    pushView({ t: "group", x: g });
  }

  function zoneText(r) {
    if (r.zone === "none") return "None this week";
    return (r.zone === "on" ? "&#10003; " : "") + esc(TRAINING.ZONE_LABELS[r.zone]) +
      (r.standing === "target" ? "" : (r.standing === "pace" ? " &middot; on pace" : " &middot; behind pace"));
  }
  function deltaText(sets, before) {
    var d = sets - before;
    if (d === 0) return "Same as this point last week";
    return (d > 0 ? "+" + fmtSets(d) : "&minus;" + fmtSets(-d)) + " vs this point last week";
  }

  // The ladders that train a group, as Body's rows name them: the ones whose
  // main job it is ("💪 Pushups, step 5"), or else the ones that help.
  function feedLine(g) {
    var main = TRAINING.mainFeeders(g);
    if (main.length) {
      return main.map(function (id) {
        var a = AREAS[areaIndexById(id)];
        return '<span class="nw">' + ico(a.icon) + esc(shortAreaName(a)) + ", step " + state.areas[id].step + "</span>";
      }).join(" &middot; ");
    }
    var helpers = TRAINING.feedersAt(g, state.areas).filter(function (f) { return !f.main && f.weight > 0; });
    return helpers.length ? "Helped by " + helpers.map(function (f) { return esc(shortAreaName(AREAS[areaIndexById(f.areaId)])); }).join(", ") : "";
  }

  function verdictHTML(ws) {
    var of = function (k) { return MODEL.GROUPS.filter(function (g) { return ws.by[g].standing === k; }); };
    var behind = of("behind").sort(function (a, b) { return ws.by[a].sets / ws.by[a].lo - ws.by[b].sets / ws.by[b].lo; });
    var part = function (label, list) {
      return list.length ? "<span><b>" + label + ":</b> " + list.map(function (g) { return esc(groupName(g)); }).join(", ") + ".</span> " : "";
    };
    return '<p class="verdict">' + part("On target", of("target")) + part("On pace", of("pace")) + part("Behind", behind) + "</p>";
  }

  function bodyRowHTML(g, ws, before, now) {
    var r = ws.by[g], last = TRAINING.lastTrained(state.log, g, now), feed = feedLine(g);
    return '<button class="card grow st-' + r.standing + " z-" + r.zone + '" type="button" data-group="' + g + '" style="--area:' + groupColorVar(g) + '">' +
      '<span class="gr-top"><span class="gr-name"><span class="swatch"></span>' + esc(groupName(g)) + "</span>" +
      '<span class="gr-num"><b>' + esc(fmtSets(r.sets)) + "</b> / " + r.lo + "&#8211;" + r.hi + '<span class="visually-hidden"> hard sets</span></span>' +
      '<span class="chev" aria-hidden="true">&#8250;</span></span>' +
      tbar(r.sets, r.lo, r.hi, r.pace) +
      '<span class="gr-status"><span class="gr-zone">' + zoneText(r) + '</span><span class="gr-delta">' + deltaText(r.sets, before[g] || 0) + "</span></span>" +
      '<span class="gr-meta">' + (last ? "Last trained " + agoPhrase(last) : (r.sets > 0 ? "No day with a full hard set yet" : "Not trained yet")) +
      (feed ? " &middot; " + feed : "") + "</span></button>";
  }

  function bodyEmptyHTML() {
    var t = TRAINING.targets(state.settings.vol);
    var rows = MODEL.GROUPS.map(function (g) {
      return '<div class="stdrow"><span class="lb"><span class="swatch" style="--area:' + groupColorVar(g) + '"></span>' + esc(groupName(g)) +
        "</span><strong>" + t[g][0] + "&#8211;" + t[g][1] + " sets</strong></div>";
    }).join("");
    return '<div class="today-card bodyempty">' +
      '<h3 class="today-title">Your six muscle groups, week by week</h3>' +
      "<p>Each week Body adds up the hard sets you log for chest, back, shoulders, arms, abs and legs, and shows how close each one is to its target. Quick gym logs and skill sessions both count.</p>" +
      '<div class="stdtable">' + rows + "</div>" +
      '<p class="hint">You can change the targets in Settings.</p>' +
      '<button class="btn primary wide" id="bodyLogBtn" type="button">&#65291; Log a workout</button></div>';
  }

  function renderBody() {
    var top = $("#bodyTop");
    if (!top) return;
    var now = nowMs(), ws = weekState(now);
    var dayN = dayDelta(TRAINING.weekStart(now), now) + 1;
    var head = '<div class="bd-head"><h2 class="today-title">This week &middot; ' + esc(TRAINING.weekLabel(now, true)) +
      '<button class="infobtn" id="bodyInfoBtn" type="button" aria-label="How the week is counted">&#9432;</button></h2>' +
      '<span class="today-sub">Hard sets per muscle group &middot; ' + DOW_LONG[new Date(now).getDay()] + ", day " + dayN + " of 7</span></div>";
    var balance = $("#bodyBalance");
    if (!state.log.some(isTraining)) {
      top.innerHTML = head + bodyEmptyHTML();
      if (balance) balance.hidden = true;
    } else {
      var before = TRAINING.lastWeekToDate(state.log, now);
      top.innerHTML = head + verdictHTML(ws) +
        '<div class="grows">' + MODEL.GROUPS.map(function (g) { return bodyRowHTML(g, ws, before, now); }).join("") + "</div>" + TB_LEGEND;
      if (balance) balance.hidden = false;
      paintBodyRadar(ws, before, now);
    }
    var info = $("#bodyInfoBtn", top);
    if (info) info.addEventListener("click", openVolInfo);
    var lg = $("#bodyLogBtn", top);
    if (lg) lg.addEventListener("click", openLogPick);
    top.querySelectorAll("[data-group]").forEach(function (b) {
      b.addEventListener("click", function () { openGroup(b.getAttribute("data-group")); });
    });
  }

  // The balance radar: each spoke is sets ÷ the top of that group's own
  // target, so one band is every group's target; more than the top sits on
  // the outer ring. Dashed: last week up to the same weekday.
  function paintBodyRadar(ws, before, now) {
    var svg = $("#bodyRadar");
    if (!svg || typeof RADAR === "undefined") return;
    var t = TRAINING.targets(state.settings.vol);
    var loShare = t.chest[0] / t.chest[1];
    var share = function (g, v) { return TRAINING.radarShare(v, t[g][1]); };
    // The band and the rings around it depend on the targets: when those
    // change (here or on another device), draw the chart afresh.
    if (bodyChart && bodyChartShare !== loShare) { bodyChart.destroy(); bodyChart = null; }
    if (!bodyChart) {
      bodyChartShare = loShare;
      bodyChart = RADAR.make(svg, {
        axes: BODY_AXES.map(function (g) {
          return {
            id: g, label: groupName(g), sub: "", color: groupColorVar(g),
            onLabel: function (i) { openGroup(BODY_AXES[i]); },
            labelAria: "Open " + groupName(g)
          };
        }),
        max: 1,
        rings: [0.25, 0.5, 0.75].filter(function (f) { return Math.abs(f - loShare) > 0.02; }),
        band: [loShare, 1],
        cx: 200, cy: 178, r: 110,
        labelGap: 14, labelLine: 17, labelUp: 21,
        ghostStyle: "dashed",
        hideEmpty: true,
        animate: !reducedMotion,
        ariaLabel: "Balance of the six muscle groups this week"
      });
    }
    bodyChart.setSubs(BODY_AXES.map(function (g) { return setsWord(ws.by[g].sets); }));
    BODY_AXES.forEach(function (g, i) { bodyChart.setAria(i, groupName(g) + ": " + setsWord(ws.by[g].sets) + ". Open " + groupName(g)); });
    bodyChart.paint(BODY_AXES.map(function (g) { return share(g, ws.by[g].sets); }));
    bodyChart.paintGhost(BODY_AXES.map(function (g) { return share(g, before[g] || 0); }));
    var lgd = $("#bodyLegend");
    if (lgd) lgd.innerHTML = '<span><i class="lg-band"></i>Target</span><span><i class="lg-now"></i>This week</span>' +
      '<span><i class="lg-ghost"></i>Last week by ' + DOW_LONG[new Date(now).getDay()] + "</span>";
  }

  /* ---------- A muscle group's sheet ---------- */

  // One row per thing that counted this week, newest first
  // (TRAINING.breakdown: the rows add up exactly to the bar). A quick gym log
  // gives a row per group logged in it that counts for g ("6 chest sets,
  // helping" at ¼).
  function countedRows(g, now) {
    return TRAINING.breakdown(state.log, now, g).map(function (r) {
      var e = r.entry;
      if (!e.kind) {
        var a = AREAS[areaIndexById(e.areaId)], step = a ? a.steps[e.step - 1] : null;
        return { name: e.variant || (step ? step.name : ""), mult: r.weight, v: r.sets,
          sub: shortDay(e.ts) + (a ? " &middot; " + esc(shortAreaName(a)) + " step " + e.step : "") + " &middot; " + esc(setsWord(r.logged)) };
      }
      return { name: "Quick gym log", mult: r.weight, v: r.sets,
        sub: shortDay(e.ts) + " &middot; " + r.logged + " " + SET_WORD[r.listed] + (r.logged === 1 ? " set" : " sets") + (r.own ? "" : ", helping") };
    });
  }

  var MULT_TEXT = { 1: "full", 0.5: "&frac12;", 0.25: "&frac14;" };

  function eightWeeksSVG(g, weeks, lo, hi) {
    var vals = weeks.map(function (w) { return w.sets[g] || 0; });
    var max = Math.max(hi * 1.25, Math.max.apply(null, vals));
    var W = 300, L = 24, B = 124, TOPY = 18, slot = (W - L) / weeks.length, bw = 20;
    var y = function (v) { return B - (B - TOPY) * v / max; };
    var s = '<rect class="band" x="' + L + '" y="' + y(hi).toFixed(1) + '" width="' + (W - L) + '" height="' + (y(lo) - y(hi)).toFixed(1) + '"/>' +
      '<line class="band-edge" x1="' + L + '" x2="' + W + '" y1="' + y(hi).toFixed(1) + '" y2="' + y(hi).toFixed(1) + '"/>' +
      '<line class="band-edge" x1="' + L + '" x2="' + W + '" y1="' + y(lo).toFixed(1) + '" y2="' + y(lo).toFixed(1) + '"/>' +
      '<text class="tick" x="' + (L - 5) + '" y="' + (y(hi) + 4).toFixed(1) + '" text-anchor="end">' + hi + "</text>" +
      '<text class="tick" x="' + (L - 5) + '" y="' + (y(lo) + 4).toFixed(1) + '" text-anchor="end">' + lo + "</text>";
    weeks.forEach(function (w, i) {
      var x = L + slot * i + (slot - bw) / 2, v = vals[i], now = i === weeks.length - 1;
      if (v > 0) {
        var top = y(v), r = Math.min(4, B - top);
        s += '<path class="bar' + (now ? " now" : "") + '" d="M' + x.toFixed(1) + "," + B + " V" + (top + r).toFixed(1) +
          " Q" + x.toFixed(1) + "," + top.toFixed(1) + " " + (x + r).toFixed(1) + "," + top.toFixed(1) +
          " H" + (x + bw - r).toFixed(1) + " Q" + (x + bw).toFixed(1) + "," + top.toFixed(1) + " " + (x + bw).toFixed(1) + "," + (top + r).toFixed(1) +
          " V" + B + ' Z"><title>Week of ' + esc(shortDay(w.start)) + ": " + esc(setsWord(v)) + "</title></path>";
      }
      if (now) s += '<text class="vlbl" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y(v) - 5).toFixed(1) + '" text-anchor="middle">' + esc(fmtSets(v)) + "</text>";
      var d = new Date(w.start);
      var lbl = now ? "now" : (i % 2 === 0 ? d.getDate() + " " + MON_SHORT[d.getMonth()] : "");
      if (lbl) s += '<text class="tick' + (now ? " nowlbl" : "") + '" x="' + (x + bw / 2).toFixed(1) + '" y="' + (B + 16) + '" text-anchor="middle">' + lbl + "</text>";
    });
    s += '<line class="base" x1="' + L + '" y1="' + B + '" x2="' + W + '" y2="' + B + '"/>';
    var aria = "Hard sets for " + groupName(g) + " in each of the last " + weeks.length + " weeks: " + weeks.map(function (w, i) {
      return (i === weeks.length - 1 ? "this week so far " : "week of " + shortDay(w.start) + " ") + fmtSets(vals[i]);
    }).join(", ");
    return '<svg viewBox="0 0 ' + W + ' 146" role="img" aria-label="' + esc(aria) + '">' + s + "</svg>";
  }

  function groupPaneHTML(g) {
    var now = nowMs(), ws = weekState(now), r = ws.by[g], info = GROUP_INFO[g];
    var before = TRAINING.lastWeekToDate(state.log, now);
    var rows = countedRows(g, now);
    var mixed = rows.some(function (x) { return x.mult !== 1; });
    var table = rows.length
      ? '<div class="cnt' + (mixed ? " mixed" : "") + '">' + rows.map(function (x) {
          return '<div class="cnt-row"><span class="cnt-what"><span class="cnt-name">' + esc(x.name) + '</span><span class="cnt-sub">' + x.sub + "</span></span>" +
            (mixed ? '<span class="cnt-x">' + (MULT_TEXT[x.mult] || esc(fmtSets(x.mult))) + "</span>" : "") +
            '<span class="cnt-v">' + esc(fmtSets(x.v)) + "</span></div>";
        }).join("") +
        '<div class="cnt-row cnt-total"><span class="cnt-what"><span class="cnt-name">This week</span></span>' + (mixed ? "<span></span>" : "") +
        '<span class="cnt-v">' + esc(fmtSets(r.sets)) + "</span></div></div>" +
        (mixed ? '<p class="hint"><b>full</b>: the group the exercise is for &middot; <b>&frac12;</b>: a helper in a skill set &middot; <b>&frac14;</b>: a helper in a quick gym log.</p>' : "")
      : '<p class="empty-line">Nothing counted for ' + esc(info.name.toLowerCase()) + " yet this week.</p>";
    var weeks = TRAINING.weekHistory(state.log, now, 8);
    var chart;
    if (state.log.some(isTraining)) {
      var prior = weeks.slice(0, -1);
      var onT = prior.filter(function (w) { return (w.sets[g] || 0) >= r.lo; }).length;
      chart = '<div class="wk8" style="--area:' + groupColorVar(g) + '">' + eightWeeksSVG(g, weeks, r.lo, r.hi) + "</div>" +
        '<p class="hint wk8-cap">Shaded: the target, ' + r.lo + "&#8211;" + r.hi + " sets. The lighter bar is this week so far. Last week " +
        esc(fmtSets(prior.length ? (prior[prior.length - 1].sets[g] || 0) : 0)) + "; on target in " + onT + " of the " + prior.length + " weeks before this one.</p>";
    } else {
      chart = '<p class="empty-line">Your last 8 weeks appear here once you&#8217;ve logged a few.</p>';
    }
    var feeds = TRAINING.feedersAt(g, state.areas).map(function (f) {
      var ai = areaIndexById(f.areaId), a = AREAS[ai], step = a.steps[f.step - 1];
      var what = (f.weight ? "each set counts " + (f.weight === 1 ? "1" : fmtSets(f.weight)) + " for " + esc(info.name.toLowerCase()) + "."
        : "not for " + esc(info.name.toLowerCase()) + " at this step.") +
        (f.fromStep ? " From step " + f.fromStep + ": " + (f.fromWeight === 1 ? "1" : esc(fmtSets(f.fromWeight))) + "." : "");
      return '<button class="librow" type="button" data-area="' + ai + '" style="--area:' + areaColorVar(a) + '">' +
        '<span class="libicon" aria-hidden="true">' + a.icon + '</span><span class="libinfo"><span class="libname">' + esc(shortAreaName(a)) + " &middot; step " + f.step + "</span>" +
        '<span class="libsub">' + esc(step.name) + ": " + what + "</span></span>" +
        '<span class="chev" aria-hidden="true">&#8250;</span></button>';
    }).join("");
    var goal = r.sets ? zoneText(r) + " &middot; " + deltaText(r.sets, before[g] || 0).replace(/^Same/, "same")
      : "None yet this week &middot; the target is " + r.lo + "&#8211;" + r.hi;
    return sheetHead({
      title: '<span class="swatch" style="--area:' + groupColorVar(g) + '"></span>' + esc(info.name),
      sub: esc(info.muscles.charAt(0).toUpperCase() + info.muscles.slice(1)) + " &middot; " + r.lo + "&#8211;" + r.hi + " sets a week"
    }) +
      '<div class="sheet-body groupsheet" style="--area:' + groupColorVar(g) + '">' +
      '<div class="rx gs-sum"><span class="rxlabel">This week &middot; ' + esc(TRAINING.weekLabel(now, true)) + "</span>" +
      '<span class="rxbig">' + esc(fmtSets(r.sets)) + (r.sets === 1 ? " hard set" : " hard sets") + "</span>" +
      tbar(r.sets, r.lo, r.hi, r.pace) +
      '<span class="rxgoal st-' + r.standing + '">' + goal + "</span></div>" +
      "<h4>What counted this week</h4>" + table +
      "<h4>Last 8 weeks</h4>" + chart +
      "<h4>Skills that train it</h4>" + '<div class="librows">' + feeds + "</div>" +
      "</div>" +
      '<div class="sheet-foot"><button class="btn primary wide" id="groupLogBtn" type="button">&#65291; Log ' + SET_WORD[g] + " sets</button></div>";
  }

  function openVolInfo() { pushView({ t: "volinfo" }); }

  // The ⓘ: what a hard set is, why helpers count half, and the targets.
  function volInfoPaneHTML() {
    var t = TRAINING.targets(state.settings.vol);
    var targetRows = MODEL.GROUPS.map(function (g) {
      return '<div class="stdrow"><span class="lb"><span class="swatch" style="--area:' + groupColorVar(g) + '"></span>' +
        esc(groupName(g)) + "</span><strong>" + t[g][0] + "&#8211;" + t[g][1] + " sets</strong></div>";
    }).join("");
    // Spelled out with the base range's numbers (chest's: never scaled).
    var lo = t.chest[0], hi = t.chest[1];
    var zoneRows = [
      ["Low", "fewer than " + TRAINING.fmtSets(lo / 2)],
      ["Building", TRAINING.fmtSets(lo / 2) + " up to " + lo],
      ["On target", lo + "&#8211;" + hi],
      ["Above target", "more than " + hi]
    ].map(function (z) {
      return '<div class="stdrow"><span class="lb">' + z[0] + "</span><span>" + z[1] + "</span></div>";
    }).join("");
    return sheetHead({ title: "How the week is counted", sub: "This week &middot; " + esc(TRAINING.weekLabel(nowMs())), back: true, backLabel: "Home" }) +
      '<div class="sheet-body volinfo">' +
      "<h4>Hard sets</h4>" +
      "<p>A hard set is a working set you finish close to your limit &mdash; two or three more reps at most. Warm-ups and easy sets don&#8217;t count.</p>" +
      "<h4>Helpers count half</h4>" +
      "<p>Most exercises work one main group and get help from others. The main group gets the whole set, each helper gets &frac12;. One set of push-ups is 1 for chest, &frac12; for arms and &frac12; for shoulders.</p>" +
      "<p>A quick gym log has only the main groups, so helpers get a smaller share: &frac14; per set. Four chest sets also add 1 to arms and 1 to shoulders.</p>" +
      "<h4>Weekly targets</h4>" +
      "<p>10&#8211;20 hard sets a week is a range most people grow well in. Arms and legs are several muscles each, so their range is doubled.</p>" +
      '<div class="stdtable">' + targetRows + "</div>" +
      "<h4>The zones</h4>" +
      '<div class="stdtable">' + zoneRows + "</div>" +
      "<p>For arms and legs, double each number. Above the range now and then is fine. Week after week, extra sets tend to cost more recovery than they give back.</p>" +
      "<h4>The week</h4>" +
      "<p>Weeks run Monday to Sunday. The bars start again from zero every Monday.</p>" +
      "</div>";
  }

  /* ---------- Quick gym log: working sets per muscle group ----------

     One log entry { kind: "quick", groups: { group: sets } } for a whole
     gym day. The same sheet edits an existing one (opened from History).
     Toggles and steppers update in place rather than re-rendering, so
     focus stays on the control you just used. */

  var QUICK_DEFAULT_SETS = 4;          // P6: the plan's number for that group
  var DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var quickDraft = null;

  function quickDays() {
    var t = startOfDay(nowMs());
    return {
      today: dateStr(t.getTime()),
      yesterday: dateStr(addDays(t, -1).getTime()),
      before: dateStr(addDays(t, -2).getTime())
    };
  }

  // When a quick entry happened: now if it's for today, else midday of that
  // day (clear of midnight and of daylight-saving jumps, which are at night).
  function quickTs(key) {
    if (key === dateStr(nowMs())) return nowMs();
    var d = new Date(dateFromKey(key));
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  }

  function clampSets(v, fallback) {
    if (v === "" || v == null) return fallback;
    var n = Math.round(Number(v));
    return isFinite(n) ? Math.min(50, Math.max(1, n)) : fallback;
  }

  // id: an existing quick entry to edit, or nothing for a new one.
  // id: a quick gym log to edit, or nothing for a new one. group: a muscle
  // group to start ticked (opened from that group's sheet).
  function openQuick(id, group) {
    var e = null;
    if (id) state.log.forEach(function (x) { if (x.id === id && x.kind === "quick") e = x; });
    if (id && !e) return;
    var k = quickDays();
    var date = e ? dateStr(e.ts) : k.today;
    quickDraft = {
      editId: e ? e.id : null,
      date: date,
      pick: date !== k.today && date !== k.yesterday,
      on: {}, sets: {},
      note: e ? e.note : ""
    };
    MODEL.GROUPS.forEach(function (g) {
      var n = e ? e.groups[g] : 0;
      quickDraft.on[g] = !!n || (!e && g === group);
      quickDraft.sets[g] = n || QUICK_DEFAULT_SETS;
    });
    pushView({ t: "quick", x: e ? e.id : undefined });
  }

  // Which day chip a draft's date is, right now.
  function quickMode(d) {
    var k = quickDays();
    return d.pick ? "pick" : (d.date === k.today ? "today" : (d.date === k.yesterday ? "yesterday" : "pick"));
  }

  function quickAnyOn() {
    return MODEL.GROUPS.some(function (g) { return quickDraft.on[g]; });
  }

  function quickSummary() {
    var groups = 0, sets = 0;
    MODEL.GROUPS.forEach(function (g) { if (quickDraft.on[g]) { groups++; sets += quickDraft.sets[g]; } });
    if (!groups) return "Pick at least one group to save.";
    return groups + (groups === 1 ? " group" : " groups") + " &middot; " + sets + (sets === 1 ? " set" : " sets");
  }

  function quickPaneHTML() {
    if (!quickDraft) openQuickDraftOnly();
    var d = quickDraft, k = quickDays(), editing = !!d.editId;
    var mode = quickMode(d);
    d.shown = mode;
    var chip = function (m, label) {
      return '<button type="button" class="chip qday' + (mode === m ? " sel" : "") + '" data-day="' + m +
        '" aria-pressed="' + (mode === m ? "true" : "false") + '">' + label + "</button>";
    };
    var rows = MODEL.GROUPS.map(function (g) {
      var on = !!d.on[g], n = d.sets[g], name = groupName(g), lower = esc(name.toLowerCase());
      return '<li class="qrow' + (on ? " on" : "") + '" data-g="' + g + '" style="--area:' + groupColorVar(g) + '">' +
        '<button type="button" class="qtoggle" aria-pressed="' + (on ? "true" : "false") + '">' +
          '<span class="qcheck" aria-hidden="true">' + (on ? "&#10003;" : "") + "</span>" +
          '<span class="qname">' + esc(name) + "</span></button>" +
        '<span class="stepper"' + (on ? "" : " hidden") + ">" +
          '<button type="button" class="stepbtn" data-step="-1" aria-label="Fewer ' + lower + ' sets" aria-disabled="' + (n <= 1) + '">&#8722;</button>' +
          '<input class="stepval" type="number" inputmode="numeric" min="1" max="50" step="1" value="' + n + '" aria-label="' + esc(name) + ' working sets">' +
          '<button type="button" class="stepbtn" data-step="1" aria-label="More ' + lower + ' sets" aria-disabled="' + (n >= 50) + '">&#43;</button>' +
        "</span></li>";
    }).join("");

    return sheetHead({
      title: editing ? "Edit quick gym log" : "Quick gym log",
      sub: esc(prettyDate(quickTs(d.date))),
      back: true,
      backLabel: "Cancel"
    }) +
      '<div class="sheet-body quickpane" style="--area:var(--accent)">' +
      "<h4>Day</h4>" +
      '<div class="chips" role="group" aria-label="Day">' + chip("today", "Today") + chip("yesterday", "Yesterday") + chip("pick", "Pick a day") + "</div>" +
      (mode === "pick"
        ? '<label class="visually-hidden" for="quickDate">Day you trained</label>' +
          '<input type="date" id="quickDate" class="qdate" value="' + esc(d.date) + '" min="2000-01-01" max="' + k.today + '">'
        : "") +
      '<h4 id="qgLabel">Working sets per muscle group</h4>' +
      '<p class="hint qhint">Tap what you trained. Hard sets only, no warm-ups.</p>' +
      '<ul class="qgroups" aria-labelledby="qgLabel">' + rows + "</ul>" +
      '<p class="hint qsum" id="quickSum">' + quickSummary() + "</p>" +
      "<h4>Note (optional)</h4>" +
      '<textarea id="quickNote" class="lognote" rows="2" maxlength="280" aria-label="Note (optional)" placeholder="Exercises, weights, how it felt">' + esc(d.note || "") + "</textarea>" +
      (editing ? '<button type="button" class="btn danger wide qdel" id="deleteQuick">Delete this quick gym log</button>' : "") +
      "</div>" +
      '<div class="sheet-foot">' +
      '<button type="button" class="btn primary wide" id="saveQuick"' + (quickAnyOn() ? "" : " disabled") + ">" +
      (editing ? "Save changes" : "Save quick gym log") + "</button></div>";
  }

  // A view restored without a draft (shouldn't happen) starts a new entry.
  function openQuickDraftOnly() {
    quickDraft = { editId: null, date: quickDays().today, pick: false, on: {}, sets: {}, note: "" };
    MODEL.GROUPS.forEach(function (g) { quickDraft.on[g] = false; quickDraft.sets[g] = QUICK_DEFAULT_SETS; });
  }

  function readQuickInputs() {
    var sheet = $("#sheet");
    sheet.querySelectorAll(".qrow").forEach(function (row) {
      var g = row.getAttribute("data-g");
      quickDraft.sets[g] = clampSets($(".stepval", row).value, quickDraft.sets[g]);
    });
    var note = $("#quickNote", sheet);
    if (note) quickDraft.note = note.value;
  }

  function announce(msg) {
    var sr = $("#sr-live");
    if (!sr) return;
    sr.textContent = "";
    setTimeout(function () { sr.textContent = msg; }, 50);
  }

  function wireQuick(sheet) {
    var saveBtn = $("#saveQuick", sheet);
    var sum = $("#quickSum", sheet);
    function paintFoot() {
      saveBtn.disabled = !quickAnyOn();
      sum.innerHTML = quickSummary();
    }

    sheet.querySelectorAll(".qday").forEach(function (b) {
      b.addEventListener("click", function () {
        readQuickInputs();
        var k = quickDays(), m = b.getAttribute("data-day");
        if (m === "today") { quickDraft.date = k.today; quickDraft.pick = false; }
        else if (m === "yesterday") { quickDraft.date = k.yesterday; quickDraft.pick = false; }
        else {
          quickDraft.pick = true;
          if (quickDraft.date >= k.yesterday) quickDraft.date = k.before;
        }
        renderSheet();
        var again = $('.qday[data-day="' + m + '"]', $("#sheet"));
        if (again) again.focus();     // the redraw would otherwise drop focus to the page
      });
    });

    // Updated in place: re-rendering would close the iPhone's date picker.
    var di = $("#quickDate", sheet);
    if (di) di.addEventListener("change", function () {
      var v = di.value, today = quickDays().today;
      if (!DATE_KEY_RE.test(v) || v < "2000-01-01") return;   // half-typed: checked again on save
      if (v > today) { toast("That day hasn't happened yet"); di.value = quickDraft.date; return; }
      quickDraft.date = v;
      var sub = $(".sheet-head .sub", sheet);
      if (sub) sub.textContent = prettyDate(quickTs(v));
    });

    sheet.querySelectorAll(".qrow").forEach(function (row) {
      var g = row.getAttribute("data-g");
      var tog = $(".qtoggle", row), stepper = $(".stepper", row), inp = $(".stepval", row);
      var minus = $('[data-step="-1"]', row), plus = $('[data-step="1"]', row);
      function paintRow() {
        var on = !!quickDraft.on[g], n = quickDraft.sets[g];
        row.classList.toggle("on", on);
        tog.setAttribute("aria-pressed", on ? "true" : "false");
        $(".qcheck", row).textContent = on ? "✓" : "";
        stepper.hidden = !on;
        inp.value = n;
        // aria-disabled, not disabled: a disabled button would drop keyboard focus.
        minus.setAttribute("aria-disabled", n <= 1 ? "true" : "false");
        plus.setAttribute("aria-disabled", n >= 50 ? "true" : "false");
        paintFoot();
      }
      tog.addEventListener("click", function () {
        quickDraft.sets[g] = clampSets(inp.value, quickDraft.sets[g]);
        quickDraft.on[g] = !quickDraft.on[g];
        paintRow();
      });
      [minus, plus].forEach(function (b) {
        b.addEventListener("click", function () {
          var n = clampSets(inp.value, quickDraft.sets[g]) + Number(b.getAttribute("data-step"));
          quickDraft.sets[g] = Math.min(50, Math.max(1, n));
          paintRow();
          announce(groupName(g) + ": " + quickDraft.sets[g] + (quickDraft.sets[g] === 1 ? " set" : " sets"));
        });
      });
      inp.addEventListener("input", function () {
        if (inp.value === "") return;                 // still typing
        quickDraft.sets[g] = clampSets(inp.value, quickDraft.sets[g]);
        minus.setAttribute("aria-disabled", quickDraft.sets[g] <= 1 ? "true" : "false");
        plus.setAttribute("aria-disabled", quickDraft.sets[g] >= 50 ? "true" : "false");
        paintFoot();
      });
      inp.addEventListener("change", paintRow);       // on leaving: show the clamped number
    });

    var note = $("#quickNote", sheet);
    if (note) note.addEventListener("input", function () { quickDraft.note = note.value; });

    saveBtn.addEventListener("click", saveQuick);

    var del = $("#deleteQuick", sheet);
    if (del) del.addEventListener("click", function () {
      if (!confirm("Delete this quick gym log?")) return;
      var id = quickDraft.editId;
      quickDraft = null;
      deleteLogEntry(id);
      refresh();
      leaveForm();
      toast(storageOk && !readOnly ? "Quick gym log deleted" : notSavedMsg());
    });
  }

  function saveQuick() {
    readQuickInputs();
    var d = quickDraft, groups = {}, any = false;
    MODEL.GROUPS.forEach(function (g) { if (d.on[g]) { groups[g] = d.sets[g]; any = true; } });
    if (!any) { toast("Pick at least one muscle group"); return; }
    // Midnight passed with the sheet open (and no focus event to redraw it):
    // "Today" on screen is now yesterday. Show that before saving anything.
    if (d.shown && d.shown !== quickMode(d)) {
      renderSheet();
      toast("It's a new day — check the day, then save again");
      return;
    }
    var di = $("#quickDate");
    var date = (di && d.pick) ? di.value : d.date;
    if (!DATE_KEY_RE.test(date) || date < "2000-01-01" || date > quickDays().today) {
      toast("Pick today or an earlier day");
      return;
    }
    d.date = date;
    var note = String(d.note || "").slice(0, 280);
    var msg;
    if (d.editId) {
      var target = null;
      state.log.forEach(function (x) { if (x.id === d.editId) target = x; });
      if (!target) {
        quickDraft = null; refresh(); leaveForm();
        toast("Not saved — that quick gym log was deleted meanwhile");
        return;
      }
      target.groups = groups;
      target.note = note;
      if (dateStr(target.ts) !== d.date) target.ts = quickTs(d.date);   // same day: keep the time
      target.mts = MODEL.stamp(target.mts);
      msg = "Quick gym log updated ✓";
    } else {
      // Built through the sanitizer, so it has exactly the stored shape.
      var entry = MODEL.sanitizeLogEntry({ id: genId(), ts: quickTs(d.date), kind: "quick", groups: groups, note: note, mts: MODEL.stamp(0) });
      if (!entry) { toast("Couldn't save that quick gym log"); return; }
      state.log.push(entry);
      msg = "Quick gym log saved ✓";
    }
    // A past day (or a changed date) lands mid-log: keep the stored order.
    MODEL.sortLog(state.log);
    var savedOk = saveState();
    quickDraft = null;
    refresh();
    leaveForm();
    toast(savedOk ? msg : notSavedMsg());
  }

  /* ---------- History: numbers, the month, every workout by day ---------- */

  var historyView = { month: null, filter: "all", weeks: 2 };   // month: a ts in the month shown

  function milestoneRowHTML(m) {
    var ai = areaIndexById(m.areaId), a = AREAS[ai];
    if (!a) return "";
    var step = a.steps[m.step - 1];
    var txt = m.type === "master" ? "Mastered " + esc(shortAreaName(a)) + " &#8212; all ten steps"
      : "Reached step " + m.step + ": " + esc(step ? step.name : "");
    return '<div class="hitem ms" data-kind="bw" style="--area:' + areaColorVar(a) + '">' +
      '<span class="hopen"><span class="hswatch"></span><span class="hinfo"><span class="hname">' + ico("&#127941;") + txt + "</span>" +
      '<span class="hsets">' + esc(shortAreaName(a)) + " &middot; milestone</span></span></span></div>";
  }

  // "gym" = quick logs and gym exercises; "bw" = skill sessions. Weigh-ins
  // and kinds this version doesn't know show under All only.
  function entryFilterKind(e) {
    if (!e.kind) return "bw";
    if (e.kind === "quick" || e.kind === "gym") return "gym";
    return "other";
  }

  function calendarHTML(now) {
    var monthTs = historyView.month || now;
    var grid = TRAINING.monthGrid(monthTs);
    var todayKey = dateStr(now);
    var thisMonth = startOfDay(now);
    var shown = new Date(monthTs);
    var atNow = shown.getFullYear() === thisMonth.getFullYear() && shown.getMonth() === thisMonth.getMonth();
    var prev = new Date(TRAINING.addMonths(monthTs, -1)), next = new Date(TRAINING.addMonths(monthTs, 1));
    var head = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(function (d) {
      return '<th scope="col" abbr="' + d + '">' + d.charAt(0) + "</th>";
    }).join("");
    var body = grid.map(function (row) {
      return "<tr>" + row.map(function (c) {
        if (!c.inMonth) return "<td></td>";
        var isToday = c.key === todayKey, future = c.key > todayKey;
        var dots = future ? [] : TRAINING.dayGroups(state.log, c.ts);
        var trained = !future && state.log.some(function (e) { return isTraining(e) && dateStr(e.ts) === c.key; });
        var cls = "cal-cell" + (isToday ? " today" : "") + (future ? " future" : "") + (dots.length ? " has" : "");
        var hidden = (isToday || trained) ? '<span class="visually-hidden">' + (isToday ? ", today" : "") +
          (dots.length ? ": " + dots.map(groupName).join(", ") : (trained ? ": trained" : "")) + "</span>" : "";
        var inner = '<span class="cal-n">' + c.day + "</span>" + slots(dots) + hidden;
        return "<td>" + (trained ? '<button class="' + cls + '" type="button" data-day="' + c.key + '">' + inner + "</button>"
          : '<span class="' + cls + '">' + inner + "</span>") + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<div class="today-card cal">' +
      '<div class="cal-head"><button class="iconbtn cal-nav" id="calPrev" type="button" aria-label="Previous month, ' + MON_LONG[prev.getMonth()] + '">&#8249;</button>' +
      '<h2 class="today-title" id="calTitle">' + esc(TRAINING.monthLabel(monthTs)) + "</h2>" +
      '<button class="iconbtn cal-nav" id="calNext" type="button" aria-label="Next month, ' + MON_LONG[next.getMonth()] + '"' + (atNow ? " disabled" : "") + ">&#8250;</button></div>" +
      '<table class="cal-grid" aria-labelledby="calTitle"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>" +
      slotKeyHTML() + "</div>";
  }

  function renderHistory() {
    var host = $("#historyPane");
    if (!host) return;
    var now = nowMs();
    var stat = function (v, l) { return '<div class="ss"><span class="statval">' + v + '</span><span class="statlab">' + l + "</span></div>"; };
    var stats = '<section class="statline" aria-label="Workouts"><h2 class="visually-hidden">Workouts</h2>' +
      stat(TRAINING.workoutsInWeek(state.log, now), "this week") +
      stat(TRAINING.weekStreak(state.log, now), "week streak") +
      stat(TRAINING.totalWorkouts(state.log), "in total") +
      '<button class="infobtn" id="hinfoBtn" type="button" aria-label="How workouts and the week streak are counted">&#9432;</button></section>';
    var any = state.log.length || state.milestones.length;
    var list;
    if (!any) {
      list = '<p class="empty-line center">No workouts yet.<br>Tap <b>&#65291; Log</b> below after your next one.<br>New steps you reach show up here too.</p>';
    } else {
      var from = TRAINING.addWeeks(now, -(historyView.weeks - 1));
      var f = historyView.filter;
      var items = state.log.filter(function (e) {
        return e.ts >= from && (f === "all" || entryFilterKind(e) === f);
      }).map(function (e) { return { ts: e.ts, html: entryRowHTML(e) }; });
      if (f !== "gym") {
        items = items.concat(state.milestones.filter(function (m) { return m.ts >= from; })
          .map(function (m) { return { ts: m.ts, html: milestoneRowHTML(m) }; }));
      }
      items.sort(function (x, y) { return y.ts - x.ts; });
      var groups = [];
      items.forEach(function (it) {
        var k = dateStr(it.ts);
        if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k: k, ts: it.ts, items: [] });
        groups[groups.length - 1].items.push(it.html);
      });
      var older = state.log.some(function (e) { return e.ts < from; }) || state.milestones.some(function (m) { return m.ts < from; });
      list = '<div class="history" id="hlist">' +
        (groups.length ? groups.map(function (g) {
          return '<div class="hgroup"><h3 class="hdate">' + esc(dayLabel(g.ts)) + "</h3>" + g.items.join("") + "</div>";
        }).join("") : '<p class="empty-line center">Nothing of this kind in these ' + historyView.weeks + " weeks.</p>") + "</div>" +
        (older ? '<button class="btn wide" id="showEarlierBtn" type="button">Show earlier</button>' : "") +
        (state.milestones.length ? '<button class="linkbtn" id="allMilestonesBtn" type="button">All ' + state.milestones.length +
          (state.milestones.length === 1 ? " milestone" : " milestones") + "</button>" : "");
    }
    var chip = function (k, label) {
      return '<button class="chip' + (historyView.filter === k ? " sel" : "") + '" type="button" data-filter="' + k + '" aria-pressed="' + (historyView.filter === k) + '">' + label + "</button>";
    };
    host.innerHTML = stats + calendarHTML(now) +
      '<div class="hfilter"><h3 class="sect">By day</h3>' +
      (any ? '<div class="chips" role="group" aria-label="Show" style="--area:var(--accent)">' + chip("all", "All") + chip("gym", "Gym") + chip("bw", "Bodyweight") + "</div>" : "") +
      "</div>" + list;

    var on = function (id, fn) { var b = $(id, host); if (b) b.addEventListener("click", fn); };
    on("#hinfoBtn", function () { pushView({ t: "hinfo" }); });
    on("#calPrev", function () { historyView.month = TRAINING.addMonths(historyView.month || now, -1); renderHistory(); focusIn(host, "#calPrev"); });
    on("#calNext", function () { historyView.month = TRAINING.addMonths(historyView.month || now, 1); renderHistory(); focusIn(host, "#calNext"); });
    on("#showEarlierBtn", function () { historyView.weeks += 2; renderHistory(); });
    on("#allMilestonesBtn", function () { pushView({ t: "milestones" }); });
    host.querySelectorAll("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        historyView.filter = b.getAttribute("data-filter");
        renderHistory();
        focusIn(host, '[data-filter="' + historyView.filter + '"]');
      });
    });
    host.querySelectorAll("[data-day]").forEach(function (b) {
      b.addEventListener("click", function () { openDay(b.getAttribute("data-day")); });
    });
    host.querySelectorAll(".hopen[data-id]").forEach(function (b) {
      b.addEventListener("click", function () { openEditSession(b.getAttribute("data-id")); });
    });
  }

  // After a redraw, put focus back on the control that caused it.
  function focusIn(root, sel) {
    var el = $(sel, root);
    if (el && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function hinfoPaneHTML() {
    return sheetHead({ title: "How workouts are counted", sub: "" }) +
      '<div class="sheet-body volinfo">' +
      "<h4>A workout</h4><p>A day you trained. A quick gym log and a skill session on the same day are one workout. A weigh-in isn&#8217;t a workout.</p>" +
      "<h4>Week streak</h4><p>Weeks in a row, Monday to Sunday, with 2 or more workouts. This week joins the streak once it has 2; until then it doesn&#8217;t break it.</p>" +
      "<h4>Instead of the day streak</h4><p>Milo used to count days in a row. Rest days are part of training, so it counts weeks now.</p>" +
      "</div>";
  }

  function entryById(id) {
    for (var i = 0; i < state.log.length; i++) if (state.log[i].id === id) return state.log[i];
    return null;
  }

  // A gym exercise or a weigh-in, logged by a newer version of Milo: this one
  // can show it and delete it, not change it.
  function entryPaneHTML(e) {
    return sheetHead({ title: e.kind === "body" ? "Weigh-in" : "Gym exercise", sub: esc(longDay(e.ts)) }) +
      '<div class="sheet-body history">' + entryRowHTML(e, true) +
      '<p class="hint">A newer version of Milo logged this. This version can show it and delete it; to change it, update the app on this device.</p>' +
      '<button class="btn danger wide qdel" id="deleteEntry" type="button">Delete this entry</button></div>';
  }

  function milestonesPaneHTML() {
    var ms = state.milestones.slice().sort(function (a, b) { return b.ts - a.ts; });
    return sheetHead({ title: "&#127941; Milestones", sub: ms.length + (ms.length === 1 ? " step reached" : " steps reached") }) +
      '<div class="sheet-body history">' +
      (ms.length ? ms.map(function (m) {
        return '<div class="hgroup"><h3 class="hdate">' + esc(dayLabel(m.ts)) + "</h3>" + milestoneRowHTML(m) + "</div>";
      }).join("") : '<p class="empty-line center">Milestones appear here as you reach new steps.</p>') +
      "</div>";
  }

  /* ---------- ＋ Log: what did you train? ---------- */

  function openLogPick() { pushView({ t: "logpick" }); }

  function pickRowHTML(attrs, color, icon, name, sub) {
    return '<button class="librow" type="button" ' + attrs + ' style="--area:' + color + '">' +
      '<span class="libicon" aria-hidden="true">' + icon + '</span><span class="libinfo"><span class="libname">' + name + "</span>" +
      '<span class="libsub">' + sub + '</span></span><span class="chev" aria-hidden="true">&#8250;</span></button>';
  }

  function logPickPaneHTML() {
    var plan = todaysPlan().filter(function (p) { return !p.done; });
    var planRows = plan.length ? "<h4>Today&#8217;s session</h4>" + '<div class="librows">' + plan.map(function (p) {
      return pickRowHTML('data-area="' + p.areaIdx + '"', areaColorVar(p.area), p.area.icon,
        esc(p.stepObj.name) + " &middot; step " + p.step, esc(prescriptionLine(p)) + " &middot; " + esc(goalPhrase(p)));
    }).join("") + "</div>" : "";
    return sheetHead({ title: "&#65291; Log", sub: "What did you train?" }) +
      '<div class="sheet-body logpick">' + planRows +
      "<h4>" + (plan.length ? "Other skills" : "Skills") + "</h4>" + '<div class="librows">' +
      pickRowHTML('id="pickSkill"', "var(--axis)", "&#129336;", plan.length ? "Another skill" : "Skill session", "Pick one of the six ladders, at your step.") + "</div>" +
      "<h4>Gym</h4>" + '<div class="librows">' +
      pickRowHTML('id="pickQuick"', "var(--accent)", "&#127947;&#65039;", "Quick gym log", "Sets per muscle group, no exercises. Under a minute.") + "</div>" +
      "</div>";
  }

  function logSkillPaneHTML() {
    return sheetHead({ title: "Skill session", sub: "Which ladder?" }) +
      '<div class="sheet-body logpick"><div class="librows">' + CARD_ORDER.map(function (id) {
        var ai = areaIndexById(id), a = AREAS[ai], step = state.areas[id].step;
        return pickRowHTML('data-area="' + ai + '"', areaColorVar(a), a.icon, esc(shortAreaName(a)), "Step " + step + " &middot; " + esc(a.steps[step - 1].name));
      }).join("") + "</div></div>";
  }

  // Leaving a form after saving: also close the pickers it was opened from,
  // so you land back where you started rather than in the picker.
  function leaveForm() {
    uiStack.pop();
    while (uiStack.length && (uiStack[uiStack.length - 1].t === "logpick" || uiStack[uiStack.length - 1].t === "logskill")) uiStack.pop();
    renderSheet();
  }

  /* ---------- What's new (once, after this update) ---------- */

  function whatsNewPaneHTML() {
    var t = TRAINING.targets(state.settings.vol);
    return sheetHead({ title: ico("&#10024;") + "What&#8217;s new in Milo", sub: "Once, after this update" }) +
      '<div class="sheet-body volinfo whatsnew">' +
      "<h4>Four tabs</h4><p><b>Today</b>: your session, the week at a glance and one tip. <b>Body</b>: your six muscle groups this week. " +
      "<b>Skills</b>: the six ladders, as the home screen had them. <b>History</b>: every workout, the calendar and your numbers.</p>" +
      "<h4>&#65291; Log, in the middle</h4><p>From any tab: a skill from today&#8217;s session in one tap, another skill, or a quick gym log (sets per muscle group).</p>" +
      "<h4>Gym and skills count together</h4><p>Body adds up the hard sets from quick gym logs and skill sessions against a weekly target: " +
      t.chest[0] + "&#8211;" + t.chest[1] + " per group, " + t.arms[0] + "&#8211;" + t.arms[1] + " for arms and legs.</p>" +
      '<h4>Where things went</h4><ul class="nc-list"><li>Stats and the calendar: <b>History</b>.</li><li>Week plan: the link on <b>Today&#8217;s session</b>.</li>' +
      "<li>Deleting a workout: open it in History; Delete is at the bottom.</li><li>&#8220;Log gym day&#8221; is now <b>Quick gym log</b>.</li></ul>" +
      "<h4>What&#8217;s gone</h4><p>The day streak and longest streak. Rest days are part of training, so History counts a <b>week streak</b> instead: weeks in a row with 2 or more workouts.</p>" +
      "</div>" + '<div class="sheet-foot"><button class="btn primary wide" id="whatsNewDone" type="button">Got it</button></div>';
  }

  /* ---------- A toast with one action (Undo) ---------- */

  function toastAction(msg, label, fn) {
    var t = $("#toast");
    t.textContent = msg;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "toast-act";
    b.textContent = label;
    b.addEventListener("click", function () {
      clearTimeout(toastTimer);
      t.classList.remove("show", "act");
      fn();
      restoreFocus(null, "");
    });
    // While Undo has focus the toast stays; it goes a moment after focus leaves.
    b.addEventListener("focus", function () { clearTimeout(toastTimer); });
    b.addEventListener("blur", function () {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove("show", "act"); }, 1500);
    });
    t.appendChild(b);
    t.classList.add("show", "act");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (document.activeElement !== b) t.classList.remove("show", "act"); }, 5000);
    return b;
  }

  /* ---------- Settings: weekly targets ---------- */

  var VOL_MIN = 1, VOL_MAX = 60;

  function volTargetsHTML() {
    var v = state.settings.vol;
    var row = function (k, i) {
      var val = v[i];
      var lowest = i === 0 ? VOL_MIN : v[0], highest = i === 0 ? v[1] : VOL_MAX;
      return '<div class="volrow"><span class="vlab" id="vl-' + k + '">' + (i ? "To" : "From") + "</span>" +
        '<span class="stepper"><button type="button" class="stepbtn" data-vol="' + i + '" data-dir="-1" aria-label="' + (i ? "Lower the top" : "Lower the bottom") +
        ' of the target" aria-disabled="' + (val <= lowest) + '">&#8722;</button>' +
        '<input class="stepval" type="number" inputmode="numeric" min="' + VOL_MIN + '" max="' + VOL_MAX + '" step="1" value="' + val + '" data-vol-input="' + i + '" aria-labelledby="vl-' + k + '">' +
        '<button type="button" class="stepbtn" data-vol="' + i + '" data-dir="1" aria-label="' + (i ? "Raise the top" : "Raise the bottom") +
        ' of the target" aria-disabled="' + (val >= highest) + '">&#43;</button></span></div>';
    };
    return "<h4>Weekly targets</h4>" +
      "<p>Hard sets per muscle group each week. Arms and legs are several muscles each, so they get double.</p>" +
      row("lo", 0) + row("hi", 1) +
      '<p class="hint" id="volHint" aria-live="polite">' + volHintText() + "</p>";
  }
  function volHintText() {
    var v = state.settings.vol;
    return "Chest, back, shoulders and abs: " + v[0] + "&#8211;" + v[1] + ". Arms and legs: " + v[0] * 2 + "&#8211;" + v[1] * 2 + ".";
  }
  // Each change is its own preference change (and its own sync stamp).
  function setVol(i, n) {
    var v = state.settings.vol.slice();
    // An emptied or half-typed box means "no change", never 0.
    if (n === null || n === undefined || String(n).trim() === "" || !isFinite(Number(n))) return false;
    n = Math.round(Number(n));
    if (!isFinite(n)) return false;
    if (i === 0) n = Math.max(VOL_MIN, Math.min(v[1], n));
    else n = Math.max(v[0], Math.min(VOL_MAX, n));
    if (n === v[i]) return false;
    v[i] = n;
    setPref("vol", v);
    saveState();
    refresh();
    return true;
  }
  function wireVolTargets(sheet) {
    function paint() {
      var v = state.settings.vol;
      sheet.querySelectorAll("[data-vol-input]").forEach(function (inp) { inp.value = v[Number(inp.getAttribute("data-vol-input"))]; });
      sheet.querySelectorAll(".stepbtn[data-vol]").forEach(function (b) {
        var i = Number(b.getAttribute("data-vol")), up = b.getAttribute("data-dir") === "1";
        var lim = up ? (i === 0 ? v[1] : VOL_MAX) : (i === 0 ? VOL_MIN : v[0]);
        b.setAttribute("aria-disabled", up ? String(v[i] >= lim) : String(v[i] <= lim));
      });
      var h = $("#volHint", sheet);
      if (h) h.innerHTML = volHintText();
    }
    sheet.querySelectorAll(".stepbtn[data-vol]").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = Number(b.getAttribute("data-vol"));
        setVol(i, state.settings.vol[i] + Number(b.getAttribute("data-dir")));
        paint();
      });
    });
    sheet.querySelectorAll("[data-vol-input]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        setVol(Number(inp.getAttribute("data-vol-input")), inp.value);
        paint();
      });
    });
  }

  /* ---------- The sync mark on the gear ---------- */

  // "none" (sync off) · "ok" · "busy" (never synced yet) · "offline" (grey:
  // everything still saves here) · "failed" (red: only when sync needs you).
  function syncDotState() {
    if (!syncCfg) return "none";
    if (readOnly || syncErrKind === "newer" || syncErrKind === "blocked") return "failed";
    if (syncErr) return (syncErrKind === "offline" || navigator.onLine === false) ? "offline" : "failed";
    if (navigator.onLine === false) return "offline";
    return syncCfg.lastSync ? "ok" : "busy";
  }
  var SYNC_DOT_LABEL = {
    none: "Settings",
    ok: "Settings. Synced.",
    busy: "Settings. Syncing.",
    offline: "Settings. Offline: everything still saves on this device.",
    failed: "Settings. Sync needs your attention."
  };

  /* ---------- Sheet navigation (in-app stack, no browser history) ---------- */

  var uiStack = [];
  var hideTimer = null;
  var openedAt = 0;
  var lastViewKey = null;

  // A view is { t: type, a: area index, s: step index, d: date key, x: anything
  // else a view needs to know (a muscle group, an entry id) }.
  function sameView(v, w) { return !!w && v.t === w.t && v.a === w.a && v.s === w.s && v.d === w.d && v.x === w.x; }

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
    if (e.kind === "quick") { openQuick(id); return; }
    if (e.kind) { pushView({ t: "entry", x: id }); return; }
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
      var savedOk = false;
      if (target) {
        target.sets = sets;
        target.note = logDraft.note;
        target.variant = logDraft.variant || "";
        target.mts = MODEL.stamp(target.mts);
        savedOk = saveState();
      }
      logDraft = { key: "", sets: [], note: "", editId: null, variant: "" };
      refresh();
      leaveForm();
      toast(!target ? "Not saved — that session was deleted meanwhile" : (savedOk ? "Session updated ✓" : notSavedMsg()));
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
    leaveForm(); // back to the step detail (which now shows any new standard), or home from ＋ Log
    // Don't claim success if the write never landed.
    toast(storageOk && !readOnly ? msg : notSavedMsg());
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

  // What the back button calls the sheet underneath: "‹ Pushups", "‹ Log".
  function viewTitle(v) {
    if (!v) return "";
    var a = v.a != null ? AREAS[v.a] : null;
    switch (v.t) {
      case "area": return a ? shortAreaName(a) : "Back";
      case "step": return a && a.steps[v.s] ? a.steps[v.s].name : "Back";
      case "log": return logDraft.editId ? "Edit session" : "Log session";
      case "session": return "Session";
      case "week": return "Week plan";
      case "library": return "Library";
      case "day": return dayLabel(dateFromKey(v.d));
      case "quick": return "Quick gym log";
      case "volinfo": return "How it's counted";
      case "group": return groupName(v.x);
      case "logpick": return "Log";
      case "logskill": return "Skill session";
      case "whatsnew": return "What's new";
      case "hinfo": return "Workouts";
      case "milestones": return "Milestones";
      case "entry": return "Entry";
      case "settings": return "Settings";
      default: return "Back";
    }
  }

  // Swipe a sheet down by its head to close it (phones).
  (function () {
    var sheet = $("#sheet"), drag = null;
    sheet.addEventListener("touchstart", function (e) {
      if (window.innerWidth >= 700 || !(e.target === sheet || e.target.closest(".sheet-head"))) return;
      if (e.target.closest("button")) return;
      drag = { y: e.touches[0].clientY, dy: 0 };
      sheet.style.transition = "none";
    }, { passive: true });
    sheet.addEventListener("touchmove", function (e) {
      if (!drag) return;
      drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
      sheet.style.transform = "translateY(" + drag.dy + "px)";
    }, { passive: true });
    function end() {
      if (!drag) return;
      sheet.style.transition = "";
      var far = drag.dy > 90;
      drag = null;
      sheet.style.transform = "";
      if (far) closeAll();
    }
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
  })();

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") goBack();
  });

  var sheetOpener = null;   // what had focus before the first sheet opened
  var sheetOpenerKey = "";  // a selector that finds it again after a redraw

  function openerKey(el) {
    if (!el || el === document.body) return "";
    if (el.id) return "#" + el.id;
    var attrs = ["data-id", "data-group", "data-day", "data-area", "data-filter"];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute && el.getAttribute(attrs[i]);
      if (v && /^[A-Za-z0-9_-]{1,40}$/.test(v)) return "[" + attrs[i] + '="' + v + '"]';
    }
    return "";
  }
  // Put focus somewhere sensible after a redraw: the element if it's still
  // there, else the one that replaced it in the open tab, else the tab title.
  function restoreFocus(el, key) {
    var target = el && document.contains(el) ? el : null;
    if (!target && key && currentTab) target = $("#pane-" + currentTab + " " + key) || null;
    if (!target) target = $("#tabTitle");
    try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  // Everything behind an open sheet is out of reach (taps, keyboard, screen
  // readers), and the toast and rest pill move above the sheet's footer.
  function setBehind(open) {
    var wrap = $(".wrap"), bar = $(".tabbar");
    if (wrap) wrap.inert = open;
    if (bar) bar.inert = open;
    document.body.classList.toggle("sheet-open", open);
    if (!open) document.body.style.removeProperty("--bottom-chrome");
  }

  function renderSheet() {
    var sheet = $("#sheet");
    var scrim = $("#scrim");
    if (!uiStack.length) {
      sheet.classList.remove("show");
      scrim.classList.remove("show");
      lastViewKey = null;
      setBehind(false);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        if (!uiStack.length) { sheet.hidden = true; sheet.innerHTML = ""; sheet.className = ""; }
      }, 280);
      if (sheetOpener || sheetOpenerKey) restoreFocus(sheetOpener, sheetOpenerKey);
      sheetOpener = null; sheetOpenerKey = "";
      return;
    }
    clearTimeout(hideTimer);
    hideTip();
    if (sheet.hidden || !sheet.classList.contains("show")) { sheetOpener = document.activeElement; sheetOpenerKey = openerKey(sheetOpener); }
    setBehind(true);
    sheet.hidden = false;
    // Force layout so the slide-in transition plays on first show
    void sheet.offsetHeight;
    sheet.classList.add("show");
    scrim.classList.add("show");
    openedAt = performance.now();

    var view = uiStack[uiStack.length - 1];
    // Re-rendering the same pane (e.g. after a chip tap) keeps the scroll position
    var viewKey = view.t + ":" + (view.a != null ? view.a : "") + ":" + (view.s != null ? view.s : "") + ":" +
      (view.d != null ? view.d : "") + ":" + (view.x != null ? view.x : "") + ":" + uiStack.length;
    var prevBody = $(".sheet-body", sheet);
    var keepScroll = (viewKey === lastViewKey && prevBody) ? prevBody.scrollTop : 0;

    if (view.t === "area") sheet.innerHTML = areaPaneHTML(view.a);
    else if (view.t === "step") sheet.innerHTML = stepPaneHTML(view.a, view.s);
    else if (view.t === "log") sheet.innerHTML = logPaneHTML(view.a, view.s);
    else if (view.t === "day") sheet.innerHTML = dayPaneHTML(view.d);
    else if (view.t === "session") sheet.innerHTML = sessionPaneHTML();
    else if (view.t === "week") sheet.innerHTML = weekPaneHTML();
    else if (view.t === "library") sheet.innerHTML = libraryPaneHTML();
    else if (view.t === "quick") sheet.innerHTML = quickPaneHTML();
    else if (view.t === "volinfo") sheet.innerHTML = volInfoPaneHTML();
    else if (view.t === "group" && GROUP_INFO[view.x]) sheet.innerHTML = groupPaneHTML(view.x);
    else if (view.t === "logpick") sheet.innerHTML = logPickPaneHTML();
    else if (view.t === "logskill") sheet.innerHTML = logSkillPaneHTML();
    else if (view.t === "whatsnew") sheet.innerHTML = whatsNewPaneHTML();
    else if (view.t === "hinfo") sheet.innerHTML = hinfoPaneHTML();
    else if (view.t === "milestones") sheet.innerHTML = milestonesPaneHTML();
    else if (view.t === "entry" && entryById(view.x)) sheet.innerHTML = entryPaneHTML(entryById(view.x));
    else if (view.t === "settings") sheet.innerHTML = settingsPaneHTML();
    else {
      // A view this version doesn't know (or one whose data has gone): drop it.
      uiStack.pop();
      renderSheet();
      return;
    }
    sheet.className = "show" + (view.t === "logpick" || view.t === "logskill" ? " short" : "");
    wireSheet(view);
    var body = $(".sheet-body", sheet);
    if (body) body.scrollTop = keepScroll;
    // A footer (Save…) is fixed chrome: the toast and rest pill sit above it.
    var foot = $(".sheet-foot", sheet);
    if (foot) document.body.style.setProperty("--bottom-chrome", foot.offsetHeight + "px");
    else document.body.style.removeProperty("--bottom-chrome");
    // A new sheet: move focus to its title, so a screen reader starts there.
    if (viewKey !== lastViewKey) {
      var title = $("#sheetTitle", sheet);
      if (title) { try { title.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
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
      (logDraft.editId ? '<button class="btn danger wide qdel" id="deleteLog" type="button">Delete this session</button>' : "") +
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
    var workouts = TRAINING.workoutsInWeek(state.log, nowMs());
    return sheetHead({ title: "Session complete", sub: "" }) +
      '<div class="sheet-body session">' +
      '<p class="bigdone">&#127881;</p>' +
      '<div class="donelist">' + rows + "</div>" +
      "<p>" + (workouts > 1 ? "That&#8217;s <strong>" + workouts + " workouts</strong> this week." : "Logged and counted.") + "</p>" +
      '<button class="btn primary wide" id="sessionNext">Queue the next session &#8594;</button>' +
      "</div>";
  }

  /* ---------- The week, and where each area is heading ---------- */

  function weekPaneHTML() {
    if (!routineOn()) {
      return sheetHead({ title: "&#128198; Week plan", sub: "", back: true, backLabel: "Home" }) +
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

    return sheetHead({ title: "&#128198; Week plan", sub: "", back: true, backLabel: "Home" }) +
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

  /* ---------- History rows (every kind of log entry) ---------- */

  function fmtKg(x) { return String(Math.round(x * 100) / 100); }

  // One row in History or a day's list. Skill sessions open the log form and
  // quick gym logs their own sheet; gym-exercise and weigh-in entries (from
  // newer versions of the app) open a sheet that can delete but not edit them.
  function entryRowHTML(e, staticRow) {
    var color, name, detail;
    if (!e.kind) {
      var a = AREAS[areaIndexById(e.areaId)];
      if (!a) return "";
      var step = a.steps[e.step - 1];
      color = areaColorVar(a);
      name = ico(a.icon) + esc(e.variant || step.name);
      detail = esc(shortAreaName(a) + " step " + e.step + " \u00b7 " + setsSummary(e, step));
    } else if (e.kind === "gym") {
      color = "var(--axis)";
      name = "&#127947;&#65039; " + esc(e.exId);
      detail = esc(e.sets.map(function (r, i) { return r + (e.kg[i] ? " × " + fmtKg(e.kg[i]) + " kg" : ""); }).join(", "));
    } else if (e.kind === "quick") {
      // "13 sets: Chest 4, Back 3, Arms 6" (commas, so the " · note" after it
      // stays apart), swatch in the biggest group's colour.
      var gs = MODEL.GROUPS.filter(function (g) { return e.groups[g] > 0; });
      var total = 0, top = null;
      gs.forEach(function (g) { total += e.groups[g]; if (!top || e.groups[g] > e.groups[top]) top = g; });
      color = top ? groupColorVar(top) : "var(--axis)";
      name = ico("&#127947;&#65039;") + "Quick gym log";
      detail = esc(total + (total === 1 ? " set: " : " sets: ") + gs.map(function (g) { return groupName(g) + " " + e.groups[g]; }).join(", "));
    } else if (e.kind === "body") {
      color = "var(--axis)";
      name = "&#9878;&#65039; Weigh-in";
      detail = esc(fmtKg(e.kg) + " kg" + (e.waist ? " · waist " + fmtKg(e.waist) + " cm" : ""));
    } else {
      return "";
    }
    // Tap to open it; Delete is at the bottom of what opens.
    return '<div class="hitem" data-kind="' + entryFilterKind(e) + '" style="--area:' + color + '">' +
      // No aria-label here: it would mask the exercise/sets text inside,
      // which is exactly what a screen-reader user needs to hear.
      (staticRow ? '<div class="hopen">' : '<button class="hopen" type="button" data-id="' + esc(e.id) + '">') +
      '<span class="hswatch"></span>' +
      '<span class="hinfo"><span class="hname">' + name + "</span>" +
      '<span class="hsets">' + detail + (e.note ? " &middot; " + esc(e.note) : "") + "</span></span>" +
      (staticRow ? "</div></div>" : '<span class="chev" aria-hidden="true">&#8250;</span></button></div>');
  }

  /* ---------- A day (from the calendar or Today's week) ---------- */

  function dayPaneHTML(dateKey) {
    var es = sessionsForDate(dateKey).slice().sort(function (x, y) { return x.ts - y.ts; });
    var ts = es.length ? es[0].ts : dateFromKey(dateKey);
    var acc = {};
    es.forEach(function (e) {
      var w = TRAINING.groupWeights(e);
      MODEL.GROUPS.forEach(function (g) { if (w[g]) acc[g] = (acc[g] || 0) + w[g]; });
    });
    var line = MODEL.GROUPS.filter(function (g) { return acc[g] > 0; }).map(function (g) { return esc(groupName(g)) + " " + esc(fmtSets(acc[g])); }).join(" &middot; ");
    var dots = TRAINING.dayGroups(state.log, ts);
    return sheetHead({
      title: ico("&#128197;") + esc(dayLabel(ts)),
      sub: es.length ? es.length + (es.length === 1 ? " entry" : " entries") + " &middot; " + esc(longDay(ts)) : esc(longDay(ts))
    }) +
      '<div class="sheet-body history">' +
      (line ? '<p class="dayline"><b>Hard sets that day:</b> ' + line + "</p>" : "") +
      (dots.length ? '<div class="dayslots">' + slots(dots) + "<span>Dots: the groups with 1 hard set or more.</span></div>" : "") +
      (es.length ? es.map(entryRowHTML).join("") : '<p class="empty">Nothing logged on this day.</p>') +
      "</div>";
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

  /* ---------- Settings pane ---------- */

  function routinePreviewHTML() {
    var sessions = routineSessions();
    if (!sessions) return "";
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
    // An older copy of the app is still writing the old-format record after
    // this device moved on: its sessions still arrive here, but it can't see
    // anything new, so it should be updated.
    // Shown only while that is recent: once the other copy has updated it
    // stops writing the old record, and the hint would otherwise stay forever.
    var olderCopy = syncCfg.cutAt && syncCfg.legacyAt > syncCfg.cutAt && nowMs() - syncCfg.legacyAt < 3 * 86400000
      ? '<p class="hint">An older copy of the app, on another device or tab, last synced on ' + esc(dateStr(syncCfg.legacyAt)) +
        ". Its sessions still arrive here, but it can't see newer data: open it and reload it so it updates.</p>"
      : "";
    var blocked = syncErrKind === "blocked"
      ? '<p class="warn">The copy in the cloud couldn\u2019t be read, so this device stopped syncing rather than overwrite it. ' +
        "If this device has all your training, you can replace the cloud copy with it.</p>" +
        '<div class="btnrow"><button class="btn danger" id="replaceCloudBtn">Replace cloud copy with this device</button></div>'
      : "";
    return head +
      '<p class="syncline"><span class="syncdot inline ' + syncDotState() + '" id="syncDotInline" aria-hidden="true"></span><span id="syncStatus">' + esc(syncStatusText()) + "</span></p>" +
      blocked +
      '<div class="btnrow"><button class="btn" id="syncNowBtn">&#8635; Sync now</button>' +
      '<button class="btn" id="pairQrBtn">&#9636; Connect another device</button></div>' +
      '<div id="pairbox" class="qrbox"></div>' +
      '<p class="hint">Happens by itself when you open the app and after you log a session.</p>' +
      olderCopy;
  }

  // Copies the app keeps by itself: the data as it was before the v5 update,
  // and any stored data that couldn't be read. Shown only when they exist.
  function safetyCopiesHTML() {
    var pre = sideCopy(PRE_UPDATE_KEY), bad = sideCopy(RECOVER_KEY);
    if (!pre && !bad) return "";
    return "<h5>Safety copies</h5>" +
      "<p>Kept automatically, in case something ever needs undoing. Restore one with &#8220;Restore from file&#8221;.</p>" +
      '<div class="btnrow">' +
      (pre ? '<button class="btn" id="preCopyBtn">&#11015; Data before the last update</button>' : "") +
      (bad ? '<button class="btn" id="recoverCopyBtn">&#11015; Data that couldn&#8217;t be read</button>' : "") +
      "</div>";
  }

  function settingsPaneHTML() {
    var url = shareURL();
    var routineChips = '<button class="chip' + (!routineOn() ? " sel" : "") + '" data-routine="off">Off</button>' +
      [2, 3, 6].map(function (d) {
        return '<button class="chip' + (state.routine.split === "bb" + d ? " sel" : "") + '" data-routine="' + d + '">' + d + " days/week</button>";
      }).join("");
    // Anything wrong with saving goes first — it's the one thing here that
    // can't wait to be scrolled to.
    var warnings =
      (storageOk ? "" : '<p class="warn"><strong>Saving isn&#8217;t working</strong> in this browser (storage blocked, or full). Changes will be lost when you close the tab — download a backup file now.</p>') +
      (readOnly ? '<p class="warn"><strong>Nothing is being saved on this device</strong>: it holds data from a newer version of the app. Reload to update — until then, changes made here are lost when you close it.</p>' : "") +
      (loadFailed ? '<p class="warn"><strong>The data on this device couldn&#8217;t be read</strong>, so the app started empty. Nothing has been overwritten yet — restore a backup file before logging anything new.</p>' : "");

    return sheetHead({ title: "&#9881;&#65039; Settings", sub: "", back: false }) +
      '<div class="sheet-body settings">' +
      warnings +
      "<h4>Weekly routine</h4>" +
      "<p>Pick how many days a week you practise the skills; the app spreads the six ladders across them and shows today&#8217;s session on the Today tab.</p>" +
      '<div class="chips">' + routineChips + "</div>" +
      (routineOn() ? '<div class="routine-preview">' + routinePreviewHTML() + "</div>" : "") +
      volTargetsHTML() +
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
      safetyCopiesHTML() +
      "<h5>Start over</h5>" +
      '<div class="btnrow">' +
      (syncCfg ? '<button class="btn danger" id="syncOffBtn">Turn off sync here</button>' : "") +
      '<button class="btn danger" id="resetBtn">Reset all progress</button></div>' +
      "<h5>About Milo</h5>" +
      "<p>Milo of Croton, a wrestler in ancient Greece, is said to have lifted a newborn calf onto his shoulders and carried it every day. The calf grew a little each day, and so did his strength &#8212; until he was carrying a full-grown bull.</p>" +
      "<p>That&#8217;s the idea here: a little more than last time, and a record so you can see it add up.</p>" +
      '<p class="hint buildline">Build ' + esc(BUILD) + " &middot; data v" + esc(String(state.v)) + "</p>" +
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

    var replaceBtn = $("#replaceCloudBtn", sheet);
    if (replaceBtn) replaceBtn.addEventListener("click", replaceCloudCopy);

    var qrBtn = $("#pairQrBtn", sheet);
    if (qrBtn) qrBtn.addEventListener("click", function () {
      var box = $("#pairbox", sheet);
      if (box.childNodes.length) { box.innerHTML = ""; this.innerHTML = "&#9636; Connect another device"; return; }
      var link = location.origin + location.pathname + SYNC.pairingHash(syncCfg);
      var drew = renderQR(box, link, "Scan this with your other device to connect it. Anyone who scans it can read and change your training data, so don't share it.");
      if (drew) this.innerHTML = "&#9636; Hide the code";
      // The text link is the fallback when a camera can't be pointed at a screen.
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

  // A sheet opened from another sheet gets "‹ <that sheet's name>" to go
  // back to it; ✕ always closes everything. (o.back / o.backLabel are no
  // longer needed: the stack decides.)
  function sheetHead(o) {
    var prev = uiStack.length > 1 ? uiStack[uiStack.length - 2] : null;
    return '<div class="sheet-head"' + (o.areaColor ? ' style="--area:' + o.areaColor + '"' : "") + ">" +
      (prev ? '<button class="back" id="backBtn" type="button">&#8249; ' + esc(viewTitle(prev)) + "</button>" : "") +
      '<div class="headings"><h2 id="sheetTitle" tabindex="-1">' + o.title + "</h2>" + (o.sub ? '<p class="sub">' + o.sub + "</p>" : "") + "</div>" +
      '<button class="close" id="closeBtn" type="button" aria-label="Close">&#10005;</button></div>';
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
      var delLog = $("#deleteLog", sheet);
      if (delLog) delLog.addEventListener("click", function () {
        if (!confirm("Delete this session?")) return;
        var id = logDraft.editId;
        logDraft = { key: "", sets: [], note: "", editId: null, variant: "" };
        deleteLogEntry(id);
        refresh();
        leaveForm();
        toast(storageOk && !readOnly ? "Session deleted" : notSavedMsg());
      });
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
        setPref("sessionIndex", (state.routine.sessionIndex + 1) % sessions3.length);
        saveState();
        sessionCursor = -1;
        renderToday();
        closeAll();
        toast("Next session ready");
      });
    }

    if (view.t === "quick") wireQuick(sheet);

    if (view.t === "library") {
      sheet.querySelectorAll(".librow").forEach(function (b) {
        b.addEventListener("click", function () { openArea(Number(b.getAttribute("data-area"))); });
      });
    }

    // The history pane and the per-day pane share the same session-row markup.
    if (view.t === "day") {
      sheet.querySelectorAll(".hopen[data-id]").forEach(function (b) {
        b.addEventListener("click", function () { openEditSession(b.getAttribute("data-id")); });
      });
    }

    if (view.t === "logpick" || view.t === "logskill") {
      sheet.querySelectorAll(".librow[data-area]").forEach(function (b) {
        b.addEventListener("click", function () {
          var ai = Number(b.getAttribute("data-area"));
          openLog(ai, state.areas[AREAS[ai].id].step - 1);
        });
      });
      var ps = $("#pickSkill", sheet);
      if (ps) ps.addEventListener("click", function () { pushView({ t: "logskill" }); });
      var pq = $("#pickQuick", sheet);
      if (pq) pq.addEventListener("click", function () { openQuick(null); });
    }

    if (view.t === "group") {
      sheet.querySelectorAll(".librow[data-area]").forEach(function (b) {
        b.addEventListener("click", function () { openArea(Number(b.getAttribute("data-area"))); });
      });
      var gl = $("#groupLogBtn", sheet);
      if (gl) gl.addEventListener("click", function () { openQuick(null, view.x); });
    }

    if (view.t === "entry") {
      var de = $("#deleteEntry", sheet);
      if (de) de.addEventListener("click", function () {
        if (!confirm("Delete this entry?")) return;
        deleteLogEntry(view.x);
        refresh();
        leaveForm();
        toast(storageOk && !readOnly ? "Entry deleted" : notSavedMsg());
      });
    }

    if (view.t === "whatsnew") {
      var wd = $("#whatsNewDone", sheet);
      if (wd) wd.addEventListener("click", function () {
        setFlag(WHATSNEW_KEY, "done");
        renderToday();
        closeAll();
      });
    }

    if (view.t === "settings") {
      wireSyncSection(sheet);
      wireVolTargets(sheet);

      var ghostReset = $("#ghostResetBtn", sheet);
      if (ghostReset) ghostReset.addEventListener("click", function () {
        // Freeze today's shape as the baseline.
        setPref("ghostBase", { d: dateStr(nowMs()), v: currentRadarVals() });
        saveState();
        ghostOn = false;
        refresh();
        renderSheet();
        toast("Today's levels are now your starting point ✓");
      });

      var ghostAll = $("#ghostAllBtn", sheet);
      if (ghostAll) ghostAll.addEventListener("click", function () {
        setPref("ghostBase", null);
        saveState();
        refresh();
        renderSheet();
        toast("Back to your first day");
      });

      sheet.querySelectorAll("[data-routine]").forEach(function (b) {
        b.addEventListener("click", function () {
          var val = b.getAttribute("data-routine");
          var split = val === "off" ? "off" : "bb" + Number(val);
          // Only rewind the rotation when the split actually changes.
          if (split !== state.routine.split) {
            setPref("split", split);
            if (split !== "off") setPref("sessionIndex", 0);
          }
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
      var preCopy = $("#preCopyBtn", sheet);
      if (preCopy) preCopy.addEventListener("click", function () {
        saveTextFile(sideCopy(PRE_UPDATE_KEY) || "", "milo-before-update-" + dateStr(nowMs()) + ".json", "Copy saved ✓");
      });
      var recoverCopy = $("#recoverCopyBtn", sheet);
      if (recoverCopy) recoverCopy.addEventListener("click", function () {
        saveTextFile(sideCopy(RECOVER_KEY) || "", "milo-unreadable-" + dateStr(nowMs()) + ".json", "Copy saved ✓");
      });
      $("#restoreBtn", sheet).addEventListener("click", function () { $("#restoreFile", sheet).click(); });
      $("#restoreFile", sheet).addEventListener("change", function () {
        var f = this.files && this.files[0];
        var input = this;
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          var parsed = null;
          try { parsed = JSON.parse(String(reader.result)); } catch (e) { parsed = null; }
          input.value = "";
          if (readOnly) { toast(notSavedMsg()); return; }
          if (MODEL.isNewer(parsed)) { toast("That backup is from a newer version of the app — update this device first"); return; }
          var incoming = parsed ? sanitizeState(parsed) : null;
          if (!incoming) { toast("That file isn't a valid backup"); return; }
          // Merging is the safe default: nothing on this device is lost.
          if (confirm("Merge this backup into this device?\n\nSessions from both are kept; where both have the same thing, the newer change wins.\n\nOK = merge · Cancel = other options")) {
            applyFullState(sanitizeState(MODEL.merge(state, incoming)), "Backup merged ✓");
            renderSheet();
          } else if (confirm("Replace EVERYTHING on this device with the backup instead? Anything that isn't in the backup is removed from this device." + syncCaveat())) {
            applyFullState(incoming, "Backup restored ✓", true);
            renderSheet();
          }
        };
        reader.onerror = function () { toast("Couldn't read that file"); input.value = ""; };
        reader.readAsText(f);
      });
      $("#resetBtn", sheet).addEventListener("click", function () {
        if (readOnly) { toast(notSavedMsg()); return; }
        if (confirm("Reset ALL progress AND history on this device? This cannot be undone." + syncCaveat())) {
          state = defaultState();
          var ok = saveReplacing();
          refresh();
          renderSheet();
          toast(ok ? "Everything reset" : notSavedMsg());
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
  TABS.forEach(function (t) {
    $("#tab-" + t).addEventListener("click", function () { showTab(t, true); });
  });
  $("#logTab").addEventListener("click", openLogPick);
  $("#libraryBtn").addEventListener("click", openLibrary);
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
    if (readOnly) { toast(notSavedMsg()); return; }
    AREAS.forEach(function (a) {
      var inc = incoming.areas[a.id];
      if (inc) {
        // Stamped after the position it replaces, like every other edit, so a
        // device whose clock runs ahead can't make sync undo the import.
        state.areas[a.id] = { step: inc.step, std: inc.std, mts: MODEL.stamp(state.areas[a.id].mts) };
      }
      // An imported position can already be a mastered area — record it so the
      // milestone timeline isn't silently missing it.
      checkMaster(a.id);
    });
    var ok = saveState();
    jumpRadar();
    // Every tab shows this data, so all of them are redrawn.
    if (booted) { recordSnapshot(); refresh(); }
    toast(ok ? "Progress imported ✓" : notSavedMsg());
  }

  // Full restore (backup file): replace everything, including history.
  function applyFullState(incoming, msg, replaceAll) {
    state = incoming;
    var ok = replaceAll ? saveReplacing() : saveState();
    jumpRadar();
    if (booted) { recordSnapshot(); refresh(); }
    toast(ok ? (msg || "Restored ✓") : notSavedMsg());
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
  var syncErrKind = "";      // "newer" | "blocked" | "" — decides what Settings offers
  var syncTimer = null;
  var applyingSync = false;  // guards against a sync's own save re-triggering it

  function syncOn() { return !!syncCfg; }

  function logPaneOpen() {
    var top = uiStack[uiStack.length - 1];
    // Also the quick sheet: a sync must not re-render a form mid-entry.
    return !!top && (top.t === "log" || top.t === "quick");
  }

  // Every change goes through saveState(), so that is the only place this needs
  // to be called from. The delay coalesces the burst of saves one action makes.
  function scheduleSync() {
    if (!syncCfg || applyingSync) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow(false); }, 2500);
  }

  function syncNow(manual) {
    if (!syncCfg || readOnly) return;
    // Never re-render the log form out from under someone mid-entry.
    if (!manual && logPaneOpen()) { syncAgain = true; return; }
    if (syncBusy) { syncAgain = true; return; }
    syncBusy = true;
    syncAgain = false;
    updateSyncUI();

    // Wrapped so that any mistake inside a round becomes a reported failure,
    // never a sync that is stuck "busy" for good.
    Promise.resolve().then(function () { return syncRound(1); }).then(function (changed) {
      syncBusy = false;
      syncErr = ""; syncErrKind = "";
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
      syncErrKind = (err && err.kind) || "";
      if (syncErrKind === "newer") showBanner("newer-remote");
      if (manual) toast(syncErr);
      updateSyncUI();
      // The error panel in Settings changes with the kind of failure.
      if (manual && uiStack.length && uiStack[uiStack.length - 1].t === "settings") renderSheet();
    });
  }

  function syncError(kind, message) {
    var e = new Error(message);
    e.kind = kind;
    return e;
  }

  // The old-format record, only when an older device has written to it since
  // its sessions were last merged in. Never fails the round: at worst the old
  // record is simply skipped this time.
  function legacyPull() {
    return SYNC.legacyStamp(syncCfg).then(function (stamp) {
      if (stamp === null || stamp === syncCfg.legacyAt) return null;
      return SYNC.pull(syncCfg, true).then(function (res) {
        res.stamp = stamp;
        return res.status === "ok" ? res : null;
      });
    }).catch(function () { return null; });
  }

  /* One pull → merge → push round, on the data v5 record. The decision itself
     is MODEL.reconcile (pure, tested in Node); this only does the I/O around
     it. Resolves to true when anything changed locally. `triesLeft` covers
     the compare-and-set retry. */
  function syncRound(triesLeft) {
    return Promise.all([SYNC.pull(syncCfg), legacyPull()]).then(function (res) {
      var remote = res[0], legacy = res[1];
      // Anything off the network is untrusted: reconcile runs it through the
      // same validation as a restored backup file before merging.
      var r = MODEL.reconcile(state, remote, legacy);
      if (r.newer) {
        throw syncError("newer", "The app was updated on another device — reload here to keep syncing.");
      }
      if (r.blocked) {
        throw syncError("blocked", "The cloud copy couldn't be read, so nothing was synced and nothing was overwritten.");
      }

      var changed = false, savedOk = true;
      if (r.changed) {
        state = r.state;
        applyingSync = true;
        savedOk = saveState();
        applyingSync = false;
        jumpRadar();
        changed = true;
      }
      // Only remember the old record as merged once its sessions are stored.
      if (legacy && savedOk) SYNC.updateConfig(syncCfg, { legacyAt: legacy.stamp });

      if (!r.push) return changed;
      return SYNC.push(syncCfg, state, remote.etag).then(function () {
        if (!syncCfg.cutAt) SYNC.updateConfig(syncCfg, { cutAt: nowMs() });
        return changed;
      }, function (err) {
        // Another device wrote between our read and our write — take its
        // version into account and try once more.
        if (err && err.conflict && triesLeft > 0) return syncRound(triesLeft - 1);
        throw err;
      });
    });
  }

  // The escape hatch for a cloud copy this version can't read: overwrite it
  // with this device's data, after asking. Unconditional write, on purpose.
  function replaceCloudCopy() {
    if (!syncCfg || readOnly) return;
    if (!confirm("Replace the cloud copy with this device's data? Whatever is stored in the cloud now is overwritten. Only do this if you're sure this device has everything.")) return;
    syncBusy = true; updateSyncUI();
    SYNC.push(syncCfg, state, null).then(function () {
      syncBusy = false; syncErr = ""; syncErrKind = "";
      SYNC.markSynced(syncCfg, nowMs());
      if (!syncCfg.cutAt) SYNC.updateConfig(syncCfg, { cutAt: nowMs() });
      toast("Cloud copy replaced ✓");
      updateSyncUI();
      if (uiStack.length) renderSheet();
    }, function (err) {
      syncBusy = false;
      toast((err && err.message) || "Couldn't replace the cloud copy");
      updateSyncUI();
    });
  }

  function syncStatusText() {
    if (!syncCfg) return "";
    if (readOnly) return "Paused: this device has data from a newer version of the app. Reload to update.";
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
    var st = syncDotState();
    var dot = document.getElementById("syncDot"), gear = document.getElementById("settingsBtn");
    if (dot) dot.className = "syncdot " + st;
    if (gear) gear.setAttribute("aria-label", SYNC_DOT_LABEL[st]);
    var line = document.getElementById("syncStatus");
    if (line) line.textContent = syncStatusText();
    var sdot = document.getElementById("syncDotInline");
    if (sdot) sdot.className = "syncdot inline " + st;
    var btn = document.getElementById("syncNowBtn");
    if (btn) btn.disabled = syncBusy;
  }

  function startSync(cfg, msg) {
    syncCfg = cfg;
    syncErr = "";
    if (!SYNC.setConfig(cfg)) { toast("Couldn't save the sync settings"); return; }
    updateSyncUI();
    renderToday();
    toast(msg || "Sync turned on");
    syncNow(true);
  }

  function stopSync() {
    syncCfg = null;
    syncErr = "";
    clearTimeout(syncTimer);
    SYNC.clearConfig();
    updateSyncUI();
    renderToday();
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
    renderSkillNudge();
    renderToday();
    renderBody();
    renderHistory();
    updateGhostControl();
  }

  $("#cards").addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (card) openArea(Number(card.getAttribute("data-area")));
  });

  // "What's new" is for a device that already had data before this version.
  if (flag(WHATSNEW_KEY) === null) setFlag(WHATSNEW_KEY, untouched() ? "done" : "show");
  showTab(initialTab());
  tryImportFromHash();
  tryPairFromHash();
  buildRadar();
  renderCards();
  renderSkillNudge();
  renderToday();
  renderBody();
  renderHistory();
  // Capture today's shape for the ghost radar — but never auto-write over
  // stored data we failed to read, so a recoverable backup isn't destroyed.
  if (!loadFailed && !readOnly) recordSnapshot();
  if (readOnly) showBanner("newer");

  // Another tab (or window) of the app saved. Take its changes in rather
  // than overwrite them with this tab's older copy on the next save.
  window.addEventListener("storage", function (e) {
    if (e.key === STORE_KEY) {
      if (!e.newValue || readOnly) return;
      var raw;
      try { raw = JSON.parse(e.newValue); } catch (err) { return; }
      // The other tab replaced everything on purpose: take its data as it is.
      var replacedAt = 0;
      try { replacedAt = Number(localStorage.getItem(REPLACE_KEY)) || 0; } catch (err) { /* ignore */ }
      if (replacedAt > seenReplaceAt && !MODEL.isNewer(raw)) {
        seenReplaceAt = replacedAt;
        var adopted = sanitizeState(raw);
        if (adopted) {
          state = adopted;
          jumpRadar();
          refresh();
          if (uiStack.length && !logPaneOpen()) renderSheet();
        }
        return;
      }
      var r = MODEL.absorb(state, raw);
      if (r.readOnly) { readOnly = true; showBanner("newer"); updateSyncUI(); return; }
      if (r.changed) {
        state = r.state;
        jumpRadar();
        refresh();
        if (uiStack.length && !logPaneOpen()) renderSheet();
      }
      // Only when this tab knows something the other one doesn't.
      if (r.save) saveState();
    } else if (e.key === "bigsix.sync" && typeof SYNC !== "undefined") {
      // Sync switched off, on, or re-paired in another tab.
      syncCfg = SYNC.getConfig();
      syncErr = ""; syncErrKind = "";
      updateSyncUI();
      if (uiStack.length && uiStack[uiStack.length - 1].t === "settings") renderSheet();
    }
  });
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
  window.addEventListener("online", function () { updateSyncUI(); if (syncOn()) syncNow(false); });
  window.addEventListener("offline", updateSyncUI);

  // Ask the browser to protect our saved data from automatic eviction
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () { /* best effort */ });
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        // An iPhone home-screen app coming back from the background doesn't
        // reload the page, so the browser never looks for a new version on
        // its own. Ask whenever the app comes back to the foreground.
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden) reg.update().catch(function () { /* offline */ });
        });
      }).catch(function () { /* offline support is optional */ });
    });
  }
})();
