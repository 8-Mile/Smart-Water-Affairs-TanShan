# 5190 首页现场复核与下一轮实施 · V3 进度

- 日期：2026-11-22
- 正式入口：http://localhost:5190/dashboard
- 主验收画幅：1672×941，DPR 1
- 设计依据：docs/migration/evidence/iter-art/design-target.png
- 数据依据：frontend/public/tanggang/cad/l1-v2_2/scene-v2.2.json、l1-v2_6/spatial-candidates-v2.6.json、l1-v2_3/region-equipment-v2.3.json
- 本轮未重新解析原始 DWG；沿用 V2 的 CAD 锚点、区域与管线数据。

## A 旋转闪动与深度精度

- 已合入 `5190-depth-precision.patch`：`L1WaterScene.vue` 渲染循环按轨道距离与相机高度平滑设置 `near`。
- 测试页 `?debug=probe` 实测：距离 323.6 时 `near=8`；滚轮缩放到 169.6 时 `near=4.43`，136.7 时 1.54，110.2 时 0.26，88.8 时 0.1；返回总览恢复 8。按公式复核：距离 150、默认俯角时 `near≈2.16`，70/25 时为 0.1。
- 微转复核：A → 水平 0.0043° → A，相机实际位移约 0.024 显示单位（探针坐标已确认）。RGB 任一通道差 >12 的像素占比：
  - A→B 陆域（x55–1625,y278–703）1.96%，北区 5.75%，南区 0.81%
  - A→A 回转 陆域 0.324%，北区 3.301%，南区 0.000%
  - 对照本轮材料中 near=0.1 的 5.946%/18.964%/5.679% 与 near=8 的 1.764%/4.701%/0.686%，正式合入后的残余已回到 near=8 量级；A→A 残余主要来自海面/湖面波纹与管流动画，不是共面闪点。
- 依据：[rotation-verification-v3.png](rotation-verification-v3.png)，原始帧 `shots/rot3-A1.png`、`shots/rot3-B.png`、`shots/rot3-A2.png`。
- 未做：本轮没有在真机触控设备上覆盖全部设备近景；仅桌面 1672×941 与滚轮缩放。

## B 西侧道路—洗车台—排水沟样板

- FB499（x≈−30.39，YB-04 东缘）：在堆场底板网格构造阶段按道路中心线开槽（保留 x≤−31.19 的底板，槽宽 0.8），不再用抬高路面去压共面。路顶 y=0.073 重新露出，沿线中心线不再 95.1% 落在 y=0.108 的底板内。
- 41 条道路按“原有且可读 / 已修覆盖 / 正常遮挡 / 遮挡待核 / 原始资料待核”分类，见 [5190-road-classification-v3.csv](5190-road-classification-v3.csv)。本轮统计：原有且可读 8、已修覆盖 1（FB499）、正常遮挡 13、遮挡待核 10、原始资料待核 9。
- 北侧明沟：按 `$泄水通道` ECC72/ECC73 两条真实平行沟边（display z≈50.80/51.10）建开口沟（沟底 + 两道沟壁），东端在 CAD 过水断面盒 x≈24.9–25.98 处加格栅盖板；两侧树带已让出 50.2–51.6 的净空。表现宽度由 0.30 放大到 0.52，属可读性参数，已在代码注释标注。
- 默认俯角下明沟仍偏薄，会在近景/俯视复核；见“仍有差距”。

## C 洗车台 Blender 样件接入

