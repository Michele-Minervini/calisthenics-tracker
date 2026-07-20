# Big Six Tracker

A tiny personal web app to track progress through six fundamental bodyweight
movements — Pushups, Squats, Pullups, Leg Raises, Bridges and Handstand
Pushups — each organized as a ladder of ten progressively harder steps.

**Live app:** https://michele-minervini.github.io/calisthenics-tracker/

## What it does

- A six-axis radar ("star") chart, ten rings deep — one glance shows your
  current step in every area.
- Tap an area name (chart or card) for its ten-step ladder; tap a colored dot
  on the chart to jump straight to that area's current exercise. Every step
  shows short instructions, Beginner / Intermediate / Progression rep goals,
  tips for when it's too hard, and a demo-video link.
- **Log your workouts.** On any exercise, tap "Log a session", enter your sets
  and reps (or hold time), and save. The app checks the result against the
  goals and marks the standard you met automatically; when you hit the
  Progression goal it offers to move you up a step.
- **Rest timer.** One-tap presets (1/2/3/5 min) start a floating countdown that
  keeps running while you browse other exercises and pings when it's done.
- **Training history & progress.** The calendar button lists every session
  (tap one to edit it); the chart button opens a Progress view with a
  GitHub-style training heatmap, streak counters, and a milestone timeline.
  Each exercise shows a top-set sparkline over time.
- **Weekly routine + Today card.** Pick a 2/3/6-day split in Settings and the
  home screen shows today's session (ticks off as you log), plus a smart nudge
  when a movement is lagging.
- **Ghost radar.** Toggle "Show where I started" to see your past shape behind
  today's.
- Everything is saved automatically in the browser (`localStorage`) — no
  account, no server, no cost. Settings gives you a quick progress **link**
  (progress only, also as a scannable **QR code**) and a full **backup file**
  (progress + history) to move between devices.
- Works offline and can be installed on the iPhone home screen
  (Safari → Share → **Add to Home Screen**).

## Files — what is what

| File | Role |
|------|------|
| `index.html` | The page skeleton |
| `style.css` | All styling (light + dark theme) |
| `data.js` | The content: all 60 exercises, descriptions, rep goals |
| `app.js` | The logic: radar, navigation, logging, stats, saving/loading |
| `qrcode.js` | Self-contained QR-code generator (no dependencies) |
| `sw.js` | Service worker — makes the app work offline |
| `manifest.webmanifest` + `icons/` | App name/icon for "Add to Home Screen" |

No frameworks, no build step: edit a file, reload the page, that's it.

## Run it locally

Browsers restrict some features on files opened directly, so serve the folder:

```bash
cd ~/Documents/Projects/Calisthenics
python3 -m http.server 8642
```

Then open http://localhost:8642 in your browser.

## Update the live site

```bash
git add -A
git commit -m "describe what changed"
git push
```

…and the site updates itself in about a minute. **When you change any file,
also bump `VERSION` in `sw.js`** (v1 → v2 → …) so phones that installed the
app pick up the update.

## Ideas for later (v3+)

- Progress history charts (a timeline of when you climbed each step; a "ghost"
  radar of where you were months ago).
- Weekly routine templates with per-day checklists and a "Today" view.
- Consistency calendar / streaks; QR code for device transfer; reminders.
