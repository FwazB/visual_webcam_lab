# Security and bloat audit

Reviewed 2026-11-04, based on `8dd6fc7`. Scope: the browser app, media and worker
lifecycles, Studio persistence, Spotify authorization, dependencies and build
configuration, the isolated vision experiment, local Fuzz/Light Maps helpers,
and both shared TouchDesigner artifacts. This is a source and bounded runtime
review, not a penetration-test certification.

No confirmed high or medium exploitable security vulnerability was found in
this pass. The concrete issues below affect local data integrity, audio behavior
and resource use. This audit opened no camera, microphone or native TouchDesigner
session. Spark configuration and provider settings were unchanged.

## Findings fixed

| Finding | Effect | Resolution |
| --- | --- | --- |
| Studio restore deleted audio not referenced by an earlier project snapshot | Opening another tab during autosave could erase a new take before its clip metadata was saved | Restore uses one read-only transaction for project and referenced buffers. It neither scans every saved buffer nor deletes pending takes. Explicit New still clears saved data. |
| Removed Studio tracks retained gain nodes and scheduled sources | Deleted tracks could keep sounding and repeated track replacement accumulated audio nodes | Reconcile live track IDs, stop only removed tracks' sources, disconnect their gains, and release completed sources. Surviving tracks keep playing. |
| Transport, pending drags and autosave could act while New cleared the old project | Old playback or project state could survive reset | Gate transport and edits, invalidate drag previews, and suspend autosave for the complete reset lifetime. |
| Audio device preference storage methods could throw | Blocked or full browser storage could prevent selecting or connecting an input | Treat preference reads and writes as optional; keep the selected input usable when persistence fails. |

These fixes do not turn Studio into a collaborative editor. Multiple tabs can
still overwrite the single saved project's metadata; use one editing tab.
Unreferenced audio is deliberately retained until New or clearing site data,
because another tab or an undo history may still need it.

## Bloat removed

- Removed unused manual fret-number calibration, inverse click mapping and
  visual/audio candidate-agreement branches left behind by the continuous
  tracker. Current neck geometry, observed fret lines, fingertip dots and fresh
  heard-note validation remain. No absolute fret numbers are invented.
- Delay OpenCV worker creation until a usable video frame exists. Camera denial
  or an unavailable video no longer loads the 10,872,779-byte runtime. This is
  the uncompressed asset size, not a claimed network-transfer measurement.
- Transfer live tracking frames directly instead of copying every RGBA buffer.
  Detection and seed frames still retain immutable snapshots. At 960×540 this
  removes one 2,073,600-byte copy per live tracking request.
- Studio restore fetches only distinct referenced buffers instead of loading
  all saved audio. Removed tracks and completed sources now release resources.
- Consolidated repeated historical audit text and corrected outdated README
  instructions. Earlier receipts remain in Git history.

All direct app dependencies have current consumers. OpenCV, MediaPipe, Tone,
the isolated vision experiment and the maintained lint compatibility patches
were retained. No package was removed merely to reduce audit counts, and no
advisory or useful lint rule was suppressed.

## Trust boundaries

**Browser and media.** The app has no API routes, server actions, server-side
credentials or camera-frame upload path. Camera images remain in transient
browser/worker memory. MediaPipe runtime/model requests are fixed, versioned
external downloads; they are separate from sending images. Studio project/audio
stay in same-origin IndexedDB. Device and latency preferences stay in browser
storage; Spotify tokens stay in memory, with a short-lived PKCE/state record in
session storage during login. Spotify uses explicit read-only authorization,
fixed HTTPS endpoints, state/redirect validation, request cancellation and no
response-driven navigation.

Camera/microphone discovery, model initialization and source changes release
late grants and obsolete resources. Hand tracking remains independent of neck
tracking, with one GPU-to-CPU fallback and an explicit retry after terminal
failure. Neck processing bounds frames to 960 pixels per dimension and 15 Hz,
permits one request in flight, enforces deadlines and rejects stale generations,
frame IDs and acquisition timestamps. Ordinary detection misses retry; lost
tracking reacquires. Pausing or removing the camera cannot revive an old pose.

**Practice scoring.** Scores are local in-memory feedback. The engine bounds
patterns, timing-window searches, visible notes and retained judgments. Camera
landmarks cannot award points. Diagnostic tones/sweeps are canceled and disabled
during runs; stale, foreign, pre-run or unavailable audio events cannot score.
Scored play uses the exact input audio clock and stops on input loss, tab hiding,
mode change, suspension or a stalled clock. Silent preview is explicitly
unscored and uses its own visual clock. Transport closes only audio contexts it
owns. Audio identifies pitch, not the physical string used to play that pitch.

**HTTP and workers.** CSP is enforced, not report-only. Frames, object embeds and
inline event handlers are blocked. Static Next hydration still permits inline
scripts, React styles permit inline styling, and Tone uses local blob scripts
and workers. The page allows WASM compilation but not JavaScript eval. Only the
exact OpenCV worker response permits JavaScript eval; its policy denies network
connections, outside script origins and child workers. Security headers and
private-path denial are checked by `npm run smoke`. Public assets contain only
the two audio worklets and the fixed vision scripts/license; no recorded media
or credentials are shipped there.

