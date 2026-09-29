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
  const s = storage();
  return { id: s?.getItem(ID_KEY) ?? null, label: s?.getItem(LABEL_KEY) ?? null };
}

export function storeDevice(device: MediaDeviceInfo | null): void {
  const s = storage();
  if (!s) return;
  if (!device) {
    s.removeItem(ID_KEY);
    s.removeItem(LABEL_KEY);
    return;
  }
  s.setItem(ID_KEY, device.deviceId);
  s.setItem(LABEL_KEY, device.label);
}

/**
 * Chrome returns empty labels until the origin has microphone permission, so
 * open a throwaway stream first, then enumerate.
 */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  let probe: MediaStream | null = null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasLabels = devices.some((d) => d.kind === "audioinput" && d.label);
    if (!hasLabels) {
      probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput");
  } finally {
    probe?.getTracks().forEach((t) => t.stop());
  }
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
