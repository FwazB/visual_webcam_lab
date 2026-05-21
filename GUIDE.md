# Visual Webcam Lab Guide

## What This App Does

This project contains several webcam-based visual tools:

- `/bass` helps practice bass fretboard shapes with MediaPipe hand tracking.
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

## Using `/bass`

Open:

```text
http://localhost:3000/bass
```

Allow camera access and hold the bass in frame. The app uses MediaPipe hand landmarks to infer finger positions and compare them against selected key/shape targets.

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
