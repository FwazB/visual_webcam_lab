# Projection Mapping

A separate TouchDesigner project for aligning one image onto one flat surface.
It owns the calibration grid, four corners, brightness, blackout, and projector
window. Fuzz remains the local camera/audio effects project.

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
Fuzz's named sender **`body-synth-fuzz`**. Keep Fuzz running while using that
source. Fuzz's local preview continues to work independently.

The image travels through [Syphon shared memory](https://docs.derivative.ca/Syphon_Spout_Out_TOP)
on this Mac. No video goes through the trainer's WebSocket or across the
network. The mapper has no camera/audio capture, pairing code, or control
server. The Windows equivalent uses Spout and has not been tested here.

If the grid works but Fuzz is blank, verify Fuzz's `OUT`, that `local_texture`
is active, and that `fuzz_in` names the same sender. Switch back to Test pattern
to distinguish an input problem from projector alignment.

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

Both networks built at 1280×720 without operator errors in TouchDesigner
2025.33070. Native pixel checks passed for the test grid, corner inset, brightness,
blackout, and preserving calibration/display settings across a rebuild.
Both projects were opened as independent processes and the mapper received
Fuzz’s live 1280×720 image. The final export was re-expanded to verify its
16×9 grid, saved corners, and lack of capture caches or Fuzz components.
Physical alignment still requires a connected projector.
