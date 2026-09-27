/* Pins down what model.js stores. Every load, backup restore and sync round
   goes through MODEL.sanitizeState, so a change in its output is a change in
   what every device keeps. The expected outputs in fixtures/sanitize-v4.json
   were recorded from the pre-refactor code — if a case here fails, either
   something regressed, or the stored shape changed on purpose, in which case
   MODEL_VERSION in model.js must change with it and the expectations are
   re-recorded with `node tools/record-fixtures.js` (see ROADMAP.md). */

const fs = require("fs");
const path = require("path");
const h = require("./harness");
const { check, same, section } = h;

const rec = require("./record");
const { makeGen } = require("./gen");

// Expectations are recorded per data version; model.js says which one applies.
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

// A fresh page per case, with the same frozen clock and seeded randomness the
// expectations were generated with, so regenerated ids and "now" match.
function fresh() {
  return h.load(["data.js", "model.js"], { now: FIX.now, seed: FIX.seed }).get("MODEL");
}

section("sanitizeState matches the recorded behaviour");
FIX.cases.forEach(c => {
  const out = rec.inUTC(() => fresh().sanitizeState(JSON.parse(JSON.stringify(c.input))));
  check(c.name, same(out, c.expected),
    "expected " + JSON.stringify(c.expected).slice(0, 200) + "\n       got      " + JSON.stringify(out).slice(0, 200));
});

section("sanitizeState matches the recorded output for " + rec.SANITIZE_CASES + " random states");
{
  check("fixtures recorded for data v" + VERSION, FIX.modelVersion === VERSION && RECORDED.modelVersion === VERSION);
  const M = h.load(["data.js", "model.js"], { now: RECORDED.now, seed: RECORDED.seed }).get("MODEL");
  const got = rec.sanitizeFingerprints(M);
  const first = got.findIndex((f, i) => f !== RECORDED.sanitize[i]);
  let detail = "";
  if (first !== -1) {
    const gen = makeGen(rec.SEED);
    let input; for (let i = 0; i <= first; i++) input = gen.state();
    detail = "first difference at case " + first + ", input: " + JSON.stringify(input).slice(0, 300);
  }
  check("all " + got.length + " outputs identical", first === -1 && got.length === RECORDED.sanitize.length, detail);
}

section("sanitizing is idempotent");
FIX.cases.filter(c => c.expected).forEach(c => {
  const M = fresh();
  const once = M.sanitizeState(JSON.parse(JSON.stringify(c.input)));
  const twice = M.sanitizeState(JSON.parse(JSON.stringify(once)));
  check("twice == once: " + c.name, same(once, twice));
});

section("caps keep the newest entries");
{
  const M = fresh();
  const six = k => [k % 10, 0, 0, 0, 0, 0];
  const snaps = M.sanitizeState({ areas: {}, snapshots: Array.from({ length: 401 }, (_, k) => ({ d: "2026-01-01", v: six(k) })) }).snapshots;
  check("snapshots capped at 400", snaps.length === 400);
  check("oldest snapshot dropped", same(snaps[0].v, six(1)) && same(snaps[399].v, six(400)));
  const T = Date.UTC(2026, 6, 1);
  const ms = M.sanitizeState({ areas: {}, milestones: Array.from({ length: 501 }, (_, k) => ({ id: "m" + k, ts: T + k, type: "advance", areaId: "pushup", step: 1 + k % 10 })) }).milestones;
  check("milestones capped at 500", ms.length === 500 && ms[0].id === "m1" && ms[499].id === "m500");
  const del = M.sanitizeState({ areas: {}, deleted: Array.from({ length: 401 }, (_, k) => ({ id: "d" + k, ts: T + k })) }).deleted;
  check("tombstones capped at 400", del.length === 400 && del[0].id === "d1" && del[399].id === "d400");
  const exactly = M.sanitizeState({ areas: {}, snapshots: Array.from({ length: 400 }, (_, k) => ({ d: "2026-01-01", v: six(k) })) }).snapshots;
  check("exactly 400 snapshots all kept", exactly.length === 400 && same(exactly[0].v, six(0)));
}

section("default state");
{
  const M = fresh();
  const d = M.defaultState();
  check("stored version is MODEL_VERSION (" + M.MODEL_VERSION + ")", d.v === M.MODEL_VERSION);
  check("top-level keys in the stored order",
    same(Object.keys(d), ["v", "areas", "log", "settings", "routine", "snapshots", "milestones", "deleted", "prefsMts"]));
  check("every area at step 1, nothing met", Object.keys(d.areas).length === 6 &&
    Object.keys(d.areas).every(id => same(d.areas[id], { step: 1, std: 0, mts: 0 })));
  check("default rest is 3 minutes", d.settings.restSeconds === 180 && M.DEFAULT_REST === 180);
  check("two calls never share objects", M.defaultState().log !== M.defaultState().log);
  const AREAS = h.load(["data.js"]).get("AREAS");
  check("KNOWN_IDS follows AREAS order", same(M.KNOWN_IDS, AREAS.map(a => a.id)));
}

section("ids");
{
  const M = h.load(["data.js", "model.js"]).get("MODEL");
  const ids = Array.from({ length: 200 }, () => M.genId());
  check("genId passes the sanitizer's id check", ids.every(id => /^[A-Za-z0-9_-]{1,40}$/.test(id)));
}

section("calendar days across daylight-saving changes (" + (process.env.TZ || "local time") + ")");
{
  const M = h.load(["data.js", "model.js"]).get("MODEL");
  // Both European and US transitions of 2026, checked in whatever TZ we run in.
  [[2026, 2, 8], [2026, 2, 29], [2026, 9, 25], [2026, 10, 1]].forEach(([y, m, d]) => {
    const label = y + "-" + (m + 1) + "-" + d;
    const before = new Date(y, m, d - 1, 12).getTime();
    const after = new Date(y, m, d + 1, 12).getTime();
    check("dayDelta over " + label + " is 2", M.dayDelta(before, after) === 2);
    const next = M.addDays(M.startOfDay(before), 1);
    check("addDays lands on local midnight of " + label, next.getDate() === d && next.getHours() === 0 && next.getMinutes() === 0);
    const late = new Date(y, m, d, 23, 30).getTime();
    check("23:30 on " + label + " is still that day", M.dateStr(late) === M.dateStr(new Date(y, m, d, 0, 30).getTime()));
  });
  let roundTrip = true;
  for (let k = 0; k < 366; k++) {
    const day = new Date(2026, 0, 1 + k, 12).getTime();
    const key = M.dateStr(day);
    if (M.dateStr(M.dateFromKey(key)) !== key) roundTrip = false;
  }
  check("dateFromKey inverts dateStr for every day of 2026", roundTrip);
}

h.done(__filename);
