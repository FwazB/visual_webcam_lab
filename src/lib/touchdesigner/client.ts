import {
  BODY_SYNTH_PROTOCOL_VERSION,
  FUZZ_PARAMETER_IDS,
  isFuzzParameterValue,
  parseEngineMessage,
  type AppToEngineMessage,
  type EngineCapabilities,
  type EngineState,
  type FuzzChordId,
  type FuzzParameterId,
} from "./protocol";

export const TOUCHDESIGNER_URL = "ws://127.0.0.1:9980/body-synth";
export const CONNECTION_TIMEOUT_MS = 60_000;
export const HANDSHAKE_TIMEOUT_MS = 5_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_TIMEOUT_MS = 15_000;
export const MAX_BUFFERED_BYTES = 16_384;

export interface BridgeSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface TouchDesignerSnapshot {
  status: "disconnected" | "connecting" | "handshaking" | "ready" | "error";
  error: string | null;
  state: EngineState | null;
  capabilities: EngineCapabilities | null;
}

type Timer = ReturnType<typeof setTimeout>;
interface ClientOptions {
  createSocket?: (url: string) => BridgeSocket;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
}

const INITIAL_SNAPSHOT: TouchDesignerSnapshot = {
  status: "disconnected", error: null, state: null, capabilities: null,
};

/** Explicit, memory-only pairing. This bridge carries control messages, never media. */
export class TouchDesignerClient {
  private snapshot = INITIAL_SNAPSHOT;
  private socket: BridgeSocket | null = null;
  private listeners = new Set<() => void>();
  private connectionTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private pendingPing: number | null = null;
  private lastPongAt = 0;
  private readonly createSocket: NonNullable<ClientOptions["createSocket"]>;
  private readonly now: NonNullable<ClientOptions["now"]>;
  private readonly schedule: NonNullable<ClientOptions["schedule"]>;
  private readonly cancel: NonNullable<ClientOptions["cancel"]>;

