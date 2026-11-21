# 04 · 5175 统一页面体系接入说明

## 1. 页面与路由

| 路由 | 组件 | 用途 |
|---|---|---|
| `/port/overview` | `views/port/PortOverviewView.vue` → `modules/tanggang/home/TanggangHome.vue` | **5188 原版首页**：DashboardStage + DashboardHeader + 中央 CAD 三维场景 + OverviewCards + 页脚 |
| `/port/scene-lab` | `views/port/SceneLabView.vue` | 三维隔离验证页，与 5188 源页同视口对比 |

- 首页整体照搬 5188 `App.vue` 的布局与交互，不再使用此前自定义的七导航首页。
- 两条路由懒加载，Three.js 只在进入 `/port/*` 时下载执行。
- 退出页面：`onBeforeUnmount` 停止渲染循环并释放 WebGL 资源（详见 03）。

## 2. 5188 首页复制清单

| 类别 | 文件 | 位置 |
|---|---|---|
| 页面壳 | `App.vue` → `TanggangHome.vue` | `modules/tanggang/home/` |
| 布局 | `DashboardStage.vue` | `home/components/` |
| 顶栏 | `DashboardHeader.vue`（角色、天气、时间、手机弹层） | `home/components/` |
| 卡片 | `OverviewCards.vue` / `GlassPanel.vue` | `home/components/` |
| 图表 | `TrendChart.vue`（改为 echarts 直接初始化，去掉 vue-echarts 依赖） | `home/components/` |
| 图标 | `Icon.vue` / `PortIcon.vue`（`@iconify-icons/mdi`） | `home/components/` |
| 其他 | `RegisterView.vue` / `DisplaySettings.vue` | `home/components/` |
| 演示数据 | `demo.ts` / `display.ts` / `portWeather.ts` | `home/data/` |
| 样式 | `main.css` + `responsive.css` + `port-header.css` 合并后加 `.tanggang-home` 前缀 | `home/styles/tanggang-home.css` |

说明：

- 5188 的 `.screen-stage:has(>.scene-layer)>.overview{display:none!important}` 规则被原样保留，因此三维场景存在时左右概览卡按源设计隐藏；DOM 中 5 个 `.glass-panel` 仍存在，与源页一致。
- `SceneLayer.vue`（旧场景壳）与 `pipe-lines.json` 未复制：源工程无引用，属于死代码。
- 顶栏天气使用 Open-Meteo 模型数据（源页即如此），页面明确标注“不是 51/52 泊位气象站实测”；网络不可用时显示“天气暂不可用”。

## 3. 样式收敛（防止污染 5175）

- 用 PostCSS 将三份全局 CSS 的每个选择器加 `.tanggang-home` 前缀；`:root` / `html` / `body` / `#app` 映射到 `.tanggang-home`。
- `.detail-sheet` 与 `.el-*`（抽屉挂到 body）保持全局，类名在 5175 中无冲突（`grep` 核对）。
- `@keyframes` 不动；媒体查询保留原有断点顺序（main → responsive → port-header）。
- 验证：5190 首页 0 console error；离开首页访问 5175 看板/设备/告警无样式串扰。

## 4. 角色与交互（实测）

- 点击顶栏“领导视角”打开角色弹层：领导视角 / 运行值守 / 工程师，文案“当前仅切换演示身份标签，不代表登录认证或数据访问权限”。
- 点击天气区打开“京唐港区周边天气”弹层：1°C 晴夜、湿度 37%、风速 0.7 km/h、模型时次 19:45、Open-Meteo 数据。
- 时间、日期、港区名称、CAD 来源标识、工具/系统核查、影像底图按钮、场景底部图例均由 5188 原组件渲染。
- 场景交互（旋转/缩放/标签/拾取）与源页一致。

## 5. 权限处理

- 5175 `super_admin` 实际只持有 `sys:*` 权限，`dashboard:view` 属于 `demo` 等业务角色；新路由若绑定 `dashboard:view`，admin 会被 403（首轮已复现）。
- 决策：`/port/*` 仅要求登录，不绑定页面权限码；原业务页面权限体系未改动。后续专业页面再引入独立权限码。

## 6. 不改动项

未覆盖 `DashboardView`、未改 `ThemeShell`、未改 5175 全局 CSS 与 `package.json` 中的 Three 版本，未动 5175/5188/5174 源目录与端口。新增依赖仅 `@iconify-icons/mdi`（5188 首页图标所需）。
