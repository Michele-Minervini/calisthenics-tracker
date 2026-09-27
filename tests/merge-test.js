/* The merge that reconciles two devices, and the sync decisions built on it
   (MODEL.merge / reconcile / absorb). Scenarios that actually happen —
   two devices logging while apart, edits, deletes, conflicting settings, an
   old app still writing the old record — then the algebra that makes sync
   converge: merge must be commutative, idempotent and associative.
   Run with: sh tests/run.sh   (or: node tests/merge-test.js) */

const h = require("./harness");
const { check, section } = h;
const { makeGen } = require("./gen");

const page = h.load(["data.js", "model.js", "sync.js"]);
const MODEL = page.get("MODEL"), SYNC = page.get("SYNC");

const J = JSON.stringify;
const clone = x => JSON.parse(J(x));
const S = x => MODEL.sanitizeState(clone(x));                 // a clean v5 state
const mm = (a, b) => MODEL.sanitizeState(SYNC.merge(clone(a), clone(b)));

const T = Date.UTC(2026, 6, 1, 8, 0, 0);
const hour = 3600000;

function base() { return MODEL.defaultState(); }
function entry(id, ts, areaId, sets, mts, note) {
  return { id, ts, date: new Date(ts).toISOString().slice(0, 10), areaId, step: 1, sets, note: note || "", mts: mts || ts, variant: "" };
}
function gym(id, ts, exId, sets, kg, mts) { return { id, ts, kind: "gym", exId, sets, kg, note: "", mts: mts || ts }; }

section("two devices apart");
{
  const laptop = base(); laptop.log.push(entry("a1", T, "pushup", [10, 8]));
  const phone = base(); phone.log.push(entry("b1", T + hour, "squat", [20]), gym("g1", T + 2 * hour, "bench_bb", [8, 8], [60, 60]));
  const m = mm(laptop, phone);
  check("sessions from both devices survive, every kind", m.log.length === 3 && m.log.some(e => e.kind === "gym"));
  check("log sorted by time", m.log.map(e => e.id).join() === "a1,b1,g1");
}

section("edits and deletes");
{
  const a = base(); a.log.push(entry("a1", T, "pushup", [10, 8]));
  const b = base(); b.log.push(entry("a1", T, "pushup", [12, 12], T + hour));
  check("the newer edit wins", J(mm(a, b).log[0].sets) === "[12,12]" && J(mm(b, a).log[0].sets) === "[12,12]");

  const laptop = base(); laptop.log.push(entry("a1", T, "pushup", [10]), entry("a2", T + hour, "squat", [20]));
  const phone = clone(laptop); phone.log = phone.log.filter(e => e.id !== "a1"); phone.deleted.push({ id: "a1", ts: T + 2 * hour });
  const m = mm(laptop, phone);
  check("a delete survives a device that still has the entry", m.log.length === 1 && m.log[0].id === "a2");
  check("the tombstone travels on", m.deleted.length === 1 && m.deleted[0].id === "a1");
  check("still deleted after merging the stale device again", mm(m, laptop).log.length === 1);

  const edited = base(); edited.log.push(entry("a1", T, "pushup", [10], T + 3 * hour));
  const del = base(); del.deleted.push({ id: "a1", ts: T + 2 * hour });
  check("an edit made after the delete wins", mm(edited, del).log.length === 1);
  const tie = base(); tie.deleted.push({ id: "a1", ts: T + 3 * hour });
  check("a delete stamped exactly at the edit time wins", mm(edited, tie).log.length === 0 && mm(tie, edited).log.length === 0);

  const g1 = base(); g1.log.push(gym("g1", T, "bench_bb", [8], [60], T + hour));
  const g2 = base(); g2.deleted.push({ id: "g1", ts: T + 2 * hour });
  check("gym entries are deleted the same way", mm(g1, g2).log.length === 0);
}

section("area positions");
{
  const a = base(); a.areas.pushup = { step: 4, std: 1, mts: T };
  const b = base(); b.areas.pushup = { step: 5, std: 0, mts: T + hour };
  check("the newer change wins, either order", mm(a, b).areas.pushup.step === 5 && mm(b, a).areas.pushup.step === 5);
  const c = base(); c.areas.pushup = { step: 6, std: 2, mts: 0 };
  const d = base(); d.areas.pushup = { step: 3, std: 0, mts: 0 };
  check("unstamped tie goes to the further-along position", mm(c, d).areas.pushup.step === 6 && J(mm(c, d)) === J(mm(d, c)));
  const e = base(); e.areas.pushup = { step: 1, std: 3, mts: T };
  const f = base(); f.areas.pushup = { step: 2, std: 0, mts: T };
  check("same stamp, same value, different position: order doesn't matter", J(mm(e, f).areas) === J(mm(f, e).areas));
}

