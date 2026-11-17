# 唐港智慧水务 V3.5 · 菜单与事件中心整合

日期：2026-11-17。原项目 Smart-Water-Affairs-TanShan，5174 端口，不创建新项目或ZIP。
Git基线：271ea29；开发分支 feat/v35-unified-event-center。

## 产品目标
将V3.4九个一级菜单（含首页）、31个导航入口收敛为7组、20个主要入口。按岗位业务组织入口，不以技术功能或演示故事拆分菜单。

## 新7组菜单
- 综合总览：首页
- 运行中心：值守与事件中心；港口水务业务链
- 工艺监控：射雾器除尘、中压供水、含矿污水处理、雨水收集、水池供水、生活污水外送
- 设备运维：设备与档案、工单与巡检、健康与能效、工程底账
- 水资源管理：水资源总览、调蓄与四预、水源优化与效益
- 分析中心：报表与交接班、AI工作台与看板、知识与证据
- 系统设置：管理工作台（仅管理员）

## 旧功能保留和内部功能切换
所有旧页面路由和权限保留。设备与档案切换到/archives；水资源总览内部切换到/water/rainfall和/water/ledger；调蓄与四预切换到/decision/four-pre；水源优化与效益切换到/water/green-benefit；AI工作台与看板切换到/data/my-dashboards。系统设置可切换角色、设备、模板和日志四页。

## 新统一事件中心
入口 /operations/events。四个Tab：全部事件 / 值守巡查 / 生产告警 / 协同核查。
全部事件跨来源只读汇总；原Alarm和DutyEvent各自保留ID、时间、状态、证据和已有工单。按设备相同仅显示关联线索，不自动推断共同根因或生成重复工单。业务操作通过原权限化处理逻辑完成；原告警/值守/协同路由保留。失效工单链接明确显示，不指向其他设备。

## 工程边界
仅前端本地MOCK/localStorage，无真实SCADA或24小时服务端巡查。事件中心只做视图整合而非重建数据库状态机。未开展正式现场监测、自动控制及合规审批；计算模型口径不在本轮强制合并。

## 本轮源代码
navigation.ts、components/layout/AppSidebar.vue、main.ts、新建demo/eventHub.ts及测试、新建views/EventCenterView.vue、新建components/WorkspaceNav.vue、原专业工作区中添加可发现的内部页签、测试导航新旧兼容。

## 验收要点
7组导航和一级工作台内的功能可访问；原六工艺、工程、AI、工单、设备档案继续正常；告警与巡查不产生虚假合并或工单；admin-only权限不下降；全量单测、Playwright桌面/笔记本均回归。最终日志 /tmp/tanggang_v35_verify.log。

## 最终验收结果（2026-11-17）

- 在原仓库执行：WATER_E2E_PORT=5394 pnpm verify，退出码0。
- TypeScript、ESLint（零警告）、生产构建通过。
- API单元测试14/14，Web单元测试271/271，Playwright浏览器测试274/274，桌面和笔记本双视口单worker串行执行。
- 完整日志：/tmp/tanggang_v35_verify.log（开发机本地）。
- 实际运行截图：docs/design/v35-event-center-1600.png、v35-event-center-1366.png、v35-event-center-390.png。
- 实际页面测试：1600、1366、390px均无整页水平溢出和pageerror；1366高768首条事件距离顶部563px；390移动端首条事件top约926px，移动端仍需后续首屏压缩。
- http://127.0.0.1:5174/operations/events 返回HTTP200。用户本地业务数据未清理；项目未重建、未生成ZIP。
- 上述软件测试不代表现场工程审批、PLC授权或真实24小时事件监测已具备。
