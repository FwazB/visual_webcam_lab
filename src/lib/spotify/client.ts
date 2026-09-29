/** Browser-only Spotify connection. No account data or tokens are persisted. */
export type SpotifyTrack = {
  id: string;
  name: string;
  artists: string[];
  url: string;
};

export type SpotifyTimeRange = "short_term" | "medium_term" | "long_term";
type LoginResult = { connected: boolean; tracks: SpotifyTrack[] };
type PendingLogin = { clientId: string; verifier: string; state: string; redirectUri: string; createdAt: number };
type TokenSession = { clientId: string; accessToken: string; refreshToken?: string; expiresAt: number };

const PENDING_KEY = "body-synth:spotify-pkce";
const PENDING_LIFETIME = 10 * 60 * 1000;
const CALLBACK_PARAMS = ["code", "state", "error", "error_description", "error_uri"];
const CLIENT_ID = /^[a-f0-9]{32}$/i;
const PKCE_VALUE = /^[A-Za-z0-9_-]{43,128}$/;
let session: TokenSession | null = null;
let loginStarting = false;
let finishPromise: Promise<LoginResult> | null = null;
let refreshPromise: Promise<string> | null = null;
let generation = 0;
const requests = new Set<AbortController>();

function browser() {
  if (typeof window === "undefined" || !globalThis.crypto?.subtle) {
    throw new Error("Connect Spotify in a browser with a secure connection.");
  }
  return window;
}

export function spotifyRedirectUri(): string {
  const location = browser().location;
  const loopback = location.hostname === "127.0.0.1" || location.hostname === "[::1]";
  if (location.hostname === "localhost" || (location.protocol !== "https:" && !(location.protocol === "http:" && loopback))) {
    throw new Error("Spotify requires HTTPS, or http://127.0.0.1 for local development. localhost is not supported.");
  }
  return new URL("/for-you", location.origin).href;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomValue(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function clearPending() {
  try { browser().sessionStorage.removeItem(PENDING_KEY); } catch { /* Storage may have been disabled. */ }
}

function readPending(): PendingLogin | null {
  try {
    const value: unknown = JSON.parse(browser().sessionStorage.getItem(PENDING_KEY) ?? "null");
    if (!isRecord(value) || typeof value.clientId !== "string" || !CLIENT_ID.test(value.clientId)
      || typeof value.verifier !== "string" || !PKCE_VALUE.test(value.verifier)
      || typeof value.state !== "string" || !PKCE_VALUE.test(value.state)
      || value.redirectUri !== spotifyRedirectUri() || typeof value.createdAt !== "number"
      || value.createdAt > Date.now() + 30_000 || Date.now() - value.createdAt > PENDING_LIFETIME) return null;
    return value as PendingLogin;
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Start an explicit login using the public application Client ID, never a Client Secret. */
export async function startSpotifyLogin(clientId: string): Promise<void> {
  const appId = clientId.trim();
  if (!CLIENT_ID.test(appId)) throw new Error("Enter the Spotify app's 32-character Client ID.");
  if (loginStarting || finishPromise || readPending()) throw new Error("A Spotify connection is already in progress. Finish it or disconnect before trying again.");
  const callback = spotifyRedirectUri();
  const operation = ++generation;
  session = null;
  loginStarting = true;
  try {
    const pending: PendingLogin = { clientId: appId, verifier: randomValue(), state: randomValue(), redirectUri: callback, createdAt: Date.now() };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.verifier));
    if (operation !== generation) throw new Error("Spotify connection cancelled.");
    try { browser().sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); }
    catch { throw new Error("Allow this site's session storage to connect Spotify."); }
    const authorization = new URL("https://accounts.spotify.com/authorize");
    authorization.search = new URLSearchParams({
      client_id: appId, response_type: "code", redirect_uri: callback,
      scope: "user-top-read", state: pending.state,
      code_challenge_method: "S256", code_challenge: base64Url(new Uint8Array(digest)),
    }).toString();
    browser().location.assign(authorization.href);
  } catch (error) {
    clearPending();
    throw error;
  } finally { loginStarting = false; }
}

function responseError(response: Response): Error {
  if (response.status === 401) return new Error("Spotify's connection expired. Disconnect and connect again.");
  if (response.status === 403) return new Error("Spotify denied access. Check that the app owner has Premium and your account is allowed in the app's dashboard.");
  if (response.status === 429) {
    const raw = response.headers.get("Retry-After") ?? "";
    const wait = /^\d{1,5}$/.test(raw) ? Number(raw) : 0;
    return new Error(wait > 0 ? `Spotify is limiting requests. Try again in ${wait} seconds.` : "Spotify's request quota is reached. Try again later.");
  }
  return new Error("Spotify could not complete the request. Check the app's Client ID and registered redirect URI, then reconnect.");
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  requests.add(controller);
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    if (!response.ok) throw responseError(response);
    try { return await response.json(); }
    catch { throw new Error("Spotify returned an unreadable response. Try connecting again."); }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Spotify")) throw error;
    throw new Error("Spotify could not be reached. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
    requests.delete(controller);
  }
}

function tokenSession(value: unknown, clientId: string, previousRefresh?: string): TokenSession {
  if (!isRecord(value) || typeof value.access_token !== "string" || !/^\S{1,4096}$/.test(value.access_token)
    || typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer"
    || typeof value.expires_in !== "number" || !Number.isFinite(value.expires_in) || value.expires_in < 1 || value.expires_in > 86_400
    || (typeof value.scope === "string" && !value.scope.split(" ").includes("user-top-read"))) {
    throw new Error("Spotify returned an invalid connection. Connect again.");
  }
  const refreshToken = typeof value.refresh_token === "string" && /^\S{1,4096}$/.test(value.refresh_token) ? value.refresh_token : previousRefresh;
  return { clientId, accessToken: value.access_token, refreshToken, expiresAt: Date.now() + value.expires_in * 1000 };
}

async function finishLogin(): Promise<LoginResult> {
  const current = new URL(browser().location.href);
  const hasCallback = CALLBACK_PARAMS.some((key) => current.searchParams.has(key));
  if (!hasCallback) return session ? { connected: true, tracks: await getTopTracks() } : { connected: false, tracks: [] };
  const params = new URLSearchParams(current.search);
  for (const key of CALLBACK_PARAMS) current.searchParams.delete(key);
  // Remove the authorization code from history before sending it to Spotify.
  browser().history.replaceState(browser().history.state, "", current.pathname + current.search + current.hash);
  const pending = readPending();
  clearPending(); // Authorization attempts can be consumed only once, including failed attempts.
  if (!pending || browser().location.pathname !== "/for-you" || params.getAll("state").length !== 1 || params.get("state") !== pending.state
    || params.getAll("code").length > 1 || params.getAll("error").length > 1) {
    throw new Error("Spotify's return could not be verified, or the connection timed out. Connect again.");
  }
  if (params.has("error")) throw new Error("Spotify permission was not granted. Connect again when ready.");
  const code = params.get("code");
  if (!code || !/^\S{1,2048}$/.test(code)) throw new Error("Spotify did not return a valid authorization. Connect again.");
  const operation = generation;
  const value = await requestJson("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: pending.redirectUri, client_id: pending.clientId, code_verifier: pending.verifier }),
  });
  if (operation !== generation) throw new Error("Spotify connection cancelled.");
  session = tokenSession(value, pending.clientId);
  return { connected: true, tracks: await getTopTracks() };
}

