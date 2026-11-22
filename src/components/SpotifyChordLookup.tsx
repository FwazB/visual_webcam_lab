"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { resolveSpotifyTrackId } from "@/lib/spotify/trackLink";
import { CHART_LICENSE, CHART_SOURCE, findPublishedChart, type ChartSection } from "@/lib/progressions/publishedChart";
import { publishedFingering } from "@/lib/progressions/publishedVoicings";
import { SPOTIFY_SONG_IDS } from "@/lib/progressions/spotifyTracks";
import type { Chord, Instrument } from "@/lib/progressions/music";
import ChordShape from "./ProgressionFingering";
import styles from "./SpotifyChordLookup.module.css";
import layout from "./ProgressionGenerator.module.css";

interface Props {
  instrument: Instrument;
  onOpenLesson: (slug: string) => string;
  onLookupView: (open: boolean) => void;
  preview: (notes: number[], instrument: Instrument) => void;
  stop: () => void;
  audioMessage: string | null;
}

interface ChartMatch { id: string; sections: ChartSection[] }

export default function SpotifyChordLookup({ instrument, onOpenLesson, onLookupView, preview, stop, audioMessage }: Props) {
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [inLookup, setInLookup] = useState(false);
  const [match, setMatch] = useState<ChartMatch | null>(null);
  const [title, setTitle] = useState("");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [chordIndex, setChordIndex] = useState(0);
  const active = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function lookup(value: string) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    setMatch(null);
    setTitle("");
    setInLookup(true);
    onLookupView(true);
    setMessage("Finding chords…");
    try {
      const id = await resolveSpotifyTrackId(value.trim(), signal);
      if (signal.aborted) return;
      const slug = SPOTIFY_SONG_IDS[id];
      if (slug) {
        setInLookup(false);
        onLookupView(false);
        setMessage(`Opened ${onOpenLesson(slug)}.`);
        return;
      }
      const sections = await findPublishedChart(id, signal);
      if (signal.aborted) return;
      if (!sections) {
        setMessage("No chord chart for this Spotify release. If you have another release of the same song, try its link.");
        return;
      }
      setSectionIndex(0);
      setChordIndex(0);
      setMatch({ id, sections });
      setMessage("Community chart found.");
      // The title is optional. Exact-ID matching and the chart work without Spotify metadata.
      const trackUrl = `https://open.spotify.com/track/${id}`;
      try {
        const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`, {
          signal, credentials: "omit", referrerPolicy: "no-referrer",
        });
        if (response.ok) {
          const metadata = await response.json();
          if (!signal.aborted && typeof metadata.title === "string") setTitle(metadata.title);
        }
      } catch { /* The chart is already visible. */ }
    } catch (error) {
      if (!signal.aborted) setMessage(error instanceof Error && error.name === "SpotifyLinkError"
        ? error.message : "Couldn’t load this chart. Check the track link and try again.");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (input.trim()) void lookup(input);
  }
  function close() {
    active.current?.abort();
    setMatch(null);
    setTitle("");
    setInLookup(false);
    setInput("");
    setMessage("");
    onLookupView(false);
    field.current?.focus();
  }
  function hear(chord: Chord | null) {
    if (chord) preview(chord.strings.flatMap(string => string.midi === null ? [] : [string.midi]), instrument);
    else stop();
  }

  const section = match?.sections[sectionIndex];
  const symbol = section?.chords[chordIndex];
  const shape = symbol ? publishedFingering(symbol, instrument) : null;
  return <section className={styles.lookup} aria-label="Spotify chord lookup">
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="spotify-track-link">Paste a Spotify track link</label>
      <div className={styles.fields}>
        <input ref={field} id="spotify-track-link" type="text" inputMode="url" autoComplete="off" spellCheck={false}
          placeholder="https://open.spotify.com/track/…" value={input}
          onChange={event => {
            active.current?.abort();
            if (inLookup) onLookupView(false);
            setInLookup(false); setMatch(null); setMessage(""); setInput(event.target.value);
          }}
          onPaste={event => {
            const text = event.clipboardData.getData("text").trim();
            if (!text) return;
            event.preventDefault(); setInput(text); void lookup(text);
          }} />
        <button type="submit" disabled={!input.trim()}>Find chords</button>
      </div>
    </form>
    <div className={styles.feedback}>
      <p role="status">{message}</p>
      {inLookup && <button type="button" onClick={close}>Back to song library</button>}
    </div>
    {match && section && <div className={layout.workbench}>
      <div>
        <h2 className={styles.title}>{title || "Spotify track chords"}</h2>
        <a className={styles.link} href={`https://open.spotify.com/track/${match.id}`} target="_blank" rel="noreferrer">Open on Spotify</a>
        <label className={styles.sectionPicker}>Song section
          <select value={sectionIndex} onChange={event => {
            stop(); setSectionIndex(Number(event.target.value)); setChordIndex(0);
          }}>
            {match.sections.map((item, index) => <option key={index} value={index}>{item.name}</option>)}
          </select>
        </label>
        <p className={styles.hint}>Chords are in playing order. This chart has no beat counts.</p>
        <ol className={styles.chords} aria-label="Published chord changes">
          {section.chords.map((name, index) => <li key={index}><button type="button" aria-pressed={index === chordIndex}
            aria-label={`Chord ${index + 1}, ${name}`} onClick={() => {
              setChordIndex(index); hear(publishedFingering(name, instrument));
            }}>{name}</button></li>)}
        </ol>
        <p className={styles.credit}>Chords from <a href={CHART_SOURCE} target="_blank" rel="noreferrer">Chordonomicon</a> by
          {" "}Kantarelis, Liolitsas, Thomas, Lyberatos, Dervakos and Stamou. Notation adapted for display.
          {" "}<a href={CHART_LICENSE} target="_blank" rel="noreferrer">CC BY-NC 4.0</a>.</p>
        {audioMessage && <p role="status">{audioMessage}</p>}
      </div>
      {shape ? <ChordShape chord={shape} instrument={instrument} position={`Chord ${chordIndex + 1} of ${section.chords.length}`}
        hear={() => hear(shape)} /> : <section className={layout.shape} aria-label="Selected chord">
        <h2 className={styles.title}>{symbol}</h2>
        <p>A {instrument} fingering for this symbol isn’t available yet.</p>
      </section>}
    </div>}
  </section>;
}
