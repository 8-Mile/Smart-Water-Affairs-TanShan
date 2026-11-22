"""从现场照片生成堆场三套可平铺 PBR 贴图。

用法：
  Blender -b --factory-startup --python bake_stockpile_from_photos.py -- <photo.png> [out_dir]

做法：
- 取照片中煤堆区域，做低频/高频分离，去掉日照阴影，只保留碎煤颗粒；
- 以现场煤色为基底，派生褐矿、灰矿两套；
- 镜像平铺后输出 1024，保证四边无缝。
"""
import os
import struct
import sys
import zlib

import bpy
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PHOTO = ARGS[0]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = ARGS[1] if len(ARGS) > 1 else os.path.normpath(
    os.path.join(HERE, '../../public/tanggang/textures/harbor/pbr/stockpile'))
RES = 1024


def write_png(path, arr):
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


def srgb(linear):
    c = np.clip(linear, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def seamless_resize(arr, res=512, blend=0):
    """默认只做重采样；blend>0 时羽化边缘做无缝平铺。"""
    h, w = arr.shape[:2]
    out = arr.astype(np.float32).copy()
    b = 0 if blend <= 0 else max(4, min(blend, w // 4, h // 4))
    for i in range(b):
        t = i / b
        out[:, i] = arr[:, i] * (1 - t) + arr[:, w - b + i] * t
        out[:, w - 1 - i] = arr[:, w - 1 - i] * (1 - t) + arr[:, b - 1 - i] * t
    for j in range(b):
        t = j / b
        out[j, :] = out[j, :] * (1 - t) + out[h - b + j, :] * t
        out[h - 1 - j, :] = out[h - 1 - j, :] * (1 - t) + out[b - 1 - j, :] * t
    yi = np.linspace(0, h - 1, res).astype(int)
    xi = np.linspace(0, w - 1, res).astype(int)
    return out[np.ix_(yi, xi)]


def normal_map(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5) * 255.0


def main():
    img = bpy.data.images.load(PHOTO)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    rgb = buf.reshape(h, w, 4)[:, :, :3]  # bottom-up，线性空间

    # 纯煤堆局部：避开轨道、机器与堆脊暗带。
    roi = rgb[60:min(300, h), 30:min(190, w)]
    lum = 0.2126 * roi[:, :, 0] + 0.7152 * roi[:, :, 1] + 0.0722 * roi[:, :, 2]

    rh, rw = lum.shape
    fy = np.fft.fftfreq(rh)[:, None]
    fx = np.fft.rfftfreq(rw)[None, :]
    sigma = 15.0
    kernel = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    blur = np.fft.irfft2(np.fft.rfft2(lum) * kernel, s=lum.shape)
    ratio = np.clip(lum / (blur + 1e-5), 0.55, 1.75)
    detail = np.clip((ratio - 0.55) / 1.20, 0, 1)

    base = np.array([0.007, 0.008, 0.010])
    highlight = np.array([0.050, 0.058, 0.074])
    albedo = base + (highlight - base) * detail[..., None]

    normal = normal_map(detail, 3.4)
    rough = np.clip(0.48 + 0.30 * (1 - detail), 0.4, 0.92)

    variants = {
        'coal': ((1.00, 1.00, 1.00), 0.78, 0.62),
        'brown': ((1.20, 0.78, 0.52), 1.20, 0.78),
        'grey': ((1.18, 1.19, 1.15), 1.60, 0.72),
    }
    for kind, (tint, gain, roughness) in variants.items():
        color = np.clip(seamless_resize(albedo) * gain * np.array(tint), 0, 1)
        write_png(os.path.join(OUT, kind, 'color.png'), srgb(color) * 255.0)
        write_png(os.path.join(OUT, kind, 'normal.png'), seamless_resize(normal))
        write_png(os.path.join(OUT, kind, 'rough.png'), seamless_resize(np.clip(rough * (roughness / 0.62), 0.35, 0.95) * 255.0))
        write_png(os.path.join(OUT, kind, 'ao.png'), seamless_resize(np.clip(0.62 + detail * 0.38, 0, 1) * 255.0))
        print('baked', kind)
    print('done', OUT)


main()
