/* global importScripts, cv, NeckTracker, NeckDetector */
// Classic worker: the pinned runtime embeds its WASM and stays on this origin.
let tracker = null;
let currentEpoch = 0;
let runtime = null;

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
  if (data.type === "reset") { tracker?.reset(); return; }
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
      const result = tracker.seed(rgba, width, height, data.points, data.exclusions ?? []);
      if (result.status === "lost") {
        self.postMessage({ ...meta, type: "error", message: "Not enough visible neck detail to track. Move closer, improve the light, and try Find fretboard again." });
        return;
      }
      self.postMessage({ ...meta, type: "seeded", ...result });
    } else if (data.type === "frame") {
      const result = tracker.update(rgba, width, height, data.exclusions ?? []);
      self.postMessage({ ...meta, type: "pose", ...result });
    }
  } catch {
    tracker.reset();
    self.postMessage({ ...meta, type: "error", message: "Fretboard tracking stopped. Try Find fretboard again; audio practice still works." });
  }
};

initialize();
