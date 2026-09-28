/* The content tables in data.js that training.js counts with. A typo in a
   group name, a new ladder step or variation nobody mapped, or a weight
   that isn't 1 or ½ would quietly skew every weekly bar — so each of those
   fails here instead. The gym catalogue's ids are stored in every gym log
   entry, so they are frozen here too.
   Run with: sh tests/run.sh   (or: node tests/data-test.js) */

const h = require("./harness");
const { check, same, section } = h;

const page = h.load(["data.js", "model.js", "training.js"]);
const T = page.get("TRAINING"), M = page.get("MODEL");
const AREAS = page.get("AREAS"), VARIATIONS = page.get("VARIATIONS");
const GROUP_INFO = page.get("GROUP_INFO"), AREA_GROUPS = page.get("AREA_GROUPS");
const VARIATION_GROUPS = page.get("VARIATION_GROUPS"), QUICK_GROUPS = page.get("QUICK_GROUPS");
const GYM = page.get("GYM_EXERCISES"), GROUP_DEFAULTS = page.get("GROUP_DEFAULTS");
const GROUPS = Array.from(M.GROUPS);
const J = JSON.stringify;
const keys = o => Object.keys(o);
const sorted = a => a.slice().sort();

// A weight map for exercises: real groups only, weights 1 or ½, at most one 1.
function mapProblem(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return "not an object";
  const ks = keys(m);
  const badG = ks.filter(g => GROUPS.indexOf(g) === -1);
  if (badG.length) return "unknown group " + badG.join(", ");
  const badW = ks.filter(g => m[g] !== 1 && m[g] !== 0.5);
  if (badW.length) return "weight not 1 or 0.5 for " + badW.join(", ");
  if (ks.filter(g => m[g] === 1).length > 1) return "more than one main group";
  return "";
}

section("the six muscle groups");
check("GROUP_INFO lists MODEL.GROUPS, in that order", same(keys(GROUP_INFO), GROUPS), J(keys(GROUP_INFO)));
GROUPS.forEach(g => {
  const i = GROUP_INFO[g] || {};
  check(g + ": name, short label (≤ 6 characters), scale 1 or 2",
    typeof i.name === "string" && i.name.length > 0 && typeof i.short === "string" && i.short.length > 0 &&
    i.short.length <= 6 && (i.scale === 1 || i.scale === 2), J(i));
});
check("arms and legs count double, the rest single",
  same(GROUPS.map(g => GROUP_INFO[g].scale), [1, 1, 1, 2, 1, 2]));

section("every ladder step counts for something");
check("AREA_GROUPS has exactly the six areas", same(sorted(keys(AREA_GROUPS)), sorted(AREAS.map(a => a.id))), J(keys(AREA_GROUPS)));
AREAS.forEach(a => {
  const ag = AREA_GROUPS[a.id] || {};
  const p = mapProblem(ag.all);
  check(a.id + ": the whole-area map is valid and not empty", !p && keys(ag.all).length > 0, p);
  const over = ag.step ? keys(ag.step) : [];
  check(a.id + ": step overrides name real steps", over.every(k => /^\d+$/.test(k) && Number(k) >= 1 && Number(k) <= a.steps.length), J(over));
  over.forEach(k => { const q = mapProblem(ag.step[k]); check(a.id + " step " + k + ": override is valid", !q, q); });
  a.steps.forEach((s, i) => {
    const w = T.setWeights(a.id, i + 1, "");
    check(a.id + " step " + (i + 1) + " (" + s.name + ") counts for at least one group", keys(w).length > 0 && !mapProblem(w), J(w));
  });
});
{
  // The overrides the plan asks for, pinned.
  const at = (a, s) => J(T.setWeights(a, s, ""));
  check("bridge 1 legs + ½ back · 2 back + ½ legs · 3 back + ½ legs + ½ shoulders",
    at("bridge", 1) === J({ back: 0.5, legs: 1 }) && at("bridge", 2) === J({ back: 1, legs: 0.5 }) &&
    at("bridge", 3) === J({ back: 1, shoulders: 0.5, legs: 0.5 }));
  check("hspu 1–2 ½ shoulders + ½ abs · 3 shoulders + ½ abs · 4 shoulders + ½ arms",
    at("hspu", 1) === J({ shoulders: 0.5, abs: 0.5 }) && at("hspu", 2) === J({ shoulders: 0.5, abs: 0.5 }) &&
    at("hspu", 3) === J({ shoulders: 1, abs: 0.5 }) && at("hspu", 4) === J({ shoulders: 1, arms: 0.5 }));
}