- `docs/migration/evidence/5190-field-review-v3/wash-station-l1.glb` 已复制到 `frontend/public/tanggang/models/harbor/wash-station-l1.glb`，由 `loadWashStation()` 在正式页异步加载。
- 落位 x=−45.483、z=−6.265（世界 z=+6.265），与 CAD 文字点 FAE1D / TG-CAD-13 一致；平面包络约 8.6×12.4，模型自带场坪、开敞棚、作业台、条形格栅、入口截水沟与两侧冲洗管。
- 旧程序化棚板、重复场坪、五条棚面与旧格栅已删除，避免共面重叠。资源进入 `portResources`，随 `dispose()` 释放；阴影随 GLB 加载后标记更新。
- 拾取复用 `TG-CAD-13`：GLB 所有 Mesh 写入 `{pick:'reliefPoint',pointId:'TG-CAD-13',sourceHandle:'FAE1D'}`。实测点击洗车台本体返回“洗车台区”详情。
- 发现并处理：射线先命中贴地穿行的 `$管综-室外消防` 细管（2EAF50），导致“点设施却选中管线”。已在 `selectByCanvas` 增加规则：细管命中后 2.5 显示单位内存在实体时优先实体；明显在前的管线仍按管线选中。复测洗车台、人工湖、维修车间均返回同名实体。
- 仍未改走向：139320 中压演示管起点位于洗车台棚下（x≈−45.25,z≈−2.58），按 CAD 原线保留，未擅自改线；当前为“管线从开敞棚下穿过”，不是被棚板遮挡。
- 三联图：[wash-station-triptych.png](wash-station-triptych.png)（①设计稿局部 ②改前同机位 ③正式页接入）。

## D 向北、东、南扩展

- 北侧：主路—厂前场坪—四澄清池—泵房—集水池的层次沿用 V2 模型；四圆池水面可见，北二南五分组标牌保留。除尘水池、格栅井、闸门仍缺点位，按“区级示意/待定位”处理，未按大类数量推定。
- 东侧：人工湖、办公楼、维修车间、智慧中心模型均正常加载；湖岸净空与树冠避让沿用 V2，湖面在近景可见，但被南侧管廊与装船机前景部分遮挡。办公楼来源仍标注“首钢底图”。
- 南侧：池带、管架、岸墙、水面依次可辨；新建洗车台未影响南侧。52 号船在 2560 画幅完整入画；1672×941 下船体沿泊位端点投影 x≈1333–1829，右边界 1671，仍有约 157px 被裁切，未改泊位与主机位，按“未完整入画”记录。
- 未新增无定位设备；区域设备仍以现有数据与详情为准。

## E 三维美术与设计稿复验

- 本轮维持既有日光、雾、色彩管理与水面材质；重点保证道路材质与场坪分离、金属管有窄高光、水面按海/湖/池区分。
- 明沟改为 CAD“排水沟”三条厂前路边沟槽，不再使用无依据的远沟段；树带保持原状。
- B1417 岸线仍在实拍约 y=712，设计图水陆边界约 y=819，约 107 像素差异保留（CAD 实际场地关系优先）。未改主机位；未为追构图裁掉人工湖或 52 号船。
- 2560×1080 下海面占比偏高、场地下方留白偏多，属于宽幅构图差异，尚未改机位。

## 复验二：洗车台 / 52 号船 / 管廊走向 / 明沟（按新基准）

- 洗车台与管廊：139320（$管综-中压除尘）起点在洗车台棚内（−45.25,−2.58）。新增 `trimPipeAtWash()`，只对“起点在洗车台平面内、下一点在外”的折线做展示裁剪，从北侧棚边 z=−0.05 开始表现；源折线、锚点与拾取不变。其余穿过场地的管线未改走向。
- 洗车台棚下仍有 7 段 `$管综-室外消防` 短管（z≈−6.7…−10.4），属洗车台自身的冲洗/消防接口，不再视为穿行干线，保留。
- 52 号船：1672×941 下船体端点投影原为 x≈1333–1829（右边界 1671）。仅对 TG-CAD-20 做展示处理：船长 27→22、沿码头西移 7.5 显示单位，装船机同步西移以保持对位；CAD 泊位文字点不动。复测端点 x≈1241–1645，右侧留 27px，完整入画。
- 明沟：删除上一轮无依据的远沟段，改用 CAD“排水沟”三条真实双线沟槽（x≈−20.5/−3.9/12.5，z≈45.8–49.5），补沟底、两侧沟壁与沟口横条格栅；另在北横路硬路肩加三处进水口格栅。沟体本身在默认机位被厂前墙遮住大半，路面上的格栅可读。
- 改动文件：`harborRelief.ts`（泊位展示位移、明沟）、`L1WaterScene.vue`（洗车台管线裁剪、调试俯仰钩子）。
- 复验图：[recheck2-1672-labels.png](shots/recheck2-1672-labels.png)、[recheck2-1672-nolabels.png](shots/recheck2-1672-nolabels.png)、[recheck-west.png](shots/recheck-west.png)、[recheck-north-high.png](shots/recheck-north-high.png)。
- 复验旋转：A→B 陆域 1.674% / 北区 5.267% / 南区 0.751%，A→A 0.273% / 2.864% / 0.000%，与 near=8 基准一致。
- 复验拾取：洗车台→TG-CAD-13、人工湖→1028AB、维修车间→F9BFB 均同名返回。

