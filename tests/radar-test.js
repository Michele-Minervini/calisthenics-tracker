/* radar.js: the geometry every radar is drawn with, and the chart the
   factory builds from it.
   - With six axes the geometry must give exactly the strings the Skills
     radar drew before it moved into radar.js (the old formulas are copied
     below as the reference), so nothing on screen moved.
   - With 3 to 8 axes: axis 0 at the top, the rest clockwise, evenly spaced,
     wedges that tile the chart, labels anchored away from it.
   - The chart itself, on a tiny stand-in for the page's DOM.
   Run with: sh tests/run.sh   (or: node tests/radar-test.js) */

const h = require("./harness");
const { check, same, section } = h;
const J = JSON.stringify;

/* ---------- A tiny DOM: just what radar.js uses ---------- */

function fakeDocument() {
  function node(tag) {
    const attrs = new Map(), listeners = {}, children = [];
    let text = "";
    const n = {
      tagName: tag, children, style: {}, listeners,
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      attrNames() { return Array.from(attrs.keys()); },
      appendChild(c) { children.push(c); return c; },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || { key: "", preventDefault() {} })); },
      get textContent() { return children.length ? children.map(c => c.textContent).join("") : text; },
      set textContent(v) { children.length = 0; text = String(v); },
      all(cls) {
        const out = [];
        (function walk(x) {
          x.children.forEach(c => {
            if ((" " + (c.getAttribute("class") || "") + " ").indexOf(" " + cls + " ") !== -1) out.push(c);
            walk(c);
          });
        })(n);
        return out;
      }
    };
    return n;
  }
  return { createElementNS: (ns, tag) => node(tag), node };
}

// Animation frames and the clock, driven by hand.
function fakeFrames() {
  let queue = [], id = 0, now = 1000;
  return {
    requestAnimationFrame(cb) { queue.push({ id: ++id, cb }); return id; },
    cancelAnimationFrame(i) { queue = queue.filter(q => q.id !== i); },
    performance: { now: () => now },
    pending: () => queue.length,
    run(t) { const q = queue; queue = []; q.forEach(x => x.cb(t)); }
  };
}

const doc = fakeDocument();
const frames = fakeFrames();
const page = h.load(["radar.js"], {
  globals: {
    document: doc,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    performance: frames.performance
  }
});
const RADAR = page.get("RADAR");

/* ---------- The Skills radar's old geometry (app.js before radar.js) ---------- */

const CX = 210, CY = 196, R = 134;
function axisAngle(i) { return -Math.PI / 2 + i * Math.PI / 3; }
function polar(angleIdx, radius) {
  const a = axisAngle(angleIdx);
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}
function polarAt(angleRad, radius) {
  return [CX + radius * Math.cos(angleRad), CY + radius * Math.sin(angleRad)];
}
const oldWedge = i => {
  const RW = R / Math.cos(Math.PI / 6);
  return CX + "," + CY + " " + polarAt(axisAngle(i) - Math.PI / 6, RW).join(",") + " " +
    polarAt(axisAngle(i) + Math.PI / 6, RW).join(",");
};
const oldRing = ring => { const p = []; for (let i = 0; i < 6; i++) p.push(polar(i, R * ring / 10).join(",")); return p.join(" "); };
const oldShape = vals => vals.map((v, i) => polar(i, R * Math.max(0, Math.min(10, v)) / 10).join(",")).join(" ");
function oldLabel(i) {
  const lp = polar(i, R + 16);
  let anchor = "middle";
  const cos = Math.cos(axisAngle(i)), sin = Math.sin(axisAngle(i));
  if (cos > 0.25) anchor = "start";
  if (cos < -0.25) anchor = "end";
  const lx = lp[0] + (cos > 0.25 ? 4 : cos < -0.25 ? -4 : 0);
  let nameY, stepY;
  if (sin < -0.5) { nameY = lp[1] - 16; stepY = lp[1] - 4; }
  else if (sin > 0.5) { nameY = lp[1] + 12; stepY = lp[1] + 24; }
  else { nameY = lp[1] - 1; stepY = lp[1] + 11; }
  return { x: lx, nameY, subY: stepY, anchor };
}

