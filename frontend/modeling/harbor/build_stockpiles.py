"""按 CAD 派生数据生成 16 个堆场堆体，导出 GLB。

用法：
  Blender -b --factory-startup --python build_stockpiles.py

坐标约定：
- 平面点位全部来自 scene-v2.2.json / spatial-candidates-v2.6.json；
- Blender 用 Z-up，顶点写成 (x, cad_z, height)，glTF 导出后正好是 three 的 (x, height, -cad_z)；
- 南北端按 CAD 集水池轮廓各退 2 单位，与前端堆体让位逻辑一致。
"""
import json
import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
SCENE = os.path.join(ROOT, 'public/tanggang/cad/l1-v2_2/scene-v2.2.json')
SPATIAL = os.path.join(ROOT, 'public/tanggang/cad/l1-v2_6/spatial-candidates-v2.6.json')
OUT = os.path.join(ROOT, 'public/tanggang/models/harbor/stockpiles-16.glb')

NU, NV = 26, 64
SPLIT_GAP = 4.2
KINDS = ['coal', 'brown', 'grey']


def clean(text):
    for prefix in ('A侧', 'B侧'):
        if text.startswith(prefix):
            return text[len(prefix):].strip()
    return text.strip()


def hash01(a, b, seed):
    value = math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453
    return value - math.floor(value)


def build_mesh(name, left, right, length, height, seed, kind):
    verts, faces, colors = [], [], []
    crest, shoulder = 0.24, 0.09
    for j in range(NV + 1):
        t = j / NV
        z = (t - 0.5) * length
        end_f = min(1.0, min(t, 1 - t) * length / 9.0)
        # 沿长度叠三个锥峰：峰间落到 58%，形成料堆之间的鞍部，而不是一条平脊。
        peak = 0.42
        for k in range(3):
            centre = (k + 0.5) / 3 + (hash01(k, seed, 1) - 0.5) * 0.10
            amp = 0.82 + 0.18 * hash01(k, seed, 2)
            peak = max(peak, math.exp(-((t - centre) / 0.13) ** 2) * amp)
        for i in range(NU + 1):
            u = i / NU * 2 - 1
            d = abs(u)
            if d <= crest:
                face = 1.0
            elif d <= crest + shoulder:
                face = 1.0 - (d - crest) / shoulder * 0.06
            else:
                slope = (d - crest - shoulder) / (1.0 - crest - shoulder)
                face = 0.94 * (1.0 - slope) ** 1.15
            rough = (hash01(i * 1.7, j * 0.31, seed) * 2 - 1) * 0.024 * face * (1 - face) * 4
            x = u * (left if u < 0 else right)
            y = 0.02 + height * end_f * max(0.0, face) * peak + rough * height
            verts.append((x, z, max(0.02, y)))
            channel = (0.72 + 0.32 * max(0.0, face)) * (0.94 + 0.05 * math.sin(t * 3.1 + i * 0.12 + seed))
            colors.append(min(1.0, channel))
    for j in range(NV):
        for i in range(NU):
            a = j * (NU + 1) + i
            b = a + NU + 1
            faces.append((a, b, a + 1, b + 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    attr = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            c = colors[mesh.loops[li].vertex_index]
            attr.data[li].color = (c, c, c, 1.0)
    # 世界 XZ 投影 UV：让前端三套 PBR 的 color/normal/rough 能真正采到，而不是 (0,0)。
    uv_layer = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        uv_layer.data[loop.index].uv = (co.x * 0.14, co.y * 0.14)
    mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
    mesh.update()
    return mesh


def material(kind):
    mat = bpy.data.materials.get('pile_' + kind)
    if mat:
        return mat
    mat = bpy.data.materials.new('pile_' + kind)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    vc = nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.78
    bsdf.inputs['Metallic'].default_value = 0.03
    return mat


def main():
    data = json.load(open(SCENE, encoding='utf-8'))
    spatial = json.load(open(SPATIAL, encoding='utf-8'))
    bands = {b['id']: b for b in data['yardBands']}
    pool_z = [p[1] for c in spatial['poolContourCandidates'] for p in c['displayXZ']]
    north_edge = min([z for z in pool_z if z > 0] or [99])
    south_edge = max([z for z in pool_z if z < 0] or [-99])

    columns = {}
    for yard in spatial['yardSideCandidates']:
        key = clean(yard.get('label') or yard['id']) or yard['id']
        col = columns.setdefault(key, {'key': key, 'bandId': yard['bandId'], 'xs': [], 'anchors': []})
        col['xs'].append(yard['sceneXZ'][0])
        col['anchors'].append((yard['side'], yard['id'], yard.get('sourceTextHandle', '')))
    groups = {}
    for col in columns.values():
        groups.setdefault(col['bandId'], []).append(col)
    for cols in groups.values():
        cols.sort(key=lambda c: sum(c['xs']) / len(c['xs']))

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

    for band_id, cols in groups.items():
        band = bands.get(band_id)
        if not band:
            continue
        bx = [p[0] for p in band['displayXZ']]
        bz = [p[1] for p in band['displayXZ']]
        z_min, z_max = min(bz), max(bz)
        mid = (z_min + z_max) / 2
        north_end = min(z_max, north_edge - 2)
        south_end = max(z_min, south_edge + 2)
        for ci, col in enumerate(cols):
            x = sum(col['xs']) / len(col['xs'])
            left = (x - sum(cols[ci - 1]['xs']) / len(cols[ci - 1]['xs'])) / 2 - 0.4 if ci > 0 else x - min(bx) - 0.22
            right = (sum(cols[ci + 1]['xs']) / len(cols[ci + 1]['xs']) - x) / 2 - 0.4 if ci < len(cols) - 1 else max(bx) - x - 0.22
            if min(left, right) < 0.65:
                continue
            number = int(''.join(ch for ch in col['key'] if ch.isdigit()) or 1)
            for north in (True, False):
                z0 = mid + SPLIT_GAP / 2 if north else south_end
                z1 = north_end if north else mid - SPLIT_GAP / 2
                length = z1 - z0
                if length < 3:
                    continue
                kind = KINDS[(number - 1 + (0 if north else 1)) % len(KINDS)]
                seed = number * 2 + (0 if north else 1)
                height = 3.05 + 0.15 * ((number + (0 if north else 1)) % 3)
                name = 'pile_%s_%s_%s' % (band_id, col['key'], 'N' if north else 'S')
                mesh = build_mesh(name, left, right, length, height, seed, kind)
                mesh.materials.append(material(kind))
                obj = bpy.data.objects.new(name, mesh)
                bpy.context.collection.objects.link(obj)
                obj.location = (x, (z0 + z1) / 2, 0)
                anchor = next((a for a in col['anchors'] if a[0] == ('A' if north else 'B')), col['anchors'][0])
                obj['anchorId'] = anchor[1]
                obj['handle'] = anchor[2]
                obj['kind'] = kind
                obj['bandId'] = band_id
                obj['yardNo'] = number

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    kwargs = dict(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                  export_extras=True, export_yup=True)
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop('export_extras', None)
        bpy.ops.export_scene.gltf(**kwargs)
    print('EXPORTED', OUT, os.path.getsize(OUT))


main()
