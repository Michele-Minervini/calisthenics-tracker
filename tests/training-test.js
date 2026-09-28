/* Training logic (training.js): which week a session belongs to, what each
   logged set counts for per muscle group, the weekly targets and the zones
   the home bars show — and what the four tabs build on them: the week
   strip and its dots, weekly history, last trained, workouts and the week
   streak, the month calendar, what counted for a group, the skills that
   feed it, the nudge, the radar, the pace, "this point last week" and
   Body's sentence, and the mockup's pretend week (private/mockups/p3/
   NOTES.md) end to end. Then the gym (P4): exercises and their tweaks,
   e1RM, warm-ups, what gym sets count for, one exercise's history and
   best set, and the double-progression suggestions. The gym sections
   register exercises with TRAINING.useExercises() (the one piece of
   state training.js keeps) and reset it with useExercises([]) at the
   end of each. tests/run.sh runs this in Europe/Rome
   and America/New_York, whose daylight-saving switches fall on different
   Sundays — every DST week and month of 2026 in both places is checked below.
   Run with: sh tests/run.sh   (or: node tests/training-test.js) */

const h = require("./harness");
const { check, same, section } = h;

const page = h.load(["data.js", "model.js", "training.js"]);
const T = page.get("TRAINING"), M = page.get("MODEL");
const J = JSON.stringify;

// Local wall-clock time, month 1–12. Built with the Date constructor, which
// normalises days by the calendar (so d + 1 past a month end is fine).
const L = (y, mo, d, hh = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, hh, mi, s, ms).getTime();
const HOUR = 3600000;
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

let n = 0;
function bw(ts, areaId, step, sets, variant) {
  n++;
  return { id: "b" + n, ts, date: M.dateStr(ts), areaId, step, sets, note: "", mts: ts, variant: variant || "" };
}
function quick(ts, groups) { n++; return { id: "q" + n, ts, kind: "quick", groups, note: "", mts: ts }; }
function eq(name, got, want) { check(name, same(got, want), "expected " + J(want) + "\n       got      " + J(got)); }

section("weeks run from Monday 00:00 to Sunday 23:59, local time");
eq("Wednesday → its Monday", T.weekStart(L(2026, 9, 23, 15, 30)), L(2026, 9, 21));
eq("Monday 00:00 starts its own week", T.weekStart(L(2026, 9, 21)), L(2026, 9, 21));
eq("Sunday 23:59:59.999 is still the same week", T.weekStart(L(2026, 9, 27, 23, 59, 59, 999)), L(2026, 9, 21));
eq("the next Monday 00:00 is the next week", T.weekStart(L(2026, 9, 28)), L(2026, 9, 28));
eq("the Sunday before belongs to the week before", T.weekStart(L(2026, 9, 20, 23, 59)), L(2026, 9, 14));
eq("a week crossing the new year starts in December", T.weekStart(L(2027, 1, 2, 12)), L(2026, 12, 28));
check("weekStart of a week start is itself", T.weekStart(T.weekStart(L(2026, 9, 24, 9))) === L(2026, 9, 21));
{
  // Every day of 2026 at hours that include the DST switch hours.
  let bad = [];
  const starts = new Set();
  for (let i = 0; i < 365; i++) {
    [0, 1, 2, 3, 12, 23].forEach(hh => {
      const ts = new Date(2026, 0, 1 + i, hh, 30).getTime();
      const ws = T.weekStart(ts), d = new Date(ws);
      const off = M.dayDelta(ws, ts);
      if (d.getDay() !== 1 || d.getHours() || d.getMinutes() || d.getSeconds() || d.getMilliseconds() || off < 0 || off > 6) bad.push(M.dateStr(ts) + " " + hh);
      starts.add(ws);
    });
  }
  check("all of 2026: always a Monday at 00:00, 0–6 days back", !bad.length, bad.slice(0, 5).join(", "));
  check("2026 touches 53 weeks (29 Dec 2025 … 28 Dec 2026)", starts.size === 53, "got " + starts.size);
}

section("weeks with a daylight-saving switch (" + tz + ")");
// [the Sunday of the switch, where, week label, hours in that week there]
const DST = [
  [[2026, 3, 29], "Europe/Rome", "23–29 Mar", 167],
  [[2026, 10, 25], "Europe/Rome", "19–25 Oct", 169],
  [[2026, 3, 8], "America/New_York", "2–8 Mar", 167],
  [[2026, 11, 1], "America/New_York", "26 Oct – 1 Nov", 169]
];
DST.forEach(([[y, mo, d], where, label, hours]) => {
  const name = y + "-" + mo + "-" + d + " (" + where + ")";
  const mon = L(y, mo, d - 6), next = L(y, mo, d + 1);
  eq(name + ": Sunday noon → Monday " + M.dateStr(mon), T.weekStart(L(y, mo, d, 12)), mon);
  eq(name + ": the switch hour itself (02:30) → same Monday", T.weekStart(L(y, mo, d, 2, 30)), mon);
  eq(name + ": Sunday 23:59:59.999 → same Monday", T.weekStart(L(y, mo, d, 23, 59, 59, 999)), mon);
  eq(name + ": Monday 00:00 after → next week", T.weekStart(next), next);
  eq(name + ": addWeeks(+1) lands on the next Monday 00:00", T.addWeeks(mon, 1), next);
  eq(name + ": addWeeks(-1) from the next week comes back", T.addWeeks(next, -1), mon);
  eq(name + ": label", T.weekLabel(L(y, mo, d, 23, 30)), label);
  const len = (next - mon) / HOUR;
  if (tz === where) check(name + ": this week really is " + hours + " hours here", len === hours, "got " + len);
  else check(name + ": week length is 167, 168 or 169 hours", [167, 168, 169].indexOf(len) !== -1, "got " + len);
  // The traps a "+ 7 × 24 h" week would fall into: Sunday 23:30 of a
  // 169-hour week, Monday 00:30 after a 167-hour one.
  const log = [
    bw(L(y, mo, d, 23, 30), "squat", 5, [20]),
    bw(L(y, mo, d, 23, 59, 59, 999), "squat", 5, [20]),
    bw(next, "pushup", 5, [10]),
    bw(L(y, mo, d + 1, 0, 30), "pushup", 5, [10])
  ];
  eq(name + ": Sunday 23:30 and 23:59 count in the week ending that Sunday", T.weekVolume(log, mon),
    { chest: 0, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 2 });
  eq(name + ": Monday 00:00 and 00:30 count in the next week", T.weekVolume(log, next),
    { chest: 2, back: 0, shoulders: 1, arms: 1, abs: 0, legs: 0 });
});

section("week labels");
eq("same month", T.weekLabel(L(2026, 9, 24)), "21–27 Sep");
eq("across two months", T.weekLabel(L(2026, 10, 1)), "28 Sep – 4 Oct");
eq("across two years", T.weekLabel(L(2027, 1, 2)), "28 Dec 2026 – 3 Jan 2027");
eq("across two years, short form", T.weekLabel(L(2027, 1, 2), true), "28 Dec – 3 Jan");
eq("short form within a year is the usual label", T.weekLabel(L(2026, 9, 24), true), "21–27 Sep");
eq("from any moment of the week, e.g. Monday 00:00", T.weekLabel(L(2026, 9, 21)), "21–27 Sep");

section("what one ladder session counts for (hard sets per group)");
const W = L(2026, 9, 23, 18);
const cases = [
  ["pushups step 5, 3 sets", ["pushup", 5, [12, 10, 8]], { chest: 3, shoulders: 1.5, arms: 1.5 }],
  ["pullups step 4, 2 sets", ["pullup", 4, [6, 5]], { back: 2, arms: 1 }],
  ["leg raises step 6, 2 sets", ["legraise", 6, [12, 10]], { abs: 2 }],
  ["squats step 5, 3 sets", ["squat", 5, [20, 20, 20]], { legs: 3 }],
  ["bridges step 1 (Short Bridges): legs, ½ back", ["bridge", 1, [25, 25]], { back: 1, legs: 2 }],
  ["bridges step 2 (Straight Bridges): back, ½ legs, no shoulders", ["bridge", 2, [20]], { back: 1, legs: 0.5 }],
  ["bridges step 3 (Angled Bridges): back, ½ legs, ½ shoulders", ["bridge", 3, [10, 10]], { back: 2, shoulders: 1, legs: 1 }],
  ["bridges step 10", ["bridge", 10, [3]], { back: 1, shoulders: 0.5, legs: 0.5 }],
  ["handstands step 1 (Wall Headstands, 2 timed holds): ½ + ½ only", ["hspu", 1, [30, 45]], { shoulders: 1, abs: 1 }],
  ["handstands step 2 (Crow Stands, 1 hold)", ["hspu", 2, [10]], { shoulders: 0.5, abs: 0.5 }],
  ["handstands step 3 (Wall Handstands, 3 holds): shoulders, ½ abs", ["hspu", 3, [30, 30, 30]], { shoulders: 3, abs: 1.5 }],
  ["handstands step 4: shoulders, ½ arms", ["hspu", 4, [5, 5]], { shoulders: 2, arms: 1 }],
  ["handstands step 10", ["hspu", 10, [1]], { shoulders: 1, arms: 0.5 }],
  ["a 0 in the sets is not a set", ["pushup", 5, [0, 10, 0]], { chest: 1, shoulders: 0.5, arms: 0.5 }],
  ["only zeros count for nothing", ["pushup", 5, [0, 0]], {}],
  ["unknown area counts for nothing", ["dips", 3, [10]], {}],
  ["an area called \"constructor\" counts for nothing", ["constructor", 3, [10]], {}],
  ["a step out of range counts as the area", ["hspu", 11, [5]], { shoulders: 1, arms: 0.5 }]
];
cases.forEach(([name, [a, s, sets], want]) => eq(name, T.groupWeights(bw(W, a, s, sets)), want));

section("variations");
const vcases = [
  ["Plank Hold (pushups) → abs", ["pushup", 2, [30, 30], "Plank Hold"], { abs: 2 }],
  ["Hip Thrusts (bridges) → legs, ½ back", ["bridge", 2, [15, 15, 15], "Hip Thrusts"], { back: 1.5, legs: 3 }],
  ["Shoulder Openers → nothing", ["bridge", 6, [30, 30], "Shoulder Openers"], {}],
  ["Dead Hangs → ½ arms", ["pullup", 3, [40, 30], "Dead Hangs"], { arms: 1 }],
  ["Scapular Pulls → ½ back", ["pullup", 3, [10, 10, 10], "Scapular Pulls"], { back: 1.5 }],
  ["Pike Hold → ½ shoulders", ["hspu", 2, [20, 20], "Pike Hold"], { shoulders: 1 }],
  ["Wall Walks → shoulders, ½ abs (a full set even at step 2)", ["hspu", 2, [3, 3], "Wall Walks"], { shoulders: 2, abs: 1 }],
  ["Freestanding Practice → shoulders, ½ abs (not the step's ½ arms)", ["hspu", 5, [15], "Freestanding Practice"], { shoulders: 1, abs: 0.5 }],
  ["L-Sit Hold → abs, ½ arms", ["legraise", 6, [10, 10], "L-Sit Hold"], { arms: 1, abs: 2 }],
  ["Pike Pushups at step 3 → shoulders, ½ arms (a press)", ["hspu", 3, [8, 8], "Pike Pushups"], { shoulders: 2, arms: 1 }],
  ["Shoulder Taps at step 5 → shoulders, ½ abs (a hold)", ["hspu", 5, [10], "Shoulder Taps"], { shoulders: 1, abs: 0.5 }],
  ["Calf Raises count as the squat step", ["squat", 5, [20, 20], "Calf Raises"], { legs: 2 }],
  ["Bridge Hold at step 1 counts as step 1 (legs, ½ back)", ["bridge", 1, [30], "Bridge Hold"], { back: 0.5, legs: 1 }],
  ["Bridge Hold at step 5 counts as step 5", ["bridge", 5, [30], "Bridge Hold"], { back: 1, shoulders: 0.5, legs: 0.5 }],
  ["Slow Negatives (easier) on pullups still count in full", ["pullup", 6, [3, 3], "Slow Negatives"], { back: 2, arms: 1 }],
  ["Slow Negatives on handstands count as the step", ["hspu", 4, [3], "Slow Negatives"], { shoulders: 1, arms: 0.5 }],
  ["a variation renamed since counts as the step", ["pushup", 5, [10], "Renamed Long Ago"], { chest: 1, shoulders: 0.5, arms: 0.5 }],
  ["another area's variation name counts as the step", ["pushup", 5, [10], "Dead Hangs"], { chest: 1, shoulders: 0.5, arms: 0.5 }]
];
vcases.forEach(([name, [a, s, sets, v], want]) => eq(name, T.groupWeights(bw(W, a, s, sets, v)), want));
["constructor", "__proto__", "toString", "hasOwnProperty", "step"].forEach(v => {
  let got;
  try { got = T.groupWeights(bw(W, "pushup", 5, [10], v)); } catch (e) { got = "threw " + e.message; }
  eq("variant \"" + v + "\" counts as the step", got, { chest: 1, shoulders: 0.5, arms: 0.5 });
});

section("quick logs: n sets per group, ¼ to the usual helpers");
eq("chest 4 + back 3 → arms ¼ × 7, shoulders ¼ × 4", T.groupWeights(quick(W, { chest: 4, back: 3 })),
  { chest: 4, back: 3, shoulders: 1, arms: 1.75 });
eq("shoulders 4 + arms 6 + abs 3 + legs 5 → arms 6 + 1", T.groupWeights(quick(W, { shoulders: 4, arms: 6, abs: 3, legs: 5 })),
  { shoulders: 4, arms: 7, abs: 3, legs: 5 });
eq("chest 1 → ¼ arms, ¼ shoulders", T.groupWeights(quick(W, { chest: 1 })), { chest: 1, shoulders: 0.25, arms: 0.25 });
eq("arms, abs and legs have no helpers", T.groupWeights(quick(W, { arms: 2, abs: 2, legs: 2 })), { arms: 2, abs: 2, legs: 2 });
eq("unknown and inherited group names are ignored", T.groupWeights(quick(W, JSON.parse('{"chest":2,"calves":3,"constructor":2,"__proto__":4}'))),
  { chest: 2, shoulders: 0.5, arms: 0.5 });

section("entries that count for nothing");
eq("gym entry of an exercise nobody knows → {} (the gym sections below have the rest)",
  T.groupWeights({ id: "g1", ts: W, kind: "gym", exId: "gone_ex", sets: [8, 8], kg: [60, 60], note: "", mts: W }), {});
eq("weigh-in → {}", T.groupWeights({ id: "w1", ts: W, kind: "body", kg: 80, waist: null, note: "", mts: W }), {});
eq("unknown kind → {}", T.groupWeights({ id: "u1", ts: W, kind: "yoga", sets: [10] }), {});
eq("null → {}", T.groupWeights(null), {});
{
  const a = T.groupWeights(bw(W, "pushup", 5, [10]));
  a.chest = 99;
  const w = T.setWeights("bridge", 1, "");
  w.legs = 99;
  eq("results are fresh copies (changing one changes nothing else)", [T.groupWeights(bw(W, "pushup", 5, [10])), T.setWeights("bridge", 1, "")],
    [{ chest: 1, shoulders: 0.5, arms: 0.5 }, { back: 0.5, legs: 1 }]);
}

section("one week's volume");
const week = [
  bw(L(2026, 9, 20, 23, 59), "pushup", 5, [20, 20]),             // Sunday before: last week
  quick(L(2026, 9, 21, 0, 0), { legs: 12 }),                      // Monday 00:00 exactly
  quick(L(2026, 9, 22, 18), { back: 8, shoulders: 6 }),
  quick(L(2026, 9, 23, 18), { chest: 9 }),
  quick(L(2026, 9, 24, 18), { arms: 12 }),
  quick(L(2026, 9, 25, 18), { abs: 6 }),
  bw(L(2026, 9, 25, 19), "legraise", 6, [12, 10, 8]),
  { id: "w1", ts: L(2026, 9, 26, 8), kind: "body", kg: 80, waist: null, note: "", mts: L(2026, 9, 26, 8) },
  { id: "g1", ts: L(2026, 9, 26, 18), kind: "gym", exId: "bench_bb", sets: [8], kg: [60], note: "", mts: L(2026, 9, 26, 18) },
  bw(L(2026, 9, 27, 23, 59, 59, 999), "pushup", 5, [15, 12]),     // Sunday's last millisecond
  bw(L(2026, 9, 28, 0, 0), "squat", 5, [20, 20])                  // next Monday 00:00
];
// The gym entry (Saturday): 1 working set of bench press → chest 1, shoulders ½, arms ½.
const WEEK = { chest: 12, back: 8, shoulders: 9.75, arms: 19.25, abs: 9, legs: 12 };
eq("21–27 Sep: quick logs + ladder sessions + a gym set, boundaries included/excluded", T.weekVolume(week, L(2026, 9, 21)), WEEK);
eq("asking with any moment of the week gives the same", T.weekVolume(week, L(2026, 9, 24, 12)), WEEK);
eq("order of the log doesn't matter", T.weekVolume(week.slice().reverse(), L(2026, 9, 21)), WEEK);
eq("the week before: only the Sunday 23:59 session", T.weekVolume(week, L(2026, 9, 14)),
  { chest: 2, back: 0, shoulders: 1, arms: 1, abs: 0, legs: 0 });
eq("the week after: only the Monday 00:00 session", T.weekVolume(week, L(2026, 9, 28)),
  { chest: 0, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 2 });
eq("inWeek lists the 9 entries of the week, in log order", T.inWeek(week, L(2026, 9, 21)).map(e => e.id), week.slice(1, 10).map(e => e.id));
eq("an empty log: six zeros, in group order", T.weekVolume([], W), { chest: 0, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 0 });
eq("no log at all: six zeros", T.weekVolume(null, W), { chest: 0, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 0 });
{
  const many = [];
  for (let i = 0; i < 41; i++) many.push(quick(W + i, { chest: 1 }));
  eq("41 quarter sets add up exactly (10¼, not 10.249…)", T.weekVolume(many, W).arms, 10.25);
}

section("targets: settings range × each group's scale");
const T1020 = { chest: [10, 20], back: [10, 20], shoulders: [10, 20], arms: [20, 40], abs: [10, 20], legs: [20, 40] };
eq("[10, 20] → arms and legs [20, 40]", T.targets([10, 20]), T1020);
eq("the default settings give the same", T.targets(M.defaultSettings().vol), T1020);
eq("[8, 16] → arms and legs [16, 32]", T.targets([8, 16]),
  { chest: [8, 16], back: [8, 16], shoulders: [8, 16], arms: [16, 32], abs: [8, 16], legs: [16, 32] });
[undefined, null, [], [20, 10], ["a", "b"], [0, 5], [10], "10-20"].forEach(v =>
  eq("unusable range " + J(v) + " → the default", T.targets(v), T1020));
{
  const vol = [12, 18];
  T.targets(vol);
  check("targets() leaves the stored range alone", same(vol, [12, 18]));
}

section("zones");
const Z = (lo, hi, list) => list.forEach(([x, z]) => eq(x + " of " + lo + "–" + hi + " → " + z, T.zone(x, lo, hi), z));
Z(10, 20, [[0, "none"], [-1, "none"], [NaN, "none"], [undefined, "none"], [0.25, "low"], [4.75, "low"], [5, "building"],
  [9.75, "building"], [10, "on"], [15, "on"], [20, "on"], [20.25, "above"], [40, "above"]]);
Z(20, 40, [[9.75, "low"], [10, "building"], [19.75, "building"], [20, "on"], [40, "on"], [40.25, "above"]]);
Z(7, 14, [[3.25, "low"], [3.5, "building"], [6.75, "building"], [7, "on"]]);
Z(1, 1, [[0.25, "low"], [0.5, "building"], [1, "on"], [1.25, "above"]]);
check("every zone has a label", T.ZONES.every(z => typeof T.ZONE_LABELS[z] === "string" && T.ZONE_LABELS[z]));

section("the six bars for a week");
eq("21–27 Sep with the default range", T.weekSummary(week, L(2026, 9, 21), [10, 20]).map(r => [r.group, r.sets, r.lo, r.hi, r.zone]), [
  ["chest", 12, 10, 20, "on"],
  ["back", 8, 10, 20, "building"],
  ["shoulders", 9.75, 10, 20, "building"],
  ["arms", 19.25, 20, 40, "building"],
  ["abs", 9, 10, 20, "building"],
  ["legs", 12, 20, 40, "building"]
]);

section("showing set counts");
[[0, "0"], [0.25, "¼"], [0.5, "½"], [0.75, "¾"], [1, "1"], [9.25, "9¼"], [12.5, "12½"],
  [18.75, "18¾"], [20, "20"], [1.2, "1¼"], [1.3, "1¼"], [-2, "0"], [NaN, "0"]].forEach(([x, s]) =>
  eq(String(x) + " → \"" + s + "\"", T.fmtSets(x), s));

/* ---------- The tabs (P3) ---------- */

function gym(ts) { n++; return { id: "g" + n, ts, kind: "gym", exId: "bench_bb", sets: [8, 8], kg: [60, 60], note: "", mts: ts }; }
function weigh(ts) { n++; return { id: "w" + n, ts, kind: "body", kg: 80, waist: null, note: "", mts: ts }; }
const byTime = log => log.slice().sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : 1));
const ZERO = { chest: 0, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 0 };
const V = o => Object.assign({}, ZERO, o);
const range = (k, f) => Array.from({ length: k }, (_, i) => f(i));
const ODD_GROUPS = ["calves", "constructor", "__proto__", "toString", "hasOwnProperty", "", undefined, null, 3];
const flat = rows => [].concat(...rows);

section("what one entry adds to one group");
{
  const p = bw(W, "pushup", 5, [12, 10, 8]);
  eq("pushups step 5 × 3 → chest 3", T.contribution(p, "chest"), 3);
  eq("… → arms 1½", T.contribution(p, "arms"), 1.5);
  eq("… → legs 0", T.contribution(p, "legs"), 0);
  eq("quick chest 4 + back 3 → arms 1¾ (¼ × 7)", T.contribution(quick(W, { chest: 4, back: 3 }), "arms"), 1.75);
  eq("Dead Hangs × 2 → arms 1 (½ each)", T.contribution(bw(W, "pullup", 3, [30, 30], "Dead Hangs"), "arms"), 1);
  eq("an unknown variant counts as its step", T.contribution(bw(W, "pushup", 5, [10], "Renamed Long Ago"), "chest"), 1);
  eq("a gym entry (2 sets of barbell bench press) → chest 2, arms 1, legs 0",
    ["chest", "arms", "legs"].map(g => T.contribution(gym(W), g)), [2, 1, 0]);
  eq("a weigh-in → 0", T.contribution(weigh(W), "legs"), 0);
  eq("null → 0", T.contribution(null, "chest"), 0);
  ODD_GROUPS.forEach(g => eq("group " + String(g) + " → 0", T.contribution(p, g), 0));
}

