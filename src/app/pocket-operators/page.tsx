import Link from "next/link";
import LessonDirectory from "./LessonDirectory";
import styles from "./guide.module.css";

export default function PocketOperatorsPage() {
  return (
    <main>
      <section className={styles.intro} aria-labelledby="guide-title">
        <h1 id="guide-title">Pocket Operators</h1>
        <p className={styles.lead}>Pick up one instrument and work through its solo session. When you can play each part from memory, bring all three together.</p>
        <LessonDirectory />
        <a href="#connections" className={styles.connectionJump}>Recording inputs and cables</a>
      </section>
      <section id="connections" className={styles.connections} aria-labelledby="connections-title">
        <p className={styles.eyebrow}>When you are ready to record</p>
        <h2 id="connections-title">Connect your recording input.</h2>
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
        <div className={styles.studioLink}><div><h3>Keep your first take.</h3><p>The current studio records, layers, trims, and exports audio. Start with one operator when your input is ready.</p></div><Link href="/studio">Open studio</Link></div>
      </section>
    </main>
  );
}
