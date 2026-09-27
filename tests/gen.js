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

  return { rnd, entry, state };
}

// Short fingerprint of a value, for recording many outputs compactly.
function fingerprint(value) {
  return require("crypto").createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

module.exports = { makeGen, fingerprint };
