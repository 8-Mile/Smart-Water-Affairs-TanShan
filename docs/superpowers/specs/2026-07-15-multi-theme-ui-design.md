# 多风格 UI 主题设计（交付差异化）

**日期：** 2026-07-15  
**状态：** 待实现  
**版本：** 1.0  
**关联产品：** 生产运维管理系统 1.0.0  

---

## 1. 背景与目标

项目将交付给 **多个使用方**。业务能力可同源，但界面不能一眼看出是「同一批模板」做出来的。

### 目标

1. 提供 **4 套** 可交付风格，布局骨架与视觉语言明显不同。
2. **交付包写死主题**（构建时配置），使用方界面 **无主题切换入口**。
3. **开发环境** 可快速预览/切换 4 套，便于验收与演示。
4. **业务页面不复制**：工单、SCADA、档案等视图共用；差异集中在壳层（登录 + 主布局 + 全局 token）。

### 非目标

- 不做多租户运行时按用户动态换肤（SaaS 租户主题）。
- 不拆 4 套独立前端仓库或 4 套业务页面树。
- 不在本期做完全自定义品牌插画/插图包（可用 CSS 几何/渐变区分）。
- 不改后端 API 契约（主题纯前端）。

---

## 2. 已确认决策

| 项 | 决策 |
|----|------|
| 分配方式 | **D**：生产 `VITE_UI_THEME` 写死；开发可切换 |
| 差异程度 | **2**：配色 + **布局骨架不同** + 登录版式不同 |
| 实现路径 | **B**：主题注册表 + 多套 Layout/Login 皮肤组件 |
| 四套 ID | `harbor` / `slate` / `orchid` / `ember` |

---

## 3. 四套风格规格

### 3.1 `harbor` — 水利深蓝政务（默认，贴近现状）

| 维度 | 规格 |
|------|------|
| 气质 | 稳重、政务/水务信息化 |
| 布局 | **左侧深色侧栏**（约 220px）+ **白色顶栏** + 浅灰内容区 |
| 主色 | 深蓝 `#1677ff` / 侧栏 `#001529` |
| 圆角 | 中等（6–8px） |
| 登录 | 全屏蓝绿渐变背景 + **居中白卡片** |
| 字体 | 系统中文无衬线（YaHei / PingFang） |
| 密度 | 常规 |

### 3.2 `slate` — 现代 SaaS

| 维度 | 规格 |
|------|------|
| 气质 | 商业后台、清爽、偏海外 Admin |
| 布局 | **顶栏主导航**（一级菜单横排）；二级在内容区 **左侧浅色次导航** 或顶栏下拉；无传统深色 full-height 侧栏 |
| 主色 | 石板蓝灰 `#0f766e`（青绿）或 `#2563eb`；整体浅灰 `#f8fafc` |
| 圆角 | 偏大（10–12px） |
| 登录 | **左右分栏**：左品牌说明区，右表单 |
| 字体 | 更偏 Inter 风格 fallback：`Inter, system-ui, ...` |
| 密度 | 略松 |

### 3.3 `orchid` — 轻量卡片协作风

| 维度 | 规格 |
|------|------|
| 气质 | 企业协作、柔和、留白 |
| 布局 | **浅色侧栏**（白/浅紫灰）+ 内容区 **大圆角卡片容器**；侧栏可带细分割而非厚重色块 |
| 主色 | 紫系/兰紫 `#7c3aed` |
| 圆角 | 大（12–16px） |
| 登录 | 浅色全屏 + **居中轻阴影卡片**，可选顶部细色条 |
| 字体 | 系统无衬线，字重略轻 |
| 密度 | 宽松 |

### 3.4 `ember` — 运维监控深色

| 维度 | 规格 |
|------|------|
| 气质 | 值班大屏、工业运维 |
| 布局 | **整体深色**；**顶栏信息条**（标题 + 用户）+ **左侧窄图标/文字侧栏**（深底）+ 内容深灰底 |
| 主色 | 琥珀/橙强调 `#f59e0b`，辅色青 `#22d3ee` |
| 圆角 | 小（4px），偏硬朗 |
| 登录 | 深色全屏 + **工业风表单**（细边框、无大白卡片或半透明面板） |
| 字体 | 等宽点缀标题可选；正文无衬线 |
| 密度 | 紧凑 |

