/* Deterministic generator of messy saved states: valid, invalid and borderline
   values, the kind a hand-edited backup, an old device or a bug might produce.
   Same seed → same sequence, so recorded expectations stay comparable. */

function makeGen(seed) {
  let a = seed | 0;
  function rnd() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const maybe = (p, f) => { if (rnd() < p) f(); };
  const T0 = Date.UTC(2026, 2, 20);
  const AREA_IDS = ["pushup", "pullup", "legraise", "squat", "bridge", "hspu", "nope", "", null];
  const VARS = ["Slow Negatives", "Paused Reps", "Plank Hold", "Dead Hangs", "Bogus", "", 3, null];
  // A few near-duplicate timestamps so ties actually happen in merges.
  const anyTs = () => pick([T0, T0 + 1, T0 + 86400000, T0 + Math.floor(rnd() * 1e10)]);
  const anyNum = () => pick([0, 1, -1, 2.4, 2.6, 10, 11, 3, "4", "x", NaN, Infinity, null, undefined, 1e13, anyTs()]);
  const anyId = () => pick(["a1", "a2", "a3", "s" + Math.floor(rnd() * 50).toString(36), "bad id!", "", 5, null, "x".repeat(41), "ok_id-9"]);
  const anyDate = () => pick(["2026-03-29", "2026-10-25", "2026-3-1", "", null, "2026-07-01"]);

  function entry() {
    if (rnd() < 0.05) return pick([null, "str", 3, []]);
    const e = {};
    maybe(0.9, () => { e.areaId = pick(AREA_IDS); });
    e.step = rnd() < 0.7 ? 1 + Math.floor(rnd() * 10) : anyNum();
    maybe(0.95, () => { e.sets = rnd() < 0.1 ? "no" : Array.from({ length: Math.floor(rnd() * 5) }, anyNum); });
    maybe(0.9, () => { e.ts = rnd() < 0.8 ? anyTs() : anyNum(); });
    maybe(0.7, () => { e.date = anyDate(); });
    maybe(0.8, () => { e.id = anyId(); });
    maybe(0.5, () => { e.note = pick(["", "felt good", "x".repeat(300), 7]); });
    maybe(0.6, () => { e.mts = rnd() < 0.7 ? anyTs() : anyNum(); });
    maybe(0.5, () => { e.variant = pick(VARS); });
    return e;
  }

  function state() {
    const r = rnd();
    if (r < 0.03) return pick([null, 1, "s", [], {}]);
    if (r < 0.06) return { areas: pick([[], "x", 3, null]) };
    const s = { areas: {} };
    ["pushup", "pullup", "legraise", "squat", "bridge", "hspu", "extra"].forEach(id => {
      maybe(0.85, () => {
        s.areas[id] = rnd() < 0.1 ? pick(["bad", null, 3])
          : { step: rnd() < 0.7 ? 1 + Math.floor(rnd() * 10) : anyNum(), std: pick([0, 1, 2, 3, 4, -1, 1.5, "2", null]), mts: rnd() < 0.7 ? anyTs() : anyNum() };
      });
    });
    maybe(0.9, () => { s.log = rnd() < 0.05 ? "nope" : Array.from({ length: Math.floor(rnd() * 8) }, entry); });
    maybe(0.8, () => {
      s.settings = rnd() < 0.1 ? 5 : {
        restSeconds: pick([180, 120, 4, 5, 3600, 3601, "90", null, 2.5]),
        ghostBase: pick([null, { d: "2026-08-01", v: [8, 4.3, 3, 4, 1, 0] }, { d: "bad", v: [1] }, { d: "2026-08-01", v: [1, 2, 3] }, { d: "2026-08-01", v: [11, -1, "3", null, 5, 6] }]),
        ghostFrom: pick([undefined, "2026-07-20", "2026-08-02", "bad"])
      };
    });
    maybe(0.8, () => { s.routine = { enabled: pick([true, false, 1, 0, "yes"]), daysPerWeek: pick([2, 3, 6, 4, "6", null]), sessionIndex: pick([0, 1, 5, 49, 50, -1, 2.7, null]) }; });
    maybe(0.7, () => {
      s.snapshots = rnd() < 0.08
        ? Array.from({ length: 399 + Math.floor(rnd() * 4) }, (_, k) => ({ d: "2026-01-01", v: [k % 10, 1, 2, 3, 4, 5] }))
        : Array.from({ length: Math.floor(rnd() * 5) }, () => pick([{ d: anyDate(), v: [1, 2, 3, 4, 5, 6] }, { d: "2026-07-20", v: [1, 2] }, null, { d: "2026-08-01", v: [0, 10, 11, -2, "5", null] }, { d: "2026-07-20", v: [2, 2, 2, 9, 9, 9] }]));
    });
    maybe(0.7, () => {
      s.milestones = rnd() < 0.08
        ? Array.from({ length: 499 + Math.floor(rnd() * 4) }, (_, k) => ({ id: "m" + k, ts: T0 + k, type: "advance", areaId: "pushup", step: 1 + k % 10 }))
        : Array.from({ length: Math.floor(rnd() * 4) }, () => ({ id: pick(["m1", "m2", anyId()]), ts: rnd() < 0.7 ? anyTs() : anyNum(), type: pick(["advance", "master", "pr", null]), areaId: pick(AREA_IDS), step: rnd() < 0.7 ? 1 + Math.floor(rnd() * 10) : anyNum() }));
    });
    maybe(0.7, () => {
      s.deleted = rnd() < 0.08
        ? Array.from({ length: 399 + Math.floor(rnd() * 4) }, (_, k) => ({ id: "d" + k, ts: T0 + k }))
        : Array.from({ length: Math.floor(rnd() * 4) }, () => pick([{ id: anyId(), ts: rnd() < 0.7 ? anyTs() : anyNum() }, null, "x"]));
    });
    maybe(0.6, () => { s.prefsMts = rnd() < 0.7 ? anyTs() : anyNum(); });
    maybe(0.3, () => { s.v = pick([1, 2, 3, 4, 5]); });
    return s;
  }

  /* ---- data v5 shapes: every entry kind, per-field stamps, exercises ---- */

  const GROUPS = ["chest", "back", "shoulders", "arms", "abs", "legs"];
  const PREFS = ["restSeconds", "restGym", "autoRest", "ghostBase", "vol", "keepAwake", "split", "mode", "sessionIndex", "override"];
  // Small pools on purpose, so ids and stamps collide and ties get exercised.
  const smallTs = () => pick([0, 1, T0, T0 + 1, T0 + 2]);
  const logId = () => pick(["g1", "g2", "q1", "b1", "a1", "a2", "s1"]);

  function entry5() {
    const k = rnd();
    if (k < 0.3) { const e = entry(); if (e && typeof e === "object" && !Array.isArray(e)) e.id = logId(); return e; }
    const e = { id: logId(), ts: pick([T0, T0 + 1, T0 + 86400000]), mts: smallTs() };
    maybe(0.3, () => { e.note = pick(["", "heavy", "x".repeat(300)]); });
    if (k < 0.6) {
      e.kind = "gym";
      e.exId = pick(["bench_bb", "row_db", "x_1", "x_2", "bad id!", 3]);
      e.sets = rnd() < 0.05 ? "no" : Array.from({ length: Math.floor(rnd() * 5) }, () => pick([8, 10, 12, 0, -1, 7.6, "9", null, "x"]));
      maybe(0.9, () => { e.kg = Array.from({ length: Math.floor(rnd() * 5) }, () => pick([60, 62.5, "62,5", " 7 ", 62.3, -5, 2000, "abc", null])); });
    } else if (k < 0.8) {
      e.kind = "quick";
      e.groups = rnd() < 0.05 ? "no" : {};
      if (typeof e.groups === "object") GROUPS.concat(["foo"]).forEach(g => maybe(0.35, () => { e.groups[g] = pick([6, 4, 0, 51, "3", 1]); }));
    } else if (k < 0.95) {
      e.kind = "body";
      e.kg = pick([72.4, "72,4", 19, 301, "x", 80.06]);
      maybe(0.5, () => { e.waist = pick([82, "84,5", 29, null, ""]); });
    } else {
      e.kind = pick(["bw", "run", 5]);
    }
    return e;
  }

  function exercise5() {
    const r = { id: pick(["x_1", "x_2", "x_3", "bench_bb", "row_db", "bad id!"]), mts: smallTs() };
    maybe(0.7, () => { r.name = pick(["Cable fly", "  Hack   squat ", "", "y".repeat(60), 7]); });
    maybe(0.7, () => { r.group = pick(GROUPS.concat(["neck", ""])); });
    maybe(0.5, () => { r.sec = pick([["arms"], ["arms", "arms", "chest"], "x", ["legs", "abs", "back", "arms"]]); });
    maybe(0.5, () => { r.equip = pick(["barbell", "dumbbell", "cable", "Bad Equip", ""]); });
    maybe(0.5, () => { r.inc = pick([2.5, "1,25", 0, 60, "x"]); });
    maybe(0.5, () => { r.lo = pick([8, 6, 0, 13]); r.hi = pick([12, 10, 5, 700]); });
    maybe(0.3, () => { r.del = pick([true, false, "yes"]); });
    maybe(0.3, () => { r.timed = pick([true, false]); });
    return r;
  }

  function state5() {
    const s = state();
    if (!s || typeof s !== "object" || Array.isArray(s) || !s.areas || typeof s.areas !== "object") return s;
    s.v = pick([5, 5, 5, 4, 6, "6"]);
    s.log = Array.from({ length: Math.floor(rnd() * 7) }, entry5);
    s.settings = Object.assign({}, typeof s.settings === "object" ? s.settings : {}, {
      restGym: pick([90, 120, 4, null]),
      autoRest: pick([true, false, "yes"]),
      vol: pick([[10, 20], [12, 24], [25, 10], [0, 5], "x"]),
      keepAwake: pick([true, false, 1])
    });
    s.routine = {
      split: pick(["off", "bb3", "bb6", "five", "Five!", ""]),
      mode: pick(["bw", "gym", "GYM", 3]),
      sessionIndex: pick([0, 1, 2, 60]),
      override: pick([null, { d: "2026-09-27", day: 2 }, { d: "bad", day: 1 }, { d: "2026-09-27", day: 25 }])
    };
    s.pm = {};
    PREFS.forEach(f => maybe(0.7, () => { s.pm[f] = smallTs(); }));
    maybe(0.1, () => { s.pm = pick([[], "x", null]); });
    s.exercises = Array.from({ length: Math.floor(rnd() * 4) }, exercise5);
    s.deleted = Array.from({ length: Math.floor(rnd() * 3) }, () => ({ id: logId(), ts: smallTs() || T0 }));
    return s;
  }

  return { rnd, entry, state, entry5, state5 };
}

// Short fingerprint of a value, for recording many outputs compactly.
function fingerprint(value) {
  return require("crypto").createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

module.exports = { makeGen, fingerprint };
