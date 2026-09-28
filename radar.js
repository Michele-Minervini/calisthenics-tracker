/* ============================================================
   Milo — radar charts.

   RADAR.make(svg, opts) draws a radar with any number of axes
   into an <svg>: a tappable wedge per axis, rings, spokes, ring
   numbers, a "ghost" shape (an earlier state, drawn behind), the
   current shape, a dot per axis and a two-line label per axis
   (name, and a small line under it such as "Step 7"). The Skills
   radar (six ladder areas, 0–10) is made with it, and the Body
   radar (six muscle groups, each as a share of its weekly target)
   uses the same factory.

   Axis 0 points straight up and the axes go clockwise on screen.
   Coordinates are written with JavaScript's default number
   formatting — not rounded — exactly as the Skills radar always
   was, so moving it here changed nothing on screen.

   The geometry is plain functions with no DOM, exported for
   tests/radar-test.js. Only make() touches the page, and only
   when it is called, so this file loads in Node too.

   Styling is the page's: every element carries a class (wedge,
   band, band-edge, ring, "ring major", spoke, ringnum, ghost,
   shape, dot, dothit, axis-label, stepnum) that style.css styles.

   Drawn bottom to top: wedges, the band's fill, rings, spokes, the
   band's two edges, ring numbers, ghost, shape, dots (each with its
   tap target), labels. A chart made without `band` has no band
   elements at all, so the Skills radar is drawn exactly as before.

   Usage:
     var chart = RADAR.make(svgElement, {
       axes: [{ id, label, sub, color, onLabel, labelAria, onDot, dotAria }, …],
       max: 10,                 value at the outer ring (default 10)
       rings: 10,               a count (evenly spaced) or a list of values
       majorRings: [5, 10],     ring values drawn slightly stronger
       ringLabels: [2, 4, 6],   values numbered along the top axis, or
                                [{ v: 1, text: "100%" }]; none by default
       band: [from, to],        a shaded ring between two values, in the same
                                units as the values (not fractions of max; with
                                max 1 they're the same), either order, held to
                                0…max: a <path class="band"> (fill-rule evenodd)
                                and two <polygon class="band-edge">, inner then
                                outer. Never takes taps (pointer-events="none"
                                on the elements). Left out: no band elements.
       cx, cy, r,               centre and outer radius (default 210, 196, 134,
                                which fits a 420 × 400 viewBox)
       labelGap: 16,            label distance beyond the outer ring
       labelLine: 12,           name baseline → sub line baseline
       labelUp: 16,             a top label's name above its point
                                (the defaults are the Skills radar's; see labelPlace)
       hitMin,                  a dot's tap target switches off below this value,
                                so targets near the hub don't cover the wedges
                                (default 22 % of max)
       hideEmpty: false,        true: while every value is 0, hide the shape and
                                the dots (they would pile up on the hub)
       ghostStyle: "dashed",    or "solid"
       ariaLabel,               sets the svg's aria-label (else left as it is)
       idPrefix,                if given, elements also get ids: prefix + "shape",
                                "ghost", "dot-" + axis id, "dothit-…", "axstep-…"
       animate: true,           false = changes jump (e.g. reduced motion)
       onHover(i, event), onHoverEnd(i, event)   pointer devices: tooltips
       onPaint(chart)           called after every drawn frame
     });
     chart.paint(values)        draw these values now
     chart.animateTo(values)    ease from what is shown to these (260 ms)
     chart.set(values)          remember as shown, draw nothing yet
     chart.paintGhost(values)   show the ghost at these values; null hides it
     chart.setBand([from, to])  move the band; null (or junk) hides it. Only on
                                a chart made with `band`; otherwise nothing
     chart.setSub(i, text) / setSubs([text…]) / setLabel(i, text)
     chart.setAria(i, text)     the spoken name of axis i's wedge and label
                                (only an axis with onLabel has them)
     chart.values()             what is drawn now (mid-animation: this frame)
     chart.stop()  chart.destroy()
   Callbacks get the axis index: onLabel(i) for the wedge and the label,
   onDot(i) for the dot. An axis without onLabel has no tap target; one
   without onDot has no dot target (the wedge under it still works).
   ============================================================ */

