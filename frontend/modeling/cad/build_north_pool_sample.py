"""唐港 CAD 样区建模：北部集水池 + 泵房 + 北侧道路 + 室内消防环网。

数据源：
  - V7_场区平面原始图元底图.json（原始 CAD 矢量，按图层）
  - V5_每个图元分类与证据.json（图元可信度分级）

坐标：复用 scene-v2.2.json 的变换参数（原点 + -35.000106° + 1:10000）。
Blender 坐标：X = sceneX，Y = -sceneZ，Z = 高程（场景单位）。
输出：GLB + 清单 JSON + 两张预览图。
"""

import bpy
import bmesh
import json
import math
import mathutils
import os

CAD_DIR = "/Users/8-mile/Desktop/唐港CAD解析/03_解析结果"
V7_PATH = os.path.join(CAD_DIR, "V7_场区平面原始图元底图.json")
V5_PATH = os.path.join(CAD_DIR, "V5_每个图元分类与证据.json")

ROOT = "/Users/8-mile/代码仓库/唐港智慧水务-迁移开发版"
OUT_DIR = os.path.join(ROOT, "frontend/public/tanggang/models/cad-sample")
OUT_GLB = os.path.join(OUT_DIR, "north-pool-sample.glb")
OUT_MANIFEST = os.path.join(OUT_DIR, "manifest.json")
PREVIEW_DIR = os.path.join(ROOT, "frontend/modeling/cad/preview")
# 可编辑工程文件：用桌面 Blender 打开即可查看/修改同一套样区模型。
OUT_BLEND = os.path.join(ROOT, "frontend/modeling/cad/north-pool-sample.blend")

ORIGIN = (448800000.0, 4545350000.0)
ROT_DEG = -35.000106
CAD_PER_UNIT = 10000.0

# 样区包围盒（场景单位）
XMIN, XMAX = -6.0, 24.0
ZMIN, ZMAX = 34.0, 48.0

# 推定参数（CAD 未提供，显式标注）
ASSUMED = {
    "building_217737_height_m": 9.0,
    "building_FAC64_height_m": 12.0,
    "road_width_m": 12.0,
    "road_thickness_m": 0.3,
    "pool_depth_m": 5.0,
    "pool_wall_thickness_m": 0.8,
    "pool_rim_height_m": 9.0,
    "water_level_m": 5.5,
    "pipe_display_radius_m": 0.6,
    "pipe_display_elevation_m": 1.2,
}
UNIT_M = 10.0  # 1 场景单位 = 10 m

# 泵房立面规则（场景单位；CAD 只给平面轮廓，下列构造与分部标高均为表现推定值）。
# 规则按"勒脚 → 连续窗带 → 竖梃分格 → 檐口 → 角柱 → 入口雨棚"分层生成，
# 不引入 CAD 以外的平面尺寸，只在轮廓边线上做厚度与外挑。
FACADE = {
    "plinth_height": 0.09,      # 勒脚高 0.9 m
    "plinth_depth": 0.05,
    # 窗带按建筑表现高度取比例：9 m 泵房≈4.0–6.3 m，12 m 处理间≈5.3–8.4 m
    "window_sill_ratio": 0.44,
    "window_head_ratio": 0.70,
    "glass_depth": 0.02,
    "glass_inset": 0.01,
    "rail_depth": 0.055,        # 上下窗框外挑
    "rail_height": 0.035,
    "mullion_spacing_m": 3.0,   # 竖梃间距 3 m
    "mullion_width": 0.055,
    "corner_width": 0.09,
    "corner_depth": 0.045,
    "cornice_depth": 0.11,      # 檐口外挑 1.1 m
    "cornice_height": 0.07,
    "door_width_m": 2.6,
    "door_height": 0.32,
    "door_depth": 0.07,
    "door_top_rail": 0.05,
    "canopy_depth_m": 1.5,
    "canopy_z0": 0.345,
    "canopy_z1": 0.385,
    "canopy_pad_m": 1.2,
    "window_min_edge": 0.6,     # 短于 6 m 的边不开窗带
}

# 屋面规则（场景单位；CAD 无屋面构造，女儿墙与机组均为表现推定）。
ROOF_DETAILS = {
    "parapet_height": 0.10,     # 女儿墙高 1.0 m
    "parapet_thickness": 0.05,
    "cap_height": 0.03,
    "cap_overhang": 0.02,       # 压顶两侧各挑 0.2 m
    "unit_size": (0.30, 0.22, 0.14),  # 机组 3.0 × 2.2 × 1.4 m
    "unit_offsets": (-0.18, 0.18),    # 沿长边分两组
}

