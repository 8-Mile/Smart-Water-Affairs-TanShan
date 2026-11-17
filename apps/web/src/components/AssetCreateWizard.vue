<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NTag,
  useMessage,
} from "naive-ui";
import Chart from "../Chart.vue";
import ProcessCanvas from "./ProcessCanvas.vue";
import { validateAssetDraft } from "../demo/commands";
import type { AssetDraft, PointDraft } from "../demo/commands";
import type { IntentPointSpec, ParsedIntent } from "../demo/intent";
import { can, roleNames } from "../demo/permissions";
import { jitterAround, roundTo } from "../demo/random";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";

const props = defineProps<{ intent: ParsedIntent }>();
const emit = defineEmits<{
  close: [];
  cancelled: [];
  created: [
    payload: {
      assetId: string;
      code: string;
      name: string;
      pointIds: string[];
      hotspot: boolean;
      subsystemId: string;
    },
  ];
}>();

const store = useDemoStore();
const ui = useUiStore();
const router = useRouter();
const message = useMessage();

const STEP_TITLES = ["解析预览", "测点配置", "绑定工艺", "最终确认", "创建成功"];

interface EditablePoint {
  key: string;
  label: string;
  kind: "number" | "enum";
  unit: string;
  rangeMin: number | null;
  rangeMax: number | null;
  baseline: number | null;
  volatility: number | null;
  enumStates: string;
  parsedFrom?: string;
}

interface CreatedResult {
  assetId: string;
  code: string;
  name: string;
  pointIds: string[];
  hotspot: boolean;
  subsystemId: string;
}

let pointSeq = 0;

function nextKey(): string {
  pointSeq += 1;
  return `point-${pointSeq}`;
}

function fromSpec(spec: IntentPointSpec): EditablePoint {
  return {
    key: nextKey(),
    label: spec.label,
    kind: spec.kind,
    unit: spec.unit ?? "",
    rangeMin: spec.range?.[0] ?? null,
    rangeMax: spec.range?.[1] ?? null,
    baseline: spec.baseline ?? null,
    volatility: spec.volatility ?? null,
    enumStates: (spec.enumStates ?? []).join(", "),
    parsedFrom: spec.parsedFrom,
  };
}

const step = ref(1);
const created = ref<CreatedResult | null>(null);
const submitError = ref("");

const code = ref(props.intent.asset?.code ?? "");
const name = ref(props.intent.asset?.name ?? "");
const subsystemId = ref(
  props.intent.subsystemId ?? store.subsystems[0]?.id ?? "spray",
);
const type = ref(props.intent.asset?.type ?? "工艺设备");
const powerKw = ref<number | null>(props.intent.asset?.rated.powerKw ?? null);
const flowM3h = ref<number | null>(props.intent.asset?.rated.flowM3h ?? null);
const headM = ref<number | null>(props.intent.asset?.rated.headM ?? null);
const points = ref<EditablePoint[]>(props.intent.points.map(fromSpec));
const picked = ref<{ xPct: number; yPct: number } | null>(null);
const previewKey = ref<string | null>(
  points.value.find((point) => point.kind === "number")?.key ?? null,
);
const submitting = ref(false);

const subsystemOptions = store.subsystems.map((item) => ({
  value: item.id,
  label: `${item.name}（${item.id}）`,
}));
const subsystemName = computed(
  () => store.subsystems.find((item) => item.id === subsystemId.value)?.name ?? "未选择",
);
const kindOptions = [
  { value: "number", label: "数值" },
  { value: "enum", label: "状态量" },
];

const fieldSources = computed(() => ({
  code: props.intent.asset?.code ? "AI 解析" : "未提供",
  name: props.intent.asset?.name ? "AI 解析" : "未提供",
  subsystemId: props.intent.subsystemId ? "上下文/AI 解析" : "未识别",
  type:
    props.intent.asset?.typeSource === "parsed"
      ? "AI 解析"
      : props.intent.asset
        ? "默认值"
        : "默认值",
  powerKw: props.intent.asset?.ratedSource.powerKw === "parsed" ? "AI 解析" : "未提供",
  flowM3h: props.intent.asset?.ratedSource.flowM3h === "parsed" ? "AI 解析" : "未提供",
  headM: props.intent.asset?.ratedSource.headM === "parsed" ? "AI 解析" : "未提供",
  points: props.intent.points.length ? "AI 解析" : "未识别",
}));

