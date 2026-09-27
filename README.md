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
- **It tells you what to do.** Every movement comes with a prescription — the
  exercise, the sets and reps, and which standard you're chasing — worked out
  from where you are right now. Move up a step and the next screen already asks
  for the new exercise's numbers; there is no plan to regenerate.
- **Guided sessions.** "Start session" walks you through the workout one
  movement at a time: warm-up, prescription, form cues, log it, rest, next.
  Close the app mid-workout and it resumes where you left off.
- **Swaps.** Each step offers alternatives that fit it — negatives, paused and
  tempo reps, grip changes, holds. Easier ones are marked *practice*: they get
  logged, but they can't award a standard you didn't earn.
- **Exercise library.** Every area's ten steps in one list, each with what it
  trains and the reps and sets for all three standards.
- **This week.** The whole rotation at a glance, plus what each area needs next
  and the rungs beyond it.
- **Ghost radar.** Toggle "Show where I started" to see your past shape behind
  today's. Settings can re-zero that line to today — handy at the start of a new
  training block — without touching your sessions or your steps.
- Everything is saved automatically in the browser (`localStorage`) — no
  account, no server, no cost. Settings gives you a quick progress **link**
  (progress only, also as a scannable **QR code**) and a full **backup file**
  (progress + history) to move between devices.
- **Optional cloud sync.** Turn it on once and your phone and laptop keep each
  other up to date by themselves — see [Cloud sync setup](#cloud-sync-setup).
- Works offline and can be installed on the iPhone home screen
  (Safari → Share → **Add to Home Screen**).

## Files — what is what

| File | Role |
|------|------|
| `index.html` | The page skeleton |
| `style.css` | All styling (light + dark theme) |
| `data.js` | The content: 60 exercises with rep goals, 38 variations, warm-ups |
| `app.js` | The logic: radar, navigation, logging, stats, saving/loading |
| `model.js` | The data rules: what a saved state looks like, how it's cleaned on load, how two devices merge |
| `qrcode.js` | Self-contained QR-code generator (no dependencies) |
| `sync.js` | Optional cloud sync: talks to your database |
| `tests/` | Automated checks — run with `sh tests/run.sh` (see below) |
| `tools/set-build.sh` | Sets the release number everywhere it must match |
| `sw.js` | Service worker — makes the app work offline |
| `manifest.webmanifest` + `icons/` | App name/icon for "Add to Home Screen" |

No frameworks, no build step: edit a file, reload the page, that's it.

## Run it locally

Browsers restrict some features on files opened directly, so serve the folder:

```bash
cd ~/Documents/Projects/calisthenics-tracker
python3 -m http.server 8642
```

Then open http://localhost:8642 in your browser.

## Cloud sync setup

Optional, and off until you do this. It stays free: the app uses Firebase's
no-cost Spark plan, which needs no credit card, and this app's data is a few
tens of kilobytes against a 1 GB allowance.

**Do this once, on a computer.**

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   sign in with your Google account. Click **Create a project**, give it any
   name (`bigsix` is fine), and turn Google Analytics **off** when it offers —
   you don't need it.
2. In the left sidebar open **Build → Realtime Database**, then
   **Create Database**. Pick the location closest to you (`europe-west1`) and
   choose **Start in locked mode** — the next step opens exactly the door you
   need and nothing more.
3. Open the **Rules** tab, replace everything with the block below, and click
   **Publish**:

   ```json
   {
     "rules": {
       "u": {
         "$code": {
           ".read": "$code.length >= 20",
           ".write": "$code.length >= 20",
           "blob": { ".validate": "newData.isString() && newData.val().length <= 1000000" },
           "updatedAt": { ".validate": "newData.isNumber()" },
           "$other": { ".validate": false }
         }
       }
     }
   }
   ```

   (The editor checks the syntax when you publish, so you'll know straight away
   if a character went missing in the copy.)

4. Go back to the **Data** tab. The line at the top, next to the 🔗 icon, *is*
   the database URL — copy that whole line. It ends in either of two ways
   depending on the region you picked, and both work:

   ```text
   https://bigsix-abbe9-default-rtdb.firebaseio.com
   https://bigsix-1234-default-rtdb.europe-west1.firebasedatabase.app
   ```

   (A trailing `/` is fine — the app trims it.)

**Then, in the app.** Open Settings → *Sync across your devices*, paste that URL
and press **Turn on**. The app invents a long random sync code and starts
syncing. On your phone, open Settings → *Connect another device* on the first
device and scan the QR code it shows — or paste the sync link. Both devices then
keep themselves up to date.

### What to know about it

- **The sync code is the password.** Those rules let anyone who knows the code
  read and write that one path — and nobody who doesn't. Guessing it is not
  realistic (24 random characters), but don't post the QR anywhere public. To
  revoke it, turn sync off on both devices and turn it back on: you get a new
  code, and the old data can be deleted from the Firebase console. There are
  two entries per code under `u`: `<code>m5` is the current one, and `<code>`
  (without the suffix) holds the data from before the September 2026 update,
  kept read-only while older copies of the app catch up.
- **Your devices are never overwritten, they're merged.** Sessions logged on two
  devices are combined, an edit beats an older copy, a deleted session stays
  deleted instead of coming back from the other device, and each setting syncs
  on its own (changing the rest timer on the phone won't undo a routine chosen
  on the laptop). Removing things is the one exception: with sync on, "reset"
  and "replace from backup" only clear this device, because the others still
  have the sessions and merge them back.
- **A device that falls behind stops instead of damaging anything.** If the
  cloud holds data from a newer version of the app, an older copy pauses
  syncing and asks to be reloaded rather than write over it; the same goes for
  a cloud copy it can't read (Settings then offers to replace it).
- **Offline is unchanged.** `localStorage` is still the real store. Without a
  network the app behaves exactly as before and catches up when it reconnects.
- **It costs nothing to leave on.** A day of training is a handful of requests
  against an allowance of 10 GB of downloads a month.

## Check your changes

```bash
sh tests/run.sh
```

It runs every check twice (Italian and US time, because date bugs hide in the
daylight-saving weeks) and ends with "All tests passed." The checks cover what
gets stored on load, how two devices merge, that every file the page needs is
available offline, and that a release is ready to ship. They need Node.js —
this Mac has it; on another computer, if `node --version` prints nothing,
install it from nodejs.org.

## Update the live site

Every release gets a new build number: one higher than the current one (the
`VERSION` at the top of `sw.js`; the tests tell you the right number if you
forget). Four steps:

```bash
sh tools/set-build.sh bigsix-v17
```

```bash
git add -A
```

```bash
sh tests/run.sh
```

```bash
git commit -m "describe what changed" && git push
```

The site updates itself in about a minute. An installed copy takes **two
opens** to switch: the first open, online, downloads the new release in the
background while still showing the old one; the next open shows it. On an
iPhone: open the app, wait a few seconds, swipe it away in the app switcher,
open it again. Settings → More shows which build a device is running.
**Skipping the build number means phones never update**, because the app is
served from an offline copy that only changes when the number does — the tests
catch that before you push.

## Ideas for later (v3+)

- Progress history charts (a timeline of when you climbed each step; a "ghost"
  radar of where you were months ago).
- Weekly routine templates with per-day checklists and a "Today" view.
- Consistency calendar / streaks; QR code for device transfer; reminders.
