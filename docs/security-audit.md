# Security audit — 2026-09-17

Original audit at `b7e52ba`: the web app, dependency lockfile and MCP launch
configuration, local Fuzz bridge, and three retained TouchDesigner project files. This is a
source and local runtime review, not a penetration-test certification.

## Findings fixed

| Finding | Impact | Fix |
| --- | --- | --- |
| Late camera/microphone permission grants outlived navigation or cancellation | Capture could remain active after the UI stopped using it | Cancel pending camera starts on `/`, `/ascii`, and `/visualz`; stop superseded microphone streams and close partially created audio contexts |
| Fuzz pairing code persisted in saved component storage | Sharing the previous private project could disclose its local control credential | Save a blank startup value, clear runtime authentication before export, and generate a fresh code when opening the project |
| TD saves retained camera IDs and recent audio samples | Binary project files could disclose device metadata and small capture fragments | Remove the camera IDs and cached CHOP samples from all three distributable projects; use a runtime camera selection expression |
| Bare `npx` MCP launch could resolve/download a package outside the installed lockfile | Missing local dependencies could change the code being executed | Pin `touchdesigner-mcp-server` to exactly `2.0.0` and invoke its installed CLI through `node`; missing dependencies now fail closed |

The Fuzz export also saves the bridge inactive. Its embedded startup callback
checks the explicit `127.0.0.1` binding before enabling the listener. Unsupported
TouchDesigner versions leave it off.

## Original audit evidence

- `npm audit`: **0 known vulnerabilities**, 520 dependency records checked.
- `npm test`: **56 passed**, including 10 new media-lifecycle regressions.
- `npm run test:fuzz`: **17 passed**, including export sanitization, code
  generation, unsupported builds, and rejection of a public bind.
- ESLint, TypeScript, production build, and production-server smoke checks pass.
- Live TD listener observed only at `127.0.0.1:9980`. Direct WebSocket checks
  reject the previous saved code, unpaired controls, and oversized messages.
  HTTP returns 404 with an empty body.
- The 25-operator Fuzz network cooked with no operator errors before export.
  The final cache-stripped repository artifact reopened successfully: 25
  operators, no errors, 1280×720 output, a selected camera, and the F1 perform
  window showing its live (currently dark) image. Fresh-code pairing, control
  acknowledgment/restore, and heartbeat passed against that reopened project.
- Re-expanded final Fuzz artifact: 8,162 bytes; embedded callbacks match the
  reviewed Python source; pairing values are `None` in both saved storage
  dictionaries; authenticated clients are empty; transport is stopped;
  session is `None`; no cached `.ts` samples, saved camera UUID, or `/Users/`
  paths. SHA-256:
  `9021537b18d666b7c0125ea3d7aa925f55717fd153d772e995e2aee3a8106301`.
- Both retained BassAura snapshots were expanded, sanitized, rebuilt, and
  expanded again. Only their camera parameter and two cached sample entries
  changed; the other 84 entries remained byte-identical. Private originals
  were preserved outside the repository.
- Text credential-pattern scan found no private keys or recognizable provider
  tokens. Binary storage was separately decoded and inspected; plain searches
  alone would have missed the former pairing code.

