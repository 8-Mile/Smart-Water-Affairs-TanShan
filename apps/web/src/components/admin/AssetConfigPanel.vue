<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NTag,
  useMessage,
} from "naive-ui";
import { validateAssetDraft } from "../../demo/commands";
import type { AssetDraft, PointDraft } from "../../demo/commands";
import { can, roleNames } from "../../demo/permissions";
import { useDemoStore } from "../../demo/store";
import type { Asset, DataSource, MeasurePoint } from "../../demo/types";

const store = useDemoStore();
const message = useMessage();

const STATUS_LABELS: Record<Asset["status"], string> = {
  running: "运行",
  stopped: "停机",
  fault: "故障",
  unknown: "未知",
};

const SOURCE_LABELS: Record<DataSource, string> = {
  MOCK: "模拟数据",
  REFERENCE: "资料引用",
  USER_ENTRY: "人工录入",
  CALCULATED: "规则计算",
};

const UNIT_OPTIONS = [
  "MPa",
  "mm/s",
  "℃",
  "A",
  "m³/h",
  "m³/min",
  "m³",
  "%",
  "bar",
  "rpm",
  "kW",
  "V",
  "pH",
  "NTU",
  "m",
].map((unit) => ({ label: unit, value: unit }));

const search = ref("");
const subsystemFilter = ref("all");
const expandedId = ref("");
const selectedId = ref("");
const showCreate = ref(false);
const createError = ref("");
const createTouched = ref(false);
const pointError = ref("");
const bindError = ref("");
const retireNotice = ref("");

interface EditablePointRow {
  label: string;
  unit: string;
  rangeMin: number | null;
  rangeMax: number | null;
  baseline: number | null;
}

function defaultPointRow(): EditablePointRow {
  return { label: "", unit: "MPa", rangeMin: 0, rangeMax: 10, baseline: 1 };
}

const createForm = ref({
  code: "",
  name: "",
  subsystemId: store.subsystems[0]?.id ?? "spray",
  type: "工艺设备",
  powerKw: null as number | null,
  flowM3h: null as number | null,
  headM: null as number | null,
});
const createPoints = ref<EditablePointRow[]>([defaultPointRow()]);
const pointForm = ref<EditablePointRow>(defaultPointRow());
const bindForm = ref({ xPct: 0.5, yPct: 0.5 });

const subsystemOptions = computed(() => [
  { label: "全部子系统", value: "all" },
  ...store.subsystems.map((item) => ({ label: item.name, value: item.id })),
]);
const createSubsystemOptions = computed(() =>
  store.subsystems.map((item) => ({
    label: `${item.name}（${item.id}）`,
    value: item.id,
  })),
);

const canCreate = computed(() => can(store.role, "asset:create"));
const canAddPoint = computed(() => can(store.role, "point:add"));
const canBind = computed(() => can(store.role, "binding:write"));

const createDeny = computed(
  () => `角色「${roleNames[store.role]}」无权新增设备（需要 asset:create 权限，仅系统管理员）。`,
);
const pointDeny = computed(
  () => `角色「${roleNames[store.role]}」无权追加测点（需要 point:add 权限）。`,
);
const bindDeny = computed(
  () => `角色「${roleNames[store.role]}」无权调整工艺点位（需要 binding:write 权限）。`,
);

function optionalNumber(value: number | null): number | undefined {
  return value === null || !Number.isFinite(value) ? undefined : value;
}

function toPointDraft(row: EditablePointRow): PointDraft {
  const range: [number, number] | undefined =
    row.rangeMin !== null && row.rangeMax !== null
      ? [row.rangeMin, row.rangeMax]
      : undefined;
  return {
    label: row.label.trim(),
    kind: "number",
    unit: row.unit.trim() || undefined,
    range,
    source: "USER_ENTRY",
    quality: "estimated",
    samplePeriodMinutes: 30,
    baseline: optionalNumber(row.baseline),
    volatility: 0.05,
  };
}