const skills = { n: 6, cx: 210, cy: 196, r: 134, max: 10 };

section("six axes: exactly what the Skills radar drew before");
check("build stamp is a string", typeof RADAR.BUILD === "string" && RADAR.BUILD.length > 0);
for (let i = 0; i < 6; i++) {
  check("axis " + i + ": same angle", RADAR.angle(i, 6) === axisAngle(i), RADAR.angle(i, 6) + " vs " + axisAngle(i));
  check("axis " + i + ": same wedge", RADAR.wedgePoints(skills, i) === oldWedge(i), RADAR.wedgePoints(skills, i) + "\n       " + oldWedge(i));
  check("axis " + i + ": same spoke end", same(RADAR.point(skills, i, 134), polar(i, R)));
  check("axis " + i + ": same label place", same(RADAR.labelPlace(skills, i, 16), oldLabel(i)), J(RADAR.labelPlace(skills, i, 16)) + " vs " + J(oldLabel(i)));
}
const rings = RADAR.ringValues(10, 10);
check("rings: 1 to 10, one per step", same(rings, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), J(rings));
rings.forEach(v => {
  check("ring " + v + ": same polygon", RADAR.ringPoints(skills, RADAR.valueRadius(skills, v)) === oldRing(v));
});
[2, 4, 6, 8, 10].forEach(n => {
  check("ring number " + n + ": same place", same(RADAR.point(skills, 0, RADAR.valueRadius(skills, n)), polar(0, R * n / 10)));
});
[
  [0, 0, 0, 0, 0, 0],
  [10, 10, 10, 10, 10, 10],
  [20 / 3, 10 / 3, 10, 4 / 3, 0, 4],
  [0.3333333333333333, 2.2, 9.999, 5.5, 7.25, 1e-9],
  [-3, 12, 5, -0, 10.0000001, 3]          // out of range: held to the chart, as before
].forEach(vals => {
  check("shape through " + J(vals) + ": same points", RADAR.shapePoints(skills, vals) === oldShape(vals),
    RADAR.shapePoints(skills, vals) + "\n       " + oldShape(vals));
});
check("numbers are not rounded (as before): the right corner of the pull-up wedge",
  RADAR.wedgePoints(skills, 1) === "210,196 287.36493607140983,62 364.72987214281966,195.99999999999997",
  RADAR.wedgePoints(skills, 1));