section("every variation is mapped");
check("VARIATION_GROUPS has exactly the areas VARIATIONS has", same(sorted(keys(VARIATION_GROUPS)), sorted(keys(VARIATIONS))));
keys(VARIATIONS).forEach(area => {
  const names = VARIATIONS[area].map(v => v.name);
  const mapped = keys(VARIATION_GROUPS[area] || {});
  check(area + ": variation names are unique", new Set(names).size === names.length);
  const missing = names.filter(nm => mapped.indexOf(nm) === -1);
  check(area + ": every variation is in VARIATION_GROUPS", !missing.length, "add: " + missing.join(", "));
  const stale = mapped.filter(nm => names.indexOf(nm) === -1);
  check(area + ": no VARIATION_GROUPS name that isn't a variation", !stale.length, "stale: " + stale.join(", "));
  mapped.forEach(nm => {
    const v = VARIATION_GROUPS[area][nm];
    const p = v === "step" ? "" : mapProblem(v);
    check(area + " / " + nm + ": \"step\" or a valid map", !p, p);
  });
});
{
  const all = keys(VARIATION_GROUPS).reduce((n, a) => n + keys(VARIATION_GROUPS[a]).length, 0);
  const own = [];
  keys(VARIATION_GROUPS).forEach(a => keys(VARIATION_GROUPS[a]).forEach(nm => { if (VARIATION_GROUPS[a][nm] !== "step") own.push(a + "/" + nm); }));
  check("38 variations mapped, 11 with their own map", all === 38 && own.length === 11, all + " / " + own.join(", "));
}
{
  // Log entries keep the variation's name. Renaming one in data.js doesn't
  // lose data (it then counts as its step), but it does change history's
  // numbers: a removal from this list must be deliberate.
  const KNOWN = {
    pushup: ["Plank Hold", "Slow Negatives", "Paused Reps", "Tempo Pushups", "Wide Pushups", "Knuckle Pushups", "Decline Pushups", "Explosive Pushups"],
    pullup: ["Dead Hangs", "Scapular Pulls", "Slow Negatives", "Chin-Up Grip", "Paused Pullups", "Wide Pullups", "Towel Grip"],
    legraise: ["Hollow Body Hold", "Paused Raises", "Slow Lowering", "Twisting Raises", "L-Sit Hold", "Bent-Knee Hangs"],
    squat: ["Wall Sit", "Paused Squats", "Slow Negatives", "Split Squats", "Jump Squats", "Calf Raises"],
    bridge: ["Shoulder Openers", "Bridge Hold", "Hip Thrusts", "Rocking Bridges", "Bridge Walks"],
    hspu: ["Pike Hold", "Pike Pushups", "Wall Walks", "Slow Negatives", "Shoulder Taps", "Freestanding Practice"]
  };
  const gone = [];
  keys(KNOWN).forEach(a => KNOWN[a].forEach(nm => { if (!(VARIATIONS[a] || []).some(v => v.name === nm)) gone.push(a + "/" + nm); }));
  check("no variation name has disappeared", !gone.length, gone.join(", "));
}

section("every muscle group has a skill that trains it");
// The Body tab's group sheet lists "skills that feed it" (TRAINING.feeders):
// a group no ladder step trains would leave that list empty.
GROUPS.forEach(g => {
  const f = Array.from(T.feeders(g));
  check(g + ": trained by at least one ladder, at some step", f.length > 0, J(f));
  check(g + ": its feeders are real areas, in AREAS order", same(f, AREAS.map(a => a.id).filter(id => f.indexOf(id) !== -1)), J(f));
});
check("the step overrides change who feeds what: bridges feed shoulders (from step 3), handstands feed abs (steps 1–3)",
  T.feeders("shoulders").indexOf("bridge") !== -1 && T.feeders("abs").indexOf("hspu") !== -1 && T.feeders("chest").length === 1);

