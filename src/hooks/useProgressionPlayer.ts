"use client";

import { useEffect, useState } from "react";
import { IDLE_PLAYBACK, ProgressionPlayer } from "@/lib/progressions/player";

export function useProgressionPlayer() {
  const [state, setState] = useState(IDLE_PLAYBACK);
  const [player] = useState(() => new ProgressionPlayer(setState));
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) player.stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", player.stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", player.stop);
      player.stop();
    };
  }, [player]);
  return {
    ...state, play: player.play, preview: player.preview, stop: player.stop, stopLoop: player.stopLoop,
    toggleMetronome: player.toggleMetronome, setTempo: player.setTempo,
  };
}
