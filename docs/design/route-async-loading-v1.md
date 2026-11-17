# 唐山港智慧水务 DEMO · 全站路由异步加载与应用分包验收

## 改造动机

改造前客户端Vite单入口主要JavaScript bundle约2144.81kB（gzip约670.98kB），包含首页并不需要的页面、AI助手、工艺、知识与图表逻辑。对于港口大屏和移动笔记本访问属于明显的首次加载成本风险。

## 本次已经实现

1. apps/web/src/main.ts
   - 原先静态导入的20个Vue页面全部改为动态 import()；
   - 全站27条非重定向/通配路由的页面组件均为按需加载（同一组件的多个路径由构建器共享相同chunk）；
   - 保留每条路由既有name、path、title和permission、beforeEach角色授权及scrollBehavior；
   - 新增 /water/green-benefit 同样为动态路由。

2. apps/web/src/App.vue + apps/web/src/components/GlobalAiDrawer.vue
   - AI Drawer框架和AiPanel内的AI解析/业务能力一起在ui.aiOpen=true时才加载；
   - 设备抽屉AssetDrawer也为异步组件，只在ui.drawerAssetId有效时挂载；
   - 原本全局“问AI”和设备点击的操作入口保留，不新建另一个业务系统。

3. apps/web/vite.config.ts
   - 将ECharts和ZRender依赖分成独立vendor-echarts/vendor-zrender生产资源；
   - 只在引用图表的页面进入/组件挂载时加载，避免将几百kB图形库放入首页应用初始化链。
   - 未改变图表渲染库的使用方式（仍用原Vue Chart组件、ECharts canvas及Naive UI）。

## 生产构建体积测量（2026-11-16，kB为构建器报告的十进制大小）

| 文件 | 变更前 | 变更后 |
| --- | ---: | ---: |
| 入口index JavaScript（未压缩后体积） | 2144.81 kB | 494.70 kB |
| 入口index gzip传输量 | 670.98 kB | 160.59 kB |
| 图表引擎vendor-echarts | 与主包合并/共享大包 | 362.21 kB（异步图表依赖） |
| Canvas渲染vendor-zrender | 与图表共享大包 | 175.93 kB（异步图表依赖） |
| 全局AI抽屉 | 原先在主包中随页面加载 | 106.43 kB（仅用户打开时） |
| 绿色运营页面业务JS | 原先不存在 | 24.80 kB（仅进入该路由时） |

入口主包按构建报告的体积下降约77%，gzip下降约76%；页面样式、图片等仍会按需要加载，以上不是整个应用的总下载量、不是Chrome Network面板的实测首屏耗时，也不是路由切换耗时的性能承诺。

分包后构建不再出现“超过500kB”的chunk warning。数据仍为本地DEMO，不代表真实港口系统生产性能验收。

## 测试边界

- 构建：pnpm build、pnpm typecheck、pnpm lint。
- 业务回归：Playwright桌面1920×1080、笔记本1366×768，覆盖首页、AI抽屉、设备抽屉、档案、设备、工单、三水源、知识、雨次及新绿色运营页面。
- 不删除原有业务路由和权限，原业务状态结构不变。
- 后续仍需浏览器真实网络面板分别记录FCP/LCP、主资源下载、缓存命中和懒加载首跳延迟；大图片gongyi/bg等需要单独做纹理与图片资源优化。

## 已知后续优化项

- 大工艺背景PNG数MB，仍应做等质WebP/AVIF、高DPI策略和独立预加载，不能把图片开销算进路由chunk优化。
- AI组件首次打开需要动态下载；可考虑用户主动悬停或空闲时的预加载策略，但不能破坏用户明确的按需原则。
- 设备抽屉的首次打开亦需要下载其依赖；应基于实测再权衡预取，不应无条件随首页载入。

## 最终验收补充

- 生产构建已确认：全部27个页面路由以动态 import() 加载，只有应用根组件保持入口静态引用；首页全局AI与设备详情抽屉仅在打开时异步加载。
- 入口index为494.70kB/gzip160.59kB；图表拆为vendor-echarts 362.21kB及vendor-zrender 175.93kB，均在业务图表进入时加载。没有超过500kB的构建分包告警。
- 全量 pnpm verify 退出码0：API14、前端单元202、浏览器182项均通过；浏览器测试包含原AI抽屉、设备详情和路由跳转，证明异步组件未破坏现有业务流程。
- 原5174开发服务保持，最终核验绿色页面及首页HTTP 200。
