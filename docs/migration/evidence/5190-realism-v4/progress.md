# 5190 首页真实感升级 · V4 进度

- 日期：2026-11-22
- 正式入口：http://localhost:5190/dashboard
- 主验收画幅：1672×941，DPR 1
- 方案依据：[5190-真实感升级方案.md](../../../../.trae/documents/5190-真实感升级方案.md)
- 资产来源：[asset-sources.md](asset-sources.md)

## 本轮完成

### 1. 真实 HDR 天空与环境光照

- 用 Poly Haven CC0 2K HDR（`syferfontein_18d_clear_puresky`）替换 2048×1024 Canvas 天空；`RGBELoader` + `PMREMGenerator` 同时作为 `scene.background` 与 `scene.environment`。
- HDR 太阳方位 35.95°，主光方位 34.5°，通过 `backgroundRotation/environmentRotation` 旋转 −1.45° 对齐；主光保持 `(64,104,44)`，避免低角度长阴影影响场地可读性。
- 主光强度 3.7→2.9，半球光 0.42→0.22，补光 0.45→0.26；曝光 1.15→1.05；Canvas 天空保留为加载失败回退。
- HDR 加载成功后停止 Canvas 天空的漂移动画，避免太阳方位漂移。

### 2. 水面平面反射

- 新增半分辨率反射 RTT（画布 0.5×，HalfFloat）+ 以海平面 y=0.055 镜像的相机，采用斜裁剪近平面排除水下几何。
- 相机静止时复用上一帧反射纹理，只在新模型加载或相机移动时重绘；默认静态视角基本无额外开销。
- 海面 shader 增加 `uReflection / uReflectMatrix / uHasReflection`：按屏幕投影采样，叠加法线扰动与三次采样模糊，按 Fresnel 与解析天空混合（0.60 强度、远景 220–820 单位淡出）。
- 反射中隐藏水面自身，避免自反射；`dispose()` 释放 RTT 与镜像相机。

### 3. 树木精细化

- 新增 `modeling/harbor/refine_trees.py`：树干 + 分枝锥台 + 3–4 张交叉叶片面片，生成 `tree-broad/narrow/shrub.glb`（合计约 17KB，单株高度与原 GLB 一致，1.61–1.94）。
- 新增 1024² 透明叶片图集 `tree-leaves.png`（本地脚本生成，固定种子），前端以 `alphaTest .42 + DoubleSide` 渲染；交叉面片法线统一朝上，避免一面过暗。
- 树皮使用 CC0 `Bark016` 的 color/normal/roughness；树按 3 类变体拆成叶片与树干两个 `InstancedMesh` 批次，保留原有树带点位、避让与随机缩放。

### 4. 建筑精细化

- 新增 `modeling/harbor/harbor_kit.py` 与 `refine_all_buildings.py`，按原 GLB 实测包围盒重建 11 栋建筑：食堂、检修间、办公楼、智慧中心、除尘泵房、污水处理场、维修车间、仓库、生态泵房、一体化处理、皮带廊道。
- 立面包含连续窗带/竖挺/窗台、玻璃幕墙与白色竖向遮阳鳍、门厅与雨棚、女儿墙、屋面机组/风机/楼梯间、工业大门与百叶、仓库装卸门与防撞垫、车间锯齿天窗、廊道钢肋与支腿。
- GLB 只保留几何与材质名；前端 `tuneBuildingMaterials()` 按材质名统一覆盖 PBR 参数（玻璃低粗糙度、金属度、白色立面降反照率），避免多套材质数值漂移。
- 落位、原点、尺寸与原 GLB 一致，拾取 token 与檐口逻辑未改。

### 5. 堆场、道路与地面

- 场坪换 `Concrete034`、道路换 `Asphalt012`、绿化带换 `Grass005`（均含 normal/roughness），纹理降到 512px，PBR 总体积约 1.5MB。
- 煤堆保留原 `stockpile()` 形体与 UV，压暗基色（`#868c88`）并降低环境反射，向煤堆色调收敛。

### 6. 新默认机位与后处理

- 桌面机位由 8.53° 长焦（距离 323.6、pitch 16.51°）改为 27° / yaw 5.5° / pitch 20.5°，按场景包围盒自动拟合距离，保留全部堆场、两船与东侧建筑。
- 移除桌面端 viewOffset 裁切；移动端仅保留底部留白补偿。
- 新增 `EffectComposer`：RenderPass → UnrealBloom（阈值 .92、强度 .16）→ OutputPass → SMAA；移动端不启用后处理。

## 验证

- 默认视角：[shots/default.png](shots/default.png)
- 东侧建筑近景：[shots/east-buildings.png](shots/east-buildings.png)
- 低角度水面反射：[shots/water-reflection.png](shots/water-reflection.png)
- 手机 390×844：[shots/mobile-390.png](shots/mobile-390.png)
- 改前/改后：[before-after.png](before-after.png)
- 性能：headless Chrome 1672×941 下 **60.5 FPS**（2 秒 rAF 计数）。
- 说明：启用后处理后 `renderer.info` 会被最后一个全屏 pass 重置，`__stats()` 的 calls/triangles 不再代表主场景，故本轮只记录帧率。
- `npm run build` 通过；`frontend/components.d.ts` 已还原。
- 52 号船、洗车台、明沟、FB499 开槽等几何与拾取逻辑未改；两船均完整入画。

## 仍未达到

- HDR 太阳高度 18.4° 与主光 53.2° 不一致：为保证场地可读性保留高角度主光，天空与 IBL 使用 HDR，水面高光方向以主光为准。
- 平面反射为半分辨率 + 三次采样，默认静态视角不逐帧重绘；强动态光或移动船体时反射不会实时更新。
- 水面仍为法线级波浪，没有顶点位移、折射与泡沫遮罩；远景依赖雾与解析天空。
- 建筑为参数化表现资产，细部尺寸不是测绘成果；玻璃为不透明反射材质，未做真实透射。
- 未使用图片转 3D：本机无可离线运行的图生 3D 服务，且输出不可控；资产均为 Blender 参数化 + CC0 贴图。
