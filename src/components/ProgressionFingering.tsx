"use client";

import { useId } from "react";
import { BASS_STANDARD, GUITAR_STANDARD } from "@/lib/instrument/profile";
import type { Chord, Instrument } from "@/lib/progressions/music";
import type { LevelId } from "@/lib/progressions/songPath";
import styles from "./ProgressionGenerator.module.css";

const fingers = ["index", "middle", "ring", "pinky"];
const bassParts = {
  easy: { label: "Bass root", preview: "Hear root" },
  intermediate: { label: "Root and fifth together", preview: "Hear both notes" },
  advanced: { label: "Bass triad", preview: "Hear triad" },
};

function stringName(labels: string[], index: number) {
  if (labels.length === 6 && (index === 0 || index === 5)) return index === 0 ? "low E" : "high E";
  return labels[index];
}

function ChordDiagram({ chord, labels, title }: { chord: Chord; labels: string[]; title: string }) {
  const titleId = useId();
  const summaryId = useId();
  const fretted = chord.strings.flatMap(string => string.fret !== null && string.fret > 0 ? [string.fret] : []);
  const highest = Math.max(0, ...fretted);
  const first = highest <= 4 ? 1 : Math.min(...fretted);
  const rows = Math.max(4, highest - first + 1);
  const left = 38;
  const top = 50;
  const step = 36;
  const stringX = (index: number) => left + index * 32;
  const fretY = (fret: number) => top + (fret - first + 0.5) * step;
  const right = stringX(chord.strings.length - 1);
  const bottom = top + rows * step;
  const barre = chord.barre;

  return <svg className={styles.diagram} viewBox={`0 0 ${right + 21} ${bottom + 8}`} role="img"
    aria-labelledby={`${titleId} ${summaryId}`}>
    <title id={titleId}>{title}</title>
    <desc id={summaryId}>Strings run from lowest to highest. Frets {first} through {first + rows - 1}.
      {" "}{chord.strings.map((string, index) => `${stringName(labels, index)}, ${string.fret === null ? "mute" : string.fret === 0 ? "open" : `fret ${string.fret}, finger ${string.finger}`}`).join(". ")}.
      {barre && ` Barre finger ${barre.finger} across strings ${stringName(labels, barre.from)} through ${stringName(labels, barre.to)} at fret ${barre.fret}.`}
    </desc>
    <rect x={left} y={top} width={right - left} height={bottom - top} className={styles.neck} />
    <text x={left - 9} y={36} textAnchor="end" className={styles.fretLabel}>Fret</text>
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

export default function ChordShape({ chord, instrument, position, level, hear }: {
  chord: Chord; instrument: Instrument; position: string; level?: LevelId; hear: () => void;
}) {
  const labels = (instrument === "guitar" ? GUITAR_STANDARD : BASS_STANDARD).stringLabels;
  const barre = chord.barre;
  const part = level && instrument === "bass" ? bassParts[level] : null;
  const bassNotes = [chord.notes[0], chord.notes[2], chord.notes[1]];
  const notes = part ? bassNotes.slice(0, chord.strings.filter(string => string.midi !== null).length) : chord.notes;
  return <section className={styles.shape} aria-label="Selected chord fingering">
    <header className={styles.shapeHeading}>
      <div>
        <p className={styles.barLabel}>{position}</p>
        <h2>{chord.name}</h2>
        {part && <p className={styles.partName}>{part.label}</p>}
      </div>
      <button type="button" className={styles.hear} onClick={hear}>
        <span className={styles.playIcon} aria-hidden="true" />{part?.preview ?? "Hear chord"}
      </button>
    </header>
    <table className={styles.positions}>
      <caption>Fret positions</caption>
      <thead><tr><th scope="col">String</th>{labels.map((label, index) =>
        <th key={label} scope="col">{stringName(labels, index)}</th>)}</tr></thead>
      <tbody>
        <tr><th scope="row">Fret</th>{chord.strings.map((string, index) =>
          <td key={index}>{string.fret === null ? "Mute" : string.fret === 0 ? "Open" : string.fret}</td>)}</tr>
        <tr><th scope="row">Finger</th>{chord.strings.map((string, index) =>
          <td key={index}>{string.finger ?? "—"}</td>)}</tr>
      </tbody>
    </table>
    <div className={styles.shapeBody}>
      <figure className={styles.diagramFigure}><ChordDiagram chord={chord} labels={labels}
        title={part ? `${chord.name}, ${part.label.toLowerCase()} diagram` : `${chord.name} chord diagram`} />
        <figcaption>Lowest string on the left. Dots show finger numbers.</figcaption>
      </figure>
      <div className={styles.shapeGuide}>
        <h3>{part ? "Notes to play" : "Chord tones"}</h3>
        <p className={styles.notes}>{notes.join(" · ")}</p>
        <h3>Fretting hand</h3>
        <ol className={styles.fingers}>
          {fingers.map((name, index) => <li key={name}><span>{index + 1}</span>{name}</li>)}
        </ol>
        <p className={styles.symbols}><b>X</b> mute <b>O</b> open</p>
      </div>
    </div>
    {barre && <p className={styles.barreTip}>Lay your {fingers[barre.finger - 1]} finger across the {stringName(labels, barre.from)} through {stringName(labels, barre.to)} strings at fret {barre.fret}.</p>}
  </section>;
}
