export const BODY_SYNTH_PROTOCOL_VERSION = 1 as const;
export const MAX_ENGINE_MESSAGE_LENGTH = 16_384;
export const FUZZ_PARAMETER_IDS = [
  "visual.fuzz.amount",
  "visual.fuzz.feedback",
  "output.blackout",
] as const;
export type FuzzParameterId = (typeof FUZZ_PARAMETER_IDS)[number];
export type FuzzChordId = "c9sus4" | "dm7" | "gm";

export type EngineModule =
  | "tracking"
  | "analysis"
  | "mapping"
  | "audio"
  | "lesson"
  | "visuals"
  | "output";

export type SessionIntent = "play" | "practice" | "perform" | "create";

export type ParameterValue = number | string | boolean | null;

export type SignalId =
  | `audio.${string}`
  | `body.${string}`
  | `hand.left.${string}`
  | `hand.right.${string}`
  | `instrument.${string}`
  | `lesson.${string}`
  | `midi.${string}`
  | `osc.${string}`;

export type ParameterId =
  | `tracking.${string}`
  | `audio.${string}`
  | `lesson.${string}`
  | `visual.${string}`
  | `output.${string}`;

export interface MappingTransform {
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
  curve: "linear" | "exponential" | "smoothstep";
  invert?: boolean;
  smoothingMs?: number;
}

export interface SignalMapping {
  id: string;
  source: SignalId;
  target: ParameterId;
  enabled: boolean;
  transform: MappingTransform;
}

export interface InstrumentProfile {
  family: "guitar" | "bass" | "voice" | "other";
  name: string;
  tuning?: string[];
}

export interface BodySynthSession {
  id: string;
  name: string;
  intent: SessionIntent;
  instrument?: InstrumentProfile;
  modules: EngineModule[];
  sceneId?: string;
  audioPresetId?: string;
  lessonId?: string;
  mappings: SignalMapping[];
  parameters: Partial<Record<ParameterId, ParameterValue>>;
}

export interface EngineCapabilities {
  modules: EngineModule[];
  scenes: string[];
  audioPresets: string[];
  parameters: ParameterId[];
  cameraDevices: string[];
  audioDevices: string[];
  outputDisplays: string[];
}

export interface EngineState {
  revision: number;
  running: boolean;
  sessionId: string | null;
  parameters: Partial<Record<ParameterId, ParameterValue>>;
}

export interface EngineTelemetry {
  fps: number;
  cookMs: number;
  audioLevel: number;
  bodyConfidence: number;
  trackedHands: number;
  droppedFrames: number;
}

interface MessageBase<TType extends string> {
  type: TType;
  requestId?: string;
}

export type AppToEngineMessage =
  | (MessageBase<"hello"> & {
      protocolVersion: typeof BODY_SYNTH_PROTOCOL_VERSION;
      clientId: string;
      pairingCode: string;
    })
  | (MessageBase<"session.load"> & { session: BodySynthSession })
  | MessageBase<"session.start">
  | MessageBase<"session.stop">
  | (MessageBase<"parameter.set"> & {
      parameter: ParameterId;
      value: ParameterValue;
    })
  | (MessageBase<"cue.fire"> & { cueId: string })
  | (MessageBase<"transport.set"> & {
      playing: boolean;
      positionSeconds?: number;
    })
  | (MessageBase<"event"> & {
      name: "song.chord";
      payload: { chordId: FuzzChordId };
    })
  | (MessageBase<"event"> & {
      name: "note.hit";
      payload: { chordTone: boolean; strength: number };
    })
  | (MessageBase<"ping"> & { sentAt: number });

export type EngineToAppMessage =
  | (MessageBase<"welcome"> & {
      protocolVersion: number;
      engineVersion: string;
      capabilities: EngineCapabilities;
    })
  | (MessageBase<"state.snapshot"> & { state: EngineState })
  | (MessageBase<"state.patch"> & {
      revision: number;
      changes: Partial<EngineState>;
    })
  | (MessageBase<"telemetry.frame"> & { telemetry: EngineTelemetry })
  | (MessageBase<"event"> & {
      name: string;
      payload?: Record<string, ParameterValue>;
    })
  | (MessageBase<"error"> & {
      code: string;
      message: string;
      recoverable: boolean;
    })
  | (MessageBase<"pong"> & { sentAt: number; receivedAt: number });

