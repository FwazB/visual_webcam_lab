"""Build the "fuzz" TouchDesigner network: camera video distorted by playing.

Run from the TouchDesigner Textport with:

    FUZZ_DIRECTORY = project.folder
    exec(open(FUZZ_DIRECTORY + '/fuzz_build.py').read())

Before sharing a .toe, call bridge_callbacks.prepare_for_export(bridge).
The bridge requires TouchDesigner 2025.33070+.

Non-destructive: creates or updates operators only inside /project1/fuzz.

Signal flow
-----------
video   camera_in -> feedback loop (composite + hue shift + dim + displace by
        noise) -> OUT -> out1, a local preview, and a local Syphon/Spout sender.
audio   audio_in (the Spark over USB, or the Mac input) -> RMS -> smoothing
        -> AUDIO_LEVEL; slope of RMS -> trigger envelope -> ONSET.
chords  authenticated bridge on ws://127.0.0.1:9980/body-synth receives
        song chords, note hits, transport, and three allowlisted controls.
        Standalone audio drives the network even without a web connection.

Mappings: ONSET pushes the displacement, AUDIO_LEVEL keeps the feedback
trail alive, detected pitch colors the camera using a circle-of-fifths palette.
"""

from pathlib import Path

ROOT_PATH = "/project1"
BASE_NAME = "fuzz"
BRIDGE_PORT = 9980
# Override FUZZ_DIRECTORY before exec() when using another checkout.
FUZZ_DIRECTORY = Path(globals().get("FUZZ_DIRECTORY", project.folder))
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
pitch_source = (FUZZ_DIRECTORY / "pitch_color.py").read_text()
pitch_callback_source = (FUZZ_DIRECTORY / "pitch_callbacks.py").read_text()
base = ensure(root, "baseCOMP", BASE_NAME)
page = next((p for p in base.customPages if p.name == "Pitch Color"), None)
if page is None:
    page = base.appendCustomPage("Pitch Color")
if getattr(base.par, "Tint", None) is None:
    tint = page.appendFloat("Tint", label="Pitch color amount")[0]
    tint.default = tint.val = 1.0
    tint.min = tint.normMin = 0.0
    tint.max = tint.normMax = 1.0
    tint.clampMin = tint.clampMax = True

# ---------------------------------------------------------------- video ----
camera = ensure(base, "videodeviceinTOP", "camera_in")
feedback = ensure(base, "feedbackTOP", "feedback")
mix = ensure(base, "compositeTOP", "mix")
hue = ensure(base, "hsvadjustTOP", "hue")
pitch_swatch = ensure(base, "constantTOP", "pitch_swatch")
pitch_tint = ensure(base, "compositeTOP", "pitch_tint")
dim = ensure(base, "levelTOP", "dim")
noise = ensure(base, "noiseTOP", "warp_noise")
warp = ensure(base, "displaceTOP", "warp")
tail = ensure(base, "nullTOP", "tail")
blackout = ensure(base, "levelTOP", "output_level")
visual_out = ensure(base, "nullTOP", "OUT")
component_out = ensure(base, "outTOP", "out1")

connect(camera, hue)
connect(hue, pitch_tint, 0)
connect(pitch_swatch, pitch_tint, 1)
connect(pitch_tint, feedback)       # first frame seeds the loop
connect(feedback, dim)
connect(dim, warp, 0)
connect(noise, warp, 1)
connect(warp, mix, 0)  # faded trail over the new, opaque camera image
connect(pitch_tint, mix, 1)
connect(mix, tail)
connect(tail, blackout)
connect(blackout, visual_out)
connect(visual_out, component_out)

if not camera.par.device.eval() and camera.par.device.menuNames:
    camera.par.device = camera.par.device.menuNames[0]

setpar(feedback, "top", "tail")     # close the loop
setpar(mix, "operand", "over")
setpar(pitch_tint, "operand", "multiply")
setpar(pitch_tint, "outputresolution", "custom")
setpar(pitch_tint, "resolutionw", 1280)
setpar(pitch_tint, "resolutionh", 720)
setpar(pitch_tint, "outputaspect", "resolution")
setpar(pitch_swatch, "outputresolution", "custom")
setpar(pitch_swatch, "resolutionw", 1)
setpar(pitch_swatch, "resolutionh", 1)
setpar(pitch_swatch, "alpha", 1.0)
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

# Optional local speaker monitoring. Keep this separate from visual controls
# and fail closed when the Spark or the explicit speaker output disappears.
monitor_page = next((p for p in base.customPages if p.name == "Audio monitor"), None)
if monitor_page is None:
    monitor_page = base.appendCustomPage("Audio monitor")
