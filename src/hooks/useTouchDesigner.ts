"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { TouchDesignerClient } from "@/lib/touchdesigner/client";

export function useTouchDesigner() {
  const [client] = useState(() => new TouchDesignerClient());
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  useEffect(() => () => client.disconnect(), [client]);
  return useMemo(() => ({
    ...snapshot,
    connect: client.connect,
    disconnect: client.disconnect,
    sendChord: client.sendChord,
    sendNoteHit: client.sendNoteHit,
    setPlaying: client.setPlaying,
    setParameter: client.setParameter,
  }), [client, snapshot]);
}

export type TouchDesignerBridge = ReturnType<typeof useTouchDesigner>;
