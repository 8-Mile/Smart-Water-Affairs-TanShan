"""唐港 5190 精细树资产：树干 + 交叉叶片面片（Blender 后台可复现脚本）。

用法：
  "/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup -t 2 \
    --python-exit-code 1 --python refine_trees.py -- <out_dir>

输出：
  tree-broad.glb、tree-narrow.glb、tree-shrub.glb

约定：
- 原点在树根中心，Z 向上；导出 glTF 时转 Y 向上。
- 叶片使用完整 UV（0..1）对应 tree-leaves.png，材质名固定为 `leaf`；
  树干材质名固定为 `bark`。前端加载后按材质名拆成两个实例化批次。
"""
import bpy
import math
import os
import sys
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def quad(name, w, h, z, rotz, material, parts):
    hw, hh = w / 2, h / 2
    verts = [(-hw, 0, -hh), (hw, 0, -hh), (hw, 0, hh), (-hw, 0, hh)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for i, co in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = co
    o = bpy.data.objects.new(name, me)
    o.rotation_euler = (0, 0, rotz)
    o.location = (0, 0, z)
    o.data.materials.append(material)
    bpy.context.collection.objects.link(o)
    parts.append(o)
    return o


def branch(name, a, b, r1, r2, material, parts):
    a, b = Vector(a), Vector(b)
    d = b - a
    length = max(0.02, d.length)
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=r1, radius2=r2,
                                    depth=length, location=(a + b) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.data.materials.append(material)
    parts.append(o)
    return o


def join(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return o


def export(o, filename):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True,
        export_materials='EXPORT', export_cameras=False, export_lights=False)
    return path


BARK = (0.22, 0.16, 0.11)
LEAF = (0.16, 0.30, 0.13)


def build_broad():
    reset()
    bark = mat('bark', BARK, 0.95)
    leaf = mat('leaf', LEAF, 0.88)
    P = []
    branch('trunk', (0, 0, 0), (0, 0, 1.0), 0.055, 0.026, bark, P)
    for i, (dx, dy, zt, zh) in enumerate([(0.26, 0.10, 1.02, 0.78),
                                         (-0.24, 0.14, 1.05, 0.82),
                                         (0.05, -0.26, 0.96, 0.74)]):
        branch('branch%d' % i, (0, 0, zh), (dx, dy, zt), 0.026, 0.012, bark, P)
    for i, a in enumerate([0, math.pi / 3, math.pi * 2 / 3]):
        quad('crown%d' % i, 1.06, 0.92, 1.02, a, leaf, P)
    quad('crown-top', 0.72, 0.62, 1.30, math.pi / 6, leaf, P)
    o = join(P, 'TreeBroad')
    return export(o, 'tree-broad.glb')


def build_narrow():
    reset()
    bark = mat('bark', BARK, 0.95)
    leaf = mat('leaf', LEAF, 0.88)
    P = []
    branch('trunk', (0, 0, 0), (0, 0, 1.28), 0.046, 0.020, bark, P)
    for i, (dx, dy, zt, zh) in enumerate([(0.16, 0.08, 1.18, 0.92),
                                         (-0.15, -0.10, 1.22, 0.98)]):
        branch('branch%d' % i, (0, 0, zh), (dx, dy, zt), 0.020, 0.009, bark, P)
    for i, a in enumerate([0, math.pi / 3, math.pi * 2 / 3]):
        quad('crown%d' % i, 0.66, 1.12, 1.38, a, leaf, P)
    o = join(P, 'TreeNarrow')
    return export(o, 'tree-narrow.glb')


def build_tall():
    """高瘦行道树：窄冠、主干更高，拉开林带轮廓层次。"""
    reset()
    bark = mat('bark', BARK, 0.95)
    leaf = mat('leaf', LEAF, 0.88)
    P = []
    branch('trunk', (0, 0, 0), (0, 0, 1.60), 0.050, 0.018, bark, P)
    for i, (dx, dy, zt, zh) in enumerate([(0.18, 0.06, 1.52, 1.10),
                                         (-0.17, -0.08, 1.56, 1.18),
                                         (0.05, 0.19, 1.46, 1.02)]):
        branch('branch%d' % i, (0, 0, zh), (dx, dy, zt), 0.020, 0.008, bark, P)
    for i, a in enumerate([0, math.pi / 4, math.pi / 2, math.pi * 3 / 4]):
        quad('crown%d' % i, 0.54, 1.46, 1.86, a, leaf, P)
    quad('crown-top', 0.42, 0.72, 2.52, math.pi / 8, leaf, P)
    o = join(P, 'TreeTall')
    return export(o, 'tree-tall.glb')


def build_oval():
    """宽椭圆冠：冠幅大于树高，用于公园与场地内部的散植。"""
    reset()
    bark = mat('bark', BARK, 0.95)
    leaf = mat('leaf', LEAF, 0.88)
    P = []
    branch('trunk', (0, 0, 0), (0, 0, 0.94), 0.058, 0.028, bark, P)
    for i, (dx, dy, zt, zh) in enumerate([(0.22, 0.12, 0.96, 0.72),
                                         (-0.20, -0.14, 0.98, 0.76)]):
        branch('branch%d' % i, (0, 0, zh), (dx, dy, zt), 0.026, 0.011, bark, P)
    for i, a in enumerate([0, math.pi / 5, math.pi * 2 / 5, math.pi * 3 / 5, math.pi * 4 / 5]):
        quad('crown%d' % i, 1.34, 1.02, 1.10, a, leaf, P)
    quad('crown-top', 0.96, 0.62, 1.52, math.pi / 7, leaf, P)
    quad('crown-low', 0.88, 0.46, 0.74, math.pi / 3, leaf, P)
    o = join(P, 'TreeOval')
    return export(o, 'tree-oval.glb')


def build_shrub():
    reset()
    leaf = mat('leaf', LEAF, 0.9)
    P = []
    for i, (w, h, z, a) in enumerate([(0.98, 0.60, 0.34, 0),
                                      (0.86, 0.54, 0.40, math.pi / 3),
                                      (0.76, 0.48, 0.30, math.pi * 2 / 3)]):
        quad('crown%d' % i, w, h, z, a, leaf, P)
    o = join(P, 'TreeShrub')
    return export(o, 'tree-shrub.glb')


if __name__ == '__main__':
    print(build_broad())
    print(build_narrow())
    print(build_tall())
    print(build_oval())
    print(build_shrub())