> 四套对比时：截图同一登录页 + 同一工作台路径，应在 3 秒内能分清「不是同一皮肤改色」。

---

## 4. 架构

### 4.1 主题注册表

```text
frontend/src/themes/
  types.ts              # ThemeId, ThemeDefinition
  registry.ts           # 注册 4 套，校验默认主题
  tokens/
    harbor.css
    slate.css
    orchid.css
    ember.css
  layouts/
    HarborLayout.vue    # 可由现 MainLayout 迁移
    SlateLayout.vue
    OrchidLayout.vue
    EmberLayout.vue
  login/
    HarborLogin.vue     # 可由现 LoginView 迁移
    SlateLogin.vue
    OrchidLogin.vue
    EmberLogin.vue
  applyTheme.ts         # 挂 data-theme、写 CSS 变量、同步 Element 主色
  ThemeDevSwitcher.vue  # 仅 DEV
```

### 4.2 ThemeDefinition（逻辑结构）

```ts
type ThemeId = 'harbor' | 'slate' | 'orchid' | 'ember'

interface ThemeDefinition {
  id: ThemeId
  label: string           // 开发切换器用中文名
  layout: Component       // 主框架
  login: Component        // 登录页
  cssFile?: string        // 由 apply 侧静态 import 保证打包
  primary: string         // Element Plus --el-color-primary
}
```

### 4.3 运行时选择

```text
优先级（从高到低）：
1. 开发环境 localStorage key: `ui_theme_override`（仅 DEV 读写）
2. import.meta.env.VITE_UI_THEME（构建写入，默认 harbor）
3. 回退 harbor
```

生产构建 **不读取** localStorage 覆盖（`import.meta.env.DEV === false` 时忽略 override）。

### 4.4 应用挂载点

- `App.vue`：根节点 `data-theme="{id}"`；`<component :is="theme.login|layout">` 不在此，而在 **路由层**。
- `router/index.ts`：
  - 登录路由 `component: () => theme.login` 或包装器 `ThemeLogin.vue` / `ThemeShell.vue` 动态取当前主题组件。
  - 业务子路由的 `layout` 父级改为 `ThemeShell.vue`，内部渲染 `currentTheme.layout` + `<router-view />`。
- 推荐 **薄包装** 避免 router 与 registry 循环依赖：

```text
ThemeShell.vue   →  currentTheme.layout + slot/router-view
ThemeLoginHost.vue → currentTheme.login
```

### 4.5 CSS Token 约定

全局 `html[data-theme="harbor"]`（或 `#app`）上定义变量，页面与布局只消费变量：

| 变量 | 用途 |
|------|------|
| `--app-bg` | 页面/主区背景 |
| `--app-surface` | 卡片/面板背景 |
| `--app-text` | 主文字 |
| `--app-text-muted` | 次要文字 |
| `--app-border` | 边框 |
| `--app-aside-bg` | 侧栏背景 |
| `--app-aside-text` | 侧栏文字 |
| `--app-header-bg` | 顶栏背景 |
| `--app-radius` | 通用圆角 |
| `--app-font` | 字体栈 |
| `--app-content-padding` | 主内容 padding |
| `--el-color-primary` | Element 主色（及必要时生成 hover/light） |

`styles/index.css` 只保留 reset；具体色彩迁入 tokens。

业务页（如 `SimpleCrud`）逐步改为使用 token 或保持 Element 默认即可；**不要求**本期重写所有业务 scoped 硬编码色，但布局/登录必须完全主题化。

### 4.6 Element Plus

- 启动时 `applyTheme(id)` 设置 `--el-color-primary` 及基础衍生（可用固定明度阶梯或简单覆盖）。
- 不引入完整 EP 暗色 CSS 包；`ember` 通过 token + 布局背景实现深色壳，表格仍可用 EP 默认（略浅）或对 `.el-card/.el-table` 做主题级覆盖（写在 `ember.css`）。

---

## 5. 配置与交付

### 5.1 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `VITE_UI_THEME` | 主题 ID | `harbor` / `slate` / `orchid` / `ember` |
| `VITE_APP_TITLE` | 产品显示名 | `某某水厂运维平台` |