section("each ladder's main job (Body rows name these)");
// A Body row names the ladders whose main job is its group (a whole-area
// weight of 1: TRAINING.mainFeeders); a group with none says "Helped by …".
AREAS.forEach(a => {
  const mains = keys(AREA_GROUPS[a.id].all).filter(g => AREA_GROUPS[a.id].all[g] === 1);
  check(a.id + ": exactly one main job (" + mains.join(", ") + "), and it is listed for that group", mains.length === 1 &&
    Array.from(T.mainFeeders(mains[0])).indexOf(a.id) !== -1, J(mains));
});
check("arms is the only group without a main-job ladder",
  same(GROUPS.filter(g => T.mainFeeders(g).length === 0), ["arms"]), J(GROUPS.map(g => [g, Array.from(T.mainFeeders(g))])));
check("every main-job ladder trains its group at some step (it is in feeders())",
  GROUPS.every(g => Array.from(T.mainFeeders(g)).every(id => T.feeders(g).indexOf(id) !== -1)));

section("quick logs");
check("QUICK_GROUPS lists MODEL.GROUPS, in that order", same(keys(QUICK_GROUPS), GROUPS));
GROUPS.forEach(g => {
  const m = QUICK_GROUPS[g] || {};
  const others = keys(m).filter(k => k !== g);
  check(g + ": itself at 1, helpers at ¼, real groups only",
    m[g] === 1 && others.every(k => GROUPS.indexOf(k) !== -1 && m[k] === 0.25), J(m));
});
check("helpers: chest → arms, shoulders · back → arms · shoulders → arms · none for the rest",
  same(GROUPS.map(g => sorted(keys(QUICK_GROUPS[g]).filter(k => k !== g))),
    [["arms", "shoulders"], ["arms"], ["arms"], [], [], []]));

section("the gym catalogue");
// The kg step per equipment (data.js explains it). load: what kg means.
const GYM_INC = { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5, kettlebell: 4, bodyweight: 2.5 };
const EQUIPS = keys(GYM_INC);
const LOADS = ["ext", "added", "assist", "bw"];
const GYM_FIELDS = ["id", "name", "p", "s", "equip", "lo", "hi", "inc", "perHand", "load", "timed"];

// Everything wrong with one catalogue entry ([] = fine).
function gymProblems(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return ["not an object"];
  const out = [];
  if (!same(sorted(keys(e)), sorted(GYM_FIELDS))) out.push("fields are " + J(keys(e)) + ", should be " + J(GYM_FIELDS));
  if (typeof e.id !== "string" || !/^[a-z0-9_]{1,40}$/.test(e.id)) out.push("id is not lowercase snake_case, 1–40 characters");
  else if (e.id.indexOf("x_") === 0) out.push("\"x_\" ids are reserved for custom exercises");
  else if (e.id in Object.prototype) out.push("id is a name every object inherits");
  if (typeof e.name !== "string" || !e.name || e.name.length > 40 || e.name !== e.name.replace(/\s+/g, " ").trim())
    out.push("name is empty, over 40 characters or badly spaced");
  if (GROUPS.indexOf(e.p) === -1) out.push("p is not a group");
  if (!Array.isArray(e.s)) out.push("s is not a list");
  else {
    if (e.s.length > 3) out.push("more than 3 secondary groups");
    if (!e.s.every(g => GROUPS.indexOf(g) !== -1)) out.push("s has something that isn't a group");
    if (new Set(e.s).size !== e.s.length) out.push("s repeats a group");
    if (e.s.indexOf(e.p) !== -1) out.push("s repeats p");
    if (!same(Array.from(e.s), GROUPS.filter(g => e.s.indexOf(g) !== -1))) out.push("s is not in MODEL.GROUPS order");
  }
  if (EQUIPS.indexOf(e.equip) === -1) out.push("equip is not one of " + EQUIPS.join(", "));
  if (LOADS.indexOf(e.load) === -1) out.push("load is not one of " + LOADS.join(", "));
  if (!(Number.isInteger(e.lo) && Number.isInteger(e.hi) && e.lo >= 1 && e.lo <= e.hi && e.hi <= 600))
    out.push("not 1 ≤ lo ≤ hi ≤ 600 (whole numbers)");
  if (!(typeof e.inc === "number" && e.inc >= 0.25 && e.inc <= 50 && e.inc * 4 === Math.round(e.inc * 4)))
    out.push("inc is not a multiple of 0.25 kg in 0.25–50");
  else if (e.inc !== GYM_INC[e.equip]) out.push("inc " + e.inc + " but " + e.equip + " steps by " + GYM_INC[e.equip]);
  if (typeof e.perHand !== "boolean") out.push("perHand is not true/false");
  else if (e.perHand && e.equip !== "dumbbell" && e.equip !== "kettlebell") out.push("perHand without dumbbells or kettlebells");
  if (typeof e.timed !== "boolean") out.push("timed is not true/false");
  else if (e.timed && e.load !== "bw") out.push("timed, but the load isn't bodyweight only");
  // What kg means has to fit the equipment: added weight and bodyweight-only
  // are bodyweight exercises, assistance comes from a machine.
  if ((e.load === "added" || e.load === "bw") !== (e.equip === "bodyweight")) out.push("load " + e.load + " doesn't fit equipment " + e.equip);
  if (e.load === "assist" && e.equip !== "machine") out.push("assisted, but not on a machine");
  return out;
}

