/* Loads the app's own browser scripts into a Node `vm` context, so tests run
   the exact files the browser runs — no copies, no build step.

     const h = require("./harness");
     const t = h.load(["data.js", "model.js"], { now: Date.UTC(2026, 6, 1), seed: 7 });
     const MODEL = t.get("MODEL");

   Options:
     now   freeze the clock: `new Date()` and `Date.now()` return this instant,
           while `new Date(x)` still works normally.
     seed  make Math.random() deterministic (mulberry32).
     globals  extra globals, e.g. { fetch: fakeFetch }.

   Values coming back from the context are built by that context's own
   Array/Object, so compare with same() (JSON) rather than instanceof or
   deepStrictEqual. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

const ROOT = path.join(__dirname, "..");

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => { m.clear(); }
  };
}

function load(files, opts) {
  opts = opts || {};
  const ctx = vm.createContext({
    console,
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
    window: { crypto: webcrypto, AbortController },
    localStorage: memoryStorage()
  });
  // Extra globals the page would have, e.g. a fake fetch for sync tests.
  if (opts.globals) Object.keys(opts.globals).forEach(k => { ctx[k] = opts.globals[k]; });
  if (opts.now != null) {
    vm.runInContext(
      "(function (FIXED) {" +
      "  var Real = Date;" +
      "  class Frozen extends Real {" +
      "    constructor() { if (arguments.length) super(...arguments); else super(FIXED); }" +
      "    static now() { return FIXED; }" +
      "  }" +
      "  globalThis.Date = Frozen;" +
      "})(" + Number(opts.now) + ");", ctx);
  }
  if (opts.seed != null) {
    vm.runInContext(
      "Math.random = (function (a) { return function () {" +
      "  a |= 0; a = a + 0x6D2B79F5 | 0;" +
      "  var t = Math.imul(a ^ a >>> 15, 1 | a);" +
      "  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;" +
      "  return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(" + Number(opts.seed) + ");", ctx);
  }
  files.forEach(f => {
    const file = path.isAbsolute(f) ? f : path.join(ROOT, f);
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  });
  // Top-level `const` (data.js) isn't a property of the context object, but
  // evaluating the name inside the context reaches it.
  return { ctx, get: name => vm.runInContext(name, ctx) };
}

let passes = 0, fails = 0, finished = false;

// A test file whose async part never settles would otherwise just stop, with
// exit code 0, and look like a pass.
process.on("exit", () => {
  if (!finished) {
    console.log("  FAIL the test file stopped before it finished (a promise never settled?)");
    process.exitCode = 1;
  }
});

function check(name, cond, extra) {
  if (cond) { passes++; console.log("  ok   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "\n       " + extra : "")); }
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function section(title) { console.log("\n" + title); }

function done(file) {
  finished = true;
  console.log("\n" + path.basename(file) + ": " + passes + " passed, " + fails + " failed");
  if (fails) process.exitCode = 1;
}

module.exports = { ROOT, load, check, same, section, done };
