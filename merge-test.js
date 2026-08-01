/* Exercises SYNC.merge() against the scenarios that actually happen:
   two devices logging while apart, edits, deletes, conflicting steps,
   and the convergence property (merge order must not matter). */

const fs = require("fs");
const path = require("path");
const REPO = __dirname;

// Minimal browser shims so sync.js can be eval'd as-is.
global.window = { crypto: require("crypto").webcrypto };
global.localStorage = {
  _m: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; }
};
global.URL = URL;
global.Uint8Array = Uint8Array;
eval(fs.readFileSync(path.join(REPO, "sync.js"), "utf8"));

const AREA_IDS = ["pushup", "squat", "pullup", "legraise", "bridge", "hspu"];
let fails = 0, passes = 0;

function check(name, cond, extra) {
  if (cond) { passes++; console.log("  ok   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "\n       " + extra : "")); }
}

function baseState() {
  const areas = {};
  AREA_IDS.forEach(id => { areas[id] = { step: 1, std: 0, mts: 0 }; });
  return {
    v: 4, areas, log: [],
    settings: { restSeconds: 180 },
    routine: { enabled: false, daysPerWeek: 3, sessionIndex: 0 },
    snapshots: [], milestones: [], deleted: [], prefsMts: 0
  };
}

function entry(id, ts, areaId, sets, mts, note) {
  return { id, ts, date: new Date(ts).toISOString().slice(0, 10), areaId, step: 1, sets, note: note || "", mts: mts || ts };
}

const T = Date.UTC(2026, 6, 1, 8, 0, 0); // fixed base time
const hour = 3600000;

/* ---- 1. Two devices each log a different session while apart ---- */
{
  const laptop = baseState();
  laptop.log.push(entry("a1", T, "pushup", [10, 8]));
  const phone = baseState();
  phone.log.push(entry("b1", T + hour, "squat", [20]));

  const m = SYNC.merge(laptop, phone);
  check("both sessions survive", m.log.length === 2, JSON.stringify(m.log.map(e => e.id)));
  check("sorted oldest first", m.log[0].id === "a1" && m.log[1].id === "b1");
}

/* ---- 2. Same session edited on one device ---- */
{
  const laptop = baseState();
  laptop.log.push(entry("a1", T, "pushup", [10, 8]));
  const phone = baseState();
  phone.log.push(entry("a1", T, "pushup", [12, 12], T + hour)); // edited later

  const m = SYNC.merge(laptop, phone);
  check("one copy kept", m.log.length === 1);
  check("newer edit wins", JSON.stringify(m.log[0].sets) === "[12,12]", JSON.stringify(m.log[0].sets));
}

/* ---- 3. Delete on one device must not be resurrected ---- */
{
  const laptop = baseState();
  laptop.log.push(entry("a1", T, "pushup", [10]));
  laptop.log.push(entry("a2", T + hour, "squat", [20]));

  const phone = JSON.parse(JSON.stringify(laptop));
  // phone deletes a1
  phone.log = phone.log.filter(e => e.id !== "a1");
  phone.deleted.push({ id: "a1", ts: T + 2 * hour });

  const m = SYNC.merge(laptop, phone);
  check("deleted session stays deleted", m.log.length === 1 && m.log[0].id === "a2",
    JSON.stringify(m.log.map(e => e.id)));
  check("tombstone is carried forward", m.deleted.length === 1 && m.deleted[0].id === "a1");

  // and it must still be gone after a second round-trip
  const m2 = SYNC.merge(m, laptop);
  check("still deleted after re-merging with the stale device", m2.log.length === 1);
}

/* ---- 4. An edit made after the delete wins ---- */
{
  const laptop = baseState();
  laptop.log.push(entry("a1", T, "pushup", [10], T + 3 * hour)); // edited at +3h
  const phone = baseState();
  phone.deleted.push({ id: "a1", ts: T + 2 * hour });            // deleted at +2h

  const m = SYNC.merge(laptop, phone);
  check("later edit beats earlier delete", m.log.length === 1);
}

/* ---- 5. Conflicting area positions: newest change wins ---- */
{
  const laptop = baseState();
  laptop.areas.pushup = { step: 4, std: 1, mts: T };
  const phone = baseState();
  phone.areas.pushup = { step: 5, std: 0, mts: T + hour };

  const m = SYNC.merge(laptop, phone);
  check("newer area change wins", m.areas.pushup.step === 5, JSON.stringify(m.areas.pushup));

  const m2 = SYNC.merge(phone, laptop);
  check("same result whichever side merges", JSON.stringify(m.areas) === JSON.stringify(m2.areas));
}

/* ---- 6. Legacy data with no mts at all ---- */
{
  const laptop = baseState();
  laptop.areas.pushup = { step: 6, std: 2, mts: 0 };
  const phone = baseState();
  phone.areas.pushup = { step: 3, std: 0, mts: 0 };

  const m = SYNC.merge(laptop, phone);
  const m2 = SYNC.merge(phone, laptop);
  check("tie resolves to the further-along position", m.areas.pushup.step === 6);
  check("tie is order-independent", JSON.stringify(m.areas.pushup) === JSON.stringify(m2.areas.pushup));
}

/* ---- 7. Milestones: same achievement, different random ids ---- */
{
  const laptop = baseState();
  laptop.milestones.push({ id: "m1", ts: T, type: "advance", areaId: "pushup", step: 4 });
  const phone = baseState();
  phone.milestones.push({ id: "zz9", ts: T + hour, type: "advance", areaId: "pushup", step: 4 });

  const m = SYNC.merge(laptop, phone);
  check("duplicate milestone collapsed", m.milestones.length === 1, JSON.stringify(m.milestones));
  check("earliest timestamp kept", m.milestones[0].ts === T);
}

/* ---- 8. Snapshots: one per day, component-wise max ---- */
{
  const laptop = baseState();
  laptop.snapshots.push({ d: "2026-07-01", v: [3, 1, 0, 0, 0, 0] });
  const phone = baseState();
  phone.snapshots.push({ d: "2026-07-01", v: [2, 4, 0, 0, 0, 0] });
  phone.snapshots.push({ d: "2026-07-02", v: [3, 4, 0, 0, 0, 0] });

  const m = SYNC.merge(laptop, phone);
  check("one snapshot per day", m.snapshots.length === 2);
  check("component-wise max", JSON.stringify(m.snapshots[0].v) === "[3,4,0,0,0,0]",
    JSON.stringify(m.snapshots[0].v));
}

/* ---- 9. Prefs move as a unit, newest wins ---- */
{
  const laptop = baseState();
  laptop.routine = { enabled: true, daysPerWeek: 3, sessionIndex: 2 };
  laptop.settings = { restSeconds: 120 };
  laptop.prefsMts = T;

  const phone = baseState();
  phone.routine = { enabled: true, daysPerWeek: 6, sessionIndex: 0 };
  phone.settings = { restSeconds: 300 };
  phone.prefsMts = T + hour;

  const m = SYNC.merge(laptop, phone);
  check("newest prefs win as a set",
    m.routine.daysPerWeek === 6 && m.settings.restSeconds === 300,
    JSON.stringify({ r: m.routine, s: m.settings }));
}

/* ---- 10. Convergence: merge order and repetition must not matter ---- */
{
  const laptop = baseState();
  laptop.log.push(entry("a1", T, "pushup", [10]));
  laptop.log.push(entry("shared", T + hour, "squat", [20], T + hour));
  laptop.areas.pushup = { step: 4, std: 1, mts: T + hour };
  laptop.milestones.push({ id: "m1", ts: T, type: "advance", areaId: "pushup", step: 4 });
  laptop.snapshots.push({ d: "2026-07-01", v: [3, 1, 0, 0, 0, 0] });
  laptop.prefsMts = T;

  const phone = baseState();
  phone.log.push(entry("b1", T + 2 * hour, "bridge", [5]));
  phone.log.push(entry("shared", T + hour, "squat", [25], T + 3 * hour));
  phone.log.push(entry("gone", T, "hspu", [3]));
  phone.areas.pushup = { step: 3, std: 2, mts: T };
  phone.deleted.push({ id: "old", ts: T });
  phone.snapshots.push({ d: "2026-07-01", v: [2, 2, 0, 0, 0, 0] });
  phone.prefsMts = T + hour;
  phone.routine = { enabled: true, daysPerWeek: 2, sessionIndex: 1 };

  const ab = SYNC.merge(laptop, phone);
  const ba = SYNC.merge(phone, laptop);
  check("merge is commutative", JSON.stringify(ab) === JSON.stringify(ba));

  const twice = SYNC.merge(ab, phone);
  check("merge is idempotent", JSON.stringify(SYNC.merge(ab, ab)) === JSON.stringify(ab));
  check("re-merging a stale peer changes nothing", JSON.stringify(twice) === JSON.stringify(ab));

  check("edited shared entry took the newer sets",
    JSON.stringify(ab.log.find(e => e.id === "shared").sets) === "[25]");
}

/* ---- 11. A fresh device (empty) pulling an established one ---- */
{
  const fresh = baseState();
  const established = baseState();
  established.log.push(entry("a1", T, "pushup", [10]));
  established.areas.pushup = { step: 7, std: 2, mts: T };

  const m = SYNC.merge(fresh, established);
  check("fresh device receives everything", m.log.length === 1 && m.areas.pushup.step === 7);
}

/* ---- 12. Tombstone cap keeps the most recent ---- */
{
  const a = baseState();
  for (let i = 0; i < 450; i++) a.deleted.push({ id: "d" + i, ts: T + i });
  const m = SYNC.merge(a, baseState());
  check("tombstones capped at 400", m.deleted.length === 400);
  check("newest tombstones kept", m.deleted[m.deleted.length - 1].id === "d449");
}

/* ---- 13. Pairing round-trip + host allowlist ---- */
{
  const cfg = { url: "https://bigsix-1234-default-rtdb.europe-west1.firebasedatabase.app", code: SYNC.makeCode(), lastSync: 0 };
  const link = "https://michele-minervini.github.io/calisthenics-tracker/" + SYNC.pairingHash(cfg);
  const back = SYNC.parsePairing(link);
  check("pairing link round-trips", back && back.url === cfg.url && back.code === cfg.code, JSON.stringify(back));
  check("pairing link length fits a QR", link.length < 210, "len=" + link.length);

  check("http is rejected", SYNC.normalizeURL("http://x.firebaseio.com") === null);
  check("foreign host is rejected", SYNC.normalizeURL("https://evil.example.com") === null);
  check("lookalike host is rejected", SYNC.normalizeURL("https://firebaseio.com.evil.net") === null);
  check("legacy firebaseio host accepted", SYNC.normalizeURL("https://bigsix.firebaseio.com/") === "https://bigsix.firebaseio.com");
  check("trailing path stripped", SYNC.normalizeURL("https://a-default-rtdb.firebasedatabase.app/u/x.json") === "https://a-default-rtdb.firebasedatabase.app");
  check("bare host gets https", SYNC.normalizeURL("a-default-rtdb.firebasedatabase.app") === "https://a-default-rtdb.firebasedatabase.app");
  check("short code rejected", SYNC.parsePairing("https://a.firebaseio.com,abc") === null);
  check("generated code is 24 chars", /^[A-Za-z0-9]{24}$/.test(SYNC.makeCode()));
}

console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
