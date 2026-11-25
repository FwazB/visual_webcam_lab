import Link from "next/link";
import Lesson from "../Lesson";
import { sessionHref, sessions } from "../sessions";
import styles from "../guide.module.css";

export const metadata = { title: sessions.combined.title, description: sessions.combined.description };

export default function CombinedPage() {
  return (
    <Lesson
      id="combined"
      challenge="Start the three patterns together without looking at the routing guide. Count four loops, listen for the word in the melody’s gap, then change the tempo on Rhythm. All three parts should follow. Stop and restart them on the same downbeat."
      manual={{ name: "Teenage Engineering sync mode reference", href: "https://teenage.engineering/guides/po-faq/en" }}
      reference={
        <div className={styles.referenceCard}>
          <h3 id="sync-modes">Sync modes in cable order</h3>
          <p>Hold the first key on each unit and tap <kbd>bpm</kbd> until its screen shows the mode below.</p>
          <dl>
            <dt>Rhythm · SY1</dt><dd><kbd>funct</kbd> + <kbd>bpm</kbd>. Sends drums and a clock pulse to Factory.</dd>
            <dt>Factory · SY5</dt><dd><kbd>key</kbd> + <kbd>bpm</kbd>. Adds the melody and passes the pulse on to K.O.</dd>
            <dt>K.O! · SY4</dt><dd><kbd>record</kbd> + <kbd>bpm</kbd>. Adds the sample and sends the mix to the final output.</dd>
          </dl>
          <p>For solo practice again, return each unit to <strong>SY0</strong>.</p>
        </div>
      }
    >
      <li>
        <h3>Recall one part on each machine</h3>
        <p>Choose your <Link href={sessionHref("rhythm")}>Rhythm beat</Link>, <Link href={sessionHref("factory")}>Factory melody</Link> and <Link href={sessionHref("ko")}>K.O. accent</Link>. Listen to each on its own, then stop playback and turn write off. The snare and the sampled word should meet on beat four.</p>
      </li>
      <li>
        <h3>Connect the audio chain</h3>
        <p>With the volume low, run a stereo 3.5 mm cable from <strong>Rhythm OUT to Factory IN</strong>. Run a second from <strong>Factory OUT to K.O. IN</strong>. Listen at the K.O. output. With both cables connected, set the <a href="#sync-modes">three sync modes</a>.</p>
      </li>
      <li>
        <h3>Start on the same beat</h3>
        <p>Set Rhythm to 100 BPM by holding <kbd>bpm</kbd> and turning <kbd>B</kbd>. Press <kbd>play</kbd> on K.O. and Factory so they wait for the clock. Press <kbd>play</kbd> on Rhythm last. Count “one, two, three, four” and listen for the kick on one and the sample on four.</p>
      </li>
      <li>
        <h3>Play a take</h3>
        <p>Let the groove run for four bars. For a second take, change the tempo on Rhythm and listen for the other two parts to follow. If you hear a regular sync click in the mix, check the K.O. output and its SY4 setting. If a unit is waiting, check the cable feeding its IN jack and the mode on the unit before it.</p>
        <p>To record, send the final K.O. output to a line input and select it in <Link href="/studio">Studio</Link>. This records one mixed take. To edit each part on its own track, record separate passes. <Link href="/pocket-operators#connections">Recording inputs and cables</Link></p>
      </li>
    </Lesson>
  );
}