section("3 to 8 axes");
for (let n = 3; n <= 8; n++) {
  const geo = { n, cx: 100, cy: 120, r: 80, max: 1.25 };
  const top = RADAR.point(geo, 0, 80);
  check(n + " axes: axis 0 points straight up", Math.abs(top[0] - 100) < 1e-9 && Math.abs(top[1] - 40) < 1e-9, J(top));
  const p1 = RADAR.point(geo, 1, 80);
  check(n + " axes: axis 1 is clockwise from it (to the right on screen)", p1[0] > 100 + 1e-6, J(p1));
  let even = true, onCircle = true;
  for (let i = 0; i < n; i++) {
    const step = RADAR.angle((i + 1) % n === 0 ? n : i + 1, n) - RADAR.angle(i, n);
    if (Math.abs(step - 2 * Math.PI / n) > 1e-12) even = false;
    const p = RADAR.point(geo, i, 80);
    if (Math.abs(Math.hypot(p[0] - 100, p[1] - 120) - 80) > 1e-9) onCircle = false;
  }
  check(n + " axes: evenly spaced, all on the outer ring", even && onCircle);
  const shape = RADAR.shapePoints(geo, new Array(n).fill(1.25)).split(" ");
  check(n + " axes: a full shape has one point per axis, on the outer ring's corners",
    shape.length === n && shape.join(" ") === RADAR.ringPoints(geo, 80));
  const half = RADAR.shapePoints(geo, new Array(n).fill(0.625)).split(" ").map(s => s.split(",").map(Number));
  check(n + " axes: half the max is half the radius",
    half.every(p => Math.abs(Math.hypot(p[0] - 100, p[1] - 120) - 40) < 1e-9));
  // Wedges tile the chart: each one's far edge meets the next one's near edge.
  let tiles = true;
  for (let i = 0; i < n; i++) {
    const a = RADAR.wedgePoints(geo, i).split(" ").map(s => s.split(",").map(Number));
    const b = RADAR.wedgePoints(geo, (i + 1) % n).split(" ").map(s => s.split(",").map(Number));
    if (a.length !== 3 || a[0][0] !== 100 || a[0][1] !== 120) tiles = false;
    if (Math.hypot(a[2][0] - b[1][0], a[2][1] - b[1][1]) > 1e-9) tiles = false;
  }
  check(n + " axes: wedges start at the centre and tile the chart", tiles);
  const topLabel = RADAR.labelPlace(geo, 0, 16);
  check(n + " axes: the top label is centred and stacked above the chart",
    topLabel.anchor === "middle" && topLabel.nameY < topLabel.subY && topLabel.subY < 40, J(topLabel));
  let sides = true;
  for (let i = 0; i < n; i++) {
    const l = RADAR.labelPlace(geo, i, 16), c = Math.cos(RADAR.angle(i, n));
    const want = c > 0.25 ? "start" : c < -0.25 ? "end" : "middle";
    if (l.anchor !== want) sides = false;
    if (Math.abs(l.subY - l.nameY - 12) > 1e-9) sides = false;
  }
  check(n + " axes: side labels anchored away from the chart; sub line 12 px under the name", sides);
}

section("values, rings, point strings");
const g = { n: 4, cx: 0, cy: 0, r: 100, max: 1.25 };
check("a value's radius: 0 at the hub, r at max",
  RADAR.valueRadius(g, 0) === 0 && RADAR.valueRadius(g, 1.25) === 100 && RADAR.valueRadius(g, 0.625) === 50);
check("out-of-range and junk values are held to the chart",
  RADAR.valueRadius(g, -1) === 0 && RADAR.valueRadius(g, 9) === 100 &&
  RADAR.valueRadius(g, NaN) === 0 && RADAR.valueRadius(g, undefined) === 0 && RADAR.valueRadius(g, null) === 0 &&
  RADAR.valueRadius(g, "0.625") === 50);
check("ring count: evenly spaced up to max", same(RADAR.ringValues(5, 1.25), [0.25, 0.5, 0.75, 1, 1.25]));
check("ring list: taken as given", same(RADAR.ringValues([1, 0.5], 1.25), [1, 0.5]));
check("no rings", same(RADAR.ringValues(0, 10), []) && same(RADAR.ringValues(undefined, 10), []));
check("point string: \"x,y x,y\" with plain number formatting",
  RADAR.pointsAttr([[1, 2], [3.5, -0.25]]) === "1,2 3.5,-0.25");
check("a shape with fewer values than axes puts the missing ones at the hub",
  RADAR.shapePoints(g, [1.25]) === RADAR.pointsAttr([RADAR.point(g, 0, 100), [0, 0], [0, 0], [0, 0]]));