section("the groups trained on one day (week-strip and calendar dots)");
// Monday 28 Sep – Sunday 4 Oct 2026, plus a day either side.
const DAYS = byTime([
  bw(L(2026, 9, 27, 18), "pushup", 5, [10]),                      // Sunday before: chest 1, ½ arms, ½ shoulders
  bw(L(2026, 9, 28, 23, 59, 59, 999), "squat", 5, [20, 20]),       // Mon, its last ms
  weigh(L(2026, 9, 29, 8)),
  quick(L(2026, 9, 29, 10), { chest: 2 }),                          // chest 2, arms ½, shoulders ½
  bw(L(2026, 9, 29, 19), "pullup", 3, [30], "Dead Hangs"),         // + arms ½ → arms 1 that day
  bw(L(2026, 9, 29, 20), "pullup", 3, [10], "Scapular Pulls"),     // back ½ only
  bw(L(2026, 9, 30, 0, 0), "legraise", 5, [10, 10]),               // Wed 00:00
  quick(L(2026, 10, 1, 20), { back: 3 }),                           // Thu evening (arms ¾)
  quick(L(2026, 10, 2, 18), { chest: 5 }),                          // Fri: chest 5, arms 1¼, shoulders 1¼
  weigh(L(2026, 10, 3, 8)),                                         // Sat: a weigh-in only
  gym(L(2026, 10, 4, 18)),                                          // Sun: a gym exercise only
  bw(L(2026, 10, 5, 0, 0), "squat", 5, [20])                        // next Monday 00:00
]);
[
  [L(2026, 9, 27, 12), ["chest"], "Sunday before: one set of pushups (its ½s don't make dots)"],
  [L(2026, 9, 28, 12), ["legs"], "Monday: squats at 23:59:59.999"],
  [L(2026, 9, 29), ["chest", "arms"], "Tuesday: two ½s of arms from two entries make a dot; ½ back, ½ shoulders don't"],
  [L(2026, 9, 29, 23, 59, 59, 999), ["chest", "arms"], "Tuesday, asked at its last ms"],
  [L(2026, 9, 30, 15), ["abs"], "Wednesday: leg raises at 00:00"],
  [L(2026, 10, 1, 9), ["back"], "Thursday: quick back 3 (its ¾ arms isn't a set)"],
  [L(2026, 10, 2, 9), ["chest", "shoulders", "arms"], "Friday: quick chest 5 gives its helpers 1¼ each"],
  [L(2026, 10, 3, 9), [], "Saturday: a weigh-in only"],
  [L(2026, 10, 4, 9), ["chest", "shoulders", "arms"], "Sunday: a gym exercise only: 2 sets of bench press (chest 2, shoulders 1, arms 1)"],
  [L(2026, 10, 5, 12), ["legs"], "next Monday"],
  [L(2026, 10, 6, 12), [], "a day with nothing"]
].forEach(([ts, want, name]) => eq(name, T.dayGroups(DAYS, ts), want));
eq("log order doesn't matter", T.dayGroups(DAYS.slice().reverse(), L(2026, 9, 29)), ["chest", "arms"]);
eq("empty log → []", T.dayGroups([], W), []);
eq("no log → []", T.dayGroups(null, W), []);

