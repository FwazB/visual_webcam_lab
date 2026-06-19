# visual webcam lab

Browser-based webcam visual experiments built with Next.js, MediaPipe, Three.js, and Tone.js.

## Routes

- `/` - original body synth / audio-file hand-control experiment.
- `/ascii` - webcam ASCII/body-mask visual.
- `/bass` - bass fretboard learning view with MediaPipe hand tracking.
- `/visualz` - live projection-mapping style visual instrument for guitar/bass performance.

## Apple Native Direction

The next product direction is native Apple teaching apps for regular guitar and bass. iPhone/iPad own the ARKit spatial fretboard overlays; Mac becomes the larger-screen lesson planner, fretboard explorer, and practice companion. Create ML comes later for instrument/fretboard recognition once the manual AR teaching flow works.

Roadmap: [docs/apple-native-roadmap.md](docs/apple-native-roadmap.md)

## Visualz

`/visualz` is a visual experience, not an audio effects processor. Your amp owns the sound. The browser uses camera, hand/body tracking, and audio input only as control signals.

Current controls:

- Projection modes: `Aura`, `Echo`, `Rift`, `Shatter`, `Pulse`. These can be stacked.
- Intensity: `1-100`, plus overdrive range above `100`.
- Color: base projection color, with tone-reactive modulation.
- Background sequence: `Off`, `Orbits`, `Grid`, `Bursts`.

Tracking behavior:

- MediaPipe selfie segmentation creates a body/room projection surface.
- MediaPipe hand tracking drives hand-origin burst effects.
- The body mask is converted into object center, bounds, area, and velocity for Three.js shader modulation.
- Grid mode warps the whole room/video feed in the shader.
- Orbits anchor around the tracked head area.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

For `/visualz`:

1. Allow camera access.
2. Click `Start control`.
3. Allow audio input access.
4. Select your instrument input or use the laptop mic listening to your amp.

## Scripts

```bash
npm run lint
npm run build
npm audit
```

## Stack

- Next.js 16
- React 19
- MediaPipe Tasks Vision
- Three.js
- Tone.js
- Tailwind CSS