const createDraft = computed<AssetDraft>(() => ({
  code: createForm.value.code.trim(),
  name: createForm.value.name.trim(),
  subsystemId: createForm.value.subsystemId,
  type: createForm.value.type.trim(),
  rated: {
    powerKw: optionalNumber(createForm.value.powerKw),
    flowM3h: optionalNumber(createForm.value.flowM3h),
    headM: optionalNumber(createForm.value.headM),
  },
  points: createPoints.value.map(toPointDraft),
}));

const createValidation = computed(() =>
  validateAssetDraft(store.seed, store.userState, createDraft.value),
);
const codeConflict = computed(() =>
  createValidation.value.errors.find((issue) => issue.field === "code"),
);

const bindingMap = computed(() => {
  const map = new Map<string, { xPct: number; yPct: number }>();
  for (const binding of store.bindings) {
    map.set(binding.assetId, { xPct: binding.xPct, yPct: binding.yPct });
  }
  return map;
});

const pointsMap = computed(() => {
  const map = new Map<string, MeasurePoint[]>();
  for (const point of store.points) {
    const list = map.get(point.assetId);
    if (list) list.push(point);
    else map.set(point.assetId, [point]);
  }
  return map;
});

const filteredAssets = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return store.assets
    .filter(
      (asset) =>
        subsystemFilter.value === "all" || asset.subsystemId === subsystemFilter.value,
    )
    .filter(
      (asset) =>
        !keyword ||
        asset.code.toLowerCase().includes(keyword) ||
        asset.name.toLowerCase().includes(keyword),
    )
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code));
});

const selectedAsset = computed(() =>
  selectedId.value ? store.getAsset(selectedId.value) : undefined,
);
const selectedPoints = computed(() =>
  selectedId.value ? store.getPoints(selectedId.value) : [],
);
const selectedBinding = computed(() => bindingMap.value.get(selectedId.value));

interface AssetUsage {
  alarms: number;
  workorders: number;
  inspections: number;
  maintenance: number;
  documents: number;
  total: number;
}

function usageOf(assetId: string): AssetUsage {
  const alarms = store.alarms.filter((item) => item.assetId === assetId).length;
  const workorders = store.workorders.filter((item) => item.assetId === assetId).length;
  const inspections = store.inspections.filter((item) => item.assetId === assetId).length;
  const maintenance = store.maintenance.filter((item) => item.assetId === assetId).length;
  const documents = store.documents.filter((item) =>
    item.assetIds.includes(assetId),
  ).length;
  return {
    alarms,
    workorders,
    inspections,
    maintenance,
    documents,
    total: alarms + workorders + inspections + maintenance + documents,
  };
}

const selectedUsage = computed(() =>
  selectedId.value ? usageOf(selectedId.value) : null,
);

function pointsOf(assetId: string): MeasurePoint[] {
  return pointsMap.value.get(assetId) ?? [];
}

function subsystemName(id: string): string {
  return store.subsystems.find((item) => item.id === id)?.name ?? `未知子系统（${id}）`;
}

