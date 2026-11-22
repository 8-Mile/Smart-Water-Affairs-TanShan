"""唐港 5190 港机精修：靠泊散货船 + 堆取料机（Blender 后台可复现脚本）。

用法：
  "/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup -t 2 \
    --python-exit-code 1 --python refine_port.py -- <out_dir>

输出：
  <out_dir>/bulk-carrier.glb、stacker-reclaimer.glb、refine_port.blend

约定：
- 原点在模型基底中心；Blender Z 向上，导出 glTF 时转为 Y 向上。
- 船：X 为船长（−10..+10），Y 为船宽，水线在 z≈0，甲板 z=1.02。
  前端按 `scale = shipLength/20` 落位并沿泊位方向旋转，故船长保持 20。
- 堆取料机：基座沿 Y 向（对应 three 的 Z，即堆场走向），桁架臂沿 +X 伸向堆体。
  形体为 L1 表现，不代表实测构造与机型参数。
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
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def box(name, size, loc, material, parts):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    parts.append(o)
    return o


def rbox(name, size, loc, rot, material, parts):
    """Rotated box; rot in radians (x,y,z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    parts.append(o)
    return o


def beam(name, a, b, thickness, material, parts):
    """Box spanning point a to b in the XZ plane (Y fixed at a[1])."""
    ax, ay, az = a
    bx, by, bz = b
    dx, dz = bx - ax, bz - az
    length = math.hypot(dx, dz)
    cx, cz = (ax + bx) / 2, (az + bz) / 2
    ang = math.atan2(dz, dx)
    return rbox(name, (length, thickness[1], thickness[0]), (cx, ay, cz),
                (0, -ang, 0), material, parts)


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


# ------------------------------------------------------------------ materials
C_HULL = (0.15, 0.048, 0.038)    # 深赭红船壳
C_RED = (0.34, 0.06, 0.045)      # 水线红带
C_DECK = (0.55, 0.54, 0.49)      # 甲板走道
C_HATCH = (0.13, 0.085, 0.062)   # 舱盖深褐
C_WHITE = (0.88, 0.87, 0.83)     # 上建白
C_GLASS = (0.07, 0.10, 0.12)     # 深色窗带
C_ORANGE = (0.72, 0.34, 0.10)
C_STEEL = (0.20, 0.23, 0.25)


def hull_halfwidth(x):
    """Plan half-width of the hull at station x (-10 stern .. +10 bow)."""
    if x < -9.55:
        return 1.42
    if x < 6.0:
        return 1.70
    if x < 9.4:
        t = (x - 6.0) / 3.4
        return 1.70 * (1 - 0.85 * t * t)
    t = (x - 9.4) / 0.6
    return 0.34 * (1 - t) ** 0.7


def build_hull(mats, parts):
    deck_z, bot_z = 1.02, -0.92
    stations = [-10.0, -9.55, -7.0, -4.0, -1.0, 2.0, 5.4, 6.8, 8.1, 9.1, 9.6, 10.0]
    verts, faces = [], []
    n = len(stations)
    # top ring (deck edge), zero-index 0..n-1
    for x in stations:
        hw = hull_halfwidth(x)
        verts.append((x, hw, deck_z)); verts.append((x, -hw, deck_z))
    # bottom ring, inset for bilge and shorter at bow
    for x in stations:
        hw = hull_halfwidth(x) * 0.72
        inset = 0.0
        if x > 9.1:
            inset = 0.22
        verts.append((x - inset, hw, bot_z)); verts.append((x - inset, -hw, bot_z))
    T = 0
    B = 2 * n

    def quad(i, j, k, l):
        faces.append((i, j, k, l))

    # side walls + bottom + transom + stem
    for i in range(n - 1):
        t0, t1 = T + 2 * i, T + 2 * (i + 1)
        b0, b1 = B + 2 * i, B + 2 * (i + 1)
        # starboard (+Y)
        quad(t0, t1, b1, b0)
        # port (-Y)
        quad(t0 + 1, b0 + 1, b1 + 1, t1 + 1)
        # bottom
        quad(b0, b1, b1 + 1, b0 + 1)
        # deck (normal up): reverse winding
        quad(t1, t0, t0 + 1, t1 + 1)
    # stern transom
    quad(T, B, B + 1, T + 1)
    # bow tip
    quad(T + 2 * (n - 1) + 1, B + 2 * (n - 1) + 1, B + 2 * (n - 1), T + 2 * (n - 1))
    me = bpy.data.meshes.new('HullMesh')
    bow_top = T + 2 * (n - 1)
    bow_bottom = B + 2 * (n - 1)
    merged = {bow_top + 1: bow_top, bow_bottom + 1: bow_bottom}
    used = [i for i in range(len(verts)) if i not in merged]
    order = {i: j for j, i in enumerate(used)}
    clean = []
    for face in faces:
        mapped = tuple(dict.fromkeys(order[merged.get(i, i)] for i in face))
        if len(mapped) >= 3:
            clean.append(mapped)
    me.from_pydata([verts[i] for i in used], [], clean)
    me.validate()
    me.update()
    o = bpy.data.objects.new('Hull', me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mats['hull'])
    parts.append(o)
    return o


def build_ship():
    reset()
    hull = mat('hull-navy', C_HULL, 0.62, 0.08)
    red = mat('hull-red', C_RED, 0.66, 0.05)
    deck = mat('deck-grey', C_DECK, 0.85, 0.02)
    hatch = mat('hatch-blue', C_HATCH, 0.82, 0.02)
    coaming = mat('hatch-coaming', (0.62, 0.62, 0.58), 0.70, 0.12)
    white = mat('super-white', C_WHITE, 0.55, 0.05)
    glass = mat('bridge-glass', C_GLASS, 0.25, 0.15)
    orange = mat('accent-orange', C_ORANGE, 0.5, 0.2)
    steel = mat('steel-dark', C_STEEL, 0.6, 0.3)
    mats = {'hull': hull}
    P = []
    build_hull(mats, P)
    # deck walking surface over the parallel body; the tapered bow keeps the hull's
    # own deck so the stem reads as pointed instead of square.
    box('deck', (15.3, 3.18, 0.04), (-1.55, 0, 1.04), deck, P)
    # bulwark ring + dark top rail: the ship reads as a loaded bulker, not a raft.
    for sy in (1, -1):
        box('bulwark', (15.5, 0.10, 0.34), (-1.65, sy * 1.66, 1.21), hull, P)
        box('rail', (15.5, 0.14, 0.07), (-1.65, sy * 1.66, 1.41), steel, P)
        # 水线红带：沿平行船体两侧贴一条窄红带，远景能读出吃水线。
        box('boot-top', (15.4, 0.05, 0.30), (-1.7, sy * 1.71, 0.12), red, P)
    box('bulwark-stern', (0.10, 3.36, 0.34), (-9.9, 0, 1.21), hull, P)
    box('rail-stern', (0.14, 3.40, 0.07), (-9.9, 0, 1.41), steel, P)
    # 6 hatch coamings + dark covers over the parallel body (loaded bulker layout).
    for i in range(6):
        hx = -6.25 + i * 2.10
        box('coaming%d' % i, (1.92, 3.04, 0.16), (hx, 0, 1.13), coaming, P)
        box('cover%d' % i, (1.80, 2.92, 0.10), (hx, 0, 1.24), hatch, P)
        box('cover-rib%d' % i, (1.80, 0.12, 0.05), (hx, 0, 1.30), steel, P)
        for sy in (1, -1):
            box('cover-seam%d_%d' % (i, sy), (1.80, 0.05, 0.05), (hx, sy * 0.98, 1.29), steel, P)
    # 甲板系缆桩：沿岸侧成对布置，近景读得出是泊位而非漂浮板。
    for i in range(7):
        bx = -8.4 + i * 2.2
        for sy in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.075, depth=0.20,
                location=(bx, sy * 1.50, 1.28))
            bollard = bpy.context.object
            bollard.name = 'bollard'
            bollard.data.materials.append(steel)
            P.append(bollard)
    # foredeck at bow: raised breakwater + windlass + mast (inside the taper)
    box('foredeck', (2.3, 2.55, 0.10), (7.0, 0, 1.20), white, P)
    box('breakwater', (0.10, 2.35, 0.36), (6.15, 0, 1.40), white, P)
    box('windlass', (0.7, 1.3, 0.30), (7.3, 0, 1.34), steel, P)
    box('foremast', (0.10, 0.10, 1.15), (8.1, 0, 1.95), white, P)
    # stern deckhouse: 3 stepped tiers with dark window bands, larger than before.
    tiers = [
        (2.85, 2.70, 0.92, 1.50),
        (2.45, 2.35, 0.78, 2.35),
        (3.55, 1.75, 0.72, 3.10),
    ]
    for i, (w, d, h, zc) in enumerate(tiers):
        box('house%d' % i, (w, d, h), (-8.45, 0, zc), white, P)
        box('house-band%d' % i, (w + 0.04, d + 0.04, 0.20), (-8.45, 0, zc + h * 0.18), glass, P)
    # bridge wings + funnel + mast
    box('bridge-wing', (0.55, 3.85, 0.12), (-8.45, 0, 3.20), white, P)
    box('funnel', (0.46, 0.46, 0.70), (-8.75, 0, 3.78), orange, P)
    box('funnel-cap', (0.50, 0.50, 0.10), (-8.75, 0, 4.18), steel, P)
    box('radar-mast', (0.07, 0.07, 0.62), (-8.45, 0.0, 4.02), white, P)
    # small deck crane between holds (accent)
    box('crane-post', (0.16, 0.16, 0.9), (-2.0, 1.2, 1.6), orange, P)
    rbox('crane-jib', (1.4, 0.12, 0.12), (-1.3, 1.2, 2.0), (0, 0.5, 0), orange, P)
    o = join(P, 'BulkCarrier')
    o.location = (0, 0, 0)
    return o


