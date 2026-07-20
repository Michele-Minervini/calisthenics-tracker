# Big Six Tracker — Roadmap & Decisions

A running record of where the app is, what's next, and the reasoning behind
the choices — so the context survives across work sessions.

**Live app:** https://michele-minervini.github.io/calisthenics-tracker/

---

## Where we are

All three tiers are built, tested, and deployed (service worker `bigsix-v8`).

| Tier | Shipped | What it added |
|------|---------|---------------|
| **Tier 0** | base | Six-axis radar ("star") chart, 10 rings each; step browser with per-exercise instructions, rep goals, and demo-video links; progress saved in the browser; backup via a shareable link. |
| **Tier 1** | v5 | Log a session (sets/reps or hold time); auto-detection of the Beginner/Intermediate/Progression standard with a move-up prompt; global rest timer; training-history list; downloadable full backup file. |
| **Tier 2** | v7–v8 | Weekly routine + "Today's session" card; smart nudge; ghost radar (past vs now); GitHub-style training heatmap; streaks; milestone timeline; per-exercise sparkline; edit a logged session; QR code for the backup link. |

Each tier went through an adversarial multi-agent review before shipping; the
Tier 2 review caught a whole class of daylight-saving date bugs, now fixed and
regression-tested.

## Guiding principles (why the app is the way it is)

- **Free, no accounts, no server, works offline.** Everything lives in the
  browser (`localStorage`); hosting is GitHub Pages. This is a hard constraint,
  not a default.
- **No build step, no frameworks.** Plain HTML/CSS/JS. Editing a file and
  reloading is the whole workflow — approachable to maintain.
- **Generic calisthenics.** No references to any specific book or author,
  anywhere in the app or repo.
- **Verify by exercising, not by assuming.** New behaviour is checked in a real
  browser (and the QR encoder was validated by decoding its own output).

## Explicitly decided *against* (so we don't re-litigate)

- **Push notifications** — chose a gentle in-app nudge instead (real phone push
  is unreliable on iOS and needs the installed app + permissions).
- **Cloud sync / accounts / any backend** — would break the free, no-account,
  offline promise.
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

- **Bump `VERSION` in `sw.js` on every deploy** (`bigsix-vN`), or installed
  copies keep serving the old cached files.
- **When re-testing after a change, hard-reload / clear the service worker
  cache first** — a stale cache once made a correct fix look broken for a while.
- **Never do date math by adding `86400000` ms.** Use the calendar-day helpers
  (`startOfDay` / `addDays` / `dayDelta`) in `app.js`, or daylight-saving days
  silently drop or duplicate.
- **The backup-link payload order is frozen** (`PAYLOAD_ORDER` in `app.js`) so
  old links keep importing correctly — never reuse the radar's axis order for it.
