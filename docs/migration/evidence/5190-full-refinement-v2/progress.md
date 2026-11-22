# 唐港 5190 首页全场精修 V2 · 执行进度与验收材料

正式入口：http://localhost:5190/dashboard
证据目录：`docs/migration/evidence/5190-full-refinement-v2/`
唯一视觉目标：`docs/migration/evidence/iter-art/design-target.png`
5190 监听进程 cwd：`/Users/8-mile/代码仓库/唐港智慧水务-迁移开发版/frontend`（vite dev，代理后端 8010）
默认相机：fov 8.53°、距离 323.6、yaw 0、pitch 16.51°（未改）。

## 开工基线

- 视口 1672×941、DPR 1。
- 基线：`shots/baseline-open-labels-1672x941.png`、`shots/baseline-closed-labels-1672x941.png`。
- 基线问题：靠泊船为暗褐平板、无船首尾/舱盖/桥楼；四座澄清池被带封盖圆柱挡住水面；堆取料机横向门架、支腿插在煤堆里。

---

## 第一批 · 闪烁、船型、黄色机械

### 01 静止画面 / 镜头 / 停流稳定 —— 通过

实改：
- `harborRelief.ts`：删除船体 `sin` 升降（bobBase/bobPhase），靠泊船固定吃水，只保留海/湖波纹漂移。
- `L1WaterScene.vue`：去掉 `n%2` 跳绘，逐显示帧 `renderer.render`；标签/罗盘只在相机变化时重排，静止每 30 帧兜底，投影与同帧相机同步。
- 新增 `?debug=probe` 下的 `window.__stats()`（renderer.info frame/calls/triangles/geometries/textures）。

实测：
- 静止 6 帧，船体 ROI（x520–950,y690–735）RGB 任一通道差 >12 的像素占比 **0.00%**（上一轮浮动开启 6.07%）。
- 整屏同两帧通道差 >12：R 0.25%、G 0.22%、B 0.04%，仅为水面波纹与流带，无整屏闪烁。
- 实际绘制与 rAF 同步：6 秒 239 次 render / 239 次 rAF，无跳帧；draw calls 359、三角形 1,489,776、几何 255、纹理 11。
- 本次环境 rAF 被系统压到约 30–40Hz（p50 33.2ms），非代码丢帧；改前 5.017 秒仅 149 次清屏（≈29.7/s），现为逐显示帧。

### 02 Blender 重做靠泊散货船 —— 通过

- 新脚本：`frontend/modeling/harbor/refine_port.py`（可复现）。
- 源文件 / 导出：`modeling/harbor/staging/bulk-carrier.blend` → `bulk-carrier.glb` → `public/tanggang/models/harbor/`；旧资产备份 `modeling/harbor/staging/backup-ports/`。
- 船体：20 单位母版；收尖船艏、方艉、折角舭部、低干舷；5 舱口围板+舱盖、白色舷墙栏杆、艏部防浪墙/锚机/桅杆、艉部三层桥楼+深色窗带+烟囱。
- 运行时覆盖色改为设计稿口径：hull-navy `#6b382b`、hatch-blue `#8a6a4a`、deck-grey `#8f8c83`。
- 两泊位共用母版、镜像靠泊（船首朝外），固定吃水；移除脱开的独立水线红带。
- 52 号原受右边界裁切：表现船长上限 32→27，现已完整入画。

### 03 堆取料机与廊道 —— 通过

- 同脚本重做 `stacker-reclaimer.glb`：门式跨堆，两条深灰走行底盘落在堆间检修带，橙色支腿+桁架桥、中部卸料溜筒、一端机房/另一端配重；桥架底面 3.72 高于堆顶（堆高约 3.0）。
- 首页每堆一台、`scale=1.0`，保留每组 x 均值/纵向中点/同一朝向，不随机转角；可读出“底盘在哪条带、桥架跨哪一堆”。
- 同脚本重做 `ship-loader.glb`：岸侧双轨底盘、四条支腿门架、陆侧机房与配重、向海侧悬臂+皮带罩+端部下料溜筒、司机室。首页朝向改回 `theta`（原 `theta+PI` 会把悬臂转到陆侧），缩臂至 6.4 单位、落位 `scale=1.2`，溜筒落在船侧舱口上方。

