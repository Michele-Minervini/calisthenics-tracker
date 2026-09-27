/* Records what an implementation of the data model outputs, so the tests can
   insist the next version outputs exactly the same. Used by
   tools/record-fixtures.js; the tests themselves only read the results. */

const { makeGen, fingerprint } = require("./gen");

const NOW = Date.UTC(2026, 8, 27, 10, 0, 0);
const SEED = 20260927;
const SANITIZE_CASES = 400;
const MERGE_CASES = 300;

const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// Sanitizing fills in missing dates from local time, so a recording made in
// New York wouldn't match a check run in Rome. Recordings and the checks that
// compare against them always run in UTC; the daylight-saving tests are the
// ones that deliberately vary the time zone.
function inUTC(fn) {
  const prev = process.env.TZ;
  process.env.TZ = "UTC";
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
}

// impl: { sanitizeState, defaultState, merge } from a FRESH page loaded with the
// clock frozen at NOW and Math.random seeded with SEED (see harness.load). Use
// a new page per call: regenerated ids consume the seeded random sequence.
function sanitizeFingerprints(impl) {
  return inUTC(() => {
    const gen = makeGen(SEED);
    const out = [];
    for (let i = 0; i < SANITIZE_CASES; i++) out.push(fingerprint(impl.sanitizeState(clone(input(gen, i)) || null)));
    return out;
  });
}

// Half the inputs in the old stored shapes (as a device updating from them
// holds), half in the data v5 shape with every entry kind.
function input(gen, i) { return i % 2 ? gen.state5() : gen.state(); }

function mergePairs() {
  const gen = makeGen(SEED + 1);
  const pairs = [];
  for (let i = 0; i < MERGE_CASES; i++) pairs.push([input(gen, i), input(gen, i + 1)]);
  return pairs;
}

// The i-th sanitize input, for pointing at a failing case.
function sanitizeInput(i) {
  const gen = makeGen(SEED);
  let x;
  for (let k = 0; k <= i; k++) x = input(gen, k);
  return x;
}

// Both orders are recorded: merge is meant to be symmetric, and where it
// isn't yet (equal prefsMts goes to the local side), that is pinned too.
function mergeFingerprints(impl) {
  return inUTC(() => mergePairs().map(([x, y]) => {
    const a = impl.sanitizeState(clone(x) || null) || impl.defaultState();
    const b = impl.sanitizeState(clone(y) || null) || impl.defaultState();
    return [fingerprint(impl.merge(clone(a), clone(b))), fingerprint(impl.merge(clone(b), clone(a)))];
  }));
}

module.exports = { NOW, SEED, SANITIZE_CASES, MERGE_CASES, clone, inUTC, sanitizeFingerprints, mergeFingerprints, mergePairs, sanitizeInput };