function numberOrUndefined(value: number | null): number | undefined {
  return value === null || !Number.isFinite(value) ? undefined : value;
}

function pointDraft(point: EditablePoint): PointDraft {
  return {
    label: point.label.trim(),
    kind: point.kind,
    unit: point.kind === "number" && point.unit.trim() ? point.unit.trim() : undefined,
    range:
      point.kind === "number" && point.rangeMin !== null && point.rangeMax !== null
        ? [point.rangeMin, point.rangeMax]
        : undefined,
    source: "MOCK",
    quality: "estimated",
    samplePeriodMinutes: 30,
    baseline: numberOrUndefined(point.baseline),
    volatility: point.kind === "number" ? numberOrUndefined(point.volatility) : undefined,
    enumStates:
      point.kind === "enum"
        ? point.enumStates
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
  };
}

const draft = computed<AssetDraft>(() => ({
  code: code.value.trim(),
  name: name.value.trim(),
  subsystemId: subsystemId.value,
  type: type.value.trim(),
  rated: {
    powerKw: numberOrUndefined(powerKw.value),
    flowM3h: numberOrUndefined(flowM3h.value),
    headM: numberOrUndefined(headM.value),
  },
  points: points.value.map(pointDraft),
  binding: picked.value
    ? { xPct: picked.value.xPct, yPct: picked.value.yPct }
    : undefined,
}));

const validation = computed(() =>
  validateAssetDraft(store.seed, store.userState, draft.value),
);
const basicErrors = computed(() =>
  validation.value.errors.filter((issue) => !issue.field.startsWith("points")),
);
const pointErrors = computed(() =>
  validation.value.errors.filter((issue) => issue.field.startsWith("points")),
);
const codeConflict = computed(() =>
  validation.value.errors.find((issue) => issue.field === "code"),
);
const canCreate = computed(() => can(store.role, "asset:create"));

const canContinue = computed(() => {
  if (step.value === 1) return basicErrors.value.length === 0;
  if (step.value === 2) {
    return points.value.length > 0 && validation.value.errors.length === 0;
  }
  if (step.value === 4) return validation.value.ok && canCreate.value;
  return true;
});

function addPoint(): void {
  const point: EditablePoint = {
    key: nextKey(),
    label: "新测点",
    kind: "number",
    unit: "MPa",
    rangeMin: 0,
    rangeMax: 10,
    baseline: 1,
    volatility: 0.05,
    enumStates: "",
    parsedFrom: "人工新增",
  };
  points.value = [...points.value, point];
  if (!previewKey.value) previewKey.value = point.key;
}

function removePoint(key: string): void {
  points.value = points.value.filter((point) => point.key !== key);
}

function enumOptions(point: EditablePoint) {
  return point.enumStates
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => ({ value: index, label: `${item}（${index}）` }));
}

function onPick(point: { xPct: number; yPct: number }): void {
  picked.value = point;
}

function clearPick(): void {
  picked.value = null;
}

function next(): void {
  if (!canContinue.value) return;
  if (step.value === 4) {
    commit();
    return;
  }
  step.value += 1;
  submitError.value = "";
}

function previous(): void {
  if (step.value > 1) step.value -= 1;
}

function cancel(): void {
  if (created.value) {
    emit("close");
    return;
  }
  emit("cancelled");
}

