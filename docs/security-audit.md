# Security audit — 2026-09-17

Scope: the web app, dependency lockfile and MCP launch configuration, local
Fuzz bridge, and all three retained TouchDesigner project files. This is a
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

## Evidence

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
bytes. The new ready-to-open Fuzz project is about 8 KB and contains only its
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
