import PocketPattern from "@/components/PocketPattern";
import Lesson from "../Lesson";
import GuitarBacking from "./GuitarBacking";
import { sessions } from "../sessions";
import styles from "../guide.module.css";

export const metadata = { title: sessions.rhythm.title, description: sessions.rhythm.description };

export default function RhythmPage() {
  return (
    <Lesson
      id="rhythm"
      followUp={{ id: "guitar-backing", title: "Play Rust Teeth · guitar backing loop", content: <GuitarBacking /> }}
      challenge="Look away from the map. Tap the kick on beats one and three and the snare on two and four. On the machine, add a kick just before beat three, listen for the difference, then restore the original beat. Keep this pattern for the combined session."
      manual={{ name: "Teenage Engineering PO-12 manual", href: "https://teenage.engineering/guides/po-12/en" }}
      reference={
        <>
          <PocketPattern />
          <details className={styles.help}>
            <summary>No empty pattern?</summary>
            <p>If you are happy to erase the selected pattern, press <kbd>funct</kbd> + <kbd>pattern</kbd>. This deletes that pattern. Otherwise keep it and follow the map without editing.</p>
          </details>
          <details className={styles.help}>
            <summary>Why does pressing a number do something different?</summary>
            <p>Holding sound chooses a sound. Write on edits its steps. Write off plays sounds. Check the REC indicator before editing.</p>
          </details>
          <details className={styles.help}>
            <summary>My beat sounds different</summary>
            <p>The map only covers kick, snare, and hi-hat. An existing pattern can also contain other sounds, effects, or parameter changes. Use a different expendable pattern if you want a simpler starting point.</p>
          </details>
        </>
      }
    >
      <li>
        <h3>Find somewhere to experiment</h3>
        <p>Leave audio cables unplugged. Hold <kbd>bpm</kbd> + <kbd>3</kbd> for a low starting volume. Hold <kbd>pattern</kbd> and choose a number. Press <kbd>play</kbd> to listen, then stop. Choose a practice pattern you can change.</p>
        <p className={styles.note}>Listen before editing. See “No empty pattern?” if all sixteen contain music.</p>
      </li>
      <li>
        <h3>Set a comfortable pace</h3>
        <p>Hold <kbd>bpm</kbd> and turn knob <kbd>B</kbd> to 100 BPM. Count four beats to a bar. Each beat takes one row of four steps on the keypad.</p>
      </li>
      <li>
        <h3>Put the kick on two steps</h3>
        <p>Hold <kbd>sound</kbd> and press <kbd>1</kbd>, then release both. Turn <kbd>write</kbd> on so the REC indicator appears. Each numbered key now switches a step on or off. For the kick, leave only steps <strong>1 and 9</strong> lit.</p>
      </li>
      <li>
        <h3>Add the backbeat and ticks</h3>
        <p>Select the snare with <kbd>sound</kbd> + <kbd>2</kbd> and light steps <strong>5 and 13</strong>. For the closed hi-hat, choose <kbd>sound</kbd> + <kbd>3</kbd> and light every odd step.</p>
      </li>
      <li>
        <h3>Listen, then change one thing</h3>
        <p>Turn write off and press <kbd>play</kbd>. Count “one, two, three, four.” Stop, select sound 1 again, and add an extra kick in write mode. Listen, then switch that step off to return to your first beat.</p>
      </li>
    </Lesson>
  );
}
