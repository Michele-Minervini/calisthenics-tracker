/* Pins down what model.js stores. Every load, backup restore and sync round
   goes through MODEL.sanitizeState, so a change in its output is a change in
   what every device keeps. Expected outputs live in fixtures/*-v<N>.json for
   the current data version (MODEL_VERSION). If a recorded case fails, either
   something regressed, or the stored shape changed on purpose — in which
   case MODEL_VERSION must change with it and the expectations are
   re-recorded with `node tools/record-fixtures.js` (see ROADMAP.md). */

const fs = require("fs");
const path = require("path");
const h = require("./harness");
const { check, same, section } = h;
const rec = require("./record");

const VERSION = h.load(["data.js", "model.js"]).get("MODEL").MODEL_VERSION;
const fixture = name => {
  const file = path.join(__dirname, "fixtures", name + "-v" + VERSION + ".json");
  if (!fs.existsSync(file)) {
    console.log("  FAIL no " + path.basename(file) + " — after a deliberate data-version bump, run: node tools/record-fixtures.js");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
};
const FIX = fixture("sanitize");
const RECORDED = fixture("recorded");

// A fresh page per case, with the frozen clock and seeded randomness the
// expectations were recorded with, so regenerated ids and "now" match.
function fresh() {
  return h.load(["data.js", "model.js"], { now: FIX.now, seed: FIX.seed }).get("MODEL");
}
const M = h.load(["data.js", "model.js"], { now: Date.UTC(2026, 8, 27, 10), seed: 1 }).get("MODEL");
const J = JSON.stringify;
const clone = x => JSON.parse(J(x));
const S = x => M.sanitizeState(clone(x));

section("sanitizeState matches the recorded behaviour (hand-written cases)");
check("fixtures recorded for data v" + VERSION, FIX.modelVersion === VERSION && RECORDED.modelVersion === VERSION);
FIX.cases.forEach(c => {
  const out = rec.inUTC(() => fresh().sanitizeState(clone(c.input)));
  check(c.name, same(out, c.expected),
    "expected " + J(c.expected).slice(0, 200) + "\n       got      " + J(out).slice(0, 200));
});

section("sanitizeState matches the recorded output for " + rec.SANITIZE_CASES + " random states");
{
  const Mr = h.load(["data.js", "model.js"], { now: RECORDED.now, seed: RECORDED.seed }).get("MODEL");
  const got = rec.sanitizeFingerprints(Mr);
  const first = got.findIndex((f, i) => f !== RECORDED.sanitize[i]);
  check("all " + got.length + " outputs identical", first === -1 && got.length === RECORDED.sanitize.length,
    first === -1 ? "" : "first difference at case " + first + ", input: " + J(rec.sanitizeInput(first)).slice(0, 300));
}

section("sanitizing is idempotent");
FIX.cases.filter(c => c.expected).forEach(c => {
  const Mf = fresh();
  const once = Mf.sanitizeState(clone(c.input));
  check("twice == once: " + c.name, same(once, Mf.sanitizeState(clone(once))));
});

section("moving from data v4");
{
  // Shaped like a real v4 device: routine on, custom rest, a frozen starting point.
  const T = Date.UTC(2026, 7, 1, 9);
  const v4 = {
    v: 4,
    areas: { pushup: { step: 9, std: 0, mts: T }, squat: { step: 6, std: 1, mts: T } },
    log: [
      { id: "e2", ts: T + 2000, date: "2026-08-01", areaId: "squat", step: 6, sets: [12, 10], note: "", mts: T + 2000, variant: "" },
      { id: "e1", ts: T + 1000, date: "2026-08-01", areaId: "pushup", step: 9, sets: [5], note: "felt strong", mts: T + 1000, variant: "Paused Reps" }
    ],
    settings: { restSeconds: 120, ghostBase: { d: "2026-08-01", v: [8, 4, 3, 5, 1, 0] } },
    routine: { enabled: true, daysPerWeek: 3, sessionIndex: 1 },
    snapshots: [{ d: "2026-07-20", v: [3, 2, 1, 2, 4, 3] }],
    milestones: [{ id: "m1", ts: T, type: "advance", areaId: "squat", step: 6 }],
    deleted: [{ id: "gone", ts: T }],
    prefsMts: T - 5000
  };
  const v5 = S(v4);
  check("becomes data v5 with every section", v5.v === 5 && same(Object.keys(v5), ["v", "areas", "log", "settings", "routine", "pm", "snapshots", "milestones", "deleted", "exercises"]));
  check("sessions kept, now sorted by time", same(v5.log.map(e => e.id), ["e1", "e2"]));
  check("session content unchanged, same fields in the same order",
    same(v5.log[0], v4.log[1]) && same(Object.keys(v5.log[0]), ["id", "ts", "date", "areaId", "step", "sets", "note", "mts", "variant"]));
  check("routine 3 days/week becomes split bb3, rotation kept", v5.routine.split === "bb3" && v5.routine.sessionIndex === 1 && v5.routine.mode === "bw");
  check("rest time and starting point kept", v5.settings.restSeconds === 120 && same(v5.settings.ghostBase, v4.settings.ghostBase));
  check("the new settings get their defaults", v5.settings.restGym === 120 && v5.settings.autoRest === true && same(v5.settings.vol, [10, 20]) && v5.settings.keepAwake === false);
  check("carried-over settings keep the old prefsMts as their stamp",
    v5.pm.restSeconds === v4.prefsMts && v5.pm.ghostBase === v4.prefsMts && v5.pm.split === v4.prefsMts && v5.pm.sessionIndex === v4.prefsMts);
  check("new settings start unstamped", v5.pm.restGym === 0 && v5.pm.vol === 0 && v5.pm.mode === 0);
  check("prefsMts itself is gone", !("prefsMts" in v5));
  check("positions, milestones, snapshots, tombstones kept",
    v5.areas.pushup.step === 9 && v5.milestones.length === 1 && v5.snapshots.length === 1 && v5.deleted[0].id === "gone");
  check("a routine switched off stays off", S({ areas: {}, routine: { enabled: false, daysPerWeek: 6, sessionIndex: 2 } }).routine.split === "off");
  check("an unknown variation name is kept, not erased", S({ areas: {}, log: [{ id: "x", ts: 5, areaId: "pushup", step: 1, sets: [1], variant: "Renamed Thing" }] }).log[0].variant === "Renamed Thing");
  check("markup in a variation name is refused", S({ areas: {}, log: [{ id: "x", ts: 5, areaId: "pushup", step: 1, sets: [1], variant: "<img src=x>" }] }).log[0].variant === "");
}

section("data from a newer version is refused, never stripped");
check("isNewer: v6", M.isNewer({ v: 6, areas: {} }) && M.isNewer({ v: "6", areas: {} }));
check("isNewer: not v5 or older", !M.isNewer({ v: 5 }) && !M.isNewer({ v: 1 }) && !M.isNewer({}) && !M.isNewer(null));
check("sanitizeState returns null for newer data", M.sanitizeState({ v: 6, areas: {} }) === null);

section("gym entries");
{
  const g = x => S({ areas: {}, log: [Object.assign({ id: "g", ts: 1000, kind: "gym", exId: "bench_bb" }, x)] }).log[0];
  const e = g({ sets: [8, 8, 7], kg: [60, "62,5", " 62.3 "] });
  check("weights in kg with a comma or a dot, nearest 0.25", same(e.kg, [60, 62.5, 62.25]));
  check("fields in a fixed order", same(Object.keys(e), ["id", "ts", "kind", "exId", "sets", "kg", "note", "mts"]));
  check("bad weights become 0, huge ones capped", same(g({ sets: [5, 5, 5], kg: [-5, "abc", 2000] }).kg, [0, 0, 1000]));
  check("missing weights are 0, extra ones dropped", same(g({ sets: [5, 5], kg: [40] }).kg, [40, 0]) && same(g({ sets: [5], kg: [40, 50] }).kg, [40]));
  check("reps rounded; an unreadable set is dropped with its weight", same(g({ sets: [7.6, null, "x", -1, 9], kg: [10, 20, 30, 40, 50] }), g({ sets: [8, 9], kg: [10, 50] })));
  check("at most 30 sets", g({ sets: Array(40).fill(5), kg: [] }).sets.length === 30);
  check("no usable set → dropped", S({ areas: {}, log: [{ id: "g", ts: 1, kind: "gym", exId: "a", sets: [null] }] }).log.length === 0);
  check("an unsafe exercise id → dropped", S({ areas: {}, log: [{ id: "g", ts: 1, kind: "gym", exId: "a b<", sets: [5] }] }).log.length === 0);
  check("an exercise id the catalogue doesn't know is kept", g({ exId: "some_new_lift", sets: [5] }).exId === "some_new_lift");
}

section("quick logs and weigh-ins");
{
  const q = S({ areas: {}, log: [{ id: "q", ts: 1, kind: "quick", groups: { legs: 6, chest: "4", foo: 3, abs: 0, back: 51 } }] }).log[0];
  check("quick log keeps known groups with 1–50 sets, in the canonical order", same(q.groups, { chest: 4, legs: 6 }));
  check("quick log with no valid group → dropped", S({ areas: {}, log: [{ id: "q", ts: 1, kind: "quick", groups: { foo: 3 } }] }).log.length === 0);
  const b = S({ areas: {}, log: [{ id: "b", ts: 1, kind: "body", kg: "72,46", waist: "84,5" }] }).log[0];
  check("weigh-in: kg and waist to one decimal", b.kg === 72.5 && b.waist === 84.5);
  check("weigh-in: waist optional", S({ areas: {}, log: [{ id: "b", ts: 1, kind: "body", kg: 70 }] }).log[0].waist === null);
  check("weigh-in: implausible weight → dropped", S({ areas: {}, log: [{ id: "b", ts: 1, kind: "body", kg: 19 }] }).log.length === 0);
  check("an unknown kind → dropped", S({ areas: {}, log: [{ id: "r", ts: 1, kind: "run", sets: [5] }] }).log.length === 0);
}

section("one entry per id, deletes applied");
{
  const s = S({ areas: {}, log: [
    { id: "a", ts: 1, areaId: "pushup", step: 1, sets: [5], mts: 10 },
    { id: "a", ts: 1, areaId: "pushup", step: 1, sets: [9], mts: 20 },
    { id: "b", ts: 2, areaId: "pushup", step: 1, sets: [5], mts: 5 }
  ], deleted: [{ id: "b", ts: 5 }] });
  check("duplicate ids collapse to the newest edit", s.log.length === 1 && same(s.log[0].sets, [9]));
  check("an entry whose delete is newer is removed", !s.log.some(e => e.id === "b"));
}

section("custom exercises");
{
  const x = M.sanitizeExercise({ id: "x_1", name: "  Hack   squat ", group: "legs", sec: ["abs", "legs", "abs", "arms", "chest"], equip: "machine", inc: "2,5", lo: 8, hi: 12, mts: 5 });
  check("name tidied, secondaries unique and capped", x.name === "Hack squat" && same(x.sec, ["chest", "arms", "abs"]));
  check("weight step parsed", x.inc === 2.5);
  const y = M.sanitizeExercise({ id: "x_2", name: "z".repeat(60), group: "neck", equip: "Bad", lo: 12, hi: 8 });
  check("bad values clamped, never dropped", y && y.name.length === 40 && y.group === "" && y.equip === "other" && y.lo === 8 && y.hi === 12 && y.inc === 2.5);
  const o = M.sanitizeExercise({ id: "bench_bb", inc: 1.25, lo: 5, hi: 8, note: "grip one finger out", extra: 1 });
  check("a tweak to a built-in keeps only what it can tweak", same(Object.keys(o), ["id", "inc", "lo", "hi", "note", "mts"]) && o.inc === 1.25);
  const many = [];
  for (let i = 0; i < 305; i++) many.push({ id: "x_" + i, name: "E" + i, group: "chest", mts: i });
  const kept = S({ areas: {}, exercises: many, log: [{ id: "g", ts: 1, kind: "gym", exId: "x_0", sets: [5] }] }).exercises;
  check("capped at 300, never dropping one the log uses", kept.length === 300 && kept.some(r => r.id === "x_0"));
  const cut = M.sanitizeExercise({ id: "x_3", name: "a".repeat(39) + " b" });
  check("a name cut at 40 characters doesn't end in a space", cut.name === "a".repeat(39) && same(M.sanitizeExercise(cut), cut));
}

section("stamps");
{
  check("a stamp is never behind the previous one", M.stamp(Date.UTC(2099, 0, 1)) === Date.UTC(2099, 0, 1) + 1);
  check("a stamp is 'now' when the previous one is older", M.stamp(5) === Date.UTC(2026, 8, 27, 10));
  // An old copy of the app can keep running for a while after the update (an
  // iPhone home-screen app resumes rather than reloads). Its settings must
  // never undo a choice made in the new version.
  const CAP = M.MIGRATED_PREFS_MAX;
  const late = S({ areas: {}, settings: { restSeconds: 90 }, routine: { enabled: true, daysPerWeek: 6 }, prefsMts: CAP + 2 * 86400000 });
  check("settings carried over from v4 are stamped no later than the release",
    late.pm.restSeconds === CAP && late.pm.split === CAP && late.pm.sessionIndex === CAP && late.pm.ghostBase === CAP);
  check("…and earlier ones keep their own stamp", S({ areas: {}, settings: { restSeconds: 90 }, prefsMts: CAP - 5 }).pm.restSeconds === CAP - 5);
  check("a preference changed in v5 is stamped after the release, even with a clock behind it",
    M.stampPref(0) === CAP + 1 && M.stampPref(CAP + 7) === CAP + 8);
}

section("names that clash with built-in object keys");
{
  // "constructor" and "__proto__" pass the format checks, but as keys of a
  // plain lookup table they reach inherited values and crashed the app.
  const r = name => S({ v: 5, areas: {}, routine: { split: name }, pm: { split: 99 } }).routine.split;
  check("a split named constructor or __proto__ is refused", r("constructor") === "off" && r("__proto__") === "off" && r("five") === "five");
  const x = M.sanitizeExercise({ id: "x_1", name: "Odd", group: "arms", equip: "constructor" });
  check("so is such an equipment name, and the weight step stays a number", x.equip === "other" && x.inc === 2.5);
  const ids = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];
  const log = ids.map((id, k) => ({ id, ts: 1000 + k, areaId: "pushup", step: 1, sets: [5], mts: 1000 + k }));
  const st = S({ areas: {}, log: log.concat([{ id: "toString", ts: 1002, areaId: "pushup", step: 1, sets: [9], mts: 5000 }]),
    milestones: [{ id: "__proto__", ts: 5, type: "advance", areaId: "pushup", step: 2 }],
    deleted: [{ id: "valueOf", ts: 9000 }] });
  check("sessions with such ids are kept like any other", same(st.log.map(e => e.id), ["__proto__", "constructor", "toString", "hasOwnProperty"]));
  check("…their duplicates collapse to the newest edit", same(st.log[2].sets, [9]));
  check("…and a delete removes them", !st.log.some(e => e.id === "valueOf") && st.deleted[0].id === "valueOf");
  check("a milestone with such an id is kept", st.milestones.length === 1 && st.milestones[0].id === "__proto__");
  check("sanitizing it again changes nothing", same(S(st), st));
}

