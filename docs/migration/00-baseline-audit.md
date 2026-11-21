# 00 · 基线审查（只读）

审查时间：2026-11-21
审查方式：目录/源码静态核对 + 真实浏览器截图（Chrome Headless，swiftshader WebGL）。
本轮所有源目录均未做写操作；唯一的例外是本轮之前按用户要求修复 5175 SQLite 损坏索引（见「既有运行时修复」）。

## 1. 路径确认

| 角色 | 用户给定路径 | 实际确认 | 结论 |
|---|---|---|---|
| 5175 底座 | `/Users/8-mile/代码仓库/唐港智慧水务` | 仓库根：`backend/ ai-service/ frontend/ scada-gateway/ deploy/ docs/`；Vite 根为 `frontend/` | 以仓库根整体复制，Vite 根为 `frontend` |
| 5188 三维源 | `/Users/8-mile/Downloads/industrial-operations-screen` | 独立 Vite 工程，`src/components/L1WaterScene.vue` 等 | 只读取所需源码与资源 |
| 5174 业务参考 | `/Users/8-mile/Desktop/代码仓库/...` | **实际位于** `/Users/8-mile/代码仓库/唐山港智慧水务系统/Smart-Water-Affairs-TanShan`（apps/artifacts/docker-compose） | 仅作为需求参考，未迁移、未修改 |
| 新工程 | `/Users/8-mile/代码仓库/唐港智慧水务-迁移开发版` | 不存在 → 新建 | 未覆盖任何已有目录 |

监听 5175 的进程 cwd 已确认为 `.../唐港智慧水务/frontend`，与 `vite.config.ts` 一致；旧地址 `/Users/8-mile/代码仓库/运管平台/frontend` 未使用。

## 2. 5175 技术栈与结构

- Vue `3.5.13` / Vue Router `4.5.0` / Pinia `2.3.0` / Element Plus `2.9.1` / ECharts `6.1.0` / Vite `5.4.11` / TypeScript `5.6.3`
- Three.js 已存在：`three 0.186.1`，`@types/three 0.163.0`
- 后端 FastAPI + SQLAlchemy + SQLite，`app/api` 下 24 个业务路由模块
- 前端 `src/views` 15 个目录（dashboard、equipment、alarm、inspection、repair、archive、ai、system 等）
- 布局：`src/themes/ThemeShell.vue` + `src/themes/layouts`（左侧菜单），并非原 EmberLayout；唐港首页采用独立顶部导航布局，未改动该布局
- 权限：路由 `meta.perm` + 前端守卫；实测 `admin`（super_admin）只持有 `sys:*` 权限，`demo` 用户持有 `dashboard:view` 等业务权限
- 主题：`src/themes/tokens/harbor.css` + 页面级 CSS 变量、磨砂卡片、12–18px 圆角、浅蓝灰底

## 3. 5188 三维工程结构（按真实依赖核对）

- `src/components/L1WaterScene.vue`（约 1935 行）：页面外壳 + Three.js 场景 + 六系统筛选 + 标签 + 拾取 + 审计工具
- `harborRelief.ts`：港区地形、堆场、建筑、港机、船舶、水体、GLB 模型装配
- `harborLandmarks.ts`：设施锚点坐标
- `RegionEquipmentOverlay.vue`：区域/设备侧栏
- `GalleryStudy.vue`：皮带廊道剖面研究模式（场景内按需异步加载）
- `src/types/regions.ts`：区域与设备类型
- 运行期实际请求的 CAD 数据：`scene-v2.2.json`(773KB, 2621 线/23 锚点/4 堆场带/3 匹配轮廓)、`region-equipment-v2.3.json`(10 区域/49 设备)、`systems-v2.5.json`(6 系统)、`spatial-candidates-v2.6.json`、`V2.7_管线显示覆盖审计.json`、`chain-bucket-cad-v2.7.json`、`V2.8_断点三维核查标记.json`
- 资源：`public/models/harbor` 19 个 GLB、`public/textures/harbor` 2 张 JPG，全部有代码引用
- 未使用：`SceneLayer.vue`（旧版场景，无任何引用）、`App.vue` 外壳、`styles/*` 全局样式、`public/qa`(362MB)、`public/cad-review` 中的 ZIP/截图

## 4. 基线截图与实测

截图目录：`docs/migration/screenshots/`

| 页面 | 分辨率 | 结果 |
|---|---|---|
| 5175 登录 / 看板 / 设备 / 告警 | 1920×1080、1366×768、3840×2160 | 均正常渲染，页面与图表完整 |
| 5188 源三维 | 1920×1080、1366×768、3840×2160 | 正常；冷启动首次出图 16.8s(1080p)/38.8s(4K)，labels=23 |
| 5190 迁移工程 | 同左 + 2560×1440 | 5188 原版首页：顶栏、角色/天气弹层、CAD 场景、管网图例、23 个浮动标签完整 |

- Console 错误：0；失败请求：0（`console-errors.json`）
- 场景对象：23 个锚点标签、8 个堆场、南/北集水池、人工湖、除尘泵房、污水处理场、岸线、船舶、5 台门机、管网图层
- 已知工程疑点保持原样：V2.8 候选断点、V2.7 未显示审批管段、池体单体检出未核实等，未声称已修复

## 5. 既有运行时修复（非本轮迁移改动）

迁移开始前，按用户要求修复了 5175 后端 `/api/v1/equipment` 500：SQLite `idx_tag_ts` 索引页损坏，通过 `.recover` 重建数据库，`scada_tag_data` 2,853,009 → 2,852,962 行（约 47 行损坏页采样丢失）。该修复发生在 5175，属于上一轮用户授权动作；本轮未再改动。

## 6. 基线问题清单

1. 5188 场景冷启动慢（10–40s，取决于分辨率与缓存），迁移后保持一致。
2. `@types/three 0.163.0` 低于运行时 `three 0.186.1`；`vue-tsc` 通过、运行正常，后续建议仅升级类型包。
3. 5175 super_admin 无 `dashboard:view`，新路由未绑定该权限码（详见 04）。
4. 1366 宽度下场景按设计做标签抽稀（23→14），非加载缺失。
