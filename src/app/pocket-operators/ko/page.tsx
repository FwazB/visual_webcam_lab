import Lesson from "../Lesson";
import { sessions } from "../sessions";
import styles from "../guide.module.css";

export const metadata = { title: sessions.ko.title, description: sessions.ko.description };

export default function KoPage() {
  return (
    <Lesson
      id="ko"
      challenge="With write off, play your sample at two pitches. Then make it land once per loop on beat four. Count three quiet beats before the word comes back. Keep that pattern for the combined session."
      manual={{ name: "Teenage Engineering PO-33 manual", href: "https://teenage.engineering/guides/po-33/en" }}
      reference={
        <div className={styles.referenceCard}>
          <h3>What the numbered keys play</h3>
          <p>Turn write off. Hold <kbd>sound</kbd> and choose a slot, then release both and tap a number.</p>
          <dl>
            <dt>Slots 1–8 · Melodic</dt><dd>Each key plays the whole recording at a different pitch. Try saying “hey” once and playing it back as a tune.</dd>
            <dt>Slots 9–16 · Drum</dt><dd>Each key plays a slice of the recording. Choose an existing drum kit and tap a few keys to hear its different hits.</dd>
          </dl>
        </div>
      }
    >
      <li>
        <h3>Listen before choosing a slot</h3>
        <p>Start with <kbd>bpm</kbd> + <kbd>3</kbd> for a low volume. With write off, choose a melodic slot and tap a key to hear it. Recording into that slot replaces the sample everywhere it is used. If you want to keep every sample, pick an existing one and go straight to step 3.</p>
      </li>
      <li>
        <h3>Record one syllable</h3>
        <p>Unplug the line input to use the built-in microphone. Hold <kbd>record</kbd> and the chosen slot key together, say “hey,” then release. Select the slot again with <kbd>sound</kbd> and tap a few keys to hear your voice change pitch.</p>
      </li>
      <li>
        <h3>Find the start of the word</h3>
        <p>On your own recording, tap <kbd>FX</kbd> until the screen shows TRIM. Use knob <kbd>A</kbd> to take out the silence before the “h.” Use <kbd>B</kbd> to shorten the tail. Tap the same key after each adjustment. If you chose a sound you want to keep, just audition it.</p>
      </li>
      <li>
        <h3>Place the accent on beat four</h3>
        <p>Hold <kbd>pattern</kbd> and tap a number. Listen with <kbd>play</kbd>, stop, and choose a pattern you can edit. Select your sample and tap a pitch you like with write off. Turn <kbd>write</kbd> on and set step <strong>13</strong> for that sound. Leave its other steps unlit. Turn write off and press <kbd>play</kbd>.</p>
      </li>
    </Lesson>
  );
}