section("default state");
{
  const d = M.defaultState();
  check("stored version is MODEL_VERSION (" + M.MODEL_VERSION + ")", d.v === M.MODEL_VERSION);
  check("top-level keys in the stored order",
    same(Object.keys(d), ["v", "areas", "log", "settings", "routine", "pm", "snapshots", "milestones", "deleted", "exercises"]));
  check("every area at step 1, nothing met", Object.keys(d.areas).length === 6 &&
    Object.keys(d.areas).every(id => same(d.areas[id], { step: 1, std: 0, mts: 0 })));
  check("defaults are unstamped", Object.keys(d.pm).length === M.PREF_FIELDS.length && Object.keys(d.pm).every(k => d.pm[k] === 0));
  check("default rest is 3 minutes", d.settings.restSeconds === 180 && M.DEFAULT_REST === 180);
  check("two calls never share objects", M.defaultState().log !== M.defaultState().log);
  const AREAS = h.load(["data.js"]).get("AREAS");
  check("KNOWN_IDS follows AREAS order", same(M.KNOWN_IDS, AREAS.map(a => a.id)));
}

section("caps keep the newest entries");
{
  const six = k => [k % 10, 0, 0, 0, 0, 0];
  const day = k => M.dateStr(Date.UTC(2025, 0, 1) + k * 86400000 + 12 * 3600000);
  const snaps = S({ areas: {}, snapshots: Array.from({ length: 401 }, (_, k) => ({ d: day(k), v: six(k) })) }).snapshots;
  check("snapshots capped at 400, oldest dropped", snaps.length === 400 && snaps[0].d === day(1) && snaps[399].d === day(400));
  const same2 = S({ areas: {}, snapshots: [{ d: "2026-01-01", v: [1, 5, 0, 0, 0, 0] }, { d: "2026-01-01", v: [3, 2, 0, 0, 0, 0] }] }).snapshots;
  check("one snapshot per day, component-wise maximum", same2.length === 1 && same(same2[0].v, [3, 5, 0, 0, 0, 0]));
  const del = S({ areas: {}, deleted: Array.from({ length: 1001 }, (_, k) => ({ id: "d" + k, ts: 1000 + k })) }).deleted;
  check("tombstones capped at 1000", del.length === 1000 && del[0].id === "d1" && del[999].id === "d1000");
}

