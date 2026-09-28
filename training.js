/* ============================================================
   Milo — training logic.

   Turns the log into what the four tabs show: calendar weeks,
   hard sets per muscle group, the weekly target for each group
   and how far along it is (Today's bars, the Body radar and its
   cards), the pace an even week needs by today and Body's
   sentence built on it, "this point last week", the week strip
   and the month calendar with their group dots, workouts and the
   week streak (History), what counted for a group this week,
   which skills feed it, and the one nudge. And the gym: the
   exercises (the catalogue plus your own), which sets were
   warm-ups, e1RM, one exercise's history and best set, and the
   double-progression suggestion for its next session. Data only:
   the words the app shows are app.js's.

   Pure functions over plain values: no DOM, no storage, and no
   clock — whoever needs "this week" passes the time in — so
   tests/training-test.js runs them in Node. Every function takes
   any log (sanitized v5 entries of every kind, an empty log, or
   junk) without throwing.

   ONE piece of module state: the exercises registered with
   useExercises(state.exercises) — custom exercises and tweaks to
   built-in ones. Every gym lookup (exercise(), and through it what a
   gym entry counts for) reads it. The app calls useExercises()
   whenever its state changes; until then only the built-in
   exercises exist. Tests that register exercises must call it, and
   call useExercises([]) when they are done.

   Reads the tables in data.js (AREAS, GROUP_INFO, AREA_GROUPS,
   VARIATION_GROUPS, QUICK_GROUPS, GYM_EXERCISES) and the
   calendar-day helpers and sanitizeExercise in model.js, so it
   loads after both and before app.js.

   Dates: a week is Monday 00:00 to Sunday 23:59, local time. A
   day is the calendar day of an entry's ts (MODEL.dateStr), never
   its stored `date`. Days are stepped with MODEL.startOfDay /
   addDays and counted with dayDelta only — never by adding
   86400000 ms, which goes wrong in daylight-saving weeks (they
   are 167 or 169 hours long). Months are moved by the calendar
   (new Date(year, month + n, 1)), then days by addDays.

   Numbers: every weight is 1, ½ or ¼, so weekly totals are exact
   multiples of ¼ (floating point adds those without error). Zones
   are decided on the exact total; fmtSets() shows it as "9¾".
   Stored kg are multiples of 0.25 too, so the warm-up test and the
   suggestions compare exact values (see score()).
   ============================================================ */

