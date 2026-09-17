# Spark PEDAL and the trainer

This integration targets Positive Grid **Spark PEDAL**, the portable amp and
effects pedal with USB-C audio. Positive Grid documents its instrument input,
headphone/line outputs, USB interface, onboard tone controls, and looper on the
[official product page](https://www.positivegrid.com/pages/spark-pedal).

## Signal path

```text
guitar -> Spark PEDAL -> USB-C audio -> browser input -> pitch/onset detector
                    -> headphones / line outputs       -> lesson/song scoring
                                                       -> paired fuzz visuals
```

The pedal makes your guitar tone. The web app requests its audio input and
analyzes it locally; it does not change presets, turn effects on or off, control
the pedal looper, or listen for footswitch/MIDI commands. Its Tone.js click and
backing are separate browser-generated audio, sent to the computer's selected
output. Choosing a Spark input does not also select a Spark output.

## Setup for scoring

1. Connect the guitar to the pedal's instrument input and power it on. Connect
   the pedal to the Mac using a USB-C data cable. Bluetooth pairing is not the
   trainer's guitar-input path.
2. Start with a clean, low-gain sound. Turn off delay, reverb, modulation, and
   loop playback so repeated or layered notes do not confuse pitch/onset
   detection. Keep the level below clipping.
3. Open `/guitar?debug=1`, click **Connect guitar**, and allow microphone access
   for the site. The browser calls every audio capture device a microphone.
   Confirm the displayed device name. The app tries your saved input first,
   then an input whose label contains `Spark`; it offers a selector otherwise.
4. Listen through the pedal's headphone or line outputs. The analysis path
   deliberately does not monitor the guitar through browser speakers.
5. On macOS use Standard microphone mode, if that control is available. The app
   requests echo cancellation, noise suppression, and automatic gain control
   off. Actual device settings and the AudioContext rate appear in debug.

The app negotiates the device rate; no fixed sample rate or dry USB channel
layout is assumed. Positive Grid's product page confirms USB audio but does
not specify a dry-channel/loopback map. Verify which pedal effects, looper
playback, and computer backing are included in the USB capture on the actual
unit before relying on isolated live-guitar scoring.

## Playing YUKON

Use Song mode for the chart, count-in, click, optional backing, and chord-tone
coverage. **Pick the displayed chord tones separately.** The current detector
estimates one fundamental at a time, so a full strum is not a reliable test of
every note in a chord. Notes detected from loop playback cannot be distinguished
from notes you just played. Keep the hardware looper stopped for the scoring test.

The pedal's own footswitches control presets and its 60-second looper. Those
controls remain on the pedal/Spark app. They do not start the trainer's transport
or follow its adjustable tempo. The same applies to the pedal's MIDI and
expression-pedal connections: this release does not implement them.

## First hardware check

- Confirm the exact input label, negotiated channel count, and sample rate.
- Play each open string alone, then fret notes: check one note per pluck and
  watch for octave errors. Use a clean tone before adjusting detection thresholds.
- Stop playing, then enable browser backing: the note log should stay quiet.
  If it records the backing, disable backing for scoring and inspect output/input
  routing. Check the hardware looper separately in the same way.
- Switch effects on one at a time to find a tone that still tracks reliably.
- Test unplug/reconnect and confirm the displayed input rather than assuming
  the browser has followed a system device change.

Synthetic tests and successful web deployment do not verify USB routing or
real guitar accuracy. A connected Spark PEDAL is required for those checks.
