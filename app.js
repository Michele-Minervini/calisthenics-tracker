/* ============================================================
   Big Six Tracker — app logic
   Plain JavaScript, no dependencies.
   State shape: { v: 1, areas: { [areaId]: { step: 1..10, std: 0..3 } } }
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

  /* ---------- State ---------- */

  var memoryFallback = null;
  var storageOk = true;

  function defaultState() {
    var areas = {};
    AREAS.forEach(function (a) { areas[a.id] = { step: 1, std: 0 }; });
    return { v: 1, areas: areas };
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

  function sanitizeState(s) {
    if (!s || typeof s !== "object" || !s.areas) return null;
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
    return out;
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

  function esc(s) {
    return String(s).replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      "<h4>How to do it</h4><ol class=\"howlist\">" + how + "</ol>" +
      "<h4>If it's too hard</h4><div class=\"hintbox\">" + esc(step.easier) + "</div>" +
      '<h4>See it done</h4><a class="videolink" target="_blank" rel="noopener" href="' + videoURL(a, step) + '">&#9654; Watch demos on YouTube</a>' +
      "</div></div>";
  }

  /* ---------- Settings pane ---------- */

  function settingsPaneHTML() {
    var url = shareURL();
    return sheetHead({ title: "&#9881;&#65039; Settings &amp; backup", sub: "", back: false }) +
      '<div class="sheet-body settings">' +
      "<h4>Move progress between devices</h4>" +
      "<p>Your progress lives only in this browser. To carry it to another device, copy this backup link and open it there — or paste a link from another device below.</p>" +
      '<div class="copyrow"><input type="text" readonly id="shareUrl" value="' + esc(url) + '"><button class="btn" id="copyBtn">Copy</button></div>' +
      '<div class="copyrow"><input type="text" id="importCode" placeholder="Paste a backup link from another device&#8230;" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn" id="importBtn">Import</button></div>' +
      "<p>Tip: browsers sometimes clear data for sites you haven't visited in a while, so copy a backup link every so often. On iPhone, the installed home-screen app keeps data more reliably than a Safari tab.</p>" +
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
    return '<div class="sheet-head"' + (o.areaColor ? ' style="--area:' + o.areaColor + '"' : "") + ">" +
      (o.back ? '<button class="back" id="backBtn" aria-label="Back to step list">&#8249; Steps</button>' : "") +
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
      sheet.querySelectorAll(".chip").forEach(function (c) {
        c.addEventListener("click", function () {
          state.areas[a.id].std = Number(c.getAttribute("data-std"));
          saveState();
          refresh();
          renderSheet();
        });
      });
      var setBtn = $("#setCurrentBtn", sheet);
      if (setBtn) setBtn.addEventListener("click", function () {
        state.areas[a.id].step = view.s + 1;
        state.areas[a.id].std = 0;
        saveState();
        refresh();
        renderSheet();
        toast(a.name + ": current step set to " + (view.s + 1));
      });
      var adv = $("#advanceBtn", sheet);
      if (adv) adv.addEventListener("click", function () {
        state.areas[a.id].step = view.s + 2;
        state.areas[a.id].std = 0;
        saveState();
        refresh();
        // Show the newly-current step in place of this one
        uiStack[uiStack.length - 1] = { t: "step", a: view.a, s: view.s + 1 };
        renderSheet();
        toast("Moved up! Now on Step " + (view.s + 2) + ".");
      });
    }

    if (view.t === "settings") {
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
      $("#importBtn", sheet).addEventListener("click", function () {
        var incoming = decodeBackup($("#importCode", sheet).value);
        if (!incoming) { toast("That doesn't look like a valid backup link"); return; }
        if (confirm("Import this progress? It will replace the progress saved on this device.")) {
          applyImport(incoming);
          renderSheet();
        }
      });
      $("#resetBtn", sheet).addEventListener("click", function () {
        if (confirm("Reset ALL progress on this device? This cannot be undone.")) {
          state = defaultState();
          saveState();
          refresh();
          renderSheet();
          toast("Progress reset");
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

  function applyImport(incoming) {
    state = incoming;
    saveState();
    displayVals = AREAS.map(function (a) { return areaValue(a.id); });
    if (booted) { paintRadar(); renderCards(); }
    toast("Progress imported ✓");
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
  }

  $("#cards").addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (card) openArea(Number(card.getAttribute("data-area")));
  });

  tryImportFromHash();
  buildRadar();
  renderCards();
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
