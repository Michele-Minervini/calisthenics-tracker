/* Re-records the expected outputs the tests compare model.js against.

     node tools/record-fixtures.js

   Only for a DELIBERATE change to what gets stored. It refuses to run unless
   MODEL_VERSION in model.js differs from the version the current fixtures were
   recorded for — changing the stored shape without bumping the version would
   let an older device silently strip the new data (see ROADMAP.md).

   Writes tests/fixtures/sanitize-v<N>.json (same hand-written inputs, new
   expected outputs) and tests/fixtures/recorded-v<N>.json (fingerprints of
   hundreds of random states and merges). Review the diff before committing. */

const fs = require("fs");
const path = require("path");
const h = require("../tests/harness");
const rec = require("../tests/record");

const FIX = path.join(h.ROOT, "tests/fixtures");
const MODEL = h.load(["data.js", "model.js"]).get("MODEL");
const version = MODEL.MODEL_VERSION;

const existing = fs.readdirSync(FIX).map(f => (f.match(/^sanitize-v(\d+)\.json$/) || [])[1]).filter(Boolean).map(Number);
const latest = Math.max.apply(null, existing);
if (existing.indexOf(version) !== -1) {
  console.error("Fixtures for data v" + version + " already exist. Bump MODEL_VERSION in model.js first —");
  console.error("a change to what gets stored must come with a new data version.");
  process.exit(1);
}

const prev = JSON.parse(fs.readFileSync(path.join(FIX, "sanitize-v" + latest + ".json"), "utf8"));
const fresh = () => h.load(["data.js", "model.js"], { now: prev.now, seed: prev.seed }).get("MODEL");
const cases = prev.cases.map(c => ({
  name: c.name,
  input: c.input,
  expected: JSON.parse(JSON.stringify(rec.inUTC(() => fresh().sanitizeState(rec.clone(c.input)))))
}));
fs.writeFileSync(path.join(FIX, "sanitize-v" + version + ".json"), JSON.stringify({
  about: "Expected sanitizeState output for each input under data v" + version + ", recorded by tools/record-fixtures.js with the clock frozen at `now` and Math.random seeded with `seed`.",
  modelVersion: version, now: prev.now, seed: prev.seed, cases: cases
}, null, 1) + "\n");

// A fresh page for each recording, exactly as the tests load one.
const impl = () => h.load(["data.js", "model.js"], { now: rec.NOW, seed: rec.SEED }).get("MODEL");
fs.writeFileSync(path.join(FIX, "recorded-v" + version + ".json"), JSON.stringify({
  about: "Fingerprints of sanitizeState and merge outputs for data v" + version + " over seeded random states (tests/gen.js), recorded by tools/record-fixtures.js.",
  modelVersion: version, now: rec.NOW, seed: rec.SEED,
  sanitize: rec.sanitizeFingerprints(impl()),
  merge: rec.mergeFingerprints(impl())
}) + "\n");

console.log("Recorded fixtures for data v" + version + " (previous: v" + latest + "). Review them with git diff before committing.");