  constructor(options: ClientOptions = {}) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.now = options.now ?? Date.now;
    // Browser timer methods require the global receiver, not this client.
    this.schedule = options.schedule ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.cancel = options.cancel ?? ((timer) => globalThis.clearTimeout(timer));
  }

  getSnapshot = (): TouchDesignerSnapshot => this.snapshot;
  getServerSnapshot = (): TouchDesignerSnapshot => INITIAL_SNAPSHOT;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  connect = (pairingCode: string): void => {
    this.closeSocket();
    if (typeof pairingCode !== "string" || !/^[\x21-\x7e]{8,128}$/.test(pairingCode)) {
      this.fail("Enter the pairing code shown in TouchDesigner (8–128 characters).");
      return;
    }
    this.update({ ...INITIAL_SNAPSHOT, status: "connecting" });
    let socket: BridgeSocket;
    try {
      socket = this.createSocket(TOUCHDESIGNER_URL);
    } catch {
      this.fail("Unable to open the local bridge. Start TouchDesigner and allow local network access, then reconnect.");
      return;
    }
    this.socket = socket;
    // The browser may wait for local-network permission before opening.
    this.connectionTimer = this.schedule(() => {
      this.fail("The local connection timed out. Allow local network access in the browser, check TouchDesigner, then reconnect.");
    }, CONNECTION_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      // Release the closure containing the code after the one pairing message.
      socket.onopen = null;
      if (this.connectionTimer !== null) this.cancel(this.connectionTimer);
      this.connectionTimer = this.schedule(() => {
        this.fail("TouchDesigner did not finish pairing. Check the code and bridge, then reconnect.");
      }, HANDSHAKE_TIMEOUT_MS);
      this.update({ ...this.snapshot, status: "handshaking" });
      this.send({
        type: "hello",
        protocolVersion: BODY_SYNTH_PROTOCOL_VERSION,
        clientId: globalThis.crypto?.randomUUID?.() ?? `session-${this.now()}-${Math.random().toString(36).slice(2)}`,
        pairingCode,
      });
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.receive(event.data);
    };
    socket.onerror = () => {
      if (this.socket === socket) this.fail("Cannot reach TouchDesigner. Start the bridge and allow local network access, then reconnect.");
    };
    socket.onclose = () => {
      if (this.socket === socket) this.fail("TouchDesigner disconnected. Reconnect when the bridge is ready.");
    };
  };

  disconnect = (): void => {
    this.closeSocket();
    this.update(INITIAL_SNAPSHOT);
  };

  sendChord = (chordId: FuzzChordId): boolean => {
    if (!["c9sus4", "dm7", "gm"].includes(chordId)) return false;
    return this.command({ type: "event", name: "song.chord", payload: { chordId } });
  };

  sendNoteHit = (chordTone: boolean, strength = 1): boolean => {
    if (typeof chordTone !== "boolean" || !Number.isFinite(strength) || strength < 0 || strength > 1) return false;
    return this.command({ type: "event", name: "note.hit", payload: { chordTone, strength } });
  };

  setPlaying = (playing: boolean): boolean => {
    return typeof playing === "boolean" && this.command({ type: "transport.set", playing });
  };

  setParameter = (parameter: FuzzParameterId, value: number | boolean): boolean => {
    if (!FUZZ_PARAMETER_IDS.includes(parameter) || !isFuzzParameterValue(parameter, value)) return false;
    return this.command({ type: "parameter.set", parameter, value });
  };

  private command(message: AppToEngineMessage): boolean {
    return this.snapshot.status === "ready" && this.send(message);
  }

  private send(message: AppToEngineMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) {
      this.fail("The local bridge is closed. Reconnect to resume visuals.");
      return false;
    }
    // Never build a replay queue: old notes and transport commands are unsafe to replay.
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.fail("TouchDesigner is not keeping up. Reconnect to resume visuals.");
      return false;
    }
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.fail("A bridge message could not be sent. Reconnect to resume visuals.");
      return false;
    }
  }

  private receive(raw: unknown): void {
    const message = typeof raw === "string" ? parseEngineMessage(raw) : null;
    if (!message) {
      this.fail("TouchDesigner sent an invalid response. Update the bridge, then reconnect.");
      return;
    }
    if (message.type === "error") {
      // Do not reflect an engine message that might contain the pairing code.
      const error = ["authentication", "unauthorized", "pairing_failed"].includes(message.code)
        ? "Pairing was rejected. Check the code shown in TouchDesigner and reconnect."
        : "TouchDesigner rejected a command. Check the bridge and reconnect.";
      if (message.recoverable && this.snapshot.status === "ready") this.update({ ...this.snapshot, error });
      else this.fail(error);
      return;
    }
    if (message.type === "welcome") {
      const capabilities = message.capabilities;
      if (this.snapshot.status !== "handshaking" || this.snapshot.capabilities
        || message.protocolVersion !== BODY_SYNTH_PROTOCOL_VERSION || message.engineVersion !== "fuzz-1"
        || !capabilities.modules.includes("visuals") || !capabilities.modules.includes("output")
        || !capabilities.scenes.includes("fuzz")
        || !FUZZ_PARAMETER_IDS.every((id) => capabilities.parameters.includes(id))) {
        this.fail("This TouchDesigner bridge is incompatible. Open the current Fuzz project and reconnect.");
        return;
      }
      this.update({ ...this.snapshot, capabilities });
      return;
    }
    if (message.type === "state.snapshot") {
      if (!this.snapshot.capabilities || !hasFuzzState(message.state)) {
        this.fail("TouchDesigner did not provide a valid Fuzz state. Update the bridge, then reconnect.");
        return;
      }
      if (this.snapshot.state && message.state.revision <= this.snapshot.state.revision) return;
      const firstState = this.snapshot.status !== "ready";
      if (this.connectionTimer !== null) this.cancel(this.connectionTimer);
      this.connectionTimer = null;
      this.update({ ...this.snapshot, status: "ready", state: message.state, error: null });
      if (firstState) {
        this.lastPongAt = this.now();
        this.heartbeat();
      }
      return;
    }
    if (this.snapshot.status !== "ready") {
      this.fail("TouchDesigner sent data before pairing finished. Reconnect to try again.");
      return;
    }
    if (message.type === "state.patch") {
      const previous = this.snapshot.state!;
      if (message.revision <= previous.revision) return;
      if (message.revision !== previous.revision + 1) {
        this.fail("TouchDesigner state fell out of sync. Reconnect to refresh it.");
        return;
      }
      const state = {
        ...previous,
        ...message.changes,
        revision: message.revision,
        parameters: { ...previous.parameters, ...message.changes.parameters },
      };
      this.update({ ...this.snapshot, state, error: null });
    } else if (message.type === "pong" && message.sentAt === this.pendingPing) {
      this.pendingPing = null;
      this.lastPongAt = this.now();
    }
  }

  private heartbeat = (): void => {
    this.heartbeatTimer = null;
    if (this.snapshot.status !== "ready") return;
    if (this.now() - this.lastPongAt >= HEARTBEAT_TIMEOUT_MS) {
      this.fail("TouchDesigner stopped responding. Reconnect to resume visuals.");
      return;
    }
    if (this.pendingPing === null) {
      this.pendingPing = this.now();
      if (!this.send({ type: "ping", sentAt: this.pendingPing })) return;
    }
    this.heartbeatTimer = this.schedule(this.heartbeat, HEARTBEAT_INTERVAL_MS);
  };

  private closeSocket(): void {
    if (this.connectionTimer !== null) this.cancel(this.connectionTimer);
    if (this.heartbeatTimer !== null) this.cancel(this.heartbeatTimer);
    this.connectionTimer = null;
    this.heartbeatTimer = null;
    this.pendingPing = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      // TouchDesigner's server needs an explicit normal-close status to finish
      // the handshake; an empty close frame can leave the socket in CLOSING.
      try { socket.close(1000, "disconnect"); } catch { /* Already closed or unavailable. */ }
    }
  }

  private fail(error: string): void {
    this.closeSocket();
    this.update({ ...INITIAL_SNAPSHOT, status: "error", error });
  }

  private update(snapshot: TouchDesignerSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function hasFuzzState(state: EngineState): boolean {
  return FUZZ_PARAMETER_IDS.every((id) => isFuzzParameterValue(id, state.parameters[id]));
}