export function parseEngineMessage(raw: string): EngineToAppMessage | null {
  if (typeof raw !== "string" || raw.length > MAX_ENGINE_MESSAGE_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.type !== "string") return null;
    if (value.requestId !== undefined && !isText(value.requestId, 128)) return null;
    let valid = false;
    switch (value.type) {
      case "welcome":
        valid = isRevision(value.protocolVersion) && isText(value.engineVersion, 64) && isCapabilities(value.capabilities);
        break;
      case "state.snapshot":
        valid = isState(value.state);
        break;
      case "state.patch":
        valid = isRevision(value.revision) && isState(value.changes, true)
          && (value.changes.revision === undefined || value.changes.revision === value.revision);
        break;
      case "telemetry.frame":
        valid = isTelemetry(value.telemetry);
        break;
      case "event":
        valid = isText(value.name, 128) && (value.payload === undefined || isValues(value.payload));
        break;
      case "error":
        valid = isText(value.code, 128) && isText(value.message, 1024) && typeof value.recoverable === "boolean";
        break;
      case "pong":
        valid = isNonNegative(value.sentAt) && isNonNegative(value.receivedAt);
        break;
    }
    return valid ? value as unknown as EngineToAppMessage : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRevision(value: unknown): value is number {
  return isNonNegative(value) && Number.isSafeInteger(value);
}

function isParameterId(value: unknown): value is ParameterId {
  return isText(value, 160) && /^(tracking|audio|lesson|visual|output)\.[a-zA-Z0-9_.-]+$/.test(value);
}

function isParameterValue(value: unknown): value is ParameterValue {
  return value === null || typeof value === "boolean"
    || (typeof value === "string" && value.length <= 2048)
    || (typeof value === "number" && Number.isFinite(value));
}

function isValues(value: unknown, parameters = false): value is Record<string, ParameterValue> {
  return isRecord(value) && Object.keys(value).length <= 128
    && Object.entries(value).every(([key, entry]) => {
      if (["__proto__", "constructor", "prototype"].includes(key) || !isText(key, 160)) return false;
      if (!isParameterValue(entry) || (parameters && !isParameterId(key))) return false;
      if (parameters && FUZZ_PARAMETER_IDS.includes(key as FuzzParameterId)) {
        return isFuzzParameterValue(key as FuzzParameterId, entry);
      }
      return true;
    });
}

export function isFuzzParameterValue(parameter: FuzzParameterId, value: unknown): value is number | boolean {
  if (parameter === "output.blackout") return typeof value === "boolean";
  return (parameter === "visual.fuzz.amount" || parameter === "visual.fuzz.feedback")
    && isNonNegative(value) && value <= (parameter === "visual.fuzz.feedback" ? 0.98 : 1);
}

function isStringList(value: unknown, itemCheck: (item: unknown) => boolean = isText): value is string[] {
  return Array.isArray(value) && value.length <= 128 && value.every((item) => itemCheck(item))
    && new Set(value).size === value.length;
}

function isCapabilities(value: unknown): value is EngineCapabilities {
  if (!isRecord(value)) return false;
  const modules: EngineModule[] = ["tracking", "analysis", "mapping", "audio", "lesson", "visuals", "output"];
  return isStringList(value.modules, (item) => modules.includes(item as EngineModule))
    && isStringList(value.scenes) && isStringList(value.audioPresets)
    && isStringList(value.parameters, isParameterId)
    && isStringList(value.cameraDevices) && isStringList(value.audioDevices)
    && isStringList(value.outputDisplays);
}

function isState(value: unknown, partial = false): value is EngineState {
  if (!isRecord(value)) return false;
  const fields = ["revision", "running", "sessionId", "parameters"];
  if (Object.keys(value).some((key) => !fields.includes(key))) return false;
  return (partial && value.revision === undefined || isRevision(value.revision))
    && (partial && value.running === undefined || typeof value.running === "boolean")
    && (partial && value.sessionId === undefined || value.sessionId === null || isText(value.sessionId))
    && (partial && value.parameters === undefined || isValues(value.parameters, true));
}

function isTelemetry(value: unknown): value is EngineTelemetry {
  return isRecord(value) && isNonNegative(value.fps) && isNonNegative(value.cookMs)
    && isNonNegative(value.audioLevel) && value.audioLevel <= 1
    && isNonNegative(value.bodyConfidence) && value.bodyConfidence <= 1
    && isRevision(value.trackedHands) && value.trackedHands <= 2 && isRevision(value.droppedFrames);
}