section("the week strip");
{
  const row = d => [d.key, d.dow, d.groups, d.trained, d.today, d.future];
  eq("Thursday 15:00: Mon–Thu shown; Fri–Sun are future and stay empty", T.weekStrip(DAYS, L(2026, 10, 1, 15)).map(row), [
    ["2026-09-28", 0, ["legs"], true, false, false],
    ["2026-09-29", 1, ["chest", "arms"], true, false, false],
    ["2026-09-30", 2, ["abs"], true, false, false],
    ["2026-10-01", 3, ["back"], true, true, false],     // logged at 20:00: today shows all of today
    ["2026-10-02", 4, [], false, false, true],
    ["2026-10-03", 5, [], false, false, true],
    ["2026-10-04", 6, [], false, false, true]
  ]);
  eq("Sunday 23:00: a weigh-in day isn't trained; a gym-only day is, with its dots", T.weekStrip(DAYS, L(2026, 10, 4, 23)).map(row), [
    ["2026-09-28", 0, ["legs"], true, false, false],
    ["2026-09-29", 1, ["chest", "arms"], true, false, false],
    ["2026-09-30", 2, ["abs"], true, false, false],
    ["2026-10-01", 3, ["back"], true, false, false],
    ["2026-10-02", 4, ["chest", "shoulders", "arms"], true, false, false],
    ["2026-10-03", 5, [], false, false, false],
    ["2026-10-04", 6, ["chest", "shoulders", "arms"], true, true, false]
  ]);
  const mon = T.weekStrip(DAYS, L(2026, 9, 28, 0, 0));
  eq("Monday 00:00: Monday is today (with what's logged later today), the rest future",
    mon.map(d => [d.groups, d.trained, d.today, d.future]),
    [[["legs"], true, true, false]].concat(range(6, () => [[], false, false, true])));
  eq("each day's ts is its local midnight", T.weekStrip(DAYS, L(2026, 10, 1, 15)).map(d => d.ts), range(7, i => L(2026, 9, 28 + i)));
  eq("across the new year", T.weekStrip([], L(2027, 1, 1, 12)).map(d => d.key + (d.today ? "*" : "")),
    ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01*", "2027-01-02", "2027-01-03"]);
  eq("an empty log: seven empty days", T.weekStrip([], L(2026, 10, 1)).map(d => [d.groups.length, d.trained]), range(7, () => [0, false]));
  eq("no log: seven empty days too", T.weekStrip(null, L(2026, 10, 1)).length, 7);
}
DST.forEach(([[y, mo, d], where]) => {
  const name = y + "-" + mo + "-" + d + " (" + where + ")";
  const log = [bw(L(y, mo, d - 6, 0, 30), "pushup", 5, [10]), bw(L(y, mo, d, 23, 30), "squat", 5, [20]), bw(L(y, mo, d + 1, 0, 30), "legraise", 5, [10])];
  const s = T.weekStrip(log, L(y, mo, d, 12));
  eq(name + ": strip days are the local midnights Monday → Sunday", s.map(x => x.ts), range(7, i => L(y, mo, d - 6 + i)));
  eq(name + ": keys", s.map(x => x.key), range(7, i => M.dateStr(L(y, mo, d - 6 + i))));
  check(name + ": one calendar day apart, all at 00:00", s.every((x, i) => (!i || M.dayDelta(s[i - 1].ts, x.ts) === 1) && new Date(x.ts).getHours() === 0));
  eq(name + ": dots Monday 00:30 and Sunday 23:30, none from the next Monday 00:30", s.map(x => x.groups), [["chest"], [], [], [], [], [], ["legs"]]);
  eq(name + ": Sunday is today", s.map(x => x.today), [false, false, false, false, false, false, true]);
  const nx = T.weekStrip(log, L(y, mo, d + 1, 0, 30));
  eq(name + ": from the next Monday the strip starts there", [nx[0].ts, nx[0].groups, nx[0].today], [L(y, mo, d + 1), ["abs"], true]);
});

section("weekly history (8-week bars, the radar's ghost)");
{
  eq("three weeks to Wednesday 30 Sep, oldest first", T.weekHistory(week, L(2026, 9, 30, 12), 3).map(w => [w.start, w.label, w.sets]), [
    [L(2026, 9, 14), "14–20 Sep", V({ chest: 2, shoulders: 1, arms: 1 })],
    [L(2026, 9, 21), "21–27 Sep", WEEK],
    [L(2026, 9, 28), "28 Sep – 4 Oct", V({ legs: 2 })]
  ]);
  const h8 = T.weekHistory(week, L(2026, 9, 30, 12));
  eq("no n → 8 weeks, from Monday 10 Aug", [h8.length, h8[0].start, h8[7].start], [8, L(2026, 8, 10), L(2026, 9, 28)]);
  eq("the ghost is last week: weekHistory(…, 2)[0]", T.weekHistory(week, L(2026, 9, 30, 12), 2)[0].sets, T.weekVolume(week, T.addWeeks(L(2026, 9, 30), -1)));
  eq("n = 1 → this week only", T.weekHistory(week, L(2026, 9, 24), 1).map(w => w.sets), [WEEK]);
  eq("n = 0 → 1 week; n = 2.6 → 3; n = \"x\" → 8; n = 1000 → 104",
    [0, 2.6, "x", 1000].map(k => T.weekHistory([], L(2026, 9, 24), k).length), [1, 3, 8, 104]);
  eq("across the new year (short labels)", T.weekHistory([], L(2027, 1, 6), 3).map(w => [w.start, w.label]),
    [[L(2026, 12, 21), "21–27 Dec"], [L(2026, 12, 28), "28 Dec – 3 Jan"], [L(2027, 1, 4), "4–10 Jan"]]);
  DST.forEach(([[y, mo, d], where]) => {
    const log = [bw(L(y, mo, d, 23, 30), "squat", 5, [20]), bw(L(y, mo, d + 1, 0, 30), "pushup", 5, [10])];
    eq(y + "-" + mo + "-" + d + " (" + where + "): the week before, the DST week, the week after",
      T.weekHistory(log, L(y, mo, d + 3, 12), 3).map(w => [w.start, w.sets.legs, w.sets.chest]),
      [[L(y, mo, d - 13), 0, 0], [L(y, mo, d - 6), 1, 0], [L(y, mo, d + 1), 0, 1]]);
  });
  eq("empty log: zeros", T.weekHistory([], L(2026, 9, 24), 2).map(w => w.sets), [ZERO, ZERO]);
}

section("last trained, and days since");
const LT = byTime([
  quick(L(2026, 9, 21, 18), { chest: 3 }),                          // chest 3, arms ¾, shoulders ¾
  bw(L(2026, 9, 23, 19), "pushup", 5, [10]),                        // chest 1, arms ½, shoulders ½
  bw(L(2026, 9, 24, 8), "pullup", 3, [30], "Dead Hangs"),          // arms ½ …
  bw(L(2026, 9, 24, 20), "legraise", 6, [10], "L-Sit Hold"),       // … + ½ = 1 that day; abs 1
  bw(L(2026, 9, 25, 12), "squat", 5, [20]),                         // legs 1
  weigh(L(2026, 9, 29, 8)),
  bw(L(2026, 9, 30, 12), "pullup", 5, [5]),                         // back 1, at "now" exactly
  bw(L(2026, 9, 30, 18), "squat", 5, [20]),                         // later today: after now
  quick(L(2026, 10, 2, 10), { shoulders: 5 })                       // a later day
]);
const NOW = L(2026, 9, 30, 12);
{
  const all = now => M.GROUPS.map(g => T.lastTrained(LT, g, now));
  eq("Wednesday 30 Sep 12:00: chest 23 Sep · back now · shoulders never · arms and abs 24 Sep 20:00 · legs 25 Sep",
    all(NOW), [L(2026, 9, 23, 19), NOW, 0, L(2026, 9, 24, 20), L(2026, 9, 24, 20), L(2026, 9, 25, 12)]);
  eq("Saturday 3 Oct: the later entries count now (shoulders 2 Oct and its ¼ × 5 arms, legs 30 Sep 18:00)",
    all(L(2026, 10, 3)), [L(2026, 9, 23, 19), L(2026, 9, 30, 12), L(2026, 10, 2, 10), L(2026, 10, 2, 10), L(2026, 9, 24, 20), L(2026, 9, 30, 18)]);
  eq("24 Sep noon: the morning's ½ arms isn't a hard set yet", T.lastTrained(LT, "arms", L(2026, 9, 24, 12)), 0);
  eq("a second before the pullups: back never", T.lastTrained(LT, "back", NOW - 1), 0);
  ODD_GROUPS.forEach(g => eq("group " + String(g) + " → 0", T.lastTrained(LT, g, NOW), 0));
  eq("empty log → 0", T.lastTrained([], "chest", NOW), 0);
  eq("no log → 0", T.lastTrained(undefined, "chest", NOW), 0);
  eq("a gym entry trains chest (2 sets), shoulders and arms (1 each); a weigh-in nothing",
    M.GROUPS.map(g => T.lastTrained([gym(W), weigh(W + 1)], g, W + 2)), [W, 0, W, W, 0, 0]);

  eq("days since: 23 Sep 19:00 → Wed 30 Sep 12:00 is 7", T.daysSince(L(2026, 9, 23, 19), NOW), 7);
  eq("24 Sep 20:00 → 6", T.daysSince(L(2026, 9, 24, 20), NOW), 6);
  eq("same moment → 0", T.daysSince(NOW, NOW), 0);
  eq("00:01 → 23:59 the same day → 0", T.daysSince(L(2026, 9, 30, 0, 1), L(2026, 9, 30, 23, 59)), 0);
  eq("23:59 → 00:01 the next day → 1", T.daysSince(L(2026, 9, 29, 23, 59), L(2026, 9, 30, 0, 1)), 1);
  eq("across the new year → 1", T.daysSince(L(2026, 12, 31, 23), L(2027, 1, 1, 1)), 1);
  eq("a later ts → 0", T.daysSince(L(2026, 10, 2), NOW), 0);
  eq("never (0), nothing, NaN → null", [T.daysSince(0, NOW), T.daysSince(undefined, NOW), T.daysSince(NaN, NOW)], [null, null, null]);
  DST.forEach(([[y, mo, d], where]) => eq(y + "-" + mo + "-" + d + " (" + where + "): Saturday 23:00 → Sunday 23:00 is 1; Monday 00:30 → Sunday 23:30 is 6; → next Monday is 7",
    [T.daysSince(L(y, mo, d - 1, 23), L(y, mo, d, 23)), T.daysSince(L(y, mo, d - 6, 0, 30), L(y, mo, d, 23, 30)), T.daysSince(L(y, mo, d - 6), L(y, mo, d + 1))],
    [1, 6, 7]));
}

section("workouts and the week streak");
const WK = byTime([
  // 31 Aug – 6 Sep: 3 workouts
  bw(L(2026, 8, 31, 18), "pushup", 5, [10]), quick(L(2026, 9, 2, 18), { legs: 5 }), gym(L(2026, 9, 4, 18)),
  // 7–13 Sep: 1 workout, and a weigh-in
  bw(L(2026, 9, 9, 18), "squat", 5, [20]), weigh(L(2026, 9, 10, 8)),
  // 14–20 Sep: 2 workouts (Monday 00:00, Sunday 23:59)
  bw(L(2026, 9, 14, 0, 0), "pullup", 5, [5]), bw(L(2026, 9, 20, 23, 59), "legraise", 5, [10]),
  // 21–27 Sep: 2 workouts — two entries on Tuesday are one; Thursday has a weigh-in only
  quick(L(2026, 9, 22, 7), { chest: 4 }), bw(L(2026, 9, 22, 19), "pushup", 5, [10]), weigh(L(2026, 9, 24, 8)), gym(L(2026, 9, 26, 10)),
  // 28 Sep – 4 Oct: Monday, and Friday
  bw(L(2026, 9, 28, 18), "squat", 5, [20]), quick(L(2026, 10, 2, 18), { back: 4 })
]);
{
  const DAYS_WK = ["2026-08-31", "2026-09-02", "2026-09-04", "2026-09-09", "2026-09-14", "2026-09-20", "2026-09-22", "2026-09-26", "2026-09-28", "2026-10-02"];
  eq("workout days: oldest first, one per day, no weigh-in days", T.workoutDays(WK), DAYS_WK);
  eq("the log's order doesn't matter", T.workoutDays(WK.slice().reverse()), DAYS_WK);
  eq("total workouts: 10 (a later day that is logged counts)", T.totalWorkouts(WK), 10);
  eq("workouts this week, Wednesday 30 Sep: 1 (Friday's is still ahead)", T.workoutsInWeek(WK, L(2026, 9, 30, 12)), 1);
  eq("… Saturday 3 Oct: 2", T.workoutsInWeek(WK, L(2026, 10, 3)), 2);
  eq("… Thursday 24 Sep: 1 (Tuesday's two entries; the weigh-in doesn't count)", T.workoutsInWeek(WK, L(2026, 9, 24, 20)), 1);
  eq("… Sunday 27 Sep 23:00: 2", T.workoutsInWeek(WK, L(2026, 9, 27, 23)), 2);
  eq("… Saturday 12 Sep: 1 (Wednesday; the weigh-in doesn't count)", T.workoutsInWeek(WK, L(2026, 9, 12)), 1);
  eq("… Monday 12 Oct: 0", T.workoutsInWeek(WK, L(2026, 10, 12)), 0);

  const S = now => T.weekStreak(WK, now);
  eq("streak, Wed 30 Sep: 2 — this week's 1 doesn't count or break it; 7–13 Sep had 1", S(L(2026, 9, 30, 12)), 2);
  eq("streak, Sat 3 Oct: 3 — this week has its 2 now", S(L(2026, 10, 3, 12)), 3);
  eq("streak, Sun 27 Sep 23:00: 2", S(L(2026, 9, 27, 23)), 2);
  eq("streak, Tue 22 Sep 20:00: 1 (from 14–20 Sep)", S(L(2026, 9, 22, 20)), 1);
  eq("streak, Wed 9 Sep 20:00: 1 (31 Aug – 6 Sep had 3)", S(L(2026, 9, 9, 20)), 1);
  eq("streak, Sun 6 Sep: 1", S(L(2026, 9, 6, 12)), 1);
  eq("streak, Mon 12 Oct: 0 — last week had none", S(L(2026, 10, 12, 12)), 0);
  eq("streak before the first workout: 0", S(L(2026, 8, 1)), 0);
  const fixed = WK.filter(e => e.kind !== "body").concat([quick(L(2026, 9, 10, 8), { abs: 4 })]);
  eq("…had 10 Sep been a workout, not a weigh-in, the streak on 30 Sep would be 4", T.weekStreak(byTime(fixed), L(2026, 9, 30, 12)), 4);
  const onlyWeighIns = [weigh(L(2026, 9, 21)), weigh(L(2026, 9, 22)), weigh(L(2026, 9, 28)), weigh(L(2026, 9, 29))];
  eq("weigh-ins alone: no workouts, no streak", [T.workoutDays(onlyWeighIns), T.totalWorkouts(onlyWeighIns), T.workoutsInWeek(onlyWeighIns, L(2026, 9, 30)), T.weekStreak(onlyWeighIns, L(2026, 9, 30))], [[], 0, 0, 0]);
  eq("empty log", [T.workoutDays([]), T.totalWorkouts([]), T.workoutsInWeek([], NOW), T.weekStreak([], NOW)], [[], 0, 0, 0]);

  const NY = [L(2026, 12, 21, 18), L(2026, 12, 24, 18), L(2026, 12, 30, 18), L(2027, 1, 2, 18), L(2027, 1, 4, 18)].map(t => bw(t, "squat", 5, [20]));
  eq("across the new year: Tue 5 Jan 2027 → 2 (28 Dec – 3 Jan, 21–27 Dec)", T.weekStreak(NY, L(2027, 1, 5)), 2);
  eq("… workouts in 28 Dec – 3 Jan, on Sunday 3 Jan: 2", T.workoutsInWeek(NY, L(2027, 1, 3, 12)), 2);
  eq("… on Friday 1 Jan (2 Jan is ahead): 1", T.workoutsInWeek(NY, L(2027, 1, 1, 12)), 1);
}
DST.forEach(([[y, mo, d], where]) => {
  const name = y + "-" + mo + "-" + d + " (" + where + ")";
  // Two workouts in the week before and in the DST week, at the edges of each; one the Monday after.
  const log = [L(y, mo, d - 13, 0, 30), L(y, mo, d - 7, 23, 30), L(y, mo, d - 6, 0, 30), L(y, mo, d, 23, 30), L(y, mo, d + 1, 0, 0)]
    .map(t => bw(t, "squat", 5, [20]));
  eq(name + ": workouts in the DST week: 2", T.workoutsInWeek(log, L(y, mo, d, 23, 45)), 2);
  eq(name + ": the Monday after: 1 this week, streak 2", [T.workoutsInWeek(log, L(y, mo, d + 1, 12)), T.weekStreak(log, L(y, mo, d + 1, 12))], [1, 2]);
});

section("the month calendar");
{
  const keys = rows => rows.map(r => r.map(c => c.key.slice(5) + (c.inMonth ? "" : "*")).join(" "));
  eq("February 2027 starts on a Monday: exactly 4 rows, no other month's days", keys(T.monthGrid(L(2027, 2, 14, 12))), [
    "02-01 02-02 02-03 02-04 02-05 02-06 02-07",
    "02-08 02-09 02-10 02-11 02-12 02-13 02-14",
    "02-15 02-16 02-17 02-18 02-19 02-20 02-21",
    "02-22 02-23 02-24 02-25 02-26 02-27 02-28"
  ]);
  eq("March 2026 (1st a Sunday, DST at the end): 6 rows from Monday 23 Feb", keys(T.monthGrid(L(2026, 3, 29, 12))), [
    "02-23* 02-24* 02-25* 02-26* 02-27* 02-28* 03-01",
    "03-02 03-03 03-04 03-05 03-06 03-07 03-08",
    "03-09 03-10 03-11 03-12 03-13 03-14 03-15",
    "03-16 03-17 03-18 03-19 03-20 03-21 03-22",
    "03-23 03-24 03-25 03-26 03-27 03-28 03-29",
    "03-30 03-31 04-01* 04-02* 04-03* 04-04* 04-05*"
  ]);
  eq("November 2026 (1st a Sunday)", keys(T.monthGrid(L(2026, 11, 1))), [
    "10-26* 10-27* 10-28* 10-29* 10-30* 10-31* 11-01",
    "11-02 11-03 11-04 11-05 11-06 11-07 11-08",
    "11-09 11-10 11-11 11-12 11-13 11-14 11-15",
    "11-16 11-17 11-18 11-19 11-20 11-21 11-22",
    "11-23 11-24 11-25 11-26 11-27 11-28 11-29",
    "11-30 12-01* 12-02* 12-03* 12-04* 12-05* 12-06*"
  ]);
  const dec = flat(T.monthGrid(L(2026, 12, 31, 23, 59))), jan = flat(T.monthGrid(L(2027, 1, 1)));
  eq("December 2026 runs into January 2027", [dec.length, dec[0].key, dec[dec.length - 1].key, dec.filter(c => !c.inMonth).map(c => c.key)],
    [35, "2026-11-30", "2027-01-03", ["2026-11-30", "2027-01-01", "2027-01-02", "2027-01-03"]]);
  eq("January 2027 starts in December 2026 and ends on a Sunday", [jan.length, jan[0].key, jan[jan.length - 1].key, jan.filter(c => !c.inMonth).map(c => c.key)],
    [35, "2026-12-28", "2027-01-31", ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"]]);
  const feb28 = flat(T.monthGrid(L(2028, 2, 1)));
  eq("February 2028 has 29 days", [feb28.filter(c => c.inMonth).length, feb28[0].key, feb28[feb28.length - 1].key], [29, "2028-01-31", "2028-03-05"]);
  eq("a cell: key, local midnight, day number, inMonth", J(T.monthGrid(L(2026, 9, 28))[0][0]), J({ key: "2026-08-31", ts: L(2026, 8, 31), day: 31, inMonth: false }));

  let bad = [];
  for (let y = 2026; y <= 2028; y++) for (let mo = 1; mo <= 12; mo++) {
    const rows = T.monthGrid(L(y, mo, 15, 12)), cells = flat(rows);
    const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7, len = new Date(y, mo, 0).getDate();
    const inm = cells.filter(c => c.inMonth);
    const ok = rows.length === Math.ceil((lead + len) / 7) && rows.every(r => r.length === 7) &&
      rows.every(r => new Date(r[0].ts).getDay() === 1) &&
      cells.every((c, i) => c.ts === M.dateFromKey(c.key) && c.key === M.dateStr(c.ts) && c.day === new Date(c.ts).getDate() &&
        new Date(c.ts).getHours() === 0 && new Date(c.ts).getMinutes() === 0 && (!i || M.dayDelta(cells[i - 1].ts, c.ts) === 1)) &&
      same(inm.map(c => c.day), range(len, i => i + 1)) && inm.every(c => new Date(c.ts).getMonth() === mo - 1) &&
      same(T.monthGrid(L(y, mo, 1)), rows) && same(T.monthGrid(L(y, mo, len, 23, 59, 59, 999)), rows);
    if (!ok) bad.push(y + "-" + mo);
  }
  check("every month of 2026–2028: whole weeks from a Monday, consecutive local midnights, days 1…n in the month, same from any moment of it", !bad.length, bad.join(", "));
}
DST.forEach(([[y, mo, d], where, , hours]) => {
  const name = y + "-" + mo + "-" + d + " (" + where + ")";
  const cells = flat(T.monthGrid(L(y, mo, d)));
  const i = cells.findIndex(c => c.key === M.dateStr(L(y, mo, d)));
  const len = (cells[i + 1].ts - cells[i].ts) / HOUR;
  eq(name + ": the switch day is followed by the next day", [cells[i].day, cells[i + 1].key], [d, M.dateStr(L(y, mo, d + 1))]);
  if (tz === where) check(name + ": that calendar day really is " + (hours - 144) + " hours here", len === hours - 144, "got " + len);
  else check(name + ": 23, 24 or 25 hours", [23, 24, 25].indexOf(len) !== -1, "got " + len);
});

section("month names and moving by months");
eq("September 2026", T.monthLabel(L(2026, 9, 28)), "September 2026");
eq("the last ms of the year is still December", T.monthLabel(L(2026, 12, 31, 23, 59, 59, 999)), "December 2026");
eq("January 2027", T.monthLabel(L(2027, 1, 1)), "January 2027");
eq("not a time → \"\"", [T.monthLabel(NaN), T.monthLabel(undefined), T.monthLabel("soon")], ["", "", ""]);
[
  [[2026, 9, 28, 15], 1, [2026, 10, 28], "28 Sep 15:00 + 1 → 28 Oct 00:00"],
  [[2026, 1, 31], 1, [2026, 2, 28], "31 Jan + 1 → 28 Feb"],
  [[2028, 1, 31], 1, [2028, 2, 29], "31 Jan 2028 + 1 → 29 Feb (leap year)"],
  [[2026, 3, 31], -1, [2026, 2, 28], "31 Mar − 1 → 28 Feb"],
  [[2026, 5, 31], -3, [2026, 2, 28], "31 May − 3 → 28 Feb"],
  [[2026, 12, 15], 1, [2027, 1, 15], "15 Dec 2026 + 1 → 15 Jan 2027"],
  [[2027, 1, 15], -1, [2026, 12, 15], "15 Jan 2027 − 1 → 15 Dec 2026"],
  [[2026, 9, 28], 12, [2027, 9, 28], "+ 12 → a year later"],
  [[2026, 9, 28], -24, [2024, 9, 28], "− 24 → two years before"],
  [[2026, 9, 28], 0, [2026, 9, 28], "+ 0 → that day's midnight"],
  [[2026, 9, 28], 1.4, [2026, 10, 28], "n is rounded (1.4 → 1)"],
  [[2026, 9, 28], "x", [2026, 9, 28], "n that isn't a number → 0"],
  [[2026, 2, 28, 12], 1, [2026, 3, 28], "28 Feb + 1 → 28 Mar (the DST week in Rome)"],
  [[2026, 2, 8, 12], 1, [2026, 3, 8], "8 Feb + 1 → 8 Mar (DST day in New York)"],
  [[2026, 9, 25, 12], 1, [2026, 10, 25], "25 Sep + 1 → 25 Oct (DST day in Rome)"],
  [[2026, 10, 1, 12], 1, [2026, 11, 1], "1 Oct + 1 → 1 Nov (DST day in New York)"],
  [[2026, 4, 29, 12], -1, [2026, 3, 29], "29 Apr − 1 → 29 Mar (DST day in Rome)"],
  // The day after a switch: a month whose days were stepped by 24 h would land an hour off.
  [[2026, 4, 30, 12], -1, [2026, 3, 30], "30 Apr − 1 → 30 Mar 00:00 (after Rome's spring switch)"],
  [[2026, 9, 26, 12], 1, [2026, 10, 26], "26 Sep + 1 → 26 Oct 00:00 (after Rome's autumn switch)"],
  [[2026, 2, 9, 12], 1, [2026, 3, 9], "9 Feb + 1 → 9 Mar 00:00 (after New York's spring switch)"],
  [[2026, 10, 2, 12], 1, [2026, 11, 2], "2 Oct + 1 → 2 Nov 00:00 (after New York's autumn switch)"]
].forEach(([from, k, to, name]) => eq(name, T.addMonths(L(...from), k), L(...to)));
{
  let t = L(2026, 1, 1), labels = [];
  for (let i = 0; i < 36; i++) { labels.push(T.monthLabel(t)); t = T.addMonths(t, 1); }
  check("36 steps of + 1 from January 2026 visit every month once, in order", new Set(labels).size === 36 &&
    labels[0] === "January 2026" && labels[12] === "January 2027" && labels[35] === "December 2028", labels.join(", "));
  for (let i = 0; i < 36; i++) t = T.addMonths(t, -1);
  eq("…and 36 steps back return to 1 January 2026", t, L(2026, 1, 1));
  check("addMonths of something that isn't a time → NaN", Number.isNaN(T.addMonths(NaN, 1)) && Number.isNaN(T.addMonths(undefined, 1)));
}

section("what counted for a group this week (newest first)");
{
  const rows = (g, now) => T.breakdown(week, now, g).map(r => [r.entry.id, r.sets, r.weight]);
  const full = (log, now, g) => T.breakdown(log, now, g).map(r => [r.entry.id, r.sets, r.weight, r.own, r.listed, r.logged]);
  const at = L(2026, 9, 24);
  eq("arms: pushups ½ per set · bench press ½ · quick arms 12 · quick chest's ¼s · the back+shoulders log's two lines, each ¼", rows("arms", at),
    [[week[9].id, 1, 0.5], [week[8].id, 0.5, 0.5], [week[4].id, 12, 1], [week[3].id, 2.25, 0.25], [week[2].id, 2, 0.25], [week[2].id, 1.5, 0.25]]);
  eq("…with own, listed and logged", full(week, at, "arms"), [
    [week[9].id, 1, 0.5, false, null, 2],
    [week[8].id, 0.5, 0.5, false, null, 1],
    [week[4].id, 12, 1, true, "arms", 12],
    [week[3].id, 2.25, 0.25, false, "chest", 9],
    [week[2].id, 2, 0.25, false, "back", 8],
    [week[2].id, 1.5, 0.25, false, "shoulders", 6]
  ]);
  eq("shoulders: the quick log that lists it counts 1 per set (back doesn't help shoulders)", full(week, at, "shoulders"),
    [[week[9].id, 1, 0.5, false, null, 2], [week[8].id, 0.5, 0.5, false, null, 1], [week[3].id, 2.25, 0.25, false, "chest", 9], [week[2].id, 6, 1, true, "shoulders", 6]]);
  eq("chest: a skill set or a gym set for the group is own too", full(week, at, "chest"),
    [[week[9].id, 2, 1, true, null, 2], [week[8].id, 1, 1, true, null, 1], [week[3].id, 9, 1, true, "chest", 9]]);
  eq("back", rows("back", at), [[week[2].id, 8, 1]]);
  eq("abs: leg raises at 19:00 before the quick log at 18:00", rows("abs", at), [[week[6].id, 3, 1], [week[5].id, 6, 1]]);
  eq("legs: Monday 00:00 is this week; next Monday's squats aren't", rows("legs", at), [[week[1].id, 12, 1]]);
  check("each group's rows add up to its bar", M.GROUPS.every(g => T.breakdown(week, at, g).reduce((s, r) => s + r.sets, 0) === WEEK[g]));
  check("the entry is the log's own object", T.breakdown(week, at, "arms")[0].entry === week[9]);
  eq("the week before: Sunday 23:59's pushups", rows("chest", L(2026, 9, 20, 12)), [[week[0].id, 2, 1]]);
  eq("the week after: Monday 00:00's squats", rows("legs", L(2026, 9, 28, 12)), [[week[10].id, 2, 1]]);
  const q = quick(W, { chest: 2, shoulders: 3 });
  eq("a quick log listing the group and a helper of it: two rows, its own line (3 at 1) first, then 2 chest at ¼",
    full([q], W, "shoulders"), [[q.id, 3, 1, true, "shoulders", 3], [q.id, 0.5, 0.25, false, "chest", 2]]);
  eq("…and for arms, which it only helps: a row per line, in GROUPS order", full([q], W, "arms"),
    [[q.id, 0.5, 0.25, false, "chest", 2], [q.id, 0.75, 0.25, false, "shoulders", 3]]);
  const q2 = quick(W, { shoulders: 1, back: 2, chest: 3 });
  eq("own line first even when GROUPS order puts it last", full([q2], W, "arms").map(r => r[4]), ["chest", "back", "shoulders"]);
  eq("…and first for shoulders (then chest)", full([q2], W, "shoulders").map(r => r[4]), ["shoulders", "chest"]);
  const same1 = bw(W, "pushup", 5, [10]), same2 = quick(W, { chest: 1 });
  eq("two entries at the same time: the later in the log first", T.breakdown([same1, same2], W, "chest").map(r => r.entry.id), [same2.id, same1.id]);
  eq("Dead Hangs: ½ per set for arms, not own", full([bw(W, "pullup", 3, [30, 30], "Dead Hangs")], W, "arms").map(r => r.slice(1)), [[1, 0.5, false, null, 2]]);
  eq("Plank Hold (a pushup variation): abs at 1, own", full([bw(W, "pushup", 2, [30, 30, 30], "Plank Hold")], W, "abs").map(r => r.slice(1)), [[3, 1, true, null, 3]]);
  eq("…and nothing for chest", T.breakdown([bw(W, "pushup", 2, [30], "Plank Hold")], W, "chest"), []);
  eq("a 0 in the sets isn't logged", full([bw(W, "squat", 5, [0, 20, 0, 20])], W, "legs").map(r => r.slice(1)), [[2, 1, true, null, 2]]);
  {
    const g = gym(W);
    eq("a gym entry is one row (listed null, logged = its working sets); weigh-ins aren't listed",
      full([g, weigh(W)], W, "chest"), [[g.id, 2, 1, true, null, 2]]);
  }
  const odd = [quick(W, JSON.parse('{"__proto__":{"chest":5},"constructor":3,"chest":"2","legs":0,"abs":-3,"calves":4}')),
    bw(W + 1, "pushup", 5, [10], "constructor"), bw(W + 2, "__proto__", 1, [10]), bw(W + 3, "constructor", 1, [10])];
  eq("inherited and unknown names: only real lines count (quick \"2\" chest, pushups with variant \"constructor\")",
    full(odd, W, "chest").map(r => r.slice(1)), [[1, 1, true, null, 1], [2, 1, true, "chest", 2]]);
  ODD_GROUPS.forEach(g => eq("group " + String(g) + " → []", T.breakdown(week, at, g), []));
  eq("empty / no log → []", [T.breakdown([], at, "chest"), T.breakdown(null, at, "chest")], [[], []]);
}

section("what counted: the rows always add up to the bar");
{
  // Random weeks of every kind of entry (seeded, so a failure repeats).
  let seed = 11;
  const rnd = k => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 2147483648 * k); };
  const RND_EX = page.get("GYM_EXERCISES").map(e => e.id).concat(["gone_ex", "constructor", "x_nobody"]);
  const VARS = ["", "", "", "Plank Hold", "Dead Hangs", "Scapular Pulls", "Hip Thrusts", "Shoulder Openers", "Pike Hold", "Wall Walks", "L-Sit Hold", "Renamed Long Ago", "constructor"];
  let bad = [], total = 0;
  for (let w = 0; w < 60; w++) {
    const mon = L(2026, 1, 5 + 7 * w), log = [];
    for (let k = 0; k < 14; k++) {
      const t = L(2026, 1, 5 + 7 * w + rnd(8), rnd(24), rnd(60));    // a day into the next week now and then
      const r = rnd(10);
      if (r < 4) {
        const g = {};
        M.GROUPS.forEach(x => { if (rnd(3) === 0) g[x] = 1 + rnd(12); });
        log.push(quick(t, g));
      } else if (r < 8) log.push(bw(t, M.KNOWN_IDS[rnd(6)], 1 + rnd(10), range(1 + rnd(4), () => rnd(3) ? 5 + rnd(20) : 0), VARS[rnd(VARS.length)]));
      else if (r === 8) {
        // A gym exercise: built in or not, some sets warm-ups, some 0 reps.
        const ex = RND_EX[rnd(RND_EX.length)], k = 1 + rnd(5);
        n++;
        log.push({ id: "g" + n, ts: t, kind: "gym", exId: ex, sets: range(k, () => rnd(6) ? 3 + rnd(12) : 0),
          kg: range(k, () => rnd(4) ? 2.5 * (4 + rnd(30)) : 0), note: "", mts: t });
      } else log.push(weigh(t));
    }
    const now = L(2026, 1, 5 + 7 * w + rnd(7), 12), vol = T.weekVolume(log, now);
    M.GROUPS.forEach(g => {
      const rs = T.breakdown(log, now, g);
      total += rs.length;
      const sum = rs.reduce((s, x) => s + x.sets, 0);
      const ok = sum === vol[g] &&
        rs.every(x => x.sets === x.logged * x.weight && x.sets > 0 && x.own === (x.weight === 1) &&
          (x.listed === null ? x.entry.kind === undefined || x.entry.kind === "gym" : x.entry.kind === "quick" && x.entry.groups[x.listed] === x.logged)) &&
        rs.every((x, i) => !i || Number(rs[i - 1].entry.ts) >= Number(x.entry.ts)) &&
        rs.every(x => [0.25, 0.5, 1].indexOf(x.weight) !== -1);
      if (!ok) bad.push(M.dateStr(mon) + " " + g + ": " + sum + " vs " + vol[g]);
    });
  }
  check("60 random weeks × 6 groups: rows add up exactly to weekVolume; sets = logged × weight; own ⇔ weight 1; newest first (" + total + " rows)",
    !bad.length && total > 500, bad.slice(0, 3).join("; "));
}

section("the skills that feed a group");
{
  eq("feeders, per group", M.GROUPS.map(g => [g, T.feeders(g)]), [
    ["chest", ["pushup"]],
    ["back", ["pullup", "bridge"]],
    ["shoulders", ["pushup", "bridge", "hspu"]],
    ["arms", ["pushup", "pullup", "hspu"]],
    ["abs", ["legraise", "hspu"]],
    ["legs", ["squat", "bridge"]]
  ]);
  ODD_GROUPS.forEach(g => eq("group " + String(g) + " → []", T.feeders(g), []));
  eq("main feeders (AREA_GROUPS[area].all[group] ≥ 1), per group: arms has none", M.GROUPS.map(g => [g, T.mainFeeders(g)]), [
    ["chest", ["pushup"]],
    ["back", ["pullup", "bridge"]],
    ["shoulders", ["hspu"]],
    ["arms", []],
    ["abs", ["legraise"]],
    ["legs", ["squat"]]
  ]);
  ODD_GROUPS.forEach(g => eq("main feeders of " + String(g) + " → []", T.mainFeeders(g), []));
  const F = (g, steps) => T.feedersAt(g, steps).map(f => [f.areaId, f.step, f.weight]);
  const FF = (g, steps) => T.feedersAt(g, steps).map(f => [f.areaId, f.step, f.weight, f.main, f.fromStep, f.fromWeight]);
  eq("shoulders at pushups 5, bridges 2, handstands 5: main job first, then heaviest, bridges 0 at step 2",
    F("shoulders", { pushup: 5, bridge: 2, hspu: 5 }), [["hspu", 5, 1], ["pushup", 5, 0.5], ["bridge", 2, 0]]);
  eq("shoulders at pushups 5, bridges 3, handstands 1: all ½, and handstands (its main job) still first; the rest AREAS order",
    F("shoulders", { pushup: 5, bridge: 3, hspu: 1 }), [["hspu", 1, 0.5], ["pushup", 5, 0.5], ["bridge", 3, 0.5]]);
  // Every group at one set of steps (the mockup's: pushups 5, pullups 4, leg
  // raises 4, squats 5, bridges 2, handstands 2).
  const S1 = { pushup: 5, pullup: 4, legraise: 4, squat: 5, bridge: 2, hspu: 2 };
  eq("every group at pushups 5, pullups 4, leg raises 4, squats 5, bridges 2, handstands 2: [area, step, weight, main, fromStep, fromWeight]",
    M.GROUPS.map(g => [g, FF(g, S1)]), [
      ["chest", [["pushup", 5, 1, true, null, null]]],
      ["back", [["pullup", 4, 1, true, null, null], ["bridge", 2, 1, true, null, null]]],
      ["shoulders", [["hspu", 2, 0.5, true, 3, 1], ["pushup", 5, 0.5, false, null, null], ["bridge", 2, 0, false, 3, 0.5]]],
      ["arms", [["pushup", 5, 0.5, false, null, null], ["pullup", 4, 0.5, false, null, null], ["hspu", 2, 0, false, 4, 0.5]]],
      ["abs", [["legraise", 4, 1, true, null, null], ["hspu", 2, 0.5, false, null, null]]],
      ["legs", [["squat", 5, 1, true, null, null], ["bridge", 2, 0.5, false, null, null]]]
    ]);
  const S2 = { pushup: 1, pullup: 10, legraise: 1, squat: 10, bridge: 1, hspu: 5 };
  eq("…and at pushups 1, pullups 10, leg raises 1, squats 10, bridges 1, handstands 5",
    M.GROUPS.map(g => [g, FF(g, S2)]), [
      ["chest", [["pushup", 1, 1, true, null, null]]],
      ["back", [["pullup", 10, 1, true, null, null], ["bridge", 1, 0.5, true, 2, 1]]],
      ["shoulders", [["hspu", 5, 1, true, null, null], ["pushup", 1, 0.5, false, null, null], ["bridge", 1, 0, false, 3, 0.5]]],
      ["arms", [["pushup", 1, 0.5, false, null, null], ["pullup", 10, 0.5, false, null, null], ["hspu", 5, 0.5, false, null, null]]],
      ["abs", [["legraise", 1, 1, true, null, null], ["hspu", 5, 0, false, null, null]]],
      ["legs", [["squat", 10, 1, true, null, null], ["bridge", 1, 1, false, null, null]]]
    ]);
  eq("the main-job rows of feedersAt are mainFeeders, for every group at both sets of steps",
    [S1, S2].map(s => M.GROUPS.map(g => T.feedersAt(g, s).filter(f => f.main).map(f => f.areaId))),
    [S1, S2].map(() => M.GROUPS.map(g => T.mainFeeders(g))));
  eq("…and they come before every other row", [S1, S2, {}].every(s => M.GROUPS.every(g => {
    const m = T.feedersAt(g, s).map(f => f.main);
    return m.indexOf(false) === -1 || m.lastIndexOf(true) < m.indexOf(false);
  })), true);
  eq("handstands for abs: ½ at steps 1–3, then 0 with nothing to come",
    range(10, i => FF("abs", { hspu: i + 1 })[1].slice(1)), range(10, i => i < 3 ? [i + 1, 0.5, false, null, null] : [i + 1, 0, false, null, null]));
  eq("handstands for arms: 0 at steps 1–3, \"from step 4\" (½), then ½",
    range(10, i => FF("arms", { hspu: i + 1 })[2].slice(1)), range(10, i => i < 3 ? [i + 1, 0, false, 4, 0.5] : [i + 1, 0.5, false, null, null]));
  eq("handstands for shoulders: ½ at 1–2 (from step 3: 1), then 1",
    range(10, i => FF("shoulders", { hspu: i + 1 })[0].slice(1)), range(10, i => i < 2 ? [i + 1, 0.5, true, 3, 1] : [i + 1, 1, true, null, null]));
  eq("back at pullups 7, bridges 1", F("back", { pullup: 7, bridge: 1 }), [["pullup", 7, 1], ["bridge", 1, 0.5]]);
  eq("abs at leg raises 3, handstands 6 (no abs at step 6)", F("abs", { legraise: 3, hspu: 6 }), [["legraise", 3, 1], ["hspu", 6, 0]]);
  eq("legs with squats missing (→ step 1) and bridges 4", F("legs", { bridge: 4 }), [["squat", 1, 1], ["bridge", 4, 0.5]]);
  eq("state.areas works as it is (a new state: all step 1)", F("arms", M.defaultState().areas),
    [["pushup", 1, 0.5], ["pullup", 1, 0.5], ["hspu", 1, 0]]);
  eq("state.areas-shaped with steps", F("arms", { pushup: { step: 6 }, pullup: { step: 2 }, hspu: { step: 9 } }),
    [["pushup", 6, 0.5], ["pullup", 2, 0.5], ["hspu", 9, 0.5]]);
  eq("impossible steps → 1; \"5\" is read as 5", [0, 11, -2, "x", null, true, NaN, { step: "no" }, "5"].map(s => T.feedersAt("chest", { pushup: s })[0].step),
    [1, 1, 1, 1, 1, 1, 1, 1, 5]);
  eq("no steps at all → step 1 everywhere", [F("legs"), F("legs", null), F("legs", "pushup")],
    [[["squat", 1, 1], ["bridge", 1, 1]], [["squat", 1, 1], ["bridge", 1, 1]], [["squat", 1, 1], ["bridge", 1, 1]]]);
  eq("inherited step values are ignored", [F("chest", Object.create({ pushup: 7 })), F("chest", JSON.parse('{"__proto__":{"pushup":7}}'))],
    [[["pushup", 1, 1]], [["pushup", 1, 1]]]);
  eq("an odd group → []", T.feedersAt("constructor", { pushup: 5 }), []);
  eq("fromStep: a missing step counts from step 1", FF("shoulders", {}).map(f => [f[0], f[4]]), [["hspu", 3], ["pushup", null], ["bridge", 3]]);
}
{
  // The real tables never put a later area's non-main set above an earlier
  // one's, so "heaviest first" is checked on a changed copy: handstands'
  // step 10 made a full set for arms too. It is still not arms' main job
  // (the whole-area map gives arms ½).
  const alt = h.load(["data.js", "model.js", "training.js"]);
  alt.get("AREA_GROUPS").hspu.step[10] = { shoulders: 1, arms: 1 };
  const TA = alt.get("TRAINING");
  eq("(changed copy) arms at handstands 10: the full set first, not main, then AREAS order",
    TA.feedersAt("arms", { pushup: 3, pullup: 3, hspu: 10 }).map(f => [f.areaId, f.weight, f.main]),
    [["hspu", 1, false], ["pushup", 0.5, false], ["pullup", 0.5, false]]);
  eq("(changed copy) …at handstands 9 it's \"from step 10: 1\"", TA.feedersAt("arms", { hspu: 9 }).map(f => [f.areaId, f.fromStep, f.fromWeight]),
    [["pushup", null, null], ["pullup", null, null], ["hspu", 10, 1]]);
  eq("(changed copy) arms still has no main feeder", TA.mainFeeders("arms"), []);
}

section("the ladder in today's session that trains a group (the nudge's last sentence)");
{
  const SF = (g, list, steps) => T.sessionFeeder(g, list, steps);
  const S = { pushup: 5, pullup: 4, legraise: 4, squat: 5, bridge: 2, hspu: 2 };
  eq("legs, Day 2 (squats, bridges, handstands): the session starts with squats", SF("legs", ["squat", "bridge", "hspu"], S), { areaId: "squat", index: 0 });
  eq("legs, a session of pushups then squats: it includes squats (index 1)", SF("legs", ["pushup", "squat"], S), { areaId: "squat", index: 1 });
  eq("legs, bridges at step 1 (a full set for legs) and handstands", SF("legs", ["bridge", "hspu"], { bridge: 1 }), { areaId: "bridge", index: 0 });
  eq("legs, bridges at step 2 (½ for legs): nothing", SF("legs", ["bridge", "hspu"], S), null);
  eq("shoulders, handstands at step 2 (½): nothing; at step 3 (1): handstands", [SF("shoulders", ["hspu"], { hspu: 2 }), SF("shoulders", ["hspu"], { hspu: 3 })],
    [null, { areaId: "hspu", index: 0 }]);
  eq("arms: no ladder ever counts 1 for arms", SF("arms", ["pushup", "pullup", "legraise", "squat", "bridge", "hspu"], { hspu: 10 }), null);
  eq("back, Day 1 (pushups, pullups, leg raises) from state.areas", SF("back", ["pushup", "pullup", "legraise"], M.defaultState().areas),
    { areaId: "pullup", index: 1 });
  eq("an area not in the session doesn't count", SF("chest", ["squat", "bridge", "hspu"], S), null);
  eq("junk in the list is skipped (index still counts places)", SF("abs", [null, 7, "constructor", "__proto__", "legraise"], S), { areaId: "legraise", index: 4 });
  eq("no list, not a list, odd groups → null",
    [SF("legs", null, S), SF("legs", "squat", S), SF("legs", { 0: "squat", length: 1 }, S)].concat(ODD_GROUPS.map(g => SF(g, ["squat", "pushup"], S))),
    range(3 + ODD_GROUPS.length, () => null));
  eq("inherited steps are ignored (step 1: bridges then count 1 for legs)", SF("legs", ["bridge"], Object.create({ bridge: 2 })), { areaId: "bridge", index: 0 });
}

section("the one nudge about muscle groups");
{
  const WED = L(2026, 9, 30, 12), THU = L(2026, 10, 1, 18);
  const N = (log, now, vol) => T.groupNudge(byTime(log), now, vol || [10, 20]);
  eq("thresholds: dot 1 set · streak 2 workouts · history 8 weeks · untrained 8 days · newcomer 3 workouts · behind from Thursday below ½ lo · building from ½ lo · radar 1",
    [T.DOT_SETS, T.STREAK_WORKOUTS, T.HISTORY_WEEKS, T.UNTRAINED_DAYS, T.NEWCOMER_WORKOUTS, T.BEHIND_FROM_DAY, T.BEHIND_SHARE, T.BUILDING_SHARE, T.RADAR_MAX],
    [1, 2, 8, 8, 3, 3, 0.5, 0.5, 1]);
  eq("an empty log: none, even on Thursday", [N([], WED), N([], THU), T.groupNudge(null, THU)], [null, null, null]);
  eq("weigh-ins only: none", N([weigh(L(2026, 9, 20)), weigh(L(2026, 9, 27)), weigh(L(2026, 9, 29))], THU), null);

  const recent = () => quick(L(2026, 9, 28, 18), { chest: 10, shoulders: 10, arms: 10, abs: 10 });
  const u1 = [recent(), quick(L(2026, 9, 21, 10), { back: 5 }), quick(L(2026, 9, 20, 10), { legs: 8 })];
  eq("untrained: legs 10 days, back 9 → legs, 10 (0 of 20 this week)", N(u1, WED), { group: "legs", kind: "untrained", days: 10, sets: 0, lo: 20 });
  eq("legs 7 days, back 9 → back, 9", N([recent(), quick(L(2026, 9, 21, 10), { back: 5 }), quick(L(2026, 9, 23, 10), { legs: 8 })], WED),
    { group: "back", kind: "untrained", days: 9, sets: 0, lo: 10 });
  eq("exactly 8 days counts", N([recent(), quick(L(2026, 9, 22, 23), { back: 5 }), quick(L(2026, 9, 23, 10), { legs: 8 })], WED),
    { group: "back", kind: "untrained", days: 8, sets: 0, lo: 10 });
  const u7 = [recent(), quick(L(2026, 9, 23, 10), { back: 5 }), quick(L(2026, 9, 23, 11), { legs: 8 })];
  eq("7 days → no nudge on a Wednesday", N(u7, WED), null);
  eq("the same log on Thursday: both at 8 days, a tie goes to GROUPS order (back)", N(u7, THU), { group: "back", kind: "untrained", days: 8, sets: 0, lo: 10 });
  eq("a later day's legs don't count yet (its sets are in the week's bar, as sets does)", N(u1.concat([quick(L(2026, 10, 1, 8), { legs: 10 })]), WED),
    { group: "legs", kind: "untrained", days: 10, sets: 10, lo: 20 });
  eq("nor do legs logged later today", N(u1.concat([quick(L(2026, 9, 30, 20), { legs: 10 })]), WED), { group: "legs", kind: "untrained", days: 10, sets: 10, lo: 20 });
  eq("legs at 12:00 on the dot of now do", N(u1.concat([quick(L(2026, 9, 30, 12), { legs: 10 })]), WED), { group: "back", kind: "untrained", days: 9, sets: 0, lo: 10 });
  eq("½ legs a day (bridges step 2) is never a hard set: legs stays untrained",
    N(u1.concat([bw(L(2026, 9, 29, 9), "bridge", 2, [10]), bw(L(2026, 9, 30, 9), "bridge", 2, [10])]), WED),
    { group: "legs", kind: "untrained", days: 10, sets: 1, lo: 20 });
  eq("targets 8–16: lo 16 for legs", N(u1, WED, [8, 16]), { group: "legs", kind: "untrained", days: 10, sets: 0, lo: 16 });

  const nv = [quick(L(2026, 9, 26), { chest: 5, back: 5 }), quick(L(2026, 9, 27), { shoulders: 5, arms: 10 }), quick(L(2026, 9, 28), { abs: 5 })];
  eq("never trained, with 3 workouts: legs, days null", N(nv, WED), { group: "legs", kind: "untrained", days: null, sets: 0, lo: 20 });
  eq("never trained outranks 29 days", N([quick(L(2026, 9, 1), { abs: 5 }), quick(L(2026, 9, 26), { chest: 5, back: 5 }), quick(L(2026, 9, 27), { shoulders: 5, arms: 10 })], WED),
    { group: "legs", kind: "untrained", days: null, sets: 0, lo: 20 });
  eq("with 2 workouts, groups never trained aren't mentioned", N(nv.slice(0, 2), WED), null);
  eq("a weigh-in isn't a third workout", N(nv.slice(0, 2).concat([weigh(L(2026, 9, 28))]), WED), null);
  eq("nor is a third workout still ahead", N(nv.slice(0, 2).concat([quick(L(2026, 10, 2), { abs: 5 })]), WED), null);

  const bh = [quick(L(2026, 9, 28, 18), { chest: 10, back: 4 }), quick(L(2026, 9, 29, 18), { shoulders: 2, legs: 9 }), quick(L(2026, 9, 30, 18), { arms: 8, abs: 5 })];
  eq("(this week: chest 10, back 4, shoulders 4½, arms 12, abs 5, legs 9)", T.weekVolume(bh, THU), { chest: 10, back: 4, shoulders: 4.5, arms: 12, abs: 5, legs: 9 });
  eq("behind on Thursday: back 4 of 10 is the lowest share (shoulders and legs .45; abs 5 is half, not below)", N(bh, THU),
    { group: "back", kind: "behind", sets: 4, lo: 10, daysLeft: 4 });
  eq("Wednesday 23:59: not yet", N(bh, L(2026, 9, 30, 23, 59)), null);
  eq("Thursday 00:00: from now on", N(bh, L(2026, 10, 1, 0, 0)), { group: "back", kind: "behind", sets: 4, lo: 10, daysLeft: 4 });
  eq("Sunday: 1 day left", N(bh, L(2026, 10, 4, 23, 59)), { group: "back", kind: "behind", sets: 4, lo: 10, daysLeft: 1 });
  eq("targets 8–16: nobody below half", N(bh, THU, [8, 16]), null);
  eq("targets 12–24: back 4 of 12", N(bh, THU, [12, 24]), { group: "back", kind: "behind", sets: 4, lo: 12, daysLeft: 4 });
  eq("unusable targets → 10–20", N(bh, THU, "lots"), { group: "back", kind: "behind", sets: 4, lo: 10, daysLeft: 4 });
  const tie = [quick(L(2026, 9, 26, 10), { back: 10, abs: 10 }), quick(L(2026, 9, 28, 10), { chest: 10, shoulders: 10, arms: 20, legs: 20 })];
  eq("a tie at 0 goes to GROUPS order (back before abs)", N(tie, THU), { group: "back", kind: "behind", sets: 0, lo: 10, daysLeft: 4 });
  eq("untrained comes before behind", N(u1, THU), { group: "legs", kind: "untrained", days: 11, sets: 0, lo: 20 });
  const full = [quick(L(2026, 9, 28, 10), { chest: 10, back: 10, shoulders: 10, arms: 20, abs: 10, legs: 20 })];
  eq("everything on target: none", N(full, L(2026, 10, 4, 12)), null);
}

section("the Body radar");
[[[10, 20], 0.5], [[20, 20], 1], [[20.25, 20], 1], [[25, 20], 1], [[30, 20], 1], [[18.75, 40], 0.46875], [[0, 20], 0], [[-1, 20], 0],
  [[NaN, 20], 0], [[5, 0], 0], [[5, NaN], 0], [[5, -10], 0], [[undefined, undefined], 0]].forEach(([[s, hi], want]) =>
  eq(String(s) + " of top " + String(hi) + " → " + want, T.radarShare(s, hi), want));

section("pace: an even share of the bottom of the target for each day so far");
{
  const DOW = range(7, i => L(2026, 9, 21 + i, 12));   // Mon 21 … Sun 27 Sep, noon
  eq("day of the week: Monday 1 … Sunday 7", DOW.map(t => T.dayOfWeek(t)), [1, 2, 3, 4, 5, 6, 7]);
  eq("Monday 00:00 is 1; Sunday 23:59:59.999 is 7; the next Monday 00:00 is 1 again; across the new year",
    [T.dayOfWeek(L(2026, 9, 21)), T.dayOfWeek(L(2026, 9, 27, 23, 59, 59, 999)), T.dayOfWeek(L(2026, 9, 28)), T.dayOfWeek(L(2027, 1, 1, 12))], [1, 7, 1, 5]);
  eq("not a time → 0", [NaN, undefined, null, "soon", ""].map(t => T.dayOfWeek(t)), [0, 0, 0, 0, 0]);
  eq("lo 10: 10/7 on Monday … 30/7 on Wednesday … 10 on Sunday", DOW.map(t => T.pace(10, t)), range(7, i => 10 * (i + 1) / 7));
  eq("Wednesday: 4.2857… for lo 10, 8.5714… for lo 20 — not rounded", [T.pace(10, DOW[2]), T.pace(20, DOW[2])], [4.285714285714286, 8.571428571428571]);
  eq("lo 7 on Wednesday, 14 on Wednesday, 21 on Monday: whole numbers", [T.pace(7, DOW[2]), T.pace(14, DOW[2]), T.pace(21, DOW[0])], [3, 6, 3]);
  eq("the hour doesn't matter: Wednesday 00:00 and 23:59:59.999", [T.pace(10, L(2026, 9, 23)), T.pace(10, L(2026, 9, 23, 23, 59, 59, 999))], [30 / 7, 30 / 7]);
  eq("a lo or a time that isn't one → 0",
    [T.pace(0, W), T.pace(-10, W), T.pace("x", W), T.pace(null, W), T.pace(Infinity, W), T.pace(10, NaN), T.pace(10, undefined), T.pace(10, "soon")],
    [0, 0, 0, 0, 0, 0, 0, 0]);
  eq("lo \"10\" (a string) reads as 10", T.pace("10", DOW[2]), 30 / 7);
  DST.forEach(([[y, mo, d], where]) => {
    const name = y + "-" + mo + "-" + d + " (" + where + ")";
    eq(name + ": its Monday 00:30 is day 1; its Sunday at the switch hour and at 23:30 day 7; the next Monday 00:30 day 1",
      [T.dayOfWeek(L(y, mo, d - 6, 0, 30)), T.dayOfWeek(L(y, mo, d, 2, 30)), T.dayOfWeek(L(y, mo, d, 23, 30)), T.dayOfWeek(L(y, mo, d + 1, 0, 30))],
      [1, 7, 7, 1]);
    eq(name + ": pace on that Sunday is all of lo; on Saturday 23:30, 6/7 of it",
      [T.pace(10, L(y, mo, d, 23, 30)), T.pace(20, L(y, mo, d, 2, 30)), T.pace(7, L(y, mo, d - 1, 23, 30))], [10, 20, 6]);
  });
}

section("where the sets stand against the pace");
{
  const WED = L(2026, 9, 23, 12, 30), MON = L(2026, 9, 21, 8), SUN = L(2026, 9, 27, 22);
  const PZ = (now, lo, hi, name, list) => list.forEach(([x, z]) =>
    eq(name + ": " + String(x) + " → " + z, T.paceZone(x, lo, hi, now), z));
  PZ(WED, 10, 20, "Wednesday, 10–20 (pace 4.29)", [[0, "none"], [-1, "none"], [NaN, "none"], [undefined, "none"], [0.25, "behind"],
    [4.25, "behind"], [4.5, "onpace"], [9.75, "onpace"], [10, "on"], [20, "on"], [20.25, "above"]]);
  PZ(WED, 20, 40, "Wednesday, 20–40 (arms, legs; pace 8.57)", [[6.75, "behind"], [8.5, "behind"], [8.75, "onpace"], [19.75, "onpace"], [20, "on"], [40.25, "above"]]);
  PZ(WED, 7, 14, "Wednesday, 7–14: pace exactly 3, and 3 is on pace", [[2.75, "behind"], [3, "onpace"], [6.75, "onpace"], [7, "on"]]);
  PZ(MON, 10, 20, "Monday, 10–20 (pace 1.43)", [[1.25, "behind"], [1.5, "onpace"]]);
  PZ(MON, 21, 42, "Monday, 21–42: pace exactly 3", [[2.75, "behind"], [3, "onpace"]]);
  PZ(SUN, 10, 20, "Sunday, 10–20: the pace is lo itself, so below lo is behind", [[9.75, "behind"], [10, "on"]]);
  eq("a time that isn't one expects nothing: above 0 and below lo is on pace",
    [T.paceZone(1, 10, 20, NaN), T.paceZone(0, 10, 20, NaN), T.paceZone(15, 10, 20, undefined), T.paceZone(25, 10, 20, "soon")], ["onpace", "none", "on", "above"]);
  eq("\"8\" (a string) reads as 8", T.paceZone("8", 10, 20, WED), "onpace");
  let bad = [], n = 0;
  [[7, 14], [10, 20], [20, 40], [8, 16], [16, 32], [1, 1], [60, 60], [13, 17]].forEach(([lo, hi]) =>
    range(7, i => L(2026, 9, 21 + i, 9)).forEach(now => {
      for (let q = 0; q <= 4 * (hi + 2); q++) {
        const x = q / 4, z = T.zone(x, lo, hi), p = T.paceZone(x, lo, hi, now);
        const want = z === "low" || z === "building" ? (x >= T.pace(lo, now) ? "onpace" : "behind") : z;
        n++;
        if (p !== want) bad.push(lo + "–" + hi + " " + M.dateStr(now) + " " + x + ": " + p + " vs " + want);
      }
    }));
  check("every quarter from 0 to hi + 2, every day, eight ranges: none/on/above exactly as zone(); low and building split at pace() (" + n + " cases)",
    !bad.length, bad.slice(0, 3).join("; "));
}

section("this point last week: last week from Monday to the end of the same weekday");
{
  const LW = byTime([
    bw(L(2026, 9, 13, 23, 59), "pushup", 5, [10]),                   // the week before: never in it
    bw(L(2026, 9, 14, 0, 0), "squat", 5, [20, 20]),                   // Monday 00:00: legs 2
    bw(L(2026, 9, 14, 18), "bridge", 2, [15, 15]),                     // back 2, legs 1
    bw(L(2026, 9, 14, 18, 30), "hspu", 2, [20]),                       // shoulders ½, abs ½
    weigh(L(2026, 9, 15, 8)), gym(L(2026, 9, 15, 18)),                 // nothing; bench press: chest 2, shoulders 1, arms 1
    quick(L(2026, 9, 16, 23, 59, 59, 999), { chest: 6 }),             // Wednesday's last ms: chest 6, arms 1½, shoulders 1½
    quick(L(2026, 9, 17, 0, 0), { back: 7, shoulders: 4 }),           // Thursday 00:00
    bw(L(2026, 9, 19, 10), "pushup", 5, [10, 10]),                     // Saturday
    quick(L(2026, 9, 21, 9), { legs: 5 }),                             // this week
    bw(L(2026, 9, 23, 20), "legraise", 4, [15, 12])                    // this Wednesday, 20:00
  ]);
  const LWED = { chest: 8, back: 2, shoulders: 3, arms: 2.5, abs: 0.5, legs: 3 };
  eq("Wednesday 23 Sep 12:30 → Mon 14 00:00 … Wed 16 23:59:59.999", T.lastWeekToDate(LW, L(2026, 9, 23, 12, 30)), LWED);
  eq("the hour doesn't matter: Wednesday 00:00 and 23:59:59.999", [T.lastWeekToDate(LW, L(2026, 9, 23)), T.lastWeekToDate(LW, L(2026, 9, 23, 23, 59, 59, 999))], [LWED, LWED]);
  eq("Monday → last Monday only", T.lastWeekToDate(LW, L(2026, 9, 21, 7)), V({ back: 2, shoulders: 0.5, abs: 0.5, legs: 3 }));
  eq("Tuesday → with last Tuesday's bench press (its weigh-in adds nothing)", T.lastWeekToDate(LW, L(2026, 9, 22, 23)), V({ chest: 2, back: 2, shoulders: 1.5, arms: 1, abs: 0.5, legs: 3 }));
  eq("Thursday → with Thursday 00:00's quick log", T.lastWeekToDate(LW, L(2026, 9, 24, 12)), { chest: 8, back: 9, shoulders: 7, arms: 5.25, abs: 0.5, legs: 3 });
  eq("Sunday → all of last week (its weekVolume)", T.lastWeekToDate(LW, L(2026, 9, 27, 22)), T.weekVolume(LW, L(2026, 9, 14)));
  eq("…which has Saturday's pushups", T.lastWeekToDate(LW, L(2026, 9, 27, 22)), { chest: 10, back: 9, shoulders: 8, arms: 6.25, abs: 0.5, legs: 3 });
  eq("the log's order doesn't matter", T.lastWeekToDate(LW.slice().reverse(), L(2026, 9, 23, 12, 30)), LWED);
  eq("this week up to the end of Wednesday (20:00's leg raises in)", T.weekVolumeUntil(LW, L(2026, 9, 23, 12, 30)), V({ abs: 2, legs: 5 }));
  eq("…up to the end of Tuesday", T.weekVolumeUntil(LW, L(2026, 9, 22, 23, 59)), V({ legs: 5 }));
  eq("…on Sunday it is weekVolume", T.weekVolumeUntil(LW, L(2026, 9, 27, 12)), T.weekVolume(LW, L(2026, 9, 21)));
  eq("across the new year: Friday 1 Jan 2027 → Mon 21 … Fri 25 Dec 2026",
    T.lastWeekToDate([quick(L(2026, 12, 21, 0, 0), { abs: 3 }), quick(L(2026, 12, 25, 23, 59), { abs: 4 }), quick(L(2026, 12, 26, 0, 0), { abs: 5 }),
      quick(L(2026, 12, 28, 9), { abs: 6 })], L(2027, 1, 1, 12)), V({ abs: 7 }));
  eq("a time that isn't one → six zeros", [T.weekVolumeUntil(LW, NaN), T.lastWeekToDate(LW, undefined), T.lastWeekToDate(LW, "soon"), T.lastWeekToDate(LW, null)],
    [ZERO, ZERO, ZERO, ZERO]);
  eq("empty, no log, junk → six zeros", [T.lastWeekToDate([], W), T.lastWeekToDate(null, W), T.lastWeekToDate("log", W), T.weekVolumeUntil({ length: 2 }, W)],
    [ZERO, ZERO, ZERO, ZERO]);
  eq("inherited and unknown group names add nothing",
    T.lastWeekToDate([quick(L(2026, 9, 14, 9), JSON.parse('{"__proto__":{"chest":5},"constructor":3,"toString":2,"legs":2}'))], L(2026, 9, 21, 9)), V({ legs: 2 }));
}
DST.forEach(([[y, mo, d], where]) => {
  const name = y + "-" + mo + "-" + d + " (" + where + ")";
  const log = [
    bw(L(y, mo, d - 6, 0, 0), "squat", 5, [20]),                      // the DST week's Monday 00:00: legs 1
    bw(L(y, mo, d - 6, 23, 59, 59, 999), "legraise", 5, [10]),        // its last ms: abs 1
    bw(L(y, mo, d - 5, 0, 0), "pullup", 5, [5]),                       // Tuesday 00:00: back 1, arms ½
    bw(L(y, mo, d, 2, 30), "legraise", 5, [10]),                       // Sunday, the switch hour: abs 1
    bw(L(y, mo, d, 23, 30), "pushup", 5, [10]),                        // Sunday 23:30: chest 1, ½ + ½
    bw(L(y, mo, d, 23, 59, 59, 999), "hspu", 5, [5]),                  // Sunday's last ms: shoulders 1, arms ½
    bw(L(y, mo, d + 1, 0, 0), "squat", 5, [20, 20])                    // the next Monday 00:00: legs 2
  ];
  const ALL = V({ chest: 1, back: 1, shoulders: 1.5, arms: 1.5, abs: 2, legs: 1 });
  // A "now − 7 × 24 h" would land an hour off here, on the wrong day (and
  // for the Monday, in the wrong week) in a spring week.
  eq(name + ": the next Monday 00:30 → the DST week's Monday only", T.lastWeekToDate(log, L(y, mo, d + 1, 0, 30)), V({ legs: 1, abs: 1 }));
  eq(name + ": the next Monday 23:30 → the same", T.lastWeekToDate(log, L(y, mo, d + 1, 23, 30)), V({ legs: 1, abs: 1 }));
  eq(name + ": the next Saturday 23:30 → up to its Saturday", T.lastWeekToDate(log, L(y, mo, d + 6, 23, 30)), V({ legs: 1, abs: 1, back: 1, arms: 0.5 }));
  eq(name + ": the next Sunday 00:30 → the whole DST week, Sunday 23:59:59.999 in", T.lastWeekToDate(log, L(y, mo, d + 7, 0, 30)), ALL);
  eq(name + ": …and it is that week's weekVolume", T.lastWeekToDate(log, L(y, mo, d + 7, 0, 30)), T.weekVolume(log, L(y, mo, d)));
  eq(name + ": the DST Sunday itself, this week so far (asked at the switch hour)", T.weekVolumeUntil(log, L(y, mo, d, 2, 30)), ALL);
  eq(name + ": the DST week's Monday, so far", T.weekVolumeUntil(log, L(y, mo, d - 6, 12)), V({ legs: 1, abs: 1 }));
});
{
  // Against an oracle that works with date keys only ("YYYY-MM-DD"), over
  // every day of 2026 — all four switches of both zones — at hours around
  // midnight and the switch.
  const log = [];
  for (let i = -10; i < 380; i++) {
    [[0, 0], [1, 30], [2, 30], [12, 0], [23, 30]].forEach(([hh, mm], k) => {
      const t = L(2026, 1, 1 + i, hh, mm);
      log.push(k % 2 ? quick(t, { [M.GROUPS[(i + k) % 6]]: 1 + (i % 5) }) : bw(t, M.KNOWN_IDS[(i + k) % 6], 1 + (i % 10), [10, 10]));
    });
    log.push(bw(L(2026, 1, 1 + i, 23, 59, 59, 999), "squat", 5, [20]));
  }
  const oracle = now => {
    const today = M.dateStr(now), keys = [];
    let d = M.addDays(M.startOfDay(now), -7);
    while (keys.length < 7) {
      keys.unshift(M.dateStr(d.getTime()));
      if (new Date(d.getTime()).getDay() === 1) break;
      d = M.addDays(d, -1);
    }
    const acc = V({});
    log.forEach(e => {
      if (keys.indexOf(M.dateStr(e.ts)) === -1) return;
      const w = T.groupWeights(e);
      M.GROUPS.forEach(g => { if (w[g]) acc[g] += w[g]; });
    });
    return [acc, today];
  };
  let bad = [], n = 0;
  for (let i = 0; i < 365; i++) {
    [[0, 0], [2, 30], [12, 0], [23, 59]].forEach(([hh, mm]) => {
      const now = L(2026, 1, 1 + i, hh, mm), [want] = oracle(now);
      n++;
      if (!same(T.lastWeekToDate(log, now), want)) bad.push(M.dateStr(now) + " " + hh + ":" + mm);
    });
  }
  check("every day of 2026 at 00:00, 02:30, 12:00, 23:59: the same as counting date keys (" + n + " times, " + tz + ")", !bad.length, bad.slice(0, 5).join(", "));
}

section("Body's sentence: on target, on pace, behind");
{
  const WED = L(2026, 9, 23, 12, 30);
  const THIS = [
    quick(L(2026, 9, 21, 19), { back: 7, shoulders: 4 }),
    bw(L(2026, 9, 22, 18), "pushup", 5, [10, 8]), bw(L(2026, 9, 22, 18, 20), "pullup", 4, [12, 11, 8]), bw(L(2026, 9, 22, 18, 40), "legraise", 4, [15, 12]),
    quick(L(2026, 9, 23, 7, 20), { chest: 6 })
  ];
  const VD = (log, now, vol) => T.verdict(log, now, vol || [10, 20]);
  eq("the mockup's Wednesday: On target: Back. On pace: Chest, Shoulders. Behind: Legs, Abs, Arms.", VD(THIS, WED),
    { on: ["back"], onPace: ["chest", "shoulders"], behind: ["legs", "abs", "arms"], above: [] });
  eq("…the same numbers on Thursday: Shoulders 6½ < 40/7 is still on pace; on Friday it's behind",
    [VD(THIS, L(2026, 9, 24, 12)).onPace, VD(THIS, L(2026, 9, 25, 12)).onPace], [["chest", "shoulders"], ["chest"]]);
  const more = THIS.concat([quick(L(2026, 9, 23, 18), { chest: 14, abs: 25 })]);
  eq("above the top counts as on target, and is listed in above too (GROUPS order); chest 14's helpers lift shoulders to 10 and arms onto the pace",
    VD(more, WED), { on: ["chest", "back", "shoulders", "abs"], onPace: ["arms"], behind: ["legs"], above: ["chest", "abs"] });
  eq("Monday 00:00 with nothing yet: all six behind, in GROUPS order (all at 0)", VD([], L(2026, 9, 21)),
    { on: [], onPace: [], behind: ["chest", "back", "shoulders", "arms", "abs", "legs"], above: [] });
  eq("behind, furthest first (sets ÷ lo); ties keep GROUPS order: chest and shoulders at 0, abs 2 of 10 and legs 4 of 20",
    VD([quick(L(2026, 9, 25, 9), { abs: 2, legs: 4, back: 3 })], L(2026, 9, 26, 9)).behind,
    ["chest", "shoulders", "arms", "abs", "legs", "back"]);
  eq("Sunday: shoulders 9¾ of 10 is behind (on pace means reaching lo by now)",
    VD([quick(L(2026, 9, 27, 9), { shoulders: 9, chest: 3 })], L(2026, 9, 27, 20)),
    { on: [], onPace: [], behind: ["back", "abs", "legs", "arms", "chest", "shoulders"], above: [] });
  eq("targets 8–16: chest 8 is on target", VD(THIS, WED, [8, 16]).on, ["chest", "back"]);
  eq("unusable targets → 10–20", VD(THIS, WED, "lots"), VD(THIS, WED, [10, 20]));
  eq("a later day of the same week counts, like the bars", VD(THIS.concat([quick(L(2026, 9, 26, 9), { legs: 20 })]), WED).on, ["back", "legs"]);
  eq("last week's sets don't", VD(THIS.concat([quick(L(2026, 9, 20, 23, 59), { legs: 20 })]), WED).behind, ["legs", "abs", "arms"]);
  eq("a time that isn't one: four empty lists", [VD(THIS, NaN), VD(THIS, undefined), VD(THIS, "soon")],
    range(3, () => ({ on: [], onPace: [], behind: [], above: [] })));
  let bad = [];
  let seed = 5;
  const rnd = k => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 2147483648 * k); };
  for (let k = 0; k < 300; k++) {
    const now = L(2026, 9, 21 + rnd(7), rnd(24)), g = {};
    M.GROUPS.forEach(x => { if (rnd(2)) g[x] = 1 + rnd(30); });
    const log = [quick(L(2026, 9, 21, 6), g), bw(L(2026, 9, 21, 7), M.KNOWN_IDS[rnd(6)], 1 + rnd(10), [10, 10, 10])];
    const vol = [[10, 20], [8, 16], [12, 24], [5, 30]][rnd(4)];
    const v = T.verdict(log, now, vol), sum = T.weekSummary(log, now, vol);
    const all = v.on.concat(v.onPace, v.behind);
    const inOrder = list => list.every((x, i) => !i || M.GROUPS.indexOf(list[i - 1]) < M.GROUPS.indexOf(x));
    const ok = all.length === 6 && M.GROUPS.every(x => all.indexOf(x) !== -1) &&
      v.above.every(x => v.on.indexOf(x) !== -1) && inOrder(v.on) && inOrder(v.onPace) && inOrder(v.above) &&
      sum.every(r => {
        const z = T.paceZone(r.sets, r.lo, r.hi, now);
        const where = z === "on" || z === "above" ? v.on : z === "onpace" ? v.onPace : v.behind;
        return where.indexOf(r.group) !== -1 && (z === "above") === (v.above.indexOf(r.group) !== -1);
      }) &&
      v.behind.every((x, i) => !i || sum.find(r => r.group === v.behind[i - 1]).sets / sum.find(r => r.group === v.behind[i - 1]).lo <=
        sum.find(r => r.group === x).sets / sum.find(r => r.group === x).lo);
    if (!ok) bad.push(M.dateStr(now) + " " + J(g) + " " + J(v));
  }
  check("300 random weeks: every group in exactly one of on / onPace / behind, as paceZone() says; above ⊆ on; GROUPS order; behind by sets ÷ lo",
    !bad.length, bad.slice(0, 2).join("\n       "));
}