TouchDesigner documents the [startup storage behavior](https://docs.derivative.ca/OP_Class)
and the [expand/collapse workflow](https://docs.derivative.ca/Toecollapse).
Safe export steps are in [the Fuzz README](../touchdesigner/fuzz/README.md).

## Size and dependencies

Removed 14,934 bytes of exact duplicate or unused files: the duplicate
`BassAuraPhase1.toe`, the unreferenced `handFretboard.ts`, and an unused instrument
barrel. Sanitizing the two remaining legacy projects removed another 6,960
bytes. At the original audit, the ready-to-open Fuzz project was about 8 KB and contained only its
scene, required startup code, and TD's standard project infrastructure.

No dependencies were added. Existing runtime dependencies have active callers;
removing Three, Tone, or MediaPipe would break existing routes. Development MCP
and tests were absent from the inspected production dependency traces.
`node_modules`, `.next`, incremental `.toe` saves, and generated caches remain
ignored, not source deliverables.

## Remaining limits

- CSP is **report-only**. Other configured security headers are enforced;
  CSP reports still need qualification across real browser/device workflows
  before switching to enforcement.
- Browser camera/audio permission cleanup is covered with controlled lifecycle
  tests. Real Spark input, guitar tracking accuracy, and physical projector
  alignment still need a hardware session.
- Opening the TD project starts local camera/audio capture independently of
  the browser. Closing its project releases that capture. Do not overwrite
  the audited shared `.toe` with an ordinary working save: sample caches need
  stripping again even though pairing-code storage is protected.
- Sanitization changes current repository files; historical Git revisions may
  still contain the older prototype camera IDs and short audio caches. No
  history rewrite was performed. The former Fuzz credential was in the private
  project and is rejected by the restarted bridge.
- Loopback pairing limits remote control; it does not isolate this program
  from other software already running as the same local user.

## Follow-up: separate local Fuzz and projection mapping

Fuzz now owns camera/audio effects, a primary-display preview, and the optional
local texture sender. Projection Mapping is a separate nine-operator project
with a generated calibration grid, four corners, brightness/blackout, and its
own display window. It has no capture devices, pairing credential, or listener.
Both files reopened independently without operator errors at 1280×720. The
mapper received Fuzz's image from a separate TouchDesigner process. Synthetic
texture-transfer and native calibration/persistence checks passed.
The 17 bridge regression tests passed again, and a fresh `npm audit` reported
zero known vulnerabilities across 520 dependency records.

The shared texture uses Syphon on this Mac; it does not introduce a network
video service. Local applications with Syphon support can receive that texture
while Fuzz is running. No dependencies were added. The new Fuzz file was
re-expanded and checked for blank pairing storage, removed audio caches and
camera IDs; the mapper contains no Fuzz processing or credential storage.
The original audit hashes above identify the pre-split artifacts.

Split artifacts at `cce5e5e` (SHA-256):

- `fuzz`: 8266 bytes, `88df7811b99e67301ece30b37dc0c84bff5af48eedc35c33674adee9689bed0e`.
- `projection_mapping`: 4250 bytes, `7ea8a76006772d80c1511248d82fd63f816f1f963c357a03f4bf21e4a01cd329`.

## Follow-up: local pitch colors

Fuzz now analyzes its existing audio input locally to choose a note color.
No new dependencies, listeners, remote processing, or protocol commands were
added. The detector uses TouchDesigner's bundled NumPy and keeps at most 4096
audio samples in module memory; it does not put audio history in saved storage.
The local note/Hz viewer is excluded from the shared visual output.

All 40 Python tests pass, including silence, stale/disabled capture, channel
and device changes, and the existing bridge security tests. Native 1280×720
checks confirmed E2/yellow, A2/green, silence release, and preserved controls.
The final file reopened with audio active, fresh pairing, and no operator
errors. A fresh dependency audit again reports zero known vulnerabilities.
The 32-operator export was expanded and inspected: every `.ts` cache was removed,
`PITCH.script` contains only neutral diagnostics, pairing storage is blank,
and embedded source matches the repository. No test sources or machine-specific
device identifiers remain.

At `a121810`, `fuzz.toe`: 12898 bytes, SHA-256
`7f8ad43c920267ab63e163909c89ccfe3878c548ad7e895ae1785158e5b47ca8`.

## Follow-up: Light Maps inside Fuzz

Light Maps is a view in the existing Fuzz project. The workflow still uses
two projects: Fuzz and Projection Mapping. No Node dependencies, network
listeners, or bridge commands were added. The macOS person-mask helper uses
Apple Vision locally, receiving 256×144 frames at up to 15 Hz through process
pipes. It stores no raw camera frames and makes no network requests. Its
compiled executable stays in the ignored `lights/.build` directory beside
the source, outside the shared `.toe`.

The worker keeps bounded frame state, replaces pending frames, and rejects
masks older than 350 ms. Native checks in TouchDesigner **2025.33230** observed
a live **Person mask ready** state and confirmed that switching back to Fuzz
stopped the helper and cleared mask readiness. Missing masks pass through the
camera preview and produce black light-only output. GPU pixel checks also
passed for zero light controls and full-person/empty-person mask boundaries,
without operator errors.

The selected camera preview remains on `body-synth-fuzz`; the dedicated
`body-synth-light-map` sender contains lights on black. Both use local Syphon
sharing, not network video. The mapper's existing receiver successfully
received a synthetic light-map signal with mean RGB approximately
`(0.2018, 0.4036, 0.5969)` and no receiver errors. A static camera image showed
torso-mask alignment; moving-person and physical projector alignment remain
unverified.

Both current artifacts were expanded and inspected. Embedded source matches
the repository; saved credentials are blank; `PITCH` diagnostics are neutral;
`MASK` has no pixel cache. `.ts` sample caches and `.oldacbo` backups were
removed. No saved device UUIDs, `/Users/` paths, or temporary paths remain.
The mapper reopened independently with nine operators, no Fuzz component,
no errors, and a 1280×720 test grid. Fuzz reopened independently with all 49
operator descendants, no mapper or operator errors, and 1280×720 output.
Its pairing code was fresh, the bridge was active on `127.0.0.1`, camera/audio
were active, and the saved Fuzz view used Amount 0.2 and Feedback 0.65.
The local helper was present.

A native startup check caught a cached shader validity input that kept the
light map black after the mask became ready. Its frame dependency was fixed
before the final export. After reopening that final artifact and enabling
Light Maps, a delayed live check confirmed mask readiness and shader validity
were both 1, with nonzero light output (maximum 0.5059, mean 0.0503), no operator
errors, and no helper error.

Current artifacts (SHA-256):

| Artifact | Bytes | Operators | SHA-256 |
| --- | ---: | ---: | --- |
| `fuzz.toe` | 17,362 | 49 descendants: 35 at root, 14 inside Light Maps | `0c697baf91a626f99faec99517d8496d0e3c90413260459ad11b7dd7508fe111` |
| `projection_mapping.toe` | 4,338 | 9 | `292628544caf83121b9862ce8a70a2ee4b8a8c593576bfbb0e0b985ed73f985e` |

Current checks: **51 Python tests**, **64 Node tests**, lint, and production
build pass. `npm audit` reports **0 known vulnerabilities** across **520**
dependency records. The earlier CSP and physical-hardware limitations above
still apply.
