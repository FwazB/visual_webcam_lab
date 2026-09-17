"""Monophonic guitar pitch and an artistic circle-of-fifths color palette.

Uses only the standard library and TouchDesigner's bundled NumPy. Feed fresh
mono blocks to PitchColorTracker.update on every audio frame; it retains at
most 4096 samples and runs the FFT detector at most 30 times per second.
Keep the tracker in a callback module global, never serialized OP storage.

The palette travels E -> A -> D -> G -> C -> F -> Bb -> Eb -> Ab -> Db -> Gb
-> B. E is yellow (60 degrees), A is green (120 degrees), and the remaining
eleven steps divide the other 300 degrees equally. This is an artistic mapping,
not a claim about a physical correspondence between sound and light.
"""

import colorsys
import math
import time

import numpy as np


WINDOW_SAMPLES = 4096
MIN_HZ = 65.0
MAX_HZ = 1200.0
MIN_RMS = 0.004
MIN_CONFIDENCE = 0.88
FIFTHS_ORDER = (4, 9, 2, 7, 0, 5, 10, 3, 8, 1, 6, 11)
NOTE_NAMES = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")


def pitch_class_rgb(pitch_class):
    """Return normalized RGB for a MIDI pitch class (C=0); octaves wrap."""
    index = FIFTHS_ORDER.index(int(pitch_class) % 12)
    degrees = 60.0 if index == 0 else 120.0 + (index - 1) * 300.0 / 11.0
    return colorsys.hsv_to_rgb((degrees % 360.0) / 360.0, 1.0, 1.0)