function commit(): void {
  submitting.value = true;
  submitError.value = "";
  const result = validateAssetDraft(store.seed, store.userState, draft.value);
  if (!result.ok) {
    submitError.value = result.errors.map((issue) => issue.message).join("；");
    submitting.value = false;
    return;
  }
  if (!can(store.role, "asset:create")) {
    submitError.value = `FORBIDDEN：角色「${roleNames[store.role]}」无 asset:create 权限，需切换为系统管理员并由人工确认。`;
    submitting.value = false;
    return;
  }
  try {
    store.commitAssetDraft(draft.value);
    const asset = store.assets.find(
      (item) =>
        item.subsystemId === subsystemId.value &&
        item.code.trim().toLowerCase() === code.value.trim().toLowerCase(),
    );
    if (!asset) throw new Error("提交后未查询到新设备，请检查本地存储状态");
    const pointIds = store.getPoints(asset.id).map((point) => point.id);
    created.value = {
      assetId: asset.id,
      code: asset.code,
      name: asset.name,
      pointIds,
      hotspot: Boolean(picked.value),
      subsystemId: asset.subsystemId,
    };
    step.value = 5;
    emit("created", created.value);
    message.success(`已创建 ${asset.code}，新增 ${pointIds.length} 个测点`);
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    submitError.value =
      failure.code === "FORBIDDEN"
        ? `FORBIDDEN：${failure.message ?? "当前角色无提交权限"}`
        : (failure.message ?? "提交失败，未写入任何数据");
  } finally {
    submitting.value = false;
  }
}

const previewPoint = computed(
  () =>
    points.value.find(
      (point) => point.key === previewKey.value && point.kind === "number",
    ) ?? points.value.find((point) => point.kind === "number"),
);
const previewOptions = computed(() =>
  points.value
    .filter((point) => point.kind === "number")
    .map((point) => ({
      value: point.key,
      label: point.unit ? `${point.label}（${point.unit}）` : point.label,
    })),
);
const preview = computed(() => {
  const point = previewPoint.value;
  if (!point) return null;
  const base = point.baseline ?? 0;
  const volatility = point.volatility ?? 0;
  const refMs = Date.parse(store.seed.referenceTime);
  const digits = point.unit === "MPa" || point.unit === "mm/s" ? 2 : 1;
  const values = jitterAround(
    base,
    volatility,
    `${code.value || "draft"}-${point.label}`,
    24,
  ).map((value) => roundTo(value, digits));
  return {
    point,
    labels: values.map((_, index) => {
      const at = new Date(refMs - (23 - index) * 3_600_000);
      return `${String(at.getHours()).padStart(2, "0")}:00`;
    }),
    values,
  };
});

watch(
  points,
  (list) => {
    if (!list.some((point) => point.key === previewKey.value && point.kind === "number")) {
      previewKey.value = list.find((point) => point.kind === "number")?.key ?? null;
    }
  },
  { deep: true },
);

watch(subsystemId, () => {
  picked.value = null;
});

function goProcess(tab: "trend" | "assets" | null): void {
  const result = created.value;
  if (!result) return;
  void router.push({
    path: `/process/${result.subsystemId}`,
    query: tab ? { tab } : undefined,
  });
  emit("close");
}

function openDrawer(): void {
  if (!created.value) return;
  ui.openAsset(created.value.assetId);
  emit("close");
}

function goLedger(documents = false): void {
  if (!created.value) return;
  void router.push({
    path: "/operations/assets",
    query: documents
      ? { assetId: created.value.assetId, tab: "documents" }
      : { assetId: created.value.assetId },
  });
  emit("close");
}
</script>

