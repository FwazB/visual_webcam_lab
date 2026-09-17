# fuzz

TouchDesigner network for chord-driven video distortion and projection:
the camera image runs through a feedback loop that warps, dims, and hue-shifts
in response to what you play.

## Run

1. Open TouchDesigner with a new or existing project (`/project1` must exist).
2. In the Textport (Alt+T) run:

   ```python
   exec(open('/Users/fb/dev/visualarts/body-synth/touchdesigner/fuzz/fuzz_build.py').read())
   ```

3. Save the project as `touchdesigner/fuzz/fuzz.toe`.

The script is safe to re-run: it creates missing operators and updates
parameters under `/project1/fuzz` only.

## What drives what

| Signal | Source | Effect |
| --- | --- | --- |
| `ONSET` | RMS slope of the audio input (Spark preferred) through a trigger envelope | displacement burst, small hue kick |
| `AUDIO_LEVEL` | smoothed RMS | feedback trail persistence, saturation |
| `CHORD` | JSON from the body-synth web app over `ws://127.0.0.1:9980` (`song.chord`, `note.hit` events) | hue offset per chord, extra warp on hits |

The web app does not send to the bridge yet; the audio path works on its own
in the meantime.

## Projection

`projector` is a Window COMP showing `OUT`. Open it as a separate window on
the projector's display. Corner-pin mapping onto real surfaces comes next.

## Editing live

With TouchDesigner open and the MCP configured (see
`docs/touchdesigner-mcp.md`), the network can be changed from Claude Code
without re-running the script.
