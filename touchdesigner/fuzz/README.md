# fuzz

A local TouchDesigner scene where guitar input and the trainer's Song mode
drive camera feedback, hue changes, and short displacement pulses.
Its local preview works independently. Projector alignment and display routing
belong to the separate [Projection Mapping project](../projection_mapping/README.md).

## Run the engine

Use **TouchDesigner 2025.33070 or newer**. That build introduced the Web Server
DAT's Local Address parameter ([release notes](https://derivative.ca/release/202533070/75035)).
Older builds cannot safely bind this server to loopback; the builder leaves
the bridge off and reports the required upgrade.

1. Open **[fuzz.toe](fuzz.toe)** from this folder. The complete network and
   callbacks are embedded; no script execution or MCP setup is needed.
2. Press **F1** for the local Fuzz output. Press **Esc** to return to the editor.
   This uses your camera image. If it is black, check `camera_in` has a working
   device and that the camera is uncovered. `OUT` is the final image;
   the `preview` Window COMP also provides a bordered local preview window.
3. For guitar-driven visuals, select the Spark in `audio_in` → Device after
   plugging it in. Otherwise TouchDesigner uses its default audio input.
   The browser's **Connect guitar** selection is separate.
4. In **Dialogs → Textport and DATs**, run:

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
   b.op('bridge_callbacks').module.prepare_for_export(b.op('bridge'))
   b.op('camera_in').par.device.val = ''
   b.op('camera_in').par.device.expr = "me.par.device.menuNames[0] if me.par.device.menuNames else ''"
   ```

   The bridge stays off until reopening; pairing code, authenticated clients,
   hit pulse, transport and session are cleared. Check any other device fields
   for machine-specific identifiers before sharing.
2. Use Derivative's [toeexpand](https://docs.derivative.ca/Toeexpand) on the
   staging file. In its `.toe.toc`, remove only these cached sample entries:
   `project1/fuzz/audio_in.ts`, `audio_slope.ts`, `audio_smooth.ts`, and
   `onset_trigger.ts` (each has the same `project1/fuzz/` prefix).
3. Run [toecollapse](https://docs.derivative.ca/Toecollapse) on the same staging
   filename. Both tools ship under the application's `Contents/MacOS` on macOS.
4. Expand the result again and inspect it: no cached `.ts` files, saved device
   IDs, local paths, or credentials. Storage appears as hex-encoded pickle
   payloads in `.n` files; inspect opcodes with `pickletools`, never execute
   an unknown pickle. The `dict` and `idict` pairing values must be `None`,
   and `fuzzClients` must be empty. Raw text searches alone miss storage.
5. Reopen and verify output, fresh pairing, loopback binding, and operator
   errors before copying the checked artifact to `fuzz.toe`.

TouchDesigner's [storage startup values](https://docs.derivative.ca/OP_Class)
prevent the pairing code from being saved. Removing sample caches is a
separate step: ordinary `.toe` saves can contain recent audio samples.

## Controls and signals

| Control | Range / default | Effect |
| --- | --- | --- |
| Amount | 0–1 / 0.5 | Scales audio and note-hit displacement |
| Feedback | 0–0.98 / 0.9 | Trail retention, mildly modulated by input level |
| Blackout | Off by default | Makes the preview and shared final image black while the internal scene keeps running |

| Signal | Source | Effect |
| --- | --- | --- |
| `ONSET` | RMS slope through a trigger envelope | Displacement burst and hue kick |
| `AUDIO_LEVEL` | Smoothed RMS; Spark selected when present | Trail retention and saturation |
| `CHORD` | Authenticated `song.chord` and `note.hit` messages | Chord hue and a hit pulse that decays over 250 ms |

The camera sits behind the faded feedback image so an opaque camera frame
cannot erase the entire trail. Audio visuals continue without the app or when
Song mode is stopped. The final authenticated client disconnect also clears
the hit pulse and song transport state.

## Connection and security

The Web Server DAT listens on **127.0.0.1 only**. It accepts the `/body-synth`
WebSocket path and requires a version-1 `hello` with the local pairing code
before commands. Welcome and a complete state snapshot confirm connection.

Only the three controls above, song chord/hit events, transport, and heartbeat
messages are accepted. The bridge validates types, finite numbers, ranges,
and an 8 KB message limit. It never evaluates app-supplied Python, files, or
operator paths. HTTP requests expose no state. This runtime bridge is separate
from the development MCP on port 9981.

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
its [setup guide](../projection_mapping/README.md). The image is shared locally;
the trainer's WebSocket still carries only chord, hit, transport, and control
messages. The mapper is optional for local Fuzz use and guitar pairing.

## Validation

Run protocol/security regression tests without TouchDesigner:

```sh
python3 -m unittest discover -s touchdesigner/fuzz -p 'test_*.py' -v
```

The saved Fuzz project reopened in TouchDesigner 2025.33070 with 26 operators,
no operator errors, and 1280×720 output. F1 opens its bordered local preview
on the primary display. It contains no projector or mapping component. A
separate running mapper received the named `body-synth-fuzz` texture.

The bridge generated a fresh pairing code and bound only to `127.0.0.1:9980`.
Its 17 regression tests pass. The exported file contains no pairing code,
authenticated clients, camera identifier, or cached audio samples. Earlier
trainer checks verified chord changes, control acknowledgments and heartbeat.
Real Spark input, guitar response, and physical projector alignment still
require hardware testing.
