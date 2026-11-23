# 5190 桌面首页 · 本轮交付与验收

- 正式入口：`http://localhost:5190/dashboard`（登录后进入；截图均为 DPR 1、100% 缩放）。
- 主验尺寸：1672×941；另验 1920×1080、2560×1080。
- 默认机位：pitch 22.6°、fov 9.78°、distance 320、target(-1.2, 0, 13.6)；three.js 的 z 与 CAD 图面 z 反号，`target.z=13.6` 对应图面 z=-13.6。
- 构图基准：`docs/migration/briefs/5190-desktop-master/reference/design-target.png`；位置依据仍为工程 CAD，冲突项见第 6 节。

## 1. 同机位对版

- 三联图：[compare-triptych.png](compare-triptych.png)（设计目标 / 改前 / 改后，同尺寸 1672×941）。
- 50% 叠图：[overlay-design-after.png](overlay-design-after.png)。
- 关键点差值：[anchor-diff.csv](anchor-diff.csv)。

| 关键点 | 设计 y | 改后 y | 差值 |
|---|---:|---:|---:|
| 堆场北端（CAD z=24.1） | ~300 | 293.7 | -6.3 |
| 8 台堆取料机中心（CAD z=-8.3） | ~465 | 470.4 | +5.4 |
| 堆场南端（CAD z=-40.7） | ~690 | 683.0 | -7.0 |
| 南侧池组（CAD z=-42.6） | ~727 | 696.9 | -30.1 |
| 岸水交界（CAD z=-56.5） | 819–826 | 803.2 | -18.8 |

堆场四角投影：A(260.3, 206.5)、B(1109.2, 206.5)、C(1191.3, 757.1)、D(87.3, 757.1)。八列堆场、中央作业带、南池、两船外接框与人工湖在叠图中基本重合。

橙色像素峰值行仅作色域统计：设计稿 538，改后 391–414（机臂上缘）。该指标受机臂朝向、船机与浮层影响，不能替代单机定位；单机中心投影 470 与设计机带中心 465 对齐。改前橙色重心偏差在本轮通过整机位重标定消解，未平移八台门机。

## 2. 三项现场验收

1. 关标牌能认设施：[no-labels.png](no-labels.png)。八列堆场、北厂带、南五池、洗车台、人工湖、岸线与两船均可凭形体辨认。
2. 关贴图能辨堆形：[gray-mode.png](gray-mode.png)。同色灰模下可见各堆端坡、平顶宽度、长度与局部取料切坡差异，港机支腿落地、无堆体穿插。
3. 点对象能看水务业务：[detail-panel.png](detail-panel.png)、[shots/detail-wash.png](shots/detail-wash.png)。标题、关联工艺、三项核心指标、数据状态、告警、定位依据折叠与工艺页入口齐全；运营字段统一显示“未接入”，不报零、不报绿灯。

## 3. 树位退出车道

- 口径：重放最终 `harborRelief.ts` 的 treeSites，树心到最近可绘制道路中心折线的平面距离 < 0.66 记为车道内；修复时按 0.66+0.62 净距排除，路树、林带、CAD 散点与旧冠层同走判定。
- 改前基线：4,939 个生成树位、84 个相交（西侧核查窗 14、东侧 44）。
- 改后：[road-tree-after.csv](road-tree-after.csv) 共 4,780 个树位，车道内 0 个，最近树心距中心线 1.2862（已退出 0.66 路面半宽）。
- 顶视道路检查：[top-view-roads.png](top-view-roads.png)。车道面内无树干，路侧绿带与绿岛保留。

## 4. 图例、管流、六工艺与返回

- 七类图例均为按钮，带 `aria-pressed`、颜色条、选中态与键盘焦点；每项有“独”单类独显，另设“恢复默认”；消防与顶部消防开关双向同步，并按用户保存偏好初始化。
- 空选：[legend-empty.png](legend-empty.png)，建筑、道路、绿化保留，状态行明确提示可逐项恢复。
- 管流：139320 演示段随图层显隐同步启停；暂停/恢复不重建几何。管段被隐藏后其拾取、流带、阀门与详情同步关闭。
- 六工艺单行入口位于顶栏下：全场总览 + 6 个系统；切入专题按主层/参照层初始化图例，站内仍可调整；再次点全场总览恢复总览勾选与默认视角。
- 六个系统逐一走通并返回，结果见 [operations.md](operations.md)：

