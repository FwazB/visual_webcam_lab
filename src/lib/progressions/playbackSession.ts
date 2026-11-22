interface PlaybackSession {
  type: string;
}

const requests = new WeakMap<PlaybackSession, { previous: string; count: number }>();
const noChange = () => {};

/** On iOS, a Web Audio context defaults to ambient sound and follows the ringer switch. */
export function requestPlaybackSession(): () => void {
  try {
    const browser = globalThis.navigator as (Navigator & { audioSession?: PlaybackSession }) | undefined;
    const session = browser?.audioSession;
    const previous = session?.type;
    if (!session || !previous || previous === "play-and-record") return noChange;

    let request = requests.get(session);
    if (previous !== "playback") {
      session.type = "playback";
      request = { previous, count: 0 };
      requests.set(session, request);
    }
    if (!request) return noChange; // Playback was requested elsewhere.
    request.count++;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--request.count > 0 || requests.get(session) !== request) return;
      requests.delete(session);
      try {
        if (session.type === "playback") session.type = request.previous;
      } catch { /* The browser can revoke session access while tearing down the page. */ }
    };
  } catch {
    // Browsers can support Web Audio without allowing a session override.
    return noChange;
  }
}
