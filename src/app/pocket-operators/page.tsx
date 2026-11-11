import type { Metadata, Viewport } from "next";
import Link from "next/link";
import PocketPattern from "@/components/PocketPattern";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: "Pocket Operator guide | body.synth",
  description: "Make your first beat on PO-12 Rhythm, try sampling on PO-33 K.O., and understand the path into the BodySynth studio.",
};

export const viewport: Viewport = { maximumScale: 5, userScalable: true };

export default function PocketOperatorsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.navigation}>
          <Link href="/" className={styles.brand}>body.synth</Link>
          <nav aria-label="Main navigation">
            <Link href="/guitar">Guitar</Link>
            <Link href="/bass">Bass</Link>
            <Link href="/studio">Studio</Link>
            <Link href="/for-you">For you</Link>
            <Link href="/pocket-operators" aria-current="page">Pocket Operators</Link>
          </nav>
        </header>

        <section className={styles.intro} aria-labelledby="guide-title">
          <p className={styles.eyebrow}>Pocket Operator field guide</p>
          <h1 id="guide-title">A small machine.<br />Your first beat.</h1>
          <p className={styles.lead}>Start with Rhythm. Learn what the sixteen steps do, then take the same idea to the K.O. All you need for the first lesson is the instrument.</p>
          <div className={styles.deviceList} aria-label="Choose an instrument">
            <a href="#rhythm"><strong>PO-12 Rhythm</strong><span>Start here · drum patterns</span></a>
            <a href="#ko"><strong>PO-33 K.O!</strong><span>Next · record your own sounds</span></a>
            <a href="#factory"><strong>PO-16 Factory</strong><span>Then · add a melody</span></a>
          </div>
          <a href="#connections" className={styles.connectionJump}>Connect your existing gear</a>
        </section>

        <section id="rhythm" className={styles.lesson} aria-labelledby="rhythm-title">
          <div className={styles.lessonCopy}>
            <p className={styles.eyebrow}>First session · PO-12 Rhythm</p>
            <h2 id="rhythm-title">Make a beat you understand.</h2>
            <p>A sound is what you hear. A step is when you hear it. A pattern brings the steps together and repeats them.</p>
            <p>For this exercise, sixteen steps make one bar of four beats. Each row in the pad map is one beat. The same numbered keys select sounds or steps depending on the mode.</p>
            <ol className={styles.instructions}>
              <li>
                <h3>Find somewhere to experiment</h3>
                <p>Leave audio cables unplugged. Hold <kbd>bpm</kbd> + <kbd>3</kbd> for a low starting volume. Hold <kbd>pattern</kbd> and choose a number. Press <kbd>play</kbd> to listen, then stop. Choose a practice pattern you can change.</p>
                <p className={styles.note}>No pattern number is guaranteed empty. Keep patterns you care about; the “No empty pattern?” note explains how to start fresh.</p>
              </li>
              <li>
                <h3>Set a comfortable pace</h3>
                <p>Hold <kbd>bpm</kbd> and turn knob <kbd>B</kbd> to 100 BPM.</p>
              </li>
              <li>
                <h3>Put the kick on two steps</h3>
                <p>Hold <kbd>sound</kbd> and press <kbd>1</kbd>, then release both. Turn <kbd>write</kbd> on so the REC indicator appears. Enter kick steps <strong>1 and 9</strong>.</p>
              </li>
              <li>
                <h3>Add the backbeat and ticks</h3>
                <p>Use <kbd>sound</kbd> + <kbd>2</kbd> for snare: steps <strong>5, 13</strong>. Use <kbd>sound</kbd> + <kbd>3</kbd> for closed hi-hat: steps <strong>1, 3, 5, 7, 9, 11, 13, 15</strong>.</p>
              </li>
              <li>
                <h3>Listen, then change one thing</h3>
                <p>Turn write off and press <kbd>play</kbd>. Count “one, two, three, four.” Stop, add one extra kick in write mode, then listen again.</p>
              </li>
            </ol>
            <p className={styles.source}>Button reference: <a href="https://teenage.engineering/guides/po-12/en">Teenage Engineering PO-12 guide</a>. The beat here is a BodySynth exercise.</p>
          </div>
          <aside className={styles.reference} aria-label="Rhythm pattern reference">
            <PocketPattern />
            <details className={styles.help}>
              <summary>No empty pattern?</summary>
              <p>If you are happy to erase the selected pattern, press <kbd>funct</kbd> + <kbd>pattern</kbd>. This deletes that pattern. Otherwise keep it and follow the map without editing.</p>
            </details>
            <details className={styles.help}>
              <summary>Why does pressing a number do something different?</summary>
              <p>Holding sound chooses a sound. Write on edits its steps; write off plays sounds. Check the REC indicator before editing.</p>
            </details>
            <details className={styles.help}>
              <summary>My beat sounds different</summary>
              <p>The map only covers kick, snare, and hi-hat. An existing pattern can also contain other sounds, effects, or parameter changes. Use a different expendable pattern if you want a simpler starting point.</p>
            </details>
          </aside>
        </section>

        <section id="ko" className={styles.nextLesson} aria-labelledby="ko-title">
          <div>
            <p className={styles.eyebrow}>Second session · PO-33 K.O!</p>
            <h2 id="ko-title">Turn a sound into an instrument.</h2>
            <p>The K.O. is a sampler: record a sound, then play it back. Start with a short spoken “hey” or a hand clap. No computer connection is needed.</p>
            <p>Slots <strong>1–8</strong> play a sample melodically. Slots <strong>9–16</strong> divide a recording into slices. Start with a melodic slot.</p>
          </div>
          <ol className={styles.koSteps}>
            <li><h3>Choose a slot you can replace</h3><p>Check the existing sound first. Recording into a slot replaces its sample; choose one whose contents you do not need.</p></li>
            <li><h3>Record something short</h3><p>With the line input unplugged, hold <kbd>record</kbd> and your chosen key <kbd>1–8</kbd>. Make your sound, then release the buttons. The built-in microphone supplies the recording.</p></li>
            <li><h3>Play it at different pitches</h3><p>Hold <kbd>sound</kbd> and select that slot. With write off, try the numbered keys. Listen to how the same recording changes as you move between notes.</p></li>
            <li><h3>Try a sample from the computer later</h3><p>A computer or audio interface output can feed the K.O. line input. Inserting that cable replaces the microphone as the recording source. Start with a quiet output level and a short sound.</p></li>
          </ol>
          <p className={styles.source}>Button reference: <a href="https://teenage.engineering/guides/po-33/en">Teenage Engineering PO-33 guide</a>.</p>
        </section>

        <section id="factory" className={styles.factory} aria-labelledby="factory-title">
          <div><p className={styles.eyebrow}>Third session · PO-16 Factory</p><h2 id="factory-title">Leave room for a melody.</h2></div>
          <p>Factory is the melody synthesizer of these three. Once the Rhythm pattern feels familiar, try a short phrase on Factory and leave some steps empty. Rhythm and Factory make sounds internally; the K.O. records samples. <a href="https://teenage.engineering/guides/po-16/en">Open the Factory manual</a>.</p>
        </section>

        <section id="connections" className={styles.connections} aria-labelledby="connections-title">
          <p className={styles.eyebrow}>When you are ready to record</p>
          <h2 id="connections-title">Use what you have. Check the signal.</h2>
          <p>These Pocket Operators use 3.5 mm audio and click-sync connections, not MIDI or USB audio. An adapter that fits is not necessarily a recording input.</p>
          <div className={styles.routes}>
            <div><h3>Into BodySynth</h3><p className={styles.signal}>PO audio out <span>→</span> line recording input <span>→</span> USB <span>→</span> Studio</p><p>Choose the recording device in Studio and check its meter before recording. A headphone-only USB dongle cannot capture audio.</p></div>
            <div><h3>Into the K.O.</h3><p className={styles.signal}>Computer audio out <span>→</span> K.O. line in</p><p>This lets the K.O. sample sound. It does not send notes or change its patterns. Rhythm and Factory cannot load samples this way.</p></div>
          </div>
          <details className={styles.gear}>
            <summary>Using Spark 2, Spark PEDAL, or Spark MINI</summary>
            <p>To hear a Pocket Operator through Spark 2, connect its audio output to the amp’s AUX input with a stereo 3.5 mm cable and start quietly. Do not assume that sound heard through AUX is also sent to USB recording.</p>
            <ul>
              <li><strong>Spark 2:</strong> AUX playback can coexist with USB. This does not establish AUX-to-USB capture. <a href="https://help.positivegrid.com/hc/en-us/articles/28318627451149-Digital-Audio-Input-Priority-Aux-In-Bluetooth-Audio-USB-Audio">Input-priority guide</a>.</li>
              <li><strong>Spark MINI:</strong> connecting AUX disables USB and Bluetooth playback. Check the monitoring route before using it with a computer. <a href="https://help.positivegrid.com/hc/en-us/articles/49124594366861-Panel-Overview">Panel guide</a>.</li>
              <li><strong>Spark PEDAL:</strong> use its USB input in BodySynth for guitar. It has no AUX input; its 3.5 mm MIDI sockets are not Pocket Operator audio inputs. <a href="https://help.positivegrid.com/hc/en-us/articles/45070676594189-Panel-Overview">Panel guide</a>.</li>
            </ul>
            <p>Before buying anything, identify any existing USB audio adapter and whether it has a true line input. If none does, that is the missing piece for clean Pocket Operator capture. A typical interface may need a stereo 3.5 mm to two mono input cable, not just a jack-size adapter. <a href="https://support.focusrite.com/hc/en-gb/articles/25393391843730-What-are-TS-TRS-and-TRRS-connectors">Connector guide</a>.</p>
          </details>
          <details className={styles.gear}>
            <summary>Can the three operators play together?</summary>
            <p>Yes. Their audio cables can also carry a tempo pulse. A chain can combine Rhythm, Factory, and K.O. into one output, but recording that output gives you one mixed performance. Separate editable tracks need separate recording passes or independent inputs.</p>
            <p>Learn each instrument first, then follow the <a href="https://teenage.engineering/guides/po-faq/en">official sync instructions</a>. BodySynth does not yet generate a Pocket Operator sync signal; its metronome is for listening.</p>
          </details>
          <div className={styles.studioLink}><div><h3>Next: keep your first take.</h3><p>The current studio records, layers, trims, and exports audio. Start with one operator when your input is ready.</p></div><Link href="/studio">Open studio</Link></div>
        </section>
        <footer className={styles.footer}><Link href="/">Back to body.synth</Link><p>Independent learning guide. Use the linked manufacturer manuals for your exact model.</p></footer>
      </div>
    </main>
  );
}
