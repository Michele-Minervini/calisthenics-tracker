/* Weekly volume (training.js): which week a session belongs to, what each
   logged set counts for per muscle group, the weekly targets and the zones
   the home bars show. tests/run.sh runs this in Europe/Rome and
   America/New_York, whose daylight-saving switches fall on different
   Sundays — every DST week of 2026 in both places is checked below.
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

section("entries that count for nothing (yet)");
eq("gym entry → {} until P4 brings the catalogue",
  T.groupWeights({ id: "g1", ts: W, kind: "gym", exId: "bench_bb", sets: [8, 8], kg: [60, 60], note: "", mts: W }), {});
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
const WEEK = { chest: 11, back: 8, shoulders: 9.25, arms: 18.75, abs: 9, legs: 12 };
eq("21–27 Sep: quick logs + ladder sessions, boundaries included/excluded", T.weekVolume(week, L(2026, 9, 21)), WEEK);
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
  ["chest", 11, 10, 20, "on"],
  ["back", 8, 10, 20, "building"],
  ["shoulders", 9.25, 10, 20, "building"],
  ["arms", 18.75, 20, 40, "building"],
  ["abs", 9, 10, 20, "building"],
  ["legs", 12, 20, 40, "building"]
]);

section("showing set counts");
[[0, "0"], [0.25, "¼"], [0.5, "½"], [0.75, "¾"], [1, "1"], [9.25, "9¼"], [12.5, "12½"],
  [18.75, "18¾"], [20, "20"], [1.2, "1¼"], [1.3, "1¼"], [-2, "0"], [NaN, "0"]].forEach(([x, s]) =>
  eq(String(x) + " → \"" + s + "\"", T.fmtSets(x), s));

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
  }
  if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
}

h.done(__filename);
