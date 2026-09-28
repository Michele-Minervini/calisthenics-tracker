# Milo (formerly Big Six Tracker) — Roadmap & Decisions

A running record of where the app is, what's next, and the reasoning behind
the choices — so the context survives across work sessions.

**Live app:** https://michele-minervini.github.io/calisthenics-tracker/

---

## Where we are

All tiers are built, tested, and deployed (service worker `bigsix-v10`).

| Tier | Shipped | What it added |
|------|---------|---------------|
| **Tier 0** | base | Six-axis radar ("star") chart, 10 rings each; step browser with per-exercise instructions, rep goals, and demo-video links; progress saved in the browser; backup via a shareable link. |
| **Tier 1** | v5 | Log a session (sets/reps or hold time); auto-detection of the Beginner/Intermediate/Progression standard with a move-up prompt; global rest timer; training-history list; downloadable full backup file. |
| **Tier 2** | v7–v8 | Weekly routine + "Today's session" card; smart nudge; ghost radar (past vs now); GitHub-style training heatmap; streaks; milestone timeline; per-exercise sparkline; edit a logged session; QR code for the backup link. |
| **Tier 3** | v9–v10 | Day detail (tap a heatmap square for that day's sessions); **optional cloud sync** across devices, paired by QR. |
| **Milo P1–P2a** | v16–milo-v18 | Renamed **Milo**. Data v5 (entry kinds, per-field settings sync, a new sync record, guards against old copies), tests; quick **gym day** log; home bars of **hard sets per muscle group this week** against 10–20 (arms/legs 20–40). Plan for the rest: `~/.claude/plans/i-want-to-rename-distributed-goblet.md` (P3 tabs, P4 gym exercises, P2b move to /milo/, P5–P7). |
| **Tier 4** | v15 | **The plan.** Every movement carries a prescription (exercise, sets, reps, standard being chased) derived from your current position; guided session walkthrough; 38 swap variations; exercise library; week view with a per-area "what's next" map. |

Each tier went through an adversarial multi-agent review before shipping; the
Tier 2 review caught a whole class of daylight-saving date bugs, now fixed and
regression-tested.

## Guiding principles (why the app is the way it is)

- **Free, no accounts, works offline.** Everything lives in the browser
  (`localStorage`); hosting is GitHub Pages. This is a hard constraint, not a
  default. Cloud sync (below) is opt-in and doesn't bend it: still free, still
  no account, and `localStorage` remains the real store.
- **No build step, no frameworks.** Plain HTML/CSS/JS. Editing a file and
  reloading is the whole workflow — approachable to maintain.
- **Generic calisthenics.** No references to any specific book or author,
  anywhere in the app or repo.
- **Verify by exercising, not by assuming.** New behaviour is checked in a real
  browser (and the QR encoder was validated by decoding its own output).

## Explicitly decided *against* (so we don't re-litigate)

- **Push notifications** — chose a gentle in-app nudge instead (real phone push
  is unreliable on iOS and needs the installed app + permissions).
- **User accounts, passwords, a server we run** — sync is done with a secret
  code against your own free database instead.
- **Any book/author references** — the app stands on its own.

## Offered but not chosen (easy to add later if wanted)

- Per-side (left/right) logging for the one-arm / one-leg exercises.
- Warm-up-set suggestions before working sets.
- A custom routine-day builder (currently: guided 2 / 3 / 6-day presets).

## Ideas for a possible Tier 3+

None committed — just a menu for later:

- Export the training log to a CSV/text file.
- Editable routine day-assignments (rearrange which movements fall on which day).
- Longer-range analytics (training-volume trends over weeks/months).
- A short first-run walkthrough for new users.
- Optional localization (e.g. an Italian UI).

## Working notes for future edits

- **Every deploy gets a new build: `sh tools/set-build.sh milo-vN`**, then
  `git add -A` and `sh tests/run.sh` (README has the four steps). The service
  worker only serves what it cached when its `VERSION` last changed — no
  background refreshing, which could mix two releases — so without a new build
  phones never see the change. The install downloads every file under a fresh
  URL and rejects the release unless each stamped file really carries
  `VERSION` (GitHub's CDN can serve a stale copy for a few minutes after a
  push); a failed install leaves the previous release running and retries
  later. If the cache is ever wiped (another app on the origin, or the
  browser), the worker downloads the release again on the next miss.
  `tests/static-test.js` fails when stamps disagree, when the page loads a file
  that isn't cached or isn't in git, or when app files changed but the build
  number didn't.
- **A new script needs five things:** a `<script>` tag in index.html (after
  model.js, before app.js), an entry in sw.js `ASSETS` and `STAMPED`, a
  `  var BUILD = "…";` stamp that tools/set-build.sh rewrites (add the file to
  its loop), the stamp in tests/static-test.js, and a `buildParts` entry at the
  top of app.js. static-test catches a missing ASSETS/STAMPED entry.
- **Weekly volume is counted, never stored** (training.js). Each hard set counts
  1 for its main muscle group and ½ for each helper (data.js `AREA_GROUPS`,
  per-step overrides, `VARIATION_GROUPS`); a quick gym day gives its groups'
  usual helpers ¼ per set (`QUICK_GROUPS`). Targets are the base range in
  `settings.vol` times `GROUP_INFO.scale` (arms and legs ×2). A new variation
  or step fails tests/data-test.js until it is mapped.
- **"Finishing an update"** is what app.js shows, before touching storage, if
  a launch ever gets files from two builds. Reload asks for the new release;
  a second time in a row it drops this app's offline copy (never its data) and
  loads from the network. Offline, it says so and reloads itself when the
  connection returns.
- **Cache names carry the app's path** (`milo-v18@/calisthenics-tracker/`),
  and cleanup only deletes this path's old versions (plus the pre-stamp
  `bigsix-vN` caches, and only when running at `/calisthenics-tracker/`, the
  one place that created them). Cache Storage is shared by the whole
  `michele-minervini.github.io` origin, so a global cleanup would wipe other
  apps' — and, after the planned move to `/milo/`, the old or new address's —
  offline copies. The korea-trip app on the same origin still does such a
  global cleanup; the self-repair above covers it.
