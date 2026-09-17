"""Build a separate, local projection mapper in TouchDesigner 2025.33070+.

From the Textport, with this project's .toe beside the builder:
    exec(open(project.folder + '/projection_mapping_build.py').read())

Fuzz publishes the macOS Syphon sender "body-synth-fuzz" in another process.
The mapper starts with a built-in calibration grid. Select Fuzz on the Mapping
page when ready. Corner coordinates use fractions: (0, 0) bottom left,
(1, 1) top right. Select a display on projector, then press F1; Escape exits.

Rebuilding updates only /project1/projection_mapping and preserves its corner
calibration, controls, and projector display settings. No windows open here.
"""

ROOT_PATH = "/project1"
BASE_NAME = "projection_mapping"
SENDER_NAME = "body-synth-fuzz"


def ensure(parent_op, op_type, name):
    existing = parent_op.op(name)
    return existing if existing is not None else parent_op.create(op_type, name)


def setpar(node, name, value):
    par = getattr(node.par, name, None)
    if par is None:
        raise RuntimeError("{} has no parameter {}".format(node.path, name))
    par.val = value


root = op(ROOT_PATH)
if root is None:
    raise RuntimeError("Create /project1 before running the mapper builder.")
base = ensure(root, "baseCOMP", BASE_NAME)
page = next((page for page in base.customPages if page.name == "Mapping"), None)
if page is None:
    page = base.appendCustomPage("Mapping")

if getattr(base.par, "Source", None) is None:
    source = page.appendMenu("Source", label="Source")[0]
    source.menuNames = ["testpattern", "fuzz"]
    source.menuLabels = ["Test pattern", "Fuzz"]
    source.default = 0
    source.val = 0
if getattr(base.par, "Brightness", None) is None:
    brightness = page.appendFloat("Brightness", label="Brightness")[0]
    brightness.default = 1.0
    brightness.val = 1.0
    brightness.min = brightness.normMin = 0.0
    brightness.max = brightness.normMax = 1.0
    brightness.clampMin = brightness.clampMax = True
if getattr(base.par, "Blackout", None) is None:
    blackout = page.appendToggle("Blackout", label="Blackout")[0]
    blackout.default = False
    blackout.val = False

# A white grid on opaque black, generated entirely inside the project.
cell = ensure(base, "rectangleTOP", "grid_cell")
for name, value in {
    "outputresolution": "custom", "resolutionw": 80, "resolutionh": 80,
    "sizeunit": "fraction", "sizex": 1.0, "sizey": 1.0,
    "centerx": 0.0, "centery": 0.0,
    "fillcolorr": 0.0, "fillcolorg": 0.0, "fillcolorb": 0.0, "fillalpha": 1.0,
    "borderr": 1.0, "borderg": 1.0, "borderb": 1.0, "borderalpha": 1.0,
    "bgcolorr": 0.0, "bgcolorg": 0.0, "bgcolorb": 0.0, "bgalpha": 1.0,
    "borderwidthunit": "pixels", "borderwidth": 2.0, "borderoffset": 0.0,
    "cornerradius": 0.0,
}.items():
    setpar(cell, name, value)
grid = base.op("test_pattern")
if grid is not None and grid.type == "tile":
    grid.destroy()
grid = ensure(base, "cropTOP", "test_pattern")
grid.setInputs([cell])
# Repeat the cell over a 16-by-9 crop; Tile TOP clamps its counts to two.
for name, value in {
    "cropleft": 0.0, "cropright": 16.0, "cropbottom": 0.0, "croptop": 9.0,
    "extend": "repeat", "outputresolution": "custom",
    "resolutionw": 1280, "resolutionh": 720, "outputaspect": "resolution",
}.items():
    setpar(grid, name, value)

receiver = ensure(base, "syphonspoutinTOP", "fuzz_in")
setpar(receiver, "usespoutactivesender", False)
setpar(receiver, "sendername", SENDER_NAME)
select = ensure(base, "switchTOP", "source")
select.setInputs([grid, receiver])
select.par.index.expr = "parent().par.Source.menuIndex"

new_corners = base.op("corners") is None
corners = ensure(base, "cornerpinTOP", "corners")
corners.setInputs([select])
if new_corners:
    setpar(corners, "mapping", "perspective")
# Keep the extraction as the entire image; only the Pin page changes geometry.
for extract, pin, name, label, identity in [
    ("tl", "topleft", "Topleft", "Top left (X, Y)", (0.0, 1.0)),
    ("tr", "topright", "Topright", "Top right (X, Y)", (1.0, 1.0)),
    ("bl", "botleft", "Bottomleft", "Bottom left (X, Y)", (0.0, 0.0)),
    ("br", "botright", "Bottomright", "Bottom right (X, Y)", (1.0, 0.0)),
]:
    setpar(corners, "extract{}unit".format(extract), "fraction")
    setpar(corners, "pin{}unit".format(pin), "fraction")
    for axis, value in zip("xy", identity):
        setpar(corners, "extract{}{}".format(extract, axis), value)
    controls = base.pars(name + "*")
    if not controls:
        controls = page.appendXY(name, label=label)
        for par, value in zip(controls, identity):
            par.default = par.val = value
            par.normMin, par.normMax = 0.0, 1.0
    for axis, par in zip("xy", controls):
        getattr(corners.par, "pin{}{}".format(pin, axis)).expr = "parent().par.{}".format(par.name)
for name, value in {
    "extend": "zero",
    "bgcolorr": 0.0, "bgcolorg": 0.0, "bgcolorb": 0.0, "bgcolora": 1.0,
    "outputresolution": "custom", "resolutionw": 1280, "resolutionh": 720,
    "outputaspect": "resolution",
}.items():
    setpar(corners, name, value)

level = ensure(base, "levelTOP", "output_level")
level.setInputs([corners])
level.par.brightness1.expr = "0.0 if parent().par.Blackout else parent().par.Brightness"
visual_out = ensure(base, "nullTOP", "OUT")
visual_out.setInputs([level])
component_out = ensure(base, "outTOP", "out1")
component_out.setInputs([visual_out])

new_projector = base.op("projector") is None
projector = ensure(base, "windowCOMP", "projector")
setpar(projector, "winop", "OUT")
if new_projector:
    for name, value in {
        "title": "Projection mapping", "borders": False,
        "justifyoffsetto": "specifydisplay", "display": 0, "size": "fill",
        "closeescape": True,
    }.items():
        setpar(projector, name, value)

for nodes, y in [
    ([cell, grid], 200),
    ([receiver, select, corners, level, visual_out, component_out], 0),
    ([projector], -200),
]:
    for index, node in enumerate(nodes):
        node.nodeX, node.nodeY = index * 190, y
visual_out.viewer = visual_out.display = True
base.nodeX, base.nodeY = 700, 100
base.viewer = True

# Selecting the F1 target does not open it or change startup window placement.
projector.par.setperform.pulse()
print("Projection mapper ready at", base.path)
print("Use Mapping controls; select the projector display before pressing F1.")
print("Syphon sender:", SENDER_NAME, "| Output:", visual_out.path)
