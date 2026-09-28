/* The content tables in data.js that training.js counts with. A typo in a
   group name, a new ladder step or variation nobody mapped, or a weight
   that isn't 1 or ½ would quietly skew every weekly bar — so each of those
   fails here instead. (P4 adds the gym catalogue checks to this file.)
   Run with: sh tests/run.sh   (or: node tests/data-test.js) */

const h = require("./harness");
const { check, same, section } = h;

const page = h.load(["data.js", "model.js", "training.js"]);
const T = page.get("TRAINING"), M = page.get("MODEL");
const AREAS = page.get("AREAS"), VARIATIONS = page.get("VARIATIONS");
const GROUP_INFO = page.get("GROUP_INFO"), AREA_GROUPS = page.get("AREA_GROUPS");
const VARIATION_GROUPS = page.get("VARIATION_GROUPS"), QUICK_GROUPS = page.get("QUICK_GROUPS");
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

h.done(__filename);
