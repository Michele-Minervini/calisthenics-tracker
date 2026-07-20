/* ============================================================
   Big Six Tracker — app logic
   Plain JavaScript, no dependencies.
   State shape (v3, migrates from v1/v2 automatically):
   {
     v: 3,
     areas: { [areaId]: { step: 1..10, std: 0..3 } },
     log:   [ { id, ts, date:"YYYY-MM-DD", areaId, step, sets:[n,...], note } ],
     settings: { restSeconds },
     routine: { enabled, daysPerWeek: 2|3|6, sessionIndex },
     snapshots: [ { d:"YYYY-MM-DD", v:[6 radar values] } ],   // ghost radar
     milestones: [ { id, ts, type:"advance"|"master", areaId, step } ]
   }
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
    AREAS.forEach(function (a) { areas[a.id] = { step: 1, std: 0 }; });
    return {
      v: 3,
      areas: areas,
      log: [],
      settings: { restSeconds: DEFAULT_REST },
      routine: { enabled: false, daysPerWeek: 3, sessionIndex: 0 },
      snapshots: [],   // [{ d:"YYYY-MM-DD", v:[6 radar values] }] for the ghost radar
      milestones: []   // [{ id, ts, type:"advance"|"master", areaId, step }]
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      return sanitizeState(parsed) || defaultState();
    } catch (e) {
      storageOk = false;
      return memoryFallback || defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      storageOk = false;
      memoryFallback = state;
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
      }
    });
    if (Array.isArray(s.log)) {
      out.log = s.log.map(sanitizeLogEntry).filter(Boolean);
    }
    if (s.settings && typeof s.settings === "object") {
      var rs = Math.round(Number(s.settings.restSeconds));
      if (rs >= 5 && rs <= 3600) out.settings.restSeconds = rs;
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
    if (Array.isArray(s.milestones)) {
      out.milestones = s.milestones.map(sanitizeMilestone).filter(Boolean).slice(-500);
    }
    return out;
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
    return { id: id, ts: ts, date: date, areaId: e.areaId, step: step, sets: sets, note: note };
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
  function genId() {
    return "s" + nowMs().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
  function prettyDate(ts) {
    var dd = dateStr(ts);
    var today = nowMs();
    if (dd === dateStr(today)) return "Today";
    if (dd === dateStr(today - 86400000)) return "Yesterday";
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

  function addLogEntry(areaId, step, sets, note) {
    var ts = nowMs();
    var entry = { id: genId(), ts: ts, date: dateStr(ts), areaId: areaId, step: step, sets: sets, note: note || "" };
    state.log.push(entry);
    saveState();
    return entry;
  }
  function deleteLogEntry(id) {
    state.log = state.log.filter(function (e) { return e.id !== id; });
    saveState();
  }
  function sessionsForStep(areaId, step) {
    return state.log.filter(function (e) { return e.areaId === areaId && e.step === step; })
      .sort(function (a, b) { return b.ts - a.ts; });
  }
  function allSessionsSorted() {
    return state.log.slice().sort(function (a, b) { return b.ts - a.ts; });
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
    if (state.snapshots.length < 2) return null;
    var now = currentRadarVals();
    var oldest = state.snapshots[0];
    var differs = oldest.v.some(function (x, i) { return Math.abs(x - now[i]) > 0.001; });
    return differs ? oldest : null;
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
  // Central point for changing an area's step/std so milestones are recorded once.
  function setAreaProgress(areaId, newStep, newStd) {
    var old = state.areas[areaId];
    var oldStep = old.step;
    state.areas[areaId] = { step: newStep, std: newStd };
    if (newStep > oldStep) recordMilestone("advance", areaId, newStep);
    checkMaster(areaId);
    saveState();
    recordSnapshot();
  }

  /* ---------- Streak + training days ---------- */

  function trainingDaySet() {
    var s = {};
    state.log.forEach(function (e) { s[dateStr(e.ts)] = (s[dateStr(e.ts)] || 0) + 1; });
    return s;
  }
  function currentStreak() {
    var days = trainingDaySet();
    var d = new Date();
    // Today not trained yet shouldn't break a streak — count from yesterday.
    if (!days[dateStr(d.getTime())]) d = new Date(d.getTime() - 86400000);
    var streak = 0;
    while (days[dateStr(d.getTime())]) { streak++; d = new Date(d.getTime() - 86400000); }
    return streak;
  }
  function longestStreak() {
    var days = Object.keys(trainingDaySet()).sort();
    var best = 0, run = 0, prev = null;
    days.forEach(function (k) {
      if (prev !== null && (dateFromKey(k) - prev) === 86400000) run++;
      else run = 1;
      if (run > best) best = run;
      prev = dateFromKey(k);
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
    var worst = null, worstGap = -1;
    AREAS.forEach(function (a) {
      var last = lastSessionTs(a.id);
      var gap = last ? Math.floor((today - last) / 86400000) : 9999;
      if (gap > worstGap) { worstGap = gap; worst = a; }
    });
    if (worst && worstGap >= 900) return "You haven't logged " + shortAreaName(worst) + " yet — give it a try.";
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
    if (state.settings.restSeconds !== seconds) { state.settings.restSeconds = seconds; saveState(); }
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

  function renderQR(container) {
    container.innerHTML = "";
    if (typeof QR === "undefined") { container.textContent = "QR generator unavailable."; return; }
    var m = QR.generate(shareURL());
    if (!m) { container.textContent = "Link is too long for a QR code."; return; }
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
    cap.textContent = "Scan with the other device's camera to open your progress.";
    container.appendChild(cap);
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
    if (!gs) { btn.hidden = true; ghostOn = false; return; }
    btn.hidden = false;
    btn.setAttribute("aria-pressed", ghostOn ? "true" : "false");
    btn.textContent = ghostOn ? ("Hide start (" + shortDate(gs.d) + ")") : "Show where I started";
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

  function renderToday() {
    var host = $("#today");
    if (!host) return;
    var parts = [];

    if (state.routine.enabled) {
      var sessions = routineSessions();
      var idx = state.routine.sessionIndex % sessions.length;
      var sess = sessions[idx];
      var allDone = sess.every(function (id) { return trainedToday(id); });
      var rows = sess.map(function (id) {
        var ai = areaIndexById(id);
        var a = AREAS[ai];
        var st = state.areas[id];
        var done = trainedToday(id);
        return '<button class="td-move' + (done ? " done" : "") + '" data-area="' + ai + '" style="--area:' + areaColorVar(a) + '">' +
          '<span class="tdcheck">' + (done ? "&#10003;" : "") + "</span>" +
          '<span class="tdinfo"><span class="tdname">' + a.icon + " " + esc(a.name) + "</span>" +
          '<span class="tdstep">Step ' + st.step + " &middot; " + esc(a.steps[st.step - 1].name) + "</span></span>" +
          '<span class="chev">&#8250;</span></button>';
      }).join("");
      parts.push('<div class="today-card">' +
        '<div class="today-head"><span class="today-title">Today&#8217;s session</span><span class="today-count">' + (idx + 1) + " of " + sessions.length + "</span></div>" +
        '<div class="td-moves">' + rows + "</div>" +
        '<button class="btn' + (allDone ? " primary" : "") + ' wide" id="nextSessionBtn">' + (allDone ? "Session done &#8212; next session &#8594;" : "Skip to next session &#8594;") + "</button>" +
        "</div>");
    } else {
      parts.push('<button class="today-card setup" id="setupRoutineBtn">' +
        '<span class="today-title">&#43; Set up a weekly routine</span>' +
        '<span class="today-sub">Get a &#8220;today&#8217;s session&#8221; plan across your week.</span></button>');
    }

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
      saveState();
      renderToday();
      toast("Next session ready");
    });
    var setup = $("#setupRoutineBtn", host);
    if (setup) setup.addEventListener("click", openSettings);
  }

  /* ---------- Sheet navigation (in-app stack, no browser history) ---------- */

  var uiStack = [];
  var hideTimer = null;
  var openedAt = 0;
  var lastViewKey = null;

  function sameView(v, w) { return !!w && v.t === w.t && v.a === w.a && v.s === w.s; }

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

  // Draft for the in-progress log/edit form, so re-renders keep values.
  var logDraft = { key: "", sets: [], note: "", editId: null };

  function openLog(areaIdx, stepIdx) {
    var step = AREAS[areaIdx].steps[stepIdx];
    logDraft = { key: areaIdx + ":" + stepIdx, sets: [], note: "", editId: null };
    var rows = step.timed ? 1 : 2;
    for (var i = 0; i < rows; i++) logDraft.sets.push("");
    pushView({ t: "log", a: areaIdx, s: stepIdx });
  }

  function openEditSession(id) {
    var e = null;
    state.log.forEach(function (x) { if (x.id === id) e = x; });
    if (!e) return;
    var ai = areaIndexById(e.areaId);
    logDraft = { key: "edit:" + id, sets: e.sets.map(String), note: e.note || "", editId: id };
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
      if (target) { target.sets = sets; target.note = logDraft.note; saveState(); }
      logDraft = { key: "", sets: [], note: "", editId: null };
      refresh();
      goBack();
      toast("Session updated ✓");
      return;
    }

    var isCurrent = state.areas[a.id].step === n;
    var prevStd = state.areas[a.id].std;
    addLogEntry(a.id, n, sets, logDraft.note);

    var msg = "Session logged ✓";
    if (isCurrent) {
      var det = detectStandard(step, sets);
      if (det > prevStd) {
        state.areas[a.id].std = det;
        checkMaster(a.id);
        saveState();
        recordSnapshot();
        var label = step.standards[det - 1].label;
        msg = (det === 3 && n < 10) ? (label + " standard met — ready to move up!") : (label + " standard met!");
      }
    }
    logDraft = { key: "", sets: [], note: "" };
    refresh();
    goBack(); // back to the step detail, which now reflects any new standard
    toast(msg);
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
    var viewKey = view.t + ":" + (view.a != null ? view.a : "") + ":" + (view.s != null ? view.s : "");
    var prevBody = $(".sheet-body", sheet);
    var keepScroll = (viewKey === lastViewKey && prevBody) ? prevBody.scrollTop : 0;

    if (view.t === "area") sheet.innerHTML = areaPaneHTML(view.a);
    else if (view.t === "step") sheet.innerHTML = stepPaneHTML(view.a, view.s);
    else if (view.t === "log") sheet.innerHTML = logPaneHTML(view.a, view.s);
    else if (view.t === "history") sheet.innerHTML = historyPaneHTML();
    else if (view.t === "stats") sheet.innerHTML = statsPaneHTML();
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
      var targets = step.standards.map(function (s) { return s.target.replace(/\s*\(each side\)/, ""); }).join(" &#8594; ");
      return '<button class="rung' + cls + '" data-step="' + i + '" style="--area:' + areaColorVar(a) + '">' +
        '<span class="num">' + numHTML + "</span>" +
        '<span class="info"><span class="nm">' + esc(step.name) + tags + "</span>" +
        '<span class="tg">' + targets + (step.perSide ? " · each side" : "") + (step.timed ? " · timed hold" : "") + "</span></span>" +
        '<span class="chev">&#8250;</span></button>';
    }).join("");

    return sheetHead({
      title: a.icon + " " + esc(a.name),
      sub: esc(a.tagline),
      areaColor: areaColorVar(a),
      back: false
    }) + '<div class="sheet-body"><div class="ladder">' + rows + "</div></div>";
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
            '<button class="hopen" data-id="' + esc(e.id) + '" aria-label="Edit this session">' +
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

  /* ---------- Sparkline (per-exercise, top set over time) ---------- */

  function sparklineSVG(entries) {
    var arr = entries.slice().reverse().map(topSet); // oldest -> newest
    if (arr.length < 2) return "";
    var w = 240, h = 46, pad = 5;
    var max = Math.max.apply(null, arr), min = Math.min.apply(null, arr);
    var range = (max - min) || 1;
    var pts = arr.map(function (v, i) {
      var x = pad + (w - 2 * pad) * (i / (arr.length - 1));
      var y = h - pad - (h - 2 * pad) * ((v - min) / range);
      return { x: x, y: y, v: v };
    });
    var line = pts.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
    var dots = pts.map(function (p, i) {
      var lbl = (i === 0 || i === pts.length - 1) ? '<text class="spark-lbl" x="' + p.x.toFixed(1) + '" y="' + (p.y - 6).toFixed(1) + '" text-anchor="' + (i === 0 ? "start" : "end") + '">' + p.v + "</text>" : "";
      return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.6"/>' + lbl;
    }).join("");
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" role="img" aria-label="Top set over time"><polyline points="' + line + '"/>' + dots + "</svg>";
  }

  /* ---------- Stats / progress pane ---------- */

  function statCard(value, label) {
    return '<div class="statcard"><span class="statval">' + value + '</span><span class="statlab">' + esc(label) + "</span></div>";
  }

  function heatmapSVG() {
    var counts = trainingDaySet();
    var weeks = 26, cell = 13, size = 10;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var startOfWeek = new Date(today.getTime() - today.getDay() * 86400000);
    var start = new Date(startOfWeek.getTime() - (weeks - 1) * 7 * 86400000);
    var wpx = weeks * cell, hpx = 7 * cell;
    var rects = "";
    for (var w = 0; w < weeks; w++) {
      for (var dd = 0; dd < 7; dd++) {
        var day = new Date(start.getTime() + (w * 7 + dd) * 86400000);
        if (day.getTime() > today.getTime()) continue;
        var key = dateStr(day.getTime());
        var c = counts[key] || 0;
        var lvl = c === 0 ? 0 : (c >= 4 ? 4 : c);
        var fill = c === 0 ? "var(--grid)" : "color-mix(in srgb, var(--good) " + (25 + lvl * 18) + "%, var(--surface))";
        rects += '<rect x="' + (w * cell) + '" y="' + (dd * cell) + '" width="' + size + '" height="' + size + '" rx="2" fill="' + fill + '"><title>' + key + ": " + c + " session" + (c === 1 ? "" : "s") + "</title></rect>";
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
        ? ("Mastered " + a.name + " &#8212; all ten steps!")
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
      statCard(cur, cur === 1 ? "day streak" : "day streak") +
      statCard(lng, "longest streak") +
      statCard(totalSessions, totalSessions === 1 ? "session" : "sessions") +
      statCard(daysTrained, daysTrained === 1 ? "day trained" : "days trained") +
      "</div>";
    return sheetHead({ title: "&#128202; Progress", sub: "", back: false }) +
      '<div class="sheet-body stats">' +
      cards +
      "<h4>Training calendar</h4>" + heatmapSVG() +
      '<p class="hm-legend">Less <span class="hm-l hm-l0"></span><span class="hm-l hm-l1"></span><span class="hm-l hm-l2"></span><span class="hm-l hm-l3"></span><span class="hm-l hm-l4"></span> More</p>' +
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

  function settingsPaneHTML() {
    var url = shareURL();
    var routineChips = '<button class="chip' + (!state.routine.enabled ? " sel" : "") + '" data-routine="off">Off</button>' +
      [2, 3, 6].map(function (d) {
        return '<button class="chip' + ((state.routine.enabled && state.routine.daysPerWeek === d) ? " sel" : "") + '" data-routine="' + d + '">' + d + " days/week</button>";
      }).join("");
    return sheetHead({ title: "&#9881;&#65039; Settings &amp; backup", sub: "", back: false }) +
      '<div class="sheet-body settings">' +
      "<h4>Weekly routine</h4>" +
      "<p>Get a &#8220;today&#8217;s session&#8221; plan on the home screen. Pick how many days a week you train and the app spreads the six movements across them.</p>" +
      '<div class="chips">' + routineChips + "</div>" +
      '<div class="routine-preview">' + routinePreviewHTML() + "</div>" +
      "<h4>Move progress between devices</h4>" +
      "<p>Your progress lives only in this browser. To carry it to another device, copy this backup link and open it there — or paste a link from another device below.</p>" +
      '<div class="copyrow"><input type="text" readonly id="shareUrl" value="' + esc(url) + '"><button class="btn" id="copyBtn">Copy</button></div>' +
      '<div class="btnrow"><button class="btn" id="qrBtn">&#9636; Show QR code</button></div>' +
      '<div id="qrbox" class="qrbox"></div>' +
      '<div class="copyrow"><input type="text" id="importCode" placeholder="Paste a backup link from another device&#8230;" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn" id="importBtn">Import</button></div>' +
      "<p>The link carries your progress only (which step you're on). For your full training history, use the file backup below.</p>" +
      "<h4>Full backup (progress + history)</h4>" +
      "<p>Download a file with everything, including your logged sessions. Keep it somewhere safe, and restore it here on any device.</p>" +
      '<div class="btnrow"><button class="btn" id="downloadBtn">&#11015; Download backup file</button><button class="btn" id="restoreBtn">&#11014; Restore from file</button></div>' +
      '<input type="file" id="restoreFile" accept="application/json,.json" hidden>' +
      "<p>Tip: browsers sometimes clear data for sites you haven't visited in a while, so back up every so often. On iPhone, the installed home-screen app keeps data more reliably than a Safari tab.</p>" +
      "<h4>About</h4>" +
      "<p>Big Six Tracker follows ten-step progressions for the six fundamental bodyweight movements: pushups, squats, pullups, leg raises, bridges and handstand pushups. Each step has three goals — Beginner, Intermediate and Progression.</p>" +
      "<p>Rule of thumb: warm up, work hard on your current step, and only move up once you hit the Progression standard with clean, controlled form.</p>" +
      (storageOk ? "" : "<p><strong>Heads up:</strong> saving is blocked in this browser (private browsing?). Your progress will be lost when you close the tab.</p>") +
      "<h4>Danger zone</h4>" +
      '<button class="btn danger" id="resetBtn">Reset all progress</button>' +
      "</div>";
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
      var saveBtn = $("#saveLog", sheet);
      if (saveBtn) saveBtn.addEventListener("click", function () { saveLog(la, ls); });
    }

    if (view.t === "history") {
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

    if (view.t === "settings") {
      sheet.querySelectorAll("[data-routine]").forEach(function (b) {
        b.addEventListener("click", function () {
          var val = b.getAttribute("data-routine");
          if (val === "off") { state.routine.enabled = false; }
          else { state.routine.enabled = true; state.routine.daysPerWeek = Number(val); state.routine.sessionIndex = 0; }
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
          toast(ok ? "Backup link copied ✓" : "Copy failed — select the text and copy it manually");
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value).then(function () { toast("Backup link copied ✓"); }, fallback);
        } else {
          fallback();
        }
      });
      $("#qrBtn", sheet).addEventListener("click", function () {
        var box = $("#qrbox", sheet);
        if (box.childNodes.length) { box.innerHTML = ""; this.innerHTML = "&#9636; Show QR code"; }
        else { renderQR(box); this.innerHTML = "&#9636; Hide QR code"; }
      });
      $("#importBtn", sheet).addEventListener("click", function () {
        var incoming = decodeBackup($("#importCode", sheet).value);
        if (!incoming) { toast("That doesn't look like a valid backup link"); return; }
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
      if (incoming.areas[a.id]) state.areas[a.id] = incoming.areas[a.id];
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
    if (confirm("Import progress from this backup link? It will replace the progress saved on this device.")) {
      applyImport(incoming);
      history.replaceState(null, "", location.pathname + location.search);
    }
    // On cancel the hash stays, so reloading the page offers the import again.
  }

  // A backup link opened into an already-loaded tab only changes the fragment —
  // no page load happens, so catch it here too.
  window.addEventListener("hashchange", tryImportFromHash);

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
  buildRadar();
  renderCards();
  renderToday();
  recordSnapshot();     // capture today's shape so the ghost radar has history
  updateGhostControl();
  booted = true;

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
