/* ============================================================
   Milo — training logic.

   Turns the log into what the home bars (and later the Body tab)
   show: calendar weeks, hard sets per muscle group, the weekly
   target for each group and how far along it is.

   Pure functions over plain values: no DOM, no storage, and no
   clock — whoever needs "this week" passes the time in — so
   tests/training-test.js runs them in Node.

   Reads the tables at the end of data.js (GROUP_INFO, AREA_GROUPS,
   VARIATION_GROUPS, QUICK_GROUPS) and the calendar-day helpers in
   model.js, so it loads after both and before app.js.

   Dates: a week is Monday 00:00 to Sunday 23:59, local time. Days
   are stepped with MODEL.startOfDay / addDays only — never by
   adding 86400000 ms, which goes wrong in daylight-saving weeks
   (they are 167 or 169 hours long).

   Numbers: every weight is 1, ½ or ¼, so weekly totals are exact
   multiples of ¼ (floating point adds those without error). Zones
   are decided on the exact total; fmtSets() shows it as "9¾".
   ============================================================ */

var TRAINING = (function () {
  "use strict";

  var BUILD = "milo-v18";

  var GROUPS = MODEL.GROUPS;
  var startOfDay = MODEL.startOfDay;
  var addDays = MODEL.addDays;

  // Captured once: if data.js is from an older release these are
  // missing, this file fails to load, and app.js's build check shows
  // "finishing an update" instead of wrong numbers.
  var INFO = GROUP_INFO;
  var BY_AREA = AREA_GROUPS;
  var BY_VARIATION = VARIATION_GROUPS;
  var BY_QUICK = QUICK_GROUPS;

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var ZONES = ["none", "low", "building", "on", "above"];
  var ZONE_LABELS = { none: "Not trained", low: "Low", building: "Building", on: "On target", above: "Above target" };

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
    } else if (e.kind === "quick" && e.groups && typeof e.groups === "object") {
      GROUPS.forEach(function (g) {
        if (!own(e.groups, g) || !own(BY_QUICK, g)) return;
        var sets = Math.round(Number(e.groups[g]));
        if (isFinite(sets) && sets > 0) addInto(acc, cleanWeights(BY_QUICK[g]), sets);
      });
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
  //   "low"       above 0, below lo/2
  //   "building"  lo/2 up to, not including, lo
  //   "on"        lo to hi, both included
  //   "above"     above hi
  function zone(n, lo, hi) {
    n = Number(n);
    if (!(n > 0)) return "none";
    if (n < lo / 2) return "low";
    if (n < lo) return "building";
    if (n <= hi) return "on";
    return "above";
  }

  // Everything the six weekly bars need, one row per group in GROUPS order.
  function weekSummary(log, ts, vol) {
    var sets = weekVolume(log, ts), t = targets(vol);
    return GROUPS.map(function (g) {
      return { group: g, sets: sets[g], lo: t[g][0], hi: t[g][1], zone: zone(sets[g], t[g][0], t[g][1]) };
    });
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
    targets: targets,
    zone: zone,
    weekSummary: weekSummary,
    fmtSets: fmtSets
  };
})();
