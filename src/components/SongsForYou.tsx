"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { disconnectSpotify, finishSpotifyLogin, getTopTracks, startSpotifyLogin, type SpotifyTrack } from "@/lib/spotify/client";
import { recommendSongs, starterSongs, type PracticeRecommendation } from "@/lib/practice/recommendations";
import type { PracticeGoal, PracticeInstrument, PracticeLevel } from "@/lib/practice/catalog";

const PREFERENCES_KEY = "body-synth.practice-preferences.v1";
const CLIENT_ID_KEY = "body-synth.spotify-client-id";
const DEFAULTS = { instrument: "guitar" as PracticeInstrument, level: 1 as PracticeLevel, goal: "any" as PracticeGoal };
const LEVELS = { 1: "Starting out", 2: "Comfortable with basics", 3: "Ready for a challenge" };
const FIT_LABELS = { "play-now": "Play today", stretch: "Next challenge", goal: "Work toward it", unassessed: "Not assessed" };

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
    return {
      instrument: value?.instrument === "bass" ? "bass" as const : "guitar" as const,
      level: ([1, 2, 3].includes(value?.level) ? value.level : 1) as PracticeLevel,
      goal: (["any", "groove", "chords", "riffs"].includes(value?.goal) ? value.goal : "any") as PracticeGoal,
    };
  } catch { return DEFAULTS; }
}

function readClientId() {
  try { return process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? localStorage.getItem(CLIENT_ID_KEY) ?? ""; }
  catch { return process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? ""; }
}

