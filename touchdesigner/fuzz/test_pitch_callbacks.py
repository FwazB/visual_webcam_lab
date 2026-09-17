"""Exercise the TD adapter with fresh/stale audio and the real pitch tracker."""

from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

import pitch_callbacks as callbacks
import pitch_color


class NoPersistentStorage:
    def store(self, *args, **kwargs):
        raise AssertionError("Audio and pitch state must not enter serialized OP storage")

    storeStartupValue = store


class Parameter:
    def __init__(self, value):
        self.value = value

    def eval(self):
        return self.value


class Source(NoPersistentStorage):
    def __init__(self):
        self.path = "/project1/fuzz/audio_in"
        self.rate = 48000
        self.par = SimpleNamespace(device=Parameter("test-input"), active=Parameter(True))
        self.cookAbsFrame = -1
        self.samples = np.zeros((1, 800))
        self.reads = 0

    def numpyArray(self):
        self.reads += 1
        return self.samples

    def set_audio(self, frame, channels=((110, 0.3),)):
        self.cookAbsFrame = frame
        size = self.rate // 60
        times = (np.arange(size) + frame * size) / self.rate
        self.samples = np.array([amplitude * np.sin(2 * np.pi * hz * times)
                                 for hz, amplitude in channels])


class Parent(NoPersistentStorage):
    def op(self, name):
        if name != "pitch_color":
            raise AssertionError("Unexpected operator lookup: " + name)
        return SimpleNamespace(module=pitch_color)


class Script(NoPersistentStorage):
    def __init__(self, source):
        self.inputs = [source]
        self.channels = {}
        self._parent = Parent()

    def parent(self):
        return self._parent

    def clear(self):
        self.channels.clear()

    def appendChan(self, name):
        self.channels[name] = [0.0]
        return self.channels[name]

    def __getitem__(self, name):
        return self.channels[name][0]


class AdapterTests(unittest.TestCase):
    def setUp(self):
        callbacks.reset()
        self.source = Source()
        self.script = Script(self.source)
        self.clock = SimpleNamespace(frame=0)
        self.addCleanup(patch.stopall)
        self.addCleanup(callbacks.reset)
        patch.object(callbacks, "absTime", self.clock, create=True).start()
        self.monotonic = patch.object(callbacks.time, "monotonic", return_value=0.0).start()

    def cook(self, frame, fresh=True, channels=((110, 0.3),), now=None):
        if fresh:
            self.source.set_audio(frame, channels)
        self.clock.frame = frame
        self.monotonic.return_value = frame / 60 if now is None else now
        callbacks.onCook(self.script)

    def establish(self, channels=((110, 0.3),)):
        for frame in range(24):
            self.cook(frame, channels=channels)
        self.assertEqual(self.script["active"], 1.0)
        return callbacks._tracker

    def test_actual_tracker_outputs_note_color_and_label_without_op_storage(self):
        self.establish()
        self.assertEqual(self.script["midi"], 45)
        self.assertEqual(self.script["pitch_class"], 9)
        self.assertEqual((self.script["r"], self.script["g"], self.script["b"]), (0, 1, 0))
        self.assertTrue(callbacks.label(self.script).startswith("A2  |  110."))
        self.assertEqual(set(self.script.channels),
                         {"hz", "midi", "pitch_class", "confidence", "active", "amount", "r", "g", "b"})

    def test_repeated_render_and_source_cooks_do_not_append_twice(self):
        self.cook(0)
        tracker = callbacks._tracker
        original = tracker._buffer.copy()
        count = tracker._count
        self.cook(0, now=0.001)
        self.assertEqual(self.source.reads, 1)
        self.assertEqual(tracker._count, count)
        np.testing.assert_array_equal(tracker._buffer, original)
        self.cook(1, fresh=False)
        self.assertEqual(tracker._count, count)
        np.testing.assert_array_equal(tracker._buffer, original)
        self.cook(2)
        self.assertEqual(tracker._count, count + 800)

    def test_stale_source_releases_instead_of_replaying_last_audio(self):
        self.establish()
        for frame in range(24, 84):
            self.cook(frame, fresh=False)
        self.assertEqual(self.script["active"], 0)
        self.assertEqual(self.script["amount"], 0)
        self.assertEqual(self.script["midi"], -1)
        self.assertEqual(callbacks.label(self.script), "Listening for a note")

    def test_disabled_source_does_not_read_old_pcm_and_fades(self):
        self.establish()
        reads = self.source.reads
        self.source.par.active.value = False
        for frame in range(24, 84):
            self.cook(frame, fresh=False)
        self.assertEqual(self.source.reads, reads)
        self.assertEqual(self.script["amount"], 0)
        self.assertEqual(self.script["active"], 0)

    def test_fresh_zero_pcm_releases_pitch(self):
        self.establish()
        for frame in range(24, 84):
            self.cook(frame, channels=((110, 0.0),))
        self.assertEqual(self.script["amount"], 0)
        self.assertEqual(self.script["active"], 0)

    def test_strongest_stereo_channel_is_used_without_phase_cancellation(self):
        self.establish(channels=((82.4069, 0.01), (110, 0.3)))
        self.assertEqual(callbacks._channel, 1)
        self.assertEqual(self.script["pitch_class"], 9)
        callbacks.reset()
        self.establish(channels=((82.4069, 0.3), (82.4069, -0.3)))
        self.assertEqual(self.script["pitch_class"], 4)

    def test_channel_switch_discards_previous_note_and_requires_fresh_stability(self):
        old_tracker = self.establish(channels=((82.4069, 0.3), (110, 0.01)))
        self.assertEqual(self.script["pitch_class"], 4)
        self.cook(24, channels=((82.4069, 0.01), (110, 0.3)))
        self.assertIsNot(callbacks._tracker, old_tracker)
        self.assertEqual(callbacks._channel, 1)
        self.assertEqual(callbacks._tracker._count, 800)
        self.assertEqual(self.script["active"], 0)
        for frame in range(25, 48):
            self.cook(frame, channels=((82.4069, 0.01), (110, 0.3)))
        self.assertEqual(self.script["active"], 1)
        self.assertEqual(self.script["pitch_class"], 9)

    def test_device_rate_and_long_render_gap_reset_tracker(self):
        for changed in ("device", "rate", "gap"):
            with self.subTest(changed=changed):
                callbacks.reset()
                self.source = Source()
                self.script = Script(self.source)
                previous = self.establish()
                if changed == "device":
                    self.source.par.device.value = "another-test-input"
                elif changed == "rate":
                    self.source.rate = 44100
                self.cook(24, now=1.0 if changed == "gap" else None)
                self.assertIsNot(callbacks._tracker, previous)
                self.assertEqual(self.script["active"], 0)
                self.assertEqual(self.script["midi"], -1)

    def test_missing_input_outputs_idle_and_can_reconnect(self):
        self.establish()
        self.script.inputs = []
        self.cook(24, fresh=False)
        self.assertEqual(self.script["amount"], 0)
        self.assertEqual(self.script["active"], 0)
        self.script.inputs = [self.source]
        for frame in range(25, 49):
            self.cook(frame)
        self.assertEqual(self.script["active"], 1)


if __name__ == "__main__":
    unittest.main()
