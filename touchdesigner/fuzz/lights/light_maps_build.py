"""Build local silhouette lighting; camera preview and a separate light-only feed.

Run build_mask_helper.sh once, then open fuzz.toe and select View -> Light Maps.
This module is rebuilt by Fuzz's builder.
The shader, callbacks and worker are embedded; the small native Vision helper
lives in fuzz/lights/.build. Only Fuzz's light_maps component is modified.
"""

from pathlib import Path

directory = Path(globals().get('LIGHT_MAPS_DIRECTORY', Path(project.folder) / 'lights'))


def ensure(parent, kind, name):
    node = parent.op(name)
    return node if node is not None else parent.create(kind, name)


def setpar(node, name, value):
    parameter = getattr(node.par, name, None)
    if parameter is None:
        raise RuntimeError('{} has no parameter {}'.format(node.path, name))
    parameter.val = value


def resolution(node, width, height):
    setpar(node, 'outputresolution', 'custom')
    setpar(node, 'resolutionw', width)
    setpar(node, 'resolutionh', height)
    setpar(node, 'outputaspect', 'resolution')


fuzz = op('/project1/fuzz')
base = ensure(fuzz, 'baseCOMP', 'light_maps')
old_callbacks = base.op('mask_callbacks')
if old_callbacks is not None:
    old_callbacks.module.reset()
page = next((p for p in fuzz.customPages if p.name == 'Lights'), None)
if page is None:
    page = fuzz.appendCustomPage('Lights')
if getattr(fuzz.par, 'View', None) is None:
    view_mode = page.appendMenu('View', label='View')[0]
    view_mode.menuNames = ['fuzz', 'lightmaps']
    view_mode.menuLabels = ['Fuzz', 'Light Maps']
    view_mode.default = view_mode.val = 0
for name, label, default in [('Behind', 'Behind me', 0.6), ('Front', 'In front of me', 0.2),
                             ('Speed', 'Movement', 0.4)]:
    if getattr(fuzz.par, name, None) is None:
        par = page.appendFloat(name, label=label)[0]
        par.default = par.val = default
        par.min = par.normMin = 0.0
        par.max = par.normMax = 1.0
        par.clampMin = par.clampMax = True
if getattr(fuzz.par, 'Lightr', None) is None:
    for par, value in zip(page.appendRGB('Light', label='Light color'), (0.2, 0.65, 1.0)):
        par.default = par.val = value

camera = ensure(base, 'selectTOP', 'camera')
setpar(camera, 'top', '../camera_in')
old_analysis = base.op('analysis_size')
if old_analysis is not None and old_analysis.type == 'null':
    old_analysis.destroy()
analysis = ensure(base, 'fitTOP', 'analysis_size')
analysis.setInputs([camera])
setpar(analysis, 'fit', 'fill')
resolution(analysis, 256, 144)
setpar(analysis, 'resmult', False)

worker = ensure(base, 'textDAT', 'mask_worker')
worker.text = (directory / 'mask_worker.py').read_text()
callbacks = ensure(base, 'textDAT', 'mask_callbacks')
callbacks.text = (directory / 'mask_callbacks.py').read_text()
new_mask = base.op('MASK') is None
mask = ensure(base, 'scriptTOP', 'MASK')
generated_callbacks = mask.par.callbacks.eval() if new_mask else None
setpar(mask, 'callbacks', 'mask_callbacks')
if generated_callbacks is not None and generated_callbacks != callbacks:
    generated_callbacks.destroy()
mask.setInputs([analysis])

shader = ensure(base, 'textDAT', 'lights_shader')
shader.text = (directory / 'lights.frag').read_text()
views = []
for name, preview_mode in [('preview_image', 1), ('light_map', 0)]:
    new_view = base.op(name) is None
    view = ensure(base, 'glslTOP', name)
    generated = list(view.docked) if new_view else []
    view.setInputs([camera, mask])
    setpar(view, 'pixeldat', 'lights_shader')
    setpar(view, 'glslversion', 'glsl450')
    resolution(view, 1280, 720)
    for node in generated:
        if node != shader:
            node.destroy()
    view.seq.vec.numBlocks = 3
    vectors = [
        ('uLight', ["parent(2).par.Behind * (1 - op('../CONTROLS')['blackout'])", "parent(2).par.Front * (1 - op('../CONTROLS')['blackout'])", 'parent(2).par.Speed', 'absTime.seconds']),
        # Module/thread state is not a TD dependency. The frame argument makes
        # validity re-evaluate after startup and expire when capture stalls.
        ('uTint', ['parent(2).par.Lightr', 'parent(2).par.Lightg', 'parent(2).par.Lightb', 'mod.mask_callbacks.is_ready(parent(), absTime.frame)']),
        ('uView', [str(preview_mode), '0', '0', '0']),
    ]
    for index, (uniform, values) in enumerate(vectors):
        setpar(view, 'vec{}name'.format(index), uniform)
        for axis, expression in zip('xyzw', values):
            getattr(view.par, 'vec{}value{}'.format(index, axis)).expr = expression
    views.append(view)

preview_image, light_map = views
preview_out = ensure(base, 'nullTOP', 'PREVIEW')
preview_out.setInputs([preview_image])
visual_out = ensure(base, 'nullTOP', 'OUT')
visual_out.setInputs([light_map])
component_out = ensure(base, 'outTOP', 'out1')
component_out.setInputs([visual_out])
sender = ensure(base, 'syphonspoutoutTOP', 'local_texture')
sender.setInputs([visual_out])
setpar(sender, 'sendername', 'body-synth-light-map')
setpar(sender, 'active', True)

status = ensure(base, 'textTOP', 'mask_status')
resolution(status, 640, 96)
setpar(status, 'fontsizex', 20)
status.par.text.expr = 'mod.mask_callbacks.status(absTime.frame)'
startup = ensure(base, 'executeDAT', 'startup')
startup.text = '''def onStart():
    me.parent().op('mask_callbacks').module.reset()

def onExit():
    me.parent().op('mask_callbacks').module.reset()

def onFrameStart(frame):
    me.parent().op('mask_callbacks').module.maintain_lifecycle(me.parent())
'''
setpar(startup, 'active', True)
setpar(startup, 'start', True)
setpar(startup, 'exit', True)
setpar(startup, 'create', False)
setpar(startup, 'framestart', True)
setpar(startup, 'frameend', False)

for nodes, y in [([camera, analysis, mask, preview_image, preview_out], 200),
                 ([worker, callbacks, shader, light_map, visual_out, sender, component_out], 0),
                 ([startup, status], -200)]:
    for index, node in enumerate(nodes):
        node.nodeX, node.nodeY = index * 190, y
base.nodeX, base.nodeY = 700, 500
base.viewer = preview_out.viewer = True
print('Fuzz Light Maps mode ready: PREVIEW uses camera; light_maps/OUT is light only.')
