export type SpotifyTrackLink =
  | { kind: "track"; id: string }
  | { kind: "short"; url: string };

export class SpotifyLinkError extends Error {
  override readonly name = "SpotifyLinkError";
}

const trackId = /^[A-Za-z0-9]{22}$/;
const fullLinkHelp = "Open the shared link in your browser and copy its full open.spotify.com/track address.";

/** Strip sharing parameters before passing a link to the resolver or catalog. */
export function parseSpotifyTrackLink(input: string): SpotifyTrackLink | null {
  const value = input.trim();
  if (!value || value.length > 2048 || /[\s\\]/.test(value)) return null;
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(value);
  if (uri) return { kind: "track", id: uri[1] };

  // Match the entire authority and path before URL normalization can hide a port,
  // credentials, or a path such as /album/../track/.
  const address = /^https:\/\/(open\.spotify\.com|spotify\.link|spotify\.app\.link)(\/[^?#]*)(?:[?#].*)?$/i.exec(value);
  if (!address) return null;
  const host = address[1].toLowerCase();
  const path = address[2];
  if (host === "open.spotify.com") {
    const match = /^\/(?:intl-[a-zA-Z]{2}(?:-[a-zA-Z]{2,4})?\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(path);
    return match ? { kind: "track", id: match[1] } : null;
  }
  const code = /^\/([A-Za-z0-9_-]{1,128})\/?$/.exec(path);
  return code ? { kind: "short", url: `https://${host}/${code[1]}` } : null;
}

export async function resolveSpotifyTrackId(input: string, signal?: AbortSignal): Promise<string> {
  const link = parseSpotifyTrackLink(input);
  if (!link) throw new SpotifyLinkError("Paste a Spotify track link or a spotify:track URI.");
  if (link.kind === "track") return link.id;

  try {
    const query = new URLSearchParams({ url: link.url });
    const response = await fetch(`/api/spotify/resolve?${query}`, {
      signal, mode: "same-origin", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
    });
    if (response.ok) {
      const result: unknown = await response.json();
      if (result && typeof result === "object" && "id" in result && typeof result.id === "string" && trackId.test(result.id)) {
        return result.id;
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  throw new SpotifyLinkError(fullLinkHelp);
}