if getattr(base.par, "Monitor", None) is None:
    monitor_toggle = monitor_page.appendToggle("Monitor", label="Monitor guitar")[0]
    monitor_toggle.default = monitor_toggle.val = False
if getattr(base.par, "Monitorlevel", None) is None:
    monitor_level = monitor_page.appendFloat("Monitorlevel", label="Speaker volume")[0]
    monitor_level.default = monitor_level.val = 0.25
    monitor_level.min = monitor_level.normMin = 0.0
    monitor_level.max = monitor_level.normMax = 1.0
    monitor_level.clampMin = monitor_level.clampMax = True

speaker_monitor = ensure(base, "audiodeviceoutCHOP", "speaker_monitor")
setpar(speaker_monitor, "active", False)
connect(audio, speaker_monitor)
if getattr(audio.par, "errormissing", None) is not None:
    setpar(audio, "errormissing", True)
setpar(speaker_monitor, "errormissing", True)
setpar(speaker_monitor, "bufferlength", 0.05)
setpar(speaker_monitor, "clampoutput", True)
setpar(speaker_monitor, "cookalways", True)
setexpr(speaker_monitor, "volume", "parent().par.Monitorlevel")
# Resolve the current menu value by label; do not save a machine's device ID.
setexpr(speaker_monitor, "device",
        "next((name for name, label in zip(me.par.device.menuNames, me.par.device.menuLabels) "
        "if name == 'BuiltInSpeakerDevice' and label.split(':', 1)[0].strip() == 'MacBook Pro Speakers'), '') "
        "if absTime.frame >= 0 else ''")
setexpr(speaker_monitor, "active",
        "absTime.frame >= 0 and parent().par.Monitor.eval() "
        "and op('audio_in').par.active.eval() and not op('audio_in').errors() "
        "and any(name == op('audio_in').par.device.eval() and 'spark' in label.lower() "
        "for name, label in zip(op('audio_in').par.device.menuNames, op('audio_in').par.device.menuLabels)) "
        "and any(name == me.par.device.eval() == 'BuiltInSpeakerDevice' "
        "and label.split(':', 1)[0].strip() == 'MacBook Pro Speakers' "
        "for name, label in zip(me.par.device.menuNames, me.par.device.menuLabels))")

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

# ---------------------------------------------------------- local pitch ----
pitch_module = ensure(base, "textDAT", "pitch_color")
pitch_module.text = pitch_source
pitch_callbacks = ensure(base, "textDAT", "pitch_callbacks")
pitch_callbacks.text = pitch_callback_source
new_pitch = base.op("PITCH") is None
pitch = ensure(base, "scriptCHOP", "PITCH")
generated_callbacks = pitch.par.callbacks.eval() if new_pitch else None
setpar(pitch, "callbacks", "pitch_callbacks")
if generated_callbacks is not None and generated_callbacks != pitch_callbacks:
    generated_callbacks.destroy()
setpar(pitch, "timeslice", False)
connect(audio, pitch)
# A local diagnostic viewer; it is not composited into the shared image.
pitch_monitor = ensure(base, "textTOP", "pitch_monitor")
setpar(pitch_monitor, "outputresolution", "custom")
setpar(pitch_monitor, "resolutionw", 480)
setpar(pitch_monitor, "resolutionh", 96)
setpar(pitch_monitor, "font", "Verdana")
setpar(pitch_monitor, "fontsizex", 22)
setexpr(pitch_monitor, "text", "mod.pitch_callbacks.label(op('PITCH'))")

# --------------------------------------------------------------- chords ----
chord = ensure(base, "constantCHOP", "CHORD")
setpar(chord, "name0", "chord")
setpar(chord, "value0", 0.0)
setpar(chord, "name1", "hit")
setpar(chord, "value1", 0.0)