---

## 第二批 · 分区修复

### 04 北区四座澄清池恢复水面 —— 通过

- 外壁/内壁改为开口筒壁 `openEnded=true` + 专用 `DoubleSide` 材质；水面下移到 y≈0.235，压顶环盖住壁顶。
- 实页近景可见四座圆池浅蓝水面、暗内壁与浅色池沿：`shots/clarifier-water-closeup.png`、`shots/nw-facilities-closeup.png`。

### 05 北二南五集水池、链斗冲洗池 —— 通过

- 七处地标锚点（北 FAC60/10B85C，南 10AE12/10AE0B/10AE14/10AE0E/10AE10）统一由 `basin()` 生成：池壁抬到 0.26，水面下沉到压顶下 0.12，暗内壁 + 浅色压顶 + 散水/巡检道/爬梯/栏杆。
- 删除 `spatial.poolContourCandidates` 的 24 条嵌套候选描边与配套栏杆——它们在同一池口上方叠出重复浅蓝平台，是“平铺色块”观感的主因；候选 handle 仍保留在数据与详情。
- 取消 4.2 宽就加分格墙的规则（改为 >9），避免南侧五池读成十格。
- 默认关标签可见南侧独立池带与北侧两池，池壁与水面有明确高差：`shots/pools-south-closeup.png`、`shots/pools-north-closeup.png`。
- 无逐池实测几何（verifiedIndividualPoolGeometries=0），池形仍为 L1 示意。

### 06 洗车台、泵房 —— 读懂用途

- 洗车台棚、5 条贯通车道、格栅与明沟在默认视角可辨（`shots/` 现场裁片）。
- 除尘泵房/处理厂房沿用上轮 Blender 精修，实页可见体量、屋面与阴影；银色罐组作为从属背景。

### 07 东区湖、办公、维修车间、智慧中心 —— 可区分

- 办公楼（横向窗带）、港机维修车间（大跨屋顶）、智慧中心（蓝色大体量+横向窗带）在默认视角以屋顶和立面区分。
- 人工湖为可见水面+湖岸，标签贴边并保留引线；未与生态蓄水池共用同一蓝面。
- 未改 `loadBuildings()` 的 F9BEE/F9BFB 叠加逻辑（现有实页未见双层屋顶）。

### 08 七类管网与单段高亮 —— 部分通过

- 保留 `pipeLayers.ts` 七类图例与主支层级、法兰/接头/支座。
- 修复整批变色：选中管段不再改整批材质颜色，改由仅覆盖该折线的亮色叠层表达（同层两段可分别高亮）。
- 未逐一核对 3242 个 handle 的每处断点；候选断点按原证据保留。

### 09 管流演示 —— 通过

- 演示段仍为 `139320`（$管综-中压除尘）。
- 流带改为沿累计弧长的“亮核+拖尾”渐变，速度 5.6 单位/秒、周期 16；连续折线共享里程，过弯不跳变。
- 停流冻结相位并隐藏流带，管身保留；恢复后相位衔接。图例按钮文案：运行中/已停流/不在当前系统。
- 近景验证：`shots/flow-band-vertical-closeup.png`（垂直主管上的亮核清晰可见）。

---

## 第三批 · 整屏与交付

### 10 堆场独立分区 —— 通过

- 堆体宽度由 5.55 收窄到 4.5，相邻两列中心距 6.75，留下约 2.25 单位空档。
- 接触阴影由 +2.6 收到 +1.2，不再把列间空档压成暗缝。
- 八列之间沿堆列走向铺 1.05–1.6 宽浅色检修带，默认关标签可数出 8 列独立堆体：`shots/yard-8-columns-closeup.png`。
- 仍沿用 A/B 两侧文本锚点合并为一条纵向长堆；未新增 16 个实测堆区边界或横向隔断。