function formatRange(point: MeasurePoint): string {
  if (!point.range) return "未设置";
  return `${point.range[0]} ~ ${point.range[1]}${point.unit ? ` ${point.unit}` : ""}`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

watch(selectedBinding, (binding) => {
  if (binding) {
    bindForm.value = { xPct: binding.xPct, yPct: binding.yPct };
  }
});

function selectAsset(asset: Asset): void {
  selectedId.value = asset.id;
  expandedId.value = expandedId.value === asset.id ? "" : asset.id;
  pointError.value = "";
  bindError.value = "";
  retireNotice.value = "";
  pointForm.value = defaultPointRow();
  const binding = bindingMap.value.get(asset.id);
  bindForm.value = binding
    ? { xPct: binding.xPct, yPct: binding.yPct }
    : { xPct: 0.5, yPct: 0.5 };
}

function toggleCreate(): void {
  showCreate.value = !showCreate.value;
  createError.value = "";
  createTouched.value = false;
}

function addCreatePoint(): void {
  createPoints.value = [...createPoints.value, defaultPointRow()];
}

function removeCreatePoint(index: number): void {
  if (createPoints.value.length <= 1) {
    message.warning("新增设备至少需要保留 1 个测点");
    return;
  }
  createPoints.value = createPoints.value.filter((_, itemIndex) => itemIndex !== index);
}

function resetCreate(): void {
  createForm.value = {
    code: "",
    name: "",
    subsystemId: store.subsystems[0]?.id ?? "spray",
    type: "工艺设备",
    powerKw: null,
    flowM3h: null,
    headM: null,
  };
  createPoints.value = [defaultPointRow()];
}

function submitCreate(): void {
  createTouched.value = true;
  createError.value = "";
  if (!canCreate.value) {
    createError.value = createDeny.value;
    message.warning(createDeny.value);
    return;
  }
  const result = validateAssetDraft(store.seed, store.userState, createDraft.value);
  if (!result.ok) {
    createError.value = result.errors.map((issue) => issue.message).join("；");
    message.error(createError.value);
    return;
  }
  const code = createForm.value.code.trim();
  const subsystemId = createForm.value.subsystemId;
  const pointCount = createDraft.value.points.length;
  try {
    store.commitAssetDraft(createDraft.value);
    const created = store.assets.find(
      (asset) =>
        asset.subsystemId === subsystemId &&
        asset.code.trim().toLowerCase() === code.toLowerCase(),
    );
    if (created) {
      selectedId.value = created.id;
      expandedId.value = created.id;
      pointForm.value = defaultPointRow();
      bindForm.value = { xPct: 0.5, yPct: 0.5 };
      retireNotice.value = "";
    }
    message.success(`已创建 ${created?.code ?? code}，同步写入 ${pointCount} 个测点`);
    showCreate.value = false;
    createTouched.value = false;
    resetCreate();
  } catch (error) {
    createError.value = (error as Error).message;
    message.error(createError.value);
  }
}

function submitPoint(): void {
  if (!selectedAsset.value) return;
  if (!canAddPoint.value) {
    message.warning(pointDeny.value);
    return;
  }
  pointError.value = "";
  try {
    store.addPoint(selectedAsset.value.id, toPointDraft(pointForm.value));
    message.success(
      `已为 ${selectedAsset.value.code} 追加测点「${pointForm.value.label.trim()}」`,
    );
    pointForm.value = defaultPointRow();
  } catch (error) {
    pointError.value = (error as Error).message;
    message.error(pointError.value);
  }
}

function submitBinding(): void {
  if (!selectedAsset.value) return;
  if (!canBind.value) {
    message.warning(bindDeny.value);
    return;
  }
  const { xPct, yPct } = bindForm.value;
  bindError.value = "";
  if (
    !Number.isFinite(xPct) ||
    !Number.isFinite(yPct) ||
    xPct < 0 ||
    xPct > 1 ||
    yPct < 0 ||
    yPct > 1
  ) {
    bindError.value = "工艺点位坐标必须位于 0~1 之间";
    message.error(bindError.value);
    return;
  }
  try {
    store.bindAsset(selectedAsset.value.id, { xPct, yPct });
    message.success(`已更新 ${selectedAsset.value.code} 的工艺点位`);
  } catch (error) {
    bindError.value = (error as Error).message;
    message.error(bindError.value);
  }
}

function evaluateRetire(): void {
  const asset = selectedAsset.value;
  const usage = selectedUsage.value;
  if (!asset || !usage) return;
  const reason =
    usage.total === 0
      ? "该设备暂无告警、工单、巡检、维保或档案关联。"
      : `该设备存在告警 ${usage.alarms} 条、工单 ${usage.workorders} 单、巡检 ${usage.inspections} 条、维保 ${usage.maintenance} 条、档案 ${usage.documents} 份。`;
  retireNotice.value = `${reason} 历史资料必须保留，禁止物理删除；仅可解绑点位（调整可视化坐标）。当前演示 store 未提供退役/解绑命令，本页只展示影响，不执行写入。`;
  message.warning("已阻止物理删除：仅展示关联影响，不写入退役状态。");
}
</script>

<template>
  <div class="admin-page">
    <section class="admin-panel">
      <div class="panel-head">
        <div>
          <h2>设备与测点配置</h2>
          <p>
            {{ store.assets.length }} 台设备 · {{ store.points.length }} 个测点 ·
            {{ store.bindings.length }} 个工艺点位
          </p>
        </div>
        <NButton
          type="primary"
          size="small"
          :disabled="!canCreate"
          :title="canCreate ? '打开新增设备表单' : createDeny"
          @click="toggleCreate"
        >
          {{ showCreate ? "收起新增表单" : "新增设备" }}
        </NButton>
      </div>

      <p v-if="!canCreate" class="deny-hint">{{ createDeny }}</p>

      <div v-if="showCreate" class="create-card">
        <div class="card-head">
          <h3>新增设备</h3>
          <span>复用 store.commitAssetDraft，提交后同步写入设备、测点与审计</span>
        </div>

        <div class="form-grid">
          <label>
            <span>设备编号</span>
            <NInput v-model:value="createForm.code" placeholder="如 P-003" />
            <small v-if="createForm.code.trim() && codeConflict" class="field-error">
              {{ codeConflict.message }}
            </small>
          </label>
          <label>
            <span>设备名称</span>
            <NInput v-model:value="createForm.name" placeholder="如 3号供水泵" />
          </label>
          <label>
            <span>所属子系统</span>
            <NSelect
              v-model:value="createForm.subsystemId"
              :options="createSubsystemOptions"
            />
          </label>
          <label>
            <span>设备类型</span>
            <NInput v-model:value="createForm.type" placeholder="如 离心泵" />
          </label>
          <label>
            <span>额定功率（kW）</span>
            <NInputNumber v-model:value="createForm.powerKw" :min="0" />
          </label>
          <label>
            <span>额定流量（m³/h）</span>
            <NInputNumber v-model:value="createForm.flowM3h" :min="0" />
          </label>
          <label>
            <span>额定扬程（m）</span>
            <NInputNumber v-model:value="createForm.headM" :min="0" />
          </label>
        </div>

        <div class="point-block">
          <div class="card-head">
            <h3>测点（至少 1 个）</h3>
            <NButton size="tiny" secondary @click="addCreatePoint">添加测点</NButton>
          </div>
          <div
            v-for="(row, index) in createPoints"
            :key="index"
            class="point-row"
          >
            <label class="grow">
              <span>测点名称</span>
              <NInput v-model:value="row.label" size="small" placeholder="如 出口压力" />
            </label>
            <label>
              <span>单位</span>
              <NSelect
                v-model:value="row.unit"
                size="small"
                :options="UNIT_OPTIONS"
                filterable
              />
            </label>
            <label>
              <span>量程下限</span>
              <NInputNumber v-model:value="row.rangeMin" size="small" />
            </label>
            <label>
              <span>量程上限</span>
              <NInputNumber v-model:value="row.rangeMax" size="small" />
            </label>
            <label>
              <span>基准值</span>
              <NInputNumber v-model:value="row.baseline" size="small" />
            </label>
            <NButton size="tiny" quaternary type="error" @click="removeCreatePoint(index)">
              移除
            </NButton>
          </div>
        </div>

        <div v-if="createError" class="issue-box error">{{ createError }}</div>
        <div v-else-if="createTouched && !createValidation.ok" class="issue-box">
          <ul>
            <li v-for="issue in createValidation.errors" :key="issue.field">
              {{ issue.message }}
            </li>
          </ul>
        </div>

        <div class="form-actions">
          <NButton
            type="primary"
            size="small"
            :disabled="!canCreate"
            :title="canCreate ? '提交并写入本地演示数据' : createDeny"
            @click="submitCreate"
          >
            提交新增
          </NButton>
          <NButton size="small" @click="toggleCreate">取消</NButton>
          <span class="hint">编号在同一子系统内必须唯一；单位需在允许范围内。</span>
        </div>
      </div>

      <div class="filter-bar">
        <NInput
          v-model:value="search"
          placeholder="搜索设备编号或名称"
          clearable
          style="width: 200px"
        />
        <NSelect
          v-model:value="subsystemFilter"
          :options="subsystemOptions"
          style="width: 150px"
        />
        <span class="result-count">共 {{ filteredAssets.length }} 台</span>
      </div>

      <div v-if="filteredAssets.length" class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>名称</th>
              <th>类型</th>
              <th>子系统</th>
              <th>状态</th>
              <th>测点</th>
              <th>工艺绑定</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="asset in filteredAssets" :key="asset.id">
              <tr
                class="clickable"
                :class="{ selected: selectedId === asset.id }"
                tabindex="0"
                @click="selectAsset(asset)"
                @keydown.enter="selectAsset(asset)"
              >
                <td class="mono">{{ asset.code }}</td>
                <td class="title-cell">
                  {{ asset.name }}
                  <NTag v-if="asset.archived" size="tiny" :bordered="false">已退役</NTag>
                </td>
                <td>{{ asset.type }}</td>
                <td>{{ subsystemName(asset.subsystemId) }}</td>
                <td>
                  <NTag
                    size="tiny"
                    :bordered="false"
                    :type="
                      asset.status === 'fault'
                        ? 'error'
                        : asset.status === 'running'
                          ? 'success'
                          : 'default'
                    "
                  >
                    {{ STATUS_LABELS[asset.status] }}
                  </NTag>
                </td>
                <td>{{ pointsOf(asset.id).length }}</td>
                <td>
                  <NTag
                    size="tiny"
                    :bordered="false"
                    :type="bindingMap.has(asset.id) ? 'success' : 'warning'"
                  >
                    {{ bindingMap.has(asset.id) ? "已布置" : "未布置" }}
                  </NTag>
                </td>
                <td>{{ SOURCE_LABELS[asset.source] }}</td>
              </tr>
              <tr v-if="expandedId === asset.id" class="detail-row">
                <td colspan="8">
                  <div class="point-detail">
                    <div class="detail-head">
                      <strong>{{ asset.code }} · {{ asset.name }} 测点</strong>
                      <small>{{ pointsOf(asset.id).length }} 个</small>
                    </div>
                    <table v-if="pointsOf(asset.id).length" class="inner-table">
                      <thead>
                        <tr>
                          <th>测点名称</th>
                          <th>类型</th>
                          <th>单位</th>
                          <th>量程</th>
                          <th>基准值</th>
                          <th>质量</th>
                          <th>来源</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="point in pointsOf(asset.id)" :key="point.id">
                          <td>{{ point.label }}</td>
                          <td>{{ point.kind === "number" ? "数值" : "状态量" }}</td>
                          <td>{{ point.unit ?? "无" }}</td>
                          <td>{{ formatRange(point) }}</td>
                          <td>{{ point.baseline ?? "未提供" }}</td>
                          <td>{{ point.quality }}</td>
                          <td>{{ SOURCE_LABELS[point.source] }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p v-else class="empty-inline">该设备暂无测点。</p>
                    <p class="detail-hint">
                      点击本行可查看下方「追加测点 / 工艺点位 / 退役评估」操作。
                    </p>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">没有匹配的设备，请调整搜索关键词或子系统筛选。</p>
    </section>

    <section v-if="selectedAsset" class="admin-panel">
      <div class="panel-head">
        <div>
          <h2>{{ selectedAsset.code }} · {{ selectedAsset.name }}</h2>
          <p>
            {{ subsystemName(selectedAsset.subsystemId) }} ·
            {{ STATUS_LABELS[selectedAsset.status] }} ·
            {{ SOURCE_LABELS[selectedAsset.source] }} ·
            测点 {{ selectedPoints.length }} 个
          </p>
        </div>
        <NTag size="small" :bordered="false" :type="selectedBinding ? 'success' : 'warning'">
          {{ selectedBinding ? "已绑定工艺点位" : "未布置" }}
        </NTag>
      </div>

      <div class="op-grid">
        <article class="op-card">
          <h3>追加测点</h3>
          <div class="op-form">
            <label>
              <span>测点名称</span>
              <NInput v-model:value="pointForm.label" size="small" placeholder="如 轴承温度" />
            </label>
            <label>
              <span>单位</span>
              <NSelect
                v-model:value="pointForm.unit"
                size="small"
                :options="UNIT_OPTIONS"
                filterable
              />
            </label>
            <label>
              <span>量程下限</span>
              <NInputNumber v-model:value="pointForm.rangeMin" size="small" />
            </label>
            <label>
              <span>量程上限</span>
              <NInputNumber v-model:value="pointForm.rangeMax" size="small" />
            </label>
            <label>
              <span>基准值</span>
              <NInputNumber v-model:value="pointForm.baseline" size="small" />
            </label>
          </div>
          <p v-if="pointError" class="field-error">{{ pointError }}</p>
          <p v-if="!canAddPoint" class="deny-hint">{{ pointDeny }}</p>
          <div class="op-actions">
            <NButton
              size="small"
              type="primary"
              :disabled="!canAddPoint"
              :title="canAddPoint ? '调用 store.addPoint' : pointDeny"
              @click="submitPoint"
            >
              追加测点
            </NButton>
            <span class="hint">测点名重复或单位非法会被命令层拒绝。</span>
          </div>
        </article>

        <article class="op-card">
          <h3>工艺点位</h3>
          <p class="hint">
            输入 0~1 的归一化坐标，或前往工艺图点选。
            该绑定仅用于可视化，不代表真实管网或电气连接。
          </p>
          <div class="op-form two">
            <label>
              <span>x 坐标（0~1）</span>
              <NInputNumber
                v-model:value="bindForm.xPct"
                size="small"
                :min="0"
                :max="1"
                :step="0.01"
              />
            </label>
            <label>
              <span>y 坐标（0~1）</span>
              <NInputNumber
                v-model:value="bindForm.yPct"
                size="small"
                :min="0"
                :max="1"
                :step="0.01"
              />
            </label>
          </div>
          <p v-if="selectedBinding" class="binding-line">
            当前坐标：x {{ formatPct(selectedBinding.xPct) }} · y
            {{ formatPct(selectedBinding.yPct) }}
          </p>
          <p v-else class="binding-line">当前未布置，可在工艺图或此处绑定。</p>
          <p v-if="bindError" class="field-error">{{ bindError }}</p>
          <p v-if="!canBind" class="deny-hint">{{ bindDeny }}</p>
          <div class="op-actions">
            <NButton
              size="small"
              type="primary"
              :disabled="!canBind"
              :title="canBind ? '调用 store.bindAsset' : bindDeny"
              @click="submitBinding"
            >
              保存点位
            </NButton>
            <RouterLink
              class="link-button"
              :to="`/process/${selectedAsset.subsystemId}?assetId=${selectedAsset.id}`"
            >
              去工艺图点选
            </RouterLink>
          </div>
        </article>

        <article class="op-card">
          <h3>退役 / 删除评估</h3>
          <ul v-if="selectedUsage" class="usage-list">
            <li><span>告警</span><strong>{{ selectedUsage.alarms }}</strong></li>
            <li><span>工单</span><strong>{{ selectedUsage.workorders }}</strong></li>
            <li><span>巡检</span><strong>{{ selectedUsage.inspections }}</strong></li>
            <li><span>维保</span><strong>{{ selectedUsage.maintenance }}</strong></li>
            <li><span>档案</span><strong>{{ selectedUsage.documents }}</strong></li>
          </ul>
          <p class="hint">
            存在历史关联时禁止物理删除，历史资料必须保留；仅可解绑点位（调整可视化坐标）。
          </p>
          <p v-if="retireNotice" class="issue-box">{{ retireNotice }}</p>
          <div class="op-actions">
            <NButton size="small" type="error" secondary @click="evaluateRetire">
              评估退役 / 删除
            </NButton>
            <span class="hint">store 未提供退役命令，本页不伪造写入。</span>
          </div>
        </article>
      </div>
    </section>
    <p v-else class="empty">
      点击上方设备行，可展开测点并配置追加测点、工艺点位与退役影响。
    </p>
  </div>
</template>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.admin-panel {
  min-width: 0;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(160, 198, 220, 0.55);
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(36, 123, 168, 0.05);
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  color: #1c3e57;
}
.panel-head p {
  margin: 4px 0 0;
  font-size: 11px;
  color: #748a9d;
  line-height: 1.7;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
}
.result-count {
  margin-left: auto;
  font-size: 11px;
  color: #8296a8;
  white-space: nowrap;
}
.hint {
  margin: 0;
  font-size: 10.5px;
  color: #8296a8;
  line-height: 1.7;
}
.deny-hint {
  margin: 6px 0 0;
  font-size: 10.5px;
  color: #a06a1f;
  line-height: 1.7;
}
.create-card {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #e2edf4;
  border-radius: 9px;
  background: #fbfdff;
}
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.card-head h3 {
  margin: 0;
  font-size: 12.5px;
  color: #1c3e57;
}
.card-head span {
  font-size: 10px;
  color: #93a7b7;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.form-grid label,
.op-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  color: #6c8296;
}
.field-error {
  margin: 5px 0 0;
  color: #b0453d;
  font-size: 10.5px;
  line-height: 1.6;
}
.point-block {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed #e0edf5;
}
.point-row {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 7px;
}
.point-row label {
  min-width: 92px;
}
.point-row label.grow {
  flex: 1;
  min-width: 150px;
}
.form-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed #e0edf5;
}
.issue-box {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid #f0d6a4;
  border-radius: 7px;
  background: #fdf7ec;
  font-size: 10.5px;
  color: #8a5c15;
  line-height: 1.7;
}
.issue-box.error {
  border-color: #f0c9c4;
  background: #fdf1f0;
  color: #a33f37;
}
.issue-box ul {
  margin: 0;
  padding-left: 16px;
}
.table-wrap {
  width: 100%;
  max-height: 50vh;
  overflow: auto;
  border: 1px solid #e6eff5;
  border-radius: 8px;
}
.data-table {
  width: 100%;
  min-width: 880px;
  border-collapse: collapse;
  font-size: 12px;
}
.data-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  padding: 8px;
  color: #6c8296;
  font-weight: 500;
  background: #f1f7fb;
  white-space: nowrap;
}
.data-table td {
  padding: 8px;
  border-bottom: 1px solid #e6eef4;
  color: #2a4660;
  vertical-align: middle;
}
.data-table tbody tr.clickable {
  cursor: pointer;
}
.data-table tbody tr:hover {
  background: #eef7fc;
}
.data-table tbody tr.selected {
  background: #e2f1fb;
  box-shadow: inset 2px 0 0 #247ba8;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
}
.title-cell {
  min-width: 160px;
  word-break: break-word;
}
.detail-row td {
  background: #f8fbfe;
  padding: 8px 10px;
}
.point-detail {
  border: 1px solid #e2edf4;
  border-radius: 8px;
  padding: 9px 10px;
  background: #fff;
}
.detail-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.detail-head strong {
  font-size: 11.5px;
  color: #1c3e57;
}
.detail-head small {
  font-size: 10px;
  color: #93a7b7;
}
.inner-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.inner-table th {
  position: static;
  padding: 5px 6px;
  background: #f4f9fc;
  color: #7c93a5;
}
.inner-table td {
  padding: 5px 6px;
  border-bottom: 1px solid #eef5fa;
}
.empty-inline {
  margin: 4px 0;
  font-size: 11px;
  color: #93a7b7;
}
.detail-hint {
  margin: 6px 0 0;
  font-size: 10px;
  color: #93a7b7;
}
.op-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.op-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px;
  border: 1px solid #e2edf4;
  border-radius: 9px;
  background: #fbfdff;
}
.op-card h3 {
  margin: 0;
  font-size: 12.5px;
  color: #1c3e57;
}
.op-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 7px;
}
.op-form.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.binding-line {
  margin: 0;
  font-size: 10.5px;
  color: #247ba8;
}
.op-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 6px;
}
.link-button {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid #cbe4f2;
  border-radius: 6px;
  background: #f1f9fe;
  color: #247ba8;
  font-size: 11.5px;
}
.link-button:hover {
  background: #e2f1fb;
}
.usage-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.usage-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 4px 7px;
  border-radius: 6px;
  background: #f1f7fb;
  font-size: 10.5px;
  color: #6c8296;
}
.usage-list strong {
  font-size: 12px;
  color: #1c3e57;
}
.empty {
  margin: 10px 0;
  padding: 14px;
  border: 1px dashed #dbe8f1;
  border-radius: 8px;
  font-size: 11.5px;
  color: #8296a8;
  line-height: 1.8;
  background: rgba(255, 255, 255, 0.6);
}
@media (max-width: 1200px) {
  .form-grid,
  .op-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 860px) {
  .form-grid,
  .op-grid,
  .op-form.two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
