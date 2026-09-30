# body.synth

A browser guitar and bass trainer that listens to your instrument, a small
multitrack recording studio, and TouchDesigner for visuals. Next.js app,
AudioWorklet pitch detection and recording, Tone.js click and backing, and
MediaPipe hand tracking for the camera mirror.

Live: the body-synth project on Vercel deploys `main`.

## Routes

- `/guitar` and `/bass`: fretboard trainer. Listens to the instrument over a
  USB interface (Positive Grid Spark), shows targets and the notes you play
  on a fretboard diagram, and scores lessons and songs.
- `/studio`: multitrack recorder for the guitar: record takes over a click,
  arrange and trim them, export a WAV.
- `/for-you`: practice picks, with an optional read-only Spotify connection.
  Matches your top tracks to verified lesson guides and ranks those sections
  by instrument, chosen comfort level, and practice goal.
- `/ascii`: body-mask ASCII webcam experiment.
- `/`: homepage. Six guitar strings, one per project: move the mouse across
  them to strum (tap on touch screens), tap **sound off** to hear them. The
  strings flash in the same circle-of-fifths colors as Fuzz. Below them, a
  card for every project, including the TouchDesigner ones.

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

## Songs for you / Spotify

Open `/for-you` for starter sections from 11 songs, including YUKON, Best Part,
Pink + White, Ain't No Sunshine, Stand By Me, and Feel Good Inc. Difficulty is
our estimate for the named practice section; it is not a full-song grade or
an assessment of your ability. Only YUKON has a scored chart in the trainer.
Other cards link to their educator's guide.

To use your own Spotify favorites:

1. Create a Web API app in the [Spotify dashboard](https://developer.spotify.com/dashboard).
   Development mode requires the app owner to have Spotify Premium and allows
   up to five authorized users. Add your own Spotify account to Users and Access.
2. Register the exact callback for the site you use:
   `https://body-synth-beta.vercel.app/for-you`, or
   `http://127.0.0.1:3000/for-you` locally. Spotify does not allow `localhost`.
   The page's setup panel shows its actual callback URL. The connection's
   privacy page is `/for-you/privacy` on that same origin.
3. Paste the app's **public Client ID** into the setup panel, then Connect
   Spotify and grant top-track access. Never enter a Client Secret.
   Optionally configure `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` before building to
   skip entering this public configuration on each device.

The app uses OAuth PKCE (`user-top-read` only) to fetch up to 50 top tracks
from the last four weeks. It matches title and artist to our independent
catalog, then ranks guides by the preferences you explicitly choose. Unknown
songs, covers, and different live/remix arrangements stay unassessed. No
Spotify audio, recommendation endpoint, listening profile, or AI model is used.

Tokens and tracks stay in browser memory and clear on reload or Disconnect.
A pending PKCE verifier/state is kept temporarily in session storage, expires
after ten minutes, and is consumed at callback. Only your practice preferences
and public Client ID persist locally. Disconnect also cancels in-flight
requests; revoke the saved Spotify authorization in your Spotify Apps settings
if desired. There is no background polling or playlist write access.

## Studio

`/studio` records the same USB input (the Spark is picked automatically) into
tracks on a timeline, like a small GarageBand.

- **Record:** press **● Rec** or `R`. One bar of count-in clicks plays first
  (toggle **count-in**), then the take records onto the armed track (● on the
  track; a new "Guitar" track is created if none is armed) until you stop. A
  new take replaces what is under it on that track; undo brings it back.
  Other tracks play while you record, so you can layer parts.
- **Edit:** drag a clip to move it, including to another track; drag its
  edges to trim; `S` splits the selected clip at the playhead; `⌫` deletes it.
  Moves snap to beats (**snap**, or hold `⌥` to skip). `⌘Z` / `⇧⌘Z` undo and
  redo. Scroll sideways to move along the timeline; `⌘`-scroll or pinch zooms.
- **Mix:** per-track mute, solo and volume; **Import audio** adds a file (a
  backing track, a loop) on a new track at the playhead; **Export WAV** renders
  every audible clip to a 16-bit stereo file.
- **Latency:** takes are shifted earlier by the browser's latency estimate so
  they line up with what you heard. If takes sound late or early, set
  **latency ms** yourself; it is remembered.

Takes record the pedal's processed tone (amp model and effects). Listen
through the pedal's headphones or line out; the browser does not echo the
input. The project autosaves in this browser (IndexedDB); export a WAV to keep
a copy anywhere else.

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

- `src/components/FretLab.tsx`: the trainer UI; `src/components/Studio.tsx`: the studio.
- `src/hooks/`: guitar pitch input, song transport, hand tracking,
  studio engine, TouchDesigner bridge, body segmentation (for `/ascii`).
- `src/lib/audio/` and `public/worklets/pitch-processor.js`: device
  selection, MPM pitch detection, onset detection, note segmentation.
- `src/lib/studio/` and `public/worklets/recorder-processor.js`: studio
  project model and edits, playback/recording engine, timeline drawing,
  WAV export, autosave.
- `src/lib/instrument/`: instrument profiles (tuning, frets, inlays), pitch
  math, fretboard positions.
- `src/lib/lesson/`: shapes, song charts, step and song scoring, beat clock,
  fretboard diagram drawing.
- `src/lib/touchdesigner/`: bridge client and protocol.
- `src/app/page.tsx`, `src/components/home/`, `src/lib/home/`: the homepage,
  its string physics and Karplus–Strong pluck sound, and the project list.
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
