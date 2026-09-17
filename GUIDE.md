# Visual Webcam Lab Guide

## What This App Does

This project contains several webcam-based visual tools:

- `/guitar` and `/bass` are fretboard trainers: hand tracking, automatic
  neck detection, and pitch detection from a USB guitar interface.
- `/visualz` turns a live performance into projection-mapping style visuals.
- `/ascii` is a body-mask ASCII webcam experiment.
- `/` keeps the older body.synth audio-file prototype.

The current creative focus is `/visualz`.

## Using `/visualz`

### 1. Open The Page

Use the deployed Vercel URL or run locally:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000/visualz
```

### 2. Camera

Allow camera access. The app uses:

- webcam video as the base visual feed
- MediaPipe body segmentation for the projection surface
- MediaPipe hand tracking for hand-origin effects

### 3. Audio Control

Click `Start control` and allow audio input.

The audio input is only a control signal. It does not replace your amp effects. Use either:

- laptop mic listening to your amp, or
- your amp/interface as the browser audio input

### 4. Projection Modes

Projection modes can be stacked:

- `Aura` - body/room glow and tone-colored silhouette.
- `Echo` - delayed trail behavior and smear.
- `Rift` - object-centered displacement waves.
- `Shatter` - attack-driven fragments/noise.
- `Pulse` - beat/strum flashes and strobes.

### 5. Background Sequence

Background sequences add room-scale visuals:

- `Off` - no extra sequence layer.
- `Orbits` - orbit effects around the tracked head.
- `Grid` - shader warp across the whole room/video feed.
- `Bursts` - rays emitted from tracked hands/fingertips.

### 6. Intensity And Color

- `Intensity` runs from `1-100`, with overdrive above `100`.
- `Color` sets the base projection color.
- Bass tone still modulates color around the selected base color.

## Using `/guitar` And `/bass`

Open:

```text
http://localhost:3000/guitar
http://localhost:3000/bass
```

Both routes run the same fretboard trainer with a different instrument profile
(`src/lib/instrument/profile.ts`).

### Neck detection

Allow camera access, sit facing the laptop, and hold the instrument normally
with the fretting hand (left) on the neck. The app:

- tracks the hands with MediaPipe and picks the fretting hand by handedness,
- detects the fret wires along the neck from the video and fits the fret-law
  (frets shrink by 2^(1/12) toward the bridge) to get absolute fret numbers,
- maps fingertips to (string, fret) on the real neck and on the panel below.

Side lighting that makes the fret wires glint helps. If the fret numbers are
off, use the buttons over the video: `−1 fret` / `+1 fret`, `Flip nut↔bridge`,
`Flip strings`, `Lock neck` (freezes the model once it is right), `Reset`.

### Guitar input (Spark PEDAL or any interface)

Click `Connect guitar`. The Spark is picked automatically when it is plugged
in over USB-C; otherwise choose an input from the list. Use a clean, low-gain
preset with delay and reverb off while practising; the pitch detector hears
the processed amp tone. On macOS set the microphone mode to `Standard` (not
Voice Isolation) in Control Center.

With audio connected:

- the lesson advances note by note: yellow when a finger is near the target,
  green when the right pitch is played, red flash on a wrong note,
- the played position is confirmed by fusing pitch with fingertip positions,
  and repeated disagreement auto-corrects the neck's fret numbering.

Without audio the lesson falls back to the vision-only shape match.

### Debug tools

Append `?debug=1` for the neck overlay details, the audio/fusion panel (levels,
note log, Δk histogram, thresholds, test tones and a chromatic sweep), a video
clip loader, pause, and `swap hands` for left-handed players.
`?synthetic=1&debug=1` renders a synthetic neck instead of the camera.

## Verification

Before pushing changes, run:

```bash
npm run lint
npm run build
npm audit
```

Useful stale-code checks:

```bash
npm ls --depth=0
npm audit
npm run lint
```