section("settings merge one field at a time");
{
  // The v4 bug: settings merged as one bundle, so a rest-timer change on the
  // phone undid a routine picked on the laptop.
  const laptop = base(); laptop.routine.split = "bb6"; laptop.pm.split = T + hour;
  const phone = base(); phone.settings.restSeconds = 90; phone.pm.restSeconds = T + 2 * hour;
  const m = mm(laptop, phone);
  check("the laptop's routine and the phone's rest time both survive", m.routine.split === "bb6" && m.settings.restSeconds === 90);
  check("each field keeps its own stamp", m.pm.split === T + hour && m.pm.restSeconds === T + 2 * hour);

  const p1 = base(); p1.settings.restSeconds = 120; p1.pm.restSeconds = T;
  const p2 = base(); p2.settings.restSeconds = 300; p2.pm.restSeconds = T;
  check("an exact stamp tie resolves the same on both devices", mm(p1, p2).settings.restSeconds === mm(p2, p1).settings.restSeconds);

  // A freshly paired device holds untouched defaults (stamp 0). Data carried
  // over from the old format always carries a stamp of at least 1.
  const migrated = S({ areas: {}, settings: { restSeconds: 120 }, routine: { enabled: true, daysPerWeek: 3, sessionIndex: 1 }, prefsMts: 0 });
  const fresh = base();
  const mf = mm(fresh, migrated);
  check("a fresh device's defaults never beat migrated settings", mf.settings.restSeconds === 120 && mf.routine.split === "bb3" && mf.routine.sessionIndex === 1);
  check("…in either order", J(mf) === J(mm(migrated, fresh)));
  check("a non-default value is always stamped", S({ v: 5, areas: {}, settings: { restSeconds: 60 }, routine: {}, pm: {} }).pm.restSeconds >= 1);
}

section("the old-format record");
{
  // An old app keeps writing the old record. Its sessions come in; its
  // settings never do.
  const mine = base(); mine.routine.split = "bb3"; mine.pm.split = T; mine.settings.restSeconds = 120; mine.pm.restSeconds = T;
  const oldRecord = { v: 4, areas: { squat: { step: 7, std: 1, mts: T + hour } }, log: [entry("old1", T + hour, "squat", [15])],
    settings: { restSeconds: 300 }, routine: { enabled: false, daysPerWeek: 3, sessionIndex: 0 }, prefsMts: T + 5 * hour, deleted: [], snapshots: [], milestones: [] };
  const r = MODEL.reconcile(mine, { status: "absent" }, { status: "ok", raw: oldRecord });
  check("its sessions and positions are merged in", r.state.log.some(e => e.id === "old1") && r.state.areas.squat.step === 7);
  check("its (newer!) settings are ignored", r.state.settings.restSeconds === 120 && r.state.routine.split === "bb3");
  check("the result is pushed to the new record", r.push === true && r.changed === true);

  const deleted = clone(r.state); deleted.log = deleted.log.filter(e => e.id !== "old1"); deleted.deleted.push({ id: "old1", ts: T + 6 * hour });
  const again = MODEL.reconcile(S(deleted), { status: "ok", raw: S(deleted) }, { status: "ok", raw: oldRecord });
  check("a session deleted here isn't brought back by the old record", !again.state.log.some(e => e.id === "old1"));

  // The old device deletes a session both records still have.
  const both = base(); both.log.push(entry("x1", T, "pushup", [5]), entry("x2", T + 1, "squat", [6]));
  const oldDel = { v: 4, areas: {}, log: [entry("x2", T + 1, "squat", [6])], deleted: [{ id: "x1", ts: T + hour }],
    milestones: [{ id: "om1", ts: T + 2, type: "advance", areaId: "squat", step: 3 }], snapshots: [{ d: "2026-07-01", v: [1, 2, 3, 4, 5, 6] }] };
  const rd = MODEL.reconcile(S(both), { status: "ok", raw: S(both) }, { status: "ok", raw: oldDel });
  check("a delete made on the old device removes the session here too", !rd.state.log.some(e => e.id === "x1") && rd.state.deleted.some(t => t.id === "x1"));
  check("…and the result is pushed, so the new record loses it as well", rd.push === true);
  check("its milestones and snapshots arrive", rd.state.milestones.some(m => m.id === "om1") && rd.state.snapshots.some(sn => sn.d === "2026-07-01"));

  // A freshly paired device (all defaults, unstamped) meets an old record
  // full of choices: none of them may leak in, however recent.
  const busy = { v: 4, areas: {}, log: [], settings: { restSeconds: 300, ghostBase: { d: "2026-07-01", v: [1, 1, 1, 1, 1, 1] } },
    routine: { enabled: true, daysPerWeek: 6, sessionIndex: 4 }, prefsMts: T + 9 * hour };
  const rf = MODEL.reconcile(S(base()), { status: "absent" }, { status: "ok", raw: busy });
  const d = S(base());
  check("a fresh device takes none of the old record's settings or routine",
    J(rf.state.settings) === J(d.settings) && J(rf.state.routine) === J(d.routine) && J(rf.state.pm) === J(d.pm));
}

