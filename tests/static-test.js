/* Catches the deploy mistakes that only show up on a phone, offline:
   - a script the page loads but the service worker doesn't cache (works
     online, blank screen at the gym);
   - build stamps that disagree (the app refuses to start with a mixed set);
   - scripts loading in an order that breaks their dependencies. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const h = require("./harness");
const { check, section } = h;

const read = f => fs.readFileSync(path.join(h.ROOT, f), "utf8");
const sw = read("sw.js");
const html = read("index.html");

const VERSION = (sw.match(/^var VERSION = "([^"]+)";/m) || [])[1];
const assetsBlock = (sw.match(/var ASSETS = \[([\s\S]*?)\];/) || [])[1] || "";
const ASSETS = (assetsBlock.match(/"([^"]+)"/g) || []).map(s => s.slice(1, -1));
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

section("service worker");
check("VERSION found", !!VERSION, "sw.js must start a line with: var VERSION = \"...\";");
check("ASSETS found", ASSETS.length > 5);
ASSETS.filter(a => a !== ".").forEach(a => {
  check("cached file exists: " + a, fs.existsSync(path.join(h.ROOT, a)));
});

section("everything the page needs is cached for offline use");
scripts.forEach(s => check("script is precached: " + s, ASSETS.indexOf(s) !== -1));
[...html.matchAll(/<link [^>]*href="([^"]+)"/g)].map(m => m[1]).forEach(href => {
  check("linked file is precached: " + href, ASSETS.indexOf(href) !== -1);
});
const manifest = JSON.parse(read("manifest.webmanifest"));
(manifest.icons || []).forEach(i => check("manifest icon is precached: " + i.src, ASSETS.indexOf(i.src) !== -1));

section("script order");
const order = ["data.js", "model.js", "sync.js", "app.js"];
check("data.js, model.js, sync.js, app.js load in that order",
  order.every(s => scripts.indexOf(s) !== -1) &&
  order.every((s, i) => i === 0 || scripts.indexOf(order[i - 1]) < scripts.indexOf(s)));
check("app.js loads last", scripts[scripts.length - 1] === "app.js");

section("build stamps all say " + VERSION);
const stamps = {
  "index.html": (html.match(/<html [^>]*data-build="([^"]+)"/) || [])[1],
  "data.js": (read("data.js").match(/^const DATA_BUILD = "([^"]+)";/m) || [])[1],
  "model.js": (read("model.js").match(/^  var BUILD = "([^"]+)";/m) || [])[1],
  "qrcode.js": (read("qrcode.js").match(/BUILD: "([^"]+)"/) || [])[1],
  "sync.js": (read("sync.js").match(/^  var BUILD = "([^"]+)";/m) || [])[1],
  "app.js": (read("app.js").match(/^  var BUILD = "([^"]+)";/m) || [])[1]
};
Object.keys(stamps).forEach(f => {
  check(f + " stamp = " + stamps[f], stamps[f] === VERSION,
    "run: sh tools/set-build.sh " + (VERSION || "<build>"));
});

section("release checks against git");
{
  const { execFileSync } = require("child_process");
  const git = args => execFileSync("git", args, { cwd: h.ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
  let inGit = true;
  try { git(["rev-parse", "--is-inside-work-tree"]); } catch (e) { inGit = false; }
  if (!inGit) {
    console.log("  (not a git checkout — release checks skipped)");
  } else {
    // A file that exists here but isn't in git never reaches the live site:
    // the offline install would fail on it and every phone would get stuck.
    const files = Array.from(new Set(ASSETS.filter(a => a !== ".").concat(scripts, ["sw.js"])));
    files.forEach(f => {
      let tracked = true;
      try { git(["ls-files", "--error-unmatch", f]); } catch (e) { tracked = false; }
      check("in git: " + f, tracked, "run: git add " + f);
    });

    // Changed app files with the same build number as the live site would
    // never reach installed copies: they only update when VERSION changes.
    let live = null, ref = null;
    for (const r of ["origin/main", "main"]) {
      try { live = (git(["show", r + ":sw.js"]).match(/^var VERSION = "([^"]+)";/m) || [])[1]; ref = r; break; } catch (e) { /* try next */ }
    }
    if (!live) {
      console.log("  (no main branch to compare with — build-number check skipped)");
    } else {
      let changed = [];
      try { changed = git(["diff", "--name-only", ref, "--"].concat(files)).split("\n").filter(Boolean); } catch (e) { changed = []; }
      const next = live.replace(/(\d+)$/, n => String(Number(n) + 1));
      check(changed.length ? "app files changed since " + ref + ", and the build moved on from " + live : "no app files changed since " + ref,
        !changed.length || VERSION !== live,
        "changed: " + changed.join(", ") + " — run: sh tools/set-build.sh " + next);
    }
  }
}

section("every script parses");
scripts.concat(["sw.js"]).forEach(s => {
  let ok = true, err = "";
  try { new vm.Script(read(s), { filename: s }); } catch (e) { ok = false; err = e.message; }
  check(s, ok, err);
});

h.done(__filename);
