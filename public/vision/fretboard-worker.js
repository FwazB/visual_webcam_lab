/* global importScripts, cv, NeckTracker, NeckDetector */
// Classic worker: the pinned runtime embeds its WASM and stays on this origin.
let tracker = null;
let currentEpoch = 0;
let runtime = null;
let trackedWireCount = 0;
let coverageSearches = 0;

function detectCoverage(rgba, width, height) {
  // Sampling changes which faint wires survive line extraction. Alternate
  // bounded search sizes rather than permanently locking to one partial run.
  const limit = coverageSearches++ % 2 === 0 ? 640 : Math.max(width, height);
  const scale = Math.min(1, limit / Math.max(width, height));
  if (scale === 1) return NeckDetector.detectNeck(runtime, rgba, width, height);
  let input, smaller;
  try {
    input = new runtime.Mat(height, width, runtime.CV_8UC4);
    input.data.set(rgba);
    smaller = new runtime.Mat();
    const w = Math.round(width * scale), h = Math.round(height * scale);
    runtime.resize(input, smaller, new runtime.Size(w, h), 0, 0, runtime.INTER_LINEAR);
    // Normalized proposals still seed the original full-resolution frame.
    return NeckDetector.detectNeck(runtime, smaller.data, w, h);
  } finally { smaller?.delete(); input?.delete(); }
}

// A wider search may discover another line pattern in the room. Only grow an
// already verified neck along its own axis, retaining its previous coverage.
function expandsCoverage(points, proposal, width, height) {
  if (!points || !proposal || proposal.wireCount < Math.max(6, trackedWireCount + 2)) return false;
  const pixels = (quad) => quad.map((point) => ({ x: point.x * width, y: point.y * height }));
  const previous = pixels(points), next = pixels(proposal.points);
  const center = (quad, end) => ({ x: (quad[end].x + quad[end + 1].x) / 2, y: (quad[end].y + quad[end + 1].y) / 2 });
  const a = center(next, 0), b = center(next, 2), oldA = center(previous, 0), oldB = center(previous, 2);
  const length = Math.hypot(b.x - a.x, b.y - a.y), oldLength = Math.hypot(oldB.x - oldA.x, oldB.y - oldA.y);
  if (length < oldLength * 1.18 || oldLength < 1) return false;
  const axis = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  if (Math.abs(((oldB.x - oldA.x) * axis.x + (oldB.y - oldA.y) * axis.y) / oldLength) < 0.985) return false;
  const along = (point) => (point.x - a.x) * axis.x + (point.y - a.y) * axis.y;
  const across = (point) => -(point.x - a.x) * axis.y + (point.y - a.y) * axis.x;
  const rail = (side, t) => {
    const start = along(next[side]), end = along(next[side + 2]);
    if (Math.abs(end - start) < 1) return NaN;
    return across(next[side]) + (across(next[side + 2]) - across(next[side])) * (t - start) / (end - start);
  };
  for (const end of [0, 2]) {
    const oldWidth = Math.hypot(previous[end].x - previous[end + 1].x, previous[end].y - previous[end + 1].y);
    const t = along(center(previous, end));
    const span = Math.abs(rail(0, t) - rail(1, t));
    if (!Number.isFinite(span) || span < oldWidth * 0.75 || span > oldWidth * 1.35) return false;
    for (const point of previous.slice(end, end + 2)) {
      const at = along(point), low = Math.min(rail(0, at), rail(1, at)), high = Math.max(rail(0, at), rail(1, at));
      if (at < -length * 0.04 || at > length * 1.04 || across(point) < low - span * 0.18 || across(point) > high + span * 0.18) return false;
    }
  }
  return true;
}

async function initialize() {
  try {
    importScripts("./opencv-4.12.0.js", "./neck-tracker.js", "./neck-detector.js");
    runtime = cv;
    // This pinned build is a self-resolving thenable, not a native Promise.
    // Awaiting it would loop through thenable assimilation indefinitely.
    if (!runtime.Mat) await new Promise((resolve, reject) => {
      runtime.onRuntimeInitialized = () => resolve();
      runtime.onAbort = () => reject(new Error("Vision runtime initialization failed"));
    });
    if (!runtime.Mat || !runtime.ORB || !runtime.findHomography) throw new Error("Missing tracking primitives");
    tracker = new NeckTracker(runtime);
    self.postMessage({ type: "ready" });
  } catch {
    self.postMessage({ type: "error", message: "Fretboard tracking could not load. Try finding the fretboard again; audio practice still works." });
  }
}

self.onmessage = ({ data }) => {
  if (!data || !Number.isSafeInteger(data.epoch) || data.epoch < currentEpoch) return;
  currentEpoch = data.epoch;
  if (data.type === "reset") { tracker?.reset(); trackedWireCount = 0; coverageSearches = 0; return; }
  if (!tracker || !runtime) return;
  const { epoch, frameId, capturedAt, mediaTime, width, height } = data;
  const meta = { epoch, frameId, capturedAt, mediaTime };
  try {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > 1920 || height > 1920 || width * height > 1100000
      || !(data.rgba instanceof ArrayBuffer) || data.rgba.byteLength !== width * height * 4) {
      throw new Error("Invalid camera frame");
    }
    const rgba = new Uint8ClampedArray(data.rgba);
    if (data.type === "detect") {
      const proposal = NeckDetector.detectNeck(runtime, rgba, width, height);
      self.postMessage({ ...meta, type: "detected", proposal });
    } else if (data.type === "seed") {
      coverageSearches = 0;
      const result = tracker.seed(rgba, width, height, data.points, data.exclusions ?? []);
      trackedWireCount = Number.isInteger(data.wireCount) && data.wireCount >= 0 && data.wireCount <= 40 ? data.wireCount : 0;
      if (result.status === "lost") {
        self.postMessage({ ...meta, type: "error", message: "Not enough visible neck detail to track. Move closer, improve the light, and try Find fretboard again." });
        return;
      }
      self.postMessage({ ...meta, type: "seeded", ...result });
    } else if (data.type === "frame") {
      let result = tracker.update(rgba, width, height, data.exclusions ?? []);
      if (data.refresh === true && result.status !== "lost") {
        let candidate = null;
        try {
          const proposal = detectCoverage(rgba, width, height);
          if (expandsCoverage(result.points, proposal, width, height)) {
            candidate = new NeckTracker(runtime);
            const seeded = candidate.seed(rgba, width, height, proposal.points, data.exclusions ?? []);
            if (seeded.status !== "lost") {
              const previous = tracker;
              tracker = candidate;
              candidate = null;
              previous.dispose();
              trackedWireCount = proposal.wireCount;
              result = { ...seeded, replacement: proposal };
            }
          }
        } catch {
          // An optional coverage search cannot discard a working reference.
        } finally { candidate?.dispose(); }
      }
      self.postMessage({ ...meta, type: "pose", ...result });
    }
  } catch {
    tracker.reset();
    self.postMessage({ ...meta, type: "error", message: "Fretboard tracking stopped. Try Find fretboard again; audio practice still works." });
  }
};

initialize();
