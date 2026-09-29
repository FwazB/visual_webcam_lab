# Security audit

Scope: the web app, dependency lockfile and MCP launch configuration, the
local Fuzz bridge, and the two shared TouchDesigner projects. This is a
source and local runtime review, not a penetration-test certification. First
audited at `b7e52ba` (2026-09-17); later changes were reviewed as they landed.

## Findings fixed

| Finding | Impact | Fix |
| --- | --- | --- |
| Late camera/microphone permission grants outlived navigation or cancellation | Capture could remain active after the UI stopped using it | Cancel pending camera starts on unmount; stop superseded microphone streams and close partially created audio contexts (covered by `tests/media-lifecycle.test.cjs` and `tests/guitar-input.test.cjs`) |
| Fuzz pairing code persisted in saved component storage | Sharing the project could disclose its local control credential | Save a blank startup value, clear runtime authentication before export, and generate a fresh code when opening the project |
| TD saves retained camera IDs and recent audio samples | Binary project files could disclose device metadata and small capture fragments | Strip cached CHOP samples and device IDs before export; select the camera with a runtime expression |
| Bare `npx` MCP launch could resolve/download a package outside the lockfile | Missing local dependencies could change the code being executed | Pin `touchdesigner-mcp-server` to exactly `2.0.0` and invoke its installed CLI through `node`; missing dependencies fail closed |

## Current design

- **Bridge.** The Fuzz Web Server DAT listens on `127.0.0.1:9980` only and is
  saved inactive; its startup callback checks the explicit loopback binding
  before enabling it, and unsupported TouchDesigner versions leave it off. It
  requires a version-1 `hello` with the pairing code, accepts only Fuzz
  controls, song chord/hit events, transport and heartbeat, validates types
  and ranges with an 8 KB limit, and never evaluates app-supplied code or
  paths. HTTP returns 404 with an empty body.
- **Local media.** Fuzz shares images with the mapper over Syphon on the same
  Mac, not network video. The Light Maps helper uses Apple Vision locally,
  receives 256×144 frames at up to 15 Hz through process pipes, stores no raw
  frames, makes no network requests, and its binary stays in the ignored
  `lights/.build`. The pitch detector keeps at most 4096 samples in module
  memory, not saved storage. Speaker monitoring defaults off and only routes
  a selected Spark input to the built-in speakers.
- **Studio recordings.** `/studio` keeps its project and recorded audio in the
  browser's IndexedDB for this origin only; nothing is uploaded. Clearing
  site data or **New** deletes it.
- **Web app.** Fully client-side: no API routes, server actions or secrets.
  Security headers are set in `next.config.ts` and checked by
  `npm run smoke`.

## Shared artifacts

Both files were expanded and inspected before commit: embedded source matches
the repository, pairing storage is blank, authenticated clients are empty,
`PITCH` diagnostics are neutral, `MASK` has no pixel cache, and no `.ts`
sample caches, `.oldacbo` backups, device UUIDs, `/Users/` or temporary paths
remain. Both reopen independently at 1280×720 without operator errors.

| Artifact | Bytes | Operators | SHA-256 |
| --- | ---: | ---: | --- |
| `touchdesigner/fuzz/fuzz.toe` | 17,762 | 50 (36 at root, 14 in Light Maps) | `d7a0623f1236b96a6d89c367648a3d1bd4fdd71930687393c47898c71f913ba4` |
| `touchdesigner/projection_mapping/projection_mapping.toe` | 4,338 | 9 | `292628544caf83121b9862ce8a70a2ee4b8a8c593576bfbb0e0b985ed73f985e` |

Safe export steps are in [the Fuzz README](../touchdesigner/fuzz/README.md#rebuild-or-export).
TouchDesigner documents the [startup storage behavior](https://docs.derivative.ca/OP_Class)
and the [expand/collapse workflow](https://docs.derivative.ca/Toecollapse).

## Remaining limits

- CSP is **report-only**. Other security headers are enforced; CSP reports
  still need qualification across real browser/device workflows before
  switching to enforcement.
- Real Spark input and physical projector alignment still need a hardware
  session.
- Opening the TD project starts local camera/audio capture independently of
  the browser; closing it releases capture. Do not overwrite a shared `.toe`
  with an ordinary working save: sample caches need stripping again.
- Historical Git revisions may still contain older prototype camera IDs and
  short audio caches. No history rewrite was performed. The former Fuzz
  credential is rejected by the restarted bridge.
- Loopback pairing limits remote control; it does not isolate this program
  from other software already running as the same local user.