def note_name(midi):
    """Format an integer MIDI note; None has no note name."""
    if midi is None:
        return ""
    midi = int(midi)
    return "{}{}".format(NOTE_NAMES[midi % 12], midi // 12 - 1)


def _mono_block(samples):
    try:
        values = np.asarray(samples)
        if values.ndim != 1 or values.size > 65536 or values.dtype.kind not in "fiu":
            return None
        values = np.asarray(values, dtype=np.float64)
        return values if np.isfinite(values).all() else None
    except (TypeError, ValueError, OverflowError):
        return None


def _sample_rate(value):
    try:
        rate = float(value)
        return rate if math.isfinite(rate) and 8000 <= rate <= 96000 else None
    except (TypeError, ValueError, OverflowError):
        return None


def detect_pitch(samples, sample_rate):
    """Return {hz, midi, pitchClass, confidence}, or None for unvoiced audio.

    McLeod-style normalized square difference uses an FFT autocorrelation and
    cumulative energy sums, avoiding a samples-by-lags quadratic loop. Selecting
    the first sufficiently strong positive lobe rejects octave-down multiples;
    inspecting short lags too prevents an out-of-range high tone aliasing down.
    """
    rate = _sample_rate(sample_rate)
    block = _mono_block(samples)
    if rate is None or block is None:
        return None
    x = block[-WINDOW_SAMPLES:]
    if x.size < math.ceil(3 * rate / MIN_HZ):
        return None
    x = x - np.mean(x)
    energy = x * x
    if float(np.mean(energy)) < MIN_RMS * MIN_RMS:
        return None

    size = x.size
    max_lag = min(size // 2 - 1, math.ceil(rate / MIN_HZ) + 2)
    fft_size = 1 << (2 * size - 1).bit_length()
    spectrum = np.fft.rfft(x, n=fft_size)
    correlation = np.fft.irfft(spectrum * spectrum.conjugate(), n=fft_size)[:max_lag + 1]
    cumulative = np.concatenate(([0.0], np.cumsum(energy)))
    lags = np.arange(max_lag + 1)
    denominator = cumulative[size - lags] + cumulative[size] - cumulative[lags]
    nsdf = np.divide(2.0 * correlation, denominator,
                     out=np.zeros_like(correlation), where=denominator > 1e-15)

    # One maximum per positive lobe, after the initial zero-lag lobe.
    crossings = np.flatnonzero(nsdf <= 0)
    if not crossings.size:
        return None
    positive = nsdf > 0
    positive[:int(crossings[0]) + 1] = False
    edges = np.diff(np.concatenate(([False], positive, [False])).astype(np.int8))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    peaks = []
    for start, end in zip(starts, ends):
        peak = int(start + np.argmax(nsdf[start:end]))
        if peak < 2 or peak >= max_lag:
            continue
        left, center, right = nsdf[peak - 1:peak + 2]
        curve = left - 2.0 * center + right
        offset = float(0.5 * (left - right) / curve) if abs(curve) > 1e-12 else 0.0
        offset = max(-0.5, min(0.5, offset))
        confidence = min(1.0, float(center - 0.25 * (left - right) * offset))
        peaks.append((peak + offset, confidence))
    if not peaks:
        return None
    threshold = max(MIN_CONFIDENCE, 0.93 * max(peak[1] for peak in peaks))
    selected = next((peak for peak in peaks if peak[1] >= threshold), None)
    if selected is None:
        return None
    hz = float(rate / selected[0])
    # Sub-cent numerical tolerance at the two supported frequency endpoints.
    if not MIN_HZ * 0.9999 <= hz <= MAX_HZ * 1.0001:
        return None
    midi = int(math.floor(69.0 + 12.0 * math.log2(hz / 440.0) + 0.5))
    return {"hz": hz, "midi": midi, "pitchClass": midi % 12, "confidence": selected[1]}


class PitchColorState:
    """Require stable notes, then hold/fade their color when pitch is lost."""

    def __init__(self, stable_frames=2, hold_seconds=0.15, fade_seconds=0.45):
        self.stable_frames = max(2, int(stable_frames))
        self.hold_seconds = max(0.0, float(hold_seconds))
        self.fade_seconds = max(0.001, float(fade_seconds))
        self.reset()

    def reset(self):
        self._pitch = None
        self._candidate_midi = None
        self._candidate_count = 0
        self._last_voiced = -math.inf
        self._voiced = False

    def update(self, pitch, now):
        self._voiced = False
        if pitch is None:
            self._candidate_midi = None
            self._candidate_count = 0
        else:
            midi = pitch["midi"]
            if midi == self._candidate_midi:
                self._candidate_count += 1
            else:
                self._candidate_midi, self._candidate_count = midi, 1
            if self._candidate_count >= self.stable_frames:
                self._pitch = dict(pitch)
                self._last_voiced = now
                self._voiced = True
        return self.result(now)

    def result(self, now):
        age = max(0.0, now - self._last_voiced)
        amount = max(0.0, min(1.0, 1.0 - (age - self.hold_seconds) / self.fade_seconds))
        if self._pitch is None or amount <= 0:
            return {"hz": None, "midi": None, "pitchClass": None, "confidence": 0.0,
                    "rgb": (0.0, 0.0, 0.0), "amount": 0.0, "active": False}
        active = self._voiced and age <= 0.1
        result = dict(self._pitch)
        result.update(rgb=tuple(value * amount for value in pitch_class_rgb(result["pitchClass"])),
                      amount=amount, active=active)
        if not active:
            result["confidence"] = 0.0
        return result


class PitchColorTracker:
    """Append fresh mono blocks, with bounded history and analysis frequency.

    `now` is monotonic seconds (time.monotonic by default). Sample-rate changes,
    malformed/nonfinite input, backwards time, or a >250ms update gap reset the
    audio history so discontinuous buffers cannot become false stable notes.
    Empty blocks advance release/fade without reanalyzing stale audio.
    """

    def __init__(self, analysis_hz=30.0, stable_frames=2, hold_seconds=0.15, fade_seconds=0.45):
        if not math.isfinite(analysis_hz) or not 1.0 <= analysis_hz <= 30.0:
            raise ValueError("analysis_hz must be between 1 and 30")
        self.analysis_hz = float(analysis_hz)
        self.state = PitchColorState(stable_frames, hold_seconds, fade_seconds)
        self._buffer = np.zeros(WINDOW_SAMPLES, dtype=np.float64)
        self.reset()

    def reset(self):
        self._buffer.fill(0.0)
        self._count = self._new_samples = 0
        self._rate = None
        self._last_update = None
        self._last_analysis = -math.inf
        self.state.reset()

    def update(self, samples, sample_rate, now=None):
        now = time.monotonic() if now is None else float(now)
        rate, block = _sample_rate(sample_rate), _mono_block(samples)
        if not math.isfinite(now) or rate is None or block is None:
            self.reset()
            return self.state.result(0.0)
        if (rate != self._rate or (self._last_update is not None and
                (now < self._last_update or now - self._last_update > 0.25))):
            self.reset()
        self._rate, self._last_update = rate, now
        count = min(block.size, WINDOW_SAMPLES)
        if count:
            if count < WINDOW_SAMPLES:
                self._buffer[:-count] = self._buffer[count:]
            self._buffer[-count:] = block[-count:]
            self._count = min(WINDOW_SAMPLES, self._count + count)
            self._new_samples += count
        interval = 1.0 / self.analysis_hz
        if (self._count == WINDOW_SAMPLES and self._new_samples >= math.ceil(rate * interval)
                and now - self._last_analysis >= interval - 1e-9):
            self._last_analysis, self._new_samples = now, 0
            return self.state.update(detect_pitch(self._buffer, rate), now)
        return self.state.result(now)
