"""Build the "fuzz" TouchDesigner network: camera video distorted by playing.

Run from the TouchDesigner Textport with:

    exec(open('/Users/fb/dev/visualarts/body-synth/touchdesigner/fuzz/fuzz_build.py').read())

Then save the project as touchdesigner/fuzz/fuzz.toe from TouchDesigner.

Non-destructive: creates or updates operators only inside /project1/fuzz.

Signal flow
-----------
video   camera_in -> feedback loop (composite + hue shift + dim + displace by
        noise) -> OUT -> out1, plus a borderless Window COMP for projection.
audio   audio_in (the Spark over USB, or the Mac input) -> RMS -> smoothing
        -> AUDIO_LEVEL; slope of RMS -> trigger envelope -> ONSET.
chords  bridge (Web Server DAT on 127.0.0.1:9980) receives JSON from the
        body-synth web app (see src/lib/touchdesigner/protocol.ts) and writes
        CHORD channels: chord index and hit strength. The app side of this
        bridge is not wired yet; until then the audio path drives everything.

Mappings: ONSET pushes the displacement, AUDIO_LEVEL keeps the feedback
trail alive, CHORD shifts the hue.
"""

import json

ROOT_PATH = "/project1"
BASE_NAME = "fuzz"
BRIDGE_PORT = 9980


def ensure(parent_op, op_type, name):
    """Return an existing child or create it when it does not exist."""
    existing = parent_op.op(name)
    return existing if existing is not None else parent_op.create(op_type, name)


def connect(source, target, input_index=0):
    """Connect one operator to a specific input connector."""
    target.inputConnectors[input_index].connect(source)


def setpar(node, name, value):
    """Set a parameter if it exists; report instead of failing on older builds."""
    par = getattr(node.par, name, None)
    if par is None:
        print("skip: {} has no parameter {}".format(node.path, name))
        return
    par.val = value


def setexpr(node, name, expression):
    par = getattr(node.par, name, None)
    if par is None:
        print("skip: {} has no parameter {}".format(node.path, name))
        return
    par.expr = expression


root = op(ROOT_PATH)
base = ensure(root, "baseCOMP", BASE_NAME)

# ---------------------------------------------------------------- video ----
camera = ensure(base, "videodeviceinTOP", "camera_in")
feedback = ensure(base, "feedbackTOP", "feedback")
mix = ensure(base, "compositeTOP", "mix")
hue = ensure(base, "hsvadjustTOP", "hue")
dim = ensure(base, "levelTOP", "dim")
noise = ensure(base, "noiseTOP", "warp_noise")
warp = ensure(base, "displaceTOP", "warp")
tail = ensure(base, "nullTOP", "tail")
visual_out = ensure(base, "nullTOP", "OUT")
component_out = ensure(base, "outTOP", "out1")

connect(camera, feedback)          # first frame seeds the loop
connect(camera, mix, 0)
connect(feedback, mix, 1)
connect(mix, hue)
connect(hue, dim)
connect(dim, warp, 0)
connect(noise, warp, 1)
connect(warp, tail)
connect(tail, visual_out)
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
setpar(onset, "threshold", 0.6)
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

bridge = ensure(base, "webserverDAT", "bridge")
callbacks = ensure(base, "textDAT", "bridge_callbacks")
callbacks.text = '''# Web Server DAT callbacks for the body-synth bridge (protocol v1).
# Accepts only named messages; never evaluates arbitrary Python.
import json

CHORD_INDEX = {"c9sus4": 0, "dm7": 1, "gm": 2}


def _chord():
    return op("CHORD")


def onHTTPRequest(webServerDAT, request, response):
    response["statusCode"] = 200
    response["statusReason"] = "OK"
    response["data"] = "body-synth fuzz bridge"
    return response


def onWebSocketOpen(webServerDAT, client, uri):
    webServerDAT.webSocketSendText(client, json.dumps({
        "type": "welcome", "protocol": 1, "engine": "fuzz",
    }))


def onWebSocketReceiveText(webServerDAT, client, data):
    try:
        msg = json.loads(data)
    except ValueError:
        return
    kind = msg.get("type")
    if kind == "ping":
        webServerDAT.webSocketSendText(client, json.dumps({"type": "pong"}))
    elif kind == "event":
        name = msg.get("name")
        payload = msg.get("payload") or {}
        if name == "song.chord":
            _chord().par.value0 = CHORD_INDEX.get(str(payload.get("chordId")), 0)
        elif name == "note.hit":
            _chord().par.value1 = 1.0 if payload.get("chordTone") else 0.0
    elif kind == "parameter.set":
        pid = msg.get("id")
        value = msg.get("value")
        if pid == "fuzz.hit" and isinstance(value, (int, float)):
            _chord().par.value1 = max(0.0, min(1.0, float(value)))
    else:
        webServerDAT.webSocketSendText(client, json.dumps({
            "type": "error", "code": "unsupported", "message": str(kind),
        }))
'''
setpar(bridge, "port", BRIDGE_PORT)
setpar(bridge, "callbacks", "bridge_callbacks")
setpar(bridge, "active", True)

# ------------------------------------------------------------- mappings ----
# Onsets push the warp; level keeps the trail alive; chord shifts the hue.
setexpr(warp, "displaceweightx", "0.01 + op('ONSET')[0] * 0.18 + op('CHORD')['hit'] * 0.1")
setexpr(warp, "displaceweighty", "0.01 + op('ONSET')[0] * 0.18 + op('CHORD')['hit'] * 0.1")
setexpr(dim, "opacity", "0.82 + min(max(op('AUDIO_LEVEL')[0], 0.0), 1.0) * 0.16")
setexpr(hue, "hueoffset", "op('CHORD')['chord'] * 40.0 + op('ONSET')[0] * 15.0")
setexpr(hue, "saturationmult", "1.0 + op('AUDIO_LEVEL')[0] * 0.5")

# ----------------------------------------------------------- projection ----
projector = ensure(base, "windowCOMP", "projector")
setpar(projector, "winop", "OUT")
setpar(projector, "borders", False)
setpar(projector, "title", "fuzz projector")
# Open it from the Window COMP ("Open as Separate Window") on the projector's
# display. Corner-pin mapping onto surfaces is the next step.

# --------------------------------------------------------------- layout ----
rows = [
    ([camera, feedback, mix, hue, dim, warp, tail, visual_out, component_out], 200),
    ([noise], 40),
    ([audio, rms, gain, smooth, audio_out], -140),
    ([slope, onset, onset_out], -300),
    ([chord, bridge, callbacks, projector], -460),
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

print("fuzz ready at {}/{}".format(ROOT_PATH, BASE_NAME))
print("Visual output:", visual_out.path, "errors:", visual_out.errors())
print("Audio level:", audio_out.path, "errors:", audio_out.errors())
print("Onset:", onset_out.path, "errors:", onset_out.errors())
print("Bridge: ws://127.0.0.1:{}  errors: {}".format(BRIDGE_PORT, bridge.errors()))
