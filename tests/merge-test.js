/* Exercises SYNC.merge() against the scenarios that actually happen:
   two devices logging while apart, edits, deletes, conflicting steps,
   and the convergence property (merge order must not matter).
   Run with: sh tests/run.sh   (or: node tests/merge-test.js) */

const h = require("./harness");
const { check } = h;

// The real browser scripts, loaded as the page loads them.
const SYNC = h.load(["data.js", "model.js", "sync.js"]).get("SYNC");

const AREA_IDS = ["pushup", "squat", "pullup", "legraise", "bridge", "hspu"];

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

/* ---- Recorded behaviour: every merge rule, both orders, 300 random pairs ---- */
{
  const fs = require("fs");
  const path = require("path");
  const rec = require("./record");
  const MODEL = h.load(["data.js", "model.js"]).get("MODEL");
  const file = path.join(__dirname, "fixtures", "recorded-v" + MODEL.MODEL_VERSION + ".json");
  const RECORDED = JSON.parse(fs.readFileSync(file, "utf8"));
  const impl = h.load(["data.js", "model.js", "sync.js"], { now: RECORDED.now, seed: RECORDED.seed });
  const M = impl.get("MODEL");
  const got = rec.mergeFingerprints({ sanitizeState: M.sanitizeState, defaultState: M.defaultState, merge: impl.get("SYNC").merge });
  const first = got.findIndex((p, i) => JSON.stringify(p) !== JSON.stringify(RECORDED.merge[i]));
  check("merge output identical to the recording for all " + got.length + " pairs, both orders", first === -1,
    first === -1 ? "" : "first difference at pair " + first + " (tests/record.js mergePairs()[" + first + "])");
}

/* ---- The tie rules, spelled out ---- */
{
  // A delete stamped in the same millisecond as the entry's last edit wins.
  const a = baseState(); a.log.push(entry("t1", T, "pushup", [5], T + 10));
  const b = baseState(); b.deleted.push({ id: "t1", ts: T + 10 });
  check("tombstone at exactly the edit time deletes", SYNC.merge(a, b).log.length === 0 && SYNC.merge(b, a).log.length === 0);
  const c = baseState(); c.deleted.push({ id: "t1", ts: T + 9 });
  check("tombstone older than the edit loses", SYNC.merge(a, c).log.length === 1);

  // Same id, same mts, different content: the larger JSON wins, whichever side.
  const x = baseState(); x.log.push(entry("t2", T, "pushup", [5], T + 1));
  const y = baseState(); y.log.push(entry("t2", T, "pushup", [9], T + 1));
  const xy = SYNC.merge(x, y), yx = SYNC.merge(y, x);
  check("equal-mts edit clash is order-independent", JSON.stringify(xy.log) === JSON.stringify(yx.log));
  check("equal-mts edit clash keeps the larger JSON", JSON.stringify(xy.log[0].sets) === "[9]");

  // Same milestone id, two timestamps: the earliest is kept.
  const m1 = baseState(); m1.milestones.push({ id: "mx", ts: T + 5, type: "advance", areaId: "pushup", step: 3 });
  const m2 = baseState(); m2.milestones.push({ id: "mx", ts: T, type: "advance", areaId: "pushup", step: 3 });
  check("same milestone id keeps the earliest ts", SYNC.merge(m1, m2).milestones[0].ts === T && SYNC.merge(m2, m1).milestones[0].ts === T);

  // Settings: newer prefsMts wins; on a tie the LOCAL side currently wins.
  // (Known asymmetry, pinned here on purpose; the next data version fixes it.)
  const p1 = baseState(); p1.settings = { restSeconds: 120 }; p1.prefsMts = T;
  const p2 = baseState(); p2.settings = { restSeconds: 300 }; p2.prefsMts = T;
  check("equal prefsMts: local settings win (current behaviour)",
    SYNC.merge(p1, p2).settings.restSeconds === 120 && SYNC.merge(p2, p1).settings.restSeconds === 300);
  p2.prefsMts = T + 1;
  check("newer prefsMts wins either way",
    SYNC.merge(p1, p2).settings.restSeconds === 300 && SYNC.merge(p2, p1).settings.restSeconds === 300);
}

h.done(__filename);
