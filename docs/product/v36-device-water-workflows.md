# 唐港智慧水务 V3.6：设备运维与水务计算的业务衔接

日期：2026-11-17
原项目：Smart-Water-Affairs-TanShan
服务：localhost:5174，不另建工程、不打ZIP
Git：V3.5基线 6fede79；工作分支 feat/v36-device-water-workflows

## 本轮重点

不是新增菜单或重做SCADA，而是修复现有工作台的上下文丢失、数据不一致以及跨工作台无法追溯的问题。

### A. 设备完整工作链

新增复用组件 AssetJourney.vue，显示真实本地Store内的设备编号、名称、当前未关闭告警数、工单数、巡检数和资料数。导航连接：

- 设备台账：/operations/assets?assetId=...
- 运行事件：/operations/events?assetId=...
- 工单：/operations/workorders?assetId=...
- 巡检：/operations/workorders?assetId=...&tab=inspections
- 健康诊断（仅泵类可用）：/decision/health?assetId=...
- 设备档案：/archives?assetId=...

组件本身不落业务数据、不创建工单；不同来源只按设备编号筛选，不声明同根因、不合并不同事件。

修复的操作问题：
- 工单和巡检都按设备ID过滤；巡检新增表单默认带入此设备；
- KPI卡、工单/巡检Tab计数同步当前设备，不再混用全站数字；
- 用户切换工单设备过滤时同步到URL，重置时解除URL设备作用域；
- 设备健康页手工切换设备时同步URL，使刷新和深链保留选中设备；
- 事件中心设备作用域过滤列表和顶部统计，不使用全站KPI冒充单设备KPI；允许解除筛选；
- 无效设备编号不会显示虚构设备或对应统计。

### B. 多水源到绿色效益：指定草稿，不再取错版本

在水源匹配草稿列表，新增每个草稿的“按此编号核算成本”入口，带独立WS草稿ID。

成本效益页：
1. 展示来源草稿ID及验证状态；
2. 不自动覆盖当前成本条件，必须点击“确认导入此编号并重新核算”；
3. 仅读取**精确匹配**草稿ID；草稿缺失、来源不对、输入无效、重新检验不满足供水条件时直接阻断；
4. 成本与效益均由本页重新运行模型，不复制供水建议的旧节约结论；
5. 继续保留人工复核和成本重复计价约束；无真实财务收益主张。

纯函数：demo/proposalDrafts.ts 中 resolveSupplyDraft()。

### C. 雨前调蓄到四预：只共享雨量，不共享未经核实的池体

调蓄页可以向四预传递当前降雨量（mm），四预接受前显示来源与警示。

- 由操作者明确确认传入的雨量；
- 仅修改四预的 rainMm，保留其独立汇水面积、库容、流量及分区；
- 点击确认后执行原 runRain 模型重算；
- 不代表两模型针对同一个池体、同一合法水路，也不发出泵阀控制命令。

### D. 数据与系统边界

所有更改仍在原本地MOCK/人工数据模型；没有接入SCADA、数据库、环保测站或现场审批系统。当前无正式多人事务、后台24小时巡检与控制授权；不通过前端UI模拟冒充生产运行。

## 文件变动

新：components/AssetJourney.vue、demo/v36-workflow.test.ts、tests/e2e/v36-device-water-workflow.spec.ts。

修改：views/AssetsView.vue、WorkOrdersView.vue、HealthView.vue、EventCenterView.vue、MultiSourceView.vue、GreenBenefitView.vue、WaterDispatchView.vue、FourPreView.vue、demo/proposalDrafts.ts。

原业务路径、异步路由、原工艺图、AI工作台和数据结构均保留。

## 验收

- 指定设备P002从台账进入巡检、工单、健康、档案；新增巡检默认P002。
- 事件中心只显示P002事件，解除过滤不会改变报警状态。
- 新建WS草稿可按其ID进入效益核算；确认前不覆写参数。
- 草稿ID丢失/损坏时阻断，不退回最新草稿。
- 调蓄页传雨量120mm到四预；确认前保留原值，确认后才重算。
- 旧完整回归覆盖设备、告警、工单、报告、AI、三水源等原功能。

单元与浏览器专项分别运行，完整全量以本机 /tmp/tanggang_v36_verify.log 为准。

## 页面排版复查

在实际5174运行页面上检查了1600、1366、390px视口。设备档案使用三栏Grid；V3.5内部工作区导航和本轮设备快捷条明确跨3栏，设备树与主内容仍在同一行（1600和1366均无全页横向溢出）。
手机390px时设备目录限制为270px可滚动区域，使主操作区从约1507px提前到767px；页面仍以桌面操作为主。
图片保存在 docs/design/v36-asset-workflow-1600.png、v36-asset-workflow-1366.png、v36-asset-workflow-390.png。

## 最终自动化结果（2026-11-17）

- 完整：WATER_E2E_PORT=5397 pnpm verify，退出码0；API单元测试14/14，Web单元测试273/273；浏览器284/284，双视口，生产构建/TypeScript/ESLint通过。
- 布局修复后专项复测：WATER_E2E_PORT=5398 pnpm exec playwright test tests/e2e/v36-device-water-workflow.spec.ts，12/12通过，包括手机390px设备目录滚动限制，退出码0。
- 日志：/tmp/tanggang_v36_verify.log、/tmp/tanggang_v36_targeted_final.log（本地开发机）。
- 实际运行检查：5174原服务维持HTTP200，设备页1600/1366px仍为三栏、无整页横向溢出；390px主操作区距顶约767px，设备树可独立滚动。
- 自动化仅代表MOCK系统软件验证，并非SCADA实时接入或现场控制/合规放行。
