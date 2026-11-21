# 07 · 测试、截图与验收记录

## 1. 自动化检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx vue-tsc --noEmit` | 通过，0 error |
| 单元测试 | `npx vitest run` | 1 文件 / 9 用例全部通过 |
| 前端构建链 | `vite build` 前置的 vue-tsc 已通过（本记录未跑完整 build） | — |
| 依赖安装 | `npm ci` | 361 包，锁定版本 |
| 后端健康 | `GET /api/v1/health`（经 5190 代理） | 200 |
| 关键接口 | `GET /api/v1/dashboard/overview`、`/equipment`、`/alarms/history-stats` | 200 |

## 2. 真实浏览器实测（Chrome；截图/截图环境为 headless + swiftshader，帧率另用真实 GPU）

采集方式：Puppeteer-core 驱动本机 Chrome；QA 脚本为一次性验证工具，未纳入仓库。
原始结果：`docs/migration/screenshots/console-errors.json`、`scene-probes.json`、`parity-report.json`、`ui-check.json`、`route-smoke.json`。

### 2.1 Console / Network

- 迁移页面（5190）：**0 console error、0 pageerror、0 requestfailed**（含 WebGL 场景页）。
- 5175 回归页面：无新增错误。
- 所有 `tanggang/**` 资源 200；无 `localhost:5188` 请求。

### 2.2 场景完整性

| 指标 | 5190 首页（5188 原版） | 5188 源页 |
|---|---|---|
| 浮动标签 | 23（1920/1366/2560/3840 全部 23） | 23 |
| 堆场 | 8 个（1#–8#） | 8 个 |
| 港机 | 5 台门机 + 装船机 | 同 |
| 船舶 | 51# / 52# 泊位货轮 | 同 |
| 水池/湖 | 南/北集水池、人工湖 | 同 |
| 管网图层 | 中压除尘、雨水、市政中水、生活给水、生活污水、污泥、消防 | 同 |
| 相机取景 | 恢复 5188 原始 FOV/机位，与源页同视口一致 | 原始机位 |
| 顶栏/页脚 | 唐港51.52号泊位智慧水务、综合总览、角色、天气、时间、CAD 来源 | 同 |
| 概览卡片 | DOM 存在 5 个 `.glass-panel`；按源规则 `.screen-stage:has(>.scene-layer)>.overview{display:none}` 在三维场景存在时隐藏 | 同 |

冷启动首帧：5190 1080p 12.2s / 4K 26.3s；5188 源页 16.8s / 38.8s（同一环境、同一等待条件）。暖缓存二次进入：5–13s。

### 2.3 交互

- 顶栏“领导视角” → 角色弹层：领导视角 / 运行值守 / 工程师，含“仅切换演示身份标签”说明；截图 `5190-home5188-role.png`。
- 天气区 → 京唐港区周边天气弹层：1°C 晴夜、湿度 37%、风速 0.7 km/h、模型时次 19:45、Open-Meteo 来源与免责声明；截图 `5190-home5188-weather.png`。
- 顶栏导航、时间、日期、CAD 来源、工具/系统核查、影像底图按钮、场景底部图例均按 5188 原组件渲染。
- 场景旋转/缩放/标签/拾取沿用 5188 逻辑（23 个标签可点击）。
- 连续 3 次进入/退出 `/port/overview`：canvas 数保持 1，JS heap ≈103MB，无控制台泄漏错误。

### 2.4 帧率

| 环境 | 分辨率 | 帧率 | 说明 |
|---|---|---|---|
| 真实 GPU（Apple M2 / ANGLE Metal） | 1920×1080 | **60.5 FPS** | 3 秒 `requestAnimationFrame` 平均值，场景静止 |
| Headless + SwiftShader 软件渲染 | 1920×1080 | 0.9 FPS | 软件光栅化限制，仅供参考，不代表真实设备 |

内存：首屏加载后 JS heap ≈69MB；连续 3 次进出后 ≈103MB，canvas 仍为 1。

## 3. 截图清单（`docs/migration/screenshots/`）

| 前缀 | 分辨率 | 说明 |
|---|---|---|
| `5175-login-*` | 1920×1080 | 源底座登录 |
| `5175-dashboard-*` | 1920/1366/3840 | 源看板基线 |
| `5175-equipment-*` | 1920/1366/3840 | 源设备台账基线 |
| `5175-alarm-*` | 1920/1366/3840 | 源实时告警基线 |
| `5188-source-*` | 1920/1366/3840 | 源三维页基线 |
| `5190-scene-lab-*` | 1920/1366/2560/3840 | 迁移场景隔离页 |
| `5190-home5188-*` | 1920/1366/2560/3840 | 5188 原版首页最终效果 |
| `5190-home5188-role.png` | 1920 | 领导视角/角色弹层 |
| `5190-home5188-weather.png` | 1920 | 京唐港区天气弹层 |

## 4. 迁移过程中发现并修复的问题

| 问题 | 处理 |
|---|---|
| `/port/overview` 首轮 403 | 查明 super_admin 仅有 `sys:*`；移除新路由的 `dashboard:view` 绑定，仅要求登录 |
| 首页初版为自定义七导航，不是 5188 原版 | 完整迁入 `App.vue`/顶栏/卡片/数据/样式，首页改为 5188 原版布局，相机恢复原始参数 |
| 点击浮动标签后右侧追溯卡不更新 | 增加 `floatingDetail` → `object-select` 回传（专业页面预留） |
| 资源路径依赖 5188 端口 | 统一迁到 `public/tanggang/**`，BASE_URL 相对路径 |
| 5188 使用 `vue-echarts`、`@iconify-icons/mdi` | 图表改为 echarts 直接初始化；仅新增 `@iconify-icons/mdi` 依赖 |
| 5188 全局 CSS 会污染 5175 | PostCSS 统一加 `.tanggang-home` 前缀，抽屉类保留全局 |

## 5. 5175 关键页面回归（15 条路由）

同一 `demo` 账号，在 5175 与 5190 同时逐页访问，记录 403/空白/页面异常：

| 工程 | 路由数 | 403 | 空白 | pageerror |
|---|---|---|---|---|
| 5175 源底座 | 15 | 0 | 0 | 0 |
| 5190 迁移工程 | 15 | 0 | 0 | 0 |

覆盖：`/dashboard`、`/equipment/list`、`/equipment/types`、`/alarm/realtime`、`/alarm/history`、`/repair/list`、`/inspection/tasks`、`/maintenance/ledger`、`/water/stats`、`/energy/stats`、`/dispatch/tasks`、`/archive`、`/ai/chat`、`/system/users`、`/system/scada`。
原始结果：`screenshots/route-smoke.json`。

## 6. 遗留观察

1. 场景首屏 5–26s，与源页同量级；后续可做 GLB 分批/压缩与骨架提示。
2. 1366 宽度标签抽稀到 14 个，属设计行为；如需全量需另做聚合标签。
3. 首页 KPI 50/50/50 是“设计设备类别 / 未定位 / 未接入”的真实值，不是故障。
4. `@types/three 0.163.0` 低于运行时 0.186.1，类型检查通过；后续单独升级类型包。
