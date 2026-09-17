"""Build the "fuzz" TouchDesigner network: camera video distorted by playing.

Run from the TouchDesigner Textport with:

    exec(open('/Users/fb/dev/visualarts/body-synth/touchdesigner/fuzz/fuzz_build.py').read())

Save working projects privately outside the repository: .toe files include
the generated pairing code. The bridge requires TouchDesigner 2025.33070+.

Non-destructive: creates or updates operators only inside /project1/fuzz.

Signal flow
-----------
video   camera_in -> feedback loop (composite + hue shift + dim + displace by
        noise) -> OUT -> out1, plus a borderless Window COMP for projection.
audio   audio_in (the Spark over USB, or the Mac input) -> RMS -> smoothing
        -> AUDIO_LEVEL; slope of RMS -> trigger envelope -> ONSET.
chords  authenticated bridge on ws://127.0.0.1:9980/body-synth receives
        song chords, note hits, transport, and three allowlisted controls.
        Standalone audio drives the network even without a web connection.

Mappings: ONSET pushes the displacement, AUDIO_LEVEL keeps the feedback
trail alive, CHORD shifts the hue.
"""

import secrets
from pathlib import Path

ROOT_PATH = "/project1"
BASE_NAME = "fuzz"
BRIDGE_PORT = 9980
# Override FUZZ_DIRECTORY before exec() when using another checkout.
FUZZ_DIRECTORY = Path(globals().get("FUZZ_DIRECTORY", "/Users/fb/dev/visualarts/body-synth/touchdesigner/fuzz"))
FUZZ_BRIDGE_ENABLED = globals().get("FUZZ_BRIDGE_ENABLED", True)


def ensure(parent_op, op_type, name):
    """Return an existing child or create it when it does not exist."""
    existing = parent_op.op(name)
    return existing if existing is not None else parent_op.create(op_type, name)


def connect(source, target, input_index=0):
    """Connect one operator to a specific input connector."""
    target.inputConnectors[input_index].connect(source)


def setpar(node, name, value):
    """Required parameters fail clearly instead of creating a partial network."""
    par = getattr(node.par, name, None)
    if par is None:
        raise RuntimeError("{} has no parameter {}".format(node.path, name))
    par.val = value


def setexpr(node, name, expression):
    par = getattr(node.par, name, None)
    if par is None:
        raise RuntimeError("{} has no parameter {}".format(node.path, name))
    par.expr = expression


root = op(ROOT_PATH)
if root is None:
    raise RuntimeError("Create /project1 before running the fuzz builder.")
callback_source = (FUZZ_DIRECTORY / "bridge_callbacks.py").read_text()
base = ensure(root, "baseCOMP", BASE_NAME)
if not base.fetch("pairingCode", ""):
    base.store("pairingCode", secrets.token_urlsafe(24))

# ---------------------------------------------------------------- video ----
camera = ensure(base, "videodeviceinTOP", "camera_in")
feedback = ensure(base, "feedbackTOP", "feedback")
mix = ensure(base, "compositeTOP", "mix")
hue = ensure(base, "hsvadjustTOP", "hue")
dim = ensure(base, "levelTOP", "dim")
noise = ensure(base, "noiseTOP", "warp_noise")
warp = ensure(base, "displaceTOP", "warp")
tail = ensure(base, "nullTOP", "tail")
blackout = ensure(base, "levelTOP", "output_level")
visual_out = ensure(base, "nullTOP", "OUT")
component_out = ensure(base, "outTOP", "out1")

connect(camera, feedback)          # first frame seeds the loop
connect(feedback, hue)
connect(hue, dim)
connect(dim, warp, 0)
connect(noise, warp, 1)
connect(warp, mix, 0)  # faded trail over the new, opaque camera image
connect(camera, mix, 1)
connect(mix, tail)
connect(tail, blackout)
connect(blackout, visual_out)
connect(visual_out, component_out)

if not camera.par.device.eval() and camera.par.device.menuNames:
    camera.par.device = camera.par.device.menuNames[0]

setpar(feedback, "top", "tail")     # close the loop
setpar(mix, "operand", "over")
setpar(noise, "type", "sparse")
setpar(noise, "period", 1.6)
setpar(noise, "amp", 1.0)
setexpr(noise, "tz", "absTime.seconds * 0.15")

# ---------------------------------------------------------------- audio ----
audio = ensure(base, "audiodeviceinCHOP", "audio_in")
rms = ensure(base, "analyzeCHOP", "audio_rms")
gain = ensure(base, "mathCHOP", "audio_gain")
smooth = ensure(base, "filterCHOP", "audio_smooth")
audio_out = ensure(base, "nullCHOP", "AUDIO_LEVEL")
slope = ensure(base, "slopeCHOP", "audio_slope")
onset = ensure(base, "triggerCHOP", "onset_trigger")
onset_out = ensure(base, "nullCHOP", "ONSET")

connect(audio, rms)
connect(rms, gain)
connect(gain, smooth)
connect(smooth, audio_out)
connect(gain, slope)
connect(slope, onset)
connect(onset, onset_out)

# Prefer the Spark when it is present; otherwise keep the default input.
spark = [name for name in audio.par.device.menuNames if "spark" in name.lower()]
if spark:
    audio.par.device = spark[0]

