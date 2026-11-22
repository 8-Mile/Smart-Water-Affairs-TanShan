"""唐港 5190 运煤卡车资产：洗车台区出场车辆（Blender 后台可复现脚本）。

用法：
  "/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup -t 2 \
    --python-exit-code 1 --python create_trucks.py -- <out_dir>

输出：
  coal-truck.glb

约定：
- 原点在车辆地面投影中心，X 为车头方向、Y 为车宽、Z 向上；导出 glTF 时转 Y-up。
- 尺寸按场景显示单位（约 1.35 长），与洗车台区、建筑保持同一比例。
- 材质名固定：truck-blue / truck-white / glass / metal / dark / coal / orange / rubber。
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


def build_truck():
    reset()
    blue = mat('truck-blue', (0.10, 0.28, 0.36), 0.55, 0.18)
    white = mat('truck-white', (0.78, 0.80, 0.77), 0.62)
    glass = mat('glass', (0.08, 0.14, 0.17), 0.14, 0.25)
    metal = mat('metal', (0.44, 0.47, 0.47), 0.5, 0.35)
    dark = mat('dark', (0.09, 0.11, 0.12), 0.6, 0.25)
    coal = mat('coal', (0.055, 0.055, 0.052), 0.95)
    orange = mat('orange', (0.72, 0.34, 0.10), 0.5, 0.2)
    rubber = mat('rubber', (0.045, 0.048, 0.05), 0.95)
    P = []

    # 底盘与车架
    P.append(box('chassis', (1.28, 0.42, 0.09), (0, 0, 0.17), dark))
    P.append(box('frame', (1.02, 0.30, 0.06), (-0.10, 0, 0.23), metal))

    # 平头驾驶室
    P.append(box('cab', (0.40, 0.50, 0.40), (0.44, 0, 0.44), blue))
    P.append(box('cabroof', (0.42, 0.52, 0.05), (0.44, 0, 0.655), white))
    P.append(box('windshield', (0.02, 0.40, 0.20), (0.645, 0, 0.50), glass))
    for sy in (-1, 1):
        P.append(box('sidewin', (0.20, 0.015, 0.16), (0.44, sy * 0.253, 0.51), glass))
        P.append(box('mirror', (0.03, 0.06, 0.10), (0.62, sy * 0.30, 0.56), dark))
        P.append(box('mirrorarm', (0.10, 0.015, 0.015), (0.56, sy * 0.285, 0.56), dark))
    P.append(box('grille', (0.02, 0.34, 0.12), (0.645, 0, 0.34), dark))
    P.append(box('bumper', (0.06, 0.50, 0.10), (0.66, 0, 0.24), metal))
    for sy in (-1, 1):
        P.append(box('headlight', (0.02, 0.08, 0.06), (0.652, sy * 0.17, 0.285), orange))
    P.append(box('sunvisor', (0.10, 0.48, 0.02), (0.60, 0, 0.67), white))

    # 自卸货箱：底板、两侧板、前挡板、后门
    P.append(box('bedfloor', (0.80, 0.50, 0.06), (-0.29, 0, 0.30), metal))
    for sy in (-1, 1):
        P.append(box('bedside', (0.80, 0.035, 0.34), (-0.29, sy * 0.247, 0.47), dark))
        for k in range(4):
            P.append(box('bedrib', (0.035, 0.02, 0.36), (-0.60 + k * 0.20, sy * 0.263, 0.47), metal))
    P.append(box('bedfront', (0.05, 0.50, 0.36), (0.10, 0, 0.48), blue))
    P.append(box('bedgate', (0.05, 0.50, 0.34), (-0.685, 0, 0.47), metal))
    P.append(box('bedtop', (0.78, 0.50, 0.03), (-0.29, 0, 0.645), metal))

    # 煤堆载：略高出箱体的平顶煤堆
    P.append(box('load', (0.70, 0.42, 0.07), (-0.30, 0, 0.60), coal))
    P.append(box('loadtop', (0.56, 0.32, 0.04), (-0.30, 0, 0.645), coal))

    # 车轮：三轴六轮
    for wx in (0.44, -0.10, -0.44):
        for sy in (-1, 1):
            P.append(cyl('tyre', 0.135, 0.105, (wx, sy * 0.275, 0.135), rubber,
                         rot=(math.pi / 2, 0, 0), verts=16))
            P.append(cyl('hub', 0.055, 0.112, (wx, sy * 0.275, 0.135), metal,
                         rot=(math.pi / 2, 0, 0), verts=12))
    for sy in (-1, 1):
        P.append(box('mudflap', (0.03, 0.16, 0.14), (-0.60, sy * 0.27, 0.11), dark))

    # 排气管与油箱
    P.append(cyl('exhaust', 0.025, 0.34, (0.24, 0.20, 0.42), metal, verts=8))
    P.append(cyl('fuel', 0.055, 0.26, (0.05, -0.23, 0.26), metal,
                 rot=(0, math.pi / 2, 0), verts=10))
    P.append(box('plate', (0.02, 0.14, 0.05), (0.665, 0, 0.17), white))

    return join_export(P, 'coal-truck', OUT)


if __name__ == '__main__':
    print(build_truck())
