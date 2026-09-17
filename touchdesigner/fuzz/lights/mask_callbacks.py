"""TouchDesigner adapter for a live, local person mask."""

from pathlib import Path
import time

import numpy as np

_worker = None
_source_key = None
_last_frame = None
_last_submit = 0.0
_download_started = None
_ready = False
_status = 'Starting person mask'


def reset():
    global _worker, _source_key, _last_frame, _last_submit, _download_started, _ready, _status
    if _worker is not None:
        _worker.close()
    _worker = _source_key = _last_frame = None
    _last_submit = 0.0
    _download_started = None
    _ready = False
    _status = 'Starting person mask'


def _helper_path():
    directory = globals().get('HELPER_DIRECTORY')
    if directory is None:
        directory = Path(project.folder) / 'lights'
    return Path(directory) / '.build' / 'person-mask'


def _inactive_reason(base):
    fuzz = base.parent()
    if fuzz.par.View.eval() != 'lightmaps':
        return 'Select View: Light Maps'
    camera = fuzz.op('camera_in')
    if camera is None or not bool(camera.par.active.eval()) or camera.errors():
        return 'Camera is off or unavailable'
    if not _helper_path().is_file():
        return 'Run build_mask_helper.sh in the lights folder'
    return None


def maintain_lifecycle(base):
    """Called every frame, even when no consumer requests a MASK cook."""
    global _status
    reason = _inactive_reason(base)
    if reason is not None:
        if _worker is not None:
            reset()
        _status = reason
    return reason


def is_ready(base, _frame=None):
    # A previously rendered mask must not remain valid if MASK stops cooking.
    return float(_ready and _worker is not None and _inactive_reason(base) is None
                 and _worker.latest() is not None)


def status(_frame=None):
    return _status


def onCook(scriptOp):
    global _worker, _source_key, _last_frame, _last_submit, _download_started, _ready, _status
    base = scriptOp.parent()
    source = scriptOp.inputs[0] if scriptOp.inputs else None
    camera = base.parent().op('camera_in')
    now = time.monotonic()
    frame = absTime.frame
    executable = _helper_path()
    inactive = maintain_lifecycle(base)
    source_key = (str(executable), str(camera.par.device.eval()) if camera is not None else '')
    if source_key != _source_key:
        reset()
        _source_key = source_key
    mask_image = np.zeros((144, 256, 4), dtype=np.float32)
    mask_image[:, :, 3] = 1
    _ready = False
    if inactive is not None:
        _status = inactive
    elif source is None:
        reset()
        _status = 'Camera is off or unavailable'
    else:
        if _worker is None:
            _worker = base.op('mask_worker').module.MaskWorker(executable)
        if now - _last_submit >= 1 / 15 and frame != _last_frame:
            pixels = source.numpyArray(delayed=True)
            captured_at = _download_started
            _download_started = now
            _last_frame = frame
            _last_submit = now
            if pixels is not None and pixels.shape == (144, 256, 4) and captured_at is not None:
                # TOP arrays have their origin at the bottom left; Vision uses top left.
                bgra = (np.clip(np.flipud(pixels)[:, :, [2, 1, 0, 3]], 0, 1) * 255).astype(np.uint8)
                _worker.submit(bgra.tobytes(), 256, 144, captured_at)
        result = _worker.latest()
        if result is not None:
            raw, width, height, _ = result
            mask = np.flipud(np.frombuffer(raw, dtype=np.uint8).reshape(height, width)).astype(np.float32) / 255
            mask_image[:, :, :3] = mask[:, :, None]
            _ready = bool(np.count_nonzero(mask > 0.5) > width * height * 0.005)
            _status = 'Person mask ready' if _ready else 'Step into the camera view'
        else:
            _status = _worker.error or 'Waiting for a fresh person mask'
    scriptOp.copyNumpyArray(mask_image)
