"""唐港 5190 建筑资产精修：按现有 GLB 外形尺寸重建带立面细节的版本。

用法：
  "/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup -t 2 \
    --python-exit-code 1 --python refine_all_buildings.py -- <out_dir>

尺寸来自原 GLB 的实测包围盒，原点仍在基底中心，落位不变。
"""
import bpy
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from harbor_kit import reset, mat, box, cyl, join_export  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = (ARGS[0] if ARGS else os.path.join(HERE, '..', '..', 'public', 'tanggang', 'models', 'harbor')).rstrip('/')
os.makedirs(OUT, exist_ok=True)


def palette():
    return {
        'concrete': mat('concrete', (0.52, 0.54, 0.51), 0.92),
        'white': mat('paint-white', (0.74, 0.76, 0.73), 0.66),
        'blue': mat('paint-blue', (0.13, 0.26, 0.31), 0.58, 0.12),
        'metal': mat('metal', (0.46, 0.49, 0.49), 0.52, 0.35),
        'glass': mat('glass', (0.10, 0.17, 0.20), 0.16, 0.22),
        'dark': mat('dark', (0.10, 0.12, 0.13), 0.58, 0.30),
        'orange': mat('orange', (0.72, 0.34, 0.10), 0.5, 0.2),
        # 屋面统一中灰：阴天漫反射下读成浅灰压型钢板，不再反射成深蓝。
        'roof': mat('roof', (0.34, 0.36, 0.35), 0.68, 0.10),
        'corrugation': mat('corrugation', (0.63, 0.65, 0.62), 0.78, 0.08),
    }


def band(P, W, D, z, h, glass, mull, sides=(1, -1), ends=True, n=None):
    n = n or max(3, int(W / 0.55))
    for sy in sides:
        y = sy * (D / 2 + 0.014)
        P.append(box('band', (W * 0.86, 0.035, h), (0, y, z), glass))
        for i in range(n + 1):
            x = -W * 0.43 + i * (W * 0.86 / n)
            P.append(box('mull', (0.03, 0.05, h * 1.06), (x, y + sy * 0.004, z), mull))
        P.append(box('sill', (W * 0.88, 0.09, 0.045), (0, y, z - h / 2 - 0.035), mull))
    if ends:
        ne = max(2, int(D / 0.6))
        for sx in (-1, 1):
            x = sx * (W / 2 + 0.014)
            P.append(box('band', (0.035, D * 0.78, h), (x, 0, z), glass))
            for i in range(ne + 1):
                y = -D * 0.39 + i * (D * 0.78 / ne)
                P.append(box('mull', (0.05, 0.03, h * 1.06), (x + sx * 0.004, y, z), mull))


def punched(P, W, D, z, h, glass, frame, count=5, sides=(1, -1)):
    slot = W / count
    for sy in sides:
        y = sy * (D / 2 + 0.014)
        for i in range(count):
            x = -W / 2 + (i + 0.5) * slot
            ww = slot * 0.62
            P.append(box('win', (ww, 0.04, h), (x, y, z), glass))
            P.append(box('wh', (ww + 0.06, 0.06, 0.035), (x, y, z + h / 2 + 0.02), frame))
            P.append(box('ws', (ww + 0.06, 0.06, 0.035), (x, y, z - h / 2 - 0.02), frame))
            P.append(box('wv', (0.03, 0.06, h), (x, y, z), frame))


def parapet(P, W, D, H, m):
    t = 0.08
    for sy in (-1, 1):
        P.append(box('parapet', (W + 0.08, t, 0.16), (0, sy * (D / 2), H + 0.08), m))
    for sx in (-1, 1):
        P.append(box('parapet', (t, D + 0.08, 0.16), (sx * (W / 2), 0, H + 0.08), m))


