"""Print bounding boxes and material names of a GLB. Read-only helper.

Usage: Blender -b --factory-startup -t 2 --python inspect_asset.py -- <file.glb>
"""
import bpy, sys, os

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
path = args[0]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
mins = [1e9, 1e9, 1e9]
maxs = [-1e9, -1e9, -1e9]
mats = set()
tri = 0
for o in bpy.context.scene.objects:
    if o.type != 'MESH':
        continue
    tri += sum(len(p.vertices) - 2 for p in o.data.polygons)
    for c in o.bound_box:
        w = o.matrix_world @ __import__('mathutils').Vector(c)
        for i in range(3):
            mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
    for m in o.data.materials:
        if m:
            mats.add(m.name)
print('FILE', os.path.basename(path))
print('BOUNDS_MIN', [round(v, 3) for v in mins])
print('BOUNDS_MAX', [round(v, 3) for v in maxs])
print('SIZE', [round(maxs[i] - mins[i], 3) for i in range(3)])
print('CENTER', [round((maxs[i] + mins[i]) / 2, 3) for i in range(3)])
print('TRIS', tri)
print('MATERIALS', sorted(mats))
