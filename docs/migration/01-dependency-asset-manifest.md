# 01 · 依赖与资产清单

完整逐文件清单（源路径、新工程路径、大小、SHA256 前 16 位、处理说明）见 [asset-manifest.md](./asset-manifest.md)，共 66 项。

## 1. 迁移范围

| 类别 | 数量 | 说明 |
|---|---|---|
| 场景源码 | 6 | `L1WaterScene.vue`、`harborRelief.ts`、`harborLandmarks.ts`、`RegionEquipmentOverlay.vue`、`GalleryStudy.vue`、`types/regions.ts` |
| 首页源码 | 14 | `TanggangHome.vue`（源自 App.vue）、9 个组件、3 份 data、1 份合并样式 |
| 新增拆分模块 | 4 | `scene/types/cad.ts`、`scene/data/loadSceneDatasets.ts`、`scene/config/pipeLayers.ts`、`scene/styles/scene-shell.css` |
| 业务映射模块 | 1 | `src/modules/tanggang/mapping/tanggangCatalog.ts` |
| CAD/管网/系统 JSON | 7 | scene-v2.2 / region-equipment-v2.3 / systems-v2.5 / spatial-v2.6 / pipe-audit-v2.7 / chain-bucket-v2.7 / continuity-v2.8 |
| 审计 CSV | 6 | V2.2 堆场证据、设施轮廓关联、V2.3 区域水路/设备对应、V2.7 覆盖统计、V2.8 高疑点位、V2.8 端点台账 |
| GLB 模型 | 19 | 全部被 `harborRelief.ts` 显式加载，非按体积判断，无废弃模型 |
| 纹理 | 2 | `ore-grain.jpg`、`ore-normal.jpg`，堆场地表材质 |
| 审计证据页 | 11 | `cad-review` 的 HTML/JSON/PNG/SVG/CSV，手工访问，不参与首屏加载 |

首页已改为 5188 原版布局，`App.vue`、顶栏、卡片、图表、角色/天气弹层、样式全部迁入；唯一未迁入的组件是源工程无引用的 `SceneLayer.vue`。

## 2. 真实运行依赖判定依据

- `L1WaterScene.vue` 的 `fetch(...)` 全部改为 `import.meta.env.BASE_URL + 'tanggang/cad/...'`，无 `localhost:5188` 依赖。
- GLB 与纹理路径统一改为 `tanggang/models/harbor/`、`tanggang/textures/harbor/`，由 `harborRelief.ts` 异步加载。
- 6 个系统的设备数量与区域来自 `systems-v2.5.json` 的 `areaEquipment`，不是按文件名推断。
- `SceneLayer.vue`、`App.vue`、`src/styles/*`、`public/qa`、ZIP/截图、`public/cad/l1-v2_2/review.html` 均无引用或依赖 `localhost:5188`，未迁入。

## 3. 体积

| 目录 | 大小 | 说明 |
|---|---|---|
| `frontend/public/tanggang` | 约 12MB | CAD JSON + GLB + 纹理 + 证据页（不含 362MB qa 与 ZIP） |
| `frontend/src/modules/tanggang` | 约 0.3MB | 场景源码与映射层 |

## 4. 校验方式

```bash
cd frontend
node -e "const fs=require('fs');..."   # 见 asset-manifest.md 内 SHA256 列
npx vue-tsc --noEmit
npx vitest run
```

浏览器网络面板复核：5190 页面所有 `tanggang/**` 请求均返回 200，无 `5188` 域名或端口请求。