section("the mockup's pretend week (private/mockups/p3/NOTES.md), Wednesday 23 Sep 12:30");
{
  // The same log as make-mock.js around that week: gym days as quick gym
  // logs, skill sessions at the steps it has (handstands still step 1 on
  // Mon 14 Sep, the day it moved up).
  const NOW23 = L(2026, 9, 23, 12, 30), VOL = [10, 20];
  const P = byTime([
    quick(L(2026, 9, 12, 7, 20), { legs: 8 }),
    quick(L(2026, 9, 14, 7, 20), { chest: 6 }),
    bw(L(2026, 9, 14, 18), "squat", 5, [12, 8]), bw(L(2026, 9, 14, 18, 20), "bridge", 2, [22, 20]), bw(L(2026, 9, 14, 18, 40), "hspu", 1, [120]),
    quick(L(2026, 9, 19, 7, 20), { arms: 8 }),
    quick(L(2026, 9, 21, 7, 20), { back: 7, shoulders: 4 }),
    bw(L(2026, 9, 22, 18), "pushup", 5, [10, 8]), bw(L(2026, 9, 22, 18, 20), "pullup", 4, [12, 11, 8]), bw(L(2026, 9, 22, 18, 40), "legraise", 4, [15, 12]),
    quick(L(2026, 9, 23, 7, 20), { chest: 6 })
  ]);
  const STEPS = { pushup: 5, pullup: 4, legraise: 4, squat: 5, bridge: 2, hspu: 2 };
  const THIS_WEEK = { chest: 8, back: 10, shoulders: 6.5, arms: 6.75, abs: 2, legs: 0 };
  eq("totals: chest 8 · back 10 · shoulders 6½ · arms 6¾ · abs 2 · legs 0", T.weekVolume(P, NOW23), THIS_WEEK);
  eq("zone · pace: Building · on pace, On target, Building · on pace, Low · behind, Low · behind, None this week",
    T.weekSummary(P, NOW23, VOL).map(r => [r.group, r.zone, T.paceZone(r.sets, r.lo, r.hi, NOW23)]),
    [["chest", "building", "onpace"], ["back", "on", "on"], ["shoulders", "building", "onpace"], ["arms", "low", "behind"], ["abs", "low", "behind"], ["legs", "none", "none"]]);
  eq("the ▴: 30/7 for lo 10, 60/7 for lo 20; Wednesday is day 3 of 7", [T.pace(10, NOW23), T.pace(20, NOW23), T.dayOfWeek(NOW23)], [30 / 7, 60 / 7, 3]);
  eq("the sentence", T.verdict(P, NOW23, VOL), { on: ["back"], onPace: ["chest", "shoulders"], behind: ["legs", "abs", "arms"], above: [] });
  const LAST = { chest: 6, back: 2, shoulders: 2, arms: 1.5, abs: 0.5, legs: 3 };
  eq("last week up to Wednesday: chest 6 · back 2 · shoulders 2 · arms 1½ · abs ½ · legs 3", T.lastWeekToDate(P, NOW23), LAST);
  eq("vs this point last week: chest +2 … legs −3", M.GROUPS.map(g => THIS_WEEK[g] - LAST[g]), [2, 8, 4.5, 5.25, 1.5, -3]);
  eq("the radar: sets ÷ the top (arms 6¾ of 40)", M.GROUPS.map(g => T.radarShare(THIS_WEEK[g], T.targets(VOL)[g][1])), [0.4, 0.5, 0.325, 0.16875, 0.1, 0]);
  eq("its dashed shape: last week up to Wednesday", M.GROUPS.map(g => T.radarShare(LAST[g], T.targets(VOL)[g][1])), [0.3, 0.1, 0.1, 0.0375, 0.025, 0.075]);
  const R = g => T.breakdown(P, NOW23, g).map(r => [M.dateStr(r.entry.ts), r.sets, r.weight, r.own, r.listed, r.logged]);
  eq("what counted for Shoulders: all three weights (full, ½, ¼)", R("shoulders"),
    [["2026-09-23", 1.5, 0.25, false, "chest", 6], ["2026-09-22", 1, 0.5, false, null, 2], ["2026-09-21", 4, 1, true, "shoulders", 4]]);
  eq("…for Back: all full", R("back"), [["2026-09-22", 3, 1, true, null, 3], ["2026-09-21", 7, 1, true, "back", 7]]);
  eq("…for Arms: Monday's quick gym log gives two rows (7 back sets, 4 shoulder sets, both helping)", R("arms"), [
    ["2026-09-23", 1.5, 0.25, false, "chest", 6], ["2026-09-22", 1.5, 0.5, false, null, 3], ["2026-09-22", 1, 0.5, false, null, 2],
    ["2026-09-21", 1.75, 0.25, false, "back", 7], ["2026-09-21", 1, 0.25, false, "shoulders", 4]]);
  eq("…for Legs: nothing this week", R("legs"), []);
  check("…every group's rows add up to its bar", M.GROUPS.every(g => T.breakdown(P, NOW23, g).reduce((s, r) => s + r.sets, 0) === THIS_WEEK[g]));
  eq("Body rows: the main-job ladders at your step, arms none (\"Helped by Pushups, Pullups\")",
    M.GROUPS.map(g => [g, T.feedersAt(g, STEPS).filter(f => f.main).map(f => f.areaId + " " + f.step), T.feedersAt(g, STEPS).filter(f => !f.main && f.weight > 0).map(f => f.areaId)]),
    [["chest", ["pushup 5"], []], ["back", ["pullup 4", "bridge 2"], []], ["shoulders", ["hspu 2"], ["pushup"]],
      ["arms", [], ["pushup", "pullup"]], ["abs", ["legraise 4"], ["hspu"]], ["legs", ["squat 5"], ["bridge"]]]);
  eq("the nudge: legs, last trained 9 days ago (Mon 14 Sep), 0 of 20 so far this week", T.groupNudge(P, NOW23, VOL),
    { group: "legs", kind: "untrained", days: 9, sets: 0, lo: 20 });
  eq("…and today's session (Day 2) starts with squats", T.sessionFeeder("legs", ["squat", "bridge", "hspu"], STEPS), { areaId: "squat", index: 0 });
  eq("last trained: chest, shoulders, arms today · back, abs yesterday · legs 9 days ago",
    M.GROUPS.map(g => T.daysSince(T.lastTrained(P, g, NOW23), NOW23)), [0, 1, 0, 0, 1, 9]);
  eq("workouts this week: 3", T.workoutsInWeek(P, NOW23), 3);
}

