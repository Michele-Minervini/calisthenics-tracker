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
- Mark which goal you've met on your current step; when you hit the
  Progression goal the app offers to move you up a step.
- Progress is saved automatically in the browser (`localStorage`) — no account,
  no server, no cost. Settings → backup link moves progress between devices.
- Works offline and can be installed on the iPhone home screen
  (Safari → Share → **Add to Home Screen**).

## Files — what is what

| File | Role |
|------|------|
| `index.html` | The page skeleton |
| `style.css` | All styling (light + dark theme) |
| `data.js` | The content: all 60 exercises, descriptions, rep goals |
| `app.js` | The logic: radar drawing, navigation, saving/loading |
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

## Ideas for later (v2+)

- Workout log: record each session (date, exercise, sets, reps) and show
  history charts.
- Weekly routine templates with per-day checklists.
- Reminders, streaks, rest-timer between sets.