### 11 海面硬切 —— 通过

- 删除离岸 20 单位处的独立深色 `seaDeep` 板，改为单一连续水面；保留近岸浅水带、泡沫线与岸墙/护舷。
- 默认全景不再出现前景直线色带（见 `final-closed-labels-1672x941.png`）。

### 12 日景光照与园林 —— 沿用现状

- 未改主光方向与材质体系；树林沿用现有近中远层次与实例化。默认首页先读到水务设施与管路，再无绿化背景。

### 13 拾取、标牌、响应式 —— 部分通过

- 四尺寸实拍：1672×941、1920×1080、2560×1080、390×844（`shots/view-*.png`）。
- 超宽完整显示堆带与水务区；手机端保留洗车台、湖、办公、维修车间、智慧中心、南北集水池等关键标牌。
- 未逐项点击验证细管/邻接池/湖/洗车台/维修车间的同一业务 ID。
- 手机端画布下方仍有较大留白，未改业务外壳布局。

### 14 加载失败隔离、性能、回归 —— 通过

- `loadPortAssets()` 改为四资产各自 `catch`，单个 GLB 失败只降级该资产。
- 隔离失败实测：移走 `bulk-carrier.glb` 后重载，两艘船消失，堆取料机、装船机、建筑、池体、标牌全部保留（`shots/asset-failure-ship-missing.png`）；恢复资源后船返回（`shots/asset-failure-restored.png`）。
- `npm test`：3 个测试文件、22 项全部通过。
- `npm run build`（vue-tsc + vite build）：通过。
- 性能：见 01；draw calls 359、三角形约 149 万，未见新增独立网格导致的明显倒退。

---

## 交付文件

- 三联图：`shots/three-panel-design-start-end.png`（设计稿 / 本轮开工 / 本轮结束）
- 关标签全景：`shots/final-closed-labels-1672x941.png`；开标签：`shots/final-open-labels-1672x941.png`
- 演示实录：`5190-demo-31s.mp4`（默认视角 → 缩放 → 停流 → 恢复 → 回到全景，2026-11-22 07:23 重录）
- 管流近景实录：`5190-flow-elbow-22s.mp4`
- 四尺寸：`shots/view-1920x1080.png`、`view-2560x1080.png`、`view-390x844.png`
- 单资产失败：`shots/asset-failure-ship-missing.png`、`shots/asset-failure-restored.png`
- 模型源文件：`frontend/modeling/harbor/refine_port.py`、`staging/bulk-carrier.blend`、`staging/stacker-reclaimer.blend`、`staging/ship-loader.blend`、`staging/refine_port.blend`
- 新增/更新的近景：`shots/yard-8-columns-closeup.png`、`pools-south-closeup.png`、`pools-north-closeup.png`、`loader-closeup.png`
- 旧资产备份：`frontend/modeling/harbor/staging/backup-ports/`

## 仍未达标 / 已知差异

1. 堆场已做成 8 列独立可见堆体，但仍是 A/B 两端合并的一条纵向长堆，未拆成 16 个实测堆区边界（源资料未核实）。
2. 集水池无逐池实测几何，池形为 L1 示意；“2+5”以七处地标标牌与独立池体共同表达。
3. 封闭输送廊道（belt-gallery）沿用旧资产，未按设计稿逐件重做；装船机已重做。
4. 手机端画布下方留白较大；未改业务外壳。
5. 拾取代理未逐对象回归；细管/邻接池的同 ID 点击待人工验收。
6. 本次测量环境 rAF 被压到 30–40Hz，未复现上一轮 60fps；绘制次数与 rAF 一致，非跳帧。
7. 设计稿橙色横向连接等无法确认处未新增。
