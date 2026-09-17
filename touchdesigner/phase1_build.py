"""Build the first TouchDesigner bass-aura prototype.

Run from the TouchDesigner Textport with:

    exec(open('/Users/fb/dev/visualarts/body-synth/touchdesigner/phase1_build.py').read())

The script is intentionally non-destructive. It creates or updates operators only
inside /project1/bass_aura and leaves the rest of the project untouched.
"""


ROOT_PATH = "/project1"
BASE_NAME = "bass_aura"


def ensure(parent_op, op_type, name):
    """Return an existing child or create it when it does not exist."""
    existing = parent_op.op(name)
    return existing if existing is not None else parent_op.create(op_type, name)


def connect(source, target, input_index=0):
    """Connect one operator to a specific input connector."""
    target.inputConnectors[input_index].connect(source)


root = op(ROOT_PATH)
base = ensure(root, "baseCOMP", BASE_NAME)

# Visual path: camera -> edges -> soft cyan aura -> add over camera.
camera = ensure(base, "videodeviceinTOP", "camera_in")
mono = ensure(base, "monochromeTOP", "mono")
edges = ensure(base, "edgeTOP", "aura_edges")
blur = ensure(base, "blurTOP", "aura_blur")
level = ensure(base, "levelTOP", "aura_level")
composite = ensure(base, "compositeTOP", "camera_plus_aura")
visual_out = ensure(base, "nullTOP", "OUT")
component_out = ensure(base, "outTOP", "out1")

connect(camera, mono)
connect(mono, edges)
connect(edges, blur)
connect(blur, level)
connect(camera, composite, 0)
connect(level, composite, 1)
connect(composite, visual_out)
connect(visual_out, component_out)

# Audio path: current Mac input -> RMS energy -> sensitivity -> smoothing.
audio = ensure(base, "audiodeviceinCHOP", "audio_in")
rms = ensure(base, "analyzeCHOP", "audio_rms")
gain = ensure(base, "mathCHOP", "audio_gain")
smooth = ensure(base, "filterCHOP", "audio_smooth")
audio_out = ensure(base, "nullCHOP", "AUDIO_LEVEL")

connect(audio, rms)
connect(rms, gain)
connect(gain, smooth)
connect(smooth, audio_out)

# Phase 1 tuning. This is deliberately responsive enough for a microphone test.
if not camera.par.device.eval() and camera.par.device.menuNames:
    camera.par.device = camera.par.device.menuNames[0]

rms.par.function = "rmspower"
gain.par.fromrange1 = 0.0
gain.par.fromrange2 = 0.08
gain.par.torange1 = 0.0
gain.par.torange2 = 1.0
smooth.par.width = 0.12
smooth.par.widthunit = "seconds"

blur.par.size = 18.0
level.par.lowr = 0.0
level.par.lowg = 0.0
level.par.lowb = 0.0
level.par.lowa = 0.0
level.par.highr = 0.05
level.par.highg = 0.85
level.par.highb = 1.0
level.par.higha = 1.0
level.par.brightness1.expr = "1.0 + min(max(op('audio_smooth')[0], 0.0), 1.0) * 4.0"
level.par.opacity.expr = "0.12 + min(max(op('audio_smooth')[0], 0.0), 1.0) * 0.88"
composite.par.operand = "add"

# A readable left-to-right visual row with the audio analysis underneath.
visual_nodes = [camera, mono, edges, blur, level, composite, visual_out, component_out]
for index, node in enumerate(visual_nodes):
    node.nodeX = index * 170
    node.nodeY = 140

audio_nodes = [audio, rms, gain, smooth, audio_out]
for index, node in enumerate(audio_nodes):
    node.nodeX = index * 210
    node.nodeY = -170

visual_out.viewer = True
visual_out.display = True
component_out.viewer = True
audio_out.viewer = True

base.nodeX = 700
base.nodeY = -150
base.viewer = True

print("Phase 1 bass aura ready at /project1/bass_aura")
print("Visual output:", visual_out.path, "errors:", visual_out.errors())
print("Audio output:", audio_out.path, "errors:", audio_out.errors())
