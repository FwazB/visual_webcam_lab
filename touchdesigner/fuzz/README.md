# fuzz

A local TouchDesigner scene where the pitch you play colors the camera image,
while audio level and plucks drive feedback and short displacement pulses.
Its **Light Maps** view adds silhouette lighting to the same camera without
warping it. Both views live in Fuzz and share its local preview. Projector alignment and display routing
belong to the separate [Projection Mapping project](../projection_mapping/README.md).

## Run the engine

Use **TouchDesigner 2025.33070 or newer**. That build introduced the Web Server
DAT's Local Address parameter ([release notes](https://derivative.ca/release/202533070/75035)).
Older builds cannot safely bind this server to loopback; the builder leaves
the bridge off and reports the required upgrade.

1. Open **[fuzz.toe](fuzz.toe)** from this folder. The complete network and
   callbacks are embedded; the ordinary Fuzz view needs no helper or MCP setup.
   Light Maps requires the one-time local helper build below. If the saved
   project has no **Lights** page, rebuild it from the current source first.
2. Press **F1** for the local Fuzz output. Press **Esc** to return to the editor.
   This uses your camera image. If it is black, check `camera_in` has a working
   device and that the camera is uncovered. `OUT` is the final image;
   the `preview` Window COMP also provides a bordered local preview window.
3. Connect the Spark by USB and select it in `audio_in` → Device. Use a clean
   tone and play **one note at a time**. Fuzz detects pitch locally; no browser
   or pairing is needed. Otherwise it uses the default audio input.
   See the [Spark guide](../../docs/spark-pedal.md) for routing checks.
4. To also connect the trainer, in **Dialogs → Textport and DATs**, run:

   ```python
   print(op('/project1/fuzz').fetch('pairingCode'))
   ```

   Paste the code into the trainer's **TouchDesigner visuals** panel and connect
   to `ws://127.0.0.1:9980/body-synth`. It changes each time the project opens.
5. Song mode → Play sends the current chord and transport state; correctly
   detected chord tones trigger brief pulses. Stop clears the current pulse.

Opening this project activates camera/audio input and a paired, loopback-only
control server. Close the project to release its devices. Browser camera/audio
capture is independent and stops when its page is closed.

## Hear the guitar through the MacBook

Select the USB-connected Spark in `audio_in` → **Device**, then select
`/project1/fuzz` → **Audio monitor** and enable **Monitor guitar**. The
`speaker_monitor` output sends the pedal's USB audio to **MacBook Pro Speakers**.
**Speaker volume** starts at 0.25; the Mac's speaker volume also applies.
Shared project exports open with monitoring off.

Monitoring stops if the selected input is not an available Spark, capture has
an error, or the named speakers are unavailable. It does not monitor the Mac
microphone or follow the system's default output. Turn **Monitor guitar** off
to mute this route. This affects local playback only; pitch and visual analysis
continue. The browser trainer does not monitor guitar audio.

## Notes and colors

![Fuzz note colors around the circle of fifths](../../docs/pitch-colors.svg)

The colors follow an artistic circle-of-fifths palette: each clockwise step
is a fifth down, **E is yellow**, and **A is green**. This is a visual
mapping, not a universal music-theory color standard. Octaves share a color;
E2 and E4 are both E. The detected frequency determines the note, independently
of the trainer's selected song chord.

On `/project1/fuzz` → **Pitch Color**, **Pitch color amount** (`Tint`) ranges
from 0 to 1 and defaults to 1. Set it to 0 for the natural camera colors.
After a note ends, its tint holds briefly and fades back to the natural image.
Open the `pitch_monitor` viewer to see the detected note and Hz; this label is
local and is not included in `OUT` or the projector feed. The `PITCH` CHOP
exposes frequency, MIDI note, pitch class, confidence, active state and RGB
channels for inspection.

This estimates one pitch at a time from 65–1200 Hz. Distortion, echo, chord strums, backing
tracks and looper playback can confuse the detector. Start with clean isolated
notes before adding effects.

## Light Maps

Light Maps is a view inside the existing Fuzz project. It uses `camera_in` and
a local Apple Vision person mask to place animated light behind or in front of
your silhouette. The camera image remains undistorted. There is no third
TouchDesigner project to open.

On macOS, build the small helper once from the repository root using the
installed Apple command-line tools:

```sh
sh touchdesigner/fuzz/lights/build_mask_helper.sh
```

The executable stays in `lights/.build/person-mask`, which Git ignores.
The shader, Python callbacks, and worker are embedded when Fuzz is rebuilt;
the executable stays beside the project and is not bundled into `fuzz.toe`.
Keep the `lights` folder beside a working copy of the project if you use this mode.

Select `/project1/fuzz`, open the **Lights** custom page, and choose
**View → Light Maps**. Press **F1** to see the camera with the light overlay.

| Control | Default | Effect |
| --- | --- | --- |
| Behind me (`Behind`) | 0.6 | Light outside the person mask |
| In front of me (`Front`) | 0.2 | Subtle light within the person mask |
| Movement (`Speed`) | 0.4 | Animation speed |
| Light color | RGB 0.2, 0.65, 1.0 | Color of both light layers |

