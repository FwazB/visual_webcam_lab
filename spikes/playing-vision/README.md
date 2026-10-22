# Playing vision lab — baseline, not a trained instrument recognizer

Isolated local experiment for body.synth. Existing `/bass`, audio scoring,
MediaPipe camera mirror and TouchDesigner files are untouched. Nothing here is
a Vercel route or a production tracker replacement.

## Run

From this directory:

```sh
npm ci --ignore-scripts
npm run setup
npm start
```

Open `http://127.0.0.1:4381` on the Mac (not a phone). Setup downloads public,
checksum-pinned detector and pose weights; no Hugging Face credential or paid
service is used. Dependencies and model weights are installed already in the
initial local experiment. Close the terminal server with Ctrl-C after use.

1. Load RTMPose; open a local image/video or explicitly start the camera.
2. Standard four-string E–A–D–G bass only. Keep the instrument fixed.
3. Set the two visible fret-wire numbers; nut = 0. Calibrate four intersections
   in the labeled E-first / G-first / E-last / G-last order. Reset calibration
   whenever the camera or neck moves. This is manual geometry, NOT automatic
   fretboard detection. Perspective is corrected by a homography; actual fret
   positions use equal-temperament spacing rather than equal pixel spacing.
4. Analyze frames, or run continuous analysis. Audio is a separate explicit
   action: video sound for uploaded videos, default microphone for a live camera.
   Select the intended input in OS/browser settings; no in-app device picker yet.
5. Read **Seen**, **Heard**, and **Matched / uncertain** separately. Multiple
   candidate positions remain ambiguous even if their pitches agree. Open strings
   cannot be inferred from an absent fingertip. A matching pitch never proves
   contact; no lesson target is used to guess a string. Model scores are not
   calibrated probabilities.
6. For labeling: pause continuous analysis, analyze the exact frame, enter its
   known string/fret and recording-session ID, then download the labeled frame.
   JSON contains raw resized PNG pixels (up to 1920×1080), hand boxes/crops,
   landmarks, manual calibration, timestamps, audio evidence and a separate human
   label. There is no automatic persistence, upload or training. These simple
   labels are a starting point; dense fingertip/contact/fretboard annotation is
   still needed for a joint model.

## Architecture and next model

`image -> RTMDet hand boxes -> RTMPose Hand -> manual neck geometry -> candidate
positions`, compared independently with the existing pitch AudioWorklet.

The proposed next model must consume **image pixels AND keypoints/calibration**,
not keypoints alone. No such model has been trained or represented as loaded.
Collect our own bass footage and dense annotations; keep whole recording sessions
separate for development and evaluation. Include same-pitch/different-string
examples, silence, occlusion and noncontact fingers. Do not treat audio-derived
or geometric predictions as ground truth. Original recordings stay private.

## Verification

```sh
npm test
python3 prepare_fixtures.py  # requires FFmpeg; public image + synthetic 55-Hz tone
# With npm start in another terminal:
node tests/browser-smoke.mjs
```

Seven core tests cover geometry, invalid/weak observations, SimCC decoding, input
channel normalization, blank frames and independent audio evidence. The 1080p
Chrome test executes the actual downloaded ONNX models on a public hand photo;
exercises calibration and pixel/label export; hears MIDI 33 from an actual
synthetic 55-Hz video via the existing worklet; rejects a blank image; exercises
fake camera/microphone start/stop; verifies private paths/cross-origin denial and
no off-origin browser requests. Fake-device tests do not activate physical
camera/microphone. Existing body.synth suite: 94 tests passed separately.

The image is NOT bass footage and manually drawing a calibration rectangle on
it validates UI plumbing, not musical accuracy. Observed initial inference times
varied from roughly 200 ms to 1 second across local browser runs; this is not a
latency benchmark or a real-time-performance claim. Worker/off-main-thread or
accelerated inference and representative latency measurement remain necessary.
The detector initially produced a false hand on a uniform black image; a tested
low-detail gate now rejects it. This does not solve arbitrary false detections.

## Privacy / scope

Loopback-only server, exact route allowlist, same-origin policy and host checking;
no write endpoints or analytics. Browser media never goes to an external server.
Models are public assets; `private/`, weights and node_modules are Git-ignored.
Local exports may contain identifying images; keep them out of source control.
No recording is saved unless the user downloads a labeled frame. Audio monitoring
is silent. Stop devices ends camera/mic tracks. No publish/deploy/commit performed.

## Sources and licensing

- RTMDet nano hand / RTMPose-m hand5 ONNX exports:
  https://huggingface.co/Tau-J/RTMPose (model card declares Apache-2.0).
  Exact archive SHA-256s are pinned in `setup_models.py`; extracted hashes and
  source URLs are in ignored `models/receipt.json`.
- Model reference: https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose
- Reference preprocessing/decoding:
  https://github.com/Tau-J/rtmlib/tree/main/rtmlib/tools
  Independent JS implementation; inspect exported pipeline metadata as well as
  runtime code. Detector BGR normalization differs from pose RGB normalization.
  Exported pose tensor metadata is 256×256 despite a stale 192×256 field in the
  packaged pipeline. SimCC outputs are [1,21,512] for both axes.
- ONNX Runtime Web: https://onnxruntime.ai/docs/tutorials/web/
  Installed runtime is pinned in this directory's lockfile (MIT upstream).
- Test fixture: OpenMMLab `tests/data/onehand10k/9.jpg`, downloaded only into ignored
  `private/`. Dataset imagery is not a product asset or our training corpus;
  no independent permission for redistribution is asserted.
- Existing `public/worklets/pitch-processor.js` is served read-only from this
  same body.synth repository; it is not copied or modified.
- GuiFiR-inspired joint task formulation remains research guidance only: no
  GuiFiR dataset, code or trained weights are used here. No LivingIP source used.

## Verdict: PARTIAL

Actual local model inference, audio plumbing and labeled-image export work.
Instrument-specific learned recognition, automatic neck localization, contact
reasoning, temporal stability, representative speed and real-playing accuracy
remain unverified or unimplemented. Do not replace the main trainer on this basis.
