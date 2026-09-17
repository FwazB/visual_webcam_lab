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
- `/visualz`: browser visual-effects prototype driven by body segmentation,
  hand tracking, and audio.
- `/ascii`: body-mask ASCII webcam experiment.
- `/`: the original body.synth audio-file prototype.

## Quick start

```bash
npm ci
npm run dev
```

Open <http://localhost:3000/guitar>, allow the camera, sit facing the laptop
with the guitar held normally (right-handed: left hand frets).

## Spark PEDAL / guitar input

1. Plug the guitar into Spark PEDAL's instrument input, then connect the
   powered pedal to the Mac with a USB-C **data** cable. Use a clean,
   low-gain preset with delay, reverb, modulation, and the pedal looper off.
2. Click **Connect guitar**. The Spark is picked automatically and its name
   shows in the green pill; otherwise choose it from the list. Allow the
   microphone permission.
3. On macOS: set the microphone mode to **Standard** (not Voice
   Isolation) in Control Center.

Without audio the trainer falls back to vision-only shape matching.
The detector listens to one pitch at a time: **pick chord notes separately**
for accuracy/streak scoring. Full strums and layered loops are not polyphonic
chord recognition. Monitor your guitar through the pedal's headphones or
line outputs; the browser does not echo the live guitar back to the output.
The browser's click/backing uses the computer's selected output.

The integration uses USB audio, not pedal footswitch or MIDI control. See
[the Spark PEDAL signal path and test guide](docs/spark-pedal.md) for the
hardware controls, input selection, and the limits still requiring a device test.

## Trainer modes

**Shapes**: pick a key and a shape (root, root+5th, triads, pentatonic box).
With audio, the lesson advances note by note: yellow when a finger is near
the target, green on the right pitch, red flash on a wrong note.

**Song**: a chord loop plays with a click and optional backing (kick, hats,
synth bass on the chord root) while every note you play is scored against
the current chord. Shows accuracy, streak, and wrong notes. The current
chord's voicing and finger numbers are drawn over your actual neck in the
live camera image. An optional **Fretboard reference** opens a separate diagram;
it stays collapsed by default so the camera view remains central.

First chart: **YUKON** (Justin Bieber), G minor, C9sus4 → Dm7 → Gm, voiced
around the 3rd to 7th frets. Tempo defaults to 96 BPM and bars-per-chord to
1; published analyses disagree on both, so adjust them in the panel until
it matches the record.

Neck controls over the video: `Lock neck`, `−1 fret` / `+1 fret`,
`Flip nut↔bridge`, `Flip strings`, `Reset`. Side lighting that makes the
fret wires glint helps detection.

Debug tools: append `?debug=1` (neck overlay details, audio panel with
levels, note log, thresholds and test tones, clip loader, pause, swap hands
for left-handed players). `?synthetic=1&debug=1` renders a labelled synthetic
test neck instead of the camera; **Use my camera** returns to the live image.

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

Two TouchDesigner projects keep local visuals and projector setup separate:

| Project | Purpose |
| --- | --- |
| [Fuzz](touchdesigner/fuzz/fuzz.toe) | Local camera/audio visuals, local preview, and optional guitar-trainer pairing |
| [Projection Mapping](touchdesigner/projection_mapping/projection_mapping.toe) | Projector surface alignment and display output; optionally receives Fuzz's local image |

Fuzz runs the trainer's local control server on the Mac; no cloud relay is involved.

```
browser (Vercel or localhost) ── ws://127.0.0.1:9980/body-synth ──► Fuzz
camera, hands, Spark pitch,       paired JSON: chord, hit,         camera distortion,
chord scoring                    transport, visual controls       local preview

Fuzz OUT ── local Syphon image: body-synth-fuzz ──► Projection Mapping (optional)
```

Use **TouchDesigner visuals** in the trainer and enter the pairing code printed
in TouchDesigner (instructions below). Connection is explicit and the code is kept only in memory.
The paired bridge requires TouchDesigner **2025.33070 or newer** for explicit
localhost binding; older builds can run the standalone visual network only.
Browser local-network rules vary: allow local access if requested; if the hosted
page blocks loopback, use the localhost app. No browser security flags are needed.

- Open [touchdesigner/fuzz/fuzz.toe](touchdesigner/fuzz/fuzz.toe) in TouchDesigner.
  Press **F1** to show the local camera-based Fuzz output; **Esc** returns to the editor.
  No build step or MCP is needed. The project generates a fresh pairing code
  each time it opens. In **Dialogs → Textport and DATs**, run:

  ```python
  print(op('/project1/fuzz').fetch('pairingCode'))
  ```

  Paste that code into the trainer's TouchDesigner panel. The trainer sends
  chord changes and note hits; warp, trails, and blackout use acknowledged
  engine state. TouchDesigner also analyzes its selected audio input locally.
  See [touchdesigner/fuzz/README.md](touchdesigner/fuzz/README.md) for device
  selection, rebuilding, and safe export instructions.
- For a projector, open the separate
  [Projection Mapping project](touchdesigner/projection_mapping/projection_mapping.toe).
  Fuzz's `local_texture` sender publishes `OUT` as `body-synth-fuzz` on the same
  Mac. Follow the [mapper guide](touchdesigner/projection_mapping/README.md)
  for source selection, alignment, and display routing. Fuzz works on its own;
  guitar pairing continues to use its existing port-9980 bridge.
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
- `touchdesigner/fuzz/`: local Fuzz project, builder, and guitar bridge.
- `touchdesigner/projection_mapping/`: separate projector project and builder.

## Status

Verified: the neck detector, pitch detector, note tracker, and song scoring
on synthetic data in Node; lint, build, and `npm audit` clean; security
headers checked on the local production server. Brave successfully paired
with TouchDesigner, changed visual controls, and drove its chord channel
through the YUKON loop. This does not establish real-guitar tracking accuracy.

Both saved TouchDesigner projects reopened independently at 1280×720 without
operator errors. The mapper received Fuzz from its separate process. Native
checks cover the calibration grid, corner mapping, brightness, blackout, and
calibration preservation. Real guitar/Spark input and physical projector
alignment still require hardware testing.

## Verification

```bash
npm run lint
npm test
npm run test:fuzz
npm run build
npm audit
# With a local server running, or pass the production URL:
npm run smoke -- http://127.0.0.1:3000
```

Security headers (including a report-only Content-Security-Policy) are set
in `next.config.ts`. Once the browser console shows no CSP reports in
production, rename the header to `Content-Security-Policy` to enforce it.
Audit scope, fixes, and remaining limitations: [docs/security-audit.md](docs/security-audit.md).
Commits carry no AI attribution trailers (see `AGENTS.md`).