# 集水池细部规则（场景单位；CAD 只给池体轮廓，压顶/栏杆/爬梯/分缝均为表现推定）。
POOL_DETAILS = {
    "coping_overhang": 0.06,    # 压顶外挑 0.6 m
    "coping_inner": 0.05,       # 压顶压入池壁 0.5 m
    "coping_height": 0.035,     # 压顶厚 0.35 m
    "rail_height": 0.11,        # 栏杆高 1.1 m
    "rail_post_spacing_m": 2.0,
    "rail_bar": 0.014,
    "rail_inset": 0.022,
    "ladder_width_m": 0.5,
    "ladder_rung_spacing_m": 0.3,
    "joint_spacing_m": 6.0,     # 池壁分缝间距 6 m
    "joint_width": 0.018,
}


def to_scene(x, y):
    dx, dy = x - ORIGIN[0], y - ORIGIN[1]
    r = math.radians(ROT_DEG)
    c, s = math.cos(r), math.sin(r)
    return ((dx * c - dy * s) / CAD_PER_UNIT, (dx * s + dy * c) / CAD_PER_UNIT)


def load_features():
    with open(V7_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return {f["id"]: f for f in data["features"]}


def load_status():
    with open(V5_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return {r["id"]: r for r in data["records"]}


def scene_points(feature):
    return [to_scene(p[0], p[1]) for p in feature["pts"]]


def to_blender(points):
    """场景坐标 (x, z) → Blender (x, y)。glTF 导出后 z=-y，正好等于 Three.js 的 z=-sceneZ。"""
    return [(p[0], p[1]) for p in points]


def clip_segment(p0, p1):
    """Liang-Barsky 裁剪到样区包围盒。"""
    x0, y0 = p0
    x1, y1 = p1
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in (
        (-dx, x0 - XMIN), (dx, XMAX - x0),
        (-dy, y0 - ZMIN), (dy, ZMAX - y0),
    ):
        if p == 0:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return None
            if r > t0:
                t0 = r
        else:
            if r < t0:
                return None
            if r < t1:
                t1 = r
    return (x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy)


def clip_polyline(points):
    """裁剪折线，按连续段拆分，避免跨出包围盒后错误连线。"""
    parts, cur = [], []
    for a, b in zip(points, points[1:]):
        seg = clip_segment(a, b)
        if not seg:
            if len(cur) > 1:
                parts.append(cur)
            cur = []
            continue
        if not cur:
            cur = [seg[0]]
        cur.append(seg[1])
    if len(cur) > 1:
        parts.append(cur)
    return parts


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)


def material(name, color, roughness=0.8, metallic=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, alpha)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = (*color, alpha)
    mat.roughness = roughness
    mat.metallic = metallic
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            mat.blend_method = "BLEND"
        except AttributeError:
            mat.surface_render_method = "BLENDED"
    return mat


def new_object(name, bm, mat, props=None):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for key, value in (props or {}).items():
        obj[key] = value
    return obj


def bm_prism(pts, z0, z1):
    """按多边形挤出棱柱；pts 为 (x, y)。"""
    bm = bmesh.new()
    area = 0.0
    for i in range(len(pts) - 1):
        area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    ring = pts[:-1] if len(pts) > 2 and pts[0] == pts[-1] else pts
    if area < 0:
        ring = ring[::-1]
    bottom = [bm.verts.new((x, y, z0)) for x, y in ring]
    top = [bm.verts.new((x, y, z1)) for x, y in ring]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    n = len(ring)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bm.normal_update()
    return bm


def bm_box(x0, x1, y0, y1, z0, z1):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    return bm_prism(pts, z0, z1)


def bm_flat_quad(p0, p1, width, z):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return None
    nx, ny = -dy / length * width / 2, dx / length * width / 2
    bm = bmesh.new()
    vs = [
        bm.verts.new((p0[0] + nx, p0[1] + ny, z)),
        bm.verts.new((p1[0] + nx, p1[1] + ny, z)),
        bm.verts.new((p1[0] - nx, p1[1] - ny, z)),
        bm.verts.new((p0[0] - nx, p0[1] - ny, z)),
    ]
    bm.faces.new(vs)
    bm.normal_update()
    return bm


def edge_frame(a, b, center):
    """返回边长、沿边单位向量、朝外法线与边中点。"""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return None
    ux, uy = dx / length, dy / length
    nx, ny = uy, -ux
    mx, my = (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0
    if (mx - center[0]) * nx + (my - center[1]) * ny < 0:
        nx, ny = -nx, -ny
    return length, (ux, uy), (nx, ny), (mx, my)


def oriented_box(p0, p1, z0, z1, depth, offset, center):
    """沿墙边生成薄盒：offset 为距墙面的起始外挑，depth 为厚度。"""
    frame = edge_frame(p0, p1, center)
    if not frame:
        return None
    length, (ux, uy), (nx, ny), _ = frame

    def P(s, t):
        # s: 沿边 -1..1；t: 法向外挑距离
        return ((p0[0] + p1[0]) / 2.0 + ux * s * length / 2.0 + nx * t,
                (p0[1] + p1[1]) / 2.0 + uy * s * length / 2.0 + ny * t)

    ring = [P(-1, offset), P(1, offset), P(1, offset + depth),
            P(-1, offset + depth), P(-1, offset)]
    return bm_prism(ring, z0, z1)


def local_box(cx, cy, ux, uy, w, d, z0, z1):
    """以 (ux,uy) 为长轴、在 (cx,cy) 处生成水平盒体。"""
    nx, ny = -uy, ux
    pts = [
        (cx - ux * w / 2 - nx * d / 2, cy - uy * w / 2 - ny * d / 2),
        (cx + ux * w / 2 - nx * d / 2, cy + uy * w / 2 - ny * d / 2),
        (cx + ux * w / 2 + nx * d / 2, cy + uy * w / 2 + ny * d / 2),
        (cx - ux * w / 2 + nx * d / 2, cy - uy * w / 2 + ny * d / 2),
    ]
    return bm_prism(pts + [pts[0]], z0, z1)


def bm_append(dst, src):
    """把 src 几何并入 dst：立面构件按材质合并，避免几十个细碎节点。"""
    vmap = {}
    for v in src.verts:
        vmap[v] = dst.verts.new(v.co)
    for face in src.faces:
        try:
            dst.faces.new([vmap[v] for v in face.verts])
        except ValueError:
            pass
    dst.normal_update()
    src.free()


def add_facade(ring, height, handle, mats, objects):
    """按立面规则生成勒脚、窗带、窗框/竖梃、檐口、角柱与入口雨棚。

    仅使用 CAD 平面轮廓的边线，立面构造尺寸取自 FACADE（推定值）。
    各构件按材质合并成一个网格，保留 5 个可拾取对象。
    """
    ring = ring[:-1] if len(ring) > 2 and ring[0] == ring[-1] else ring
    n = len(ring)
    if n < 3:
        return
    cx = sum(p[0] for p in ring) / n
    cy = sum(p[1] for p in ring) / n
    center = (cx, cy)
    f = FACADE
    sill = height * f["window_sill_ratio"]
    head = height * f["window_head_ratio"]
    edges = [(ring[i], ring[(i + 1) % n]) for i in range(n)]
    frames = [edge_frame(a, b, center) for a, b in edges]

    buckets = {"plinth": "plinth", "glass": "glass", "frame": "frame",
               "door": "door", "canopy": "roof", "step": "coping"}
    bms = {key: bmesh.new() for key in buckets}
    counts = {key: 0 for key in buckets}

    def emit(key, bm):
        if bm is None:
            return
        bm_append(bms[key], bm)
        counts[key] += 1

    door_edge = min(range(n), key=lambda i: frames[i][2][1])  # 最朝南的边
    door_w = f["door_width_m"] / UNIT_M

    for i, frame in enumerate(frames):
        a, b = edges[i]
        length, (ux, uy), _, _ = frame

        # 勒脚
        emit("plinth", oriented_box(a, b, 0.0, f["plinth_height"],
                                    f["plinth_depth"], 0.0, center))

        # 连续窗带：玻璃 + 上下窗框 + 竖梃
        if length >= f["window_min_edge"]:
            emit("glass", oriented_box(a, b, sill, head, f["glass_depth"],
                                       f["glass_inset"], center))
            emit("frame", oriented_box(a, b, sill - f["rail_height"], sill,
                                       f["rail_depth"], 0.0, center))
            emit("frame", oriented_box(a, b, head, head + f["rail_height"],
                                       f["rail_depth"], 0.0, center))
            bays = max(1, int(round(length * UNIT_M / f["mullion_spacing_m"])))
            half = f["mullion_width"] / 2.0
            for k in range(bays + 1):
                t = k / bays
                px = a[0] + (b[0] - a[0]) * t
                py = a[1] + (b[1] - a[1]) * t
                q0 = (px - ux * half, py - uy * half)
                q1 = (px + ux * half, py + uy * half)
                emit("frame", oriented_box(q0, q1, sill, head,
                                           f["rail_depth"], 0.0, center))

        # 檐口
        emit("frame", oriented_box(a, b, height, height + f["cornice_height"],
                                   f["cornice_depth"], 0.0, center))

        # 角柱：每条边的起点侧，四面合成四个转角
        q1 = (a[0] + ux * f["corner_width"], a[1] + uy * f["corner_width"])
        emit("frame", oriented_box(a, q1, f["plinth_height"], height,
                                   f["corner_depth"], 0.0, center))

    # 落水管：四个转角从勒脚到檐口，沿外法线合方向略离开墙面
    for i in range(n):
        prev_n = frames[i - 1][2]
        cur_n = frames[i][2]
        dxn, dyn = prev_n[0] + cur_n[0], prev_n[1] + cur_n[1]
        dl = math.hypot(dxn, dyn) or 1.0
        px = ring[i][0] + dxn / dl * .05
        py = ring[i][1] + dyn / dl * .05
        emit("frame", bm_box(px - .018, px + .018, py - .018, py + .018,
                             f["plinth_height"], height))

    # 入口：最朝南的边居中布置门扇 + 门楣 + 雨棚 + 两级踏步
    length, (ux, uy), _, (mx, my) = frames[door_edge]
    half = min(length, door_w) / 2.0
    q0 = (mx - ux * half, my - uy * half)
    q1 = (mx + ux * half, my + uy * half)
    emit("door", oriented_box(q0, q1, 0.0, f["door_height"],
                              f["door_depth"], 0.0, center))
    emit("frame", oriented_box(q0, q1, f["door_height"],
                               f["door_height"] + f["door_top_rail"],
                               f["rail_depth"], 0.0, center))
    pad = f["canopy_pad_m"] / UNIT_M / 2.0
    c0 = (mx - ux * (half + pad), my - uy * (half + pad))
    c1 = (mx + ux * (half + pad), my + uy * (half + pad))
    emit("canopy", oriented_box(c0, c1, f["canopy_z0"], f["canopy_z1"],
                                f["canopy_depth_m"] / UNIT_M, 0.0, center))

    # 两级混凝土踏步：下宽上窄，把入口从地面抬到门坎
    step_w = min(length, door_w + f["canopy_pad_m"] / UNIT_M)
    s0 = (mx - ux * step_w / 2, my - uy * step_w / 2)
    s1 = (mx + ux * step_w / 2, my + uy * step_w / 2)
    for k, reach in enumerate((.22, .11)):
        emit("step", oriented_box(s0, s1, .03 * k, .03 * (k + 1), reach, 0.0, center))

    for key, mat_key in buckets.items():
        bm = bms[key]
        if not bm.faces:
            bm.free()
            continue
        objects.append(new_object(
            "facade_%s_%s" % (handle, key), bm, mats[mat_key],
            {"kind": "facade_" + key, "part": "facade",
             "source_handle": handle, "facade_source": "assumed"}))

    print("FACADE", handle, height, counts)


def add_roof_details(ring, roof_top, handle, mats, objects):
    """屋面规则：女儿墙 + 压顶 + 两台屋面机组。

    屋面在总览机位占比大，抬高边缘并加少量设备可让体量从空中可读；
    机组数量与尺寸为表现推定值。
    """
    ring = ring[:-1] if len(ring) > 2 and ring[0] == ring[-1] else ring
    n = len(ring)
    if n < 3:
        return
    cx = sum(p[0] for p in ring) / n
    cy = sum(p[1] for p in ring) / n
    center = (cx, cy)
    f = ROOF_DETAILS
    t, ch, co = f["parapet_thickness"], f["parapet_height"], f["cap_overhang"]
    edges = [(ring[i], ring[(i + 1) % n]) for i in range(n)]

    parapet, cap, units = bmesh.new(), bmesh.new(), bmesh.new()
    for a, b in edges:
        bm_append(parapet, oriented_box(a, b, roof_top, roof_top + ch, t, -t, center))
        bm_append(cap, oriented_box(a, b, roof_top + ch, roof_top + ch + f["cap_height"],
                                    t + 2 * co, -t - co, center))

    # 机组沿最长边分两组，避开正中逗留区；高度按屋面设备常规尺度推定。
    li = max(range(n), key=lambda i: math.hypot(edges[i][1][0] - edges[i][0][0],
                                                edges[i][1][1] - edges[i][0][1]))
    a, b = edges[li]
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    nx, ny = uy, -ux
    uw, ud, uh = f["unit_size"]
    for off in f["unit_offsets"]:
        px = cx + ux * length * off + nx * length * .09
        py = cy + uy * length * off + ny * length * .09
        bm_append(units, local_box(px, py, ux, uy, uw, ud, roof_top + .005, roof_top + .005 + uh))

    base = {"part": "roof_detail", "source_handle": handle, "facade_source": "assumed"}
    objects.append(new_object("roof_%s_parapet" % handle, parapet, mats["coping"],
                              {**base, "kind": "roof_parapet"}))
    objects.append(new_object("roof_%s_cap" % handle, cap, mats["coping"],
                              {**base, "kind": "roof_parapet"}))
    objects.append(new_object("roof_%s_units" % handle, units, mats["frame"],
                              {**base, "kind": "roof_unit"}))


def add_pool_details(x0, x1, y0, y1, t, depth, rim, mats, objects, handle="2E14C4"):
    """集水池细部：压顶、池顶栏杆、检修爬梯与池壁分缝。

    平面尺寸完全取自 CAD 池体轮廓；压顶、栏杆、爬梯只做沿壁附着，
    高度与构造尺寸为表现推定值。
    """
    f = POOL_DETAILS
    co, ci = f["coping_overhang"], f["coping_inner"]
    ch = f["coping_height"]
    bar = f["rail_bar"]
    ox0, ox1, oy0, oy1 = x0 - t, x1 + t, y0 - t, y1 + t
    top = rim + ch
    base = {"part": "pool_detail", "source_handle": handle, "facade_source": "assumed"}

    # 压顶：沿池壁顶面外挑，四块拼成闭合环
    coping = bmesh.new()
    for box in (
        (ox0 - co, ox1 + co, oy0 - co, oy0 + ci),
        (ox0 - co, ox1 + co, oy1 - ci, oy1 + co),
        (ox0 - co, ox0 + ci, oy0 + ci, oy1 - ci),
        (ox1 - ci, ox1 + co, oy0 + ci, oy1 - ci),
    ):
        bm_append(coping, bm_box(*box, rim, top))
    objects.append(new_object("pool_%s_coping" % handle, coping, mats["coping"],
                              {**base, "kind": "pool_coping"}))

    # 栏杆：立柱 + 上下两道横杆，沿压顶外缘闭合
    i = f["rail_inset"]
    rx0, rx1, ry0, ry1 = ox0 + i, ox1 - i, oy0 + i, oy1 - i
    rail = bmesh.new()
    z1 = top + f["rail_height"]
    sides = ((rx0, ry0, rx1, ry0), (rx1, ry0, rx1, ry1),
             (rx1, ry1, rx0, ry1), (rx0, ry1, rx0, ry0))
    for ax, ay, bx, by in sides:
        length = math.hypot(bx - ax, by - ay)
        n = max(1, int(round(length / (f["rail_post_spacing_m"] / UNIT_M))))
        for k in range(n):
            px = ax + (bx - ax) * k / n
            py = ay + (by - ay) * k / n
            bm_append(rail, bm_box(px - bar / 2, px + bar / 2,
                                   py - bar / 2, py + bar / 2, top, z1))
        for zz in (z1 - bar, top + f["rail_height"] * .55):
            if abs(bx - ax) > abs(by - ay):
                bm_append(rail, bm_box(min(ax, bx), max(ax, bx),
                                       ay - bar / 2, ay + bar / 2, zz, zz + bar))
            else:
                bm_append(rail, bm_box(ax - bar / 2, ax + bar / 2,
                                       min(ay, by), max(ay, by), zz, zz + bar))
    objects.append(new_object("pool_%s_rail" % handle, rail, mats["rail"],
                              {**base, "kind": "pool_rail"}))

    # 检修爬梯：南侧内壁，两根立杆 + 等距踏步
    ladder = bmesh.new()
    lx = (x0 + x1) / 2.0
    lw = f["ladder_width_m"] / UNIT_M
    ly = y0 + 0.02
    for sx in (lx - lw / 2, lx + lw / 2):
        bm_append(ladder, bm_box(sx - bar / 2, sx + bar / 2, ly, ly + 0.02,
                                 -depth + 0.03, top))
    step = f["ladder_rung_spacing_m"] / UNIT_M
    z = -depth + 0.08
    while z < top - 0.03:
        bm_append(ladder, bm_box(lx - lw / 2, lx + lw / 2, ly, ly + 0.026, z, z + 0.012))
        z += step
    objects.append(new_object("pool_%s_ladder" % handle, ladder, mats["rail"],
                              {**base, "kind": "pool_rail"}))

    # 池壁分缝：外壁按 6 m 一道竖缝，弱化整片混凝土的空白感
    joint = bmesh.new()
    js = f["joint_spacing_m"] / UNIT_M
    jw = f["joint_width"]

    def seams(fixed, a, b, axis, outward):
        n = max(1, int(round((b - a) / js)))
        lo, hi = ((fixed - 0.008, fixed + 0.002) if outward < 0
                  else (fixed - 0.002, fixed + 0.008))
        for k in range(1, n):
            p = a + (b - a) * k / n
            if axis == "x":
                bm_append(joint, bm_box(p - jw / 2, p + jw / 2, lo, hi, 0.02, rim - 0.01))
            else:
                bm_append(joint, bm_box(lo, hi, p - jw / 2, p + jw / 2, 0.02, rim - 0.01))

    seams(oy0, ox0, ox1, "x", -1)
    seams(oy1, ox0, ox1, "x", 1)
    seams(ox0, oy0, oy1, "y", -1)
    seams(ox1, oy0, oy1, "y", 1)
    objects.append(new_object("pool_%s_joints" % handle, joint, mats["joint"],
                              {**base, "kind": "pool_joint"}))


def add_cylinder(p0, p1, radius, z, mat, name):
    x0, y0 = p0
    x1, y1 = p1
    length = math.hypot(x1 - x0, y1 - y0)
    if length < 1e-9:
        return None
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=length,
                                        location=((x0 + x1) / 2, (y0 + y1) / 2, z))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    direction = mathutils.Vector((x1 - x0, y1 - y0, 0.0))
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return obj


def build():
    feats = load_features()
    status = load_status()
    reset_scene()

    mat_ground = material("ground_concrete", (0.74, 0.76, 0.74), 0.95)
    mat_wall = material("building_wall", (0.82, 0.84, 0.85), 0.75)
    mat_roof = material("building_roof", (0.55, 0.61, 0.65), 0.6, 0.1)
    mat_road = material("asphalt_road", (0.42, 0.45, 0.47), 0.95)
    mat_pool = material("pool_concrete", (0.78, 0.79, 0.77), 0.85)
    mat_water = material("pool_water", (0.14, 0.55, 0.68), 0.25, 0.0, 0.82)
    mat_pipe = material("pipe_fire", (0.85, 0.36, 0.32), 0.5, 0.3)
    mat_pipe_rain = material("pipe_rain", (0.2, 0.56, 0.72), 0.5, 0.3)
    # 立面分层材质：勒脚压暗、玻璃冷灰蓝、框料深色金属、门扇深青灰。
    mat_plinth = material("facade_plinth", (0.40, 0.42, 0.42), 0.9)
    mat_glass = material("facade_glass", (0.24, 0.40, 0.46), 0.16, 0.25)
    mat_frame = material("facade_frame", (0.19, 0.22, 0.24), 0.55, 0.45)
    mat_door = material("facade_door", (0.26, 0.33, 0.35), 0.6, 0.25)
    facade_mats = {"plinth": mat_plinth, "glass": mat_glass,
                   "frame": mat_frame, "door": mat_door, "roof": mat_roof}
    # 池体细部：压顶浅色混凝土、栏杆镀锌钢、分缝压暗。
    mat_coping = material("pool_coping", (0.86, 0.87, 0.84), 0.82)
    mat_rail = material("pool_rail", (0.55, 0.59, 0.60), 0.42, 0.45)
    mat_joint = material("pool_joint", (0.50, 0.52, 0.50), 0.92)
    pool_mats = {"coping": mat_coping, "rail": mat_rail, "joint": mat_joint}
    # 立面踏步与屋面压顶复用浅色混凝土。
    facade_mats["coping"] = mat_coping

    objects = []

    # 地面（避开集水池开洞，保证池内水面可见）
    pool_pts_tmp = to_blender(scene_points(feats["2E14C4"]))
    _px = [p[0] for p in pool_pts_tmp]
    _py = [p[1] for p in pool_pts_tmp]
    _t = ASSUMED["pool_wall_thickness_m"] / UNIT_M
    hx0, hx1 = min(_px) - _t, max(_px) + _t
    hy0, hy1 = min(_py) - _t, max(_py) + _t
    gx0, gx1, gy0, gy1 = XMIN, XMAX, ZMIN, ZMAX
    for name, box in (
        ("ground_s", (gx0, gx1, gy0, hy0)),
        ("ground_n", (gx0, gx1, hy1, gy1)),
        ("ground_w", (gx0, hx0, hy0, hy1)),
        ("ground_e", (hx1, gx1, hy0, hy1)),
    ):
        objects.append(new_object(name, bm_box(*box, -0.12, 0.0), mat_ground, {"kind": "ground"}))

    # 建筑
    for hid, height_key, roof_over in (("217737", "building_217737_height_m", 0.08),
                                       ("FAC64", "building_FAC64_height_m", 0.08)):
        pts = to_blender(scene_points(feats[hid]))
        h = ASSUMED[height_key] / UNIT_M
        props = {
            "kind": "building",
            "source_handle": hid,
            "source_layer": feats[hid]["layer"],
            "height_m": ASSUMED[height_key],
            "height_source": "assumed",
        }
        objects.append(new_object("building_" + hid, bm_prism(pts, 0.0, h), mat_wall, props))
        # 屋面板
        cx = sum(p[0] for p in pts[:-1]) / (len(pts) - 1)
        cy = sum(p[1] for p in pts[:-1]) / (len(pts) - 1)
        roof_pts = [(cx + (x - cx) * 1.04, cy + (y - cy) * 1.04) for x, y in pts]
        objects.append(new_object("roof_" + hid, bm_prism(roof_pts, h, h + roof_over),
                                  mat_roof, {"kind": "roof", "source_handle": hid}))
        # 两栋单体共用同一套立面规则，窗带按各自高度取比例。
        add_facade(pts, h, hid, facade_mats, objects)
        add_roof_details(roof_pts, h + roof_over, hid, facade_mats, objects)

    # 集水池
    pool = feats["2E14C4"]
    pts = to_blender(scene_points(pool))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    t = ASSUMED["pool_wall_thickness_m"] / UNIT_M
    depth = ASSUMED["pool_depth_m"] / UNIT_M
    rim = ASSUMED["pool_rim_height_m"] / UNIT_M
    for name, box in (
        ("pool_wall_s", (x0 - t, x1 + t, y0 - t, y0)),
        ("pool_wall_n", (x0 - t, x1 + t, y1, y1 + t)),
        ("pool_wall_w", (x0 - t, x0, y0, y1)),
        ("pool_wall_e", (x1, x1 + t, y0, y1)),
    ):
        objects.append(new_object(name, bm_box(*box, -depth, rim), mat_pool,
                                  {"kind": "pool_wall", "source_handle": "2E14C4"}))
    objects.append(new_object("pool_floor", bm_box(x0, x1, y0, y1, -depth - 0.1, -depth),
                              mat_pool, {"kind": "pool_floor", "source_handle": "2E14C4"}))
    water_z = ASSUMED["water_level_m"] / UNIT_M
    objects.append(new_object("pool_water",
                              bm_prism([(x0 + 0.03, y0 + 0.03), (x1 - 0.03, y0 + 0.03),
                                        (x1 - 0.03, y1 - 0.03), (x0 + 0.03, y1 - 0.03),
                                        (x0 + 0.03, y0 + 0.03)], water_z - 0.01, water_z),
                              mat_water, {"kind": "water", "source_handle": "2E14C4"}))
    add_pool_details(x0, x1, y0, y1, t, depth, rim, pool_mats, objects)

    # 道路（北侧东西向 + 东侧南北向）
    road_w = ASSUMED["road_width_m"] / UNIT_M
    for hid in ("CF248", "109442"):
        for part_idx, part in enumerate(clip_polyline(scene_points(feats[hid]))):
            line = to_blender(part)
            for i in range(len(line) - 1):
                bm = bm_flat_quad(line[i], line[i + 1], road_w, 0.02)
                if bm:
                    objects.append(new_object("road_%s_%d_%d" % (hid, part_idx, i), bm, mat_road,
                                              {"kind": "road", "source_handle": hid,
                                               "width_m": ASSUMED["road_width_m"],
                                               "width_source": "assumed"}))

    # 管道（按 V5 状态过滤）
    pipe_specs = (("139728", mat_pipe), ("337658", mat_pipe_rain), ("1AFB8C", mat_pipe_rain))
    radius = ASSUMED["pipe_display_radius_m"] / UNIT_M
    pz = ASSUMED["pipe_display_elevation_m"] / UNIT_M
    for hid, mat in pipe_specs:
        rec = status.get(hid, {})
        for part_idx, part in enumerate(clip_polyline(scene_points(feats[hid]))):
            line = to_blender(part)
            for i in range(len(line) - 1):
                obj = add_cylinder(line[i], line[i + 1], radius, pz, mat,
                                   "pipe_%s_%d_%d" % (hid, part_idx, i))
                if obj:
                    obj["kind"] = "pipe"
                    obj["source_handle"] = hid
                    obj["source_layer"] = feats[hid]["layer"]
                    obj["v5_status"] = rec.get("status", "unknown")
                    obj["radius_m"] = ASSUMED["pipe_display_radius_m"]
                    obj["radius_source"] = "display_exaggerated"
                    objects.append(obj)

    return objects


def setup_camera_and_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.93, 0.95, 0.96)
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.film_transparent = False

    cam_data = bpy.data.cameras.new("preview_cam")
    cam = bpy.data.objects.new("preview_cam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"

    cx, cy = (XMIN + XMAX) / 2, (ZMIN + ZMAX) / 2

    # 斜视
    cam.data.ortho_scale = 38
    cam.location = (cx + 22, cy - 26, 22)
    direction = (cx - cam.location.x, cy - cam.location.y, 0 - cam.location.z)
    import mathutils
    cam.rotation_euler = mathutils.Vector(direction).to_track_quat("-Z", "Y").to_euler()
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene.render.filepath = os.path.join(PREVIEW_DIR, "north-pool-sample-persp.png")
    bpy.ops.render.render(write_still=True)

    # 俯视：+Y 为北向，画面自动北向朝上、X 不镜像
    cam.data.ortho_scale = 34
    cam.location = (cx, cy, 40)
    cam.rotation_euler = (0, 0, 0)
    scene.render.filepath = os.path.join(PREVIEW_DIR, "north-pool-sample-top.png")
    bpy.ops.render.render(write_still=True)

    # 单体立面近景：检查勒脚、窗带、竖梃、檐口与入口雨棚
    feats = load_features()
    for hid, filename in (("217737", "north-pool-sample-facade.png"),
                          ("FAC64", "north-pool-sample-facade-fac64.png")):
        bpts = to_blender(scene_points(feats[hid]))
        bx = sum(p[0] for p in bpts[:-1]) / (len(bpts) - 1)
        by = sum(p[1] for p in bpts[:-1]) / (len(bpts) - 1)
        cam.data.ortho_scale = 11
        cam.location = (bx + 7.5, by - 10.5, 6.2)
        direction = (bx - cam.location.x, by - cam.location.y, 0.55 - cam.location.z)
        cam.rotation_euler = mathutils.Vector(direction).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW_DIR, filename)
        bpy.ops.render.render(write_still=True)

    # 集水池近景：检查压顶、栏杆、爬梯与池壁分缝
    ppts = to_blender(scene_points(feats["2E14C4"]))
    px = sum(p[0] for p in ppts[:-1]) / (len(ppts) - 1)
    py = sum(p[1] for p in ppts[:-1]) / (len(ppts) - 1)
    cam.data.ortho_scale = 11
    cam.location = (px + 8.0, py - 11.0, 7.0)
    direction = (px - cam.location.x, py - cam.location.y, 0.90 - cam.location.z)
    cam.rotation_euler = mathutils.Vector(direction).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(PREVIEW_DIR, "north-pool-sample-pool.png")
    bpy.ops.render.render(write_still=True)