def corrugate(P, W, D, H, m, spacing=0.34):
    """压型钢板立面：竖向肋条 + 顶部收边，只在墙体外表皮，深度 0.02。"""
    h = H * 0.86
    z = h / 2 + 0.02
    nx = max(2, int(W / spacing))
    ny = max(2, int(D / spacing))
    for sy in (-1, 1):
        y = sy * (D / 2 + 0.018)
        for i in range(nx + 1):
            x = -W / 2 + i * (W / nx)
            P.append(box('corrugation', (0.045, 0.035, h), (x, y, z), m))
        P.append(box('walltop', (W + 0.04, 0.06, 0.06), (0, sy * (D / 2 + 0.015), h + 0.05), m))
    for sx in (-1, 1):
        x = sx * (W / 2 + 0.018)
        for i in range(ny + 1):
            y = -D / 2 + i * (D / ny)
            P.append(box('corrugation', (0.035, 0.045, h), (x, y, z), m))
        P.append(box('walltop', (0.06, D + 0.04, 0.06), (sx * (W / 2 + 0.015), 0, h + 0.05), m))


def downpipes(P, W, D, H, m):
    """四角雨落管与固定卡箍，近景给立面一条垂直分缝。"""
    for sx in (-1, 1):
        for sy in (-1, 1):
            x = sx * (W / 2 + 0.055)
            y = sy * (D / 2 + 0.055)
            P.append(cyl('downpipe', 0.045, H * 0.88, (x, y, H * 0.44), m, verts=8))
            for k in range(3):
                P.append(box('pipeclamp', (0.10, 0.10, 0.035), (x, y, H * (0.2 + k * 0.26)), m))


def entrance(P, W, D, wall, glass, metal, dark, orange=None, z=0.62):
    P.append(box('doorframe', (1.05, 0.10, 1.0), (0, -D / 2 - 0.03, z), dark))
    P.append(box('doorglass', (0.86, 0.05, 0.86), (0, -D / 2 - 0.09, z), glass))
    P.append(box('canopy', (1.9, 0.72, 0.09), (0, -D / 2 - 0.34, z + 0.62), metal))
    for sx in (-0.8, 0.8):
        P.append(box('post', (0.06, 0.06, 1.2), (sx, -D / 2 - 0.63, z + 0.02), metal))
    P.append(box('step', (1.4, 0.42, 0.05), (0, -D / 2 - 0.18, 0.05), wall))
    if orange:
        P.append(box('sign', (0.9, 0.05, 0.16), (0, -D / 2 - 0.10, z + 0.95), orange))


def roof_kit(P, W, D, H, concrete, metal, dark, units=2):
    # 楼梯间 / 机组 / 风机 / 女儿墙压顶
    P.append(box('stair', (0.72, 0.62, 0.42), (W * 0.24, D * 0.12, H + 0.21), concrete))
    P.append(box('stairroof', (0.78, 0.68, 0.05), (W * 0.24, D * 0.12, H + 0.44), metal))
    for i in range(units):
        x = -W * 0.22 + i * (W * 0.26)
        P.append(box('acu', (0.46, 0.34, 0.24), (x, -D * 0.10, H + 0.12), metal))
        P.append(box('acugrill', (0.34, 0.02, 0.16), (x, -D * 0.10 - 0.18, H + 0.12), dark))
    for i in range(2):
        P.append(cyl('vent', 0.10, 0.30, (-W * 0.28 + i * 0.34, D * 0.26, H + 0.15), metal, verts=10))
    P.append(box('roofcap', (W * 0.30, D * 0.30, 0.04), (0, 0, H + 0.03), dark))


def office_block(name, W, D, H, floors, wall, glass, metal, dark, orange=None, roof=None):
    P = []
    P.append(box('plinth', (W + 0.22, D + 0.22, 0.10), (0, 0, 0.05), mat('concrete2', (0.55, 0.57, 0.54), 0.9)))
    P.append(box('body', (W, D, H), (0, 0, H / 2), wall))
    fh = H / floors
    for f in range(floors):
        z = fh * (f + 0.56)
        if floors >= 3 and f == floors - 1:
            band(P, W, D, z, fh * 0.5, glass, metal, n=max(4, int(W / 0.5)))
        else:
            punched(P, W, D, z, fh * 0.46, glass, metal, count=max(3, int(W / 0.8)))
    entrance(P, W, D, wall, glass, metal, dark, orange)
    roof = roof or wall
    P.append(box('roofdeck', (W * 0.99, D * 0.99, 0.04), (0, 0, H + 0.02), roof))
    parapet(P, W, D, H, metal)
    roof_kit(P, W, D, H, wall, metal, dark)
    downpipes(P, W, D, H, metal)
    return join_export(P, name, OUT)


