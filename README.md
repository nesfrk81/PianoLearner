# Piano Learner

Practice piano from **MIDI files**: staff + falling notes aligned with an on-screen keyboard, **USB MIDI** input, A/B loops, and optional practice modes.

## Use it online (GitHub Pages)

**Live app:** [https://nesfrk81.github.io/PianoLearner/](https://nesfrk81.github.io/PianoLearner/)

1. **Open the link** in a desktop browser (Chrome or Edge work well for **Web MIDI**).
2. **Enable sound** — click **“Tap to enable audio”** once. Browsers block audio until you interact with the page.
3. **Wait** for the piano soundfont to finish loading (progress is shown briefly).
4. **Load a MIDI file** — use **Open MIDI file** and pick a `.mid` / `.midi` from your computer.
5. **Play** — use the **Play** / **Pause** button or press **Space**.
6. **Settings** — click the **gear** (top right) to change practice track, mode, input latency, MIDI touch sensitivity, and **MIDI hardware** bindings.

### Main controls

| Action | How |
|--------|-----|
| Play / pause | **Play** button or **Space** |
| Seek | Click the **waterfall** (note lanes) |
| Scrub time | **←** / **→** (±0.5 s) |
| Jump to start | **Home** or **Jump to start** |
| Loop a section | Click the **sheet** to set a ~1 s loop, drag the **blue handles**, or use a **learned** Record control (see Settings → MIDI hardware) |
| Clear loop | **Clear loop**, **Esc**, or press the learned Record control again while looping |

### USB MIDI keyboard

- Connect the keyboard; the transport bar shows **MIDI:** plus your device name when Web MIDI is available.
- Optional: **Settings → MIDI hardware** — map **Play**, **Stop**, **Record** (loop / toggle), and **loop start/end** knobs. Watch the **log** while pressing buttons; click **Learn**, then send the same message again to bind.
- If **Play**/**Stop** are not mapped, standard **MIDI Start / Continue / Stop** messages still control playback.

### Practice modes (Settings)

- **Listen** — hear the MIDI playback.
- **Follow** / **Wait for notes** — use the app’s practice feedback (see the on-screen hints).

### Installing as an app (optional)

The site is a **PWA**; you can use the browser’s “Install” / “Add to desktop” option if you want a windowed shortcut.

---

## Run from source

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/`).

For a production build:

```bash
npm run build
```

`dist/` is what GitHub Actions deploys to Pages (see `.github/workflows/deploy-pages.yml`).

---

## Repository

[https://github.com/nesfrk81/PianoLearner](https://github.com/nesfrk81/PianoLearner)