def export_glb():
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )


def write_manifest(objects):
    feats = load_features()
    status = load_status()

    def centroid(pts):
        ring = pts[:-1] if pts[0] == pts[-1] else pts
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))

    pool_c = centroid(scene_points(feats["2E14C4"]))
    b217_c = centroid(scene_points(feats["217737"]))
    manifest = {
        "schema": "tanggang-cad-sample-v2",
        "source": {
            "v7": V7_PATH,
            "v5": V5_PATH,
            "transform": {"originCADXY": ORIGIN, "rotationDeg": ROT_DEG,
                          "cadPerSceneUnit": CAD_PER_UNIT},
        },
        "bboxSceneXZ": [XMIN, ZMIN, XMAX, ZMAX],
        "unit": {"scene_unit_m": UNIT_M},
        "assumed": ASSUMED,
        "facade": {
            "source_handles": ["217737", "FAC64"],
            "source": "assumed",
            "note": "立面仅沿 CAD 平面轮廓边线生成；窗带按建筑表现高度取 0.44–0.70，"
                    "勒脚、檐口、门窗与竖梃间距为表现推定值",
            "rules": FACADE,
        },
        "roof_details": {
            "source_handles": ["217737", "FAC64"],
            "source": "assumed",
            "note": "女儿墙、压顶与屋面机组数量/尺寸为表现推定值，平面轮廓来自 CAD",
            "rules": ROOF_DETAILS,
        },
        "pool_details": {
            "source_handle": "2E14C4",
            "source": "assumed",
            "note": "压顶、栏杆、爬梯与池壁分缝沿 CAD 池体轮廓附着，构造尺寸为表现推定值",
            "rules": POOL_DETAILS,
        },
        "objects": [
            {"name": o.name, "kind": o.get("kind", ""),
             "handle": o.get("source_handle", ""), "layer": o.get("source_layer", ""),
             "v5_status": o.get("v5_status", "")}
            for o in objects
        ],
        "validation": {
            "pool_centroid_scene": [round(pool_c[0], 3), round(pool_c[1], 3)],
            "building_217737_centroid_scene": [round(b217_c[0], 3), round(b217_c[1], 3)],
            "facade_faces": {o.name: len(o.data.polygons) for o in objects
                             if str(o.get("kind", "")).startswith("facade_")},
            "pool_detail_faces": {o.name: len(o.data.polygons) for o in objects
                                  if o.get("kind") in ("pool_coping", "pool_rail", "pool_joint")},
            "roof_detail_faces": {o.name: len(o.data.polygons) for o in objects
                                  if o.get("kind") in ("roof_parapet", "roof_unit")},
            "pipes": {hid: status.get(hid, {}).get("status", "unknown")
                      for hid in ("139728", "337658", "1AFB8C")},
        },
    }
    with open(OUT_MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return manifest


def save_blend():
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)


def main():
    objects = build()
    setup_camera_and_render()
    export_glb()
    manifest = write_manifest(objects)
    save_blend()
    print("SAMPLE_OBJECTS", len(objects))
    print("SAMPLE_GLB", OUT_GLB, os.path.getsize(OUT_GLB))
    print("SAMPLE_VALIDATION", json.dumps(manifest["validation"], ensure_ascii=False))


if __name__ == "__main__":
    main()