section("an old copy of the app still running after the update");
{
  // Both devices were on v4, last synced with prefsMts P and a 3-day routine.
  const P = T;
  const v4 = { v: 4, areas: {}, log: [], settings: { restSeconds: 180 }, routine: { enabled: true, daysPerWeek: 3, sessionIndex: 0 }, prefsMts: P };
  // The laptop updates and picks 6 days a week.
  const laptop = S(v4); laptop.routine.split = "bb6"; laptop.pm.split = MODEL.stampPref(laptop.pm.split);
  // The phone, still on the old version, only changes its rest timer — a day
  // after the release — then finally updates.
  const phoneOld = clone(v4); phoneOld.settings.restSeconds = 90; phoneOld.prefsMts = MODEL.MIGRATED_PREFS_MAX + 86400000;
  const phone = S(phoneOld);
  const r = MODEL.reconcile(phone, { status: "ok", raw: laptop }, null);
  check("the phone's update doesn't undo the routine picked on the laptop", r.state.routine.split === "bb6");
  const other = MODEL.absorb(laptop, phoneOld);
  check("…nor does an old tab on the same device", other.state.routine.split === "bb6");
}

section("sync decisions (reconcile)");
{
  const mine = base(); mine.log.push(entry("a1", T, "pushup", [5]));
  const first = MODEL.reconcile(S(mine), { status: "absent" }, null);
  check("first device: nothing in the cloud → push", first.push && !first.changed);
  const synced = MODEL.reconcile(S(mine), { status: "ok", raw: S(mine) }, null);
  check("already in step → no write", !synced.push && !synced.changed);
  check("cloud from a newer version → do nothing", MODEL.reconcile(S(mine), { status: "ok", raw: { v: 6, areas: {} } }, null).newer === true);
  check("…also when the version is a string", MODEL.reconcile(S(mine), { status: "ok", raw: { v: "6", areas: {} } }, null).newer === true);
  check("unreadable cloud copy → blocked, never overwritten", MODEL.reconcile(S(mine), { status: "unreadable" }, null).blocked === true);
  check("cloud copy that isn't a state → blocked", MODEL.reconcile(S(mine), { status: "ok", raw: { v: 5, areas: [] } }, null).blocked === true);
  check("an old record from a newer version is ignored, not fatal", !MODEL.reconcile(S(mine), { status: "absent" }, { status: "ok", raw: { v: 9, areas: {} } }).blocked);

  const cloud = S(mine);
  const more = clone(cloud); more.log.push(entry("a2", T + hour, "squat", [8]));
  const up = MODEL.reconcile(S(more), { status: "ok", raw: cloud }, null);
  check("something new here → push, nothing changes locally", up.push === true && up.changed === false);
  const down = MODEL.reconcile(cloud, { status: "ok", raw: S(more) }, null);
  check("something new in the cloud → take it in, no write", down.changed === true && down.push === false && down.state.log.length === 2);

  // Over the caps: the merged state must be trimmed before it is compared
  // and pushed, or the next round would find something to write again.
  const ta = base(), tb = base();
  for (let i = 0; i < 700; i++) { ta.deleted.push({ id: "p" + i, ts: T + i }); tb.deleted.push({ id: "q" + i, ts: T + i + 0.5 }); }
  const r1 = MODEL.reconcile(S(ta), { status: "ok", raw: S(tb) }, null);
  const r2 = MODEL.reconcile(r1.state, { status: "ok", raw: r1.state }, null);
  check("over the tombstone cap: pushed once, then in step", r1.push && r1.state.deleted.length === 1000 && !r2.push && !r2.changed);
}

