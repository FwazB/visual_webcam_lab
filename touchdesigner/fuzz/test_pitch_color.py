"""Synthetic audio regressions; run with TouchDesigner's bundled Python."""

import math
import unittest
from unittest.mock import patch

import numpy as np

import pitch_color as pitch


def tone(hz, rate=48000, count=4096, amplitude=0.3, offset=0):
    return amplitude * np.sin(2 * np.pi * hz * (np.arange(count) + offset) / rate)


class DetectionTests(unittest.TestCase):
    def assert_frequency(self, samples, rate, expected, cents=6):
        result = pitch.detect_pitch(samples, rate)
        self.assertIsNotNone(result)
        self.assertLess(abs(1200 * math.log2(result["hz"] / expected)), cents)
        self.assertGreaterEqual(result["confidence"], pitch.MIN_CONFIDENCE)
        return result

    def test_guitar_range_and_sample_rates(self):
        for rate in (44100, 48000):
            for hz in (65.0, 82.4069, 110.0, 146.832, 195.998, 246.942, 329.628, 659.255, 1174.659, 1200.0):
                with self.subTest(rate=rate, hz=hz):
                    self.assert_frequency(tone(hz, rate), rate, hz)

    def test_strong_harmonics_do_not_replace_fundamental(self):
        for hz in (82.4069, 110.0, 329.628):
            with self.subTest(hz=hz):
                samples = tone(hz, amplitude=0.16) + tone(hz * 2, amplitude=0.55) + tone(hz * 3, amplitude=0.25)
                self.assert_frequency(samples, 48000, hz)

    def test_missing_fundamental_with_second_and_third_harmonics(self):
        self.assert_frequency(tone(220) + tone(330, amplitude=0.2), 48000, 110)

    def test_plucked_envelope_dc_offset_and_moderate_noise(self):
        rng = np.random.default_rng(310)
        samples = (tone(82.4069) + tone(164.8138, amplitude=0.1)) * np.exp(-np.arange(4096) / 9000)
        samples += 0.25 + rng.normal(0, 0.01, 4096)
        self.assert_frequency(samples, 48000, 82.4069)

    def test_silence_noise_weak_and_invalid_inputs_are_unvoiced(self):
        rng = np.random.default_rng(197)
        for samples in (np.zeros(4096), np.ones(4096) * 0.7, tone(110, amplitude=0.0005),
                        rng.normal(0, 0.3, 4096), tone(110) * 0.1 + rng.normal(0, 0.2, 4096),
                        np.full(4096, np.nan), np.full(4096, np.inf), np.zeros((2, 4096)),
                        np.zeros(65537), ["bad"], [], tone(110, count=128)):
            with self.subTest(shape=np.shape(samples)):
                self.assertIsNone(pitch.detect_pitch(samples, 48000))
        for rate in (0, -48000, math.nan, math.inf, "invalid"):
            self.assertIsNone(pitch.detect_pitch(tone(110), rate))

    def test_out_of_range_tones_do_not_alias_to_supported_subharmonics(self):
        for hz in (40.0, 60.0, 1250.0, 1500.0, 2400.0):
            with self.subTest(hz=hz):
                self.assertIsNone(pitch.detect_pitch(tone(hz), 48000))

    def test_semitone_rounding_boundary(self):
        boundary = 440 * 2 ** ((40.5 - 69) / 12)
        self.assertEqual(self.assert_frequency(tone(boundary * 2 ** (-10 / 1200)), 48000, boundary * 2 ** (-10 / 1200))["midi"], 40)
        self.assertEqual(self.assert_frequency(tone(boundary * 2 ** (10 / 1200)), 48000, boundary * 2 ** (10 / 1200))["midi"], 41)


