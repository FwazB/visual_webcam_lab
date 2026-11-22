import { isIP } from "node:net";
import { parseSpotifyTrackLink } from "@/lib/spotify/trackLink";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const windowMs = 60_000;
const maxPerClient = 12;
const maxPerInstance = 120;
// Accepted requests only. Each warm function instance retains at most 120 entries.
const recent: { time: number; client: string }[] = [];

function retryAfterSeconds(request: Request): number {
  const now = Math.floor(performance.now());
  while (recent.length && recent[0].time <= now - windowMs) recent.shift();

  // Vercel supplies this client address. Elsewhere, share a budget across all callers.
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") : null;
  const client = ip && ip.length <= 45 && !ip.includes("%") && isIP(ip) ? ip : "unknown";
  const clientRequests = recent.filter(entry => entry.client === client);
  if (clientRequests.length >= maxPerClient) {
    return Math.ceil((clientRequests[0].time + windowMs - now) / 1000);
  }
  if (recent.length >= maxPerInstance) {
    return Math.ceil((recent[0].time + windowMs - now) / 1000);
  }
  recent.push({ time: now, client });
  return 0;
}

function reply(body: { id: string } | { error: string }, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return reply({ error: "Open this link from Body Synth." }, 403);
  }
  const values = new URL(request.url).searchParams.getAll("url");
  const initial = values.length === 1 ? parseSpotifyTrackLink(values[0]) : null;
  if (initial?.kind !== "short") return reply({ error: "A Spotify short link is required." }, 400);

  const retryAfter = retryAfterSeconds(request);
  if (retryAfter) {
    const response = reply({ error: "Too many Spotify short-link lookups." }, 429);
    response.headers.set("Retry-After", String(retryAfter));
    return response;
  }

  const deadline = AbortSignal.timeout(4000);
  const signal = AbortSignal.any([request.signal, deadline]);
  const seen = new Set<string>();
  let url = initial.url;
  try {
    while (seen.size < 3 && !seen.has(url)) {
      seen.add(url);
      // Only the two validated Spotify short-link hosts are contacted. The final
      // track URL is parsed straight from Location; no recording or HTML is read.
      const response = await fetch(url, {
        method: "HEAD", redirect: "manual", cache: "no-store", credentials: "omit", signal,
        // Ask for an HTTP destination. A browser or Node user agent may receive
        // Branch's interactive app-launch page instead.
        headers: { "User-Agent": "" },
      });
      const location = response.headers.get("location");
      if (!redirectStatuses.has(response.status) || !location) break;
      const address = location.startsWith("/") && !location.startsWith("//") ? new URL(url).origin + location : location;
      const next = parseSpotifyTrackLink(address);
      if (!next) break;
      if (next.kind === "track") return reply({ id: next.id }, 200);
      const hop = new URL(next.url);
      const token = new URL(address).searchParams.get("_p");
      if (hop.hostname === "spotify.app.link" && token && /^[A-Za-z0-9_-]{1,128}$/.test(token)) {
        hop.searchParams.set("_p", token);
      }
      url = hop.href;
    }
  } catch {
    return reply({ error: "Spotify could not resolve this link." }, deadline.aborted ? 504 : 502);
  }
  return reply({ error: "This short link did not resolve to a Spotify track." }, 422);
}