controls = ensure(base, "constantCHOP", "CONTROLS")
state = base.fetch("fuzzState", {
    "revision": 0, "running": False, "sessionId": None,
    "parameters": {"visual.fuzz.amount": 0.2, "visual.fuzz.feedback": 0.65, "output.blackout": False},
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
startup = ensure(base, "executeDAT", "startup")
startup.text = '''def onStart():
    me.parent().op("pitch_callbacks").module.reset()
    bridge = me.parent().op("bridge")
    me.parent().op("bridge_callbacks").module.start_bridge(bridge)
'''
setpar(startup, "active", FUZZ_BRIDGE_ENABLED)
setpar(startup, "start", True)
setpar(startup, "create", False)
setpar(startup, "framestart", False)
setpar(startup, "frameend", False)

# ------------------------------------------------------------- mappings ----
# Pitch controls color; onsets and authenticated hits still push the warp.
setexpr(warp, "displaceweightx", "op('CONTROLS')['amount'] * (min(max(op('ONSET')[0], 0), 1) * 0.08 + mod.bridge_callbacks.hit_level(op('bridge')) * 0.04)")
setexpr(warp, "displaceweighty", "op('CONTROLS')['amount'] * (min(max(op('ONSET')[0], 0), 1) * 0.08 + mod.bridge_callbacks.hit_level(op('bridge')) * 0.04)")
setexpr(dim, "opacity", "min(0.98, op('CONTROLS')['feedback'] * (0.9 + min(max(op('AUDIO_LEVEL')[0], 0.0), 1.0) * 0.1))")
setpar(hue, "hueoffset", 0.0)
setexpr(hue, "saturationmult", "1.0 - op('PITCH')['amount'] * parent().par.Tint")
for component, channel in zip("rgb", "rgb"):
    setexpr(pitch_swatch, "color" + component,
            "1.0 - op('PITCH')['amount'] * parent().par.Tint + op('PITCH')['{}'] * parent().par.Tint".format(channel))
setexpr(blackout, "brightness1", "1.0 - op('CONTROLS')['blackout']")

# A second view inside the same Fuzz project, using its existing camera.
light_directory = FUZZ_DIRECTORY / 'lights'
exec((light_directory / 'light_maps_build.py').read_text(),
     dict(globals(), LIGHT_MAPS_DIRECTORY=light_directory))
scene = ensure(base, 'switchTOP', 'view')
light_preview = ensure(base, 'selectTOP', 'light_preview')
setpar(light_preview, 'top', 'light_maps/PREVIEW')
scene.setInputs([tail, light_preview])
scene.par.index.expr = 'parent().par.View.menuIndex'
blackout.setInputs([scene])

# ---------------------------------------------------------- local output ----
# Migrate the old window without leaving a duplicate projector component.
old_window = base.op("projector")
if old_window is not None:
    if base.op("preview") is None:
        old_window.name = "preview"
    else:
        old_window.destroy()
preview = ensure(base, "windowCOMP", "preview")
setpar(preview, "winop", "OUT")
setpar(preview, "borders", True)
setpar(preview, "title", "Fuzz local preview")
setpar(preview, "justifyoffsetto", "primarydisplay")
setpar(preview, "size", "custom")
setpar(preview, "winw", 960)
setpar(preview, "winh", 540)
preview.par.setperform.pulse()

# Shared GPU memory only: projection geometry and display routing live in the
# separate projection_mapping project, which can receive this named texture.
shared_out = ensure(base, "syphonspoutoutTOP", "local_texture")
connect(visual_out, shared_out)
setpar(shared_out, "sendername", "body-synth-fuzz")
setpar(shared_out, "active", True)

# --------------------------------------------------------------- layout ----
rows = [
    ([camera, hue, pitch_tint, feedback, dim, warp, mix, tail, blackout, visual_out, component_out], 200),
    ([pitch_swatch, noise, light_preview, scene], 40),
    ([audio, rms, gain, smooth, audio_out, speaker_monitor], -140),
    ([slope, onset, onset_out], -300),
    ([pitch_module, pitch_callbacks, pitch, pitch_monitor], -620),
    ([chord, controls, bridge, callbacks, startup, preview, shared_out], -460),
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

if FUZZ_BRIDGE_ENABLED:
    callbacks.module.start_bridge(bridge)
print("fuzz ready at {}/{}".format(ROOT_PATH, BASE_NAME))
print("Visual output:", visual_out.path, "errors:", visual_out.errors())
print("Local preview:", preview.path, "shared texture: body-synth-fuzz")
print("Audio level:", audio_out.path, "errors:", audio_out.errors())
print("Onset:", onset_out.path, "errors:", onset_out.errors())
if FUZZ_BRIDGE_ENABLED:
    print("Bridge: ws://127.0.0.1:{}/body-synth  errors: {}".format(BRIDGE_PORT, bridge.errors()))
    print("Pairing code (private; paste into the web app):", base.fetch("pairingCode"))
    print("Pairing code changes when the project is reopened. Sanitize shared exports with prepare_for_export().")
else:
    print("Bridge disabled; standalone audio visuals only.")
