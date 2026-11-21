# 03 · 三维场景迁移与重构说明

## 1. 模块目录（新工程）

```text
frontend/src/modules/tanggang/
├── scene/
│   ├── L1WaterScene.vue            1929 行  SFC：DOM 外壳、渲染主流程、拾取、标签、审计面板
│   ├── harborRelief.ts             1048 行  港区几何/堆场/建筑/港机/船舶/水体 + GLB 装配
│   ├── harborLandmarks.ts           276 行  设施锚点坐标
│   ├── RegionEquipmentOverlay.vue   205 行  区域/设备侧栏
│   ├── GalleryStudy.vue             108 行  皮带廊道研究模式（按需异步加载）
│   ├── types/
│   │   ├── cad.ts                   263 行  CAD/系统/审计数据契约（纯类型）
│   │   └── regions.ts                       区域与设备类型
│   ├── data/
│   │   └── loadSceneDatasets.ts     139 行  取数 + 版本契约校验（不触碰 Three.js）
│   ├── config/
│   │   └── pipeLayers.ts             19 行  管网图层与系统配色
│   └── styles/
│       └── scene-shell.css          138 行  场景容器 / 4K / 窄屏适配（剔除 5188 外壳）
└── mapping/
    └── tanggangCatalog.ts           214 行  CAD→设施→资产/测点→系统 追溯层
```

## 2. 已完成的分解

| 原职责 | 现位置 | 行为变化 |
|---|---|---|
| 类型定义（约 75 行） | `types/cad.ts` | 无，纯类型外移 |
| 七个 CAD/审计 JSON 的 fetch 与校验 | `data/loadSceneDatasets.ts` | 校验条件、错误文案、告警覆盖顺序与原页一致；主 CAD 失败仍抛错 |
| 管网图例与系统配色 | `config/pipeLayers.ts` | 单一事实来源，补回室内消防/高压除尘两色 |
| 场景容器与响应式样式 | `styles/scene-shell.css` | 只保留 `.l1-*` / `.region-overlay` 规则，命名空间改为 `.tanggang-scene`，不污染 5175 |
| CAD 资源路径 | 各模块内 `tanggang/cad|models|textures` | 不依赖 5188 端口，路径随 `BASE_URL` 部署 |

`L1WaterScene.vue` 从 1935 行降到 1929 行，主要是因为类型/配置移出后仍保留了全部渲染与交互逻辑（约 1500 行）。**没有为了拆而拆**：渲染主流程、相机、拾取、标签与审计面板高度共享本地状态，强行切分会引入功能回归风险。后续拆分方案见第 6 节。

## 3. 与 5175 的集成接口

```ts
// props
initialSystemId?: string   // 顶部业务导航下发系统 id，'all' 为整体视角
showFilters?: boolean      // 默认 true；唐港首页传 false，由顶部导航控制六系统

// emits
'system-change' (id, name)
'object-select' ({ type:'anchor'|'pipe'|'yardBand'|'matchedContour', id, name, handle?, layer? } | null)

// expose
focusSystem(id)  locateRegion(id)  resetCamera()
```

- 内部 `systemModeId` 与 `initialSystemId` 双向同步；外部导航点击后场景管网、设备、相机聚焦同步变化。
- 浮动标签与点位索引选中会通过 `object-select` 回传；5188 原版首页目前不消费该事件（保留给后续专业页面/详情抽屉）。
- 隐藏的仅是内部六个系统 tab（`showFilters=false`），工具/核查入口保留。

## 4. 相机与取景等价性

首页已改为 5188 原版布局（场景占满 `.screen-stage`，左右卡片在与 `.scene-layer` 共存时按源规则隐藏），因此**恢复 5188 原始相机参数**：FOV 8.53°、距离 323.6、俯仰 16.51°，不做宽高比补偿。系统聚焦同样使用原始 FOV 34 与距离。

这样 1920×1080、1366×768、2560×1440、3840×2160 的取景与 5188 源页逐像素对齐（见 07 截图）。

## 5. 资源生命周期

- `onBeforeUnmount`：`cancelAnimationFrame`、移除 `resize` 监听、解绑 canvas `pointerdown/pointerup`、断开 `ResizeObserver`、`renderer.dispose()`、几何/材质/纹理逐项 dispose（SFC 17 处、relief 8 处）。
- 多次进出实测：连续 3 次进入/退出 `/port/overview` 后 canvas 数 = 1，JS heap ≈ 103MB，无 WebGL context 泄漏告警。
- Three.js 版本：沿用 5175 的 `three 0.186.1`；5188 为 0.185.1。迁移后 `vue-tsc` 与浏览器运行均通过，未替换 5175 `package.json`。

## 6. 后续拆分计划（不阻塞本轮验收）

1. `engine/renderer.ts`：Renderer/Scene/Camera/OrbitControls 生命周期与 resize。
2. `engine/camera.ts`：默认机位、系统聚焦、动画帧。
3. `engine/picking.ts`：raycaster、高亮、选中态。
4. `engine/labels.ts`：屏幕投影标签与抽稀。
5. `engine/pipes.ts`：管网 InstancedMesh、流动粒子、图层开关。
6. `components/audit/*`：断点核查、管线审计、点位索引三个面板。
7. 每步以 `5190-scene-lab` 与 5188 源页同视口截图为回归门槛，失败回滚。