`light_maps/mask_status` shows whether a fresh person mask is available.
Include your head and torso in the camera frame: a tight crop or a partial
body changes segmentation. If the mask is missing or stale, the preview
shows the original camera and the light-only output is black.

Frames are reduced to 256×144 and submitted at up to 15 Hz through local
memory pipes. The helper uses Apple Vision on this Mac; it does not send
frames over the network or save raw frames. The worker replaces pending
frames instead of building a queue and rejects masks older than 350 ms.
Switching **View → Fuzz** stops the helper and makes the light-only output
black. Closing or rebuilding the project also releases the helper.

`/project1/fuzz/OUT` and the **`body-synth-fuzz`** sender carry the selected
camera preview. `/project1/fuzz/light_maps/OUT` publishes just the lights on
black as **`body-synth-light-map`**. In the existing Projection Mapping
project, choose **Source → Fuzz light map** for that light-only image.
Follow the [mapper guide](../projection_mapping/README.md) for physical
alignment. The person mask is a flat image, not a depth map or room model;
camera/projector separation and movement toward or away from the calibrated
surface can displace the projected light.

## Rebuild or export

To rebuild while this repository's project is open, run in the Textport:

```python
FUZZ_DIRECTORY = project.folder
exec(open(FUZZ_DIRECTORY + '/fuzz_build.py').read())
```

For a different project, set `FUZZ_DIRECTORY` to this checkout's
`touchdesigner/fuzz` directory. The builder only changes `/project1/fuzz`,
preserves visual settings, and restarts the bridge. Reconnect afterward.
Older builds can rebuild standalone visuals by setting
`FUZZ_BRIDGE_ENABLED = False` before running the script.

Keep ordinary working saves private. Incremental saves and backups in this
folder are ignored; only the audited `fuzz.toe` is tracked. Before replacing
that shared file:

1. Call the following in Textport, then save a separate staging `.toe`:

   ```python
   b = op('/project1/fuzz')
   b.op('audio_in').par.active = False
   b.op('pitch_callbacks').module.reset()
   b.op('PITCH').cook(force=True)
   b.par.View = 'fuzz'
   b.op('light_maps/mask_callbacks').module.reset()
   b.op('light_maps/MASK').cook(force=True)
   b.op('bridge_callbacks').module.prepare_for_export(b.op('bridge'))
   b.op('camera_in').par.device.val = ''
   b.op('camera_in').par.device.expr = "me.par.device.menuNames[0] if me.par.device.menuNames else ''"
   ```

   Audio capture is paused, pitch diagnostics are neutralized, and the mask
   helper is stopped before saving. The saved View is Fuzz, with a blank mask.
   The bridge stays off until reopening; pairing code, authenticated clients,
   hit pulse, transport and session are cleared. Check any other device fields
   for machine-specific identifiers before sharing.
2. Use Derivative's [toeexpand](https://docs.derivative.ca/Toeexpand) on the staging file and
   remove **every `.ts` entry** from its `.toe.toc`. These are cached CHOP
   samples; include pitch diagnostics as well as audio/trigger caches.
   Remove `.oldacbo` backup entries as well and check that `MASK` contains no
   cached camera or mask pixels.
   Restore `audio_in`'s Active setting in this expanded staging copy; preserve
   the remaining operator definitions (`.n` and `.parm`).
