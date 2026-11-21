# 05 · 三维对象与业务映射接口

## 1. 追溯链

```text
CAD Handle → objectId → facilityId → assetId → metricId → systemId
```

| 环节 | 来源 | 当前状态 |
|---|---|---|
| CAD Handle | `scene-v2.2.json` 图元 / 点位 `sourceHandle` | 已接入，可在场景点击核验 |
| objectId | `cad:<handle>` 或 CAD 点位 `id` | 已接入 |
| facilityId | `region-equipment-v2.3.json` 设备 `id`（按 `sourceCadHandle` 匹配） | 已接入；未匹配则为空并标注“设计参考” |
| assetId | 5175 设备主数据 | **未接入**，保持 `null` |
| metricId | 5175 SCADA 测点 | **未接入**，保持 `null` |
| systemId | `systems-v2.5.json` 的 `areaEquipment` 反向索引 | 已接入；一件设备可属于多个系统 |

实现：`src/modules/tanggang/mapping/tanggangCatalog.ts`

- `loadTanggangCatalog()`：一次加载系统与区域设备，建立 `systemMap / regionMap / deviceMap / deviceSystems`。
- `traceCadHandle(handle, catalog)`：返回完整链路与 `note`，未匹配时 `quality='UNKNOWN'|'REF'`。
- `summarizeSystem(system, catalog)`：设备类别、未定位点位、未接入实时数量。
- 缓存：模块级 Promise，多次进入页面不重复请求。

## 2. 数据性质标注

| 枚举 | 中文 | 本轮使用 |
|---|---|---|
| `MEASURED` | 实测 | 未接入，页面明确写“本轮未接入实测” |
| `SIM` | 仿真 | SCADA mock 数据（5175 既有） |
| `REF` | 设计参考 | CAD 图元、区域设备清单 |
| `CALC` | 计算 | 预留 |
| `AI` | AI 建议 | 预留 |
| `UNKNOWN` | 未知 | 未匹配设备点、未核实断点 |

任何未核实的跨系统管路连接都不会被标为已连通；V2.7/V2.8 的候选断点仍按“候选/待核”展示。

## 3. 页面可用接口

| 能力 | 入口 |
|---|---|
| 按系统聚焦 | 场景内六系统筛选条（5188 原版）；外部可用 `initialSystemId` + `focusSystem()` 驱动，供后续专业页复用 |
| 按设备定位 | 场景标签点击 → 场景内浮层；`object-select` 回调已预留，供后续专业页面接统一详情 |
| 按图层显示管线 | 场景内工具条（保留 5188 逻辑），首页未重复造轮子 |
| 复位摄像机 | `expose.resetCamera()`；5188 原版首页通过场景内工具复位，未新增按钮 |
| 对象点击回调 | `object-select` 事件，含 anchor/pipe/yardBand/matchedContour 四类 |
| 状态更新 | 本轮只读；实时状态后续按 `metricId` 接入 |

## 4. 设备详情

- 5188 原版首页中，点击场景标签使用源工程的浮层/点位详情；未新增右侧业务卡，避免改变首页视觉。
- 未直接跳 5175 设备详情页，原因：设计设备清单中的 49 条记录尚未与 5175 `equipment` 主数据建立 `assetId` 映射，强行跳转会出现错误设备。
- `object-select` 事件已带 CAD Handle / 图层 / 对象类型，后续专业页面可据此打开统一详情抽屉或只读占位。

## 5. 已知缺口

1. 49 条设计设备全部为“未定位点位、未接入实时”（数据自身声明 `locatedDevicePoints=0`、`activeRealtimeValues=0`）；5188 原版首页不展示这些统计，后续专业页面需明确标注。
2. 区域设备清单只覆盖设计类别，不等同于 5175 资产台账；两者合并需要工程主数据确认。
3. V2.8 断点、V2.7 未审批管段继续保持“待核/候选”，未在迁移中“修复”。