| 系统 | 工艺路由 |
|---|---|
| 射雾器除尘 fog | `/port/process/fog` |
| 中压供水 middle | `/port/process/middle` |
| 含矿污水处理 mineral | `/port/process/mineral` |
| 雨水收集 rain | `/port/process/rain` |
| 水池供水 pool | `/port/process/pool` |
| 生活污水提升与外送 domestic | `/port/process/domestic` |

- 从工艺页返回时恢复相机位置/目标/视场角、当前系统、图例勾选、独显与管流开关（sessionStorage，键 `tanggang.dashboard.view.v1`）。返回实测与离开前一致：pos(-1.2, 122.97, 309.03)、target(-1.2, 0, 13.6)、fov 9.78。

## 5. 旋转闪烁与渲染负载

- 近裁剪面改为档位切换（远景 2.4 / 近景 0.4），不再随相机逐帧改变深度精度。
- 地面薄层统一 polygonOffset（-2/-4），道路 -3/-6；方向光 `normalBias 0.05`、`bias -0.0005`，抑制共面与阴影闪斑。
- 静止 2 秒同机位帧差：变化 >60 的像素占 0.02%（仅水面与车辆动画）。
- 性能（1672×941，热身后 240 帧）：draw calls 412，三角面 1,097,982，帧耗中位 17.8 ms、P95 18.7 ms，约 56 FPS。

## 6. 与设计稿的差异（CAD 依据优先）

1. 南侧池组比设计稿高约 30 px：CAD 池位贴堆场南缘，设计效果图把池组下移；未改 CAD。
2. 岸水交界高约 19 px：保留 B1417 工程岸线，未按效果图重画岸线。
3. 设计稿管线更密、线径更细：现有 CAD 管线数量少于效果图，不虚构补线；已核路径全部保留。
4. 煤堆表面颗粒与设计稿的“近景煤粒”仍有差距：当前用顶点色+粗糙度表达坡面与浮灰，未烘死太阳方向。
5. 船舶与装船机保留 Blender 精简外形：船首收分、舷侧、货舱、驾驶楼与吃水成立，细节等级低于水务设施。
6. 远林密度低于设计稿：用实例化树簇表达前中后景，未逐棵手工布置。
7. 洗车台套数存在纪要 5 座与需求评审稿 4 处布置单元/6 套的冲突：首页只落有定位依据的洗车台区，套数与车道数不在首页推算。

## 7. 资产与 Blender

- 复用并保留可再导出源文件：`frontend/modeling/harbor/refine_port.py`、`refine_all_buildings.py`、`refine_trees.py`、`create_trucks.py`、`harbor_kit.py`。
- 实际加载资产：`frontend/public/tanggang/models/harbor/stacker-reclaimer.glb`、`ship-loader.glb`、`bulk-carrier.glb`、`belt-gallery.glb`、`gallery-bay.glb`、`pumphouse.glb`、`treatmenthouse.glb`、`integratedtreatment.glb`、`ecopump.glb`、`steeloffice.glb`、`canteen.glb`、`inspection.glb`、`coal-truck.glb`、`tree-broad.glb`、`tree-narrow.glb`；`.blend` 源文件同目录。
- 本轮视觉改动集中在机位、海天/林带、煤堆色调、道路对比与首页浮层；未新增室内拆解或编造设备规格。任何后续外形精修继续在生成脚本与 GLB 源上修改，不在截图或临时浏览器设置里调效果。

## 8. 数据与待签认资料

- 实测 / 演示 / 未接入三分：当前首页无实测点位，139320 流带明确为演示；所有运营 KPI 均为“未接入实时采集”。
- 待签认：厂家洗车计数与用水点表、港机补水点表、池体液位与泵状态点表、雨水 V-H 曲线、消防源层清单、岸线与池体竣工图。
- 台账边界：设施按 CAD 文字锚点/闭合轮廓定位；没有闭合轮廓的对象按 L1 示意精度处理，不虚构池深或单机位置。

## 9. 文件清单

- 对版：`compare-triptych.png`、`overlay-design-after.png`、`anchor-diff.csv`
- 现场：`after-dashboard.png`、`no-labels.png`、`gray-mode.png`、`detail-panel.png`、`legend-empty.png`、`top-view-roads.png`
- 尺寸：`size-1920.png`、`size-2560.png`
- 录像：`operations.mp4`（旋转回位、图例开关/独显/恢复、管流暂停恢复、六工艺跳转与返回）
- 复算：`road-tree-after.csv`
- 测试记录：`operations.md`
