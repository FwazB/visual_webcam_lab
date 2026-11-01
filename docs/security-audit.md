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
  paths. It caps pending handshakes at 8, total clients at 16, and closes
  unpaired clients after 5 seconds of wall-clock time. Malformed pre-authentication
  messages close immediately. HTTP returns 404 with an empty body.
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
remain. The original artifacts reopened independently at 1280×720 without
operator errors. The updated Fuzz artifact below was repacked and re-expanded
with the installed CLI tools; it has not been reopened in native TouchDesigner.

| Artifact | Bytes | Operators | SHA-256 |
| --- | ---: | ---: | --- |
| `touchdesigner/fuzz/fuzz.toe` | 18,650 | 50 (36 at root, 14 in Light Maps) | `2573cf1e10039764c0003a2288c7036b9fabfaceefdc25af1630506f24c7eeae` |
| `touchdesigner/projection_mapping/projection_mapping.toe` | 4,338 | 9 | `292628544caf83121b9862ce8a70a2ee4b8a8c593576bfbb0e0b985ed73f985e` |

Safe export steps are in [the Fuzz README](../touchdesigner/fuzz/README.md#rebuild-or-export).
TouchDesigner documents the [startup storage behavior](https://docs.derivative.ca/OP_Class)
and the [expand/collapse workflow](https://docs.derivative.ca/Toecollapse).

## Development dependency remediation (2026-11-01)

The retained MCP `2.1.0` package is used by `.mcp.json`. Its dependencies were
updated within their declared ranges; Zod remains narrowly overridden to
`4.6.6`. Production packages and lint rules were not removed or downgraded.

The former 15 moderate aggregate entries for minimatch GHSA-g3hv-75wg-m249 are
resolved by the actual registry `minimatch@11.0.3`. Legacy consumers cannot use
that version unchanged: callable default exports and regex-building APIs were
removed. Instead, 16 call-site updates across five exact lint packages use the
supported named exports and matcher objects. React, import, accessibility and
ESLint configuration regressions exercise matching and nonmatching cases.

`scripts/patch-lint-minimatch.cjs` checks each consumer's version, its resolved
minimatch version, and every original or patched file hash before writing any
changes. Unexpected or partial installations fail closed. Installation and
normal npm lint/test/build/dev commands prepare the toolchain; direct ESLint
checks preparation. A production-only install skips absent development tools.
The patch manifest and [maintenance instructions](../security/lint-minimatch/README.md)
must be reviewed when those dependencies change. No dependency is disguised as
a new version, no useful lint rules are disabled, and no audit finding is suppressed.

The exception gate is removed. CI fails on **any** production or development
advisory. Registry results at the verification date do not guarantee harmless
dependencies. No provider settings or deployment triggers were changed.

## Real-fretboard candidate review (2026-11-01)

This pass covers the working-tree candidate based on `591f924`, including the
new physical-fretboard mapper, detector, tracker, worker and bundled OpenCV,
and the existing web routes, Studio storage, Spotify authorization, local
vision spike, Fuzz bridge, dependency configuration and CI. It is a source,
synthetic-runtime and localhost HTTP audit. No browser or physical device was
controlled and no provider settings were changed. Publication uses the existing
review branch; no merge or production deployment is part of this verification.

### Findings and remediation

| Severity | Finding | Resolution |
| --- | --- | --- |
| Medium | Studio could accept a microphone grant after navigation, retaining capture in a closed engine | Cancel obsolete device and engine initialization requests; stop late streams; release streams when graph attachment fails |
| Low | A temporary device-label permission probe could keep capturing after leaving Guitar or Studio while device enumeration was pending | Add abortable device discovery, release its probe on cancellation, and stop late grants before further enumeration |
| Medium | A pending Studio import could repopulate audio after **New** cleared the saved project | Invalidate obsolete project operations and guard persistence and UI completion against the current project lifetime |
| Medium | The isolated vision spike could leave a microphone or camera active when setup failed | Own partial capture resources across all setup steps and release them on failure or cancellation; obsolete setup cannot tear down a newer source |
| Low | ASCII segmentation retained SDK-owned mask memory after the callback returned | Copy the mask within the callback; clear it on stop, failure, missing results or unavailable video; reject late callbacks |
| Low | The local Fuzz bridge retained unauthenticated clients without a cap or hello deadline | Limit pending/total connections to 8/16, expire hello after 5 seconds, and close malformed pre-authentication messages. One owned timer is canceled on pairing, disconnect, stop or export. Scheduler errors close pending clients; native close failures stop the listener. Source and sanitized `.toe` are synchronized |
| Hardening | CSP only reported violations | Enforce the page policy and a separate policy for the exact OpenCV worker entry point; its required JavaScript evaluation permission does not extend to the page |

The fixes are exercised by focused lifecycle tests using deferred permission
grants, setup failures and obsolete asynchronous completions. The low-severity
mask defect is a data-lifetime/correctness issue; no native-code exploitation or
frame disclosure was demonstrated.

### Fretboard privacy and trust boundaries

- Camera images remain in transient browser memory and a dedicated worker.
  The new code has no upload, file-save, analytics or storage path for pixels.
  Existing MediaPipe runtime/model downloads remain external requests; that is
  separate from sending camera images.
- The OpenCV dependency is exactly `4.12.0-release.1`, pinned by lockfile
  integrity. A local build step copies its runtime and license to `/vision/`;
  the worker imports only fixed same-origin scripts. Frames enter OpenCV as
  bounded raw RGBA arrays, not uploaded image files. OpenCV 4.12 includes the
  fix for [CVE-2025-53644](https://securitylab.github.com/advisories/GHSL-2025-057_OpenCV/);
  this one advisory check is not a proof that the runtime has no defects.
- Capture is capped at 960 pixels per dimension and 15 samples per second,
  with one request in flight. The worker independently rejects invalid
  dimensions, oversized frames and mismatched buffer sizes. Initialization and
  processing deadlines terminate a stuck worker.
- Request generations, frame IDs and acquisition timestamps prevent obsolete
  results from restoring an old pose. Unmount terminates the worker. Lost or
  stale tracking hides finger-position claims; a frozen calibration image is
  never accepted as a live pose. Audio/visual agreement remains explicitly
  insufficient to prove string contact.

### Verification receipts

- On Node 24.22.1, all **213** app tests and **32** isolated vision-spike
  tests passed with no skips, including the actual pinned OpenCV WASM and
  deferred media/storage regressions. Full ESLint and the production build
  (including TypeScript) passed. These are automated local checks, not a real
  camera, Spark, OAuth or browser validation session.
- Fresh npm registry audits: production **0** known vulnerabilities; isolated
  vision spike **0**; full app installation **0**. The fail-closed policy rejects
  every advisory, including the previously excepted one. `npm ls --all` passed.
- `pip-audit` checked the pinned Fuzz test requirement (`numpy==2.5.4`): **0**
  known vulnerabilities. All **67** Fuzz Python regressions and all **4** local
  braces security regressions passed.
- Gitleaks 8.30.1 found no secret matches in the candidate's **170 non-ignored files**
  or the **50 prior local Git commits**. Reports were redacted. This does
  not certify the absence of secrets or remove historical binary media caches.
- The expanded HTTP smoke check covers all seven pages and six worklet/vision
  scripts. It verifies response headers, MIME and revalidation behavior, and
  SHA-256 equality with local scripts. Six private-project path probes return
  404. These are localhost responses, not production evidence.
- The isolated vision server passed local probes for host/origin restrictions,
  supported methods, traversal rejection and private-path denial. No actual
  TouchDesigner service was opened or exercised.
- The updated Fuzz `.toe` was re-expanded: only the bridge callback text,
  empty pending-client storage and explicit inactive listener changed. All six
  embedded source files match the checkout, all 50 operators remain, and no
  media cache, private path, device UUID or saved pairing/authentication state
  was introduced. The projection artifact is unchanged. Neither was reopened
  natively during this pass.
- CI now includes the isolated vision geometry and media-lifecycle Node tests;
  those checks do not launch a browser or open capture devices.

## Remaining limits

- Production CSP is enforced. Static Next hydration still requires inline scripts and
  React styling requires inline styles; inline event-handler attributes and
  frames are blocked. Tone uses local blob scripts/workers. JavaScript eval is
  allowed only in the OpenCV worker, whose policy denies fetch/WebSocket
  connections, external script origins and child workers. Browser enforcement
  and physical media paths still need a real session; HTTP and VM checks do
  not substitute for it.
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