def curtain_office(name, W, D, H, floors, wall, glass, metal, dark, orange=None, fins=True, roof=None):
    P = []
    P.append(box('plinth', (W + 0.26, D + 0.26, 0.12), (0, 0, 0.06), mat('concrete3', (0.58, 0.60, 0.57), 0.9)))
    P.append(box('core', (W * 0.97, D * 0.97, H), (0, 0, H / 2), wall))
    fh = H / floors
    for f in range(floors):
        band(P, W * 1.004, D * 1.004, fh * (f + 0.52), fh * 0.56, glass, metal,
             n=max(5, int(W / 0.48)))
    if fins:
        n = max(6, int(W / 0.42))
        for i in range(n + 1):
            x = -W / 2 + i * (W / n)
            for sy in (-1, 1):
                P.append(box('fin', (0.05, 0.10, H * 0.92), (x, sy * (D / 2 + 0.09), H / 2), wall))
    for sx in (-1, 1):
        P.append(box('corner', (0.12, 0.12, H), (sx * (W / 2 + 0.02), D / 2 + 0.02, H / 2), wall))
        P.append(box('corner', (0.12, 0.12, H), (sx * (W / 2 + 0.02), -D / 2 - 0.02, H / 2), wall))
    entrance(P, W, D, wall, glass, metal, dark, orange, z=0.75)
    # 顶部收头 + 女儿墙
    P.append(box('crown', (W + 0.32, D + 0.32, 0.14), (0, 0, H + 0.07), wall))
    roof = roof or wall
    P.append(box('roofdeck', (W * 0.99, D * 0.99, 0.03), (0, 0, H + 0.17), roof))
    parapet(P, W + 0.2, D + 0.2, H + 0.14, metal)
    roof_kit(P, W, D, H + 0.14, wall, metal, dark, units=2)
    downpipes(P, W, D, H, metal)
    return join_export(P, name, OUT)


def industrial_hall(name, W, D, H, wall, metal, glass, dark, orange=None, sawtooth=False,
                    roof=None, corr=None):
    P = []
    P.append(box('plinth', (W + 0.24, D + 0.24, 0.10), (0, 0, 0.05), mat('concrete4', (0.55, 0.57, 0.54), 0.9)))
    P.append(box('body', (W, D, H * 0.94), (0, 0, H * 0.47), wall))
    # 压型钢板竖肋
    if corr:
        corrugate(P, W, D, H * 0.94, corr)
    # 高窗带
    band(P, W, D, H * 0.72, H * 0.16, glass, metal, n=max(4, int(W / 0.7)))
    # 大尺寸工业门
    for i, x in enumerate((-W * 0.22, W * 0.22)):
        P.append(box('bigdoor', (W * 0.26, 0.09, H * 0.55), (x, -D / 2 - 0.04, H * 0.30), metal))
        for k in range(5):
            P.append(box('rib', (W * 0.26, 0.03, 0.035), (x, -D / 2 - 0.10, H * 0.11 + k * H * 0.09), dark))
        P.append(box('lintel', (W * 0.29, 0.12, 0.10), (x, -D / 2 - 0.05, H * 0.58), dark))
    # 百叶与管线
    for k in range(6):
        P.append(box('louver', (W * 0.30, 0.05, 0.035), (W * 0.28, -D / 2 - 0.05, H * 0.80 + k * 0.06), dark))
    for i in range(2):
        P.append(cyl('pipe', 0.075, W * 0.65, (0, D / 2 + 0.10 + i * 0.18, H * 0.55), metal,
                     rot=(0, math.pi / 2, 0), verts=10))
    roof = roof or metal
    if sawtooth:
        for k in range(3):
            x = -W / 2 + (k + 0.5) * (W / 3)
            P.append(box('saw', (W / 3 * 0.92, D * 0.86, 0.06), (x, 0, H + 0.16), roof, rot=(0, 0.20, 0)))
            P.append(box('sawglass', (W / 3 * 0.92, 0.05, 0.22), (x, -D * 0.30, H + 0.20), glass))
    else:
        P.append(box('roof', (W * 0.98, D * 0.98, 0.07), (0, 0, H + 0.02), roof))
        for k in range(4):
            P.append(box('roofrib', (W * 0.98, 0.05, 0.03), (0, -D * 0.36 + k * D * 0.24, H + 0.06), dark))
        roof_kit(P, W, D, H + 0.05, wall, metal, dark, units=2)
    parapet(P, W, D, H, metal)
    downpipes(P, W, D, H, metal)
    return join_export(P, name, OUT)


