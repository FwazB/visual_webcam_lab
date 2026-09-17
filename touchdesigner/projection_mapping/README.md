# Projection Mapping

A separate TouchDesigner project for aligning one image onto one flat surface.
It owns the calibration grid, four corners, brightness, blackout, and projector
window. It can receive Fuzz's camera/effects image or Fuzz's light-only map
through one shared local receiver. Fuzz and Projection Mapping are the two projects.

## Open and calibrate

1. Open **[projection_mapping.toe](projection_mapping.toe)** in TouchDesigner
   2025.33070 or newer. It starts with a generated 16×9 test grid and opens no output
   window automatically. Fuzz, a camera, and an internet connection are not
   required for calibration.
2. Select `/project1/projection_mapping` and open its **Mapping** parameter page.
   Keep **Source → Test pattern** while aligning the image.
3. Inside that component, select `projector`. Set **Display** to the connected
   projector; **Size → Fill** fills that display. Press **F1** to open the output
   and **Esc** to return to editing. Use a separate output window if you need
   to keep editing on your laptop while watching the projector.
4. Adjust **Top left**, **Top right**, **Bottom left**, and **Bottom right** on
   the Mapping page until the grid fits the surface. Coordinates run from
   `(0, 0)` at the bottom left to `(1, 1)` at the top right. The area outside
   the four corners is black. Brightness and Blackout affect this output only.
5. Save your calibrated working copy with **Save As** outside the repository.
   Rebuilding preserves the saved corners, source, brightness, blackout, and
   projector display settings.

This is a single four-corner surface mapper. Multiple surfaces, curved meshes,
and projector edge blending are not included.

## Use local Fuzz visuals

Open [Fuzz](../fuzz/fuzz.toe) as a **second TouchDesigner process**, leaving this
mapper open. On macOS, opening the other `.toe` from Finder starts its own
session; do not replace the current project with File → Open.

In the mapper, choose **Mapping → Source → Fuzz**. The `fuzz_in` TOP receives
Fuzz's named sender **`body-synth-fuzz`**. This feed includes the processed
camera image. Keep Fuzz running while using that source. Fuzz's local preview
continues to work independently.

## Use the Fuzz light map

In the existing Fuzz project's **Lights** page, select **View → Light Maps** following the
[Fuzz Light Maps guide](../fuzz/README.md#light-maps). Fuzz's preview combines
the camera and lights so you can see their placement. `/project1/fuzz/OUT`
and **`body-synth-fuzz`** carry that preview. The separate
`/project1/fuzz/light_maps/OUT` contains only lights on black and publishes
**`body-synth-light-map`** for the physical projector.

In this mapper, choose **Mapping → Source → Fuzz light map**. The existing
`fuzz_in` receiver switches to that sender; its name is retained for compatibility.
Keep Fuzz running in Light Maps mode; the Fuzz view stops the light-map worker
and makes its light-only output black. Switch back to **Test pattern** for
alignment or **Fuzz** for camera-based visuals. This mode lives inside Fuzz
and does not require a third project or process.

The image travels through [Syphon shared memory](https://docs.derivative.ca/Syphon_Spout_Out_TOP)
on this Mac. No video goes through the trainer's WebSocket or across the
network. The mapper has no camera/audio capture, pairing code, or control
server. The Windows equivalent uses Spout and has not been tested here.

If the grid works but a live source is blank, verify that source's output and
Syphon sender are active. `fuzz_in` should name `body-synth-fuzz` for Fuzz or
`body-synth-light-map` for Fuzz light map. Switch back to Test pattern to distinguish
an input problem from projector alignment.

For light that follows the camera view, place the camera close to the
projector's lens and point both in the same direction. Align the four corners
on a flat reference surface. This is a planar alignment, without depth sensing
or room reconstruction. A person moving closer to or farther from that surface
can produce parallax and displaced light; test that movement with the actual
camera and projector before relying on the alignment.

## Rebuild

With this repository's mapper project open, run in **Dialogs → Textport and
DATs**:

```python
exec(open(project.folder + '/projection_mapping_build.py').read())
```

For another working folder, use this checkout's absolute builder path. The
builder changes only `/project1/projection_mapping`. It uses nine built-in
operators, embeds no external media, and adds no package dependencies.

Keep ordinary incremental saves and backups private. Only the clean canonical
`projection_mapping.toe` is tracked in this folder; use **Save As** for your
venue-specific calibration.

## Validation

Earlier versions of both networks built at 1280×720 without operator errors in TouchDesigner
2025.33070. Native pixel checks passed for the test grid, corner inset, brightness,
blackout, and preserving calibration/display settings across a rebuild.
Both projects were opened as independent processes and the mapper received
Fuzz’s live 1280×720 image. The final export was re-expanded to verify its
16×9 grid, saved corners, and lack of capture caches or Fuzz components.
Physical alignment still requires a connected projector.

For the Light Maps update, sender selection and preservation across rebuilds
passed the Python parameter harness. Native TouchDesigner **2025.33230** checks
then received a synthetic RGB signal through the actual
`body-synth-light-map` sender: receiver mean RGB was approximately
`(0.2018, 0.4036, 0.5969)`, with no receiver errors. This verifies the shared
texture route, not physical projection alignment.

The current **4,338-byte** artifact reopened independently with exactly nine
operators, no Fuzz component or operator errors, and its 1280×720 test grid.
It was re-expanded and checked for capture caches, credentials, local paths,
and saved device identifiers. See [the security audit](../../docs/security-audit.md)
for artifact hashes. Moving-person and physical projector alignment still
require the actual camera and projector.
