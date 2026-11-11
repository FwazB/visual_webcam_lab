"use client";

import { useState } from "react";
import styles from "@/app/pocket-operators/guide.module.css";

const parts = [
  { name: "Kick", sound: 1, steps: [1, 9], feel: "The low pulse. One hit on beats 1 and 3." },
  { name: "Snare", sound: 2, steps: [5, 13], feel: "The backbeat. One hit on beats 2 and 4." },
  { name: "Hi-hat", sound: 3, steps: [1, 3, 5, 7, 9, 11, 13, 15], feel: "The steady ticks. Two hits per beat." },
];

/** An instructional reference, deliberately independent of audio and hardware. */
export default function PocketPattern() {
  const [selected, setSelected] = useState(0);
  const part = parts[selected];

  return (
    <figure className={styles.pattern} aria-labelledby="pattern-title">
      <figcaption>
        <h3 id="pattern-title">Your first beat</h3>
        <p>Choose a part to see which steps to enter on your Rhythm.</p>
      </figcaption>
      <div className={styles.parts} role="group" aria-label="Pattern part">
        {parts.map((item, index) => (
          <button key={item.name} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>
            {item.name}
          </button>
        ))}
      </div>
      <div className={styles.patternReadout} aria-live="polite" aria-atomic="true">
        <strong>{part.name} · sound {part.sound}</strong>
        <span>Steps {part.steps.join(", ")}</span>
      </div>
      <div className={styles.padRows} aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <div className={styles.padRow} key={row}>
            <span className={styles.beatLabel}>Beat {row + 1}</span>
            {Array.from({ length: 4 }, (_, column) => {
              const step = row * 4 + column + 1;
              const active = part.steps.includes(step);
              return <span className={styles.pad} data-active={active} key={step}><span>{step}</span><small>{active ? "on" : "—"}</small></span>;
            })}
          </div>
        ))}
      </div>
      <p className={styles.patternFeel}>{part.feel}</p>
      <p className={styles.fine}>This is a silent reference. Enter the steps on your Pocket Operator; this page does not control it.</p>
    </figure>
  );
}
