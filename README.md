# body.synth

A browser guitar and bass trainer that listens to your instrument, with
TouchDesigner for visuals. Next.js app, an AudioWorklet pitch detector,
Tone.js click and backing, and MediaPipe hand tracking for the camera mirror.

Live: the body-synth project on Vercel deploys `main`.

## Routes

- `/guitar` and `/bass`: fretboard trainer. Listens to the instrument over a
  USB interface (Positive Grid Spark), shows targets and the notes you play
  on a fretboard diagram, and scores lessons and songs.
- `/ascii`: body-mask ASCII webcam experiment.
- `/` redirects to `/guitar`.

## Quick start

```bash
npm ci
npm run dev
```

Open <http://localhost:3000/guitar>, allow the camera, click **Connect guitar**
and allow the microphone.

## Spark PEDAL / guitar input

1. Plug the guitar into Spark PEDAL's instrument input, then connect the
   powered pedal to the Mac with a USB-C **data** cable. Use a clean,
   low-gain preset with delay, reverb, modulation, and the pedal looper off.
2. Click **Connect guitar**. The Spark is picked automatically and its name
   shows in the green pill; otherwise choose it from the list.
3. On macOS, set the microphone mode to **Standard** (not Voice Isolation)
   in Control Center.

The detector hears one pitch at a time: **pick chord notes separately**.
Monitor through the pedal's headphones or line outputs; the browser does not
echo the guitar. The click and backing use the computer's selected output.
Details and hardware limits: [Spark PEDAL guide](docs/spark-pedal.md).

## Trainer

Everything is scored from the pitch the trainer hears. The fretboard diagram
under the camera shows the targets, and each note you play pulses on it:
green when it was right, white otherwise. When a pitch exists in several
places on the neck, the pulse is drawn at the matching target, or at the
position nearest the current target.

- **Shapes:** pick a key and a shape (root, root + 5th, triads, pentatonic
  box). Play the targets in order: the current one is yellow, played ones
  turn green, a wrong note flashes the light red.
- **Song:** a chord loop with click and optional backing (kick, hats, synth
  bass on the chord root). Every note is scored against the current chord:
  accuracy, streak and wrong notes. With the transport stopped, the loop's
  chords can be practised one at a time.

First chart: **YUKON** (Justin Bieber), G minor, C9sus4 → Dm7 → Gm, voiced
around the 3rd to 7th frets. Tempo defaults to 96 BPM and bars-per-chord to
1; published analyses disagree on both, so adjust them until they match the
record.

Without a guitar connected, targets still show but nothing is scored. The
camera is a mirror with fingertip dots; practice works without it.

`?debug=1` adds the audio panel: levels, clarity, detected note, gate and
clarity thresholds, a 60 Hz notch, test tones per string, a chromatic sweep
that reports octave errors, and the note log.

## First test with a real guitar

1. Open `/guitar?debug=1`, connect the Spark, and confirm the pill shows its
   name and the panel reports the negotiated sample rate.
2. Play open strings and a chromatic run: one note per pluck, cents near
   zero, no octave errors.
3. Shapes mode: play the targets and watch each turn green and the pulse
   land on the right string and fret.
4. Song mode → Play, play the vamp, watch accuracy and streak.
5. Browser console: lines mentioning `Content-Security-Policy-Report-Only`
   are reports, not failures. Collect them so the policy can be enforced.

## TouchDesigner

Two TouchDesigner projects keep local visuals and projector setup separate:

| Project | Purpose |
| --- | --- |
| [Fuzz](touchdesigner/fuzz/fuzz.toe) | Pitch-colored camera visuals, a Light Maps view, local preview, and optional trainer pairing |
| [Projection Mapping](touchdesigner/projection_mapping/projection_mapping.toe) | Projector surface alignment and display output; receives Fuzz's camera preview or light-only map |

```
browser (Vercel or localhost) ── ws://127.0.0.1:9980/body-synth ──► Fuzz
Spark pitch, chord scoring        paired JSON: chord, hit,         camera distortion,
                                  transport, visual controls       local preview

Fuzz OUT ── local Syphon image: body-synth-fuzz ──► Projection Mapping (optional)
Fuzz light_maps/OUT ── lights only: body-synth-light-map ──► the same mapper
```

To pair the trainer, open `fuzz.toe` (TouchDesigner **2025.33070 or newer**),
print the pairing code in **Dialogs → Textport and DATs**, and paste it into
the trainer's **TouchDesigner visuals** panel:

```python
print(op('/project1/fuzz').fetch('pairingCode'))
```

The trainer then sends chord changes and note hits. Fuzz also analyzes its own
audio input, so it works without the browser. If the hosted page cannot reach
the loopback bridge, use the localhost app; no browser security flags are
needed.

- [Fuzz guide](touchdesigner/fuzz/README.md): device selection, pitch colors,
  Light Maps (build its helper with `sh touchdesigner/fuzz/lights/build_mask_helper.sh`),
  speaker monitoring, rebuilding, and safe export.
- [Projection Mapping guide](touchdesigner/projection_mapping/README.md):
  source selection, alignment, and display routing.
- [TouchDesigner MCP](docs/touchdesigner-mcp.md): authoring the networks from
  Claude Code (`.mcp.json`).
- Message types: `src/lib/touchdesigner/protocol.ts`.

## Layout

- `src/components/FretLab.tsx`: the trainer UI.
- `src/hooks/`: guitar pitch input, song transport, hand tracking,
  TouchDesigner bridge, body segmentation (for `/ascii`).
- `src/lib/audio/` and `public/worklets/pitch-processor.js`: device
  selection, MPM pitch detection, onset detection, note segmentation.
- `src/lib/instrument/`: instrument profiles (tuning, frets, inlays), pitch
  math, fretboard positions.
- `src/lib/lesson/`: shapes, song charts, step and song scoring, beat clock,
  fretboard diagram drawing.
- `src/lib/touchdesigner/`: bridge client and protocol.
- `touchdesigner/fuzz/`: Fuzz project, builder, bridge, and Light Maps source.
- `touchdesigner/projection_mapping/`: projector project and builder.

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

Security headers, including a report-only Content-Security-Policy, are set in
`next.config.ts`. Audit scope and limits: [docs/security-audit.md](docs/security-audit.md).