<template>
  <NModal
    :show="true"
    preset="card"
    title="AI 新增设备 · 五步向导"
    style="width: min(1060px, 96vw)"
    :mask-closable="false"
    @update:show="(value: boolean) => !value && cancel()"
  >
    <template #header-extra>
      <NTag size="small" type="warning" :bordered="false">模拟数据 · 本地提交</NTag>
    </template>

    <div v-if="created" class="success-panel">
      <h3>创建成功</h3>
      <p class="success-line">
        设备 <strong>{{ created.code }} · {{ created.name }}</strong>
        <span>assetId：{{ created.assetId }}</span>
      </p>
      <p class="success-line">
        新增测点 {{ created.pointIds.length }} 个：
        <span>{{ created.pointIds.join("、") }}</span>
      </p>
      <p class="success-line">
        工艺热点：
        <strong>{{ created.hotspot ? "已布置 1 个" : "未布置（台账与搜索仍可命中）" }}</strong>
        <span v-if="created.hotspot">仅可视化绑定，不代表真实管网连接</span>
      </p>
      <p class="mock-note">
        数据标签：模拟数据。测点序列由固定种子生成，可在设备抽屉与趋势中查询；刷新浏览器仍保留。
      </p>
      <div class="success-actions">
        <NButton type="primary" @click="openDrawer">打开设备抽屉</NButton>
        <NButton secondary @click="goProcess('trend')">查看趋势</NButton>
        <NButton secondary @click="goProcess(null)">查看工艺图</NButton>
        <NButton secondary @click="goLedger(false)">查看设备台账</NButton>
        <NButton secondary @click="goLedger(true)">关联档案</NButton>
      </div>
      <p class="next-tip">
        推荐下一步：为该设备挂接技术档案、设置巡检计划，或在「健康与能效」页查看评分。
      </p>
    </div>

    <template v-else>
      <ol class="wizard-steps">
        <li
          v-for="(title, index) in STEP_TITLES.slice(0, 4)"
          :key="title"
          :class="{
            active: step === index + 1,
            done: step > index + 1,
          }"
        >
          <span class="step-dot">{{ index + 1 }}</span>
          <span>{{ title }}</span>
        </li>
      </ol>

      <div class="wizard-body">
        <section v-if="step === 1" class="step-panel">
          <div class="step-head">
            <h3>解析预览</h3>
            <p>以下字段来自本地规则解析，可直接修改；带「未提供」的字段需要补齐。</p>
          </div>

          <div class="form-grid">
            <label>
              <span>设备编号 <em>{{ fieldSources.code }}</em></span>
              <NInput v-model:value="code" placeholder="如 P-003" />
            </label>
            <label>
              <span>设备名称 <em>{{ fieldSources.name }}</em></span>
              <NInput v-model:value="name" placeholder="如 3号供水泵" />
            </label>
            <label>
              <span>目标子系统 <em>{{ fieldSources.subsystemId }}</em></span>
              <NSelect v-model:value="subsystemId" :options="subsystemOptions" />
            </label>
            <label>
              <span>设备类型 <em>{{ fieldSources.type }}</em></span>
              <NInput v-model:value="type" placeholder="如 离心泵" />
            </label>
            <label>
              <span>额定功率（kW） <em>{{ fieldSources.powerKw }}</em></span>
              <NInputNumber v-model:value="powerKw" :min="0" placeholder="静态设计参数" />
            </label>
            <label>
              <span>额定流量（m³/h） <em>{{ fieldSources.flowM3h }}</em></span>
              <NInputNumber v-model:value="flowM3h" :min="0" placeholder="静态设计参数" />
            </label>
            <label>
              <span>额定扬程（m） <em>{{ fieldSources.headM }}</em></span>
              <NInputNumber v-model:value="headM" :min="0" placeholder="静态设计参数" />
            </label>
          </div>

          <div class="block">
            <div class="block-head">
              <h4>测点清单（{{ points.length }} 个）</h4>
              <NTag size="tiny" :bordered="false">{{ fieldSources.points }}</NTag>
            </div>
            <ul v-if="points.length" class="point-summary">
              <li v-for="point in points" :key="point.key">
                <strong>{{ point.label }}</strong>
                <span>{{ point.kind === "enum" ? "状态量" : point.unit || "无单位" }}</span>
                <small>来源：{{ point.parsedFrom ?? "AI 解析" }}</small>
              </li>
            </ul>
            <p v-else class="empty">未识别到测点，请在第 2 步添加至少 1 个测点。</p>
          </div>

          <div v-if="basicErrors.length" class="issue-box">
            <strong>需要修正</strong>
            <ul>
              <li v-for="issue in basicErrors" :key="issue.field">
                {{ issue.message }}
              </li>
            </ul>
          </div>
          <p class="source-note">
            额定参数是静态设计参数，不会直接当作实时值；实时监测值统一标记「模拟数据」。
          </p>
        </section>

        <section v-else-if="step === 2" class="step-panel">
          <div class="step-head">
            <h3>测点配置</h3>
            <p>可增删测点并调整名称、单位、量程、基准值与波动幅度；状态量使用有限枚举。</p>
          </div>

          <div class="point-list">
            <article v-for="point in points" :key="point.key" class="point-card">
              <div class="point-row">
                <label class="grow">
                  <span>测点名称</span>
                  <NInput v-model:value="point.label" size="small" />
                </label>
                <label>
                  <span>数据类型</span>
                  <NSelect v-model:value="point.kind" size="small" :options="kindOptions" />
                </label>
                <label v-if="point.kind === 'number'">
                  <span>单位</span>
                  <NInput v-model:value="point.unit" size="small" placeholder="MPa / A / ℃" />
                </label>
                <NButton size="tiny" quaternary type="error" @click="removePoint(point.key)">
                  删除
                </NButton>
              </div>

              <div v-if="point.kind === 'number'" class="point-row">
                <label>
                  <span>量程下限</span>
                  <NInputNumber v-model:value="point.rangeMin" size="small" />
                </label>
                <label>
                  <span>量程上限</span>
                  <NInputNumber v-model:value="point.rangeMax" size="small" />
                </label>
                <label>
                  <span>基准值</span>
                  <NInputNumber v-model:value="point.baseline" size="small" />
                </label>
                <label>
                  <span>波动幅度</span>
                  <NInputNumber v-model:value="point.volatility" size="small" :min="0" />
                </label>
              </div>

              <div v-else class="point-row">
                <label class="grow">
                  <span>状态枚举（逗号分隔）</span>
                  <NInput v-model:value="point.enumStates" size="small" placeholder="running, stopped, fault" />
                </label>
                <label>
                  <span>初始状态</span>
                  <NSelect
                    :value="point.baseline ?? 0"
                    size="small"
                    :options="enumOptions(point)"
                    @update:value="(value: number) => (point.baseline = value)"
                  />
                </label>
              </div>
            </article>
          </div>

          <div class="point-actions">
            <NButton size="small" secondary @click="addPoint">+ 添加测点</NButton>
            <span class="hint">至少 1 个测点；单位需在允许范围内，量程下限必须小于上限。</span>
          </div>

          <div class="preview">
            <div class="block-head">
              <h4>24 小时模拟预览</h4>
              <NSelect
                v-if="previewOptions.length"
                v-model:value="previewKey"
                size="small"
                style="width: 220px"
                :options="previewOptions"
              />
            </div>
            <template v-if="preview">
              <Chart
                :labels="preview.labels"
                :series="[
                  {
                    name: preview.point.label,
                    values: preview.values,
                    unit: preview.point.unit ?? '',
                  },
                ]"
                :height="190"
              />
              <p class="hint">
                模拟预览：按固定种子与基准值/波动幅度生成，仅用于确认量纲与波动是否合理；
                创建后可在设备趋势中查询同一测点的真实 Mock 序列。
              </p>
            </template>
            <p v-else class="empty">暂无数值测点可预览；状态量按枚举采样，不绘制数值曲线。</p>
          </div>

          <div v-if="pointErrors.length" class="issue-box">
            <strong>测点需要修正</strong>
            <ul>
              <li v-for="issue in pointErrors" :key="issue.field">{{ issue.message }}</li>
            </ul>
          </div>
        </section>

        <section v-else-if="step === 3" class="step-panel">
          <div class="step-head">
            <h3>绑定工艺</h3>
            <p>
              在「{{ subsystemName }}」工艺底图上点选设备位置，也可以跳过并保存为「未布置」。
              该坐标仅用于可视化绑定，不代表真实管路或电气连接。
            </p>
          </div>

          <ProcessCanvas
            :subsystem-id="subsystemId"
            interactive
            :selected="picked"
            :height="360"
            @pick="onPick"
          />

          <div class="pick-actions">
            <NTag v-if="picked" size="small" type="success" :bordered="false">
              已选坐标 x {{ (picked.xPct * 100).toFixed(1) }}% · y
              {{ (picked.yPct * 100).toFixed(1) }}%
            </NTag>
            <NTag v-else size="small" :bordered="false">尚未选择点位，可跳过</NTag>
            <NButton size="small" secondary :disabled="!picked" @click="clearPick">
              清除点位
            </NButton>
            <NButton size="small" quaternary @click="clearPick">跳过（保存为未布置）</NButton>
          </div>
          <p class="hint">
            未布置设备仍可在设备台账、搜索与 AI 查询中命中，只是工艺图不显示热点。
          </p>
        </section>

        <section v-else-if="step === 4" class="step-panel">
          <div class="step-head">
            <h3>最终差异确认</h3>
            <p>确认后将以事务方式写入设备、测点、工艺绑定与审计记录；取消不会产生任何残留。</p>
          </div>

          <div class="diff-grid">
            <div class="diff-card">
              <span>新增设备</span>
              <strong>1 台</strong>
              <small>{{ code || "未填编号" }} · {{ name || "未填名称" }}（{{ subsystemName }}）</small>
            </div>
            <div class="diff-card">
              <span>新增测点</span>
              <strong>{{ points.length }} 个</strong>
              <small>{{ points.map((point) => point.label).join("、") || "无" }}</small>
            </div>
            <div class="diff-card">
              <span>新增工艺热点</span>
              <strong>{{ picked ? "1 个" : "0 个" }}</strong>
              <small>
                {{ picked ? `x ${(picked.xPct * 100).toFixed(1)}% · y ${(picked.yPct * 100).toFixed(1)}%` : "未布置，可在后续单独绑定" }}
              </small>
            </div>
            <div class="diff-card">
              <span>编号唯一校验</span>
              <strong :class="{ bad: Boolean(codeConflict) }">
                {{ codeConflict ? "冲突" : "通过" }}
              </strong>
              <small>{{ codeConflict?.message ?? `编号 ${code || "未填"} 在所选子系统中未重复` }}</small>
            </div>
            <div class="diff-card">
              <span>提交权限</span>
              <strong :class="{ bad: !canCreate }">{{ canCreate ? "系统管理员" : "仅预览" }}</strong>
              <small>
                {{ canCreate ? "可提交并写入审计" : "当前角色无 asset:create，确认按钮禁用" }}
              </small>
            </div>
            <div class="diff-card">
              <span>数据标签</span>
              <strong>模拟数据</strong>
              <small>固定种子 24h 序列；额定参数单独展示，不作为实时值</small>
            </div>
          </div>

          <div v-if="validation.errors.length" class="issue-box">
            <strong>提交前校验未通过</strong>
            <ul>
              <li v-for="issue in validation.errors" :key="issue.field">{{ issue.message }}</li>
            </ul>
          </div>
          <div v-if="submitError" class="issue-box error">
            <strong>提交被拒绝</strong>
            <p>{{ submitError }}</p>
          </div>
          <p v-if="!canCreate" class="permission-note">
            需要管理员确认：请将顶栏角色切换为「系统管理员」后再提交；当前仅可预览，不会写入主数据。
          </p>
          <p class="source-note">
            提交后将同步设备台账、工艺热点、设备抽屉、趋势查询、AI 查询与操作日志。
          </p>
        </section>
      </div>

      <div class="wizard-foot">
        <NButton quaternary @click="cancel">取消</NButton>
        <div class="foot-right">
          <NButton v-if="step > 1" secondary @click="previous">上一步</NButton>
          <NButton
            type="primary"
            :disabled="!canContinue || submitting"
            :loading="submitting"
            @click="next"
          >
            {{ step === 4 ? "确认创建" : "继续" }}
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.wizard-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}
.wizard-steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid #dbe8f1;
  background: #f6fafd;
  font-size: 11.5px;
  color: #7c93a5;
}
.wizard-steps li.active {
  border-color: #7fb4cd;
  background: #eaf5fc;
  color: #1c3e57;
  font-weight: 600;
}
.wizard-steps li.done {
  color: #2f7a63;
  border-color: #bfe0d4;
  background: #f0faf6;
}
.step-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #dce8f1;
  font-size: 10px;
}
.wizard-steps li.active .step-dot {
  background: #247ba8;
  color: #fff;
}
.wizard-steps li.done .step-dot {
  background: #3f9d7c;
  color: #fff;
}
.wizard-body {
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}
.step-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.step-head h3 {
  margin: 0;
  font-size: 15px;
  color: #1c3e57;
}
.step-head p {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: #6c8296;
  line-height: 1.7;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11.5px;
  color: #5d7387;
}
.form-grid em {
  margin-left: 6px;
  font-style: normal;
  font-size: 10px;
  color: #93a7b7;
}
.block {
  border: 1px solid #e2edf4;
  border-radius: 9px;
  padding: 12px;
  background: #fbfdff;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.block-head h4 {
  margin: 0;
  font-size: 12.5px;
  color: #1c3e57;
}
.point-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.point-summary li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 7px 9px;
  border-radius: 7px;
  background: #f3f9fd;
  font-size: 11.5px;
  color: #2a4660;
}
.point-summary small {
  margin-left: auto;
  font-size: 10px;
  color: #93a7b7;
}
.issue-box {
  border: 1px solid #f0d6a4;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fdf7ec;
  font-size: 11.5px;
  color: #8a5c15;
}
.issue-box strong {
  display: block;
  margin-bottom: 4px;
}
.issue-box ul {
  margin: 0;
  padding-left: 18px;
  line-height: 1.8;
}
.issue-box.error {
  border-color: #f0c9c4;
  background: #fdf1f0;
  color: #a33f37;
}
.issue-box p {
  margin: 0;
}
.source-note,
.hint {
  margin: 0;
  font-size: 11px;
  color: #8296a8;
  line-height: 1.7;
}
.empty {
  margin: 0;
  font-size: 11.5px;
  color: #93a7b7;
}
.permission-note {
  margin: 0;
  padding: 8px 10px;
  border-radius: 7px;
  background: #fdf7ec;
  border: 1px dashed #e8c98f;
  font-size: 11.5px;
  color: #8a5c15;
}
.point-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.point-card {
  border: 1px solid #e2edf4;
  border-radius: 9px;
  padding: 10px 12px;
  background: #fff;
}
.point-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}
.point-row + .point-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #eef5fa;
}
.point-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  color: #7c93a5;
  min-width: 96px;
}
.point-row label.grow {
  flex: 1;
  min-width: 150px;
}
.point-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.preview {
  border: 1px solid #e2edf4;
  border-radius: 9px;
  padding: 12px;
  background: #fbfdff;
}
.pick-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.diff-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.diff-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 9px;
  border: 1px solid #e2edf4;
  background: #fbfdff;
}
.diff-card span {
  font-size: 11px;
  color: #7c93a5;
}
.diff-card strong {
  font-size: 17px;
  color: #1c3e57;
}
.diff-card strong.bad {
  color: #b0453d;
}
.diff-card small {
  font-size: 10.5px;
  color: #93a7b7;
  line-height: 1.6;
}
.wizard-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #eef5fa;
}
.foot-right {
  display: flex;
  gap: 8px;
}
.success-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.success-panel h3 {
  margin: 0;
  font-size: 18px;
  color: #2f7a63;
}
.success-line {
  margin: 0;
  font-size: 12.5px;
  color: #2a4660;
  line-height: 1.7;
}
.success-line span {
  margin-left: 8px;
  color: #8296a8;
  font-size: 11px;
}
.mock-note {
  margin: 0;
  padding: 8px 10px;
  border-radius: 7px;
  background: #fdf7ec;
  font-size: 11.5px;
  color: #8a5c15;
}
.success-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.next-tip {
  margin: 0;
  font-size: 11.5px;
  color: #6c8296;
}
@media (max-width: 900px) {
  .form-grid,
  .diff-grid,
  .point-summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