setpar(rms, "function", "rmspower")
setpar(gain, "fromrange1", 0.0)
setpar(gain, "fromrange2", 0.08)
setpar(gain, "torange1", 0.0)
setpar(gain, "torange2", 1.0)
setpar(smooth, "width", 0.15)
setpar(smooth, "widthunit", "seconds")
setpar(onset, "threshold", True)
setpar(onset, "threshup", 0.6)
setpar(onset, "attack", 0.01)
setpar(onset, "decay", 0.25)
setpar(onset, "sustain", 0.0)
setpar(onset, "release", 0.2)

# --------------------------------------------------------------- chords ----
chord = ensure(base, "constantCHOP", "CHORD")
setpar(chord, "name0", "chord")
setpar(chord, "value0", 0.0)
setpar(chord, "name1", "hit")
setpar(chord, "value1", 0.0)

controls = ensure(base, "constantCHOP", "CONTROLS")
state = base.fetch("fuzzState", {
    "revision": 0, "running": False, "sessionId": None,
    "parameters": {"visual.fuzz.amount": 0.5, "visual.fuzz.feedback": 0.9, "output.blackout": False},
}, storeDefault=True)
state["running"] = False
base.store("lastHitAt", -1000.0)
for index, (name, parameter) in enumerate([
    ("amount", "visual.fuzz.amount"),
    ("feedback", "visual.fuzz.feedback"),
    ("blackout", "output.blackout"),
]):
    setpar(controls, "name" + str(index), name)
    setpar(controls, "value" + str(index), state["parameters"][parameter])

bridge = ensure(base, "webserverDAT", "bridge")
# Stop before modifying bindings. A missing loopback parameter must not expose
# even an authenticated control server to the LAN.
setpar(bridge, "active", False)
if FUZZ_BRIDGE_ENABLED:
    if getattr(bridge.par, "localaddress", None) is None:
        raise RuntimeError("The local bridge requires TouchDesigner 2025.33070 or newer. Bridge remains off.")
    setpar(bridge, "localaddress", "127.0.0.1")
setpar(bridge, "port", BRIDGE_PORT)
callbacks = ensure(base, "textDAT", "bridge_callbacks")
callbacks.text = callback_source
setpar(bridge, "callbacks", "bridge_callbacks")
bridge.store("fuzzClients", {})

# ------------------------------------------------------------- mappings ----
# Onsets push the warp; level keeps the trail alive; chord shifts the hue.
setexpr(warp, "displaceweightx", "op('CONTROLS')['amount'] * (0.02 + min(max(op('ONSET')[0], 0), 1) * 0.36 + mod.bridge_callbacks.hit_level(op('bridge')) * 0.2)")
setexpr(warp, "displaceweighty", "op('CONTROLS')['amount'] * (0.02 + min(max(op('ONSET')[0], 0), 1) * 0.36 + mod.bridge_callbacks.hit_level(op('bridge')) * 0.2)")
setexpr(dim, "opacity", "min(0.98, op('CONTROLS')['feedback'] * (0.9 + min(max(op('AUDIO_LEVEL')[0], 0.0), 1.0) * 0.1))")
setexpr(hue, "hueoffset", "op('CHORD')['chord'] * 40.0 + op('ONSET')[0] * 15.0")
setexpr(hue, "saturationmult", "1.0 + min(max(op('AUDIO_LEVEL')[0], 0), 1) * 0.5")
setexpr(blackout, "brightness1", "1.0 - op('CONTROLS')['blackout']")

# ----------------------------------------------------------- projection ----
projector = ensure(base, "windowCOMP", "projector")
setpar(projector, "winop", "OUT")
setpar(projector, "borders", False)
if getattr(projector.par, "title", None) is not None:
    setpar(projector, "title", "fuzz projector")
# Open it from the Window COMP ("Open as Separate Window") on the projector's
# display. Corner-pin mapping onto surfaces is the next step.

# --------------------------------------------------------------- layout ----
rows = [
    ([camera, feedback, hue, dim, warp, mix, tail, blackout, visual_out, component_out], 200),
    ([noise], 40),
    ([audio, rms, gain, smooth, audio_out], -140),
    ([slope, onset, onset_out], -300),
    ([chord, controls, bridge, callbacks, projector], -460),
]
for nodes, y in rows:
    for index, node in enumerate(nodes):
        node.nodeX = index * 190
        node.nodeY = y

visual_out.viewer = True
visual_out.display = True
audio_out.viewer = True
onset_out.viewer = True
base.nodeX = 700
base.nodeY = 100
base.viewer = True

setpar(bridge, "active", FUZZ_BRIDGE_ENABLED)
print("fuzz ready at {}/{}".format(ROOT_PATH, BASE_NAME))
print("Visual output:", visual_out.path, "errors:", visual_out.errors())
print("Audio level:", audio_out.path, "errors:", audio_out.errors())
print("Onset:", onset_out.path, "errors:", onset_out.errors())
if FUZZ_BRIDGE_ENABLED:
    print("Bridge: ws://127.0.0.1:{}/body-synth  errors: {}".format(BRIDGE_PORT, bridge.errors()))
    print("Pairing code (private; paste into the web app):", base.fetch("pairingCode"))
    print("Do not commit a saved .toe containing this pairing code.")
else:
    print("Bridge disabled; standalone audio visuals only.")