function SongCard({ pick, instrument, index }: { pick: PracticeRecommendation; instrument: PracticeInstrument; index: number }) {
  const song = pick.catalog!;
  const part = pick.arrangement!;
  return (
    <article className="flex flex-col rounded-2xl border border-white/10 bg-zinc-950 p-5 sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <span className="font-mono text-sm text-zinc-500">{String(index + 1).padStart(2, "0")}</span>
        <span className={`rounded-full px-3 py-1 text-xs ${pick.fit === "play-now" ? "bg-emerald-400/10 text-emerald-300" : pick.fit === "stretch" ? "bg-yellow-300/10 text-yellow-200" : "bg-white/5 text-zinc-400"}`}>{FIT_LABELS[pick.fit]}</span>
      </div>
      <h3 className="text-2xl font-semibold tracking-tight">{song.title}</h3>
      <p className="mt-1 text-sm text-zinc-400">{song.artist}</p>
      <p className="mt-6 text-xs font-mono uppercase tracking-widest text-emerald-300">{part.section}</p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-300">{part.focus}</p>
      <div className="mt-4 flex flex-wrap gap-2">{part.techniques.map((technique) => <span key={technique} className="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-400">{technique}</span>)}</div>
      <ul className="mt-5 space-y-1.5 text-xs leading-relaxed text-zinc-400">{pick.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
        {part.chartId === "yukon" ? <Link href={`/${instrument}?song=yukon`} className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-200">Practice YUKON →</Link> : <a href={part.sourceUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5">Learn this part ↗</a>}
        {pick.track && <a href={pick.track.url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-300 underline underline-offset-4">Listen on Spotify ↗</a>}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">{part.chartId ? "Available in the trainer" : `External lesson · ${part.sourceLabel}`}</p>
    </article>
  );
}

export default function SongsForYou() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [clientId, setClientId] = useState(readClientId);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(() => /[?&](code|error)=/.test(window.location.search));
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const requestRef = useRef(0);
  const picks = useMemo(() => connected ? recommendSongs(tracks, preferences) : starterSongs(preferences), [connected, tracks, preferences]);
  const assessed = picks.filter((pick) => pick.status === "matched" && pick.arrangement);
  const unassessed = picks.filter((pick) => pick.status !== "matched");
  const redirectUri = `${window.location.origin}/for-you`;

  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Session preferences still work when storage is unavailable. */ }
  }, [preferences]);

  useEffect(() => {
    let active = true;
    const request = ++requestRef.current;
    finishSpotifyLogin().then((result) => {
      if (!active || request !== requestRef.current) return;
      setConnected(result.connected);
      setTracks(result.tracks);
    }).catch((cause: unknown) => {
      if (active && request === requestRef.current) setError(cause instanceof Error ? cause.message : "Spotify could not connect. Try again.");
    }).finally(() => {
      if (active && request === requestRef.current) setBusy(false);
    });
    return () => { active = false; };
  }, []);

  async function connect(event?: FormEvent) {
    event?.preventDefault();
    if (!clientId.trim()) { setShowSetup(true); return; }
    if (!/^[a-f0-9]{32}$/i.test(clientId.trim())) {
      setShowSetup(true);
      setError("Enter the 32-character public Client ID from your Spotify app settings.");
      return;
    }
    const request = ++requestRef.current;
    setBusy(true);
    setError(null);
    try {
      try { localStorage.setItem(CLIENT_ID_KEY, clientId.trim()); } catch { /* Public configuration need not persist. */ }
      // An explicit retry replaces an abandoned authorization (for example after Back).
      disconnectSpotify();
      await startSpotifyLogin(clientId.trim());
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError(cause instanceof Error ? cause.message : "Spotify could not open. Try again.");
      setBusy(false);
    }
  }

  async function refresh() {
    const request = ++requestRef.current;
    setBusy(true);
    setError(null);
    try {
      const nextTracks = await getTopTracks();
      if (request === requestRef.current) setTracks(nextTracks);
    } catch (cause) {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : "Tracks could not refresh. Reconnect Spotify.");
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  }

  function disconnect() {
    requestRef.current++;
    disconnectSpotify();
    setConnected(false);
    setTracks([]);
    setBusy(false);
    setError(null);
  }

  return (
    <main className="fixed inset-0 overflow-y-auto bg-black text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-8">
        <Link href="/guitar" className="font-semibold tracking-tight">body.synth <span className="ml-2 font-normal text-zinc-500">/ songs</span></Link>
        <nav aria-label="Main navigation" className="flex gap-1 text-xs">
          {[ ["/for-you", "For you"], ["/guitar", "Guitar"], ["/bass", "Bass"], ["/studio", "Studio"] ].map(([href, label]) => <Link key={href} href={href} aria-current={href === "/for-you" ? "page" : undefined} className={`rounded-full px-3 py-2 ${href === "/for-you" ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}>{label}</Link>)}
        </nav>
      </header>
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-300">A song you love. A part you can play.</p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">What should I<br />play next?</h1>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">Start with one section. Find a comfortable win, stretch a little, then make it your own in the studio.</p>

        <section aria-label="Spotify connection" className="mt-9 rounded-xl border border-white/10 bg-zinc-950 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-medium">{connected ? "Your Spotify favorites" : "Bring your favorite songs"}</h2>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">{connected ? `${tracks.length} top tracks from Spotify · last 4 weeks` : "Connect Spotify to see practice guides for your top tracks. Starter picks are below."}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {connected ? <><button onClick={refresh} disabled={busy} className="rounded-lg border border-white/15 px-4 py-2 text-sm disabled:opacity-50">{busy ? "Refreshing…" : "Refresh tracks"}</button><button onClick={disconnect} className="text-xs text-zinc-400 hover:text-white">Disconnect</button></> : <button onClick={() => connect()} disabled={busy} className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-200 disabled:opacity-50">{busy ? "Connecting…" : "Connect Spotify"}</button>}
            </div>
          </div>
          {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
          {!connected && <button onClick={() => setShowSetup(!showSetup)} aria-expanded={showSetup} className="mt-4 text-xs text-zinc-400 underline underline-offset-4">One-time Spotify setup</button>}
          {showSetup && !connected && <form onSubmit={connect} className="mt-4 max-w-2xl space-y-3 border-t border-white/10 pt-4 text-sm text-zinc-300">
            <ol className="list-decimal space-y-2 pl-5 text-xs leading-relaxed text-zinc-400">
              <li>Create an app in the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-emerald-300 underline">Spotify developer dashboard</a> and select Web API. The app owner needs Spotify Premium.</li>
              <li>Register this exact redirect URL: <code className="break-all text-zinc-200">{redirectUri}</code>. For local testing use <code>127.0.0.1</code>, since Spotify rejects <code>localhost</code>.</li>
              <li>Add your Spotify account under Users and Access, then paste the public Client ID below.</li>
            </ol>
            <label className="block text-xs text-zinc-400" htmlFor="spotify-client-id">Public Client ID — never enter the client secret</label>
            <div className="flex flex-wrap gap-2"><input id="spotify-client-id" autoComplete="off" spellCheck={false} value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Client ID" maxLength={32} className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 font-mono text-sm" /><button disabled={busy} className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-medium text-black disabled:opacity-50">Connect</button></div>
            <p className="text-xs text-zinc-500">Read-only access to top tracks. Connection lasts for this browser session. <Link href="/for-you/privacy" className="underline underline-offset-4">Privacy & data</Link></p>
          </form>}
        </section>

        <section aria-label="Practice preferences" className="mt-7 flex flex-wrap gap-5 rounded-xl border border-white/10 p-5">
          <label className="flex flex-col gap-2 text-xs text-zinc-400">Instrument<select value={preferences.instrument} onChange={(event) => setPreferences({ ...preferences, instrument: event.target.value as PracticeInstrument })} className="rounded-lg border border-white/15 bg-zinc-950 px-3 py-2 text-sm text-white"><option value="guitar">Guitar</option><option value="bass">Bass</option></select></label>
          <label className="flex flex-col gap-2 text-xs text-zinc-400">Comfort level<select value={preferences.level} onChange={(event) => setPreferences({ ...preferences, level: Number(event.target.value) as PracticeLevel })} className="rounded-lg border border-white/15 bg-zinc-950 px-3 py-2 text-sm text-white">{Object.entries(LEVELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="flex flex-col gap-2 text-xs text-zinc-400">Work on<select value={preferences.goal} onChange={(event) => setPreferences({ ...preferences, goal: event.target.value as PracticeGoal })} className="rounded-lg border border-white/15 bg-zinc-950 px-3 py-2 text-sm text-white"><option value="any">A bit of everything</option><option value="groove">Groove & timing</option><option value="chords">Chords & changes</option><option value="riffs">Riffs & melodies</option></select></label>
        </section>

        <div className="mb-5 mt-10 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-xl font-semibold">{connected ? "Practice picks from your favorites" : "A few good places to start"}</h2><p className="mt-2 text-xs leading-relaxed text-zinc-500">Ranked by your chosen level and goal. Difficulty is an estimate for this section, not the whole song.</p></div>
          <Link href="/studio" className="text-sm text-emerald-300 hover:underline">Open studio →</Link>
        </div>
        {assessed.length > 0 ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{assessed.map((pick, index) => <SongCard key={pick.track?.id ?? pick.catalog!.id} pick={pick} instrument={preferences.instrument} index={index} />)}</div> : <div className="rounded-xl border border-white/10 p-6"><p className="text-zinc-300">{tracks.length ? "We haven’t verified a practice guide for these favorites on this instrument yet." : "Spotify returned no top tracks for the last four weeks."}</p><p className="mt-2 text-sm text-zinc-500">Your favorites stay below. Here are a few starter sections that fit your selected practice preferences.</p></div>}
        {connected && assessed.length === 0 && <section className="mt-6" aria-label="Starter practice picks"><h3 className="mb-4 text-sm text-zinc-400">Starter picks · independent of your Spotify listening</h3><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{starterSongs(preferences).slice(0, 3).map((pick, index) => <SongCard key={pick.catalog!.id} pick={pick} instrument={preferences.instrument} index={index} />)}</div></section>}

        {connected && unassessed.length > 0 && <section className="mt-10" aria-label="Favorites without practice ratings"><h2 className="text-lg font-medium">More of your favorites</h2><p className="mt-2 text-xs text-zinc-500">No difficulty guesses. These need a verified guide for {preferences.instrument}.</p><div className="mt-4 divide-y divide-white/10 rounded-xl border border-white/10 px-4">{unassessed.map((pick) => pick.track && <div key={pick.track.id} className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="truncate text-sm">{pick.track.name}</p><p className="mt-1 truncate text-xs text-zinc-500">{pick.track.artists.join(", ")} · Not assessed</p></div><a href={pick.track.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-emerald-300 underline underline-offset-4">Spotify ↗</a></div>)}</div></section>}
        <details className="mt-10 border-t border-white/10 pt-5 text-xs text-zinc-500"><summary className="cursor-pointer">How the picks work</summary><p className="mt-3 max-w-3xl leading-relaxed">Spotify supplies its existing top-track list. We match song and artist names to independently written practice guides, then sort those guides by your selected instrument, comfort level, and goal. We don’t estimate difficulty from Spotify audio or create a listening profile. Only YUKON currently has an in-app chart; other picks link to their lesson source.</p><p className="mt-3">Spotify tracks and connection tokens stay in memory and clear on reload or disconnect. Your practice preferences and public Client ID stay on this device. <Link href="/for-you/privacy" className="underline">Privacy & data</Link></p></details>
      </div>
    </main>
  );
}