section("ids");
{
  const Mi = h.load(["data.js", "model.js"]).get("MODEL");
  const ids = Array.from({ length: 200 }, () => Mi.genId());
  check("genId passes the sanitizer's id check", ids.every(id => /^[A-Za-z0-9_-]{1,40}$/.test(id)));
}

section("calendar days across daylight-saving changes (" + (process.env.TZ || "local time") + ")");
{
  const Md = h.load(["data.js", "model.js"]).get("MODEL");
  // Both European and US transitions of 2026, checked in whatever TZ we run in.
  [[2026, 2, 8], [2026, 2, 29], [2026, 9, 25], [2026, 10, 1]].forEach(([y, m, d]) => {
    const label = y + "-" + (m + 1) + "-" + d;
    const before = new Date(y, m, d - 1, 12).getTime();
    const after = new Date(y, m, d + 1, 12).getTime();
    check("dayDelta over " + label + " is 2", Md.dayDelta(before, after) === 2);
    const next = Md.addDays(Md.startOfDay(before), 1);
    check("addDays lands on local midnight of " + label, next.getDate() === d && next.getHours() === 0 && next.getMinutes() === 0);
    const late = new Date(y, m, d, 23, 30).getTime();
    check("23:30 on " + label + " is still that day", Md.dateStr(late) === Md.dateStr(new Date(y, m, d, 0, 30).getTime()));
  });
  let roundTrip = true;
  for (let k = 0; k < 366; k++) {
    const dayTs = new Date(2026, 0, 1 + k, 12).getTime();
    const key = Md.dateStr(dayTs);
    if (Md.dateStr(Md.dateFromKey(key)) !== key) roundTrip = false;
  }
  check("dateFromKey inverts dateStr for every day of 2026", roundTrip);
}

h.done(__filename);