section("sync settles: after one round, the next has nothing to do");
{
  const gen = makeGen(777);
  const any = () => S(gen.rnd() < 0.5 ? gen.state5() : gen.state()) || base();
  // Records in the cloud are written by an app, so they are already clean
  // (every entry has its id and time); the old one is in the v4 shape.
  const asV4 = raw => {
    const x = S(raw);
    if (!x) return null;
    return { v: 4, areas: x.areas, log: x.log.filter(e => !e.kind), settings: { restSeconds: x.settings.restSeconds, ghostBase: x.settings.ghostBase },
      routine: { enabled: x.routine.split !== "off", daysPerWeek: Number(x.routine.split.slice(2)) || 3, sessionIndex: x.routine.sessionIndex },
      snapshots: x.snapshots, milestones: x.milestones, deleted: x.deleted, prefsMts: Number(raw.prefsMts) || 0 };
  };
  let bad = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    const local = any();
    const cloudRaw = gen.rnd() < 0.8 ? S(gen.rnd() < 0.5 ? gen.state5() : gen.state()) : null;
    const cloud = cloudRaw ? { status: "ok", raw: cloudRaw } : { status: "absent" };
    const oldRaw = gen.rnd() < 0.5 ? asV4(gen.state()) : null;
    const legacy = oldRaw ? { status: "ok", raw: oldRaw } : null;
    const r1 = MODEL.reconcile(local, cloud, legacy);
    if (!r1.state) continue;
    n++;
    const stored = r1.push ? r1.state : MODEL.sanitizeState(clone(cloud.raw));
    const r2 = MODEL.reconcile(r1.state, { status: "ok", raw: clone(stored) }, legacy);
    if (r2.push || r2.changed) bad++;
  }
  check("steady state for " + n + " random rounds (new and old formats, old record included)", bad === 0 && n > 200, bad + " rounds still had work");
}

section("another tab saved (absorb)");
{
  const mine = S(base());
  const other = clone(mine); other.log.push(entry("t1", T, "pushup", [7]));
  const r1 = MODEL.absorb(mine, other);
  check("its session is taken in, with nothing to write back", r1.changed && !r1.save && r1.state.log.length === 1);
  const mine2 = clone(r1.state); mine2.log.push(entry("t2", T + 1, "squat", [9]));
  const r2 = MODEL.absorb(S(mine2), other);
  check("this tab has more → write back", r2.save && r2.state.log.length === 2);
  // Two tabs taking each other in must settle, not ping-pong forever.
  const settled = MODEL.absorb(r2.state, r2.state);
  check("absorbing its own result changes nothing", !settled.changed && !settled.save);
  check("newer data from the other tab → read-only", MODEL.absorb(mine, { v: 6, areas: {} }).readOnly === true);
}

section("merge algebra on random states (old and new formats)");
{
  const gen = makeGen(4242);
  const pickState = () => S(gen.rnd() < 0.5 ? gen.state5() : gen.state()) || base();
  let comm = 0, idem = 0, assoc = 0, sanIdem = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const a = pickState(), b = pickState(), c = pickState();
    const ab = mm(a, b);
    if (J(ab) !== J(mm(b, a))) comm++;
    if (J(mm(ab, ab)) !== J(ab) || J(mm(a, a)) !== J(a)) idem++;
    if (J(mm(ab, c)) !== J(mm(a, mm(b, c)))) assoc++;
    if (J(S(ab)) !== J(ab)) sanIdem++;
  }
  check("commutative: merge(a,b) = merge(b,a) for all " + N, comm === 0, comm + " failures");
  check("idempotent: merge(a,a) = a", idem === 0, idem + " failures");
  check("associative: merge(merge(a,b),c) = merge(a,merge(b,c))", assoc === 0, assoc + " failures");
  check("sanitizing a merge result changes nothing", sanIdem === 0, sanIdem + " failures");
}

section("caps");
{
  const a = base();
  for (let i = 0; i < 1100; i++) a.deleted.push({ id: "d" + i, ts: T + i });
  const m = mm(a, base());
  check("tombstones capped at 1000, newest kept", m.deleted.length === 1000 && m.deleted[999].id === "d1099" && m.deleted[0].id === "d100");
}

section("pairing");
{
  const cfg = { url: "https://bigsix-1234-default-rtdb.europe-west1.firebasedatabase.app", code: SYNC.makeCode(), lastSync: 0 };
  const link = "https://michele-minervini.github.io/calisthenics-tracker/" + SYNC.pairingHash(cfg);
  const back = SYNC.parsePairing(link);
  check("pairing link round-trips", back && back.url === cfg.url && back.code === cfg.code, J(back));
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
  const file = path.join(__dirname, "fixtures", "recorded-v" + MODEL.MODEL_VERSION + ".json");
  section("merge output matches the recording for data v" + MODEL.MODEL_VERSION);
  if (!fs.existsSync(file)) {
    check("recording exists", false, "run: node tools/record-fixtures.js (after a deliberate MODEL_VERSION bump)");
  } else {
    const RECORDED = JSON.parse(fs.readFileSync(file, "utf8"));
    const impl = h.load(["data.js", "model.js", "sync.js"], { now: RECORDED.now, seed: RECORDED.seed });
    const M = impl.get("MODEL");
    const got = rec.mergeFingerprints({ sanitizeState: M.sanitizeState, defaultState: M.defaultState, merge: impl.get("SYNC").merge });
    const first = got.findIndex((p, i) => J(p) !== J(RECORDED.merge[i]));
    check("identical for all " + got.length + " pairs, both orders", first === -1,
      first === -1 ? "" : "first difference at pair " + first + " (tests/record.js mergePairs()[" + first + "])");
  }
}

h.done(__filename);