/** Consume the OAuth return once; simultaneous callers share the same request. */
export function finishSpotifyLogin(): Promise<LoginResult> {
  if (finishPromise) return finishPromise;
  finishPromise = finishLogin().finally(() => { finishPromise = null; });
  return finishPromise;
}

async function accessToken(): Promise<string> {
  if (!session) throw new Error("Connect Spotify to see your top tracks.");
  if (session.expiresAt - Date.now() > 30_000) return session.accessToken;
  if (!session.refreshToken) {
    session = null;
    throw new Error("Spotify's connection expired. Connect again.");
  }
  if (refreshPromise) return refreshPromise;
  const previous = session;
  const operation = generation;
  refreshPromise = (async () => {
    try {
      const value = await requestJson("https://accounts.spotify.com/api/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: previous.refreshToken!, client_id: previous.clientId }),
      });
      if (operation !== generation || session !== previous) throw new Error("Spotify connection cancelled.");
      session = tokenSession(value, previous.clientId, previous.refreshToken);
      return session.accessToken;
    } catch (error) {
      if (operation === generation && session === previous) session = null;
      throw error;
    }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim();
}

/** Read one page on demand. Spotify's order is preserved; no content analysis is performed. */
export async function getTopTracks(timeRange: SpotifyTimeRange = "short_term"): Promise<SpotifyTrack[]> {
  if (!["short_term", "medium_term", "long_term"].includes(timeRange)) throw new Error("Choose a valid Spotify listening period.");
  const operation = generation;
  const token = await accessToken();
  if (operation !== generation) throw new Error("Spotify connection cancelled.");
  const value = await requestJson(`https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=${timeRange}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (operation !== generation) throw new Error("Spotify connection cancelled.");
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("Spotify returned an invalid track list. Try again.");
  const tracks: SpotifyTrack[] = [];
  const ids = new Set<string>();
  for (const item of value.items.slice(0, 50)) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^[A-Za-z0-9]{22}$/.test(item.id)
      || ids.has(item.id) || item.is_local === true || (item.type !== undefined && item.type !== "track")) continue;
    const name = cleanText(item.name);
    const artists = Array.isArray(item.artists) ? item.artists.slice(0, 10).flatMap((artist) => {
      const artistName = isRecord(artist) ? cleanText(artist.name) : null;
      return artistName ? [artistName] : [];
    }) : [];
    if (!name || !artists.length) continue;
    ids.add(item.id);
    tracks.push({ id: item.id, name, artists, url: `https://open.spotify.com/track/${item.id}` });
  }
  return tracks;
}

/** Forget this tab's credentials and invalidate any requests already in flight. */
export function disconnectSpotify(): void {
  generation++;
  session = null;
  for (const request of requests) request.abort();
  clearPending();
}