# ------------------------------------------------------------- stacker-reclaimer
def build_stacker():
    """门式堆取料机：跨堆布置，两条走行底盘落在堆间检修带，桥架横跨堆顶。

    参考图中机械沿东西向横跨堆列、支腿落在堆间通道，故不做回转式独腿造型。
    """
    reset()
    orange = mat('stacker-orange', (.60, .205, .044), .58, .2)
    oxide = mat('stacker-orange-dark', (.32, .095, .028), .66, .17)
    rubber = mat('stacker-dark', (.047, .06, .073), .80, .12)
    steel = mat('stacker-steel', (.20, .24, .26), .56, .35)
    cab = mat('stacker-white', (.51, .58, .61), .62, .12)
    glass = mat('stacker-glass', (.045, .11, .15), .34, .18)
    P = []
    span, deck = 2.95, 4.05
    # Keep the two rail axes and the original working footprint.
    for sx in [-span, span]:
        box('sill', (.58, 3.4, .15), (sx, 0, .15), rubber, P)
        for sy in [-1.0, 1.0]:
            box('bogie', (.70, 1.04, .30), (sx, sy, .33), oxide, P)
            for offset in [-.29, .29]:
                bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=.19, depth=.42,
                    location=(sx, sy+offset, .22), rotation=(0, math.pi/2, 0))
                wheel = bpy.context.object
                wheel.name = 'rail-wheel'
                wheel.data.materials.append(steel)
                P.append(wheel)
            # A-frame legs converge below the bridge instead of reading as four posts.
            beam_yz('portal-leg', (sx,sy,.49), (sx,sy*.48,deck), (.25,.20), orange,P)
        box('portal-crossbar', (.22,1.52,.17), (sx,0,1.65), oxide,P)
    # Two open Warren trusses enclose the belt. Web ends meet the chords.
    length = span*2+.42
    for sy in [-.54,.54]:
        for z in [deck,deck+.95]:
            box('truss-chord',(length,.13,.13),(0,sy,z),orange,P)
        for i in range(6):
            x0=-length/2 + i*length/6
            x1=x0+length/6
            z0=deck+(.95 if i%2 else 0)
            z1=deck+(0 if i%2 else .95)
            beam('truss-web',(x0,sy,z0),(x1,sy,z1),(.10,.105),oxide,P)
    for x in [-span,0,span]:
        box('cross-girder',(.17,1.20,.13),(x,0,deck),steel,P)
    box('belt',(length-.22,.66,.14),(0,0,deck+.22),rubber,P)
    # Glaze the face visible in the home view. The cabin stays within its former end.
    cx=-span+.55
    box('drive-cab',(1.22,1.14,.74),(cx,0,deck+.68),cab,P)
    box('front-windows',(1.02,.055,.30),(cx,-.576,deck+.76),glass,P)
    box('side-window',(.055,.82,.30),(cx+.62,0,deck+.76),glass,P)
    box('cab-roof',(1.39,1.27,.11),(cx,0,deck+1.10),oxide,P)
    box('drive-case',(.76,.80,.47),(span-.46,0,deck+.43),steel,P)
    # Keep the chute above the displayed pile crest when no operation is simulated.
    box('chute',(.56,.60,.48),(.30,0,deck-.16),oxide,P)
    box('chute-lip',(.72,.72,.095),(.30,0,deck-.42),steel,P)
    o = join(P, 'StackerReclaimer')
    o.location = (0, 0, 0)
    return o