check("GYM_EXERCISES is a list of about 42", Array.isArray(GYM) && GYM.length >= 40, GYM && GYM.length);
GYM.forEach(e => {
  const p = gymProblems(e);
  check((e && e.id) + " — " + (e && e.name), !p.length, p.join("; "));
});
{
  const ids = GYM.map(e => e.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  check("ids are unique", !dup.length, dup.join(", "));
  const names = GYM.map(e => String(e.name).toLowerCase());
  const dupN = names.filter((n, i) => names.indexOf(n) !== i);
  check("names are unique (the picker lists exercises by name)", !dupN.length, dupN.join(", "));
  GROUPS.forEach(g => {
    const n = GYM.filter(e => e.p === g).length;
    check(g + ": at least 4 exercises to choose from", n >= 4, n);
  });
  check("the plank is the only timed exercise, 20–60 s",
    same(GYM.filter(e => e.timed).map(e => [e.id, e.lo, e.hi]), [["plank", 20, 60]]));
  check("kg per hand: the dumbbell-in-each-hand and one-arm exercises, not the goblet squat",
    same(GYM.filter(e => e.perHand).map(e => e.id),
      ["bench_db", "incline_db", "row_db", "ohp_db", "lateral_db", "rear_fly_db", "curl_db", "hammer_db", "bulgarian_db"]));
  check("added weight: dips, weighted chin-up, back extension, bench dips · assisted: the pull-up machine · bodyweight only: ab wheel, plank",
    same(["added", "assist", "bw"].map(l => GYM.filter(e => e.load === l).map(e => e.id)),
      [["dips", "chinup_w", "back_ext", "bench_dips"], ["pullup_assist"], ["ab_wheel", "plank"]]));
  const byId = {};
  GYM.forEach(e => { byId[e.id] = e; });
  const groupsOf = id => byId[id] ? [byId[id].p].concat(Array.from(byId[id].s)) : null;
  check("deadlift: back + ½ legs · Romanian deadlift: legs + ½ back",
    same(groupsOf("deadlift"), ["back", "legs"]) && same(groupsOf("rdl_bb"), ["legs", "back"]));
  check("squats, leg press and isolation lifts count for their own group only",
    ["squat_bb", "leg_press", "hack_squat", "goblet_squat", "leg_curl", "leg_ext", "pec_deck", "lateral_db", "curl_db", "pushdown", "crunch_cable"]
      .every(id => same(groupsOf(id), [byId[id].p])));
}

section("frozen gym ids (they live in stored logs)");
{
  // Every id ever shipped. A gym log entry keeps its exercise's id for good
  // (exId), so an id that disappears from GYM_EXERCISES orphans history on
  // every device and in every backup. Never remove one from this list; a
  // new exercise adds its id here, and from then on it is permanent too.
  const FROZEN = [
    "bench_bb", "bench_db", "incline_db", "chest_press", "pec_deck", "fly_cable", "dips",
    "pulldown", "row_cable", "row_db", "row_bb", "pullup_assist", "chinup_w", "deadlift", "back_ext",
    "ohp_bb", "ohp_db", "lateral_db", "lateral_cable", "rear_fly_db", "face_pull",
    "curl_db", "hammer_db", "curl_bb", "pushdown", "oh_ext_cable", "skull_bb", "bench_dips",
    "crunch_cable", "ab_wheel", "plank", "pallof",
    "squat_bb", "leg_press", "hack_squat", "rdl_bb", "leg_curl", "leg_ext", "bulgarian_db", "hip_thrust_bb", "calf_raise", "goblet_squat"
  ];
  const ids = GYM.map(e => e.id);
  const gone = FROZEN.filter(id => ids.indexOf(id) === -1);
  check("no shipped id has been renamed or removed", !gone.length, "missing: " + gone.join(", ") + " — put them back, stored logs use them");
  const fresh = ids.filter(id => FROZEN.indexOf(id) === -1);
  check("every id is in the frozen list", !fresh.length, "new: " + fresh.join(", ") + " — add them to FROZEN (they are permanent from now on)");
}

section("gym defaults");
check("GROUP_DEFAULTS lists MODEL.GROUPS, in that order", same(keys(GROUP_DEFAULTS), GROUPS), J(keys(GROUP_DEFAULTS)));
check("chest 4 · back 3 · shoulders 3 · arms 4 · abs 3 · legs 5",
  same(GROUPS.map(g => (GROUP_DEFAULTS[g] || []).length), [4, 3, 3, 4, 3, 5]), J(GROUPS.map(g => (GROUP_DEFAULTS[g] || []).length)));
GROUPS.forEach(g => {
  const list = Array.from(GROUP_DEFAULTS[g] || []);
  const bad = list.filter(id => !GYM.some(e => e.id === id && e.p === g));
  check(g + ": every default is in the catalogue with " + g + " as its main group", !bad.length, bad.join(", "));
  check(g + ": no default twice", new Set(list).size === list.length, J(list));
  const bb = list.filter(id => GYM.some(e => e.id === id && e.equip === "barbell"));
  check(g + ": no barbells (dumbbells, cables and machines first)", !bb.length, bb.join(", "));
});

section("the catalogue fits the stored-data rules (model.js)");
{
  // A tweak to a built-in exercise is stored as { id, inc, lo, hi, note }:
  // the catalogue's own values must survive it unchanged.
  const tweakBad = GYM.filter(e => {
    const r = M.sanitizeExercise({ id: e.id, inc: e.inc, lo: e.lo, hi: e.hi, note: "", mts: 1 });
    return !r || !same(r, { id: e.id, inc: e.inc, lo: e.lo, hi: e.hi, note: "", mts: 1 });
  }).map(e => e.id);
  check("every id can carry a tweak, and sanitizeExercise keeps the catalogue's inc, lo and hi", !tweakBad.length, tweakBad.join(", "));

  // A custom exercise uses the same field formats (group = p, sec = s): a
  // copy of any catalogue entry saved as a custom one comes back identical.
  const customBad = GYM.filter(e => {
    const r = M.sanitizeExercise({ id: "x_" + e.id, name: e.name, group: e.p, sec: e.s, equip: e.equip, load: e.load,
      timed: e.timed, perHand: e.perHand, inc: e.inc, lo: e.lo, hi: e.hi, note: "", mts: 1 });
    return !r || !same([r.name, r.group, r.sec, r.equip, r.load, r.timed, r.perHand, r.inc, r.lo, r.hi],
      [e.name, e.p, e.s, e.equip, e.load, e.timed, e.perHand, e.inc, e.lo, e.hi]);
  }).map(e => e.id);
  check("every entry saved as a custom exercise (\"x_\" + id) comes back unchanged", !customBad.length, customBad.join(", "));

  const incBad = EQUIPS.filter(eq => M.sanitizeExercise({ id: "x_t", name: "T", group: "chest", equip: eq }).inc !== GYM_INC[eq]);
  check("a custom exercise gets the same kg step for the same equipment", !incBad.length, incBad.join(", "));

  // And a gym log entry for each exercise is kept as logged.
  const logBad = GYM.filter(e => {
    const kg = e.load === "bw" ? [0, 0] : [20, 22.5];
    const r = M.sanitizeLogEntry({ id: "g1", ts: 1000, kind: "gym", exId: e.id, sets: [e.lo, e.hi], kg, note: "", mts: 1000 });
    return !r || r.exId !== e.id || !same(r.sets, [e.lo, e.hi]) || !same(r.kg, kg);
  }).map(e => e.id);
  check("a gym log entry for every exercise is kept as logged", !logBad.length, logBad.join(", "));
}

h.done(__filename);