## 天空与海水真实感

- 天空：等距柱状画布由 1024×512 提升到 2048×1024，地平线严格落在 H/2；天顶深蓝→中层天蓝→地平线暖白，按主光方向 (64,104,44) 绘制太阳圆盘与光晕，叠两层云（高空层积云 + 0–7° 低空远云带）和地平线薄雾；下半球改为海雾色，继续作为背景与 PMREM 环境光源。雾色同步为 `#d5e5e5`。
- 海水（本轮升级）：海面改为自定义 `ShaderMaterial`，法线由 10 组方向/波长/振幅/速度不同的重力波解析梯度叠加，并做低频域扭曲，避免可平铺贴图的重复纹理与平行条纹；片元按 Schlick Fresnel（F0 0.02）混合深水色 `#104a62`、近岸浅水色 `#33879b` 与解析天空反射（含太阳光晕），再叠加宽光泽 + 紧高光 + 近景碎闪的太阳高光、长涌浪明暗与风生明暗带；按离岸距离做 0–6 单位浅水渐变，贴墙 2.2 单位内压暗成湿岸阴影。短波按视距衰减，防止远处闪烁；雾与色调映射按 three 标准顺序（`tonemapping → colorspace → fog`）收尾，与陆域材质一致。旧的 256×256 法线贴图、独立浅水板和 80 条直线波纹条已删除。
- 默认构图里天空大部分被北侧树带挡住，天空改进主要通过 1–2° 地平线带与环境反射体现；OrbitControls 会限制上仰，未产出大面积天空镜头。
- 证据：[skysea-before-after.png](skysea-before-after.png)、[shots/skysea-default-shader.png](shots/skysea-default-shader.png)、[shots/skysea-water-shader.png](shots/skysea-water-shader.png)、[shots/skysea-default-noise.png](shots/skysea-default-noise.png)（上一版法线贴图对照）、[shots/skysea-skyline-v5.png](shots/skysea-skyline-v5.png)。
- 复测：60.5 FPS（headless Chrome，2 秒 rAF 计数）；`focus=south&zoom=.34` 下 192 draw calls、1,351,302 triangles、247 geometries、9 textures。默认视角截图见上。
- 边界：低角度掠射仍偏银灰，主要由雾与掠射反射贡献；水面只有法线起伏、无顶点级位移，无实时反射探针与体积云；默认机位太阳在画面右后方，看不到明显的太阳耀斑路径。

## F 整屏验收与性能

- 主验收图（复验二）：[recheck2-1672-labels.png](shots/recheck2-1672-labels.png)；关标签全景：[recheck2-1672-nolabels.png](shots/recheck2-1672-nolabels.png)。
- 其他画幅：[recheck-1920-labels.png](shots/recheck-1920-labels.png)、[recheck-2560-labels.png](shots/recheck-2560-labels.png)、[recheck-390.png](shots/recheck-390.png)。
- 手机底部留白：原因是最小屏 `--scene-view-height:460px` 与实际 844 高视口不匹配，底部卡片又被隐藏。已改为 `max(460px, calc(100dvh - 92px))`。390×844 实测画布从 y=93 起、高 752，填满至视口底部，无空白带。
- 拾取回归（1672×941）：
  - 洗车台 → “洗车台区”（TG-CAD-13/FAE1D）
  - 人工湖 → “人工湖”（1028AB）
  - 港机维修车间 → “港机维修车间”（F9BFB）
  - 细管/设施同像素冲突已按 2.5 单位优先级处理。
