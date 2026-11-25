import score from "./rust-teeth.json";
import styles from "../guide.module.css";

export default function GuitarBacking() {
  return (
    <section id="guitar-backing" className={styles.backing} aria-labelledby="backing-title">
      <header>
        <h2 id="backing-title">Rust Teeth</h2>
        <p>A half-time guitar backing at <strong>{score.bpm} BPM</strong>. Palm-mute a low string with the kicks on steps 1 and 7, then let a power chord ring over the snare on beat three. On the fourth bar, cut the chord short and let the toms answer.</p>
        <figure className={styles.loopPlayer}>
          <figcaption>Play along · four-bar synthesized drum loop</figcaption>
          <audio controls loop preload="none" aria-label="Play Rust Teeth guitar backing loop" src="/audio/rust-teeth.wav" />
        </figure>
      </header>
      <div className={styles.backingScore}>
        <table>
          <caption>PO-12 steps to light</caption>
          <thead><tr><th scope="col">Sound</th><th scope="col">A · groove</th><th scope="col">B · fill</th></tr></thead>
          <tbody>
            {score.parts.map(part => (
              <tr key={part.sound}>
                <th scope="row">{part.name} <kbd>{part.sound}</kbd></th>
                <td>{part.A.join(", ") || "Rest"}</td>
                <td>{part.B.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.chain}>Pattern chain <strong>{score.chain.join(" → ")}</strong></p>
      </div>
      <ol className={styles.instructions}>
        <li><h3>Write the groove</h3><p>Choose two empty pattern slots or two you’re happy to replace. Call the first A and the second B. Select A. If it contains a pattern you want to erase, clear just that slot with <kbd>funct</kbd> + <kbd>pattern</kbd>. Hold <kbd>bpm</kbd> and turn knob <kbd>B</kbd> to {score.bpm}. In write mode, select each sound with <kbd>sound</kbd> + its number and light the steps in column A.</p></li>
        <li><h3>Make the fourth-bar fill</h3><p>With A selected, hold <kbd>write</kbd> + <kbd>pattern</kbd> and tap B’s slot number. This copies A over B. Select B, then edit the steps to match column B. Turn write off.</p></li>
        <li><h3>Loop it under your riff</h3><p>Hold <kbd>pattern</kbd> and tap A’s slot three times, then B’s once. Release and press <kbd>play</kbd>. For a dirtier turnaround, try <kbd>FX</kbd> + <kbd>2</kbd> for a burst of distortion on the last snare.</p></li>
      </ol>
    </section>
  );
}