section("the chart (on a stand-in DOM)");
{
  const svg = doc.node("svg");
  svg.appendChild(doc.node("old"));        // whatever was there is replaced
  const calls = [];
  const axes = ["chest", "back", "abs", "legs", "arms"].map((id, i) => ({
    id, label: id.toUpperCase(), sub: i === 0 ? "first" : undefined, color: "var(--g-" + id + ")",
    onLabel: k => calls.push("label " + k),
    onDot: i === 1 ? null : k => calls.push("dot " + k),
    dotAria: "Dot " + id
  }));
  let painted = 0;
  const chart = RADAR.make(svg, {
    axes, max: 1.25, rings: 5, majorRings: [1], ringLabels: [{ v: 1, text: "100%" }, 0.5],
    cx: 100, cy: 100, r: 80, ariaLabel: "Body radar",
    onHover: (k, e) => calls.push("hover " + k + " " + e.x), onHoverEnd: k => calls.push("leave " + k),
    onPaint: c => { painted++; c.setSub(4, "painted " + painted); }
  });
  const geo = { n: 5, cx: 100, cy: 100, r: 80, max: 1.25 };
  const byClass = c => svg.all(c);
  check("the old content is gone", !svg.children.some(c => c.tagName === "old"));
  check("svg gets the aria label", svg.getAttribute("aria-label") === "Body radar");
  check("5 wedges, 5 rings (one major), 5 spokes, 2 ring numbers",
    byClass("wedge").length === 5 && byClass("ring").length === 5 && byClass("major").length === 1 &&
    byClass("spoke").length === 5 && byClass("ringnum").length === 2,
    [byClass("wedge").length, byClass("ring").length, byClass("major").length, byClass("spoke").length, byClass("ringnum").length].join(" "));
  check("ring at 1 (100%) is the major one",
    byClass("major")[0].getAttribute("points") === RADAR.ringPoints(geo, 64));
  check("ring numbers: text and place", byClass("ringnum")[0].textContent === "100%" &&
    byClass("ringnum")[0].getAttribute("x") === String(RADAR.point(geo, 0, 64)[0] + 5) &&
    byClass("ringnum")[1].textContent === "0.5");
  check("one ghost and one shape, in that order, no ids without idPrefix",
    byClass("ghost").length === 1 && byClass("shape").length === 1 &&
    svg.children.indexOf(byClass("ghost")[0]) < svg.children.indexOf(byClass("shape")[0]) &&
    !byClass("ghost")[0].hasAttribute("id") && !byClass("dot")[0].hasAttribute("id"));
  check("a dot per axis, coloured; a tap target only where onDot is given",
    byClass("dot").length === 5 && byClass("dot")[2].getAttribute("fill") === "var(--g-abs)" && byClass("dothit").length === 4);
  const labels = byClass("axis-label");
  check("labels: name and sub line", labels.length === 5 && labels[0].children[0].textContent === "CHEST" &&
    labels[0].children[1].textContent === "first" && labels[1].children[1].textContent === "");
  check("wedges and labels are buttons named from the label",
    byClass("wedge")[3].getAttribute("role") === "button" && byClass("wedge")[3].getAttribute("tabindex") === "0" &&
    byClass("wedge")[3].getAttribute("aria-label") === "Open LEGS" && labels[3].getAttribute("aria-label") === "Open LEGS");
  byClass("wedge")[3].fire("click");
  labels[2].fire("keydown", { key: "Enter", preventDefault() {} });
  labels[2].fire("keydown", { key: "a", preventDefault() {} });
  byClass("dothit")[0].fire("keydown", { key: " ", preventDefault() {} });
  byClass("wedge")[4].fire("mouseenter", { x: 7 });
  byClass("wedge")[4].fire("mouseleave", {});
  check("taps, keys and hover call back with the axis index",
    same(calls, ["label 3", "label 2", "dot 0", "hover 4 7", "leave 4"]), J(calls));
  check("dot targets are named by dotAria", byClass("dothit")[1].getAttribute("aria-label") === "Dot abs");

  chart.paint([1.25, 0.1, 0.625, 2, "junk"]);
  const dots = byClass("dot"), hits = byClass("dothit");
  check("paint: the shape through the values", byClass("shape")[0].getAttribute("points") ===
    RADAR.shapePoints(geo, [1.25, 0.1, 0.625, 1.25, 0]));
  check("paint: dots on the shape's corners",
    dots.every((d, i) => d.getAttribute("cx") + "," + d.getAttribute("cy") ===
      byClass("shape")[0].getAttribute("points").split(" ")[i]));
  check("paint: tap targets off near the hub (below 22 % of max), on elsewhere",
    same(hits.map(x => x.getAttribute("r")), ["15", "15", "15", "0"]), J(hits.map(x => x.getAttribute("r"))));
  check("paint: onPaint runs after each frame", painted === 1 && labels[4].children[1].textContent === "painted 1");
  check("values(): what is shown", same(chart.values(), [1.25, 0.1, 0.625, 2, 0]));

  chart.paintGhost([1, 1, 1, 1, 1]);
  const ghost = byClass("ghost")[0];
  check("ghost: shown at its values", ghost.style.display === "" && ghost.getAttribute("points") === RADAR.ringPoints(geo, 64));
  chart.paintGhost(null);
  check("ghost: hidden with null", ghost.style.display === "none");
  check("ghost: dashed by default (the page's CSS)", ghost.style.strokeDasharray === undefined);

  chart.setSubs(["a", "b"]); chart.setLabel(1, "Back");
  check("setSubs / setLabel", labels[0].children[1].textContent === "a" && labels[1].children[1].textContent === "b" &&
    labels[1].children[0].textContent === "Back");

  // Animation: 260 ms, ease-out, from what is shown.
  chart.paint([0, 0, 0, 0, 0]);
  const before = painted;
  chart.animateTo([1, 1, 1, 1, 1]);
  check("animateTo: waits for the next frame", frames.pending() === 1 && painted === before);
  frames.run(1000);
  check("animateTo: first frame still at the start", same(chart.values(), [0, 0, 0, 0, 0]));
  frames.run(1130);
  const mid = chart.values()[0];
  check("animateTo: halfway in time is past halfway in distance (ease-out)", Math.abs(mid - (1 - Math.pow(0.5, 3))) < 1e-12, String(mid));
  chart.set([0.5, 0.5, 0.5, 0.5, 0.5]);
  frames.run(1260);
  check("animateTo: ends exactly on the targets, then stops", same(chart.values(), [1, 1, 1, 1, 1]) && frames.pending() === 0);
  chart.animateTo([0, 0, 0, 0, 0]);
  chart.animateTo([1.25, 1.25, 1.25, 1.25, 1.25]);
  check("animateTo again: the earlier animation is cancelled", frames.pending() === 1);
  chart.stop();
  check("stop(): nothing left to run", frames.pending() === 0);
  chart.destroy();
  check("destroy(): the svg is empty", svg.children.length === 0);
}
{
  const svg = doc.node("svg");
  const chart = RADAR.make(svg, {
    axes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    idPrefix: "body-", animate: false, ghostStyle: "solid"
  });
  check("idPrefix: ids on the ghost, shape, dots and sub lines",
    svg.all("ghost")[0].getAttribute("id") === "body-ghost" && svg.all("shape")[0].getAttribute("id") === "body-shape" &&
    svg.all("dot")[1].getAttribute("id") === "body-dot-b" && svg.all("stepnum")[2].getAttribute("id") === "body-axstep-c");
  check("no onLabel / onDot: nothing is a button, no dot targets",
    svg.all("wedge").every(w => !w.hasAttribute("role")) && svg.all("axis-label").every(l => !l.hasAttribute("role")) &&
    svg.all("dothit").length === 0);
  check("defaults: max 10, four rings, no ring numbers, centre 210,196, radius 134",
    svg.all("ring").length === 4 && svg.all("ringnum").length === 0 &&
    svg.all("ring")[3].getAttribute("points") === RADAR.ringPoints({ n: 3, cx: 210, cy: 196, r: 134, max: 10 }, 134));
  check("ghostStyle solid: no dashes", svg.all("ghost")[0].style.strokeDasharray === "none");
  chart.animateTo([10, 5, 0]);
  check("animate: false jumps at once", frames.pending() === 0 && same(chart.values(), [10, 5, 0]));
}

