export const BODY_SYNTH_PROTOCOL_VERSION = 1 as const;

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

const ENGINE_MESSAGE_TYPES = new Set<EngineToAppMessage["type"]>([
  "welcome",
  "state.snapshot",
  "state.patch",
  "telemetry.frame",
  "event",
  "error",
  "pong",
]);

export function parseEngineMessage(raw: string): EngineToAppMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.type !== "string") return null;
    if (!ENGINE_MESSAGE_TYPES.has(value.type as EngineToAppMessage["type"])) {
      return null;
    }
    return value as unknown as EngineToAppMessage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
