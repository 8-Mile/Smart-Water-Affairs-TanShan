"""堆场煤/褐矿/灰矿三套可平铺 PBR 贴图。

用法：
  "/Applications/Blender.app/Contents/MacOS/Blender" -b --factory-startup \
    --python bake_stockpile_materials.py -- [out_dir]

输出：
  <out_dir>/coal|brown|grey/{color,normal,rough,ao}.png

约定：
- 全部贴图按世界 UV 平铺，256 显示单位内不重复接缝；
- color 写 sRGB，normal/rough/ao 写线性数值；
- 只生成材质，不改 CAD 点位与堆体几何。
"""
import os
import struct
import sys
import zlib

import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = ARGS[0] if ARGS else os.path.normpath(os.path.join(HERE, '../../public/tanggang/textures/harbor/pbr/stockpile'))
RES = 1024

KINDS = {
    'coal':  {'base': (0.014, 0.0145, 0.0150), 'hi': (0.105, 0.106, 0.112), 'rough': 0.62, 'ridge': 0.55},
    'brown': {'base': (0.045, 0.030, 0.020), 'hi': (0.135, 0.095, 0.065), 'rough': 0.76, 'ridge': 0.34},
    'grey':  {'base': (0.075, 0.076, 0.072), 'hi': (0.215, 0.213, 0.198), 'rough': 0.72, 'ridge': 0.28},
}


def write_png(path, arr):
    """写 8 位 RGB PNG；arr 形状 (h,w,3) 或 (h,w)。"""
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    h, w = arr.shape[:2]
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)


def value_noise(res, cells, rng):
    """周期双线性值噪声，保证四边无缝。"""
    grid = rng.random((cells, cells))
    x = np.arange(res) * cells / res
    i0 = np.floor(x).astype(np.int64)
    f = x - i0
    f = f * f * (3.0 - 2.0 * f)
    i0 %= cells
    i1 = (i0 + 1) % cells
    fx = f[None, :]
    fy = f[:, None]
    g00 = grid[np.ix_(i0, i0)]
    g10 = grid[np.ix_(i0, i1)]
    g01 = grid[np.ix_(i1, i0)]
    g11 = grid[np.ix_(i1, i1)]
    top = g00 * (1 - fx) + g10 * fx
    bottom = g01 * (1 - fx) + g11 * fx
    return top * (1 - fy) + bottom * fy


def fbm(res, rng, octaves=6, base=4, gain=0.56):
    total = np.zeros((res, res))
    amp, norm, cells = 1.0, 0.0, base
    for _ in range(octaves):
        total += value_noise(res, cells, rng) * amp
        norm += amp
        amp *= gain
        cells *= 2
    return total / norm


def srgb(linear):
    c = np.clip(linear, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def normal_map(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5) * 255.0


def build(kind, spec):
    rng = np.random.default_rng(sum(kind.encode()) * 7919)
    fine = fbm(RES, rng, octaves=8, base=10, gain=0.62)
    # 碎石棱面：低频噪声量化成块，避免整片绒面。
    blocks = fbm(RES, rng, octaves=3, base=14)
    facets = np.floor(blocks * 11.0) / 11.0
    height = fine * (1 - spec['ridge']) + facets * spec['ridge']
    # 局部凹陷：煤堆被推土机压实后的低洼，作为颜色与粗糙度的低频变化。
    hollow = fbm(RES, rng, octaves=4, base=3)
    h = np.clip(height * 0.66 + hollow * 0.34, 0.0, 1.0)
    # 碎石颗粒：稀疏亮点与暗坑，避免 1024 贴图在近景读成一片噪声。
    for _ in range(5200):
        x, y = rng.integers(0, RES, 2)
        r = int(rng.integers(1, 4))
        bright = rng.random() > 0.45
        patch = h[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]
        patch += (0.10 if bright else -0.08) * (1.0 - r / 5.0)
    h = np.clip(h, 0.0, 1.0)

    base = np.array(spec['base'], dtype=np.float64)
    hi = np.array(spec['hi'], dtype=np.float64)
    t = np.power(h, 1.45)[..., None]
    color = base[None, None, :] * (1 - t) + hi[None, None, :] * t
    # 颗粒级色偏：同一堆料里混入少量更亮/更暗的碎块。
    tint = (rng.random((RES, RES, 1)) - 0.5) * 0.10
    color = np.clip(color * (1.0 + tint), 0.0, 1.0)
    write_png(os.path.join(OUT, kind, 'color.png'), srgb(color) * 255.0)

    write_png(os.path.join(OUT, kind, 'normal.png'), normal_map(h, 2.8))
    rough = np.clip(spec['rough'] + (h - 0.5) * 0.26, 0.35, 0.96)
    write_png(os.path.join(OUT, kind, 'rough.png'), rough * 255.0)
    ao = np.clip(0.62 + h * 0.38, 0.0, 1.0)
    write_png(os.path.join(OUT, kind, 'ao.png'), ao * 255.0)
    print('baked', kind, '->', os.path.join(OUT, kind))


for name, cfg in KINDS.items():
    build(name, cfg)
print('done', OUT)
