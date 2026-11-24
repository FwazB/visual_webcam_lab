"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import CustomProgressionEditor from "./CustomProgressionEditor";
import ProgressionsInstall from "./ProgressionsInstall";
import { useProgressionPlayer } from "@/hooks/useProgressionPlayer";
import { useTiltStep } from "@/hooks/useTiltStep";
import ChordShape from "./ProgressionFingering";
import SpotifyChordLookup from "./SpotifyChordLookup";
import { getProgression, getSongChord, KEYS, MOODS, nextVariation, type Instrument } from "@/lib/progressions/music";
import { LEVELS, SONGS } from "@/lib/progressions/songPath";
import { createCustomProgression, customChordStep, type CustomProgression } from "@/lib/progressions/custom";
import styles from "./ProgressionGenerator.module.css";

type Mode = "song" | "free" | "custom";

function saveView(setParams: (params: URLSearchParams) => void) {
  const url = new URL(window.location.href);
  setParams(url.searchParams);
  window.history.replaceState(window.history.state, "", url);
}

function beatLabel(beats: number) {
  return `${beats} ${beats === 1 ? "beat" : "beats"}`;
}

export default function ProgressionGenerator({ initialInstrument = "guitar", initialSongId, initialMode = "song" }: {
  initialInstrument?: Instrument; initialSongId?: string; initialMode?: Mode;
}) {
  const [instrument, setInstrument] = useState<Instrument>(initialInstrument);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [songIndex, setSongIndex] = useState(() => Math.max(0, SONGS.findIndex(item => item.id === initialSongId)));
  const song = SONGS[songIndex];
  const level = LEVELS.find(item => item.id === song.level)!;
  const guided = mode === "song";
  const [tonic, setTonic] = useState(0);
  const [mood, setMood] = useState<string>(MOODS[0].id);
  const [variation, setVariation] = useState(0);
  const [custom, setCustom] = useState(createCustomProgression);
  const customDraftOpened = useRef(false);
  const [selected, setSelected] = useState(0);
  const [songBpm, setSongBpm] = useState<number>(level.bpm);
  const [freeBpm, setFreeBpm] = useState(84);
  const bpm = mode === "custom" ? custom.bpm : guided ? songBpm : freeBpm;
  const player = useProgressionPlayer();
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const chart = useMemo(() => {
    if (mode === "custom") return custom.steps.map(customChordStep);
    if (mode === "song") return song.chart;
  }, [mode, custom.steps, song.chart]);
  const voicingLevel = guided ? song.level : "advanced";
  const progression = useMemo(() => chart ? chart.map(step => getSongChord(step, instrument, voicingLevel))
    : getProgression(tonic, mood, variation, instrument), [chart, voicingLevel, instrument, tonic, mood, variation]);
  const beats = useMemo(() => chart?.map(step => step.beats), [chart]);
  const voices = useMemo(() => progression.map(chord => chord.strings.flatMap(string => string.midi === null ? [] : [string.midi])), [progression]);
  const current = player.playing ? player.activeIndex ?? selected : selected;
  const chord = progression[current];

  const stop = player.stop;
  const updateCustom = useCallback((next: CustomProgression, index?: number) => {
    if (index !== undefined) {
      stop();
      setSelected(index);
    }
    setCustom(next);
  }, [stop]);

  useTiltStep(direction => {
    if (!lookupOpen && !player.playing) setSelected(index => (index + direction + progression.length) % progression.length);
  });

  function reset() {
    player.stop();
    setSelected(0);
  }
  function chooseSong(index: number) {
    const next = SONGS[index];
    if (!next || index === songIndex) return;
    reset();
    setSongIndex(index);
    setSongBpm(LEVELS.find(item => item.id === next.level)!.bpm);
    saveView(params => { params.delete("mode"); params.set("song", next.id); });
  }
  function chooseMode(value: Mode) {
    if (value === mode) return;
    reset();
    setLookupOpen(false);
    setMode(value);
    saveView(params => {
      if (value === "song") { params.delete("mode"); params.set("song", song.id); }
      else { params.set("mode", value); params.delete("song"); }
    });
  }
  function changeInstrument(value: Instrument) {
    if (value === instrument) return;
    stopAtCurrent();
    setInstrument(value);
    saveView(params => {
      if (value === "bass") params.set("instrument", value);
      else params.delete("instrument");
    });
  }
  function selectChord(index: number) {
    setSelected(index);
    if (player.playing) player.play(voices, instrument, bpm, index, beats);
  }
  function arrowKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = (index + progression.length - 1) % progression.length; break;
      case "ArrowRight": next = (index + 1) % progression.length; break;
      case "Home": next = 0; break;
      case "End": next = progression.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectChord(next);
    tiles.current[next]?.focus();
  }
  function stopAtCurrent() {
    setSelected(current);
    player.stopLoop();
  }
  function toggleLoop() {
    if (player.playing) stopAtCurrent();
    else player.play(voices, instrument, bpm, selected, beats);
  }
  function changeTempo(value: number) {
    player.setTempo(value);
    if (mode === "custom") setCustom(draft => ({ ...draft, bpm: value }));
    else if (guided) setSongBpm(value);
    else setFreeBpm(value);
  }

  const transport = <>
    <div className={styles.transport}>
      {!lookupOpen && <button type="button" className={styles.play} onClick={toggleLoop}>
        <span className={player.playing ? styles.stopIcon : styles.playIcon} aria-hidden="true" />
        {player.playing ? "Stop loop" : "Play loop"}
      </button>}
      <label className={styles.metronome}>
        <input type="checkbox" checked={player.metronome} onChange={() => player.toggleMetronome(bpm)} />
        Metronome
      </label>
      <label className={styles.tempo}>Tempo <span>{bpm} BPM</span>
        <input type="range" min="50" max="160" value={bpm} aria-label="Tempo" aria-valuetext={`${bpm} beats per minute`}
          onChange={event => changeTempo(Number(event.target.value))} />
      </label>
    </div>
    {player.starting && <p role="status" className={styles.help}>Starting audio…</p>}
    {player.error && <p role="alert" className={styles.error}>{player.error}</p>}
  </>;

  return <main className={styles.page}>
    <div className={styles.inner}>
      <header className={styles.masthead}>
        <Link href="/" className={styles.home} aria-label="Body Synth home">body.synth</Link>
        <div className={styles.instruments} role="group" aria-label="Instrument">
          {(["guitar", "bass"] as const).map(value => <button key={value} type="button" aria-pressed={instrument === value}
            onClick={() => changeInstrument(value)}>{value === "guitar" ? "Guitar" : "Bass"}</button>)}
        </div>
      </header>
      <h1 className={styles.title}>Chord progressions</h1>
      <div className={styles.libraryTools}>
        <div className={styles.modes} role="group" aria-label="Practice mode">
          <button type="button" aria-pressed={guided} onClick={() => chooseMode("song")}>Song library</button>
          <button type="button" aria-pressed={mode === "free"} onClick={() => chooseMode("free")}>Free generator</button>
          <button type="button" aria-pressed={mode === "custom"} onClick={() => chooseMode("custom")}>Custom loop</button>
        </div>
        <ProgressionsInstall />
      </div>
      {lookupOpen && transport}
      {guided && <SpotifyChordLookup instrument={instrument} preview={player.preview} stop={player.stopLoop}
        onLookupView={open => { reset(); setLookupOpen(open); }}
        onOpenLesson={slug => {
          const index = SONGS.findIndex(item => item.id === slug);
          chooseSong(index);
          return SONGS[index].title;
        }} />}
      {!lookupOpen && <div className={styles.workbench}>
        <section className={styles.composer} aria-label="Progression controls and playback">
          {guided ? <>
            <div className={`${styles.settings} ${styles.songPicker}`}>
              <label>Choose a song<select value={song.id} onChange={event => chooseSong(SONGS.findIndex(item => item.id === event.target.value))}>
                {SONGS.map(item => <option key={item.id} value={item.id}>{item.title} · {item.artist} · {LEVELS.find(tier => tier.id === item.level)?.label}</option>)}
              </select></label>
              <button type="button" className={styles.nextSong} onClick={() => chooseSong((songIndex + 1) % SONGS.length)}>
                {songIndex === SONGS.length - 1 ? "Back to first song" : "Next song"}
              </button>
            </div>
            <header className={styles.songHeading}>
              <div className={styles.pathPosition}>
                <span>{level.label} · Song {songIndex + 1} of {SONGS.length}</span>
                {songIndex > 0 && <button type="button" onClick={() => chooseSong(songIndex - 1)}>Previous song</button>}
              </div>
              <h2>{song.title}</h2>
              <p className={styles.artist}>{song.artist}</p>
              <p className={styles.sectionName}>{song.section} <span>in {song.keyLabel ?? KEYS.find(key => key.value === song.practiceKey)?.label}</span></p>
              {song.arrangement && <p className={styles.arrangement}>{song.arrangement}</p>}
              <div className={styles.songLinks}>
                <a href={song.sourceUrl} target="_blank" rel="noreferrer" className={styles.lessonLink}>{song.sourceLabel}</a>
                <a href={song.listenUrl} target="_blank" rel="noreferrer" className={styles.lessonLink}>Hear the recording</a>
              </div>
            </header>
            <p className={styles.practiceCue}>{instrument === "guitar" ? level.guitarFocus : level.bassFocus}</p>
          </> : mode === "custom" ? <CustomProgressionEditor value={custom} onChange={updateCustom}
            selectedIndex={current} onSelect={selectChord} draftOpened={customDraftOpened} /> : <><div className={styles.settings}>
            <label>Key<select value={tonic} onChange={event => { reset(); setTonic(Number(event.target.value)); }}>
              {KEYS.map(key => <option key={key.value} value={key.value}>{key.label}</option>)}
            </select></label>
            <label>Mood<select value={mood} onChange={event => { reset(); setMood(event.target.value); setVariation(0); }}>
              {MOODS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select></label>
            <button type="button" className={styles.generate} onClick={() => {
              reset(); setVariation(nextVariation(mood, variation));
            }}><span aria-hidden="true">↻</span>New progression</button>
          </div>
          <div className={styles.scoreHeading}><h2>Your progression</h2><span>4 beats per chord</span></div>
          </>}
          <p className={styles.help}>Tap a chord to hear it and see its fingering.</p>
          <ol className={styles.score} data-count={progression.length} aria-label={mode === "custom" ? "Custom chords" : guided ? "Practice chords" : "Progression bars"}>
            {progression.map((item, index) => <li key={index}>
              <button type="button" ref={button => { tiles.current[index] = button; }} aria-pressed={current === index}
                aria-label={[beats ? `Chord ${index + 1}` : `Bar ${index + 1}`, item.name, item.numeral, beats && beatLabel(beats[index])].filter(Boolean).join(", ")}
                onClick={() => {
                  selectChord(index);
                  if (!player.playing) player.preview(voices[index], instrument);
                }}
                onKeyDown={event => arrowKey(event, index)} className={styles.tile}>
                <span className={styles.tileBar}>{beats ? beatLabel(beats[index]) : `Bar ${index + 1}`}</span><strong>{item.name}</strong>
                {item.numeral && <span className={styles.degree}>{item.numeral}</span>}
              </button>
            </li>)}
          </ol>
          {transport}
          {guided && <p className={styles.advanceCue}>{songIndex === SONGS.length - 1
            ? "Finish with two steady loops, then revisit a song or try the free generator."
            : "When you can play two loops without losing the beat, try the next song."}</p>}
        </section>
        <ChordShape chord={chord} instrument={instrument} level={guided ? level.id : undefined}
          position={beats ? `Chord ${current + 1} of ${progression.length} · ${beatLabel(beats[current])}` : `Bar ${current + 1} of ${progression.length}`} hear={() => {
          setSelected(current); player.preview(voices[current], instrument);
        }} />
      </div>}
    </div>
  </main>;
}