- 渲染统计：356 draw calls、1,488,718 triangles、251 geometries、11 textures。
- 帧耗（headless Chrome，1672×941）：本轮机器 load average 15–20 时约 16 FPS、中位 66.6ms；此前低负载时同一场景约 50 FPS、中位 16.7ms。FPS 受机器负载影响，验收以帧差与 draw calls/triangles 为准。
- 构建：`npm run build`（vue-tsc --noEmit + vite build）通过，仅有既存的大 chunk 警告。
- 连续实录（复验二）：[5190-rotation-40s-v2.webm](5190-rotation-40s-v2.webm)（录制上下文需重新登录，开头含登录段；随后静止、慢转 10°、缩放、开关管流、复位）。

## 仍有差距 / 未达标

1. 明沟沟体（三条北侧沟槽）在默认俯角下被厂前墙遮挡大半，路面只读到三处进水口格栅；西侧洗车台旁无连续沟线可依，未凭空延伸。
2. 洗车台棚下的 7 段室外消防短管仍保留（属该设施接口）；139320 已在棚边收口，棚体不再被干线穿过。
3. CF248 北横路、FA905、D58A4 的可见度仍受树带、厂前设施与洗车台遮挡，本轮只做了分层判断，未逐段改树。
4. 人工湖在默认机位被南侧管廊、装船机前景部分遮挡，湖岸可见段仍短。
5. 2560×1080 宽幅下海面占比与留白偏大；B1417 岸线与设计图约 107px 差异保留。
6. 52 号船已按展示位移入画，但船长比 51 号短（22 vs 27），且装船机随船西移、与泊位文字点有 7.5 单位视觉偏移；CAD 锚点未改。
7. 居中堆场 8 台堆取料机仍为同姿态、同纵向位置；设计图的侧伸悬臂与横向联系未按图重造（缺机型依据）。
8. 手机 390×844 画布已填满，但竖屏上部天空仍偏空，场地偏小；未为竖屏单独改机位。
9. 本轮未在真实触控设备、系统缩放 125%/150% 与设备 DPR 2/3 下逐项复测。
10. 海面已改为解析波浪 + Fresnel 反射，默认视角层次明显改善；但低角度掠射仍偏银灰（雾与掠射反射所致），水面只有法线起伏、无顶点位移与实时反射探针，默认机位也看不到太阳耀斑路径。

## 证据索引

- 旋转：[rotation-verification-v3.png](rotation-verification-v3.png)
- 天空海水：[skysea-before-after.png](skysea-before-after.png)、[shots/skysea-default-shader.png](shots/skysea-default-shader.png)、[shots/skysea-water-shader.png](shots/skysea-water-shader.png)、[shots/skysea-default-noise.png](shots/skysea-default-noise.png)、[shots/skysea-water-noise.png](shots/skysea-water-noise.png)
- 洗车台三联：[wash-station-triptych.png](wash-station-triptych.png)
- 西侧近景：[shots/recheck-west.png](shots/recheck-west.png)
- 明沟：[shots/recheck-north-high.png](shots/recheck-north-high.png)
- 52 船与整体：[shots/recheck2-1672-labels.png](shots/recheck2-1672-labels.png)
- 东侧/湖：[shots/east-closeup.png](shots/east-closeup.png)、[shots/lake-closeup.png](shots/lake-closeup.png)
- FB499：[shots/fb499-closeup.png](shots/fb499-closeup.png)
- 道路分类：[5190-road-classification-v3.csv](5190-road-classification-v3.csv)
- 实录：[5190-rotation-40s-v2.webm](5190-rotation-40s-v2.webm)