3. Run [toecollapse](https://docs.derivative.ca/Toecollapse) on the same staging
   filename. Both tools ship under the application's `Contents/MacOS` on macOS.
4. Expand the result again and inspect it: no cached `.ts` or `.oldacbo` files, prior pitch
   readings in other CHOP data, saved device IDs, local paths, or credentials.
   Storage appears as hex-encoded pickle
   payloads in `.n` files; inspect opcodes with `pickletools`, never execute
   an unknown pickle. The `dict` and `idict` pairing values must be `None`,
   and `fuzzClients` must be empty. Raw text searches alone miss storage.
5. Reopen and verify output, fresh pairing, loopback binding, and operator
   errors before copying the checked artifact to `fuzz.toe`. Check both views
   after building the local helper; do not include `.build` binaries or raw
   camera frames in the shared export.

TouchDesigner's [storage startup values](https://docs.derivative.ca/OP_Class)
prevent the pairing code from being saved. Removing sample caches is a
separate step: ordinary `.toe` saves can contain recent audio samples and pitch
readings. The detector's bounded audio history lives in Python module memory,
not saved operator storage.

## Controls and signals

| Control | Range / default | Effect |
| --- | --- | --- |
| Amount | 0–1 / 0.2 | Scales short onset and note-hit displacement in the Fuzz view |
| Feedback | 0–0.98 / 0.65 | Trail retention, mildly modulated by input level |
| Blackout | Off by default | Makes the preview and shared final image black while the internal scene keeps running |

| Signal | Source | Effect |
| --- | --- | --- |
| `PITCH` | Local pitch detector fed directly by `audio_in` | Note color, confidence and frequency |
| `ONSET` | RMS slope through a trigger envelope | Displacement burst |
| `AUDIO_LEVEL` | Smoothed RMS; Spark selected when present | Trail retention |
| `CHORD` | Authenticated `song.chord` and `note.hit` messages | Song state and a hit pulse that decays over 250 ms; does not choose the color |

The camera sits behind the faded feedback image so an opaque camera frame
cannot erase the entire trail. There is no idle displacement: each axis uses
`Amount × (0.08 × bounded onset + 0.04 × bounded hit)`. The new defaults are
gentler; rebuilds preserve previously saved control values. Audio visuals continue without the app or when
Song mode is stopped. The final authenticated client disconnect also clears
the hit pulse and song transport state.

## Connection and security

The Web Server DAT listens on **127.0.0.1 only**. It accepts the `/body-synth`
WebSocket path and requires a version-1 `hello` with the local pairing code
before commands. Welcome and a complete state snapshot confirm connection.

Only Amount, Feedback, Blackout, song chord/hit events, transport, and heartbeat
messages are accepted. The bridge validates types, finite numbers, ranges,
and an 8 KB message limit. It never evaluates app-supplied Python, files, or
operator paths. HTTP requests expose no state. This runtime bridge is separate
from the development MCP on port 9981.
The Lights-page controls are local TouchDesigner parameters.

The public HTTPS trainer may be unable to open a plain local WebSocket in
some browsers. If connection is blocked, use the locally served trainer; do
not disable browser security. See the trainer's connection panel for status.

## Local preview and optional projector feed

`preview` is a bordered Window COMP showing `OUT` on this computer.
Fuzz owns the camera/audio effect and its local controls; projector calibration
and display routing live in
[projection_mapping.toe](../projection_mapping/projection_mapping.toe).

For the separate mapper to use Fuzz, keep both projects open on the same Mac.
The `local_texture` Syphon Out TOP publishes the final `OUT` image under the
sender name **`body-synth-fuzz`**. Select that source in the mapper following
its [setup guide](../projection_mapping/README.md). For lights without the camera
image, choose the mapper's **Fuzz light map** source while Fuzz is in Light Maps
view; this uses **`body-synth-light-map`** from `light_maps/OUT`.
The image is shared locally;
the trainer's WebSocket still carries only chord, hit, transport, and control
messages. The mapper is optional for local Fuzz use and guitar pairing.

## Validation

Run Python regression tests with NumPy available (included with TouchDesigner):

```sh
python3 -m unittest discover -s touchdesigner/fuzz -p 'test_*.py' -v
```

Earlier regression and native checks covered pitch, harmonics, silence, stale
input, channel changes, and bridge security. Native pitch tests produced yellow
pixels for E2 (82.41 Hz), green for A2 (110 Hz), and natural colors after silence.
The prior saved Fuzz project reopened at 1280×720 without errors, and prior
checks verified separate-process Syphon transfer and trainer acknowledgments.

For the Light Maps release (`8199972`), all **51 Python tests** passed. The Apple Vision helper
compiled and native checks in TouchDesigner **2025.33230** confirmed:

- Missing masks leave the camera unchanged and the light-only output black.
  Full-person and empty-person masks suppress the opposite light layer;
  zero light controls preserve the camera and produce black light output.
- The mapper received a synthetic RGB signal through the actual
  `body-synth-light-map` sender with no receiver errors.
- A live person mask reached **Person mask ready**. Switching View back to
  Fuzz stopped the helper and cleared mask readiness without operator errors.
- A startup shader-uniform cache issue was fixed so mask readiness updates
  as frames arrive. After reopening the final saved file and selecting Light
  Maps, both mask readiness and the shader validity input reached 1, and the
  light-only output was nonzero (maximum 0.5059, mean 0.0503), without errors.

A static camera image showed the mask aligned with the torso. This does not
establish moving-person or physical projector alignment.

The Fuzz export at `8199972` was **17,362 bytes**, with **49 operator descendants**:
35 at the Fuzz level, including the Light Maps component, and 14 inside it.
Its embedded source matches the repository, credentials are blank, pitch
diagnostics are neutral, and capture caches, local paths, and saved device IDs
are absent. It reopened independently at 1280×720 with no operator errors,
fresh pairing, the bridge active on `127.0.0.1`, camera/audio active, and the
saved Fuzz view using Amount 0.2 and Feedback 0.65. The helper was present.
The mapper also reopened independently with nine operators and no errors.

The current speaker-monitor export is **17,762 bytes**, with **50 operator
descendants**: 36 at the Fuzz level and 14 inside Light Maps. The one additional
operator is `speaker_monitor`; no dependencies were added. Credential and cache
scans passed. In the native project, Spark USB audio routed to the MacBook's
built-in speakers at 44.1 kHz stereo, volume 0.25, and a 50 ms buffer, with no
operator errors or warnings. Monitoring correctly disabled when its toggle
was off, capture was off, or the Mac microphone was selected. Actual cable
unplugging and audible playback have not been verified.

Artifact hashes and audit evidence are in [the security audit](../../docs/security-audit.md).
Real-note pitch accuracy and physical projector alignment remain hardware tests.
