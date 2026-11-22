"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useProgressionPlayer } from "@/hooks/useProgressionPlayer";
import { useTiltStep } from "@/hooks/useTiltStep";
import { BASS_STANDARD, GUITAR_STANDARD } from "@/lib/instrument/profile";
import { getProgression, KEYS, MOODS, nextVariation, type Chord, type Instrument } from "@/lib/progressions/music";
import styles from "./ProgressionGenerator.module.css";

const fingers = ["index", "middle", "ring", "pinky"];

function stringName(labels: string[], index: number) {
  if (labels.length === 6 && (index === 0 || index === 5)) return index === 0 ? "low E" : "high E";
  return labels[index];
}

function ChordDiagram({ chord, labels }: { chord: Chord; labels: string[] }) {
  const titleId = useId();
  const summaryId = useId();
  const fretted = chord.strings.flatMap(string => string.fret !== null && string.fret > 0 ? [string.fret] : []);
  const highest = Math.max(0, ...fretted);
  const first = highest <= 4 ? 1 : Math.min(...fretted);
  const rows = Math.max(4, highest - first + 1);
  const left = 30;
  const top = 50;
  const step = 36;
  const stringX = (index: number) => left + index * 32;
  const fretY = (fret: number) => top + (fret - first + 0.5) * step;
  const right = stringX(chord.strings.length - 1);
  const bottom = top + rows * step;
  const barre = chord.barre;

  return <svg className={styles.diagram} viewBox={`0 0 ${right + 21} ${bottom + 8}`} role="img"
    aria-labelledby={`${titleId} ${summaryId}`}>
    <title id={titleId}>{`${chord.name} chord diagram`}</title>
    <desc id={summaryId}>Strings run from lowest to highest. Frets {first} through {first + rows - 1}.
      {" "}{chord.strings.map((string, index) => `${stringName(labels, index)}, ${string.fret === null ? "mute" : string.fret === 0 ? "open" : `fret ${string.fret}, finger ${string.finger}`}`).join(". ")}.
      {barre && ` Barre finger ${barre.finger} across strings ${stringName(labels, barre.from)} through ${stringName(labels, barre.to)} at fret ${barre.fret}.`}
    </desc>
    <rect x={left} y={top} width={right - left} height={bottom - top} className={styles.neck} />
    {Array.from({ length: rows + 1 }, (_, index) => <g key={index}>
      <line x1={left} x2={right} y1={top + index * step} y2={top + index * step}
        className={styles.fretWire} strokeWidth={!index && first === 1 ? 5 : 1.5} />
      {index < rows && <text x={left - 12} y={fretY(first + index)} className={styles.fretLabel}
        textAnchor="end" dominantBaseline="central">{first + index}</text>}
    </g>)}
    {chord.strings.map((string, index) => <g key={index}>
      <line x1={stringX(index)} x2={stringX(index)} y1={top} y2={bottom}
        className={styles.string} strokeWidth={1 + .25 * (labels.length - 1 - index)} />
      <text x={stringX(index)} y={15} textAnchor="middle" className={styles.stringLabel}>{labels[index]}</text>
      {(string.fret === null || string.fret === 0) && <text x={stringX(index)} y={36} textAnchor="middle"
        className={styles.openString}>{string.fret === null ? "X" : "O"}</text>}
    </g>)}
    {barre && <line x1={stringX(barre.from)} x2={stringX(barre.to)} y1={fretY(barre.fret)} y2={fretY(barre.fret)}
      strokeWidth={18} strokeLinecap="round" className={styles.barre} />}
    {chord.strings.map((string, index) => string.fret !== null && string.fret > 0 &&
      <g key={index}>
        <circle cx={stringX(index)} cy={fretY(string.fret)} r={10.5} className={styles.fingerDot} />
        <text x={stringX(index)} y={fretY(string.fret)} textAnchor="middle" dominantBaseline="central"
          className={styles.fingerDigit}>{string.finger}</text>
      </g>)}
  </svg>;
}