- **When re-testing after a change, hard-reload / clear the service worker
  cache first** — a stale cache once made a correct fix look broken for a while.
- **Never do date math by adding `86400000` ms.** Use the calendar-day helpers
  (`startOfDay` / `addDays` / `dayDelta`) in `model.js`, or daylight-saving days
  silently drop or duplicate.
- **What gets stored is pinned by tests.** `model.js` holds the default state,
  the sanitizers every load / restore / sync goes through, and the merge.
  `tests/fixtures/sanitize-v4.json` (hand-written cases) and `recorded-v4.json`
  (fingerprints of 400 random states and 300 merges, both orders) record their
  exact output, taken from the code users had before the move;
  `tests/model-test.js` and `tests/merge-test.js` fail on any change. A
  deliberate change to the stored shape bumps `MODEL_VERSION` in `model.js`
  and re-records with `node tools/record-fixtures.js`, which refuses to run
  otherwise — never "fix the test" to match. Known and pinned on purpose: on
  equal `prefsMts` the local side's settings win, so merge isn't yet symmetric
  for settings; the next data version fixes it.
- **The backup-link payload order is frozen** (`PAYLOAD_ORDER` in `app.js`) so
  old links keep importing correctly — never reuse the radar's axis order for it.
- **Sync merges must stay commutative and idempotent.** Both devices run the
  same `merge()` with no server to arbitrate, so `merge(a,b)` and `merge(b,a)`
  have to produce byte-identical results — otherwise the two copies never
  compare equal and the devices push at each other forever. Every sort inside
  it falls back to the id for exactly this reason; a sort on timestamp alone is
  not a total order. `tests/merge-test.js` covers this.
- **The plan is derived, never stored.** `prescribe()` reads your current step
  and standard on every render. That is the whole reason the plan follows you
  when you level up — resist any urge to cache it, or it will go stale exactly
  when it matters.
- **An easier variation must never award a standard.** Variations are tagged
  `easier` / `same` / `harder` in `data.js`; `saveLog` skips the auto-detection
  for `easier` ones. Otherwise slow negatives would "earn" a step you can't do.
- **Data v5 (September 2026) and the sync cutover.** `model.js` defines the
  stored shape (top of the file). Log entries have kinds — calisthenics (no
  `kind`), `gym`, `quick`, `body` — so gym tracking can build on it; settings
  merge per field via `pm` stamps; merge is commutative, idempotent and
  associative (tests/merge-test.js checks all three on random states). Sync
  writes only `/u/<code>m5`; the old `/u/<code>` record is read-only and still
  merged in (training only, never settings) whenever an old copy of the app
  writes to it — until P7 retires that read (target: 60 days after cutover).
- **Settings carried over from v4 never beat a v5 choice.** Migration stamps
  them at the old `prefsMts`, capped at `MODEL.MIGRATED_PREFS_MAX` (the v5
  release instant), and every v5 change is stamped after it (`stampPref`).
  Otherwise an old copy still running after the update (an iPhone home-screen
  app resumes rather than reloads) could touch its rest timer and, once it
  migrated, undo a routine picked in v5. Don't move that constant.
- **Names from stored data are never used as plain-object keys.** Ids, split
  and equipment names pass format checks that "constructor" and "__proto__"
  also pass; lookup tables keyed by them are `Object.create(null)` (model.js
  `dict()`), such names are refused where a table is keyed by a setting
  (`plainName`), and app.js looks presets up by own key only.
- **Never strip data from a newer version.** `MODEL.isNewer()` guards every
  entry point: sync (the cloud is newer → pause, don't push), load (stored data
  is newer → read-only + banner, never save), another tab (same), restore
  (refused). Any change to the stored shape must bump `MODEL_VERSION`, so
  these guards can recognise it — and ship on its own, fix forward, never
  revert across a bump.
- **Reset / replace-from-backup mark themselves** (`milo.replaceAt`) so other
  open tabs adopt the result instead of merging the removed sessions back.
  With sync on, other devices still merge them back — that's inherent to a
  union merge and the dialogs say so.
- **Anything arriving from the network goes through `sanitizeState()`** before
  it is merged, same as a restored backup file. Treat the cloud copy as
  untrusted input, because anyone holding the sync code can write to it.
