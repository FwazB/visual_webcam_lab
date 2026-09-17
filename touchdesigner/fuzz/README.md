# fuzz

A local TouchDesigner scene where guitar input and the trainer's Song mode
drive camera feedback, hue changes, and short displacement pulses.

## Run the engine

Use **TouchDesigner 2025.33070 or newer**. That build introduced the Web Server
DAT's Local Address parameter ([release notes](https://derivative.ca/release/202533070/75035)).
Older builds cannot safely bind this server to loopback; the builder leaves
the bridge off and reports the required upgrade.

1. Open a project containing `/project1`.
2. Open **Dialogs → Textport and DATs** and run:

   ```python
   exec(open('/Users/fb/dev/visualarts/body-synth/touchdesigner/fuzz/fuzz_build.py').read())
   ```

   For another checkout, set `FUZZ_DIRECTORY` to its `touchdesigner/fuzz`
   directory before running the script. Keep `bridge_callbacks.py` beside it.
3. Copy the **pairing code** printed in the Textport into the trainer's
   TouchDesigner panel. Connect to `ws://127.0.0.1:9980/body-synth`.
4. In Song mode, Play sends the current chord and transport state; correctly
   detected chord tones trigger brief pulses. Stop clears the current pulse.

The builder creates or updates operators only inside `/project1/fuzz`.
Re-running it preserves the pairing code and visual settings, restarts the
bridge, and stops its song transport. Connect again afterward.

The pairing code grants control of this local scene. It is kept in component
storage, and saving the project includes it. **Save a working `.toe` privately
outside this repository; never commit or share a project containing its code.**
The reproducible source files are the deliverable.

An older TouchDesigner build can run the standalone audio scene with the
network bridge explicitly disabled:

```python
FUZZ_BRIDGE_ENABLED = False
exec(open('/Users/fb/dev/visualarts/body-synth/touchdesigner/fuzz/fuzz_build.py').read())
del FUZZ_BRIDGE_ENABLED
```

## Controls and signals

| Control | Range / default | Effect |
| --- | --- | --- |
| Amount | 0–1 / 0.5 | Scales audio and note-hit displacement |
| Feedback | 0–0.98 / 0.9 | Trail retention, mildly modulated by input level |
| Blackout | Off by default | Makes the final output black while the internal scene keeps running |

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

## Projection

`projector` is a Window COMP showing `OUT`. Open it as a separate window on
the projector's display. Corner-pin mapping remains a separate future task.

## Validation

Run protocol/security regression tests without TouchDesigner:

```sh
python3 -m unittest discover -s touchdesigner/fuzz -p 'test_*.py' -v
```

The builder has been run in TouchDesigner 2025.33070: all 24 operators cooked
without errors at 1280×720, and the active listener was verified to bind only
to `127.0.0.1:9980`. The older 2025.32820 build was also checked: its bridge
stays off, and standalone visuals work. A non-commercial camera resolution
warning is expected when the selected camera requests a larger image.
The local trainer paired in Brave, acknowledged amount/blackout changes, and
advanced TouchDesigner's chord channel through Gm → C9sus4 → Dm7 while playing.
Direct WebSocket checks also verified authentication rejection, parameter
acknowledgements, heartbeat, and reconnect. Clients send close status `1000`;
this TouchDesigner build did not complete a close handshake with an empty frame.
Real Spark input, guitar response, and projector output still require physical
testing.