function ChordShape({ chord, instrument, bar, total, hear }: {
  chord: Chord; instrument: Instrument; bar: number; total: number; hear: () => void;
}) {
  const labels = (instrument === "guitar" ? GUITAR_STANDARD : BASS_STANDARD).stringLabels;
  const barre = chord.barre;
  return <section className={styles.shape} aria-label="Selected chord fingering">
    <header className={styles.shapeHeading}>
      <div>
        <p className={styles.barLabel}>Bar {bar} of {total}</p>
        <h2>{chord.name}</h2>
      </div>
      <button type="button" className={styles.hear} onClick={hear}>
        <span className={styles.playIcon} aria-hidden="true" />Hear chord
      </button>
    </header>
    <div className={styles.shapeBody}>
      <figure className={styles.diagramFigure}><ChordDiagram chord={chord} labels={labels} />
        <figcaption>Lowest string on the left</figcaption>
      </figure>
      <div className={styles.shapeGuide}>
        <h3>Chord tones</h3>
        <p className={styles.notes}>{chord.notes.join(" · ")}</p>
        <h3>Fretting hand</h3>
        <ol className={styles.fingers}>
          {fingers.map((name, index) => <li key={name}><span>{index + 1}</span>{name}</li>)}
        </ol>
        <p className={styles.symbols}><b>X</b> mute <b>O</b> open</p>
      </div>
    </div>
    {barre && <p className={styles.barreTip}>Lay your {fingers[barre.finger - 1]} finger across the {stringName(labels, barre.from)} through {stringName(labels, barre.to)} strings at fret {barre.fret}.</p>}
    <details className={styles.positions}>
      <summary>String-by-string fingering</summary>
      <table>
        <caption>Strings from low to high</caption>
        <thead><tr><th scope="col">String</th>{labels.map((label, index) =>
          <th key={label} scope="col" aria-label={stringName(labels, index)}>{label}</th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">Fret</th>{chord.strings.map((string, index) => <td key={index}>{string.fret === null ? "Mute" : string.fret === 0 ? "Open" : string.fret}</td>)}</tr>
          <tr><th scope="row">Finger</th>{chord.strings.map((string, index) => <td key={index}>{string.finger ?? "—"}</td>)}</tr>
        </tbody>
      </table>
    </details>
  </section>;
}

export default function ProgressionGenerator({ initialInstrument = "guitar" }: { initialInstrument?: Instrument }) {
  const [instrument, setInstrument] = useState<Instrument>(initialInstrument);
  const [tonic, setTonic] = useState(0);
  const [mood, setMood] = useState<string>(MOODS[0].id);
  const [variation, setVariation] = useState(0);
  const [selected, setSelected] = useState(0);
  const [bpm, setBpm] = useState(84);
  const player = useProgressionPlayer();
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const progression = useMemo(() => getProgression(tonic, mood, variation, instrument), [tonic, mood, variation, instrument]);
  const voices = useMemo(() => progression.map(chord => chord.strings.flatMap(string => string.midi === null ? [] : [string.midi])), [progression]);
  const current = player.playing ? player.activeIndex ?? selected : selected;
  const chord = progression[current];

  useTiltStep(direction => {
    if (!player.playing) setSelected(index => (index + direction + progression.length) % progression.length);
  });

  function reset() {
    player.stop();
    setSelected(0);
  }
  function changeInstrument(value: Instrument) {
    if (value === instrument) return;
    stopAtCurrent();
    setInstrument(value);
    const url = new URL(window.location.href);
    if (value === "bass") url.searchParams.set("instrument", value);
    else url.searchParams.delete("instrument");
    window.history.replaceState(window.history.state, "", url);
  }
  function selectBar(index: number) {
    setSelected(index);
    if (player.playing) player.play(voices, instrument, bpm, index);
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
    selectBar(next);
    tiles.current[next]?.focus();
  }
  function stopAtCurrent() {
    setSelected(current);
    player.stop();
  }
  function toggleLoop() {
    if (player.playing) stopAtCurrent();
    else player.play(voices, instrument, bpm, selected);
  }

  return <main className={styles.page}>
    <div className={styles.inner}>
      <header className={styles.masthead}>
        <Link href="/" className={styles.home} aria-label="Body Synth home">body.synth</Link>
        <div className={styles.instruments} role="group" aria-label="Instrument">
          {(["guitar", "bass"] as const).map(value => <button key={value} type="button" aria-pressed={instrument === value}
            onClick={() => changeInstrument(value)}>{value === "guitar" ? "Guitar" : "Bass"}</button>)}
        </div>
      </header>
      <h1 className={styles.title}>Chord progression generator</h1>
      <div className={styles.workbench}>
        <section className={styles.composer} aria-label="Progression controls and playback">
          <div className={styles.settings}>
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
          <p className={styles.help}>Choose a bar to see its fingering.</p>
          <ol className={styles.score} aria-label="Progression bars">
            {progression.map((item, index) => <li key={index}>
              <button type="button" ref={button => { tiles.current[index] = button; }} aria-pressed={current === index}
                aria-label={`Bar ${index + 1}, ${item.name}, ${item.numeral}`} onClick={() => selectBar(index)}
                onKeyDown={event => arrowKey(event, index)} className={styles.tile}>
                <span className={styles.tileBar}>Bar {index + 1}</span><strong>{item.name}</strong>
                <span className={styles.degree}>{item.numeral}</span>
              </button>
            </li>)}
          </ol>
          <div className={styles.transport}>
            <button type="button" className={styles.play} onClick={toggleLoop}>
              <span className={player.playing ? styles.stopIcon : styles.playIcon} aria-hidden="true" />
              {player.playing ? "Stop loop" : "Play loop"}
            </button>
            <label className={styles.tempo}>Tempo <span>{bpm} BPM</span>
              <input type="range" min="50" max="160" value={bpm} aria-label="Tempo" aria-valuetext={`${bpm} beats per minute`}
                onChange={event => { stopAtCurrent(); setBpm(Number(event.target.value)); }} />
            </label>
          </div>
          {player.error && <p role="alert" className={styles.error}>{player.error}</p>}
        </section>
        <ChordShape chord={chord} instrument={instrument} bar={current + 1} total={progression.length} hear={() => {
          setSelected(current); player.preview(voices[current], instrument);
        }} />
      </div>
    </div>
  </main>;
}