class PaletteAndStateTests(unittest.TestCase):
    def test_circle_of_fifths_has_twelve_unique_colors_and_anchor_colors(self):
        self.assertEqual(pitch.pitch_class_rgb(4), (1.0, 1.0, 0.0))
        self.assertEqual(pitch.pitch_class_rgb(9), (0.0, 1.0, 0.0))
        self.assertEqual(len(set(pitch.pitch_class_rgb(pc) for pc in pitch.FIFTHS_ORDER)), 12)
        for index, pc in enumerate(pitch.FIFTHS_ORDER):
            self.assertEqual((pc - pitch.FIFTHS_ORDER[(index + 1) % 12]) % 12, 7)
            self.assertEqual(pitch.pitch_class_rgb(pc), pitch.pitch_class_rgb(pc + 12))
        self.assertEqual(pitch.note_name(40), "E2")
        self.assertEqual(pitch.note_name(69), "A4")

    def test_requires_two_frames_then_holds_and_fades(self):
        state = pitch.PitchColorState()
        estimate = pitch.detect_pitch(tone(110), 48000)
        self.assertFalse(state.update(estimate, 0)["active"])
        result = state.update(estimate, 0.04)
        self.assertTrue(result["active"])
        self.assertEqual(result["pitchClass"], 9)
        held = state.update(None, 0.08)
        self.assertFalse(held["active"])
        self.assertEqual(held["rgb"], (0, 1, 0))
        fading = state.result(0.34)
        self.assertAlmostEqual(fading["amount"], 2 / 3)
        self.assertAlmostEqual(max(fading["rgb"]), fading["amount"])
        expired = state.result(0.7)
        self.assertIsNone(expired["midi"])
        self.assertEqual(expired["rgb"], (0, 0, 0))

    def test_isolated_pitch_glitch_does_not_change_color(self):
        state = pitch.PitchColorState(stable_frames=3)
        e = pitch.detect_pitch(tone(82.4069), 48000)
        a = pitch.detect_pitch(tone(110), 48000)
        for now in (0, 0.04, 0.08):
            result = state.update(e, now)
        self.assertTrue(result["active"])
        self.assertEqual(state.update(a, 0.12)["pitchClass"], 4)
        state.update(e, 0.16)
        state.update(e, 0.20)
        self.assertTrue(state.update(e, 0.24)["active"])


class TrackerTests(unittest.TestCase):
    def feed(self, tracker, hz=110, rate=48000, frames=24, start=0.0):
        size = rate // 60
        result = None
        for frame in range(frames):
            result = tracker.update(tone(hz, rate, size, offset=frame * size), rate, start + frame / 60)
        return result

    def test_chunked_audio_is_stable_and_memory_is_bounded(self):
        for rate in (44100, 48000):
            tracker = pitch.PitchColorTracker()
            result = self.feed(tracker, 82.4069, rate, 90)
            self.assertTrue(result["active"])
            self.assertEqual(result["midi"], 40)
            self.assertEqual(tracker._buffer.size, pitch.WINDOW_SAMPLES)

    def test_analysis_never_exceeds_thirty_hz(self):
        tracker = pitch.PitchColorTracker()
        with patch.object(pitch, "detect_pitch", wraps=pitch.detect_pitch) as detector:
            self.feed(tracker, frames=120)
        self.assertLessEqual(detector.call_count, 60)
        self.assertGreater(detector.call_count, 45)

    def test_silence_releases_and_empty_blocks_cannot_sustain_old_audio(self):
        for silent_block in (np.zeros(800), []):
            tracker = pitch.PitchColorTracker()
            self.assertTrue(self.feed(tracker)["active"])
            for frame in range(24, 84):
                result = tracker.update(silent_block, 48000, frame / 60)
            self.assertFalse(result["active"])
            self.assertIsNone(result["midi"])
            self.assertEqual(result["amount"], 0)

    def test_rate_change_invalid_input_and_discontinuity_clear_history(self):
        for samples, rate, now in ((tone(110, count=735), 44100, 0.4),
                                   ([math.nan], 48000, 0.4),
                                   (np.zeros((2, 800)), 48000, 0.4),
                                   (tone(110, count=800), 48000, 1.0),
                                   (tone(110, count=800), 48000, 0.0)):
            tracker = pitch.PitchColorTracker()
            self.assertTrue(self.feed(tracker)["active"])
            result = tracker.update(samples, rate, now)
            self.assertFalse(result["active"])
            self.assertIsNone(result["midi"])
            self.assertLess(tracker._count, pitch.WINDOW_SAMPLES)


if __name__ == "__main__":
    unittest.main()
