# body.synth

A webcam-and-audio lab for playing and learning guitar and bass in the
browser, with TouchDesigner for visuals. Next.js app, MediaPipe hand
tracking, a home-grown neck detector, an AudioWorklet pitch detector,
Three.js visuals, and Tone.js.

Live: the body-synth project on Vercel deploys `main`.

## Routes

- `/guitar` and `/bass`: fretboard trainer. Tracks the fretting hand,
  detects the fret wires on the real neck, listens to the instrument over a
  USB interface (Positive Grid Spark), and scores lessons and songs.
- `/visualz`: projection-mapping style performance visuals driven by body
  segmentation, hand tracking, and audio.
- `/ascii`: body-mask ASCII webcam experiment.
- `/`: the original body.synth audio-file prototype.

## Quick start

```bash
npm ci
npm run dev
```

Open <http://localhost:3000/guitar>, allow the camera, sit facing the laptop
with the guitar held normally (right-handed: left hand frets).

## Spark / guitar input

1. Plug the Spark into the Mac over USB-C and power it on. Use a clean,
   low-gain preset with delay and reverb off.
2. Click **Connect guitar**. The Spark is picked automatically and its name
   shows in the green pill; otherwise choose it from the list. Allow the
   microphone permission.
3. Chrome on macOS: set the microphone mode to **Standard** (not Voice
   Isolation) in Control Center.

Without audio the trainer falls back to vision-only shape matching.

## Trainer modes

**Shapes**: pick a key and a shape (root, root+5th, triads, pentatonic box).
With audio, the lesson advances note by note: yellow when a finger is near
the target, green on the right pitch, red flash on a wrong note.

**Song**: a chord loop plays with a click and optional backing (kick, hats,
synth bass on the chord root) while every note you play is scored against
the current chord. Shows accuracy, streak, and wrong notes. The current
chord's voicing is drawn on the real neck and on the fretboard panel, with
finger numbers.

First chart: **YUKON** (Justin Bieber), G minor, C9sus4 → Dm7 → Gm, voiced
around the 3rd to 7th frets. Tempo defaults to 96 BPM and bars-per-chord to
1; published analyses disagree on both, so adjust them in the panel until
it matches the record.

Neck controls over the video: `Lock neck`, `−1 fret` / `+1 fret`,
`Flip nut↔bridge`, `Flip strings`, `Reset`. Side lighting that makes the
fret wires glint helps detection.

Debug tools: append `?debug=1` (neck overlay details, audio panel with
levels, note log, thresholds and test tones, clip loader, pause, swap hands
for left-handed players). `?synthetic=1&debug=1` renders a synthetic neck
instead of the camera.

More detail in [GUIDE.md](GUIDE.md).

## First test checklist (real guitar + Spark)

1. Open `/guitar?debug=1`, connect the Spark, confirm the pill shows its
   name and the panel reports the negotiated sample rate.
2. Raise only the left hand: fingertip circles must follow it. If they
   follow the picking hand, use `swap hands`.
3. Barre the low E: the index label must read `E|<fret>`. If it reads the
   high e, click `Flip strings`.
4. Overlay wires should sit on the real wires along the neck; slide the
   hand from fret 1 to 12 and the numbers must not change. Nudge or lock if
   needed.
5. Play open strings and a chromatic run in the audio panel: one note per
   pluck, cents near zero, no octave errors.
6. Song mode → Play, play the vamp, watch accuracy and streak.
7. Browser console: lines mentioning `Content-Security-Policy-Report-Only`
   are reports, not failures. Collect them so the policy can be enforced.

## TouchDesigner

Everything runs on the Mac; no server is involved.

```
browser (Vercel or localhost)  ── ws://127.0.0.1:9980 ──►  TouchDesigner
camera, hands, Spark pitch,        JSON: chord, hit,          video distortion,
chord scoring                      pitch, onset               projection output
```

Chrome treats loopback as a secure origin, so the hosted site can open that
socket directly.

- `touchdesigner/fuzz/`: chord-driven video distortion and projection. Run
  the build script from the Textport, then save `fuzz.toe`:

  ```python
  exec(open('/Users/fb/dev/visualarts/body-synth/touchdesigner/fuzz/fuzz_build.py').read())
  ```

  The audio path (Spark into TouchDesigner) works on its own; the chord
  bridge from the web app is defined in the network but the app does not
  send to it yet. See [touchdesigner/fuzz/README.md](touchdesigner/fuzz/README.md).
- Direction: [docs/touchdesigner-backend-redesign.md](docs/touchdesigner-backend-redesign.md)
  moves real-time media work into TouchDesigner with the web app as the
  control surface; message types live in `src/lib/touchdesigner/protocol.ts`.
- Authoring from Claude Code uses the TouchDesigner MCP, configured in
  `.mcp.json` and documented in [docs/touchdesigner-mcp.md](docs/touchdesigner-mcp.md).
  TouchDesigner must be open with the MCP `.tox` loaded for that to work.
- Earlier BassAura prototypes also live in `touchdesigner/`.

Native Apple teaching app direction: [docs/apple-native-roadmap.md](docs/apple-native-roadmap.md).

## Layout

- `src/lib/instrument/`: instrument profiles (tuning, scale length, inlays),
  pitch math, positions, audio–vision fusion.
- `src/lib/neck/`: fret-wire detection, fret-law fit, tracking, overlay,
  synthetic scene generator.
- `src/lib/audio/` and `public/worklets/pitch-processor.js`: device
  selection, MPM pitch detection, onset detection, note segmentation.
- `src/lib/lesson/`: step scoring, song charts, chart clock and song scorer.
- `src/components/FretLab.tsx`, `src/hooks/`: the trainer UI and hooks.

## Status

Verified: the neck detector, pitch detector, note tracker, and song scoring
on synthetic data in Node; lint, build, and `npm audit` clean; security
headers checked on a dev server.

Not yet verified: anything with a real guitar or the Spark, and the
TouchDesigner `fuzz` network has not been run inside TouchDesigner yet.

## Verification

```bash
npm run lint
npm run build
npm audit
```

Security headers (including a report-only Content-Security-Policy) are set
in `next.config.ts`. Once the browser console shows no CSP reports in
production, rename the header to `Content-Security-Policy` to enforce it.
Commits carry no AI attribution trailers (see `AGENTS.md`).
