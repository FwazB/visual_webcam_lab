// Audio input device selection with a preference for the Spark over USB.

const ID_KEY = "bodysynth.audio.inputDeviceId";
const LABEL_KEY = "bodysynth.audio.inputDeviceLabel";

const SPARK_LABEL = /spark/i;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getStoredDevice(): { id: string | null; label: string | null } {
  try {
    const s = storage();
    return { id: s?.getItem(ID_KEY) ?? null, label: s?.getItem(LABEL_KEY) ?? null };
  } catch {
    return { id: null, label: null };
  }
}

export function storeDevice(device: MediaDeviceInfo | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (!device) {
      s.removeItem(ID_KEY);
      s.removeItem(LABEL_KEY);
      return;
    }
    s.setItem(ID_KEY, device.deviceId);
    s.setItem(LABEL_KEY, device.label);
  } catch {
    // Remembering a preference is optional; blocked/full storage must not
    // prevent connecting the input selected for this session.
  }
}

/**
 * Chrome returns empty labels until the origin has microphone permission, so
 * open a throwaway stream first, then enumerate.
 */
export function listAudioInputs(signal?: AbortSignal): Promise<MediaDeviceInfo[]> {
  return new Promise((resolve, reject) => {
    let probe: MediaStream | null = null;
    const releaseProbe = () => {
      const stream = probe;
      probe = null;
      stream?.getTracks().forEach((track) => track.stop());
    };
    const aborted = () => new DOMException("Audio input discovery was canceled.", "AbortError");
    const checkCanceled = () => {
      if (signal?.aborted) throw aborted();
    };
    const onAbort = () => {
      releaseProbe();
      signal?.removeEventListener("abort", onAbort);
      reject(aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const discover = async () => {
      try {
        checkCanceled();
        const devices = await navigator.mediaDevices.enumerateDevices();
        checkCanceled();
        const hasLabels = devices.some((d) => d.kind === "audioinput" && d.label);
        if (!hasLabels) {
          // A native permission prompt cannot be aborted. The continuation still
          // owns any late grant and releases it before requesting more devices.
          probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          checkCanceled();
        }
        const all = await navigator.mediaDevices.enumerateDevices();
        checkCanceled();
        return all.filter((d) => d.kind === "audioinput");
      } finally {
        releaseProbe();
        signal?.removeEventListener("abort", onAbort);
      }
    };
    void discover().then(resolve, reject);
  });
}

/** Stored device if still present, else the first Spark, else null. */
export function pickPreferredDevice(devices: MediaDeviceInfo[]): MediaDeviceInfo | null {
  const stored = getStoredDevice();
  if (stored.id) {
    const byId = devices.find((d) => d.deviceId === stored.id);
    if (byId) return byId;
  }
  if (stored.label) {
    const byLabel = devices.find((d) => d.label === stored.label);
    if (byLabel) return byLabel;
  }
  return devices.find((d) => SPARK_LABEL.test(d.label)) ?? null;
}

/** Raw input: no echo cancellation, noise suppression or gain control. */
export function instrumentConstraints(deviceId: string, channels = 1): MediaStreamConstraints {
  return {
    audio: {
      deviceId: { exact: deviceId },
      channelCount: { ideal: channels },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  };
}
