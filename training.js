/* ============================================================
   Milo — training logic.

   Turns the log into what the four tabs show: calendar weeks,
   hard sets per muscle group, the weekly target for each group
   and how far along it is (Today's bars, the Body radar and its
   cards), the pace an even week needs by today and Body's
   sentence built on it, "this point last week", the week strip
   and the month calendar with their group dots, workouts and the
   week streak (History), what counted for a group this week,
   which skills feed it, and the one nudge. Data only: the words
   the app shows are app.js's.

   Pure functions over plain values: no DOM, no storage, and no
   clock — whoever needs "this week" passes the time in — so
   tests/training-test.js runs them in Node. Every function takes
   any log (sanitized v5 entries of every kind, an empty log, or
   junk) without throwing.

   Reads the tables in data.js (AREAS, GROUP_INFO, AREA_GROUPS,
   VARIATION_GROUPS, QUICK_GROUPS) and the calendar-day helpers in
   model.js, so it loads after both and before app.js.

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
   ============================================================ */

var TRAINING = (function () {
  "use strict";

  var BUILD = "milo-v19";

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
  function hardSets(e) {
    if (!e || !Array.isArray(e.sets)) return 0;
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

  // What one log entry adds to the week, in hard sets per group:
  // { group: sets }, groups in GROUPS order, zeros left out.
  //   ladder  hardSets × setWeights(area, step, variant)
  //   quick   n sets of a group → n × QUICK_GROUPS[group]
  //   gym     nothing yet (P4: the catalogue's weights × working sets,
  //           warm-ups filtered out)
  //   body    a weigh-in: nothing, ever
  function groupWeights(e) {
    if (!e || typeof e !== "object") return {};
    var acc = {};
    if (e.kind === undefined) {
      var n = hardSets(e);
      if (n) addInto(acc, setWeights(e.areaId, e.step, e.variant), n);
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
  //           (setWeights, the variation's own map when it has one), 1 or
  //           ¼ for a quick log's line
  //   own     true when the sets were for this group itself (weight 1: the
  //           group the exercise is for, or the quick log's line for it);
  //           false when they only helped ("6 chest sets, helping")
  //   listed  a quick log's line: the group it was logged for ("chest");
  //           null for a skill entry
  //   logged  the sets that were logged: a skill entry's hard sets, or the
  //           number on the quick log's line
  // A skill entry is one row. A quick log is one row per group it lists
  // that counts here (NOTES "Notes for building P3" 2): one listing chest 6
  // and shoulders 4 gives Shoulders two rows, 4 at 1 and 6 at ¼. Rows of
  // one quick log come own line first, then GROUPS order. Newest first by
  // ts; entries at the same ts, the later in the log first. Whole week,
  // like weekVolume; entries that add nothing (gym until P4, weigh-ins)
  // aren't listed.
  function breakdown(log, now, group) {
    if (!isGroup(group)) return [];
    var rows = [];
    inWeek(log, now).forEach(function (e, i) {
      if (e.kind === undefined) {
        var n = hardSets(e), w = setWeights(e.areaId, e.step, e.variant);
        if (n && own(w, group)) rows.push({ entry: e, sets: n * w[group], weight: w[group], own: w[group] >= 1, listed: null, logged: n, i: i, k: 0 });
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
