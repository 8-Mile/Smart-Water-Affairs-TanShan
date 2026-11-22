"""唐港 5190 重点建筑精修（Blender 后台可复现脚本）。

用法：
  "/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup -t 2 \
    --python-exit-code 1 --python refine_buildings.py -- <out_dir>

输出：
  <out_dir>/pumphouse.glb、treatmenthouse.glb
  <out_dir>/refine_buildings.blend

约定：
- 原点在建筑基底中心，基底 z=0；X 向右、Y 向前（Blender），Z 向上。
- 导出 glTF 时 Blender 会自动转为 Y 向上。整体外包尺寸保持在原模型量级，
  以便前端按 CAD 锚点与 display 尺寸落位（锚点、朝向、拾取映射不改）。
- 体量、檐口、窗带与屋面设备均为 L1 表现层，不代表实测构造。
"""
import bpy
import math
import os
import sys

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


def box(name, size, loc, material, parts):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    parts.append(o)
    return o


def cyl(name, radius, depth, loc, material, parts, verts=16, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
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
    # 原点落在世界原点（基底中心），与前端按锚点落位的约定一致。
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


# ------------------------------------------------------------------ materials
C_TRIM = (0.84, 0.87, 0.85)
C_WALL = (0.72, 0.78, 0.76)
C_BLUE = (0.10, 0.32, 0.43)
C_GLASS = (0.30, 0.50, 0.60)
C_STEEL = (0.36, 0.44, 0.48)
C_DOOR = (0.18, 0.27, 0.31)
C_ROOF = (0.55, 0.60, 0.58)

# --------------------------------------------------------------- 除尘泵房
# 主厂房 + 东侧低副体量 + 西侧检修棚，前立面深门洞与雨棚，成组高窗带。
def build_pump():
    reset()
    trim = mat('ph-trim', C_TRIM, 0.62, 0.04)
    wall = mat('ph-wall', C_WALL, 0.78, 0.02)
    blue = mat('ph-blue', C_BLUE, 0.5, 0.18)
    glass = mat('ph-glass', C_GLASS, 0.3, 0.2)
    steel = mat('ph-steel', C_STEEL, 0.5, 0.42)
    door = mat('ph-door', C_DOOR, 0.62, 0.16)
    roofm = mat('ph-roof', C_ROOF, 0.8, 0.05)
    P = []
    # 基座与散水（略大于主厂房外包，保持原 4.09×4.90 量级）
    box('plinth', (4.30, 5.10, 0.12), (0.02, 0, 0.06), trim, P)
    box('apron', (4.52, 5.32, 0.04), (0.02, 0, 0.02), wall, P)
    # 主厂房：X -1.80..1.10，Y -2.40..2.40，高 1.62
    box('hall', (2.90, 4.80, 1.52), (-0.35, 0, 0.12 + 0.76), wall, P)
    # 主厂房压顶与挑檐（形成可见屋檐与檐下阴影）
    box('hall-eave', (3.16, 5.06, 0.14), (-0.35, 0, 1.64), trim, P)
    box('hall-eave-under', (2.96, 4.88, 0.05), (-0.35, 0, 1.545), roofm, P)
    # 东侧低副体量（屋面高差）
    box('annex', (1.06, 3.10, 0.86), (1.64, -0.10, 0.12 + 0.43), wall, P)
    box('annex-eave', (1.22, 3.26, 0.10), (1.64, -0.10, 1.02), trim, P)
    # 副体量窗带
    for i in range(3):
        box('annex-win%d' % i, (0.04, 0.58, 0.34), (2.185, -1.08 + i * 0.86, 0.62), glass, P)
    # 主厂房屋顶设备：楼梯间、通风机组与采光带
    box('penthouse', (1.02, 1.20, 0.30), (-0.95, 0.55, 1.64 + 0.15), wall, P)
    box('penthouse-cap', (1.10, 1.28, 0.06), (-0.95, 0.55, 1.64 + 0.31), trim, P)
    box('vent-a', (0.62, 0.44, 0.22), (0.35, -0.55, 1.64 + 0.11), steel, P)
    box('vent-b', (0.44, 0.36, 0.18), (0.42, 0.95, 1.64 + 0.09), steel, P)
    box('skylight', (1.50, 0.34, 0.06), (-0.42, 1.92, 1.64 + 0.03), glass, P)
    # 前立面（Blender -Y 即 three +Z，默认机位朝向）：深门洞 + 雨棚
    box('door-recess', (1.26, 0.10, 1.02), (-0.30, -2.405, 0.12 + 0.51), door, P)
    box('door-panel', (0.92, 0.06, 0.86), (-0.30, -2.435, 0.12 + 0.43), blue, P)
    box('canopy', (1.66, 0.62, 0.08), (-0.30, -2.70, 1.16), trim, P)
    for sx in (-0.88, 0.28):
        box('canopy-col', (0.09, 0.09, 1.02), (sx, -2.92, 0.12 + 0.51), steel, P)
    # 前立面高窗带（门洞上方与两侧），带竖挺
    for j in range(6):
        x = -1.62 + j * 0.29
        if -0.95 < x < 0.38:
            continue
        box('front-win%d' % j, (0.24, 0.04, 0.42), (x, -2.42, 1.18), glass, P)
    box('front-band', (2.52, 0.06, 0.08), (-0.30, -2.425, 0.94), blue, P)
    # 西侧山墙窗带与竖向蓝色标识
    for j in range(4):
        box('west-win%d' % j, (0.04, 0.56, 0.40), (-1.82, -1.62 + j * 1.05, 1.14), glass, P)
    box('west-stripe', (0.06, 0.30, 1.30), (-1.84, -2.28, 0.12 + 0.65), blue, P)
    # 东侧检修钢梯
    for k in range(7):
        box('rung%d' % k, (0.06, 0.44, 0.04), (2.28, -1.72, 0.24 + k * 0.18), steel, P)
    for sy in (-1.90, -1.54):
        box('rail%d' % int(sy * 10), (0.05, 0.05, 1.30), (2.30, sy, 0.12 + 0.65), steel, P)
    # 檐下暗带，强化屋顶与墙面的层次
    box('eave-shadow', (2.94, 4.84, 0.05), (-0.35, 0, 1.575), roofm, P)
    o = join(P, 'PumpHouse')
    o.location = (0, 0, 0)
    return o


# --------------------------------------------------------------- 污水处理场
# 长向厂房：连续成组窗带、屋面高侧天窗、临池一侧巡检平台与栏杆。
def build_treatment():
    reset()
    trim = mat('th-trim', C_TRIM, 0.62, 0.04)
    wall = mat('th-wall', C_WALL, 0.78, 0.02)
    blue = mat('th-blue', C_BLUE, 0.5, 0.18)
    glass = mat('th-glass', C_GLASS, 0.3, 0.2)
    steel = mat('th-steel', C_STEEL, 0.5, 0.42)
    door = mat('th-door', C_DOOR, 0.62, 0.16)
    roofm = mat('th-roof', C_ROOF, 0.8, 0.05)
    P = []
    box('plinth', (3.98, 1.86, 0.10), (0, 0, 0.05), trim, P)
    box('apron', (4.20, 2.04, 0.04), (0, 0, 0.02), wall, P)
    # 主体（X -1.88..1.28，Y ±0.83，高 1.28）
    box('main', (3.16, 1.62, 1.18), (-0.30, 0, 0.10 + 0.59), wall, P)
    box('main-eave', (3.34, 1.82, 0.10), (-0.30, 0, 1.30), trim, P)
    box('main-eave-under', (3.18, 1.66, 0.04), (-0.30, 0, 1.235), roofm, P)
    # 屋面高侧天窗（monitor）
    box('monitor', (2.10, 0.80, 0.26), (-0.52, 0, 1.30 + 0.13), wall, P)
    box('monitor-glass', (1.96, 0.06, 0.16), (-0.52, -0.415, 1.42), glass, P)
    box('monitor-cap', (2.22, 0.92, 0.06), (-0.52, 0, 1.59), trim, P)
    # 东端附属（低体量）
    box('side', (0.62, 1.20, 0.78), (1.58, 0, 0.10 + 0.39), wall, P)
    box('side-cap', (0.70, 1.30, 0.08), (1.58, 0, 0.86), trim, P)
    # 前立面（-Y）连续窗带：4 组，每组 4 樘，带窗台与竖挺
    for g in range(4):
        gx = -1.52 + g * 0.78
        for j in range(4):
            box('win%d_%d' % (g, j), (0.145, 0.04, 0.34), (gx + j * 0.165, -0.825, 0.86), glass, P)
        box('sill%d' % g, (0.70, 0.07, 0.07), (gx + 0.25, -0.84, 0.64), blue, P)
        box('lintel%d' % g, (0.70, 0.06, 0.05), (gx + 0.25, -0.84, 1.05), trim, P)
    # 后立面（+Y）较窄窗带
    for g in range(3):
        box('back%d' % g, (0.92, 0.04, 0.28), (-1.28 + g * 1.05, 0.825, 0.92), glass, P)
    # 西端门洞与雨棚
    box('door', (0.10, 0.90, 0.96), (-1.90, -0.10, 0.10 + 0.48), door, P)
    box('door-canopy', (0.62, 1.18, 0.07), (-2.12, -0.10, 1.02), trim, P)
    # 临池一侧巡检平台（+Y 侧）与栏杆、支架
    box('platform', (3.00, 0.52, 0.07), (-0.34, 1.10, 0.72), steel, P)
    for k in range(9):
        box('p-rail%d' % k, (0.04, 0.04, 0.34), (-1.72 + k * 0.36, 1.33, 0.90), steel, P)
    box('p-toprail', (2.96, 0.05, 0.04), (-0.34, 1.33, 1.07), steel, P)
    for k in range(4):
        box('bracket%d' % k, (0.06, 0.46, 0.34), (-1.52 + k * 0.92, 1.02, 0.54), steel, P)
    # 立面竖向节奏：浅色壁柱
    for k in range(5):
        box('pilaster%d' % k, (0.10, 0.06, 1.10), (-1.60 + k * 0.80, -0.855, 0.63), trim, P)
    # 屋面检修爬梯与落水管
    for k in range(6):
        box('rung%d' % k, (0.04, 0.44, 0.04), (1.92, 0, 0.24 + k * 0.20), steel, P)
    for sx in (-1.80, 1.10):
        cyl('downpipe', 0.045, 1.24, (sx, 0.86, 0.70), steel, P, 10)
    o = join(P, 'TreatmentHouse')
    o.location = (0, 0, 0)
    return o


def main():
    pump = build_pump()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'pumphouse.blend'))
    print('EXPORT', export(pump, 'pumphouse.glb'))
    treat = build_treatment()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'treatmenthouse.blend'))
    print('EXPORT', export(treat, 'treatmenthouse.glb'))
    # 同时留一份两栋合一的 .blend 便于对照
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'pumphouse.glb'))
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'treatmenthouse.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'refine_buildings.blend'))
    print('DONE')


main()