# --------------------------------------------------------------- ship loader
def beam_yz(name, a, b, thick, material, parts):
    """Box spanning a to b in the YZ plane (X fixed). thick=(x,z) cross size."""
    ax, ay, az = a
    by, bz = b[1], b[2]
    length = math.hypot(by - ay, bz - az)
    ang = math.atan2(bz - az, by - ay)
    return rbox(name, (thick[0], length, thick[1]),
                (ax, (ay + by) / 2, (az + bz) / 2), (ang, 0, 0), material, parts)


def build_loader():
    """装船机：门架落在岸侧轨道，悬臂向海侧伸出，末端下料溜筒对准船舱。

    沿用旧资产轴向（悬臂沿 Blender -Y），前端按 theta+PI 旋转后伸向泊位。
    """
    reset()
    orange = mat('loader-orange', (.70,.175,.022), 0.55, 0.15)
    odark = mat('loader-orange-dark', (0.55, 0.26, 0.08), 0.6, 0.2)
    dark = mat('loader-dark', (0.16, 0.17, 0.18), 0.7, 0.25)
    steel = mat('loader-steel', (0.42, 0.45, 0.47), 0.5, 0.4)
    wht = mat('loader-white', (0.84, 0.84, 0.80), 0.55, 0.05)
    glass = mat('loader-glass', (0.10, 0.16, 0.18), 0.25, 0.15)
    P = []
    # 两条岸侧走行底盘 + 轨轮
    for sx in (-1.72, 1.72):
        box('rail', (0.66, 4.2, 0.14), (sx, 0.4, 0.16), dark, P)
        box('bogie', (0.88, 3.4, 0.4), (sx, 0.4, 0.38), odark, P)
        for sy in (-0.85, 0.85, 1.65):
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.20, depth=0.16,
                                                location=(sx, 0.4 + sy, 0.22),
                                                rotation=(0, math.pi / 2, 0))
            w = bpy.context.object; w.name = 'wheel'
            w.data.materials.append(steel); P.append(w)
    # 四个轮组保持原轨距，门腿向上收分，横梁采用透空桁架。
    top_z = 5.35
    for sx in (-1.72, 1.72):
        for sy, upper_y in ((-.95, -.58), (1.75, 1.35)):
            beam_yz('portal-leg', (sx, sy, .55), (sx, upper_y, top_z), (.19, .24), orange, P)
        beam_yz('side-brace', (sx, -.86, .92), (sx, 1.36, 3.97), (.10, .12), odark, P)
        beam_yz('side-brace', (sx, 1.63, .92), (sx, -.56, 3.97), (.10, .12), odark, P)
        box('side-girder', (.18, 2.48, .23), (sx, .40, top_z), orange, P)
    for y in (-.64, 1.42):
        for z in (top_z, top_z+.49):
            box('bridge-chord', (3.69, .14, .15), (0, y, z), orange, P)
        for k in range(5):
            x=-1.73+k*.69
            beam('lattice', (x,y,top_z+.04),(x+.345,y,top_z+.45),(.075,.09),odark,P)
            beam('lattice', (x+.345,y,top_z+.45),(x+.69,y,top_z+.04),(.075,.09),odark,P)
    box('service-deck', (2.65, 2.1, .12), (0,.38,top_z+.42), dark, P)
    box('machine-house', (1.38,1.47,.73), (.48,.91,top_z+.85), odark,P)
    box('machine-roof', (1.52,1.59,.10),(.48,.91,top_z+1.265),orange,P)
    for y in (.40,.65,.90,1.15,1.40):
        box('louvre', (.035,.10,.40), (1.18,y,top_z+.84), dark,P)
    box('counterweight', (1.42, .78, .72), (0,2.08,top_z+.67),dark,P)
    # 悬臂：根部 (0,-1.35,top) → 端部 (0,-7.4,3.5)，抬高并加长，悬在船中舱口上方。
    root = (0.0, -1.35, top_z - 0.15)
    tip = (0.0, -7.40, 3.50)
    for sx in (-0.68, 0.68):
        beam_yz('boom-top', (sx, root[1], root[2] + 0.30), (sx, tip[1], tip[2] + 0.16), (0.13, 0.13), orange, P)
        beam_yz('boom-bot', (sx, root[1], root[2] - 0.30), (sx, tip[1], tip[2] - 0.14), (0.13, 0.13), orange, P)
        steps = 6
        for k in range(steps):
            t0 = k / steps; t1 = (k + .5) / steps; t2 = (k + 1) / steps
            def pt(t):
                y = root[1] + (tip[1] - root[1]) * t
                z = root[2] + (tip[2] - root[2]) * t
                return (y, z)
            y0, z0 = pt(t0); y1, z1 = pt(t1); y2, z2 = pt(t2)
            beam_yz('web', (sx, y0, z0 - 0.26), (sx, y1, z1 + 0.26), (0.07, 0.07), orange, P)
            beam_yz('web', (sx, y1, z1 + 0.26), (sx, y2, z2 - 0.26), (0.07, 0.07), orange, P)
    # 皮带罩 + 端部下料溜筒
    beam_yz('belt', (0, root[1], root[2] + 0.34), (0, tip[1], tip[2] + 0.20), (0.62, 0.16), dark, P)
    box('spout', (0.7, 0.7, 1.05), (0, tip[1] + 0.1, tip[2] - 0.55), odark, P)
    box('spout-mouth', (0.95, 0.95, 0.14), (0, tip[1] + 0.1, tip[2] - 1.08), steel, P)
    # 司机室（悬臂根部下方）
    box('cab', (.83, .88, .64), (.86, -1.40, top_z - .74), wht, P)
    box('cab-glass', (.71, .035, .28), (.86, -1.851, top_z - .69), glass, P)
    o = join(P, 'ShipLoader')
    o.location = (0, 0, 0)
    return o


def main():
    ship = build_ship()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'bulk-carrier.blend'))
    print('EXPORT', export(ship, 'bulk-carrier.glb'))
    stack = build_stacker()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'stacker-reclaimer.blend'))
    print('EXPORT', export(stack, 'stacker-reclaimer.glb'))
    loader = build_loader()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ship-loader.blend'))
    print('EXPORT', export(loader, 'ship-loader.glb'))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'bulk-carrier.glb'))
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'stacker-reclaimer.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'refine_port.blend'))
    print('DONE')


main()