var RADAR = (function () {
  "use strict";

  var BUILD = "milo-v20";

  var SVGNS = "http://www.w3.org/2000/svg";

  /* ---------- Geometry (pure) ----------
     geo = { n: number of axes, cx, cy: centre, r: outer radius, max: value at r } */

  // Axis i of n, in radians: axis 0 at the top (-90°), then clockwise on
  // screen, because SVG's y axis points down.
  function angle(i, n) { return -Math.PI / 2 + i * 2 * Math.PI / n; }

  function polar(cx, cy, radius, a) {
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  }

  // The point on axis i at `radius` pixels from the centre.
  function point(geo, i, radius) { return polar(geo.cx, geo.cy, radius, angle(i, geo.n)); }

  // A value's distance from the centre: 0 at the hub, geo.r at max. Values
  // outside 0..max (and anything that isn't a number) are held to the chart.
  function valueRadius(geo, v) {
    var x = Number(v);
    x = x > 0 ? Math.min(geo.max, x) : 0;
    return geo.r * x / geo.max;
  }

  // "x,y x,y …" for an SVG polygon.
  function pointsAttr(pts) {
    return pts.map(function (p) { return p.join(","); }).join(" ");
  }

  // The shape through values[i] on each axis.
  function shapePoints(geo, values) {
    var pts = [];
    for (var i = 0; i < geo.n; i++) pts.push(point(geo, i, valueRadius(geo, values[i])));
    return pointsAttr(pts);
  }

  // A ring: the polygon through every axis at the same radius.
  function ringPoints(geo, radius) {
    var pts = [];
    for (var i = 0; i < geo.n; i++) pts.push(point(geo, i, radius));
    return pointsAttr(pts);
  }

  // The wedge behind axis i: a triangle from the centre through the two
  // points halfway to the neighbouring axes, at r / cos(half-angle), so the
  // wedges exactly tile the chart.
  function wedgePoints(geo, i) {
    var half = Math.PI / geo.n;
    var far = geo.r / Math.cos(half);
    var a = angle(i, geo.n);
    return pointsAttr([[geo.cx, geo.cy], polar(geo.cx, geo.cy, far, a - half), polar(geo.cx, geo.cy, far, a + half)]);
  }

  // The ring values: `rings` evenly spaced up to max, or the list as given.
  function ringValues(rings, max) {
    if (Array.isArray(rings)) return rings.map(Number);
    var count = Math.max(0, Math.floor(Number(rings) || 0)), out = [];
    for (var k = 1; k <= count; k++) out.push(k * max / count);
    return out;
  }

  // The band between two values: the outer ring, then the inner one, as one
  // SVG path. Filled with fill-rule evenodd it is a ring with a hole. The two
  // values may come in either order; each is held to the chart like a value.
  function bandPath(geo, from, to) {
    var a = valueRadius(geo, from), b = valueRadius(geo, to);
    function sub(radius) { return "M" + ringPoints(geo, radius).split(" ").join(" L") + " Z"; }
    return sub(Math.max(a, b)) + " " + sub(Math.min(a, b));
  }

  // Where axis i's two-line label goes, `gap` pixels beyond the outer ring:
  // anchored away from the chart on the sides, and stacked outward at the
  // top and bottom so the lines never cross the chart. `line` is the
  // distance from the name's baseline to the sub line's (default 12), `up`
  // how far a top label's name sits above its point (default 16). The
  // defaults give the Skills radar's places exactly; bigger text (the Body
  // radar) needs bigger ones. Each offset is worked out first and added
  // once, so the defaults give the very same numbers as the fixed ones did.
  function labelPlace(geo, i, gap, line, up) {
    var L = line == null || !isFinite(Number(line)) ? 12 : Number(line);
    var U = up == null || !isFinite(Number(up)) ? 16 : Number(up);
    var lp = point(geo, i, geo.r + gap);
    var a = angle(i, geo.n), cos = Math.cos(a), sin = Math.sin(a);
    var anchor = "middle";
    if (cos > 0.25) anchor = "start";
    if (cos < -0.25) anchor = "end";
    var x = lp[0] + (cos > 0.25 ? 4 : cos < -0.25 ? -4 : 0);
    var nameY, subY;
    if (sin < -0.5) { nameY = lp[1] - U; subY = lp[1] - (U - L); }
    else if (sin > 0.5) { nameY = lp[1] + L; subY = lp[1] + 2 * L; }
    else { nameY = lp[1] - 1; subY = lp[1] + (L - 1); }
    return { x: x, nameY: nameY, subY: subY, anchor: anchor };
  }

  /* ---------- The chart ---------- */

  function num(x, dflt) { var v = Number(x); return x != null && isFinite(v) ? v : dflt; }

  function el(tag, attrs, text) {
    var node = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    return node;
  }

  // A tap target that also works from the keyboard.
  function pressable(node, fn, label) {
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", label);
    node.addEventListener("click", fn);
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    });
  }

  function make(svg, opts) {
    opts = opts || {};
    var axes = (opts.axes || []).slice();
    var max = num(opts.max, 10) > 0 ? num(opts.max, 10) : 10;
    var geo = { n: axes.length, cx: num(opts.cx, 210), cy: num(opts.cy, 196), r: num(opts.r, 134), max: max };
    var dotR = num(opts.dotR, 6), hitR = num(opts.hitR, 15), gap = num(opts.labelGap, 16);
    var labelLine = num(opts.labelLine, 12), labelUp = num(opts.labelUp, 16);
    var hitMin = num(opts.hitMin, max * 0.22);
    var animate = opts.animate !== false, duration = num(opts.duration, 260);
    var prefix = typeof opts.idPrefix === "string" ? opts.idPrefix : null;
    function idFor(name) { return prefix === null ? null : prefix + name; }

    var dots = [], hits = [], names = [], subs = [], wedges = [], labelGroups = [];
    var bandFill = null, bandEdges = [];
    var shown = [], frame = null;
    var chart;

    // Any list → one finite number per axis.
    function copy(values) {
      return axes.map(function (ax, i) {
        var x = Number(values && values[i]);
        return isFinite(x) ? x : 0;
      });
    }
    function hover(node, i) {
      if (typeof opts.onHover !== "function") return;
      node.addEventListener("mouseenter", function (e) { opts.onHover(i, e); });
      node.addEventListener("mousemove", function (e) { opts.onHover(i, e); });
      node.addEventListener("mouseleave", function (e) { if (opts.onHoverEnd) opts.onHoverEnd(i, e); });
    }
    function tap(fn, i) { return function () { fn(i); }; }

    svg.textContent = "";
    if (opts.ariaLabel) svg.setAttribute("aria-label", opts.ariaLabel);

    // Tappable wedge behind each axis: the whole slice opens that axis.
    axes.forEach(function (ax, i) {
      var wedge = wedges[i] = el("polygon", { points: wedgePoints(geo, i), "class": "wedge" });
      if (typeof ax.onLabel === "function") pressable(wedge, tap(ax.onLabel, i), ax.labelAria || ("Open " + ax.label));
      hover(wedge, i);
      svg.appendChild(wedge);
    });

    // The band, only when asked for: its fill over the wedges and under the
    // rings; its two edges (inner, outer) over the spokes. It is chart
    // chrome, so it never takes a tap: that is set on the elements
    // themselves, not left to the page's CSS.
    var hasBand = opts.band !== undefined && opts.band !== null;
    if (hasBand) {
      bandFill = el("path", { d: "", "class": "band", "fill-rule": "evenodd", "pointer-events": "none" });
      svg.appendChild(bandFill);
    }

    // Rings, then spokes, then the ring numbers along the top axis. All chart
    // chrome is pointer-transparent (CSS), so taps reach the wedges.
    var majors = (opts.majorRings || []).map(Number);
    ringValues(opts.rings != null ? opts.rings : 4, max).forEach(function (v) {
      svg.appendChild(el("polygon", {
        points: ringPoints(geo, valueRadius(geo, v)),
        "class": "ring" + (majors.indexOf(v) !== -1 ? " major" : "")
      }));
    });
    for (var i = 0; i < geo.n; i++) {
      var p = point(geo, i, geo.r);
      svg.appendChild(el("line", { x1: geo.cx, y1: geo.cy, x2: p[0], y2: p[1], "class": "spoke" }));
    }
    if (hasBand) {
      for (var k = 0; k < 2; k++) {
        bandEdges[k] = el("polygon", { points: "", "class": "band-edge", "pointer-events": "none" });
        svg.appendChild(bandEdges[k]);
      }
    }
    // [from, to] as two finite numbers, or null.
    function bandValues(b) {
      if (!Array.isArray(b) || b.length !== 2) return null;
      var f = Number(b[0]), t = Number(b[1]);
      return b[0] !== null && b[1] !== null && isFinite(f) && isFinite(t) ? [f, t] : null;
    }
    function setBand(b) {
      if (!bandFill) return;
      var v = bandValues(b), show = v ? "" : "none";
      bandFill.style.display = show;
      bandEdges.forEach(function (e) { e.style.display = show; });
      if (!v) return;
      var r0 = valueRadius(geo, v[0]), r1 = valueRadius(geo, v[1]);
      bandFill.setAttribute("d", bandPath(geo, v[0], v[1]));
      bandEdges[0].setAttribute("points", ringPoints(geo, Math.min(r0, r1)));
      bandEdges[1].setAttribute("points", ringPoints(geo, Math.max(r0, r1)));
    }
    if (hasBand) setBand(opts.band);

    (opts.ringLabels || []).forEach(function (l) {
      var v = l !== null && typeof l === "object" ? Number(l.v) : Number(l);
      var text = l !== null && typeof l === "object" ? String(l.text) : String(l);
      var pos = point(geo, 0, valueRadius(geo, v));
      svg.appendChild(el("text", { x: pos[0] + 5, y: pos[1] + 3, "class": "ringnum" }, text));
    });

    // The ghost (drawn behind), then the current shape.
    var ghost = el("polygon", { points: "", "class": "ghost", id: idFor("ghost") });
    if (opts.ghostStyle === "solid") ghost.style.strokeDasharray = "none";
    svg.appendChild(ghost);
    var shape = el("polygon", { points: "", "class": "shape", id: idFor("shape") });
    svg.appendChild(shape);

    // A dot per axis, each with a larger invisible tap target.
    axes.forEach(function (ax, i) {
      dots[i] = el("circle", { r: dotR, fill: ax.color, "class": "dot", id: idFor("dot-" + ax.id) });
      svg.appendChild(dots[i]);
      if (typeof ax.onDot !== "function") return;
      hits[i] = el("circle", { r: hitR, "class": "dothit", id: idFor("dothit-" + ax.id) });
      pressable(hits[i], tap(ax.onDot, i), ax.dotAria || ("Open " + ax.label));
      hover(hits[i], i);
      svg.appendChild(hits[i]);
    });

    // Labels: the name, and a smaller line under it.
    axes.forEach(function (ax, i) {
      var at = labelPlace(geo, i, gap, labelLine, labelUp);
      var g = labelGroups[i] = el("g", { "class": "axis-label" });
      names[i] = el("text", { x: at.x, y: at.nameY, "text-anchor": at.anchor }, ax.label == null ? "" : String(ax.label));
      subs[i] = el("text", { x: at.x, y: at.subY, "text-anchor": at.anchor, "class": "stepnum", id: idFor("axstep-" + ax.id) },
        ax.sub == null ? "" : String(ax.sub));
      g.appendChild(names[i]);
      g.appendChild(subs[i]);
      if (typeof ax.onLabel === "function") pressable(g, tap(ax.onLabel, i), ax.labelAria || ("Open " + ax.label));
      svg.appendChild(g);
    });

    function draw() {
      var pts = [];
      for (var i = 0; i < geo.n; i++) {
        var pos = point(geo, i, valueRadius(geo, shown[i]));
        pts.push(pos);
        dots[i].setAttribute("cx", pos[0]);
        dots[i].setAttribute("cy", pos[1]);
        var hit = hits[i];
        if (!hit) continue;
        hit.setAttribute("cx", pos[0]);
        hit.setAttribute("cy", pos[1]);
        // Near the hub the tap targets would stack on top of each other and
        // steal taps from the wedges: off until the dot clears the centre.
        hit.setAttribute("r", shown[i] >= hitMin ? hitR : 0);
      }
      shape.setAttribute("points", pointsAttr(pts));
      // hideEmpty: with every value at 0 there is no shape to show, only
      // the dots piled on the hub, so both are hidden until one isn't 0.
      if (opts.hideEmpty) {
        var show = shown.some(function (v) { return v > 0; }) ? "" : "none";
        shape.style.display = show;
        dots.forEach(function (d) { d.style.display = show; });
      }
      if (typeof opts.onPaint === "function") opts.onPaint(chart);
    }

    // A running animation keeps writing its own frames: set() and paint()
    // don't stop it; animateTo() restarts from whatever is shown, stop() ends it.
    function stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    }
    function animateTo(values) {
      var targets = copy(values);
      if (!animate) { shown = targets; draw(); return; }
      var from = shown.length ? shown.slice() : targets.slice();
      var t0 = performance.now();
      stop();
      function tick(now) {
        var t = Math.min(1, (now - t0) / duration);
        var e = 1 - Math.pow(1 - t, 3);
        shown = from.map(function (v, i) { return v + (targets[i] - v) * e; });
        draw();
        frame = t < 1 ? requestAnimationFrame(tick) : null;
      }
      frame = requestAnimationFrame(tick);
    }

    chart = {
      geo: geo,
      paint: function (values) { if (values) shown = copy(values); draw(); },
      animateTo: animateTo,
      set: function (values) { shown = copy(values); },
      values: function () { return shown.slice(); },
      paintGhost: function (values) {
        if (!values) { ghost.style.display = "none"; return; }
        ghost.setAttribute("points", shapePoints(geo, copy(values)));
        ghost.style.display = "";
      },
      setSub: function (i, text) { if (subs[i]) subs[i].textContent = text == null ? "" : String(text); },
      setSubs: function (list) { (list || []).forEach(function (t, i) { chart.setSub(i, t); }); },
      setLabel: function (i, text) { if (names[i]) names[i].textContent = text == null ? "" : String(text); },
      // The spoken name of axis i's wedge and label (e.g. "Chest: 8 sets.
      // Open Chest"), for charts whose values change after make(). Only an
      // axis with onLabel has them.
      setAria: function (i, text) {
        if (!axes[i] || typeof axes[i].onLabel !== "function") return;
        var t = text == null ? "" : String(text);
        wedges[i].setAttribute("aria-label", t);
        labelGroups[i].setAttribute("aria-label", t);
      },
      setBand: setBand,
      stop: stop,
      destroy: function () { stop(); svg.textContent = ""; }
    };
    return chart;
  }

  return {
    BUILD: BUILD,
    make: make,
    angle: angle,
    polar: polar,
    point: point,
    valueRadius: valueRadius,
    pointsAttr: pointsAttr,
    shapePoints: shapePoints,
    ringPoints: ringPoints,
    wedgePoints: wedgePoints,
    ringValues: ringValues,
    bandPath: bandPath,
    labelPlace: labelPlace
  };
})();