section("the band (the Body radar's target) and label spacing: geometry");
{
  const body = { n: 6, cx: 200, cy: 178, r: 110, max: 1 };
  const ring = f => RADAR.ringPoints(body, 110 * f);
  const want = "M" + ring(1).split(" ").join(" L") + " Z M" + ring(0.5).split(" ").join(" L") + " Z";
  check("band [0.5, 1]: the outer ring, then the inner one, as one path", RADAR.bandPath(body, 0.5, 1) === want, RADAR.bandPath(body, 0.5, 1));
  check("…spelled out: M x,y L x,y … Z, six corners each",
    /^M[-\d.,]+( L[-\d.,]+){5} Z M[-\d.,]+( L[-\d.,]+){5} Z$/.test(RADAR.bandPath(body, 0.5, 1)));
  check("…its top corner is straight up at the outer radius, then at half of it",
    RADAR.bandPath(body, 0.5, 1).indexOf("M200,68 ") === 0 && RADAR.bandPath(body, 0.5, 1).indexOf(" M200,123 ") !== -1);
  check("either order gives the same band", RADAR.bandPath(body, 1, 0.5) === want);
  check("values are held to the chart: [-1, 3] is the whole chart, with the hub as its hole",
    RADAR.bandPath(body, -1, 3) === "M" + ring(1).split(" ").join(" L") + " Z M" + ring(0).split(" ").join(" L") + " Z");
  const skills = { n: 6, cx: 210, cy: 196, r: 134, max: 10 };
  check("in the chart's own units: [5, 10] on a 0–10 chart is half to the edge",
    RADAR.bandPath(skills, 5, 10) === "M" + RADAR.ringPoints(skills, 134).split(" ").join(" L") + " Z M" + RADAR.ringPoints(skills, 67).split(" ").join(" L") + " Z");

  // Label spacing: the defaults are the Skills radar's fixed numbers.
  for (let i = 0; i < 6; i++) {
    check("axis " + i + ": labelPlace with line 12 and up 16 given = left out = the old one",
      same(RADAR.labelPlace(skills, i, 16, 12, 16), oldLabel(i)) && same(RADAR.labelPlace(skills, i, 16, undefined, null), oldLabel(i)) &&
      same(RADAR.labelPlace(skills, i, 16, "x", NaN), oldLabel(i)));
  }
  // The Body radar: gap 14, line 17, up 21 (the mockup's labelPos).
  const pl = i => { const p = RADAR.point(body, i, 124); return [p[0], p[1]]; };
  const top = RADAR.labelPlace(body, 0, 14, 17, 21), bottom = RADAR.labelPlace(body, 3, 14, 17, 21), side = RADAR.labelPlace(body, 1, 14, 17, 21);
  check("line 17, up 21, top axis: the name 21 above its point, the sub line 17 under the name",
    top.nameY === pl(0)[1] - 21 && top.subY === pl(0)[1] - 4 && top.anchor === "middle" && top.x === pl(0)[0], J(top));
  check("…bottom axis: the name 17 below its point, the sub line 17 under it",
    bottom.nameY === pl(3)[1] + 17 && bottom.subY === pl(3)[1] + 34 && bottom.anchor === "middle", J(bottom));
  check("…side axis: the name 1 above its point, the sub line 16 below; anchored away, 4 px out",
    side.nameY === pl(1)[1] - 1 && side.subY === pl(1)[1] + 16 && side.anchor === "start" && side.x === pl(1)[0] + 4, J(side));
  let gaps = true;
  [[17, 21], [15, 20], [10, 30], [12, 16]].forEach(([line, up]) => {
    for (let i = 0; i < 6; i++) {
      const l = RADAR.labelPlace(body, i, 14, line, up), p = RADAR.point(body, i, 124);
      if (Math.abs(l.subY - l.nameY - line) > 1e-9) gaps = false;
      if (i === 0 && Math.abs(l.nameY - (p[1] - up)) > 1e-9) gaps = false;
    }
  });
  check("every axis, four spacings: the sub line is `line` under the name; the top name `up` above its point", gaps);
}