var TRAINING = (function () {
  "use strict";

  var BUILD = "milo-v20";

  var GROUPS = MODEL.GROUPS;
  var startOfDay = MODEL.startOfDay;
  var addDays = MODEL.addDays;
  var dayDelta = MODEL.dayDelta;
  var dateStr = MODEL.dateStr;
  var isTraining = MODEL.isTraining;

  // Captured once: if data.js is from an older release these are
  // missing, this file fails to load, and app.js's build check shows
  // "finishing an update" instead of wrong numbers.
  var AREA_LIST = AREAS;
  var INFO = GROUP_INFO;
  var BY_AREA = AREA_GROUPS;
  var BY_VARIATION = VARIATION_GROUPS;
  var BY_QUICK = QUICK_GROUPS;
  var CATALOGUE = GYM_EXERCISES;

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  var ZONES = ["none", "low", "building", "on", "above"];
  var ZONE_LABELS = { none: "Not trained", low: "Low", building: "Building", on: "On target", above: "Above target" };

  /* ---------- Thresholds the tabs use ---------- */
  // Named so the explanations in the app and the tests use the same numbers.

  // A group gets its dot on a day, and counts as trained that day, once
  // that day's entries add up to 1 hard set for it. (A quick log's ¼ for
  // the helper groups alone isn't one.)
  var DOT_SETS = 1;
  // A week keeps the week streak going with this many workouts (days).
  var STREAK_WORKOUTS = 2;
  // weekHistory() gives this many weeks unless asked for another number,
  // and never more than MAX_HISTORY_WEEKS.
  var HISTORY_WEEKS = 8;
  var MAX_HISTORY_WEEKS = 104;
  // Nudge "untrained": a group with no hard set for this many days.
  var UNTRAINED_DAYS = 8;
  // …and a group never trained at all is only mentioned from this many
  // workouts on, so a new log isn't nagged about what it hasn't reached.
  var NEWCOMER_WORKOUTS = 3;
  // Nudge "behind": from Thursday (Monday = 0), a group below this share
  // of the bottom of its target range.
  var BEHIND_FROM_DAY = 3;
  var BEHIND_SHARE = 0.5;
  // Zones: "building" from this share of the bottom of the range (below
  // it, "low"). For the ⓘ's zone table: Low below lo × BUILDING_SHARE.
  var BUILDING_SHARE = 0.5;
  // The Body radar: each axis is sets ÷ the top of that group's range,
  // drawn up to this far. 1: the outer ring is the top of the target, and
  // more than that sits on it.
  var RADAR_MAX = 1;

  // The gym (see "The gym" below).
  // What kg means for an exercise (data.js, GYM_EXERCISES `load`).
  var LOADS = ["ext", "added", "assist", "bw"];
  // One hard set of an exercise counts 1 for its group and this for each
  // group it helps.
  var HELPER_WEIGHT = 0.5;
  // Warm-ups: a set of a loaded exercise is a working set when its e1RM is
  // at least this share of the entry's best set (compared exactly, as
  // 5 × e1RM ≥ 4 × best).
  var WARMUP_SHARE = 0.8;
  // Epley counts reps up to this many.
  var EPLEY_MAX_REPS = 20;
  // Double progression: more than this many calendar days since the last
  // session starts lighter ("return").
  var RETURN_DAYS = 42;
  // "return" and "deload" go to this share of the weight (rounded down to
  // the step), or add the other 10 % of help on an assisted machine.
  var BACKOFF = 0.9;
  // A step up bigger than this share of the weight aims BIG_JUMP_REPS
  // lower than the bottom of the range.
  var BIG_JUMP = 0.1;
  var BIG_JUMP_REPS = 2;
  // Sets a suggestion asks for: the last session's working sets, this
  // many the first time, never more than MAX_SETS.
  var DEFAULT_SETS = 3;
  var MAX_SETS = 10;

  // The largest ms a Date can hold.
  var MAX_TIME = 8.64e15;

  /* ---------- Small helpers ---------- */

  // Names in the log are checked by format only, so a variant called
  // "constructor" is possible: look things up by own keys only.
  function own(obj, key) {
    return !!obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
  }

  // A fresh { group: weight } in GROUPS order, keeping only real groups
  // with a positive weight. Callers can change it freely: data.js's
  // tables are never handed out.
  function cleanWeights(map) {
    var out = {};
    GROUPS.forEach(function (g) {
      var w = own(map, g) ? Number(map[g]) : 0;
      if (isFinite(w) && w > 0) out[g] = w;
    });
    return out;
  }

  // Adds n × weights into acc (both { group: number }).
  function addInto(acc, weights, n) {
    GROUPS.forEach(function (g) {
      if (own(weights, g)) acc[g] = (acc[g] || 0) + weights[g] * n;
    });
    return acc;
  }

  function zeros() {
    var o = {};
    GROUPS.forEach(function (g) { o[g] = 0; });
    return o;
  }

  // Nearest ¼. Totals are exact already; this only guards the output
  // against a future weight that isn't a quarter.
  function quarter(x) { return Math.round(x * 4) / 4; }

  // One of the six group names (never an inherited name like "constructor").
  function isGroup(g) { return GROUPS.indexOf(g) !== -1; }

  // A lookup table keyed by data: no inherited keys at all.
  function dict() { return Object.create(null); }

  // A time a Date can hold (a number, or a Date).
  function validTime(ts) {
    if (ts === null || ts === undefined || ts === "") return false;
    var t = Number(ts);
    return isFinite(t) && Math.abs(t) <= MAX_TIME;
  }

  // An entry's ts, or NaN when it isn't an entry with a usable time.
  function timeOf(e) {
    if (!e || typeof e !== "object") return NaN;
    var t = Number(e.ts);
    return (t > 0 && t <= MAX_TIME) ? t : NaN;
  }

  // Local midnight starting the day containing ts, and the next one, as ms.
  function dayStart(ts) { return startOfDay(ts).getTime(); }
  function nextDay(ts) { return addDays(startOfDay(ts), 1).getTime(); }

  // The entries with from ≤ ts < to, in log order.
  function between(log, from, to) {
    if (!Array.isArray(log)) return [];
    return log.filter(function (e) {
      var t = timeOf(e);
      return t >= from && t < to;
    });
  }

  // Hard sets per group that some entries add up to: all six keys.
  function totals(entries) {
    var acc = zeros();
    entries.forEach(function (e) { addInto(acc, groupWeights(e), 1); });
    GROUPS.forEach(function (g) { acc[g] = quarter(acc[g]); });
    return acc;
  }

  // The groups those entries give at least DOT_SETS hard sets, in GROUPS order.
  function dotted(entries) {
    var acc = totals(entries);
    return GROUPS.filter(function (g) { return acc[g] >= DOT_SETS; });
  }

  /* ---------- Weeks ---------- */

  // Monday 00:00 local time of the week containing ts, as ms.
  function weekStart(ts) {
    var d = startOfDay(ts);
    return addDays(d, -((d.getDay() + 6) % 7)).getTime();
  }

  // Monday 00:00 of the week n weeks after (before, if negative) the one containing ts.
  function addWeeks(ts, n) {
    return addDays(new Date(weekStart(ts)), 7 * n).getTime();
  }

  // "21–27 Sep", "28 Sep – 4 Oct", "28 Dec 2026 – 3 Jan 2027". Plain text.
  // short: leave the years out even across New Year ("28 Dec – 3 Jan"),
  // for places too narrow for the full form.
  function weekLabel(ts, short) {
    var a = new Date(weekStart(ts));
    var b = addDays(a, 6);
    var am = MONTHS[a.getMonth()], bm = MONTHS[b.getMonth()];
    if (a.getFullYear() !== b.getFullYear() && !short) {
      return a.getDate() + " " + am + " " + a.getFullYear() + " \u2013 " + b.getDate() + " " + bm + " " + b.getFullYear();
    }
    if (a.getMonth() !== b.getMonth()) return a.getDate() + " " + am + " \u2013 " + b.getDate() + " " + bm;
    return a.getDate() + "\u2013" + b.getDate() + " " + am;
  }

  // The entries logged in the week containing ts, in log order.
  function inWeek(log, ts) {
    if (!Array.isArray(log)) return [];
    var from = weekStart(ts), to = addWeeks(from, 1);
    return log.filter(function (e) {
      if (!e || typeof e !== "object") return false;
      var t = Number(e.ts);
      return t >= from && t < to;
    });
  }

  /* ---------- What one entry counts for ---------- */

  // What one hard set of a ladder exercise counts for: the variation's
  // own map if it has one, else the step's override, else the area's.
  // Unknown areas count for nothing; unknown variations count as the step.
  function setWeights(areaId, step, variant) {
    if (!own(BY_AREA, areaId)) return {};
    var area = BY_AREA[areaId];
    var vars = own(BY_VARIATION, areaId) ? BY_VARIATION[areaId] : null;
    if (typeof variant === "string" && variant && own(vars, variant) && vars[variant] !== "step") {
      return cleanWeights(vars[variant]);
    }
    var s = Math.round(Number(step));
    if (own(area.step, String(s))) return cleanWeights(area.step[s]);
    return cleanWeights(area.all);
  }

  // Hard sets in a ladder entry: every set or hold with a value above 0.
  // (The app only saves positive values; a 0 in an old or restored
  // entry is a failed attempt and counts for nothing.)
  // In a gym entry: its working sets (workingSets(): warm-ups and sets of
  // 0 reps left out).
  function hardSets(e) {
    if (!e || !Array.isArray(e.sets)) return 0;
    if (e.kind === "gym") return workingSets(e).filter(Boolean).length;
    var n = 0;
    e.sets.forEach(function (x) { var v = Number(x); if (isFinite(v) && v > 0) n++; });
    return n;
  }

  // The lines of a quick log that count, in GROUPS order: one per group it
  // lists with a whole number of sets above 0.
  //   [{ group, sets, weights }]   weights: QUICK_GROUPS[group], cleaned
  // groupWeights() adds these up and breakdown() lists them, so the two
  // can't disagree.
  function quickLines(e) {
    var out = [];
    if (!e || typeof e !== "object" || e.kind !== "quick" || !e.groups || typeof e.groups !== "object") return out;
    GROUPS.forEach(function (g) {
      if (!own(e.groups, g) || !own(BY_QUICK, g)) return;
      var sets = Math.round(Number(e.groups[g]));
      if (isFinite(sets) && sets > 0) out.push({ group: g, sets: sets, weights: cleanWeights(BY_QUICK[g]) });
    });
    return out;
  }

  // What a gym entry counts for: { sets, weights } — its working sets, and
  // one set's worth per group (exWeights) — or null when it counts for
  // nothing: not a gym entry, an exercise nobody knows (it can't be
  // counted), or no working set. groupWeights() adds it up and
  // breakdown() lists it, so the two can't disagree.
  function gymLine(e) {
    if (!e || typeof e !== "object" || e.kind !== "gym") return null;
    var ex = exRec(e.exId);
    if (!ex) return null;
    var n = hardSets(e);
    return n ? { sets: n, weights: exWeights(ex) } : null;
  }

  // What one log entry adds to the week, in hard sets per group:
  // { group: sets }, groups in GROUPS order, zeros left out.
  //   ladder  hardSets × setWeights(area, step, variant)
  //   quick   n sets of a group → n × QUICK_GROUPS[group]
  //   gym     working sets × { its group: 1, each group it helps: ½ }
  //           (warm-ups and 0-rep sets left out); an exercise nobody
  //           knows (not built in, not registered) counts for nothing.
  //           A deleted exercise of your own still counts.
  //   body    a weigh-in: nothing, ever
  function groupWeights(e) {
    if (!e || typeof e !== "object") return {};
    var acc = {};
    if (e.kind === undefined) {
      var n = hardSets(e);
      if (n) addInto(acc, setWeights(e.areaId, e.step, e.variant), n);
    } else if (e.kind === "gym") {
      var g = gymLine(e);
      if (g) addInto(acc, g.weights, g.sets);
    } else {
      quickLines(e).forEach(function (q) { addInto(acc, q.weights, q.sets); });
    }
    return cleanWeights(acc);
  }

  /* ---------- A week's volume ---------- */

  // Hard sets per group for the week containing ts (any moment of it):
  // { chest, back, shoulders, arms, abs, legs }, all six keys, exact to ¼.
  function weekVolume(log, ts) {
    var acc = zeros();
    inWeek(log, ts).forEach(function (e) { addInto(acc, groupWeights(e), 1); });
    GROUPS.forEach(function (g) { acc[g] = quarter(acc[g]); });
    return acc;
  }

  // The same, but only from the week's Monday 00:00 up to the end of the
  // calendar day containing ts (the rest of the week left out). All six
  // keys, exact to ¼; six zeros for a ts that isn't a time.
  function weekVolumeUntil(log, ts) {
    if (!validTime(ts)) return zeros();
    return totals(between(log, weekStart(ts), nextDay(ts)));
  }

  // "This point last week": last week from its Monday 00:00 to the end of
  // the same weekday as now (a Wednesday is compared with a Wednesday,
  // whatever the hour). For "+2 vs this point last week" (this week's
  // weekVolume minus this) and the Body radar's dashed shape. The day is
  // found by the calendar, 7 days back, so a daylight-saving week (167 or
  // 169 hours) moves nothing.
  function lastWeekToDate(log, now) {
    if (!validTime(now)) return zeros();
    return weekVolumeUntil(log, addDays(startOfDay(now), -7).getTime());
  }

  /* ---------- Targets and zones ---------- */

  // The base weekly range from settings, or the default if it isn't one.
  function baseVol(vol) {
    if (Array.isArray(vol) && vol.length === 2) {
      var lo = Number(vol[0]), hi = Number(vol[1]);
      if (isFinite(lo) && isFinite(hi) && lo >= 1 && lo <= hi) return [lo, hi];
    }
    return MODEL.defaultSettings().vol;
  }

  function scaleOf(g) {
    var s = own(INFO, g) ? Number(INFO[g].scale) : 1;
    return (isFinite(s) && s > 0) ? s : 1;
  }

  // { group: [lo, hi] } — the base range (state.settings.vol) times each
  // group's scale: [10, 20] gives arms and legs [20, 40].
  function targets(vol) {
    var b = baseVol(vol), out = {};
    GROUPS.forEach(function (g) { var s = scaleOf(g); out[g] = [b[0] * s, b[1] * s]; });
    return out;
  }

  // Where n hard sets stand against the range lo–hi:
  //   "none"      0 (or nothing readable)
  //   "low"       above 0, below lo/2 (lo × BUILDING_SHARE)
  //   "building"  lo/2 up to, not including, lo
  //   "on"        lo to hi, both included
  //   "above"     above hi
  function zone(n, lo, hi) {
    n = Number(n);
    if (!(n > 0)) return "none";
    if (n < lo * BUILDING_SHARE) return "low";
    if (n < lo) return "building";
    if (n <= hi) return "on";
    return "above";
  }

  /* ---------- Pace ---------- */

  // Which day of its week now is: Monday 1 … Sunday 7 ("day 3 of 7").
  // 0 for a time that isn't one.
  function dayOfWeek(now) {
    if (!validTime(now)) return 0;
    var d = dayDelta(weekStart(now), now) + 1;
    return d >= 1 && d <= 7 ? d : 0;
  }

  // The sets an even pace needs by the end of today: lo × dayOfWeek(now) ÷ 7,
  // not rounded (Wednesday, lo 10: 4.2857…; the ▴ sits there). 0 for a
  // time or lo that isn't one.
  function pace(lo, now) {
    var l = Number(lo);
    if (!(l > 0) || !isFinite(l)) return 0;
    return l * dayOfWeek(now) / 7;
  }

  // Where n sets stand this week, with the pace:
  //   "none"    0 (or nothing readable)    "None this week"
  //   "behind"  above 0, below pace()      "… · behind pace"
  //   "onpace"  pace() or more, below lo   "… · on pace"
  //   "on"      lo to hi                   "On target"
  //   "above"   above hi                   "Above target"
  // "none", "on" and "above" are exactly zone()'s; "behind" and "onpace"
  // split its "low" and "building". Pace is never 0 (today counts: Monday
  // already expects lo/7), so for pace "none" is behind too; verdict()
  // lists it there. Compared as n × 7 ≥ lo × day, exactly: sets are
  // quarters and lo a whole number, so there is no rounding at the edge.
  function paceZone(sets, lo, hi, now) {
    var n = Number(sets), z = zone(n, lo, hi);
    if (z === "none" || z === "on" || z === "above") return z;
    return n * 7 >= Number(lo) * dayOfWeek(now) ? "onpace" : "behind";
  }

  // Everything the six weekly bars need, one row per group in GROUPS order.
  function weekSummary(log, ts, vol) {
    var sets = weekVolume(log, ts), t = targets(vol);
    return GROUPS.map(function (g) {
      return { group: g, sets: sets[g], lo: t[g][0], hi: t[g][1], zone: zone(sets[g], t[g][0], t[g][1]) };
    });
  }

  // Body's one sentence ("On target: Back. On pace: Chest, Shoulders.
  // Behind: Legs, Abs, Arms."): the six groups of the week containing now,
  // by paceZone():
  //   on      "on" and "above": on target, or past it (GROUPS order)
  //   onPace  "onpace" (GROUPS order)
  //   behind  "behind" and "none", furthest behind first: by sets ÷ lo,
  //           lowest first, ties in GROUPS order
  //   above   the groups of `on` that are past the top ("above"), GROUPS
  //           order: a subset of `on`, for anyone who wants to say so
  // Every group is in exactly one of on, onPace and behind. The sets are
  // the whole week's (weekVolume, the bars' numbers). All four empty for a
  // time that isn't one.
  function verdict(log, now, vol) {
    var out = { on: [], onPace: [], behind: [], above: [] };
    if (!validTime(now)) return out;
    var sets = weekVolume(log, now), t = targets(vol);
    GROUPS.forEach(function (g) {
      var z = paceZone(sets[g], t[g][0], t[g][1], now);
      if (z === "on" || z === "above") out.on.push(g);
      if (z === "above") out.above.push(g);
      if (z === "onpace") out.onPace.push(g);
      if (z === "behind" || z === "none") out.behind.push(g);
    });
    out.behind.sort(function (a, b) {
      return (sets[a] / t[a][0] - sets[b] / t[b][0]) || (GROUPS.indexOf(a) - GROUPS.indexOf(b));
    });
    return out;
  }

  // The weekly sets of the last n weeks, oldest first, this week last:
  //   [{ start: Monday 00:00 (ms), label: weekLabel(start, true), sets: weekVolume }]
  // The same numbers as the bars for each week (a whole week each, as
  // weekVolume counts it). For the group sheet's 8-week bars. (The Body
  // radar's ghost is lastWeekToDate(), not a whole week.)
  // n: 1–MAX_HISTORY_WEEKS; anything that isn't a number gives HISTORY_WEEKS.
  function weekHistory(log, now, n) {
    if (!validTime(now)) return [];
    var k = (n === null || n === undefined || n === "") ? NaN : Math.round(Number(n));
    if (!isFinite(k)) k = HISTORY_WEEKS;
    k = Math.max(1, Math.min(MAX_HISTORY_WEEKS, k));
    var cur = weekStart(now), out = [];
    for (var i = k - 1; i >= 0; i--) {
      var s = addWeeks(cur, -i);
      out.push({ start: s, label: weekLabel(s, true), sets: weekVolume(log, s) });
    }
    return out;
  }

  /* ---------- One group ---------- */

  // Hard sets entry e adds to one group: groupWeights(e)[group], exact
  // to ¼, 0 when it adds nothing or the group isn't one of the six.
  function contribution(e, group) {
    if (!isGroup(group)) return 0;
    var w = groupWeights(e);
    return own(w, group) ? w[group] : 0;
  }

  // "What counted" for a group in the week containing now: one row per
  // source, newest first.
  //   [{ entry, sets, weight, own, listed, logged }]
  //   entry   the log's own object (don't change it)
  //   sets    what the row adds to the group: logged × weight. All rows
  //           together add up exactly to the group's bar (weekVolume).
  //   weight  what one set of it counts here: 1 or ½ for a skill set
  //           (setWeights, the variation's own map when it has one) or a
  //           gym exercise (1 for its group, ½ for a group it helps), 1 or
  //           ¼ for a quick log's line
  //   own     true when the sets were for this group itself (weight 1: the
  //           group the exercise is for, or the quick log's line for it);
  //           false when they only helped ("6 chest sets, helping")
  //   listed  a quick log's line: the group it was logged for ("chest");
  //           null for a skill or gym entry
  //   logged  the sets that were logged: a skill entry's hard sets, a gym
  //           entry's working sets (warm-ups left out), or the number on
  //           the quick log's line
  // A skill or gym entry is one row. A quick log is one row per group it
  // lists that counts here (NOTES "Notes for building P3" 2): one listing
  // chest 6 and shoulders 4 gives Shoulders two rows, 4 at 1 and 6 at ¼.
  // Rows of one quick log come own line first, then GROUPS order. Newest
  // first by ts; entries at the same ts, the later in the log first. Whole
  // week, like weekVolume; entries that add nothing (weigh-ins, gym
  // exercises nobody knows or with no working set) aren't listed.
  function breakdown(log, now, group) {
    if (!isGroup(group)) return [];
    var rows = [];
    inWeek(log, now).forEach(function (e, i) {
      if (e.kind === undefined) {
        var n = hardSets(e), w = setWeights(e.areaId, e.step, e.variant);
        if (n && own(w, group)) rows.push({ entry: e, sets: n * w[group], weight: w[group], own: w[group] >= 1, listed: null, logged: n, i: i, k: 0 });
        return;
      }
      if (e.kind === "gym") {
        var g = gymLine(e);
        if (g && own(g.weights, group)) {
          rows.push({ entry: e, sets: g.sets * g.weights[group], weight: g.weights[group], own: g.weights[group] >= 1, listed: null, logged: g.sets, i: i, k: 0 });
        }
        return;
      }
      quickLines(e).forEach(function (q) {
        if (!own(q.weights, group)) return;
        rows.push({
          entry: e, sets: q.sets * q.weights[group], weight: q.weights[group], own: q.group === group,
          listed: q.group, logged: q.sets, i: i, k: q.group === group ? 0 : 1 + GROUPS.indexOf(q.group)
        });
      });
    });
    rows.sort(function (a, b) { return (Number(b.entry.ts) - Number(a.entry.ts)) || (b.i - a.i) || (a.k - b.k); });
    return rows.map(function (r) {
      return { entry: r.entry, sets: r.sets, weight: r.weight, own: r.own, listed: r.listed, logged: r.logged };
    });
  }

  function areaById(id) {
    for (var i = 0; i < AREA_LIST.length; i++) if (AREA_LIST[i] && AREA_LIST[i].id === id) return AREA_LIST[i];
    return null;
  }
  function stepCount(a) { return (a && Array.isArray(a.steps)) ? a.steps.length : 0; }

  // The skill areas that train a group at one step or more (without a
  // variation), in AREAS order: feeders("shoulders") → pushup, bridge, hspu.
  function feeders(group) {
    if (!isGroup(group)) return [];
    return AREA_LIST.filter(function (a) {
      for (var s = 1; s <= stepCount(a); s++) if (own(setWeights(a.id, s, ""), group)) return true;
      return false;
    }).map(function (a) { return a.id; });
  }

  // Whether a group is an area's main job: its whole-area map counts a set
  // 1 for it (AREA_GROUPS[area].all[group] ≥ 1), whatever a step override
  // says. Bridges' step 1 gives legs 1, but legs isn't bridges' main job.
  function isMain(areaId, group) {
    if (!isGroup(group) || !own(BY_AREA, areaId)) return false;
    var all = BY_AREA[areaId].all;
    return own(all, group) && Number(all[group]) >= 1;
  }

  // The feeders whose main job is the group, in AREAS order: chest →
  // pushup; back → pullup, bridge; shoulders → hspu; arms → none (the
  // Body row then says "Helped by …": feedersAt()'s rows with a weight);
  // abs → legraise; legs → squat.
  function mainFeeders(group) {
    return feeders(group).filter(function (id) { return isMain(id, group); });
  }

  // The step an area is on, from { areaId: step } or state.areas
  // ({ areaId: { step } }); a missing or impossible step is step 1.
  function stepOf(stepsByArea, id) {
    var v = own(stepsByArea, id) ? stepsByArea[id] : null;
    if (v && typeof v === "object") v = own(v, "step") ? v.step : null;
    var s = (v === null || v === undefined || typeof v === "boolean") ? NaN : Math.round(Number(v));
    return (s >= 1 && s <= stepCount(areaById(id))) ? s : 1;
  }

  // One set's worth for a group at an area's step (no variation): 1, ½ or 0.
  function weightAt(id, step, group) {
    var w = setWeights(id, step, "");
    return own(w, group) ? w[group] : 0;
  }

  // The feeders at the steps they're on now:
  //   [{ areaId, step, weight, main, fromStep, fromWeight }]
  //   weight      one set's worth for the group at that step: 1, ½, or 0
  //               when that step doesn't train it (bridges step 2 for
  //               shoulders; handstands step 5 for abs)
  //   main        the group is the area's main job (see isMain)
  //   fromStep    the first later step at which one set counts for more
  //               than now ("from step 3"; for a 0, the step it starts
  //               counting at), and fromWeight what it counts there; both
  //               null when no later step counts more (handstands for abs
  //               past step 3: it never will again)
  // Main job first, then heaviest at the current step, then AREAS order.
  // stepsByArea as for stepOf(). Every feeder is listed, 0s included.
  function feedersAt(group, stepsByArea) {
    return feeders(group).map(function (id, i) {
      var s = stepOf(stepsByArea, id), wt = weightAt(id, s, group), next = null;
      for (var k = s + 1; k <= stepCount(areaById(id)) && !next; k++) {
        var w2 = weightAt(id, k, group);
        if (w2 > wt) next = { step: k, weight: w2 };
      }
      return { areaId: id, step: s, weight: wt, main: isMain(id, group), next: next, i: i };
    }).sort(function (x, y) { return (y.main - x.main) || (y.weight - x.weight) || (x.i - y.i); })
      .map(function (r) {
        return {
          areaId: r.areaId, step: r.step, weight: r.weight, main: r.main,
          fromStep: r.next ? r.next.step : null, fromWeight: r.next ? r.next.weight : null
        };
      });
  }

  // For the nudge's last sentence ("Today's session starts with squats" /
  // "includes …"): the first area of a session (area ids in session order,
  // e.g. app.js's todaysMovements()) whose set counts 1 for the group at
  // its step, and its place in the session — { areaId, index }, index 0
  // meaning the session starts with it — or null when none does.
  // stepsByArea as for stepOf(). Whether the session is done is the app's.
  function sessionFeeder(group, areaIds, stepsByArea) {
    if (!isGroup(group) || !Array.isArray(areaIds)) return null;
    for (var i = 0; i < areaIds.length; i++) {
      var id = areaIds[i];
      if (typeof id !== "string" || !areaById(id)) continue;
      if (weightAt(id, stepOf(stepsByArea, id), group) >= 1) return { areaId: id, index: i };
    }
    return null;
  }

  // For each group, the ts of the last time it was trained, at or before
  // now: the latest day whose entries (at or before now) add up to
  // DOT_SETS hard sets for it — the day its dot shows — and on that day
  // the latest entry that added to it. 0 when never.
  function lastTrainedAll(log, now) {
    var out = {}, days = dict(), end = validTime(now) ? Number(now) : NaN;
    GROUPS.forEach(function (g) { out[g] = 0; });
    if (!Array.isArray(log)) return out;
    log.forEach(function (e) {
      var t = timeOf(e);
      if (!(t <= end)) return;
      var w = groupWeights(e), key = null;
      GROUPS.forEach(function (g) {
        if (!own(w, g)) return;
        key = key || dateStr(t);
        var d = days[g + " " + key] || (days[g + " " + key] = { g: g, sets: 0, last: 0 });
        d.sets += w[g];
        if (t > d.last) d.last = t;
      });
    });
    Object.keys(days).forEach(function (k) {
      var d = days[k];
      if (quarter(d.sets) >= DOT_SETS && d.last > out[d.g]) out[d.g] = d.last;
    });
    return out;
  }
  function lastTrained(log, group, now) {
    return isGroup(group) ? lastTrainedAll(log, now)[group] : 0;
  }

  // Whole calendar days from ts to now: 0 today (or for a later ts),
  // 1 yesterday. null when there's no ts (never).
  function daysSince(ts, now) {
    var t = Number(ts);
    if (!(t > 0 && t <= MAX_TIME) || !validTime(now)) return null;
    return Math.max(0, dayDelta(t, now));
  }

  /* ---------- Days: the week strip and dots ---------- */

  // The groups that got at least DOT_SETS hard sets on the calendar day
  // containing ts (all of that day's entries together), in GROUPS order.
  // A quick log of 2 chest sets gives chest; its ½ for arms and shoulders
  // doesn't, unless something else that day adds the other ½.
  function dayGroups(log, ts) {
    if (!validTime(ts)) return [];
    return dotted(between(log, dayStart(ts), nextDay(ts)));
  }

  // The seven days, Monday first, of the week containing now:
  //   [{ key "YYYY-MM-DD", ts (local midnight), dow 0–6 (Monday 0),
  //      groups (dayGroups), trained, today, future }]
  // trained: the day is a workout (see below). A day after today
  // (future) shows nothing even if something is logged on it; today
  // shows everything logged on it.
  function weekStrip(log, now) {
    if (!validTime(now)) return [];
    var mon = new Date(weekStart(now)), today = dayStart(now);
    var week = between(log, mon.getTime(), addWeeks(mon.getTime(), 1));
    var out = [];
    for (var i = 0; i < 7; i++) {
      var t = addDays(mon, i).getTime();
      var that = t > today ? [] : between(week, t, addDays(mon, i + 1).getTime());
      out.push({
        key: dateStr(t), ts: t, dow: i,
        groups: dotted(that),
        trained: that.some(isTraining),
        today: t === today,
        future: t > today
      });
    }
    return out;
  }

  /* ---------- Workouts and the week streak ---------- */

  // A workout is a calendar day with at least one training entry
  // (MODEL.isTraining: a skill session, a gym exercise or a quick log —
  // a weigh-in isn't training). Two sessions on one day: one workout.

  // { "YYYY-MM-DD": that day's midnight } for the workout days before
  // `until` (ms; left out: every day).
  function workoutDayMap(log, until) {
    var days = dict(), end = until === undefined ? Infinity : Number(until);
    if (!Array.isArray(log)) return days;
    log.forEach(function (e) {
      var t = timeOf(e);
      if (!(t < end) || !isTraining(e)) return;
      var k = dateStr(t);
      if (!(k in days)) days[k] = dayStart(t);
    });
    return days;
  }

  // Every workout day in the log, oldest first, as "YYYY-MM-DD".
  function workoutDays(log) {
    var days = workoutDayMap(log);
    return Object.keys(days).sort(function (a, b) { return days[a] - days[b]; });
  }

  // Workouts in the week containing now, up to and including today.
  function workoutsInWeek(log, now) {
    if (!validTime(now)) return 0;
    var from = weekStart(now), days = workoutDayMap(log, nextDay(now));
    return Object.keys(days).filter(function (k) { return days[k] >= from; }).length;
  }

  // Every workout in the log (days after today included: they are logged).
  function totalWorkouts(log) {
    return Object.keys(workoutDayMap(log)).length;
  }

  // Weeks in a row (Monday–Sunday) with at least STREAK_WORKOUTS workouts,
  // ending with this week. This week counts once it has them; until then
  // it doesn't break the streak, which is counted from last week. Days
  // after today don't count.
  function weekStreak(log, now) {
    if (!validTime(now)) return 0;
    var days = workoutDayMap(log, nextDay(now)), perWeek = dict();
    Object.keys(days).forEach(function (k) {
      var w = weekStart(days[k]);
      perWeek[w] = (perWeek[w] || 0) + 1;
    });
    var w = weekStart(now), n = 0;
    if (!((perWeek[w] || 0) >= STREAK_WORKOUTS)) w = addWeeks(w, -1);
    // Each step goes back one week; weeks without enough workouts end it.
    while ((perWeek[w] || 0) >= STREAK_WORKOUTS) { n++; w = addWeeks(w, -1); }
    return n;
  }

  /* ---------- Months: the History calendar ---------- */

  // Local midnight of the 1st of the month containing ts, as a Date.
  function firstOfMonth(ts) {
    var d = startOfDay(ts);
    return addDays(d, 1 - d.getDate());
  }

  // The month containing ts, as calendar rows of 7 days, Monday first,
  // with the days of the months before and after that complete the
  // first and last rows (4 to 6 rows):
  //   [[{ key "YYYY-MM-DD", ts (local midnight), day 1–31, inMonth }, …7], …]
  function monthGrid(ts) {
    if (!validTime(ts)) return [];
    var first = firstOfMonth(Number(ts)), month = first.getMonth();
    var start = addDays(first, -((first.getDay() + 6) % 7));
    var rows = [];
    for (var r = 0; r < 6; r++) {
      if (r && addDays(start, 7 * r).getMonth() !== month) break;
      var row = [];
      for (var c = 0; c < 7; c++) {
        var d = addDays(start, 7 * r + c);
        row.push({ key: dateStr(d.getTime()), ts: d.getTime(), day: d.getDate(), inMonth: d.getMonth() === month });
      }
      rows.push(row);
    }
    return rows;
  }

  // "September 2026". "" for a time that isn't one.
  function monthLabel(ts) {
    if (!validTime(ts)) return "";
    var d = new Date(Number(ts));
    return MONTH_NAMES[d.getMonth()] + " " + d.getFullYear();
  }

  // Local midnight of the same day n months later (earlier when n < 0),
  // the day clamped to the month's length: 31 Jan + 1 → 28 Feb (29 in a
  // leap year). n is rounded; NaN for a ts that isn't a time.
  function addMonths(ts, n) {
    if (!validTime(ts)) return NaN;
    var d = startOfDay(Number(ts)), k = Math.round(Number(n));
    if (!isFinite(k)) k = 0;
    var first = startOfDay(new Date(d.getFullYear(), d.getMonth() + k, 1).getTime());
    var len = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return addDays(first, Math.min(d.getDate(), len) - 1).getTime();
  }

  /* ---------- The nudge ---------- */

  // At most one nudge about the muscle groups, or null:
  //   { group, kind: "untrained", days, sets, lo }
  //       a group with no hard set for UNTRAINED_DAYS days or more (see
  //       lastTrained); the longest wins. days is null for a group never
  //       trained, which outranks any number of days — and is only
  //       mentioned once the log has NEWCOMER_WORKOUTS workouts.
  //   { group, kind: "behind", sets, lo, daysLeft }
  //       otherwise, from Thursday: a group under BEHIND_SHARE of the
  //       bottom of its range this week; the lowest sets ÷ lo wins.
  //       daysLeft counts today (Thursday 4, Sunday 1).
  // sets and lo: the group's sets this week (weekVolume, the bar's
  // number) and the bottom of its range, for "x of lo sets so far this
  // week". Ties go to GROUPS order. Nothing before the first workout, and
  // nothing logged after now makes a group trained.
  function groupNudge(log, now, vol) {
    if (!validTime(now)) return null;
    var workouts = Object.keys(workoutDayMap(log, nextDay(now))).length;
    if (!workouts) return null;
    var last = lastTrainedAll(log, now), pick = null;
    var sets = weekVolume(log, now), t = targets(vol);
    GROUPS.forEach(function (g) {
      var d = daysSince(last[g], now);
      if (d === null ? workouts < NEWCOMER_WORKOUTS : d < UNTRAINED_DAYS) return;
      if (!pick || (pick.days !== null && (d === null || d > pick.days))) pick = { group: g, kind: "untrained", days: d, sets: sets[g], lo: t[g][0] };
    });
    if (pick) return pick;
    var dow = dayDelta(weekStart(now), now);
    if (!(dow >= BEHIND_FROM_DAY)) return null;
    var low = null;
    GROUPS.forEach(function (g) {
      var lo = t[g][0], share = sets[g] / lo;
      if (!(sets[g] < lo * BEHIND_SHARE)) return;
      if (!low || share < low.share) low = { group: g, share: share, sets: sets[g], lo: lo };
    });
    return low ? { group: low.group, kind: "behind", sets: low.sets, lo: low.lo, daysLeft: 7 - dow } : null;
  }

  /* ---------- The Body radar ---------- */

  // One axis: sets ÷ the top of the group's range, capped at RADAR_MAX (1:
  // the outer ring is the top of the target, and more sits on it); 0 for
  // nothing (or a range that isn't one). The band is [lo ÷ hi, 1]; the
  // dashed ghost is radarShare(lastWeekToDate(…)[g], hi).
  function radarShare(sets, hi) {
    var s = Number(sets), h = Number(hi);
    if (!(s > 0) || !(h > 0)) return 0;
    return Math.min(RADAR_MAX, s / h);
  }

  /* ---------- The gym: exercises ---------- */

  // The catalogue by id: permanent ids (data.js), looked up by own key.
  var BUILT_IN = dict();
  CATALOGUE.forEach(function (x) { if (x && typeof x.id === "string") BUILT_IN[x.id] = x; });

  // THE ONE PIECE OF MODULE STATE: every exercise that resolves, by id —
  // the built-in ones merged with their tweaks, and your own. Replaced
  // whole by useExercises(); never changed in place.
  var resolved = dict();

  // A built-in exercise with its tweak (or null), as exercise() hands it out.
  function resolveBuiltIn(b, o) {
    var range = o && o.lo !== null && o.hi !== null;
    return {
      id: b.id, name: b.name, p: b.p, s: b.s.slice(), equip: b.equip,
      lo: range ? o.lo : b.lo, hi: range ? o.hi : b.hi,
      inc: o && o.inc !== null ? o.inc : b.inc,
      perHand: b.perHand, load: b.load, timed: b.timed,
      note: o ? o.note : "", custom: false, del: false, known: LOADS.indexOf(b.load) !== -1
    };
  }

  // One of your own ("x_" ids), sanitized: `group` becomes p (null when it
  // isn't one of the six) and `sec` becomes s.
  function resolveCustom(r) {
    var p = isGroup(r.group) ? r.group : null;
    return {
      id: r.id, name: r.name, p: p, s: r.sec.filter(function (g) { return isGroup(g) && g !== p; }), equip: r.equip,
      lo: r.lo, hi: r.hi, inc: r.inc, perHand: r.perHand, load: r.load, timed: r.timed,
      note: r.note, custom: true, del: r.del, known: LOADS.indexOf(r.load) !== -1
    };
  }

  // Registers state.exercises — your own exercises ("x_" ids) and tweaks
  // to built-in ones (rep range, weight step, setup note) — for every gym
  // lookup: exercise(), exerciseList(), and what a gym entry counts for.
  // The one piece of state this file keeps (see the top). Each record goes
  // through MODEL.sanitizeExercise, so anything is safe to pass; for one
  // id listed twice the newer mts wins. A tweak for an id that isn't built
  // in is ignored. Anything that isn't a list registers nothing: only the
  // built-in exercises, untweaked.
  function useExercises(list) {
    var recs = dict();
    (Array.isArray(list) ? list : []).forEach(function (r) {
      var c = MODEL.sanitizeExercise(r);
      if (c && !(recs[c.id] && recs[c.id].mts > c.mts)) recs[c.id] = c;
    });
    var out = dict();
    Object.keys(BUILT_IN).forEach(function (id) { out[id] = resolveBuiltIn(BUILT_IN[id], recs[id] || null); });
    Object.keys(recs).forEach(function (id) {
      if (id.indexOf("x_") === 0 && !own(BUILT_IN, id)) out[id] = resolveCustom(recs[id]);
    });
    resolved = out;
  }

  // The registered record itself (don't change it), or null.
  function exRec(exId) {
    return (typeof exId === "string" && Object.prototype.hasOwnProperty.call(resolved, exId)) ? resolved[exId] : null;
  }

  function copyEx(x) {
    var c = {};
    Object.keys(x).forEach(function (k) { c[k] = x[k]; });
    c.s = x.s.slice();
    return c;
  }

  // An exercise, ready to show and to progress:
  //   { id, name, p, s, equip, lo, hi, inc, perHand, load, timed, note,
  //     custom, del, known }
  //   p        the group one hard set counts 1 for (null for one of your
  //            own whose group isn't one of the six)
  //   s        the groups it counts ½ for, in GROUPS order
  //   lo, hi   rep range (seconds when timed); inc the kg step. A tweak's
  //            values replace the catalogue's when they aren't null.
  //   note     the setup note ("" when none)
  //   custom   one of your own ("x_" id)
  //   del      one of your own that was removed from the list: it still
  //            resolves, so old entries keep their name and still count
  //   known    this version knows what its kg mean (load is ext, added,
  //            assist or bw); false for a load type from a newer version:
  //            then every set with reps counts, and it progresses by reps
  // null for an id that is neither built in nor registered (the app shows
  // "Unknown exercise"), including names every object inherits. A fresh
  // copy each time.
  function exercise(exId) {
    var x = exRec(exId);
    return x ? copyEx(x) : null;
  }

  // Every exercise that isn't deleted, built-in and your own, grouped by p
  // in GROUPS order (one without a group last), each group by name (case
  // ignored), then id. Fresh copies.
  function exerciseList() {
    var rank = function (x) { var i = GROUPS.indexOf(x.p); return i === -1 ? GROUPS.length : i; };
    var low = function (s) { return String(s).toLowerCase(); };
    return Object.keys(resolved).map(function (id) { return resolved[id]; })
      .filter(function (x) { return !x.del; })
      .sort(function (a, b) {
        return (rank(a) - rank(b)) ||
          (low(a.name) < low(b.name) ? -1 : (low(a.name) > low(b.name) ? 1 : 0)) ||
          (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
      })
      .map(copyEx);
  }

  // One hard set of an exercise per group: { p: 1, each of s: ½ }.
  function exWeights(ex) {
    var w = {};
    ex.s.forEach(function (g) { if (isGroup(g)) w[g] = HELPER_WEIGHT; });
    if (isGroup(ex.p)) w[ex.p] = 1;
    return cleanWeights(w);
  }

  /* ---------- The gym: sets ---------- */

  // A number from a stored set: reps (or seconds), or kg.
  function num(x) {
    if (x === null || x === undefined || x === "" || typeof x === "boolean") return 0;
    var n = Number(x);
    return isFinite(n) ? n : 0;
  }
  // The kg of set i of a gym entry: 0 when missing or unusable, and always
  // 0 for a bodyweight-only exercise.
  function kgAt(e, i, ex) {
    if (ex && ex.load === "bw") return 0;
    var k = Array.isArray(e.kg) ? num(e.kg[i]) : 0;
    return k > 0 ? k : 0;
  }

  // e1RM × 30, exactly: kg × (30 + reps) with reps up to EPLEY_MAX_REPS,
  // kg × 30 for a single; 0 without weight or reps. Stored kg are
  // multiples of 0.25, so these are exact and compare without rounding.
  function score(kg, reps) {
    var w = num(kg), r = num(reps);
    if (!(w > 0) || !(r > 0)) return 0;
    return r === 1 ? w * 30 : w * (30 + Math.min(r, EPLEY_MAX_REPS));
  }

  // Estimated one-rep max (Epley): kg × (1 + min(reps, 20) / 30); a single
  // is its own kg; 0 when kg or reps is 0 or less (or not a number). For a
  // dumbbell exercise kg is per hand, and so is this.
  function e1rm(kg, reps) {
    return score(kg, reps) / 30;
  }

  // Whether this exercise's warm-ups can be told from its weights: an
  // external weight that isn't held for time. Not added weight (dips,
  // weighted chin-ups): the load there is body weight + the added kg, and
  // without body weight (weigh-ins come later) comparing the added kg alone
  // would call real working sets warm-ups.
  function filtersWarmups(ex) {
    return !!ex && !ex.timed && ex.load === "ext";
  }

  // Which sets of an entry are working sets: [true|false] per set.
  //   gym, load ext or added (not timed), some set with kg > 0: a set is
  //     working when its e1RM is at least WARMUP_SHARE (0.8) of the
  //     entry's best set's — lighter sets were warm-ups. 60 × 12, then
  //     100 × 8, 8, 7 → [false, true, true, true].
  //   gym, anything else (assist, bw, timed, all at 0 kg, an exercise
  //     nobody knows): every set with reps above 0
  //   a skill entry: every set above 0 (as hardSets counts them)
  // A set of 0 reps is never working. Takes a draft too
  // ({ kind: "gym", exId, sets, kg }); [] for anything without sets.
  function workingSets(e) {
    if (!e || typeof e !== "object" || !Array.isArray(e.sets)) return [];
    var reps = e.sets.map(num);
    var ex = e.kind === "gym" ? exRec(e.exId) : null;
    if (!filtersWarmups(ex)) return reps.map(function (r) { return r > 0; });
    var scores = reps.map(function (r, i) { return score(kgAt(e, i, ex), r); });
    var best = Math.max.apply(null, [0].concat(scores));
    if (!(best > 0)) return reps.map(function (r) { return r > 0; });
    // s ≥ 0.8 × best, exactly (both sides are multiples of 0.25).
    return scores.map(function (s, i) { return reps[i] > 0 && s * 5 >= best * 4; });
  }

  // kg to a multiple of inc: mode "down" (floor), "up" (ceiling), anything
  // else the nearest. roundTo(56.25, 2.5, "down") → 55. An inc that isn't
  // above 0 counts as 0.25; kg that isn't a number gives 0.
  function roundTo(kg, inc, mode) {
    var x = Number(kg), step = Number(inc);
    if (kg === null || kg === "" || typeof kg === "boolean" || !isFinite(x)) return 0;
    if (!(step > 0) || !isFinite(step)) step = 0.25;
    var q = x / step, k;
    // The 1e-9 keeps floating-point noise from moving a whole step:
    // 1.1 × 25 = 27.500000000000004 is 27.5 up to 2.5, not 30, and
    // (1 − 0.9) × 25 = 2.4999999999999996 is 2.5 down, not 0.
    if (mode === "down") k = Math.floor(q + 1e-9);
    else if (mode === "up") k = Math.ceil(q - 1e-9);
    else k = Math.round(q);
    return Math.round(k * step * 1e6) / 1e6 + 0;
  }

  /* ---------- The gym: one exercise's history ---------- */

  // That exercise's gym entries, newest first (same ts: the later in the
  // log first). The log's own objects: don't change them.
  //   opts.before   a time: only entries on calendar days before the one
  //                 containing it (a before that isn't a time gives [])
  //   opts.exclude  an entry id to leave out (the one being edited)
  // Entries of any exercise id, known or not; entries with no working set
  // are listed too.
  function sessionsFor(log, exId, opts) {
    if (!Array.isArray(log) || typeof exId !== "string") return [];
    var o = (opts && typeof opts === "object") ? opts : {};
    var until = Infinity;
    if (o.before !== undefined && o.before !== null) {
      if (!validTime(o.before)) return [];
      until = dayStart(Number(o.before));
    }
    var skip = typeof o.exclude === "string" ? o.exclude : null;
    var out = [];
    log.forEach(function (e, i) {
      if (!e || typeof e !== "object" || e.kind !== "gym" || e.exId !== exId || !Array.isArray(e.sets)) return;
      var t = timeOf(e);
      if (!(t < until) || (skip !== null && e.id === skip)) return;
      out.push({ e: e, t: t, i: i });
    });
    out.sort(function (a, b) { return (b.t - a.t) || (b.i - a.i); });
    return out.map(function (x) { return x.e; });
  }

  // The newest of sessionsFor(log, exId, opts), or null.
  function lastSession(log, exId, opts) {
    return sessionsFor(log, exId, opts)[0] || null;
  }

  // How best() and suggest() treat an exercise's weight:
  //   "load"    more kg is harder (ext, and added with weight on)
  //   "assist"  less kg is harder (an assisted machine)
  //   "reps"    kg doesn't make it harder here: bodyweight only, timed,
  //             or a load type this version doesn't know
  function weightMode(ex) {
    if (!ex.known || ex.timed || ex.load === "bw") return "reps";
    return ex.load === "assist" ? "assist" : "load";
  }

  // The best working set of an exercise ever (or among sessionsFor(log,
  // exId, opts)): { kg, reps, e1rm, ts, id }
  //   ext / added  the highest e1RM (then the heavier, then more reps);
  //                sets without weight rank by reps below any set with
  //   assist       the least help (kg), then the most reps
  //   bw, timed    the most reps (seconds), then the most kg
  // e1rm is e1rm(kg, reps) for ext and added (0 without weight), 0 for the
  // others. A tie keeps the earliest set. null when there is no working
  // set, or the exercise is unknown.
  function best(log, exId, opts) {
    var ex = exRec(exId);
    if (!ex) return null;
    var mode = weightMode(ex), list = sessionsFor(log, exId, opts), top = null;
    var better = function (a, b) {
      if (mode === "load") {
        var sa = score(a.kg, a.reps), sb = score(b.kg, b.reps);
        if (sa !== sb) return sa > sb;
        return a.kg !== b.kg ? a.kg > b.kg : a.reps > b.reps;
      }
      if (mode === "assist") return a.kg !== b.kg ? a.kg < b.kg : a.reps > b.reps;
      return a.reps !== b.reps ? a.reps > b.reps : a.kg > b.kg;
    };
    for (var k = list.length - 1; k >= 0; k--) {
      var e = list[k], flags = workingSets(e);
      for (var i = 0; i < e.sets.length; i++) {
        if (!flags[i]) continue;
        var c = { kg: kgAt(e, i, ex), reps: num(e.sets[i]), ts: timeOf(e), id: e.id };
        if (!top || better(c, top)) top = c;
      }
    }
    if (!top) return null;
    // An estimated max only for external weight: for added weight it would
    // be an estimate of the added kg alone, which means nothing.
    return { kg: top.kg, reps: top.reps, e1rm: mode === "load" && ex.load === "ext" ? e1rm(top.kg, top.reps) : 0, ts: top.ts, id: top.id };
  }

  /* ---------- The gym: the next session ---------- */

  // What a past session was, for the double progression, or null when it
  // has no working set:
  //   W      its top weight: the heaviest working set (the least help on
  //          an assisted machine; 0 for bodyweight only)
  //   at     the reps of its working sets at W, in order
  //   n      how many working sets it had (at W or not)
  function sessionTop(e, ex) {
    var flags = workingSets(e), reps = [], kg = [];
    e.sets.forEach(function (x, i) { if (flags[i]) { reps.push(num(x)); kg.push(kgAt(e, i, ex)); } });
    if (!reps.length) return null;
    var W = ex.load === "assist" && ex.known ? Math.min.apply(null, kg) : Math.max.apply(null, kg);
    return {
      id: e.id, ts: timeOf(e), W: W, n: reps.length,
      at: reps.filter(function (r, i) { return kg[i] === W; })
    };
  }

  // The sessions of one calendar day are one session (two entries of the same
  // exercise on a day, e.g. after changing the day of one): their sets in
  // time order, under the latest entry's id and time. Input and output are
  // newest first.
  var SESSIONS_LOOKED_AT = 12;
  function mergeDays(list) {
    var out = [];
    list.forEach(function (e) {
      var k = MODEL.dateStr(timeOf(e)), cur = out.length ? out[out.length - 1] : null;
      if (cur && cur.day === k) {
        cur.sets = e.sets.concat(cur.sets);
        cur.kg = (Array.isArray(e.kg) ? e.kg : []).concat(cur.kg);
      } else {
        out.push({ day: k, id: e.id, ts: e.ts, kind: "gym", exId: e.exId, sets: e.sets.slice(), kg: Array.isArray(e.kg) ? e.kg.slice() : [] });
      }
    });
    return out;
  }

  function fill(x, n) { var out = []; for (var i = 0; i < n; i++) out.push(x); return out; }
  function sum(list) { return list.reduce(function (s, x) { return s + x; }, 0); }

  // n targets from the reps at W, each min(hi, r + step) — one more rep, or
  // for a timed hold TIMED_STEP more seconds (one second is no goal); sets
  // past the last one at W repeat its target.
  var TIMED_STEP = 5;
  function oneMore(at, n, hi, step) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(Math.min(hi, at[Math.min(i, at.length - 1)] + (step || 1)));
    return out;
  }

  // The double-progression suggestion for the next session of an exercise,
  // from its sessions on days before now's (today's entries and
  // opts.exclude, the entry being edited, left out; sessions without a
  // working set skipped). Plain data:
  //   { kind, kg, sets, targets: [reps per set], from }
  //   from     { id, ts, kg: W, reps: [the working reps at W] } of the
  //            last session, or null when there is none
  //   sets     the last session's working sets, 1–10 (3 when none)
  //   targets  one per set (seconds when timed)
  // W is the last session's top weight (sessionTop). kind, checked in
  // this order:
  //   "first"   no earlier session, or ext with W = 0: kg null, 3 sets of
  //             hi ("pick a weight you could lift about hi + 2 times")
  //   "return"  more than 42 calendar days since the last session: 90 %
  //             of W rounded down to inc (never 0: then W); assisted: W +
  //             10 % rounded up to inc; reps mode: W. Targets lo.
  //   Reps mode (bw, timed, unknown load, and added or assist at W = 0):
  //   "harder"  every working set at W reached hi: kg W, targets hi (the
  //             app says: add weight for added, else a harder variation)
  //   "reps"    otherwise: kg W, targets min(hi, r + 1)
  //   Weight mode (ext; added and assist with W > 0):
  //   "up"      every working set at W reached hi: kg W + inc (assisted:
  //             W − inc, not below 0); targets lo, or lo − 2 (at least 1)
  //             when the change is more than 10 % of W
  //   "deload"  the last two sessions both at W, both with a working set
  //             at W under lo, and the latest with no more reps at W in
  //             total than the one before: kg as for "return", targets lo
  //   "same"    otherwise: kg W, targets min(hi, r + 1)
  // lo, hi and inc are the exercise's own (tweaks included). null for an
  // exercise nobody knows, or a now that isn't a time.
  function suggest(exId, log, now, opts) {
    var ex = exRec(exId);
    if (!ex || !validTime(now)) return null;
    var o = (opts && typeof opts === "object") ? opts : {};
    var lo = ex.lo, hi = ex.hi, inc = ex.inc;
    var list = mergeDays(sessionsFor(log, exId, { before: Number(now), exclude: o.exclude }));
    var tops = [];
    for (var i = 0; i < list.length && tops.length < SESSIONS_LOOKED_AT; i++) {
      var t = sessionTop(list[i], ex);
      if (t) tops.push(t);
    }
    var last = tops[0];
    var make = function (kind, kg, n, targets) {
      return { kind: kind, kg: kg, sets: n, targets: targets, from: last ? { id: last.id, ts: last.ts, kg: last.W, reps: last.at.slice() } : null };
    };
    var mode = weightMode(ex);
    if (!last || (mode === "load" && ex.load === "ext" && !(last.W > 0))) return make("first", null, DEFAULT_SETS, fill(hi, DEFAULT_SETS));
    var W = last.W;
    if (!(W > 0)) mode = "reps";   // added or assisted with no weight on: bodyweight
    var n = Math.max(1, Math.min(MAX_SETS, last.n));
    var lighter = function () {
      if (mode === "reps") return W;
      if (mode === "assist") return roundTo(W * (2 - BACKOFF), inc, "up");
      var k = roundTo(W * BACKOFF, inc, "down");
      return k > 0 ? k : W;
    };
    if (dayDelta(last.ts, Number(now)) > RETURN_DAYS) return make("return", lighter(), n, fill(lo, n));
    var topped = last.at.every(function (r) { return r >= hi; });
    if (mode === "reps") return make(topped ? "harder" : "reps", W, n, oneMore(last.at, n, hi, ex.timed ? TIMED_STEP : 1));
    if (topped) {
      var kg = mode === "assist" ? Math.max(0, W - inc) : W + inc;
      // A change of exactly 10 % divides to exactly 0.1 (the double nearest
      // a tenth, as the constant is), so it isn't "more than".
      var big = Math.abs(kg - W) / W > BIG_JUMP;
      return make("up", kg, n, fill(big ? Math.max(1, lo - BIG_JUMP_REPS) : lo, n));
    }
    var prev = tops[1];
    // The floor is lo, or lo − 2 while you're still settling in after a big
    // step up to W (the targets "up" gave then): falling short of lo there
    // is expected, not a reason to go back down.
    var floor = lo;
    for (var j = 1; j < tops.length; j++) {
      if (tops[j].W === W) continue;
      var from = tops[j].W;
      var harder = mode === "assist" ? W < from : W > from;
      if (harder && from > 0 && Math.abs(W - from) / from > BIG_JUMP) floor = Math.max(1, lo - BIG_JUMP_REPS);
      break;
    }
    var short = function (s) { return s.at.some(function (r) { return r < floor; }); };
    if (prev && prev.W === W && short(last) && short(prev) && sum(last.at) <= sum(prev.at)) {
      return make("deload", lighter(), n, fill(lo, n));
    }
    return make("same", W, n, oneMore(last.at, n, hi));
  }

  useExercises([]);

  /* ---------- Display ---------- */

  var QUARTERS = ["", "\u00bc", "\u00bd", "\u00be"];

  // 9.75 → "9¾", 0.5 → "½", 12 → "12". Rounds to the nearest ¼ first.
  function fmtSets(n) {
    var q = Math.round(Math.max(0, Number(n) || 0) * 4);
    var whole = Math.floor(q / 4), frac = q % 4;
    if (!whole && frac) return QUARTERS[frac];
    return String(whole) + QUARTERS[frac];
  }

  return {
    BUILD: BUILD,
    ZONES: ZONES,
    ZONE_LABELS: ZONE_LABELS,
    weekStart: weekStart,
    addWeeks: addWeeks,
    weekLabel: weekLabel,
    inWeek: inWeek,
    setWeights: setWeights,
    hardSets: hardSets,
    groupWeights: groupWeights,
    weekVolume: weekVolume,
    weekVolumeUntil: weekVolumeUntil,
    lastWeekToDate: lastWeekToDate,
    targets: targets,
    zone: zone,
    dayOfWeek: dayOfWeek,
    pace: pace,
    paceZone: paceZone,
    weekSummary: weekSummary,
    verdict: verdict,
    weekHistory: weekHistory,
    contribution: contribution,
    breakdown: breakdown,
    feeders: feeders,
    mainFeeders: mainFeeders,
    feedersAt: feedersAt,
    sessionFeeder: sessionFeeder,
    lastTrained: lastTrained,
    daysSince: daysSince,
    dayGroups: dayGroups,
    weekStrip: weekStrip,
    workoutDays: workoutDays,
    workoutsInWeek: workoutsInWeek,
    totalWorkouts: totalWorkouts,
    weekStreak: weekStreak,
    monthGrid: monthGrid,
    monthLabel: monthLabel,
    addMonths: addMonths,
    groupNudge: groupNudge,
    radarShare: radarShare,
    fmtSets: fmtSets,
    useExercises: useExercises,
    exercise: exercise,
    exerciseList: exerciseList,
    e1rm: e1rm,
    workingSets: workingSets,
    roundTo: roundTo,
    sessionsFor: sessionsFor,
    lastSession: lastSession,
    best: best,
    suggest: suggest,
    LOADS: LOADS,
    HELPER_WEIGHT: HELPER_WEIGHT,
    WARMUP_SHARE: WARMUP_SHARE,
    EPLEY_MAX_REPS: EPLEY_MAX_REPS,
    RETURN_DAYS: RETURN_DAYS,
    BACKOFF: BACKOFF,
    BIG_JUMP: BIG_JUMP,
    BIG_JUMP_REPS: BIG_JUMP_REPS,
    DEFAULT_SETS: DEFAULT_SETS,
    MAX_SETS: MAX_SETS,
    DOT_SETS: DOT_SETS,
    STREAK_WORKOUTS: STREAK_WORKOUTS,
    HISTORY_WEEKS: HISTORY_WEEKS,
    UNTRAINED_DAYS: UNTRAINED_DAYS,
    NEWCOMER_WORKOUTS: NEWCOMER_WORKOUTS,
    BEHIND_FROM_DAY: BEHIND_FROM_DAY,
    BEHIND_SHARE: BEHIND_SHARE,
    BUILDING_SHARE: BUILDING_SHARE,
    RADAR_MAX: RADAR_MAX
  };
})();