def warehouse(name, W, D, H, wall, metal, glass, dark, orange=None, roof=None, corr=None):
    P = []
    P.append(box('plinth', (W + 0.2, D + 0.2, 0.08), (0, 0, 0.04), mat('concrete5', (0.55, 0.57, 0.54), 0.9)))
    P.append(box('body', (W, D, H), (0, 0, H / 2), wall))
    if corr:
        corrugate(P, W, D, H, corr)
    # 三个装卸门 + 雨棚 + 防撞垫
    for i in range(3):
        x = -W * 0.30 + i * W * 0.30
        P.append(box('roller', (W * 0.20, 0.08, H * 0.52), (x, -D / 2 - 0.04, H * 0.30), metal))
        for k in range(6):
            P.append(box('slat', (W * 0.20, 0.02, 0.03), (x, -D / 2 - 0.09, H * 0.07 + k * H * 0.075), dark))
        P.append(box('dock', (W * 0.24, 0.55, 0.10), (x, -D / 2 - 0.28, H * 0.62), metal))
        for sx in (-1, 1):
            P.append(box('bumper', (0.16, 0.10, 0.20), (x + sx * W * 0.13, -D / 2 - 0.06, H * 0.16), dark))
    # 高窗带与屋面肋条
    band(P, W, D, H * 0.82, H * 0.13, glass, metal, n=max(4, int(W / 0.75)))
    roof = roof or metal
    P.append(box('roofdeck', (W * 0.98, D * 0.98, 0.05), (0, 0, H + 0.02), roof))
    for k in range(7):
        P.append(box('roofrib', (W * 0.98, 0.05, 0.04), (0, -D * 0.42 + k * D * 0.14, H + 0.05), dark))
    roof_kit(P, W, D, H + 0.02, wall, metal, dark, units=2)
    P.append(box('annex', (W * 0.22, D * 0.5, H * 0.55), (W * 0.34, D * 0.20, H * 0.275), wall))
    P.append(box('annexwin', (W * 0.18, 0.03, H * 0.20), (W * 0.34, -D * 0.06, H * 0.38), glass))
    parapet(P, W, D, H, metal)
    downpipes(P, W, D, H, metal)
    return join_export(P, name, OUT)


def utility(name, W, D, H, blue, metal, glass, dark, roof=None):
    P = []
    P.append(box('body', (W, D, H), (0, 0, H / 2), blue))
    P.append(box('door', (W * 0.26, 0.06, H * 0.58), (0, -D / 2 - 0.03, H * 0.30), dark))
    P.append(box('lintel', (W * 0.30, 0.10, 0.06), (0, -D / 2 - 0.04, H * 0.60), metal))
    for k in range(4):
        P.append(box('louver', (W * 0.34, 0.05, 0.03), (W * 0.22, -D / 2 - 0.04, H * 0.72 + k * 0.05), dark))
    band(P, W, D, H * 0.80, H * 0.10, glass, metal, n=max(3, int(W / 0.55)))
    P.append(box('roof', (W * 0.98, D * 0.98, 0.06), (0, 0, H + 0.03), roof or metal))
    for i in range(2):
        P.append(box('acu', (0.40, 0.30, 0.22), (-W * 0.20 + i * 0.55, 0, H + 0.14), metal))
    for i in range(2):
        P.append(cyl('vertpipe', 0.075, H * 0.85, (-W / 2 - 0.10, -D / 2 + 0.15 + i * 0.4, H * 0.44), metal, verts=8))
    parapet(P, W, D, H, metal)
    return join_export(P, name, OUT)