**Fuzz and native helpers.** The bridge is saved inactive and binds only
`127.0.0.1:9980`; unsupported bindings fail closed. It requires a runtime pairing
code, compares it in constant time, and accepts only versioned controls,
chord/hit events, transport and heartbeat. Callback limits are 8 KB/message,
8 pending handshakes, 16 clients and 5 seconds to authenticate. Malformed
pre-authentication messages close immediately; HTTP exposes no state. The
protocol cannot execute code, choose file paths or invoke shell commands.

Fuzz/Light Maps share images locally through Syphon. The Swift mask helper reads
bounded frames through process pipes, stores no images and makes no network
requests. Its caller uses fixed argv without a shell, keeps only the newest
frame, rejects stale output, and terminates/joins obsolete workers. The compiled
helper remains ignored. The isolated vision server is loopback-only, checks
Host/Origin/method, serves a fixed allowlist and rejects symlink files; model and
fixture downloads have pinned checksums. No test camera or inference model was
opened during this audit.

## Dependencies and build

Fresh registry audits report zero known findings in the main installation
(509 packages) and isolated vision experiment (21 packages). The installed main
tree validates; registry packages in both lockfiles have expected npm registry
origins and integrity hashes. Pinned NumPy test requirements also pass pip-audit.
These results describe known advisories at the audit time, not package safety
certification.

The MCP tool is pinned to `touchdesigner-mcp-server@2.1.0` and launched from the
installed local CLI, never an unpinned `npx` download. OpenCV is exactly
`4.12.0-release.1`; its runtime and license are copied from the locked package.
The lint patch checks exact consumer versions and original/patched hashes,
rejecting unexpected installations. Maintain it using the
[compatibility instructions](../security/lint-minimatch/README.md). CI installs
with scripts disabled, validates the tree, prepares the audited toolchain, and
fails on every production or development advisory. Actions are pinned by commit;
CI permissions are read-only and checkout does not retain credentials.

## Shared TouchDesigner artifacts

Both unchanged `.toe` files were expanded using the installed CLI, without
opening native TouchDesigner. The expanded files contain no sample-cache `.ts`
files, `.oldacbo` backups or symlinks. Storage was inspected with pickle opcode
disassembly, never deserialized: runtime/startup pairing values are empty, client
and pending maps are empty, and no object-construction opcodes or personal paths
were found. Embedded callback source matches the checkout. The bridge is saved
off with the expected loopback binding.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `touchdesigner/fuzz/fuzz.toe` | 18,650 | `2573cf1e10039764c0003a2288c7036b9fabfaceefdc25af1630506f24c7eeae` |
| `touchdesigner/projection_mapping/projection_mapping.toe` | 4,338 | `292628544caf83121b9862ce8a70a2ee4b8a8c593576bfbb0e0b985ed73f985e` |

Follow the [safe export procedure](../touchdesigner/fuzz/README.md#rebuild-or-export)
before sharing a newly saved artifact; ordinary saves may retain capture caches.
Opening a native project can start its own camera/audio independently of the web
app. No native runtime or projector-alignment result is claimed by this audit.

## Verification

Release preparation revalidated on 2026-11-07: application and Fuzz tests,
isolated vision/braces tests, lint, production build, dependency audits and the
candidate secret scan all passed again. Local servers remained stopped; the
localhost HTTP and native-artifact receipts below are from the November 4 audit.

- All 334 application tests, full ESLint, the production TypeScript build and
  all 19 localhost HTTP smoke checks passed. The checks cover deferred storage
  failures/completion, cross-tab take preservation, removed-track cleanup, reset
  races, unavailable preference storage and lazy worker/transfer ownership.
- All 32 isolated vision tests and four braces-hardening regressions passed.
- 67 Fuzz Python regressions and 23 TypeScript bridge/client regressions passed.
  The Swift helper compiled into temporary storage and passed six malformed/EOF
  pipe cases without camera/model inference.
- Fresh npm and pinned-requirement pip audits returned zero known findings.
- Fully redacted Gitleaks scans found zero matches in all 183 tracked/intended
  candidate files and 55 reachable prior Git commits.
- The prior release had saved-video desktop/mobile browser replay coverage for
  live neck/hands and note travel. This audit uses controlled lifecycle/data
  tests and HTTP checks; no new browser, physical guitar or hardware validation
  is claimed. Real-guitar game latency and ambiguous/occluded fret coverage remain
  unverified limits.

## Remaining limits

- Studio has no decoded-audio, recording-duration or whole-project mix memory
  budget. Very large imports, prolonged recording or a large saved project can
  exhaust tab memory. No unauthenticated remote trigger was identified, and no
  destructive memory-exhaustion test was performed.
- CSP's static inline-script allowance remains a defense-in-depth limit. HTTP
  assertions do not prove enforcement in every browser or replace physical media
  testing. Default-output audio clocks can stall in some environments; the game
  now stops with an error instead of silently advancing scored time.
- Application callback caps do not prove native HTTP/WebSocket allocation or
  packet-rate limits before callbacks execute. Loopback pairing does not isolate
  the app from other software running as the same local user.
- Earlier Git revisions may contain prototype camera IDs or short media caches;
  no history rewrite was performed. Pattern-based secret scans do not identify
  every possible secret or binary media cache.

This document replaces repeated chronological audit sections with the current
state. The [prior audit and verification history](https://github.com/FwazB/visual_webcam_lab/blob/8dd6fc762984bea54d1b91f46fbdb4561a5ade2b/docs/security-audit.md)
retains the earlier media-lifecycle, pairing-storage, CSP and dependency repairs.
