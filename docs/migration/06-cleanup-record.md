# 06 · 清理记录

清理原则：**只在新工程内做导入过滤，不删除、不改写 5175/5188/5174 源目录任何文件。**
清理前用 `grep` 做过引用核对；每条剔除都能用“无引用”证明。

## 1. 未迁入的 5188 文件

| 文件/目录 | 体积 | 剔除理由 | 依赖证明 |
|---|---|---|---|
| `src/components/SceneLayer.vue` | 363 行 | 旧版场景壳，与 L1WaterScene 重复 | `grep -rn "SceneLayer" src` 仅自身定义，无引用 |
| `public/cad/pipe-lines.json` | 600K | 仅被 SceneLayer 使用 | 同上，无其他引用 |
| `public/cad/l1-v2_1` | 15M | V2.1 历史资产，无代码引用 | 代码仅请求 v2_2/2_3/2_5/2_6/2_7/2_8 |
| `public/cad/l1-v2_9` | 66M | V2.9 未接入代码，属后续审计资料 | `grep -rn "l1-v2_9" src` 无结果 |
| `public/cad/**/*.zip`、`*.png` 截图 | 大量 | 源图/截图归档，不参与运行 | 仅 CSV/JSON 被页面链接 |
| `public/qa` | 362M | QA 过程产物 | 无代码引用 |
| `public/cad/l1-v2_2/review.html` | 13K | 调试页内硬编码 `localhost:5188` | 迁入会重新引入源端口依赖；已改链到 `tanggang/audit/cad-review/v2/index.html` |
| `public/cad-review/**/*.zip` | — | 打包归档 | 仅保留 HTML/JSON/PNG/SVG/CSV 证据页 |
| `public/brand.svg` | — | 仅源 index.html 的 favicon | 新工程 favicon 沿用 5175，不参与页面渲染 |

5188 的 `App.vue`、`DashboardHeader/OverviewCards/GlassPanel/Icon/PortIcon/TrendChart/RegisterView/DisplaySettings`、`data/*`、`styles/*` 已复制到 `modules/tanggang/home/`（首页改为 5188 原版），不再列为剔除项。

## 2. 新工程内删除

本轮**未删除任何 5175 业务代码**。迁移模块内所有文件均有引用：

- 19 个 GLB：全部在 `harborRelief.ts` 的 `loadGallery/loadPortAssets/loadBuildings/loadTrees/loadProcessBuildings` 中出现。
- 2 张纹理：`harborRelief.ts` 堆场材质使用。
- `GalleryStudy.vue`：`L1WaterScene.vue` 异步组件引用（研究模式）。
- 审计证据页：仅通过场景内“核查 CAD”链接手工访问，不参与首屏请求。

## 3. 资源路径改写（非删除）

| 原路径 | 新路径 |
|---|---|
| `cad/l1-v2_*` | `tanggang/cad/l1-v2_*` |
| `models/harbor/*.glb` | `tanggang/models/harbor/*.glb` |
| `textures/harbor/*.jpg` | `tanggang/textures/harbor/*.jpg` |
| `/cad-review/index.html?...` | `/tanggang/audit/cad-review/index.html?...` |
| `/cad/l1-v2_2/review.html` | `/tanggang/audit/cad-review/v2/index.html` |

## 4. 回滚

- 已按用户要求与原有 Git/GitHub 仓库彻底切割：旧 `.git` 元数据与历史已删除，仓库重新初始化。
- 当前唯一远程为 `https://gitee.com/xia-weidong/Smart-Water-Affairs-TanShan.git`，默认分支 `feat/v44-consolidated-operations-ux`，无任何提交。
- 工作区文件全部保留；后续不自动提交、不推送。源项目 5175/5188/5174 的 Git 配置不受影响。