/* ---------- The gym (P4) ---------- */

const CAT = page.get("GYM_EXERCISES");
// A gym entry. kg: one number for every set, or a list.
function G(ts, exId, sets, kg, id) {
  n++;
  return { id: id || "g" + n, ts, kind: "gym", exId, sets, kg: Array.isArray(kg) ? kg : sets.map(() => kg || 0), note: "", mts: ts };
}
const ODD_IDS = ["gone_ex", "", "BENCH_BB", "x_nobody", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", undefined, null, 42, {}];
// Your own exercises and tweaks, as state.exercises holds them.
const SLED = { id: "x_sled", name: "Sled push", group: "legs", sec: ["abs", "legs", "back"], equip: "other", load: "ext", timed: false,
  perHand: false, inc: 10, lo: 10, hi: 20, note: "Lane 2", del: false, mts: 3 };
const OLD = { id: "x_old", name: "Old rower", group: "back", sec: ["arms"], equip: "machine", load: "ext", timed: false,
  perHand: false, inc: 5, lo: 8, hi: 12, note: "", del: true, mts: 4 };
const NOGROUP = { id: "x_grip", name: "Grip trainer", group: "forearms", sec: ["arms"], equip: "other", load: "ext", timed: false,
  perHand: true, inc: 2.5, lo: 10, hi: 15, note: "", del: false, mts: 5 };
const WPLANK = { id: "x_wplank", name: "weighted plank", group: "abs", sec: [], equip: "other", load: "ext", timed: true,
  perHand: false, inc: 5, lo: 30, hi: 60, note: "", del: false, mts: 7 };
const ARNOLD = { id: "x_arnold", name: "arnold press", group: "shoulders", sec: ["arms"], equip: "dumbbell", load: "ext", timed: false,
  perHand: true, inc: 2, lo: 8, hi: 12, note: "", del: false, mts: 8 };
const BAND = { id: "x_band", name: "Band pull-apart", group: "shoulders", sec: [], equip: "other", load: "band", timed: false,
  perHand: false, inc: 2.5, lo: 8, hi: 12, note: "", del: false, mts: 6 };

section("gym exercises: the catalogue, your own, and tweaks");
{
  T.useExercises([]);
  eq("a built-in exercise, every field, in order", T.exercise("bench_bb"), {
    id: "bench_bb", name: "Barbell bench press", p: "chest", s: ["shoulders", "arms"], equip: "barbell", lo: 6, hi: 10, inc: 2.5,
    perHand: false, load: "ext", timed: false, note: "", custom: false, del: false, known: true
  });
  const off = CAT.filter(c => !same(T.exercise(c.id), {
    id: c.id, name: c.name, p: c.p, s: c.s, equip: c.equip, lo: c.lo, hi: c.hi, inc: c.inc, perHand: c.perHand,
    load: c.load, timed: c.timed, note: "", custom: false, del: false, known: true
  })).map(c => c.id);
  check("all " + CAT.length + " built-in exercises resolve to the catalogue's values", !off.length, off.join(", "));
  {
    const a = T.exercise("bench_bb");
    a.s.push("legs"); a.lo = 99; a.name = "x";
    eq("a fresh copy each time (changing one changes nothing)", [T.exercise("bench_bb").s, T.exercise("bench_bb").lo, CAT[0].s],
      [["shoulders", "arms"], 6, ["shoulders", "arms"]]);
  }
  ODD_IDS.forEach(id => eq("id " + J(id) + " → null", T.exercise(id), null));

  const list = T.exerciseList();
  eq("the list: every built-in exercise, once", list.map(x => x.id).sort(), CAT.map(c => c.id).sort());
  eq("…chest first, by name", list.filter(x => x.p === "chest").map(x => x.id),
    ["bench_bb", "fly_cable", "dips", "bench_db", "incline_db", "chest_press", "pec_deck"]);
  eq("…groups in GROUPS order", list.map(x => x.p).filter((p, i, a) => a.indexOf(p) === i), M.GROUPS);
  check("…each group by name", list.every((x, i) => !i || list[i - 1].p !== x.p || list[i - 1].name.toLowerCase() <= x.name.toLowerCase()));
  list[0].s.push("legs");
  eq("…fresh copies too", T.exerciseList()[0].s, T.exercise(list[0].id).s);

  T.useExercises([{ id: "bench_bb", inc: 1.25, lo: 4, hi: 6, note: "Grip 81", mts: 5 },
    { id: "pulldown", inc: null, lo: null, hi: null, note: "Pin 7", mts: 5 },
    { id: "leg_press", inc: 10, lo: null, hi: null, note: "", mts: 5 },
    { id: "curl_db", inc: null, lo: 15, hi: 12, note: "", mts: 5 },
    { id: "gone_ex", inc: 5, lo: 1, hi: 2, note: "", mts: 5 },
    { id: "constructor", inc: 5, lo: 1, hi: 2, note: "", mts: 5 }]);
  eq("a tweak replaces lo, hi, inc and the note", T.exercise("bench_bb"), {
    id: "bench_bb", name: "Barbell bench press", p: "chest", s: ["shoulders", "arms"], equip: "barbell", lo: 4, hi: 6, inc: 1.25,
    perHand: false, load: "ext", timed: false, note: "Grip 81", custom: false, del: false, known: true
  });
  eq("a tweak with nulls keeps the catalogue's numbers (a note only)", [T.exercise("pulldown").lo, T.exercise("pulldown").hi, T.exercise("pulldown").inc, T.exercise("pulldown").note], [8, 12, 2.5, "Pin 7"]);
  eq("a weight step only", [T.exercise("leg_press").lo, T.exercise("leg_press").hi, T.exercise("leg_press").inc], [8, 12, 10]);
  eq("a range with lo > hi isn't a range: the catalogue's", [T.exercise("curl_db").lo, T.exercise("curl_db").hi], [10, 15]);
  eq("a tweak for an id that isn't built in (or \"constructor\") makes nothing", [T.exercise("gone_ex"), T.exercise("constructor")], [null, null]);
  eq("the list has the tweaked values", T.exerciseList().filter(x => x.id === "bench_bb").map(x => [x.lo, x.hi, x.inc]), [[4, 6, 1.25]]);
  eq("the tweak doesn't change the catalogue", [CAT[0].lo, CAT[0].hi, CAT[0].inc], [6, 10, 2.5]);

  T.useExercises([SLED, OLD, NOGROUP, BAND]);
  eq("your own exercise: group → p, sec → s in GROUPS order without p", T.exercise("x_sled"), {
    id: "x_sled", name: "Sled push", p: "legs", s: ["back", "abs"], equip: "other", lo: 10, hi: 20, inc: 10,
    perHand: false, load: "ext", timed: false, note: "Lane 2", custom: true, del: false, known: true
  });
  eq("the tweaks are gone once the list no longer has them", [T.exercise("bench_bb").lo, T.exercise("bench_bb").note], [6, ""]);
  eq("a deleted one still resolves (old entries keep their name)", [T.exercise("x_old").name, T.exercise("x_old").del], ["Old rower", true]);
  eq("a group that isn't one of the six → p null", [T.exercise("x_grip").p, T.exercise("x_grip").s], [null, ["arms"]]);
  eq("a load type this version doesn't know → known false", [T.exercise("x_band").load, T.exercise("x_band").known], ["band", false]);
  const l2 = T.exerciseList();
  eq("the list: built-in + your own, not the deleted one", [l2.length, l2.some(x => x.id === "x_old")], [CAT.length + 3, false]);
  eq("…legs by name, Sled push at the end", l2.filter(x => x.p === "legs").map(x => x.name).slice(-3), ["Leg press", "Romanian deadlift", "Sled push"]);
  eq("…the one without a group comes last", l2[l2.length - 1].id, "x_grip");
  eq("…Band pull-apart among shoulders, by name", l2.filter(x => x.p === "shoulders").map(x => x.id),
    ["x_band", "lateral_cable", "lateral_db", "face_pull", "ohp_bb", "rear_fly_db", "ohp_db"]);
  T.useExercises([BAND, ARNOLD]);
  eq("…names sort ignoring case (\"arnold press\" before \"Band pull-apart\")", T.exerciseList().filter(x => x.p === "shoulders").map(x => x.id).slice(0, 3),
    ["x_arnold", "x_band", "lateral_cable"]);

  T.useExercises([Object.assign({}, SLED, { name: "Newer", mts: 9 }), Object.assign({}, SLED, { name: "Older", mts: 2 })]);
  eq("one id twice: the newer mts wins, whatever the order", T.exercise("x_sled").name, "Newer");
  T.useExercises([Object.assign({}, SLED, { name: "Older", mts: 2 }), Object.assign({}, SLED, { name: "Newer", mts: 9 })]);
  eq("…either way round", T.exercise("x_sled").name, "Newer");
  T.useExercises([{ id: "x_raw", name: "  Raw   name  ", group: "arms", sec: "arms", lo: "x", timed: true, mts: 1 }]);
  eq("records are sanitized on the way in (MODEL.sanitizeExercise)", T.exercise("x_raw"), {
    id: "x_raw", name: "Raw name", p: "arms", s: [], equip: "other", lo: 20, hi: 60, inc: 2.5,
    perHand: false, load: "ext", timed: true, note: "", custom: true, del: false, known: true
  });
  const threw = [];
  [null, undefined, "x", 5, {}, [null, 7, "a", {}, [], { id: "__proto__" }, { id: "x_" }, { id: 5 }, { id: "x_ok", name: {} }]].forEach(v => {
    try { T.useExercises(v); T.exerciseList(); T.exercise("bench_bb"); } catch (e) { threw.push(J(v) + ": " + e.message); }
  });
  check("junk to useExercises never throws", !threw.length, threw.join("; "));
  eq("…and leaves the built-in exercises, plus the records that sanitize (\"x_\" and \"x_ok\", both unnamed)", [T.exerciseList().length, T.exercise("x_ok") && T.exercise("x_ok").name],
    [CAT.length + 2, "Unnamed exercise"]);
  T.useExercises("not a list");
  eq("anything that isn't a list: the built-in exercises only", [T.exerciseList().length, T.exercise("x_ok")], [CAT.length, null]);
  T.useExercises([]);
}

section("e1RM (Epley: kg × (1 + reps ÷ 30), reps counted up to 20)");
eq("a single is its own weight", T.e1rm(100, 1), 100);
eq("100 kg × 8 → 126⅔", T.e1rm(100, 8), 100 * 38 / 30);
eq("60 × 12 → 84", T.e1rm(60, 12), 84);
eq("100 × 10 → 133⅓", T.e1rm(100, 10), 100 * 40 / 30);
eq("100 × 20 → 166⅔; 25 reps count as 20", [T.e1rm(100, 20), T.e1rm(100, 25)], [100 * 50 / 30, 100 * 50 / 30]);
eq("a dumbbell: per hand (24 kg × 10 → 32)", T.e1rm(24, 10), 32);
eq("no weight, no reps, or junk → 0", [T.e1rm(0, 5), T.e1rm(-5, 5), T.e1rm(100, 0), T.e1rm(100, -1), T.e1rm("x", 5), T.e1rm(null, null), T.e1rm(undefined, 8), T.e1rm(100, true)],
  [0, 0, 0, 0, 0, 0, 0, 0]);
eq("numbers as text count", T.e1rm("60", "12"), 84);

section("warm-ups: which sets of a gym entry are working sets");
{
  T.useExercises([]);
  const WS = (exId, sets, kg) => T.workingSets(G(W, exId, sets, kg));
  eq("60 × 12 warm-up, then 100 × 8, 8, 7", WS("bench_bb", [12, 8, 8, 7], [60, 100, 100, 100]), [false, true, true, true]);
  eq("…3 hard sets", T.hardSets(G(W, "bench_bb", [12, 8, 8, 7], [60, 100, 100, 100])), 3);
  eq("…and bench press counts chest 3, shoulders 1½, arms 1½", T.groupWeights(G(W, "bench_bb", [12, 8, 8, 7], [60, 100, 100, 100])),
    { chest: 3, shoulders: 1.5, arms: 1.5 });
  eq("exactly 80 % of the best e1RM is working (80 × 8 after 100 × 8)", WS("bench_bb", [8, 8], [100, 80]), [true, true]);
  eq("just under it is a warm-up (79.75 × 8)", WS("bench_bb", [8, 8], [100, 79.75]), [true, false]);
  eq("the order doesn't matter: warm-ups after the top set too", WS("bench_bb", [8, 12], [100, 60]), [true, false]);
  eq("a heavy single sets the bar: 140 × 1, 100 × 8, 90 × 8 all working", WS("bench_bb", [1, 8, 8], [140, 100, 90]), [true, true, true]);
  eq("…but 80 × 8 after 140 × 1 isn't", WS("bench_bb", [1, 8], [140, 80]), [true, false]);
  eq("reps past 20 count as 20: 60 × 25 isn't 80 % of 100 × 8", WS("bench_bb", [25, 8], [60, 100]), [false, true]);
  eq("a 0-rep set is never working, and doesn't set the bar (a failed 120)", WS("bench_bb", [0, 8, 8], [120, 100, 100]), [false, true, true]);
  eq("every set at 0 kg: every set with reps", WS("fly_cable", [12, 10, 0], 0), [true, true, false]);
  eq("a 0 kg set among loaded ones is a warm-up", WS("fly_cable", [10, 8], [0, 20]), [false, true]);
  eq("per-hand dumbbells: 10 kg × 12 warm-up, then 16 × 12, 12, 12", WS("bench_db", [12, 12, 12, 12], [10, 16, 16, 16]), [false, true, true, true]);
  eq("added weight (dips): every set counts — the added kg alone says nothing about effort without body weight", WS("dips", [10, 8, 8], [0, 10, 10]), [true, true, true]);
  eq("…weighted chin-ups going down in weight, reps up: all working", WS("chinup_w", [5, 7, 9], [20, 15, 10]), [true, true, true]);
  eq("…all at bodyweight: all working", WS("dips", [12, 10, 8], 0), [true, true, true]);
  eq("assisted (more help = easier): every set with reps", WS("pullup_assist", [10, 8, 6, 0], [40, 30, 20, 10]), [true, true, true, false]);
  eq("bodyweight only: every set, whatever kg says", WS("ab_wheel", [12, 10], [50, 0]), [true, true]);
  eq("timed (plank, seconds): every hold above 0", WS("plank", [60, 45, 0], 0), [true, true, false]);
  eq("an exercise nobody knows: every set with reps", WS("gone_ex", [10, 8], [100, 10]), [true, true]);
  eq("…that counts for nothing", T.groupWeights(G(W, "gone_ex", [10, 8], [100, 10])), {});
  eq("a skill entry: every set above 0", T.workingSets(bw(W, "pushup", 5, [10, 0, 8])), [true, false, true]);
  eq("a typed draft (no id, no ts) works too", T.workingSets({ kind: "gym", exId: "bench_bb", sets: [12, 8], kg: [60, 100] }), [false, true]);
  eq("missing kg: all 0, so every set with reps", T.workingSets({ kind: "gym", exId: "bench_bb", sets: [8, 8] }), [true, true]);
  eq("odd values: text numbers count, the rest are 0", T.workingSets({ kind: "gym", exId: "bench_bb", sets: ["8", null, "x", 8], kg: ["100", 100, 100, NaN] }),
    [true, false, false, false]);
  eq("nothing with sets → []", [T.workingSets(null), T.workingSets({}), T.workingSets({ kind: "gym", exId: "bench_bb", sets: "8" }), T.workingSets(7)], [[], [], [], []]);
  eq("a gym entry with no reps counts for nothing", [T.hardSets(G(W, "bench_bb", [0, 0], 100)), T.groupWeights(G(W, "bench_bb", [0, 0], 100))], [0, {}]);
  T.useExercises([BAND]);
  eq("a load type this version doesn't know: every set with reps", WS("x_band", [10, 8], [5, 20]), [true, true]);
  T.useExercises([WPLANK]);
  eq("a timed exercise with weight on (your own weighted plank): every hold counts", WS("x_wplank", [60, 30], [5, 20]), [true, true]);
  eq("negative kg (junk) counts as none", [WS("bench_bb", [8, 8], [-100, 60]), T.best([G(W, "pullup_assist", [8, 8], [-5, 20], "n")], "pullup_assist").kg], [[false, true], 0]);
  T.useExercises([]);
}

section("what gym sets count for: 1 for the group, ½ for each it helps");
{
  T.useExercises([]);
  const GW = (exId, k) => T.groupWeights(G(W, exId, range(k, () => 10), 20));
  eq("bench press × 3 → chest 3, shoulders 1½, arms 1½", GW("bench_bb", 3), { chest: 3, shoulders: 1.5, arms: 1.5 });
  eq("pec deck × 3 → chest 3 only", GW("pec_deck", 3), { chest: 3 });
  eq("deadlift × 2 → back 2, legs 1", GW("deadlift", 2), { back: 2, legs: 1 });
  eq("Romanian deadlift × 2 → legs 2, back 1", GW("rdl_bb", 2), { back: 1, legs: 2 });
  eq("face pull × 4 → shoulders 4, back 2", GW("face_pull", 4), { back: 2, shoulders: 4 });
  eq("bench dips × 2 → arms 2, shoulders 1", GW("bench_dips", 2), { shoulders: 1, arms: 2 });
  eq("plank × 2 → abs 2", T.groupWeights(G(W, "plank", [60, 45], 0)), { abs: 2 });
  const bad = CAT.filter(c => {
    const e = M.sanitizeLogEntry(G(W, c.id, [10, 10], c.load === "bw" ? 0 : 20));
    const want = {};
    M.GROUPS.forEach(g => { if (g === c.p) want[g] = 2; else if (c.s.indexOf(g) !== -1) want[g] = 1; });
    return !e || !same(T.groupWeights(e), want);
  }).map(c => c.id);
  check("every catalogue exercise, sanitized, 2 sets: 2 for p, 1 for each of s (" + CAT.length + ")", !bad.length, bad.join(", "));
  ODD_IDS.forEach(id => eq("exId " + J(id) + " → {}", T.groupWeights(G(W, id, [10, 10], 20)), {}));
  eq("your own exercise before it's registered → {}", T.groupWeights(G(W, "x_sled", [20, 20], 100)), {});
  T.useExercises([SLED, OLD, NOGROUP]);
  eq("…once registered: legs 2, back 1, abs 1", T.groupWeights(G(W, "x_sled", [20, 20], 100)), { back: 1, abs: 1, legs: 2 });
  eq("a deleted one still counts (its entries stay in the log)", T.groupWeights(G(W, "x_old", [10, 10, 10], 50)), { back: 3, arms: 1.5 });
  eq("no group: only its helpers, ½ a set each", T.groupWeights(G(W, "x_grip", [12, 12], 20)), { arms: 1 });
  T.useExercises([{ id: "bench_bb", inc: 5, lo: 3, hi: 5, note: "", mts: 1 }]);
  eq("a tweak doesn't change what it counts for", GW("bench_bb", 2), { chest: 2, shoulders: 1, arms: 1 });
  T.useExercises([]);
}

section("a week of gym, quick and skill entries adds up exactly (Mon 5 – Sun 11 Oct 2026)");
{
  T.useExercises([]);
  const WK5 = byTime([
    G(L(2026, 10, 4, 23, 59), "bench_bb", [8, 8], 100),                          // Sunday before: last week
    G(L(2026, 10, 5, 18), "bench_bb", [12, 8, 8, 7], [60, 100, 100, 100]),     // chest 3, shoulders 1½, arms 1½ (a warm-up)
    G(L(2026, 10, 5, 18, 20), "lateral_db", [15, 15, 12], 8),                   // shoulders 3
    quick(L(2026, 10, 6, 7), { back: 4, legs: 6 }),                              // back 4, legs 6, arms 1
    bw(L(2026, 10, 6, 18), "pullup", 4, [8, 6]),                                 // back 2, arms 1
    G(L(2026, 10, 7, 18), "squat_bb", [5, 5, 5], [60, 100, 100]),              // legs 2 (a warm-up)
    G(L(2026, 10, 7, 18, 30), "rdl_bb", [10, 10, 10], 80),                      // legs 3, back 1½
    G(L(2026, 10, 8, 18), "plank", [60, 45], 0),                                // abs 2
    G(L(2026, 10, 8, 18, 10), "pullup_assist", [10, 8], [30, 25]),              // back 2, arms 1
    G(L(2026, 10, 9, 18), "dips", [10, 8], [0, 10]),                            // chest 1, shoulders ½, arms ½ (bodyweight warm-up)
    G(L(2026, 10, 9, 18, 30), "gone_ex", [10, 10], 50),                          // nothing
    bw(L(2026, 10, 10, 10), "pushup", 5, [12, 10]),                              // chest 2, shoulders 1, arms 1
    quick(L(2026, 10, 10, 12), { chest: 3 }),                                    // chest 3, shoulders ¾, arms ¾
    weigh(L(2026, 10, 11, 8)),                                                    // nothing
    G(L(2026, 10, 11, 23, 59), "curl_db", [12, 12], 10),                        // arms 2
    G(L(2026, 10, 12, 0, 0), "bench_bb", [8, 8], 100)                            // next Monday
  ]);
  const MID = L(2026, 10, 8, 12);
  const VOL5 = { chest: 10, back: 9.5, shoulders: 7.25, arms: 9.25, abs: 2, legs: 11 };
  eq("a mixed week: skills, quick logs, gym with warm-ups, assisted, dips (both sets count)", T.weekVolume(WK5, MID), VOL5);
  eq("the log's order doesn't matter", T.weekVolume(WK5.slice().reverse(), MID), VOL5);
  check("every group's rows add up to its bar", M.GROUPS.every(g => T.breakdown(WK5, MID, g).reduce((s, r) => s + r.sets, 0) === VOL5[g]));
  const R = g => T.breakdown(WK5, MID, g).map(r => [r.entry.exId || r.entry.areaId || r.entry.kind, r.sets, r.weight, r.own, r.listed, r.logged]);
  eq("what counted for Shoulders: quick ¼s, pushups ½, dips ½ × 2 sets, lateral raises own, bench press ½ × 3", R("shoulders"), [
    ["quick", 0.75, 0.25, false, "chest", 3], ["pushup", 1, 0.5, false, null, 2], ["dips", 1, 0.5, false, null, 2],
    ["lateral_db", 3, 1, true, null, 3], ["bench_bb", 1.5, 0.5, false, null, 3]]);
  eq("…for Back: assisted pull-ups own, Romanian deadlift ½, pullups, the quick log", R("back"), [
    ["pullup_assist", 2, 1, true, null, 2], ["rdl_bb", 1.5, 0.5, false, null, 3], ["pullup", 2, 1, true, null, 2], ["quick", 4, 1, true, "back", 4]]);
  eq("…for Legs: warm-ups aren't logged sets (squats: 2 of 3)", R("legs"), [
    ["rdl_bb", 3, 1, true, null, 3], ["squat_bb", 2, 1, true, null, 2], ["quick", 6, 1, true, "legs", 6]]);
  eq("…an exercise nobody knows isn't listed anywhere", M.GROUPS.some(g => T.breakdown(WK5, MID, g).some(r => r.entry.exId === "gone_ex")), false);
  eq("dots: Mon chest+shoulders+arms · Tue back+arms+legs · Wed back+legs · Thu back+arms+abs · Fri chest+shoulders+arms · Sat chest+shoulders+arms · Sun arms",
    T.weekStrip(WK5, L(2026, 10, 11, 23, 59, 59)).map(d => d.groups), [
      ["chest", "shoulders", "arms"], ["back", "arms", "legs"], ["back", "legs"], ["back", "arms", "abs"], ["chest", "shoulders", "arms"],
      ["chest", "shoulders", "arms"], ["arms"]]);
  eq("…Friday's dips are 2 chest sets, so ½ + ½ make a dot for arms and shoulders", T.dayGroups(WK5, L(2026, 10, 9)), ["chest", "shoulders", "arms"]);
  eq("last trained, Sunday night: chest Sat · back Thu · shoulders Sat · arms Sun · abs Thu · legs Wed",
    M.GROUPS.map(g => T.lastTrained(WK5, g, L(2026, 10, 11, 23, 59, 59))),
    [L(2026, 10, 10, 12), L(2026, 10, 8, 18, 10), L(2026, 10, 10, 12), L(2026, 10, 11, 23, 59), L(2026, 10, 8, 18), L(2026, 10, 7, 18, 30)]);
  eq("the six bars", T.weekSummary(WK5, MID, [10, 20]).map(r => [r.group, r.sets, r.zone]), [
    ["chest", 10, "on"], ["back", 9.5, "building"], ["shoulders", 7.25, "building"], ["arms", 9.25, "low"], ["abs", 2, "low"], ["legs", 11, "building"]]);
  eq("workouts: every day of the week", T.workoutsInWeek(WK5, L(2026, 10, 11, 23)), 7);
  eq("the week before and after: one bench press each (2 sets)", [T.weekVolume(WK5, L(2026, 10, 1)), T.weekVolume(WK5, L(2026, 10, 12))],
    [V({ chest: 2, shoulders: 1, arms: 1 }), V({ chest: 2, shoulders: 1, arms: 1 })]);
  eq("this point last week (Mon 12 Oct → Mon 5 Oct): Monday's bench press and laterals",
    T.lastWeekToDate(WK5, L(2026, 10, 12, 9)), V({ chest: 3, shoulders: 4.5, arms: 1.5 }));
  eq("the nudge on Sunday: every group trained lately; abs (2 of 10) are furthest behind",
    T.groupNudge(WK5, L(2026, 10, 11, 20), [10, 20]), { group: "abs", kind: "behind", sets: 2, lo: 10, daysLeft: 1 });
  eq("…on Thursday 12:00 abs were never trained yet (the plank is at 18:00)",
    [T.groupNudge(WK5, MID, [10, 20]).group, T.groupNudge(WK5, MID, [10, 20]).days], ["abs", null]);
  T.useExercises([]);
}

section("one exercise's history: sessions, last session, best set");
{
  T.useExercises([]);
  const s1 = G(L(2026, 9, 1, 18), "bench_bb", [8, 8, 8], 80, "h1");
  const s2 = G(L(2026, 9, 3, 18), "bench_bb", [12, 8, 8, 7], [60, 90, 90, 90], "h2");
  const pd = G(L(2026, 9, 3, 18, 30), "pulldown", [10, 10], 50, "h3");
  const s3 = G(L(2026, 9, 8, 7), "bench_bb", [10, 10, 9], 90, "h4");
  const s4 = G(L(2026, 9, 8, 19), "bench_bb", [5, 3], 100, "h5");
  const s5 = G(L(2026, 9, 12, 9), "bench_bb", [8, 8], 92.5, "h6");
  const HL = [s1, s2, pd, s3, s4, s5, bw(L(2026, 9, 9), "pushup", 5, [10]), quick(L(2026, 9, 10), { chest: 3 }),
    { id: "h7", ts: L(2026, 9, 11), exId: "bench_bb", sets: [8] }];
  const ids = list => list.map(e => e.id);
  eq("newest first; other exercises and kinds left out", ids(T.sessionsFor(HL, "bench_bb")), ["h6", "h5", "h4", "h2", "h1"]);
  check("…the log's own objects", T.sessionsFor(HL, "bench_bb")[0] === s5);
  eq("the log's order doesn't matter", ids(T.sessionsFor(HL.slice().reverse(), "bench_bb")), ["h6", "h5", "h4", "h2", "h1"]);
  eq("before 12 Sep 20:00: only earlier days (not 12 Sep 09:00)", ids(T.sessionsFor(HL, "bench_bb", { before: L(2026, 9, 12, 20) })), ["h5", "h4", "h2", "h1"]);
  eq("before 12 Sep 00:00: the same", ids(T.sessionsFor(HL, "bench_bb", { before: L(2026, 9, 12) })), ["h5", "h4", "h2", "h1"]);
  eq("before 8 Sep 12:00: neither of 8 Sep's (07:00 and 19:00)", ids(T.sessionsFor(HL, "bench_bb", { before: L(2026, 9, 8, 12) })), ["h2", "h1"]);
  eq("exclude h4", ids(T.sessionsFor(HL, "bench_bb", { exclude: "h4" })), ["h6", "h5", "h2", "h1"]);
  eq("before and exclude together", ids(T.sessionsFor(HL, "bench_bb", { before: L(2026, 9, 12), exclude: "h5" })), ["h4", "h2", "h1"]);
  eq("exclude null or missing: nothing left out", [ids(T.sessionsFor(HL, "bench_bb", { exclude: null })).length, ids(T.sessionsFor(HL, "bench_bb", {})).length], [5, 5]);
  eq("before a time that isn't one → []", [T.sessionsFor(HL, "bench_bb", { before: "soon" }), T.sessionsFor(HL, "bench_bb", { before: NaN })], [[], []]);
  eq("before null: no limit", T.sessionsFor(HL, "bench_bb", { before: null }).length, 5);
  {
    const a = G(W, "bench_bb", [8], 60, "zz1"), b = G(W, "bench_bb", [8], 60, "aa2");
    eq("two at the same time: the later in the log first", [ids(T.sessionsFor([a, b], "bench_bb")), ids(T.sessionsFor([b, a], "bench_bb"))], [["aa2", "zz1"], ["zz1", "aa2"]]);
  }
  eq("entries of an unknown or prototype-named id are still found by id", [ids(T.sessionsFor([G(W, "constructor", [8], 60, "c1")], "constructor")),
    ids(T.sessionsFor([G(W, "gone_ex", [8], 60, "c2")], "gone_ex"))], [["c1"], ["c2"]]);
  eq("no log, a non-string id → []", [T.sessionsFor(null, "bench_bb"), T.sessionsFor(HL, null), T.sessionsFor(HL, 5), T.sessionsFor("log", "bench_bb")], [[], [], [], []]);
  eq("last session", [T.lastSession(HL, "bench_bb").id, T.lastSession(HL, "bench_bb", { before: L(2026, 9, 8) }).id, T.lastSession(HL, "pulldown", { before: L(2026, 9, 3) })],
    ["h6", "h2", null]);
  eq("…with nothing: null", [T.lastSession([], "bench_bb"), T.lastSession(null, "x")], [null, null]);

  eq("best set: 90 × 10 on 8 Sep (e1RM 120), over 92.5 × 8 (118.3) and 100 × 5 (116.7)", T.best(HL, "bench_bb"),
    { kg: 90, reps: 10, e1rm: 120, ts: L(2026, 9, 8, 7), id: "h4" });
  eq("…without h4: 92.5 × 8", T.best(HL, "bench_bb", { exclude: "h4" }), { kg: 92.5, reps: 8, e1rm: 92.5 * 38 / 30, ts: L(2026, 9, 12, 9), id: "h6" });
  eq("…before 12 Sep, without h4: 100 × 5", T.best(HL, "bench_bb", { before: L(2026, 9, 12), exclude: "h4" }),
    { kg: 100, reps: 5, e1rm: 100 * 35 / 30, ts: L(2026, 9, 8, 19), id: "h5" });
  eq("a tie keeps the earliest", T.best(HL.concat([G(L(2026, 9, 20), "bench_bb", [10], 90, "h8")]), "bench_bb").id, "h4");
  eq("the same e1RM from two weights: the heavier (100 × 6 = 90 × 10)", T.best([G(L(2026, 9, 1), "bench_bb", [10], 90, "a"), G(L(2026, 9, 2), "bench_bb", [6], 100, "b")], "bench_bb").id, "b");
  eq("60 × 12 (a warm-up) then 100 × 3 → 100 × 3, e1RM 110", T.best([G(W, "bench_bb", [12, 3], [60, 100], "w")], "bench_bb"), { kg: 100, reps: 3, e1rm: 110, ts: W, id: "w" });
  eq("per hand: 24 kg dumbbells × 10 → e1RM 32 (per hand)", T.best([G(W, "bench_db", [10, 12], [24, 20], "d")], "bench_db"), { kg: 24, reps: 10, e1rm: 32, ts: W, id: "d" });
  eq("assisted: the least help, then the most reps (e1RM 0)", T.best([G(L(2026, 9, 1), "pullup_assist", [10, 10], 30, "a1"), G(L(2026, 9, 2), "pullup_assist", [8, 6], 20, "a2"),
    G(L(2026, 9, 3), "pullup_assist", [12], 25, "a3")], "pullup_assist"), { kg: 20, reps: 8, e1rm: 0, ts: L(2026, 9, 2), id: "a2" });
  eq("bodyweight: the most reps", T.best([G(L(2026, 9, 1), "ab_wheel", [12, 15, 9], 0, "b1"), G(L(2026, 9, 2), "ab_wheel", [14], 0, "b2")], "ab_wheel"),
    { kg: 0, reps: 15, e1rm: 0, ts: L(2026, 9, 1), id: "b1" });
  eq("timed: the longest hold", T.best([G(L(2026, 9, 1), "plank", [45, 60, 30], 0, "p1")], "plank").reps, 60);
  eq("added weight: any weight on beats bodyweight reps (10 × 8 over 0 × 12), and no estimated max (it would be of the added kg alone)", T.best([G(L(2026, 9, 1), "dips", [12, 10], 0, "d1"), G(L(2026, 9, 2), "dips", [8, 6], 10, "d2")], "dips"),
    { kg: 10, reps: 8, e1rm: 0, ts: L(2026, 9, 2), id: "d2" });
  eq("…bodyweight only: the most reps, e1RM 0", T.best([G(L(2026, 9, 1), "dips", [12, 10], 0, "d1")], "dips"), { kg: 0, reps: 12, e1rm: 0, ts: L(2026, 9, 1), id: "d1" });
  eq("a cable exercise logged at 0 kg: the most reps", T.best([G(W, "fly_cable", [12, 15], 0, "f")], "fly_cable"), { kg: 0, reps: 15, e1rm: 0, ts: W, id: "f" });
  eq("nothing to go on → null: unknown id, empty log, only 0 reps", [T.best([G(W, "gone_ex", [8], 50)], "gone_ex"), T.best([], "bench_bb"),
    T.best([G(W, "bench_bb", [0, 0], 50)], "bench_bb"), T.best(null, "bench_bb"), T.best(HL, "constructor")], [null, null, null, null, null]);
  T.useExercises([]);
}

section("rounding to the weight step");
eq("56.25 to 2.5: down 55, up 57.5, nearest 57.5", [T.roundTo(56.25, 2.5, "down"), T.roundTo(56.25, 2.5, "up"), T.roundTo(56.25, 2.5)], [55, 57.5, 57.5]);
eq("already on the step: itself, every way", [T.roundTo(45, 2.5, "down"), T.roundTo(45, 2.5, "up"), T.roundTo(45, 2.5, "near")], [45, 45, 45]);
eq("floating-point noise doesn't move a step: (1 − 0.9) × 25 down → 2.5; 1.1 × 25 up → 27.5", [T.roundTo((1 - 0.9) * 25, 2.5, "down"), T.roundTo(1.1 * 25, 2.5, "up")], [2.5, 27.5]);
eq("22 up to 5 → 25; 1.8 down to 2 → 0", [T.roundTo(22, 5, "up"), T.roundTo(1.8, 2, "down")], [25, 0]);
eq("a step that isn't above 0 counts as 0.25", [T.roundTo(10.3, 0, "down"), T.roundTo(10.3, -5, "up"), T.roundTo(10.3, "x", "down")], [10.25, 10.5, 10.25]);
eq("kg that isn't a number → 0", [T.roundTo("x", 2.5), T.roundTo(null, 2.5), T.roundTo(undefined, 2.5), T.roundTo(true, 2.5)], [0, 0, 0, 0]);
check("never -0", Object.is(T.roundTo(-0.1, 2.5, "up"), 0));

section("suggestions: double progression for the next session");
{
  T.useExercises([]);
  const NOWG = L(2026, 10, 15, 9);            // Thursday 15 Oct 2026
  const D = (d, hh) => L(2026, 10, d, hh === undefined ? 18 : hh);
  const S = (exId, log, opts, now) => T.suggest(exId, log, now === undefined ? NOWG : now, opts);
  const K = sg => sg && [sg.kind, sg.kg, sg.sets, sg.targets];
  const FIRST = ["first", null, 3, [10, 10, 10]];

  eq("first time: 3 sets of hi, no weight, nothing to go from", S("bench_bb", []), { kind: "first", kg: null, sets: 3, targets: [10, 10, 10], from: null });
  eq("…today's own entry doesn't count (it's today)", K(S("bench_bb", [G(D(15, 7), "bench_bb", [10, 10, 10], 100)])), FIRST);
  eq("…nor a later day's", K(S("bench_bb", [G(D(16), "bench_bb", [10, 10, 10], 100)])), FIRST);
  eq("…nor the entry being edited", K(S("bench_bb", [G(D(13), "bench_bb", [10, 10, 10], 100, "ed")], { exclude: "ed" })), FIRST);
  eq("…nor a session with no reps", K(S("bench_bb", [G(D(13), "bench_bb", [0, 0], 100)])), FIRST);
  eq("…nor another exercise's", K(S("bench_bb", [G(D(13), "bench_db", [10, 10], 20)])), FIRST);
  eq("a loaded exercise logged at 0 kg: first, but from that session", S("bench_bb", [G(D(13), "bench_bb", [10, 10], 0, "z")]),
    { kind: "first", kg: null, sets: 3, targets: [10, 10, 10], from: { id: "z", ts: D(13), kg: 0, reps: [10, 10] } });
  eq("first for the plank: 3 holds of 60 s", K(S("plank", [])), ["first", null, 3, [60, 60, 60]]);

  // bench press: 6–10 reps, +2.5 kg
  eq("every set at exactly hi (10, 10, 10 × 100) → up 2.5 kg, 6 each (2.5 % jump)",
    S("bench_bb", [G(D(13), "bench_bb", [10, 10, 10], 100, "u")]),
    { kind: "up", kg: 102.5, sets: 3, targets: [6, 6, 6], from: { id: "u", ts: D(13), kg: 100, reps: [10, 10, 10] } });
  eq("above hi counts as reaching it (11, 10, 10)", K(S("bench_bb", [G(D(13), "bench_bb", [11, 10, 10], 100)])), ["up", 102.5, 3, [6, 6, 6]]);
  eq("one set short of hi (10, 10, 9) → same weight, targets min(hi, r + 1)", K(S("bench_bb", [G(D(13), "bench_bb", [10, 10, 9], 100)])), ["same", 100, 3, [10, 10, 10]]);
  eq("8, 7, 6 → same, 9, 8, 7", K(S("bench_bb", [G(D(13), "bench_bb", [8, 7, 6], 100)])), ["same", 100, 3, [9, 8, 7]]);
  eq("a warm-up isn't a set: 60 × 12 then 10, 10, 10 × 100 → up, 3 sets", K(S("bench_bb", [G(D(13), "bench_bb", [12, 10, 10, 10], [60, 100, 100, 100])])),
    ["up", 102.5, 3, [6, 6, 6]]);
  eq("from: the working reps at W only", S("bench_bb", [G(D(13), "bench_bb", [12, 8, 8, 7], [60, 100, 100, 100], "f")]).from,
    { id: "f", ts: D(13), kg: 100, reps: [8, 8, 7] });
  eq("a back-off set (85 × 10) keeps its place in the count; targets from the sets at W, the last repeated",
    K(S("bench_bb", [G(D(13), "bench_bb", [8, 8, 10], [100, 100, 85])])), ["same", 100, 3, [9, 9, 9]]);
  eq("…the extra set repeats the last target at W, not the first (9, 8 at 100, then 85 × 10 → 10, 9, 9)",
    K(S("bench_bb", [G(D(13), "bench_bb", [9, 8, 10], [100, 100, 85])])), ["same", 100, 3, [10, 9, 9]]);
  eq("…and doesn't stop a step up when the sets at W reached hi (85 × 10 is working, below hi or not)",
    K(S("bench_bb", [G(D(13), "bench_bb", [10, 10, 9], [100, 100, 85])])), ["up", 102.5, 3, [6, 6, 6]]);
  eq("…a lighter set under 80 % isn't one of the sets (85 × 6 after 100 × 10)", K(S("bench_bb", [G(D(13), "bench_bb", [10, 10, 6], [100, 100, 85])])),
    ["up", 102.5, 2, [6, 6]]);
  eq("W is the top weight: 97.5 × 10 and 100 × 9 → same at 100, from its set", K(S("bench_bb", [G(D(13), "bench_bb", [10, 9], [97.5, 100])])), ["same", 100, 2, [10, 10]]);
  eq("the number of sets follows the last session: 5", K(S("bench_bb", [G(D(13), "bench_bb", [8, 8, 8, 8, 8], 100)])), ["same", 100, 5, [9, 9, 9, 9, 9]]);
  eq("…1", K(S("bench_bb", [G(D(13), "bench_bb", [8], 100)])), ["same", 100, 1, [9]]);
  eq("…never more than 10", K(S("bench_bb", [G(D(13), "bench_bb", range(12, () => 8), 100)])), ["same", 100, 10, range(10, () => 9)]);
  eq("only the latest session counts for up/same (an older 10, 10, 10 doesn't)",
    K(S("bench_bb", [G(D(8), "bench_bb", [10, 10, 10], 100), G(D(13), "bench_bb", [9, 8, 8], 102.5)])), ["same", 102.5, 3, [10, 9, 9]]);
  eq("the log's order doesn't matter", K(S("bench_bb", [G(D(13), "bench_bb", [9, 8, 8], 102.5), G(D(8), "bench_bb", [10, 10, 10], 100)])), ["same", 102.5, 3, [10, 9, 9]]);
  eq("editing the latest: the suggestion comes from the one before",
    K(S("bench_bb", [G(D(8), "bench_bb", [8, 8, 8], 100), G(D(13), "bench_bb", [10, 10, 10], 100, "ed")], { exclude: "ed" })), ["same", 100, 3, [9, 9, 9]]);
  eq("…not even one logged at 00:00 today", K(S("bench_bb", [G(D(13), "bench_bb", [8, 8, 8], 100), G(D(15, 0), "bench_bb", [10, 10, 10], 100)])),
    ["same", 100, 3, [9, 9, 9]]);
  eq("…while yesterday 23:59 counts", K(S("bench_bb", [G(D(13), "bench_bb", [8, 8, 8], 100), G(L(2026, 10, 14, 23, 59), "bench_bb", [10, 10, 10], 100)])),
    ["up", 102.5, 3, [6, 6, 6]]);
  eq("today's session doesn't move today's suggestion",
    K(S("bench_bb", [G(D(13), "bench_bb", [8, 8, 8], 100), G(D(15, 7), "bench_bb", [10, 10, 10], 100)])), ["same", 100, 3, [9, 9, 9]]);

  // The 10 % boundary (bench press +2.5 kg).
  eq("W 25: +2.5 is exactly 10 % → lo", K(S("bench_bb", [G(D(13), "bench_bb", [10, 10], 25)])), ["up", 27.5, 2, [6, 6]]);
  eq("W 24.75: +2.5 is more than 10 % → lo − 2", K(S("bench_bb", [G(D(13), "bench_bb", [10, 10], 24.75)])), ["up", 27.25, 2, [4, 4]]);
  eq("W 20: 12.5 % → lo − 2", K(S("bench_bb", [G(D(13), "bench_bb", [10, 10], 20)])), ["up", 22.5, 2, [4, 4]]);
  // Per-hand dumbbells (8–12, +2 kg per hand).
  eq("dumbbells 24 kg per hand, 12 × 3 → 26 kg, 8 each (8.3 %)", K(S("bench_db", [G(D(13), "bench_db", [12, 12, 12], 24)])), ["up", 26, 3, [8, 8, 8]]);
  eq("…20 kg: +2 is exactly 10 % → 8", K(S("bench_db", [G(D(13), "bench_db", [12, 12, 12], 20)])), ["up", 22, 3, [8, 8, 8]]);
  eq("…16 kg: 12.5 % → 6", K(S("bench_db", [G(D(13), "bench_db", [12, 12, 12], 16)])), ["up", 18, 3, [6, 6, 6]]);
  eq("…with a 10 kg warm-up set first: still 3 sets", K(S("bench_db", [G(D(13), "bench_db", [12, 12, 12, 12], [10, 16, 16, 16])])), ["up", 18, 3, [6, 6, 6]]);

  // Deload: two sessions below the floor at the same weight, no rep gain.
  eq("6, 5, 5 then 6, 5, 4 at 100 (16 → 15 reps) → deload to 90, 6 each",
    S("bench_bb", [G(D(8), "bench_bb", [6, 5, 5], 100), G(D(13), "bench_bb", [6, 5, 4], 100, "l")]),
    { kind: "deload", kg: 90, sets: 3, targets: [6, 6, 6], from: { id: "l", ts: D(13), kg: 100, reps: [6, 5, 4] } });
  eq("…the same total (16 → 16) is no gain either → deload", K(S("bench_bb", [G(D(8), "bench_bb", [6, 5, 5], 100), G(D(13), "bench_bb", [5, 6, 5], 100)])),
    ["deload", 90, 3, [6, 6, 6]]);
  eq("…a rep gained (15 → 16) → same", K(S("bench_bb", [G(D(8), "bench_bb", [6, 5, 4], 100), G(D(13), "bench_bb", [6, 5, 5], 100)])), ["same", 100, 3, [7, 6, 6]]);
  eq("…at different weights (97.5, then 100) → same", K(S("bench_bb", [G(D(8), "bench_bb", [6, 5, 5], 97.5), G(D(13), "bench_bb", [6, 5, 4], 100)])),
    ["same", 100, 3, [7, 6, 5]]);
  eq("…the one before wasn't below the floor (6, 6, 6) → same", K(S("bench_bb", [G(D(8), "bench_bb", [6, 6, 6], 100), G(D(13), "bench_bb", [6, 6, 5], 100)])),
    ["same", 100, 3, [7, 7, 6]]);
  eq("…the latest isn't below the floor → same", K(S("bench_bb", [G(D(8), "bench_bb", [5, 5, 5], 100), G(D(13), "bench_bb", [6, 6, 6], 100)])),
    ["same", 100, 3, [7, 7, 7]]);
  eq("…not even with fewer reps than the short one before (7, 7, 5 → 6, 6, 6) → same", K(S("bench_bb", [G(D(8), "bench_bb", [7, 7, 5], 100), G(D(13), "bench_bb", [6, 6, 6], 100)])),
    ["same", 100, 3, [7, 7, 7]]);
  eq("…only one session below the floor → same", K(S("bench_bb", [G(D(13), "bench_bb", [6, 5, 4], 100)])), ["same", 100, 3, [7, 6, 5]]);
  eq("…a no-reps session in between is skipped",
    K(S("bench_bb", [G(D(8), "bench_bb", [6, 5, 5], 100), G(D(10), "bench_bb", [0], 100), G(D(13), "bench_bb", [6, 5, 4], 100)])), ["deload", 90, 3, [6, 6, 6]]);
  eq("…today's third one doesn't count: the two before it decide",
    K(S("bench_bb", [G(D(8), "bench_bb", [6, 5, 4], 100), G(D(13), "bench_bb", [6, 5, 5], 100), G(D(15, 7), "bench_bb", [5, 5, 4], 100)])), ["same", 100, 3, [7, 6, 6]]);
  eq("90 % rounds down to the step: 62.5 → 56.25 → 55", K(S("bench_bb", [G(D(8), "bench_bb", [5, 5], 62.5), G(D(13), "bench_bb", [5, 4], 62.5)])),
    ["deload", 55, 2, [6, 6]]);
  eq("…never to 0: 2 kg dumbbells stay 2 (lateral raises, 10–15, +2)", K(S("lateral_db", [G(D(8), "lateral_db", [8, 8], 2), G(D(13), "lateral_db", [8, 7], 2)])),
    ["deload", 2, 2, [10, 10]]);

  // Six weeks off: 42 calendar days is still "same"; 43 starts lighter.
  const OFF = () => [G(L(2026, 9, 3, 18), "bench_bb", [8, 8, 8], 100, "o")];
  eq("42 days after (3 Sep → 15 Oct) → same", K(S("bench_bb", OFF(), {}, L(2026, 10, 15, 23, 59))), ["same", 100, 3, [9, 9, 9]]);
  eq("43 days after → return: 90 kg, lo each", S("bench_bb", OFF(), {}, L(2026, 10, 16, 0, 1)),
    { kind: "return", kg: 90, sets: 3, targets: [6, 6, 6], from: { id: "o", ts: L(2026, 9, 3, 18), kg: 100, reps: [8, 8, 8] } });
  eq("return comes before up (10, 10, 10, 50 days ago)", K(S("bench_bb", [G(L(2026, 8, 26), "bench_bb", [10, 10, 10], 100)])), ["return", 90, 3, [6, 6, 6]]);
  eq("…and before deload", K(S("bench_bb", [G(L(2026, 8, 20), "bench_bb", [6, 5, 5], 100), G(L(2026, 8, 26), "bench_bb", [6, 5, 4], 100)])), ["return", 90, 3, [6, 6, 6]]);
  eq("return rounds down to the step: 97.5 → 87.75 → 87.5", K(S("bench_bb", [G(L(2026, 8, 26), "bench_bb", [8, 8], 97.5)])), ["return", 87.5, 2, [6, 6]]);
  // Across daylight-saving changes (both zones switch inside each span).
  const SPRING = [G(L(2026, 2, 20, 23, 30), "bench_bb", [8, 8], 100)];
  eq("spring: 20 Feb 23:30 → 3 Apr 23:59 is 42 calendar days (just under 42 × 24 h of clock time) → same",
    K(S("bench_bb", SPRING, {}, L(2026, 4, 3, 23, 59))), ["same", 100, 2, [9, 9]]);
  eq("spring: → 4 Apr 00:30 is 43 days (exactly 42 × 24 h of clock time) → return",
    K(S("bench_bb", SPRING, {}, L(2026, 4, 4, 0, 30))), ["return", 90, 2, [6, 6]]);
  const AUTUMN = [G(L(2026, 10, 1, 0, 30), "bench_bb", [8, 8], 100)];
  eq("autumn: 1 Oct 00:30 → 12 Nov 23:30 is 42 calendar days (43 × 24 h of clock time) → same",
    K(S("bench_bb", AUTUMN, {}, L(2026, 11, 12, 23, 30))), ["same", 100, 2, [9, 9]]);
  eq("autumn: → 13 Nov 00:10 is 43 days → return", K(S("bench_bb", AUTUMN, {}, L(2026, 11, 13, 0, 10))), ["return", 90, 2, [6, 6]]);

  // Assisted machines go the other way (8–12, 5 kg steps).
  eq("assisted: 12 × 3 at 30 kg help → up to 25 kg help; 5 of 30 is 16.7 % → lo − 2",
    S("pullup_assist", [G(D(13), "pullup_assist", [12, 12, 12], 30, "a")]),
    { kind: "up", kg: 25, sets: 3, targets: [6, 6, 6], from: { id: "a", ts: D(13), kg: 30, reps: [12, 12, 12] } });
  eq("…at 60: 8.3 % → lo", K(S("pullup_assist", [G(D(13), "pullup_assist", [12, 12], 60)])), ["up", 55, 2, [8, 8]]);
  eq("…at 50: exactly 10 % → lo", K(S("pullup_assist", [G(D(13), "pullup_assist", [12, 12], 50)])), ["up", 45, 2, [8, 8]]);
  eq("…at 3: not below 0", K(S("pullup_assist", [G(D(13), "pullup_assist", [12, 12], 3)])), ["up", 0, 2, [6, 6]]);
  eq("…W is the least help: 12 × 35 then 10 × 30 → same at 30, from its set", K(S("pullup_assist", [G(D(13), "pullup_assist", [12, 10], [35, 30])])),
    ["same", 30, 2, [11, 11]]);
  eq("…deload adds help: 30 → 33 → up to the step, 35", K(S("pullup_assist", [G(D(8), "pullup_assist", [7, 6], 30), G(D(13), "pullup_assist", [6, 6], 30)])),
    ["deload", 35, 2, [8, 8]]);
  eq("…return adds help: 25 → 27.5 → 30", K(S("pullup_assist", [G(L(2026, 8, 20), "pullup_assist", [10, 10], 25)])), ["return", 30, 2, [8, 8]]);
  eq("…with no help at all it's bodyweight: reps, then harder", [K(S("pullup_assist", [G(D(13), "pullup_assist", [10, 9], 0)])),
    K(S("pullup_assist", [G(D(13), "pullup_assist", [12, 12], 0)]))], [["reps", 0, 2, [11, 10]], ["harder", 0, 2, [12, 12]]]);

  // Progress by reps: bodyweight only, timed, and added weight at 0 kg.
  eq("ab wheel (8–15): 12, 10, 9 → 13, 11, 10", S("ab_wheel", [G(D(13), "ab_wheel", [12, 10, 9], 0, "w")]),
    { kind: "reps", kg: 0, sets: 3, targets: [13, 11, 10], from: { id: "w", ts: D(13), kg: 0, reps: [12, 10, 9] } });
  eq("…15, 15, 14 → reps, 15 each", K(S("ab_wheel", [G(D(13), "ab_wheel", [15, 15, 14], 0)])), ["reps", 0, 3, [15, 15, 15]]);
  eq("…15, 15, 15 → harder", K(S("ab_wheel", [G(D(13), "ab_wheel", [15, 15, 15], 0)])), ["harder", 0, 3, [15, 15, 15]]);
  eq("…kg typed on a bodyweight exercise is ignored", K(S("ab_wheel", [G(D(13), "ab_wheel", [12], 20)])), ["reps", 0, 1, [13]]);
  eq("…no deload by reps: two short sessions → reps", K(S("ab_wheel", [G(D(8), "ab_wheel", [6, 5], 0), G(D(13), "ab_wheel", [5, 5], 0)])), ["reps", 0, 2, [6, 6]]);
  eq("…43 days off → return, lo each", K(S("ab_wheel", [G(L(2026, 9, 2), "ab_wheel", [12, 10], 0)])), ["return", 0, 2, [8, 8]]);
  eq("plank (20–60 s): 45, 40 s → 50, 45 s (timed holds go up 5 s at a time)", K(S("plank", [G(D(13), "plank", [45, 40], 0)])), ["reps", 0, 2, [50, 45]]);
  eq("…capped at the top of the range: 58, 40 s → 60, 45 s", K(S("plank", [G(D(13), "plank", [58, 40], 0)])), ["reps", 0, 2, [60, 45]]);
  eq("…60, 59 → 60, 60", K(S("plank", [G(D(13), "plank", [60, 59], 0)])), ["reps", 0, 2, [60, 60]]);
  eq("…60, 60 → harder", K(S("plank", [G(D(13), "plank", [60, 60], 0)])), ["harder", 0, 2, [60, 60]]);
  eq("dips (added, 8–12): 10, 9 at bodyweight → reps 11, 10", K(S("dips", [G(D(13), "dips", [10, 9], 0)])), ["reps", 0, 2, [11, 10]]);
  eq("…12 × 3 at bodyweight → harder (add weight)", K(S("dips", [G(D(13), "dips", [12, 12, 12], 0)])), ["harder", 0, 3, [12, 12, 12]]);
  eq("…with 10 kg on: 12 × 3 → up 12.5 kg; 25 % → lo − 2", K(S("dips", [G(D(13), "dips", [12, 12, 12], 10)])), ["up", 12.5, 3, [6, 6, 6]]);
  eq("…9, 8 with 10 kg → same, 10, 9", K(S("dips", [G(D(13), "dips", [9, 8], 10)])), ["same", 10, 2, [10, 9]]);
  eq("…a bodyweight set, then 8, 8 with 10 kg → same at 10 kg, all 3 sets", K(S("dips", [G(D(13), "dips", [10, 8, 8], [0, 10, 10])])), ["same", 10, 3, [9, 9, 9]]);
  // Two entries of one exercise on one day are one session.
  eq("same day, two entries: one session (100 × 10, 10 then 100 × 9 → same, 3 sets)",
    K(S("bench_bb", [G(D(13) + 3600000, "bench_bb", [9], 100, "b2"), G(D(13), "bench_bb", [10, 10], 100, "b1")])), ["same", 100, 3, [10, 10, 10]]);
  eq("…so one short workout split in two isn't 'two sessions short' (no deload)",
    K(S("bench_bb", [G(D(13) + 3600000, "bench_bb", [5, 4], 100, "b2"), G(D(13), "bench_bb", [6, 5, 5], 100, "b1")]))[0], "same");
  // After a big step up the floor is lo − 2: settling in there isn't a failure.
  eq("16 → 18 kg (12½ %) aimed at 6: 6, 6, 6 twice at 18 → same, not deload",
    K(S("bench_db", [G(D(13), "bench_db", [6, 6, 6], 18, "s3"), G(D(11), "bench_db", [6, 6, 6], 18, "s2"), G(D(8), "bench_db", [12, 12, 12], 16, "s1")])), ["same", 18, 3, [7, 7, 7]]);
  eq("…but 5, 5, 5 twice at 18 (under lo − 2) → deload", K(S("bench_db", [G(D(13), "bench_db", [5, 5, 5], 18, "s3"), G(D(11), "bench_db", [5, 5, 5], 18, "s2"), G(D(8), "bench_db", [12, 12, 12], 16, "s1")]))[0], "deload");
  eq("…a small step (20 → 22 kg, 10 %) keeps the floor at lo: 7, 7, 7 twice → deload", K(S("bench_db", [G(D(13), "bench_db", [7, 7, 7], 22, "s3"), G(D(11), "bench_db", [7, 7, 7], 22, "s2"), G(D(8), "bench_db", [12, 12, 12], 20, "s1")]))[0], "deload");
  eq("…harder at bodyweight, then weight on: from the weighted session", K(S("dips", [G(D(8), "dips", [12, 12], 0), G(D(13), "dips", [8, 8], 5)])),
    ["same", 5, 2, [9, 9]]);

  // Tweaks and your own exercises.
  T.useExercises([{ id: "bench_bb", inc: 5, lo: 3, hi: 5, note: "", mts: 1 }]);
  eq("a tweak (3–5 reps, +5 kg): 5, 5, 5 × 100 → up 105, 3 each", K(S("bench_bb", [G(D(13), "bench_bb", [5, 5, 5], 100)])), ["up", 105, 3, [3, 3, 3]]);
  eq("…first: 3 × 5", K(S("bench_bb", [])), ["first", null, 3, [5, 5, 5]]);
  eq("…return rounds to its step: 97.5 → 87.75 → 85", K(S("bench_bb", [G(L(2026, 8, 26), "bench_bb", [5, 5], 97.5)])), ["return", 85, 2, [3, 3]]);
  eq("…same caps at its hi: 4, 3 → 5, 4", K(S("bench_bb", [G(D(13), "bench_bb", [4, 3], 100)])), ["same", 100, 2, [5, 4]]);
  T.useExercises([{ id: "bench_bb", inc: null, lo: 2, hi: 3, note: "", mts: 1 }]);
  eq("lo − 2 is never below 1 (range 2–3, 12.5 % jump)", K(S("bench_bb", [G(D(13), "bench_bb", [3, 3], 20)])), ["up", 22.5, 2, [1, 1]]);
  T.useExercises([]);
  eq("…and without the tweak: 5, 5, 5 × 100 is short of 10 → same", K(S("bench_bb", [G(D(13), "bench_bb", [5, 5, 5], 100)])), ["same", 100, 3, [6, 6, 6]]);
  T.useExercises([SLED, OLD, BAND]);
  eq("your own (10–20, +10 kg): 20, 20 × 100 → up 110, 10 % → lo", K(S("x_sled", [G(D(13), "x_sled", [20, 20], 100)])), ["up", 110, 2, [10, 10]]);
  eq("a deleted one of yours still suggests (an old entry being edited)", K(S("x_old", [G(D(13), "x_old", [9, 8], 50)])), ["same", 50, 2, [10, 9]]);
  eq("a load type this version doesn't know: by reps, kg carried over", K(S("x_band", [G(D(13), "x_band", [10, 8], [5, 20])])), ["reps", 20, 2, [9, 9]]);
  T.useExercises([WPLANK]);
  eq("timed with weight on (30–60 s): by seconds at the top weight — 60 s × 5 kg, 30 s × 20 kg → 35 s, twice", K(S("x_wplank", [G(D(13), "x_wplank", [60, 30], [5, 20])])),
    ["reps", 20, 2, [35, 35]]);
  eq("…every hold at 60 s → harder", K(S("x_wplank", [G(D(13), "x_wplank", [60, 60], 20)])), ["harder", 20, 2, [60, 60]]);
  T.useExercises([SLED, OLD, BAND]);
  eq("…43 days off: return keeps the weight, lo each", K(S("x_band", [G(L(2026, 9, 2), "x_band", [10, 8], 20)])), ["return", 20, 2, [8, 8]]);
  T.useExercises([]);
  eq("…unregistered: null", S("x_sled", [G(D(13), "x_sled", [20, 20], 100)]), null);
  ODD_IDS.forEach(id => eq("exId " + J(id) + " → null", S(id, [G(D(13), id, [8, 8], 100)]), null));
  eq("a now that isn't a time → null", [NaN, undefined, null, "soon"].map(now => T.suggest("bench_bb", [G(D(13), "bench_bb", [8], 100)], now)), [null, null, null, null]);
  eq("no log, or junk → first", [K(S("bench_bb", null)), K(S("bench_bb", "log")), K(S("bench_bb", [null, 7, {}, { kind: "gym", exId: "bench_bb" }]))], [FIRST, FIRST, FIRST]);
  {
    const log = [G(D(13), "bench_bb", [8, 8, 8], 100)], before = J(log), sg = S("bench_bb", log);
    sg.from.reps.push(99); sg.targets.push(99);
    eq("the log is left alone, and the answer is a fresh copy", [J(log), K(S("bench_bb", log))], [before, ["same", 100, 3, [9, 9, 9]]]);
  }
}

section("the gym: every catalogue exercise's first sessions, end to end");
{
  T.useExercises([]);
  // Three sessions a week apart at a steady weight, reaching hi on the third.
  const bad = [];
  CAT.forEach(c => {
    const kg = c.load === "bw" ? 0 : 20;
    const log = [G(L(2026, 9, 1), c.id, [c.lo, c.lo], kg), G(L(2026, 9, 8), c.id, [c.hi - 1, c.lo], kg), G(L(2026, 9, 15), c.id, [c.hi, c.hi], kg)]
      .map(e => M.sanitizeLogEntry(e));
    const sg = T.suggest(c.id, log, L(2026, 9, 22));
    const reps = c.timed || c.load === "bw";
    const want = reps ? ["harder", 0, 2, [c.hi, c.hi]]
      : c.load === "assist" ? ["up", 20 - c.inc, 2, fill2(Math.abs(c.inc) / 20 > 0.1 ? Math.max(1, c.lo - 2) : c.lo)]
        : ["up", 20 + c.inc, 2, fill2(c.inc / 20 > 0.1 ? Math.max(1, c.lo - 2) : c.lo)];
    if (!same([sg.kind, sg.kg, sg.sets, sg.targets], want)) bad.push(c.id + " " + J([sg.kind, sg.kg, sg.sets, sg.targets]) + " ≠ " + J(want));
    const mid = T.suggest(c.id, log, L(2026, 9, 15, 7));
    const wantMid = [reps ? "reps" : "same", kg, 2, [Math.min(c.hi, c.hi), Math.min(c.hi, c.lo + (c.timed ? 5 : 1))]];
    if (!same([mid.kind, mid.kg, mid.sets, mid.targets], wantMid)) bad.push(c.id + " mid " + J([mid.kind, mid.kg, mid.sets, mid.targets]) + " ≠ " + J(wantMid));
  });
  function fill2(x) { return [x, x]; }
  check("all " + CAT.length + ": same/reps while short of hi, then up (or harder) with the right step and floor", !bad.length, bad.slice(0, 4).join("\n       "));
}

section("the gym with a big log stays quick");
{
  T.useExercises([SLED]);
  const ids = CAT.map(c => c.id).concat(["x_sled", "gone_ex"]);
  const big = [];
  for (let i = 0; i < 3000; i++) {
    const t = L(2024, 10, 1 + Math.floor(i / 4), 7 + (i % 4) * 3);
    big.push(i % 3 ? G(t, ids[i % ids.length], [12, 10, 8, 8], [40, 60, 62.5, 62.5]) : bw(t, M.KNOWN_IDS[i % 6], 1 + (i % 10), [10, 8, 6]));
  }
  const t0 = Date.now(), now = L(2026, 9, 30, 12);
  T.weekStrip(big, now); T.weekHistory(big, now); T.groupNudge(big, now, [10, 20]); T.verdict(big, now, [10, 20]);
  M.GROUPS.forEach(g => { T.breakdown(big, now, g); T.lastTrained(big, g, now); });
  T.exerciseList().forEach(x => { T.suggest(x.id, big, now); T.lastSession(big, x.id); });
  T.best(big, "bench_bb");
  const ms = Date.now() - t0;
  check("3,000 entries, two thirds gym: the tabs' numbers plus a suggestion and last session for all 43 exercises in well under a second", ms < 1000, "took " + ms + " ms");
  T.useExercises([]);
}

section("odd logs and odd times never break anything");
{
  const clean = [bw(W, "pushup", 5, [10, 10]), bw(W + 1, "pushup", 5, [10], "constructor"), bw(W + 2, "squat", 5, [20], "Renamed Long Ago"),
    gym(W + 3), quick(W + 4, { chest: 4, legs: 3 }), weigh(W + 5), bw(W + 6, "bridge", 2, [0])].map(e => M.sanitizeLogEntry(e));
  check("(all seven entries survive sanitizing)", clean.every(Boolean));
  const junk = [null, 7, "x", [], {}, { ts: "soon" }, { ts: 1e300, kind: "quick", groups: { chest: 3 } }, { ts: -5, areaId: "pushup", step: 5, sets: [10] },
    { kind: "yoga", ts: W }, { ts: W, kind: "quick", groups: null }, { ts: W, kind: "quick", groups: JSON.parse('{"__proto__":{"chest":5},"constructor":3}') },
    { ts: W, areaId: "pushup", step: "x", sets: "10" }, { ts: W, areaId: "__proto__", step: 1, sets: [5] }];
  const logs = [[], null, undefined, "log", { length: 3 }, clean, junk, clean.concat(junk)];
  const nows = [W, L(2026, 3, 29, 2, 30), L(2026, 11, 1, 1, 30), L(2027, 1, 1), NaN, undefined, null, "soon"];
  const threw = [];
  logs.forEach((log, i) => nows.forEach(now => M.GROUPS.concat(ODD_GROUPS).forEach(g => {
    try {
      T.contribution(Array.isArray(log) ? log[0] : log, g); T.dayGroups(log, now); T.weekStrip(log, now); T.weekHistory(log, now, 3);
      T.lastTrained(log, g, now); T.daysSince(now, now); T.workoutDays(log); T.workoutsInWeek(log, now); T.totalWorkouts(log);
      T.weekStreak(log, now); T.monthGrid(now); T.monthLabel(now); T.addMonths(now, 1); T.breakdown(log, now, g);
      T.feeders(g); T.feedersAt(g, log); T.groupNudge(log, now, [10, 20]); T.groupNudge(log, now, "junk"); T.radarShare(now, g);
      T.dayOfWeek(now); T.pace(g, now); T.pace(10, now); T.paceZone(g, 10, 20, now); T.paceZone(3, g, log, now);
      T.weekVolumeUntil(log, now); T.lastWeekToDate(log, now); T.verdict(log, now, [10, 20]); T.verdict(log, now, log);
      T.mainFeeders(g); T.sessionFeeder(g, log, log); T.sessionFeeder(g, ["squat", g, "pushup"], log);
    } catch (e) { threw.push("log " + i + ", now " + String(now) + ", group " + String(g) + ": " + e.message); }
  })));
  check("no function throws, for any of 8 logs × 8 times × 15 group names", !threw.length, threw.slice(0, 3).join("\n       "));
  // The gym functions, with gym-shaped junk and exercises of every kind registered.
  const gymJunk = [{ kind: "gym", ts: W, exId: "bench_bb", sets: "8" }, { kind: "gym", ts: W, exId: "bench_bb", sets: [8, null, "x", -3, 1e9, true], kg: "60" },
    { kind: "gym", ts: W, exId: "constructor", sets: [8], kg: [60] }, { kind: "gym", ts: W, exId: "bench_bb", sets: [8, 8], kg: [NaN, Infinity] },
    { kind: "gym", ts: W, exId: {}, sets: [8] }, { kind: "gym", ts: "soon", exId: "bench_bb", sets: [8], kg: [60] }, { kind: "gym", exId: "dips", sets: [], kg: [] },
    { kind: "gym", ts: W, exId: "pullup_assist", sets: [8, 8], kg: [-5, 1e6] }, { kind: "gym", ts: W, exId: "__proto__", sets: [8], kg: [60] }];
  const glogs = logs.concat([gymJunk, clean.concat(gymJunk, junk)]);
  const exIds = ["bench_bb", "dips", "pullup_assist", "plank", "ab_wheel", "x_sled", "x_band", "x_grip", "gone_ex", "constructor", "__proto__", "", undefined, null, 3, {}];
  const opts = [undefined, null, {}, "x", { before: W, exclude: "g1" }, { before: "soon" }, { before: {}, exclude: 5 }];
  const gthrew = [];
  [[], [SLED, BAND, NOGROUP, OLD], "junk"].forEach(reg => {
    T.useExercises(reg);
    glogs.forEach((log, i) => nows.forEach(now => {
      try {
        (Array.isArray(log) ? log : []).forEach(e => { T.workingSets(e); T.hardSets(e); T.groupWeights(e); });
        T.weekVolume(log, now); T.breakdown(log, now, "chest");
      } catch (e) { gthrew.push("log " + i + ", now " + String(now) + ": " + e.message); }
      exIds.forEach(id => opts.forEach(o => {
        try {
          T.exercise(id); T.sessionsFor(log, id, o); T.lastSession(log, id, o); T.best(log, id, o); T.suggest(id, log, now, o);
          T.e1rm(now, id); T.roundTo(now, id, o);
        } catch (e) { gthrew.push("log " + i + ", now " + String(now) + ", exId " + J(id) + ", opts " + J(o) + ": " + e.message); }
      }));
    }));
    try { T.exerciseList(); } catch (e) { gthrew.push("exerciseList: " + e.message); }
  });
  T.useExercises([]);
  check("no gym function throws, for 10 logs × 8 times × 16 exercise ids × 7 options × 3 registrations", !gthrew.length, gthrew.slice(0, 3).join("\n       "));
  eq("gym junk counts only real sets: bench 8 and 1e9 (\"x\", -3, null, true aren't reps) + 8, 8 at unreadable kg; assisted 8, 8",
    T.weekVolume(gymJunk, W), V({ chest: 4, back: 2, shoulders: 2, arms: 3 }));
  eq("the sanitized log: pushups (and the unknown variant \"constructor\") and the quick log make dots", T.dayGroups(clean, W), ["chest", "shoulders", "arms", "legs"]);
  eq("…one workout day, the weigh-in aside", [T.workoutDays(clean), T.workoutsInWeek(clean, W)], [[M.dateStr(W)], 1]);
  eq("junk adds no sets anywhere", [T.dayGroups(junk, W), T.weekHistory(junk, W, 1)[0].sets, T.breakdown(junk, W, "chest"),
    T.lastWeekToDate(junk, T.addWeeks(W, 1)), T.weekVolumeUntil(junk, W)], [[], ZERO, [], ZERO, ZERO]);
  eq("…so the sentence has all six behind", T.verdict(junk, W, [10, 20]).behind, ["chest", "back", "shoulders", "arms", "abs", "legs"]);
  eq("a time that isn't one: empty answers",
    [T.dayGroups(clean, NaN), T.weekStrip(clean, NaN), T.weekHistory(clean, undefined), T.monthGrid(null), T.lastTrained(clean, "chest", NaN),
      T.daysSince(W, NaN), T.workoutsInWeek(clean, "soon"), T.weekStreak(clean, NaN), T.groupNudge(clean, NaN),
      T.dayOfWeek(NaN), T.pace(10, NaN), T.weekVolumeUntil(clean, NaN), T.lastWeekToDate(clean, "soon"), T.verdict(clean, undefined)],
    [[], [], [], [], 0, null, 0, 0, null, 0, 0, ZERO, ZERO, { on: [], onPace: [], behind: [], above: [] }]);
  // A big log: every tab's numbers at once stay quick (the browser budget is 50 ms).
  const big = [];
  for (let i = 0; i < 3000; i++) {
    const t = L(2024, 10, 1 + Math.floor(i / 4), 7 + (i % 4) * 3);
    big.push(i % 5 === 0 ? quick(t, { chest: 3, back: 2 }) : i % 11 === 0 ? weigh(t) : bw(t, M.KNOWN_IDS[i % 6], 1 + (i % 10), [10, 8, 6]));
  }
  const t0 = Date.now(), now = L(2026, 9, 30, 12);
  T.weekStrip(big, now); T.weekHistory(big, now); T.workoutsInWeek(big, now); T.totalWorkouts(big); T.weekStreak(big, now);
  T.groupNudge(big, now, [10, 20]); M.GROUPS.forEach(g => { T.breakdown(big, now, g); T.lastTrained(big, g, now); });
  T.verdict(big, now, [10, 20]); T.lastWeekToDate(big, now);
  flat(T.monthGrid(now)).forEach(c => T.dayGroups(big, c.ts));
  const ms = Date.now() - t0;
  check("3,000 entries: strip, history, streak, nudge, six groups and a month of dots in well under a second", ms < 1000, "took " + ms + " ms");
}

section("a zone whose clocks change mid-week (Asia/Jerusalem: Friday 27 Mar 2026)");
{
  // Rome and New York both switch early on a Sunday, which happens to hide
  // "count back 24 h per day" bugs in weekStart. Israel switches on a Friday.
  // Node picks up a new TZ at run time, inside the vm page too.
  const saved = process.env.TZ;
  process.env.TZ = "Asia/Jerusalem";
  if (new Date(2026, 2, 28, 12).getTimezoneOffset() !== -180 || new Date(2026, 2, 26, 12).getTimezoneOffset() !== -120) {
    console.log("  (this Node can't switch time zones while running — skipped)");
  } else {
    eq("Saturday after the switch → Monday 23 Mar 00:00", T.weekStart(L(2026, 3, 28, 12)), L(2026, 3, 23));
    eq("Sunday 23:59:59.999 → the same Monday", T.weekStart(L(2026, 3, 29, 23, 59, 59, 999)), L(2026, 3, 23));
    eq("addWeeks(+1) → Monday 30 Mar 00:00", T.addWeeks(L(2026, 3, 25), 1), L(2026, 3, 30));
    check("that week is 167 hours", (L(2026, 3, 30) - L(2026, 3, 23)) / HOUR === 167);
    const log = [bw(L(2026, 3, 23, 0, 30), "squat", 5, [20]), bw(L(2026, 3, 29, 23, 30), "squat", 5, [20]), bw(L(2026, 3, 30, 0, 30), "pushup", 5, [10])];
    eq("Monday 00:30 and Sunday 23:30 are one week…", T.weekVolume(log, L(2026, 3, 27, 12)), { chest: 0, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 2 });
    eq("…and the next Monday 00:30 is the next", T.weekVolume(log, L(2026, 3, 30)), { chest: 1, back: 0, shoulders: 0.5, arms: 0.5, abs: 0, legs: 0 });
    eq("label", T.weekLabel(L(2026, 3, 27, 12)), "23\u201329 Mar");
    const js = T.weekStrip(log, L(2026, 3, 28, 12));
    eq("week strip: the local midnights Monday 23 \u2192 Sunday 29 Mar", js.map(x => x.ts), range(7, i => L(2026, 3, 23 + i)));
    eq("…a dot on Monday; Saturday is today; Sunday is still ahead", js.map(x => [x.groups.length, x.today]),
      [[1, false], [0, false], [0, false], [0, false], [0, false], [0, true], [0, false]]);
    const jc = flat(T.monthGrid(L(2026, 3, 27, 12)));
    check("March's calendar: consecutive local midnights through the Friday switch",
      jc.length === 42 && jc.every((c, i) => c.ts === M.dateFromKey(c.key) && (!i || M.dayDelta(jc[i - 1].ts, c.ts) === 1)));
    const fri = jc.findIndex(c => c.key === "2026-03-27");
    check("…and Friday 27 Mar is 23 hours long", (jc[fri + 1].ts - jc[fri].ts) / HOUR === 23);
    eq("days since Thursday noon, on Saturday noon: 2", T.daysSince(L(2026, 3, 26, 12), L(2026, 3, 28, 12)), 2);
    eq("27 Feb + 1 month \u2192 27 Mar 00:00", T.addMonths(L(2026, 2, 27, 12), 1), L(2026, 3, 27));
    eq("streak from Monday 30 Mar: the switch week's 2 workouts", T.weekStreak(log, L(2026, 3, 30, 12)), 1);
  }
  if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
}

h.done(__filename);