section("the band, hideEmpty, setAria, setBand: the chart (on a stand-in DOM)");
{
  const svg = doc.node("svg");
  const opened = [];
  const G = ["chest", "back", "abs", "legs", "arms", "shoulders"];
  const chart = RADAR.make(svg, {
    axes: G.map(g => ({ id: g, label: g, sub: "0 sets", color: "var(--g-" + g + ")", onLabel: i => opened.push(i), labelAria: "Open " + g })),
    max: 1, rings: [0.25, 0.75], band: [0.5, 1], cx: 200, cy: 178, r: 110, labelGap: 14, labelLine: 17, labelUp: 21,
    hideEmpty: true, animate: false
  });
  const geo = { n: 6, cx: 200, cy: 178, r: 110, max: 1 };
  const band = svg.all("band"), edges = svg.all("band-edge");
  check("one band path, two edges", band.length === 1 && band[0].tagName === "path" && edges.length === 2 &&
    edges.every(e => e.tagName === "polygon"));
  check("the band's path is bandPath([0.5, 1]), filled even-odd", band[0].getAttribute("d") === RADAR.bandPath(geo, 0.5, 1) &&
    band[0].getAttribute("fill-rule") === "evenodd");
  check("its edges: the inner ring (½), then the outer (the top of the target)",
    edges[0].getAttribute("points") === RADAR.ringPoints(geo, 55) && edges[1].getAttribute("points") === RADAR.ringPoints(geo, 110));
  check("the band never takes a tap", [band[0]].concat(edges).every(e => e.getAttribute("pointer-events") === "none"));
  const kids = svg.children, at = el => kids.indexOf(el);
  const order = [svg.all("wedge")[5], band[0], svg.all("ring")[0], svg.all("spoke")[0], svg.all("spoke")[5], edges[0], edges[1],
    svg.all("ghost")[0], svg.all("shape")[0], svg.all("dot")[0], svg.all("axis-label")[0]].map(at);
  check("drawn bottom to top: wedges, band, rings, spokes, band edges, ghost, shape, dots, labels",
    order.every((x, i) => x >= 0 && (!i || order[i - 1] < x)), J(order));
  check("rings as given (no ring at the band's edges)", svg.all("ring").length === 2 &&
    svg.all("ring")[1].getAttribute("points") === RADAR.ringPoints(geo, 110 * 0.75));
  const labels = svg.all("axis-label");
  const top = RADAR.labelPlace(geo, 0, 14, 17, 21);
  check("labels placed with labelGap 14, labelLine 17, labelUp 21",
    labels[0].children[0].getAttribute("y") === String(top.nameY) && labels[0].children[1].getAttribute("y") === String(top.subY) &&
    labels[3].children[1].getAttribute("y") === String(RADAR.labelPlace(geo, 3, 14, 17, 21).subY));

  chart.paint([0, 0, 0, 0, 0, 0]);
  const shape = svg.all("shape")[0], dots = svg.all("dot");
  check("hideEmpty: all at 0 → no shape, no dots", shape.style.display === "none" && dots.every(d => d.style.display === "none"));
  chart.paint([0.4, 0.5, 0.1, 0, 0.16875, 0.325]);
  check("…one above 0 → both back", shape.style.display === "" && dots.every(d => d.style.display === ""));
  check("…and the shape through the shares", shape.getAttribute("points") === RADAR.shapePoints(geo, [0.4, 0.5, 0.1, 0, 0.16875, 0.325]));
  chart.paint([1.3, 2, 1, 1, 1, 1]);
  check("more than the top sits on the outer ring (max 1)", shape.getAttribute("points") === RADAR.ringPoints(geo, 110));
  chart.paintGhost([0.3, 0.1, 0.025, 0.075, 0.0375, 0.1]);
  check("the ghost (last week so far) under the shape", svg.all("ghost")[0].getAttribute("points") ===
    RADAR.shapePoints(geo, [0.3, 0.1, 0.025, 0.075, 0.0375, 0.1]) && svg.all("ghost")[0].style.strokeDasharray === undefined);

  svg.all("wedge")[3].fire("click");
  labels[5].fire("keydown", { key: "Enter", preventDefault() {} });
  check("tapping a spoke's wedge or its name calls onLabel with the axis index", same(opened, [3, 5]), J(opened));
  chart.setAria(0, "Chest: 8 sets. Open Chest");
  check("setAria names the wedge and the label", svg.all("wedge")[0].getAttribute("aria-label") === "Chest: 8 sets. Open Chest" &&
    labels[0].getAttribute("aria-label") === "Chest: 8 sets. Open Chest" && svg.all("wedge")[1].getAttribute("aria-label") === "Open back");
  chart.setAria(9, "nothing there"); chart.setAria(1, null);
  check("setAria: an axis that isn't there is ignored; null → \"\"", svg.all("wedge")[1].getAttribute("aria-label") === "");

  chart.setBand([0.25, 1]);
  check("setBand moves the band and its edges", band[0].getAttribute("d") === RADAR.bandPath(geo, 0.25, 1) &&
    edges[0].getAttribute("points") === RADAR.ringPoints(geo, 27.5) && band[0].style.display === "");
  chart.setBand([1, 0.4]);
  check("…in either order: the inner edge is still the smaller", edges[0].getAttribute("points") === RADAR.ringPoints(geo, 44) &&
    edges[1].getAttribute("points") === RADAR.ringPoints(geo, 110));
  chart.setBand(null);
  check("setBand(null) hides the band and both edges", band[0].style.display === "none" && edges.every(e => e.style.display === "none"));
  [[0.5], "0.5-1", [0.5, "x"], [null, 1], {}, [0.5, 1, 2]].forEach(b => {
    chart.setBand([0.5, 1]); chart.setBand(b);
    check("setBand(" + J(b) + ") hides it", band[0].style.display === "none");
  });
  chart.setBand(["0.5", "1"]);
  check("…numbers as strings are read", band[0].style.display === "" && band[0].getAttribute("d") === RADAR.bandPath(geo, 0.5, 1));
}
{
  // Made with a band that isn't one: the elements are there, hidden.
  const svg = doc.node("svg");
  RADAR.make(svg, { axes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], band: "junk", animate: false });
  check("band: junk → made, but hidden", svg.all("band").length === 1 && svg.all("band")[0].style.display === "none" &&
    svg.all("band-edge").every(e => e.style.display === "none"));
}
{
  // Without band or hideEmpty (the Skills radar): nothing new is drawn or touched.
  const svg = doc.node("svg");
  const chart = RADAR.make(svg, { axes: ["a", "b", "c", "d", "e", "f"].map(id => ({ id, label: id, onLabel() {} })), max: 10, rings: 10, animate: false });
  chart.paint([0, 0, 0, 0, 0, 0]);
  check("no band option: no band elements; setBand does nothing", svg.all("band").length === 0 && svg.all("band-edge").length === 0 &&
    (chart.setBand([1, 2]), svg.all("band").length === 0));
  check("no hideEmpty: the shape and dots are never hidden, even at 0 (their style is never set)",
    svg.all("shape")[0].style.display === undefined && svg.all("dot").every(d => d.style.display === undefined));
  check("the element sequence is the Skills radar's: 6 wedges, 10 rings, 6 spokes, ghost, shape, 6 dots, 6 labels",
    J(svg.children.map(c => (c.getAttribute("class") || c.tagName).split(" ")[0])) ===
      J([].concat(Array(6).fill("wedge"), Array(10).fill("ring"), Array(6).fill("spoke"), ["ghost", "shape"], Array(6).fill("dot"), Array(6).fill("axis-label"))));
}

h.done(__filename);
