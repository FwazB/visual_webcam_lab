import Lesson from "../Lesson";
import { sessions } from "../sessions";
import styles from "../guide.module.css";

export const metadata = { title: sessions.factory.title, description: sessions.factory.description };

export default function FactoryPage() {
  return (
    <Lesson
      id="factory"
      challenge="Look away and hum your phrase over four beats. Make the middle note higher, shorten the last note, then play it back. You should hear both changes and still have room to say “four” in the gap. Keep the phrase you like."
      manual={{ name: "Teenage Engineering PO-16 manual", href: "https://teenage.engineering/guides/po-16/en" }}
      reference={
        <div className={styles.referenceCard}>
          <h3>Your phrase, beat by beat</h3>
          <dl>
            <dt>Beat 1 · Step 1</dt><dd>Start on a note you can hum.</dd>
            <dt>Beat 2 · Step 7</dt><dd>Go higher, halfway through the beat.</dd>
            <dt>Beat 3 · Step 9</dt><dd>Return to the first pitch. Keep it short.</dd>
            <dt>Beat 4 · Steps 13–16</dt><dd>Rest. The gap leaves space for the K.O. later.</dd>
          </dl>
        </div>
      }
    >
      <li>
        <h3>Find a lead sound</h3>
        <p>Set a low volume with <kbd>bpm</kbd> + <kbd>3</kbd>. With write off, hold <kbd>sound</kbd> and tap <kbd>1</kbd>. Release both and play a few numbered keys. Try another sound from 1–15 if you like. Sound 16 is the micro drum kit.</p>
      </li>
      <li>
        <h3>Put three notes in a bar</h3>
        <p>Hold <kbd>pattern</kbd> and choose a number. Press <kbd>play</kbd> to listen, then stop. Pick an empty pattern or one you can change. Hold <kbd>bpm</kbd> and turn <kbd>B</kbd> to 100 BPM. Turn <kbd>write</kbd> on so REC lights up. For the lead, leave steps <strong>1, 7 and 9</strong> lit.</p>
      </li>
      <li>
        <h3>Give the middle note a lift</h3>
        <p>In write mode, hold lit step <kbd>1</kbd> and turn <kbd>A</kbd> to pick a pitch. Set step <kbd>9</kbd> to the same pitch. Hold <kbd>7</kbd> and use <kbd>A</kbd> to choose a higher note. Press <kbd>play</kbd> and hum along as the melody rises and returns.</p>
      </li>
      <li>
        <h3>Hear what a rest adds</h3>
        <p>While write is on, hold step <kbd>9</kbd> and turn <kbd>B</kbd> to shorten that note. Leave steps 13–16 empty. Turn write off and listen for the silence in the lead on beat four. Try a longer last note, then bring back the gap.</p>
      </li>
    </Lesson>
  );
}