def gallery(name, W, D, H, wall, glass, metal, dark):
    P = []
    # 高位皮带廊：连续玻璃带 + 钢肋 + 落地支腿
    P.append(box('body', (W, D, H * 0.62), (0, 0, H * 0.62), wall))
    for sy in (-1, 1):
        P.append(box('glassband', (W * 0.98, 0.03, H * 0.20), (0, sy * (D / 2 + 0.02), H * 0.66), glass))
    n = max(6, int(W / 0.34))
    for i in range(n + 1):
        x = -W / 2 + i * (W / n)
        P.append(box('rib', (0.05, D + 0.12, H * 0.72), (x, 0, H * 0.60), metal))
    for x in (-W * 0.34, 0, W * 0.34):
        for sy in (-1, 1):
            P.append(box('leg', (0.14, 0.14, H * 0.34), (x, sy * D * 0.30, H * 0.17), metal))
        P.append(box('legbrace', (0.10, D * 0.68, 0.10), (x, 0, H * 0.30), metal))
    P.append(box('top', (W + 0.1, D + 0.14, 0.07), (0, 0, H * 0.93), metal))
    P.append(box('sign', (0.9, 0.04, 0.18), (0, -D / 2 - 0.05, H * 0.52), dark))
    return join_export(P, name, OUT)


SPECS = [
    ('canteen', 3.44, 2.57, 1.65),
    ('inspection', 3.76, 2.68, 2.07),
    ('steeloffice', 5.66, 3.03, 2.87),
    ('wisdomcenter', 6.90, 3.32, 3.41),
    ('pumphouse', 4.57, 5.67, 1.98),
    ('treatmenthouse', 4.53, 2.38, 1.62),
    ('workshop', 4.95, 2.70, 2.18),
    ('warehouse', 4.80, 2.30, 2.04),
    ('ecopump', 2.37, 1.55, 1.26),
    ('integratedtreatment', 2.60, 1.71, 1.22),
    ('gallery-bay', 4.03, 1.40, 2.81),
]


def main():
    for name, W, D, H in SPECS:
        reset()
        M = palette()
        if name == 'canteen':
            out = office_block(name, W, D, H, 2, M['white'], M['glass'], M['metal'], M['dark'],
                               M['orange'], M['roof'])
        elif name == 'inspection':
            out = office_block(name, W, D, H, 3, M['white'], M['glass'], M['metal'], M['dark'],
                               M['orange'], M['roof'])
        elif name in ('steeloffice', 'wisdomcenter'):
            out = curtain_office(name, W, D, H, 4 if name == 'steeloffice' else 5,
                                 M['white'], M['glass'], M['metal'], M['dark'], M['orange'],
                                 roof=M['roof'])
        elif name == 'pumphouse':
            out = industrial_hall(name, W, D, H, M['white'], M['metal'], M['glass'], M['dark'],
                                  M['orange'], roof=M['roof'], corr=M['corrugation'])
        elif name == 'treatmenthouse':
            out = industrial_hall(name, W, D, H, M['white'], M['metal'], M['glass'], M['dark'],
                                  M['orange'], roof=M['roof'], corr=M['corrugation'])
        elif name == 'workshop':
            out = industrial_hall(name, W, D, H, M['white'], M['metal'], M['glass'], M['dark'],
                                  M['orange'], sawtooth=True, roof=M['roof'], corr=M['corrugation'])
        elif name == 'warehouse':
            out = warehouse(name, W, D, H, M['white'], M['metal'], M['glass'], M['dark'],
                            M['orange'], roof=M['roof'], corr=M['corrugation'])
        elif name in ('ecopump', 'integratedtreatment'):
            out = utility(name, W, D, H, M['blue'], M['metal'], M['glass'], M['dark'], M['roof'])
        else:
            out = gallery(name, W, D, H, M['white'], M['glass'], M['metal'], M['dark'])
        print(out)


if __name__ == '__main__':
    main()
