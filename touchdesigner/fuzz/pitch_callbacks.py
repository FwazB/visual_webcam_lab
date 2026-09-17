"""Local Script CHOP adapter. Audio history lives only in module memory."""

import time

import numpy as np

_tracker = None
_source_key = None
_last_frame = None
_last_source_frame = None
_channel = None
_last_time = None


def reset():
    global _tracker, _source_key, _last_frame, _last_source_frame, _channel, _last_time
    _tracker = _source_key = _last_frame = _last_source_frame = _channel = _last_time = None


def onCook(scriptOp):
    global _tracker, _source_key, _last_frame, _last_source_frame, _channel, _last_time
    module = scriptOp.parent().op('pitch_color').module
    source = scriptOp.inputs[0] if scriptOp.inputs else None
    now = time.monotonic()
    frame = absTime.frame
    rate = float(source.rate) if source is not None else 44100.0
    device = str(source.par.device.eval()) if source is not None and hasattr(source.par, 'device') else ''
    key = (source.path if source is not None else None, rate, device)
    if _tracker is None or key != _source_key or (_last_time is not None and now - _last_time > 0.5):
        _tracker = module.PitchColorTracker()
        _channel = _last_frame = _last_source_frame = None
        _source_key = key
    block = np.empty(0)
    enabled = source is not None and (not hasattr(source.par, 'active') or bool(source.par.active.eval()))
    if enabled and frame != _last_frame:
        samples = source.numpyArray()
        fresh = source.cookAbsFrame != _last_source_frame
        _last_source_frame = source.cookAbsFrame
        if fresh and samples is not None and samples.ndim == 2 and samples.shape[0] and samples.shape[1]:
            energy = np.mean(np.square(samples.astype(np.float64)), axis=1)
            strongest = int(np.argmax(energy))
            if _channel is None or _channel >= len(energy) or energy[strongest] > max(1e-10, energy[_channel] * 4.0):
                if _channel is not None and _channel != strongest:
                    _tracker = module.PitchColorTracker()
                _channel = strongest
            block = samples[_channel]
    result = _tracker.update(block, rate, now)
    _last_frame, _last_time = frame, now
    scriptOp.clear()
    scriptOp.isTimeSlice = False
    scriptOp.rate = 60
    scriptOp.numSamples = 1
    values = {
        'hz': result['hz'] or 0.0,
        'midi': result['midi'] if result['midi'] is not None else -1,
        'pitch_class': result['pitchClass'] if result['pitchClass'] is not None else -1,
        'confidence': result['confidence'],
        'active': float(result['active']),
        'amount': max(result['rgb']),
        'r': result['rgb'][0], 'g': result['rgb'][1], 'b': result['rgb'][2],
    }
    for name, value in values.items():
        scriptOp.appendChan(name)[0] = value


def label(pitch):
    if float(pitch['amount']) <= 0.01:
        return 'Listening for a note'
    midi = int(float(pitch['midi']))
    name = pitch.parent().op('pitch_color').module.note_name(midi)
    return '{}  |  {:.1f} Hz'.format(name, float(pitch['hz']))
