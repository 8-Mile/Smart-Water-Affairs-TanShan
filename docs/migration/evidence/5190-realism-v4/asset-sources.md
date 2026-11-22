# 5190 真实感升级 · 资产来源与许可

- 生成日期：2026-11-22
- 存放目录：`frontend/public/tanggang/environment/`、`frontend/public/tanggang/textures/harbor/`
- 所有外部资产均为 CC0（可商用、无需署名）；本项目仍保留来源记录。

## 天空 / 环境光照

| 文件 | 来源 | 许可 | 说明 |
|---|---|---|---|
| `environment/syferfontein_clear_puresky_2k.hdr` | Poly Haven · `syferfontein_18d_clear_puresky` | CC0 | 2K 等距柱状 HDR，晴天；太阳方位≈35.95°、高度≈18.4° |

下载地址：`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/syferfontein_18d_clear_puresky_2k.hdr`

## PBR 贴图（AmbientCG，1K 下载后统一降到 512px 以控制体积）

| 目录 | 资产 ID | 许可 | 用途 |
|---|---|---|---|
| `textures/harbor/pbr/asphalt/` | `Asphalt012` | CC0 | 场内道路 |
| `textures/harbor/pbr/concrete/` | `Concrete034` | CC0 | 堆场场坪 |
| `textures/harbor/pbr/bark/` | `Bark016` | CC0 | 树干 |
| `textures/harbor/pbr/grass/` | `Grass005` | CC0 | 绿化带 |

下载地址模板：`https://ambientcg.com/get?file=<AssetID>_1K-JPG.zip`

每套保留 `color`、`normal`（NormalGL）、`rough` 三张；金属度未使用的资产不纳入仓库。

## 程序化生成资产

| 文件 | 生成方式 | 说明 |
|---|---|---|
| `textures/harbor/tree-leaves.png` | `/tmp/make_leaf_atlas.py`（PIL，固定随机种子 20261122） | 1024² 透明叶片图集，用于 alphaTest 树冠 |
| `models/harbor/tree-broad.glb` 等 3 个 | `frontend/modeling/harbor/refine_trees.py`（Blender 5.2.2） | 树干 + 交叉叶片面片，原点在根部 |
| `models/harbor/{canteen,inspection,…}.glb` 共 11 个 | `frontend/modeling/harbor/refine_all_buildings.py` + `harbor_kit.py` | 按原 GLB 包围盒重建的参数化立面，尺寸与落位不变 |

## 复用保留

- `bulk-carrier.glb`、`ship-loader.glb`、`stacker-reclaimer.glb`、`belt-gallery.glb`、`wash-station-l1.glb`：沿用既有 Blender 资产，未在本轮重建。
- 原有 `ore-grain.jpg` / `ore-normal.jpg`：继续用于煤堆/矿料表面。
