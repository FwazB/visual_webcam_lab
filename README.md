# body.synth

A webcam-and-audio lab for playing and learning guitar and bass in the
browser. Next.js app, MediaPipe hand tracking, a home-grown neck detector,
an AudioWorklet pitch detector, Three.js visuals, and Tone.js.

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
2. Click **Connect guitar**. The Spark is picked automatically; otherwise
   choose it from the list. Allow the microphone permission.
3. Chrome on macOS: set the microphone mode to **Standard** (not Voice
   Isolation) in Control Center.

Lessons then advance note by note (yellow near the target, green on the
right pitch, red on a wrong note), and **Song** mode plays a chord loop with
a click and optional backing while scoring what you play. Without audio the
trainer falls back to vision-only shape matching.

Debug tools: append `?debug=1` (neck overlay details, audio panel with
levels, note log, thresholds and test tones, clip loader, pause, swap hands).
`?synthetic=1&debug=1` renders a synthetic neck instead of the camera.

More detail in [GUIDE.md](GUIDE.md).

## Layout

- `src/lib/instrument/`: instrument profiles (tuning, scale length, inlays),
  pitch math, positions, audio–vision fusion.
- `src/lib/neck/`: fret-wire detection, fret-law fit, tracking, overlay.
- `src/lib/audio/` and `public/worklets/pitch-processor.js`: device
  selection, MPM pitch detection, onset detection, note segmentation.
- `src/lib/lesson/`: step scoring, song charts, chart clock and song scorer.
- `src/components/FretLab.tsx`, `src/hooks/`: the trainer UI and hooks.

## Directions

- Desktop engine: [docs/touchdesigner-backend-redesign.md](docs/touchdesigner-backend-redesign.md)
  moves real-time media work into TouchDesigner with the web app as the
  control surface. Development uses the TouchDesigner MCP, see
  [docs/touchdesigner-mcp.md](docs/touchdesigner-mcp.md). Projects live in
  `touchdesigner/`: `fuzz/` (chord-driven video distortion and projection,
  see its README) and the earlier BassAura prototypes.
- Native Apple teaching app: [docs/apple-native-roadmap.md](docs/apple-native-roadmap.md).

## Verification

```bash
npm run lint
npm run build
npm audit
```

Security headers (including a report-only Content-Security-Policy) are set
in `next.config.ts`. Once the browser console shows no CSP reports in
production, rename the header to `Content-Security-Policy` to enforce it.