- `index.html` title 可在 `main.ts` 启动时设为 `VITE_APP_TITLE`。
- 布局 brand / 登录标题读取同一 title（缺省：`生产运维管理系统`）。

### 5.2 交付示例

```bash
# 给使用方 A
VITE_UI_THEME=harbor VITE_APP_TITLE=甲泵站运维平台 npm run build

# 给使用方 B
VITE_UI_THEME=slate VITE_APP_TITLE=乙水厂生产管理系统 npm run build
```

构建产物中无切换器；用户无法在界面改主题。

### 5.3 开发切换器

- 组件 `ThemeDevSwitcher.vue`：仅 `import.meta.env.DEV` 时挂载（`App.vue` 或 layout 内）。
- UI：角落小浮层，4 个按钮；切换后 `localStorage` + `applyTheme` + 必要时 `location.reload()`（若布局组件已挂载且差异大，**允许 reload** 简化状态，作为默认策略）。
- 生产 tree-shake：用 `if (import.meta.env.DEV)` 条件编译，确保切换器不进 prod bundle（或进了也不渲染；优先条件 import）。

---

## 6. 路由与文件改动清单

| 文件 | 动作 |
|------|------|
| `src/themes/**` | 新增 |
| `src/layouts/MainLayout.vue` | 迁移为 `HarborLayout`，原路径可 re-export 兼容或删除 |
| `src/views/login/LoginView.vue` | 迁移为 `HarborLogin` 或薄代理到主题登录 |
| `src/router/index.ts` | 登录与主壳改 Theme* 宿主 |
| `src/App.vue` | data-theme、DevSwitcher、可选 title |
| `src/main.ts` | 启动 `applyTheme(resolveThemeId())` |
| `src/styles/index.css` | 瘦身 + import tokens |
| `frontend/.env.development` | `VITE_UI_THEME=harbor` |
| `frontend/.env.example` | 文档化变量 |
| `docs/RUN.md` / `README.md` | 补充多风格构建说明 |

业务 `views/**`：**默认不改**；仅当硬编码布局色严重冲突时做最小 token 替换。

---

## 7. 共享能力（布局间复用）

为避免 4 套 Layout 复制菜单逻辑，抽取：

- `composables/useAppMenus.ts`：拉菜单、iconMap、active、opened
- `composables/useAppChrome.ts`：title、logout、displayName、appTitle

Layout 只负责 **结构与 class**，菜单数据逻辑共用。

---

## 8. 验收标准

1. 同一账号流程下，分别以 4 个 `VITE_UI_THEME` 构建或 DEV 切换，登录页与主框架 **布局结构可区分**（侧栏位置/有无、深浅、登录版式）。
2. 生产构建：页面 DOM **无** 主题切换控件；改 localStorage 无效。
3. DEV：切换主题后能看到对应 Layout/Login。
4. 现有路由与 API 行为不变；`npm run build` 通过。
5. `VITE_APP_TITLE` 反映在浏览器标题与 brand 文案。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 4 套 Layout 菜单逻辑分叉 | 强制用 composable 共用 |
| Element 表格在 ember 深色下刺眼 | ember.css 覆盖 table/card 背景与文字 |
| 业务页硬编码 `#001529` 等 | 本期仅壳层保证差异；后续按需清债 |
| reload 丢表单 | 仅 DEV 切换；生产不切换 |

---

## 10. 实现分期建议

| 步 | 内容 |
|----|------|
| 1 | types/registry/tokens/applyTheme + 环境变量 + App 挂 data-theme |
| 2 | Harbor 从现有 Layout/Login 迁入，行为与现网一致 |
| 3 | Slate / Orchid / Ember 三套 Layout + Login |
| 4 | ThemeShell / ThemeLoginHost 接路由；DevSwitcher |
| 5 | 文档、`.env.example`、构建验收 |

---

## 11. 成功样貌（一句话）

给不同使用方打不同包时：有人看到深蓝政务左栏，有人看到顶栏 SaaS，有人看到浅紫卡片侧栏，有人看到深色运维壳——**业务一样，壳子不像一家工厂的统一皮肤。**
