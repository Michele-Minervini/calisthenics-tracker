# Milo has moved

Milo (formerly Big Six Tracker) now lives at
**https://michele-minervini.github.io/milo/**, with its code in
[Michele-Minervini/milo](https://github.com/Michele-Minervini/milo).

This repository only serves the old address,
`https://michele-minervini.github.io/calisthenics-tracker/`:

- **`index.html`** (and its exact copy **`404.html`**, which answers every
  other old URL)
  - **In a browser tab**, it forwards to the new address and keeps any
    `#sync=` or `#s=` link. Tabs share their saved data with the new address
    because it is the same site, so nothing needs moving.
  - **Inside an app installed from the old address** (an iPhone home-screen
    icon, a Mac Dock app), it stays on the page. That app's saved data
    belongs to it alone. The page:
    - shows what the app still holds;
    - lets you copy its sync link or save a backup file;
    - lists the steps to move to the new address.

    It only ever reads the saved data.
- **`sw.js`** switches off old installed copies: it deletes their offline copy
  at this path, removes itself and reloads them into the page above. **Keep it
  online** for as long as an old copy might still be opened somewhere.

## Changing it

Edit `index.html`, then copy it over `404.html`, which must stay identical.
Commit and push to `main`. There is no build step and no release number here.
Never push Milo itself to this repository.
