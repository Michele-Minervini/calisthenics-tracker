/* sync.js against a fake Firebase: which records it reads and writes, how it
   tells "nothing stored yet" from "something we can't read", and that its
   config can't be clobbered by a stale copy from another tab. */

const h = require("./harness");
const { check, section } = h;

// A tiny stand-in for the Firebase REST API: a map of path → stored JSON.
function fakeFirebase() {
  const db = { data: {}, calls: [], status: null };
  db.fetch = function (url, opts) {
    const u = new URL(url);
    const path = u.pathname;
    const method = (opts && opts.method) || "GET";
    db.calls.push(method + " " + path);
    const reply = (status, body, headers) => Promise.resolve(new Response(body, { status, headers: headers || { ETag: "e1" } }));
    // A request that never gets an answer, until it's aborted — like real fetch.
    if (db.hang) {
      return new Promise((resolve, reject) => {
        const sig = opts && opts.signal;
        if (sig) sig.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    if (db.status) return reply(db.status, "{}");
    if (method === "GET") {
      if (db.raw && db.raw[path] !== undefined) return reply(200, db.raw[path]);
      const m = path.match(/^\/u\/([^/]+)\/updatedAt\.json$/);
      if (m) { const rec = db.data["/u/" + m[1] + ".json"]; return reply(200, JSON.stringify(rec ? rec.updatedAt : null)); }
      return reply(200, JSON.stringify(db.data[path] === undefined ? null : db.data[path]));
    }
    if (method === "PUT") {
      const ifMatch = opts.headers && opts.headers["if-match"];
      if (ifMatch && ifMatch === "stale") return reply(412, "{}");
      db.data[path] = JSON.parse(opts.body);
      return reply(200, opts.body, { ETag: "e2" });
    }
    return reply(405, "{}");
  };
  return db;
}

const CODE = "AbCdEfGhIjKlMnOpQrStUvWx";
const cfg = () => ({ url: "https://bigsix-test-default-rtdb.firebaseio.com", code: CODE, lastSync: 0 });
const blob = s => ({ blob: JSON.stringify(s), updatedAt: 1000 });

// Timers run 1000× faster, so the 15-second request timeout takes 15 ms.
const fastTimeout = (fn, ms) => setTimeout(fn, ms / 1000);

function page(db) {
  return h.load(["data.js", "model.js", "sync.js"], { globals: { fetch: db.fetch, Response, Headers, setTimeout: fastTimeout } });
}

(async () => {
  section("which record is read and written");
  {
    const db = fakeFirebase(); const SYNC = page(db).get("SYNC");
    await SYNC.pull(cfg());
    await SYNC.pull(cfg(), true);
    await SYNC.push(cfg(), { v: 5, areas: {} }, null);
    check("data v5 lives at /u/<code>m5", db.calls[0] === "GET /u/" + CODE + "m5.json");
    check("the old record is read at /u/<code>", db.calls[1] === "GET /u/" + CODE + ".json");
    check("writes only ever go to the v5 record", db.calls.filter(c => c.startsWith("PUT")).every(c => c === "PUT /u/" + CODE + "m5.json"));
    check("the v5 key still satisfies the rules' 20-character minimum", (CODE + SYNC.RECORD_SUFFIX).length >= 20);
  }

  section("absent, ok, unreadable");
  {
    const db = fakeFirebase(); const SYNC = page(db).get("SYNC");
    const k = "/u/" + CODE + "m5.json";
    check("nothing stored → absent", (await SYNC.pull(cfg())).status === "absent");
    db.data[k] = blob({ v: 5, areas: {} });
    const ok = await SYNC.pull(cfg());
    check("a state → ok, with the parsed state", ok.status === "ok" && ok.raw.v === 5 && ok.updatedAt === 1000);
    db.data[k] = { blob: "{not json", updatedAt: 1 };
    check("blob that isn't JSON → unreadable", (await SYNC.pull(cfg())).status === "unreadable");
    db.data[k] = { blob: 42, updatedAt: 1 };
    check("blob that isn't a string → unreadable", (await SYNC.pull(cfg())).status === "unreadable");
    db.data[k] = { blob: "5", updatedAt: 1 };
    check("blob that isn't an object → unreadable", (await SYNC.pull(cfg())).status === "unreadable");
    db.data[k] = { somethingElse: true };
    check("a record of another shape → unreadable, not absent", (await SYNC.pull(cfg())).status === "unreadable");
    db.raw = { [k]: "<html>oops" };
    check("a response that isn't JSON at all → unreadable", (await SYNC.pull(cfg())).status === "unreadable");
    db.raw = null; db.status = 401;
    let msg = "";
    try { await SYNC.pull(cfg()); } catch (e) { msg = e.message; }
    check("refused by the rules → a clear error", /security rules/.test(msg));
  }

  section("the old record's timestamp");
  {
    const db = fakeFirebase(); const SYNC = page(db).get("SYNC");
    check("no old record → null", (await SYNC.legacyStamp(cfg())) === null);
    db.data["/u/" + CODE + ".json"] = { blob: "{}", updatedAt: 777 };
    check("old record → its updatedAt", (await SYNC.legacyStamp(cfg())) === 777);
    check("read from just the timestamp, not the whole record", db.calls[db.calls.length - 1] === "GET /u/" + CODE + "/updatedAt.json");
  }

  section("writes");
  {
    const db = fakeFirebase(); const SYNC = page(db).get("SYNC");
    let conflict = false;
    try { await SYNC.push(cfg(), { v: 5, areas: {} }, "stale"); } catch (e) { conflict = !!e.conflict; }
    check("a write that lost the race reports a conflict", conflict);
    await SYNC.push(cfg(), { v: 5, areas: {} }, "fresh");
    check("the whole state is stored as one JSON string", typeof db.data["/u/" + CODE + "m5.json"].blob === "string");
  }

  section("a request that never gets an answer");
  {
    const db = fakeFirebase(); const SYNC = page(db).get("SYNC");
    db.hang = true;
    const msg = p => p.then(() => "resolved", e => e.message);
    check("reading gives up with a clear message", /took too long/.test(await msg(SYNC.pull(cfg()))));
    check("so does the old record's timestamp", /took too long/.test(await msg(SYNC.legacyStamp(cfg()))));
    check("so does writing", /took too long/.test(await msg(SYNC.push(cfg(), { v: 5, areas: {} }, null))));
  }

  section("config can't be clobbered by a stale copy");
  {
    const db = fakeFirebase(); const t = page(db); const SYNC = t.get("SYNC");
    SYNC.setConfig(cfg());
    const mine = SYNC.getConfig();
    check("config carries cutAt and legacyAt", mine.cutAt === 0 && mine.legacyAt === 0);
    check("update applies when the stored pairing matches", SYNC.updateConfig(mine, { legacyAt: 5 }) && SYNC.getConfig().legacyAt === 5 && mine.legacyAt === 5);
    // Another tab re-paired with a different code meanwhile.
    SYNC.setConfig({ url: mine.url, code: "ZzZzZzZzZzZzZzZzZzZzZzZz", lastSync: 0 });
    check("a stale tab's update is refused", SYNC.updateConfig(mine, { lastSync: 9 }) === false);
    check("…and the new pairing is left alone", SYNC.getConfig().code === "ZzZzZzZzZzZzZzZzZzZzZzZz" && SYNC.getConfig().lastSync === 0);
    SYNC.clearConfig();
    check("a stale tab can't resurrect sync that was turned off", SYNC.markSynced(mine, 10) === false && SYNC.getConfig() === null);
  }

  h.done(__filename);
})();
