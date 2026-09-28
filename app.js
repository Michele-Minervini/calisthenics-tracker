/* ============================================================
   Milo — app logic
   Plain JavaScript, no dependencies.
   The stored state (data v5) is described at the top of model.js, which
   also holds everything that validates, migrates and merges it. Older
   shapes migrate automatically on load. The `mts` / `pm` stamps and
   `deleted` tombstones exist only for sync: they let two devices merge
   without losing or resurrecting anything. Nothing in the UI reads them.
   Log entries come in kinds: skill-ladder sessions (no `kind`) and quick
   gym days ("quick") are logged here; gym-exercise and weigh-in entries
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

  var BUILD = "milo-v18";
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

  /* ---------- Streak + training days ---------- */

  // Days with training (a weigh-in isn't training) → entries that day.
  function trainingDaySet() {
    var s = {};
    state.log.forEach(function (e) {
      if (!isTraining(e)) return;
      s[dateStr(e.ts)] = (s[dateStr(e.ts)] || 0) + 1;
    });
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

  /* ---------- Smart nudge ---------- */

  function smartNudge() {
    var st = currentStreak();
    var streakLine = st >= 2 ? "🔥 " + st + "-day streak — keep it going!" : "";
    // The per-skill nudges are about the ladders: a log of gym days only
    // doesn't mean the skills were "never logged".
    if (!state.log.some(isBodyweight)) return streakLine;
    var today = nowMs();
    var worst = null, worstGap = -1, worstNever = false;
    AREAS.forEach(function (a) {
      var last = lastSessionTs(a.id);
      // Whole calendar days, so this agrees with the streaks and the heatmap.
      var gap = last ? Math.max(0, dayDelta(last, today)) : Infinity;
      if (gap > worstGap) { worstGap = gap; worst = a; worstNever = !last; }
    });
    if (worst && worstNever) return "You haven't logged " + shortAreaName(worst) + " yet — give it a try.";
    if (worst && worstGap >= 5) return "You haven't practised " + shortAreaName(worst) + " in " + worstGap + " days.";
    return streakLine;
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
    renderedDay = dateStr(nowMs());
    var parts = [];

    if (routineOn()) {
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

    // Hard sets per muscle group this week, and the way into the quick gym
    // log. Its own card, so it reads the same with or without a routine.
    parts.push(weekCardHTML());

    // Outside the routine branch on purpose: the library is a reference you may
    // want whether or not you've set a routine up.
    parts.push('<div class="today-links">' +
      (routineOn() ? '<button class="tdlink" id="weekBtn">&#128198; Week plan</button>' : "") +
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
      setPref("sessionIndex", (state.routine.sessionIndex + 1) % sessions2.length);
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
    var ql = $("#quickLogBtn", host);
    if (ql) ql.addEventListener("click", function () { openQuick(null); });
    var vi = $("#volInfoBtn", host);
    if (vi) vi.addEventListener("click", openVolInfo);
  }

  /* ---------- This week: hard sets per muscle group (home) ----------

     Six bars, in MODEL.GROUPS order (the same order as the quick sheet's
     toggles and History's text). Each bar is drawn against its own target:
     the track is 1.25 × hi long, so the target range always sits at the
     same place (40–80 % with the default 10–20) and a glance down the
     column shows which groups have reached it. Colour is identity only;
     the zone is always written out. */

  function weekCardHTML() {
    var now = nowMs();
    var rows = TRAINING.weekSummary(state.log, now, state.settings.vol);
    var total = 0;
    var items = rows.map(function (r) {
      total += r.sets;
      var max = r.hi * 1.25;
      var pct = function (x) { return (Math.max(0, Math.min(1, x / max)) * 100).toFixed(1) + "%"; };
      var n = TRAINING.fmtSets(r.sets);
      var name = groupName(r.group);
      var zoneTxt = TRAINING.ZONE_LABELS[r.zone];
      return '<li class="gw-row z-' + r.zone + '" style="--area:' + groupColorVar(r.group) + '">' +
        // One sentence for screen readers; the drawing and the short text are hidden from them.
        '<span class="visually-hidden">' + esc(name + ": " + n + " hard sets, target " + r.lo + " to " + r.hi + ", " + zoneTxt.toLowerCase() + ".") + "</span>" +
        '<span class="gw-line" aria-hidden="true">' +
          '<span class="gw-name"><span class="swatch"></span>' + esc(name) + "</span>" +
          // "Not trained" six times over on a Monday is noise: the grey 0 says it.
          '<span class="gw-zone">' + (r.zone === "none" ? "" : (r.zone === "on" ? "&#10003; " : "") + esc(zoneTxt)) + "</span>" +
          '<span class="gw-num"><b>' + esc(n) + "</b> / " + r.lo + "&#8211;" + r.hi + "</span>" +
        "</span>" +
        '<span class="gw-bar" aria-hidden="true">' +
          '<span class="gw-band" style="left:' + pct(r.lo) + ";right:" + (100 - parseFloat(pct(r.hi))).toFixed(1) + '%"></span>' +
          '<i style="width:' + pct(r.sets) + '"></i>' +
          '<span class="gw-mark" style="left:' + pct(r.lo) + '"></span>' +
          '<span class="gw-mark" style="left:' + pct(r.hi) + '"></span>' +
        "</span></li>";
    }).join("");
    return '<div class="today-card gweek">' +
      '<div class="gw-head">' +
        '<div class="gw-titles">' +
          '<h2 class="today-title gw-title">This week' +
          '<button class="infobtn" id="volInfoBtn" type="button" aria-label="How hard sets are counted">&#9432;</button></h2>' +
          '<span class="today-sub gw-sub"><span>' + esc(TRAINING.weekLabel(now, true)) + "</span> &middot; <span>hard sets</span></span>" +
        "</div>" +
        '<button class="btn gw-add" id="quickLogBtn" type="button">&#65291; Log gym day</button>' +
      "</div>" +
      '<ul class="gw-list" aria-label="Hard sets this week, by muscle group">' + items + "</ul>" +
      // Decided by what was logged, not by the sum: a week of mobility work only
      // (it counts for no group) still has something logged.
      (total || TRAINING.inWeek(state.log, now).some(isTraining) ? "" :
        '<p class="gw-empty">Nothing logged this week yet. Gym days and exercise sessions both count.</p>') +
      "</div>";
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
      "<p>A gym day logs only the main groups, so helpers get a smaller share: &frac14; per set. Four chest sets also add 1 to arms and 1 to shoulders.</p>" +
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
  function openQuick(id) {
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
      quickDraft.on[g] = !!n;
      quickDraft.sets[g] = n || QUICK_DEFAULT_SETS;
    });
    pushView({ t: "quick" });
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
      title: editing ? "Edit gym day" : "Log gym day",
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
      (editing ? '<button type="button" class="btn danger wide qdel" id="deleteQuick">Delete this gym day</button>' : "") +
      "</div>" +
      '<div class="sheet-foot">' +
      '<button type="button" class="btn primary wide" id="saveQuick"' + (quickAnyOn() ? "" : " disabled") + ">" +
      (editing ? "Save changes" : "Save gym day") + "</button></div>";
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
      if (!confirm("Delete this gym day?")) return;
      var id = quickDraft.editId;
      quickDraft = null;
      deleteLogEntry(id);
      refresh();
      goBack();
      toast(storageOk && !readOnly ? "Gym day deleted" : notSavedMsg());
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
        quickDraft = null; refresh(); goBack();
        toast("Not saved — that gym day was deleted meanwhile");
        return;
      }
      target.groups = groups;
      target.note = note;
      if (dateStr(target.ts) !== d.date) target.ts = quickTs(d.date);   // same day: keep the time
      target.mts = MODEL.stamp(target.mts);
      msg = "Gym day updated ✓";
    } else {
      // Built through the sanitizer, so it has exactly the stored shape.
      var entry = MODEL.sanitizeLogEntry({ id: genId(), ts: quickTs(d.date), kind: "quick", groups: groups, note: note, mts: MODEL.stamp(0) });
      if (!entry) { toast("Couldn't save that gym day"); return; }
      state.log.push(entry);
      msg = "Gym day logged ✓";
    }
    // A past day (or a changed date) lands mid-log: keep the stored order.
    MODEL.sortLog(state.log);
    var savedOk = saveState();
    quickDraft = null;
    refresh();
    goBack();
    toast(savedOk ? msg : notSavedMsg());
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
    if (e.kind === "quick") { openQuick(id); return; }
    if (e.kind) { toast("Editing this entry needs a newer version of the app"); return; }
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
      goBack();
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
    goBack(); // back to the step detail, which now reflects any new standard
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
    else if (view.t === "quick") sheet.innerHTML = quickPaneHTML();
    else if (view.t === "volinfo") sheet.innerHTML = volInfoPaneHTML();
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
  // gym days the gym-day sheet; gym-exercise and weigh-in entries (from newer
  // versions of the app) are shown and can be deleted, but not edited here.
  function entryRowHTML(e) {
    var color, name, detail;
    if (!e.kind) {
      var a = AREAS[areaIndexById(e.areaId)];
      var step = a.steps[e.step - 1];
      color = areaColorVar(a);
      name = a.icon + " " + esc(step.name);
      detail = esc(setsSummary(e, step));
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
      name = "&#127947;&#65039; Gym day";
      detail = esc(total + (total === 1 ? " set: " : " sets: ") + gs.map(function (g) { return groupName(g) + " " + e.groups[g]; }).join(", "));
    } else if (e.kind === "body") {
      color = "var(--axis)";
      name = "&#9878;&#65039; Weigh-in";
      detail = esc(fmtKg(e.kg) + " kg" + (e.waist ? " · waist " + fmtKg(e.waist) + " cm" : ""));
    } else {
      return "";
    }
    return '<div class="hitem" style="--area:' + color + '">' +
      // No aria-label here: it would mask the exercise/sets text inside,
      // which is exactly what a screen-reader user needs to hear.
      '<button class="hopen" data-id="' + esc(e.id) + '">' +
      '<span class="hswatch"></span>' +
      '<span class="hinfo"><span class="hname">' + name + "</span>" +
      '<span class="hsets">' + detail + (e.note ? " &middot; " + esc(e.note) : "") + "</span></span></button>" +
      '<button class="hdel" data-id="' + esc(e.id) + '" aria-label="Delete this entry">&#128465;</button></div>';
  }

  /* ---------- History pane ---------- */

  function historyPaneHTML() {
    var sessions = allSessionsSorted();
    var body;
    if (!sessions.length) {
      body = '<p class="empty">No sessions logged yet.<br>Open an exercise and tap &ldquo;Log a session&rdquo;, or use &ldquo;&#65291; Log gym day&rdquo; on the home screen.</p>';
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
        var rows = g.items.map(entryRowHTML).join("");
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
      body = sessions.map(entryRowHTML).join("");
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
    // Shade by how much was trained: a gym day logged as one entry counts
    // one per muscle group, like the separate skill sessions it resembles.
    var units = {};
    state.log.forEach(function (e) {
      if (!isTraining(e)) return;
      var k = dateStr(e.ts);
      units[k] = (units[k] || 0) + (e.kind === "quick" ? Math.max(1, Object.keys(e.groups).length) : 1);
    });
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
        var u = units[key] || 0;
        var lvl = c === 0 ? 0 : (u >= 4 ? 4 : u);
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
    var totalSessions = state.log.filter(isTraining).length;
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
      '<p id="syncStatus">' + esc(syncStatusText()) + "</p>" +
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
      "<p>Pick how many days a week you train; the app spreads the six movements across them and shows today&#8217;s session on the home screen.</p>" +
      '<div class="chips">' + routineChips + "</div>" +
      (routineOn() ? '<div class="routine-preview">' + routinePreviewHTML() + "</div>" : "") +
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
    displayVals = AREAS.map(function (a) { return areaValue(a.id); });
    if (booted) { recordSnapshot(); paintRadar(); renderCards(); renderToday(); updateGhostControl(); }
    toast(ok ? "Progress imported ✓" : notSavedMsg());
  }

  // Full restore (backup file): replace everything, including history.
  function applyFullState(incoming, msg, replaceAll) {
    state = incoming;
    var ok = replaceAll ? saveReplacing() : saveState();
    displayVals = AREAS.map(function (a) { return areaValue(a.id); });
    if (booted) { recordSnapshot(); paintRadar(); renderCards(); renderToday(); updateGhostControl(); }
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
        displayVals = AREAS.map(function (a) { return areaValue(a.id); });
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
          displayVals = AREAS.map(function (a) { return areaValue(a.id); });
          refresh();
          if (uiStack.length && !logPaneOpen()) renderSheet();
        }
        return;
      }
      var r = MODEL.absorb(state, raw);
      if (r.readOnly) { readOnly = true; showBanner("newer"); updateSyncUI(); return; }
      if (r.changed) {
        state = r.state;
        displayVals = AREAS.map(function (a) { return areaValue(a.id); });
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
  window.addEventListener("online", function () { if (syncOn()) syncNow(false); });

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
