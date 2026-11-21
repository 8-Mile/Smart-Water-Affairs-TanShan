<template>
  <div class="page mod-system">
    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- 系统操作日志：sys_operation_log -->
      <el-tab-pane label="系统操作日志" name="system">
        <div class="tab-page">
          <el-alert
            class="hint"
            type="info"
            :closable="false"
            show-icon
            title="仅记录新增、修改、删除等写操作及登录、下载行为，查询类操作不产生日志；系统默认保留 180 天。"
          />
          <ProSearchBar
            v-model="sysQuery"
            :items="sysSearchItems"
            :span="6"
            @search="onSysSearch"
            @reset="onSysReset"
          />
          <div class="table-section">
            <el-card shadow="never" class="art-table-card table-card">
              <ProTableHeader
                :loading="sysLoading"
                :export-columns="sysExportColumns"
                :export-data="sysRows"
                export-filename="系统操作日志"
                @refresh="loadSys"
              />
              <ProTable
                :data="sysRows"
                :loading="sysLoading"
                :columns="sysColumns"
                :pagination="sysPagination"
                row-key="id"
                @page-change="onSysPage"
                @size-change="onSysSize"
                @row-click="openSysDetail"
              >
                <template #detail="{ row }">
                  <template v-if="opTokens(row.detail).action">
                    <span class="op-module">{{ opTokens(row.detail).module }}</span>
                    <span class="op-sep">·</span>
                    <span :class="opTokens(row.detail).actionCls">{{
                      opTokens(row.detail).action
                    }}</span>
                    <template v-if="opTokens(row.detail).afterTokens.length">
                      <span class="op-sep">·</span>
                      <template
                        v-for="(t, i) in opTokens(row.detail).afterTokens"
                        :key="i"
                      >
                        <span :class="t.cls">{{ t.text }}</span>
                      </template>
                    </template>
                  </template>
                  <span v-else>{{ row.detail || "-" }}</span>
                </template>
                <template #method="{ row }">
                  <el-tag
                    :type="methodTagType(row.method)"
                    effect="plain"
                    size="small"
                  >
                    {{ row.method }}
                  </el-tag>
                </template>
                <template #status_code="{ row }">
                  <el-tag
                    :type="row.status_code < 400 ? 'success' : 'danger'"
                    effect="plain"
                    size="small"
                  >
                    {{
                      row.status_code < 400 ? "成功" : `失败 ${row.status_code}`
                    }}
                  </el-tag>
                </template>
              </ProTable>
            </el-card>
          </div>
        </div>
      </el-tab-pane>

      <!-- 业务流转日志：告警 / 维修工单 / 巡检 / 维保 -->
      <el-tab-pane label="业务流转日志" name="business">
        <div class="tab-page">
          <el-alert
            class="hint"
            type="info"
            :closable="false"
            show-icon
            title="告警、维修工单、巡检、维保的流转动作留痕，属业务档案，长期保留。"
          />
          <ProSearchBar
            v-model="bizQuery"
            :items="bizSearchItems"
            :span="6"
            @search="onBizSearch"
            @reset="onBizReset"
          />
          <div class="table-section">
            <el-card shadow="never" class="art-table-card table-card">
              <ProTableHeader
                :loading="bizLoading"
                :export-columns="bizExportColumns"
                :export-data="bizRows"
                export-filename="业务流转日志"
                @refresh="loadBiz"
              />
              <ProTable
                :data="bizRows"
                :loading="bizLoading"
                :columns="bizColumns"
                :pagination="bizPagination"
                row-key="rowKey"
                @page-change="onBizPage"
                @size-change="onBizSize"
                @row-click="openBizDetail"
              >
                <template #biz_type="{ row }">
                  <el-tag
                    :type="bizTypeTag(row.biz_type)"
                    effect="plain"
                    size="small"
                  >
                    {{ bizTypeLabel(row.biz_type) }}
                  </el-tag>
                </template>
                <template #action="{ row }">
                  {{ actionLabel(row) }}
                </template>
              </ProTable>
            </el-card>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 详情抽屉：全站磨砂统一壳层 ProDetailDrawer -->
    <ProDetailDrawer
      v-model="detailVisible"
      :title="detailTitle"
      :subtitle="detailSubtitle"
      :icon="detailIcon"
      width="480px"
    >
      <template v-if="sysDetail">
        <ProDetailRow
          icon="ri-time-line"
          label="操作时间"
          :value="formatDateTime(sysDetail.created_at, true)"
        />
        <ProDetailRow
          icon="ri-user-line"
          label="操作人"
          :value="sysDetail.username || '-'"
        />
        <ProDetailRow
          icon="ri-function-line"
          label="所属模块"
          :value="sysDetail.module || '-'"
        />
        <ProDetailRow icon="ri-file-list-3-line" label="操作内容" top>
          <template v-if="opTokens(sysDetail.detail).action">
            <span class="op-module">{{ opTokens(sysDetail.detail).module }}</span>
            <span class="op-sep">·</span>
            <span :class="opTokens(sysDetail.detail).actionCls">{{
              opTokens(sysDetail.detail).action
            }}</span>
            <template v-if="opTokens(sysDetail.detail).afterTokens.length">
              <span class="op-sep">·</span>
              <template
                v-for="(t, i) in opTokens(sysDetail.detail).afterTokens"
                :key="i"
              >
                <span :class="t.cls">{{ t.text }}</span>
              </template>
            </template>
          </template>
          <template v-else>{{ sysDetail.detail || "-" }}</template>
        </ProDetailRow>
        <ProDetailRow icon="ri-settings-4-line" label="请求方法" mono>
          <el-tag
            :type="methodTagType(sysDetail.method)"
            effect="plain"
            size="small"
          >
            {{ sysDetail.method }}
          </el-tag>
        </ProDetailRow>
        <ProDetailRow icon="ri-link" label="请求路径" top>
          <code class="pd-code">{{ sysDetail.path }}</code>
        </ProDetailRow>
        <ProDetailRow icon="ri-checkbox-circle-line" label="响应状态">
          <el-tag
            :type="sysDetail.status_code < 400 ? 'success' : 'danger'"
            effect="plain"
            size="small"
          >
            {{
              sysDetail.status_code < 400
                ? "成功"
                : `失败 ${sysDetail.status_code}`
            }}
          </el-tag>
        </ProDetailRow>
        <ProDetailRow
          icon="ri-timer-line"
          label="耗时"
          :value="`${sysDetail.duration_ms} ms`"
          mono
        />
        <ProDetailRow icon="ri-global-line" label="来源 IP" :value="sysDetail.ip || '-'" />
        <ProDetailRow
          icon="ri-terminal-line"
          label="User-Agent"
          top
          :value="sysDetail.user_agent || '-'"
        />
      </template>

      <template v-else-if="bizDetail">
        <ProDetailRow
          icon="ri-time-line"
          label="发生时间"
          :value="formatDateTime(bizDetail.created_at, true)"
        />
        <ProDetailRow icon="ri-tag-line" label="业务类型">
          <el-tag
            :type="bizTypeTag(bizDetail.biz_type)"
            effect="plain"
            size="small"
          >
            {{ bizTypeLabel(bizDetail.biz_type) }}
          </el-tag>
        </ProDetailRow>
        <ProDetailRow icon="ri-file-text-line" label="业务编号" :value="bizDetail.biz_no" />
        <ProDetailRow
          icon="ri-box-3-line"
          label="业务对象"
          :value="bizDetail.biz_title || '-'"
        />
        <ProDetailRow icon="ri-refresh-line" label="流转动作">
          <el-tag effect="plain" size="small" type="primary">
            {{ actionLabel(bizDetail) }}
          </el-tag>
        </ProDetailRow>
        <ProDetailRow
          icon="ri-user-line"
          label="操作人"
          :value="bizDetail.operator_name || '系统'"
        />
        <ProDetailRow icon="ri-chat-3-line" label="说明" top :value="bizDetail.detail || '-'" />
      </template>
    </ProDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import ProSearchBar, {
  type SearchFormItem,
} from "@/components/ProSearchBar.vue";
import ProTableHeader from "@/components/ProTableHeader.vue";
import ProTable, { type ProColumn } from "@/components/ProTable.vue";
import ProDetailDrawer from "@/components/ProDetailDrawer.vue";
import ProDetailRow from "@/components/ProDetailRow.vue";
import { formatDateTime } from "@/utils/time";
import type { ExportColumn } from "@/utils/exportExcel";
import {
  fetchAuditOptions,
  listBusinessLogs,
  listOperationLogs,
  type BusinessLogItem,
  type OperationLogItem,
} from "@/api/audit";

const activeTab = ref<"system" | "business">("system");

/* ---------------- 系统操作日志 ---------------- */
const sysRows = ref<OperationLogItem[]>([]);
const sysLoading = ref(false);
const sysPage = ref(1);
const sysSize = ref(20);
const sysTotal = ref(0);
const sysQuery = ref<Record<string, any>>({
  dateRange: [],
  username: "",
  module: "",
  method: "",
  result: "",
});
const moduleOptions = ref<{ label: string; value: string }[]>([]);
const methodOptions = ref<{ label: string; value: string }[]>([]);

const sysSearchItems = computed<SearchFormItem[]>(() => [
  {
    key: "dateRange",
    label: "时间范围",
    labelWidth: "80px",
    type: "daterange",
    props: {
      valueFormat: "YYYY-MM-DD",
      startPlaceholder: "开始日期",
      endPlaceholder: "结束日期",
      style: "width: 100%",
    },
  },
  {
    key: "username",
    label: "操作人",
    labelWidth: "80px",
    type: "input",
    props: { clearable: true, placeholder: "请输入用户名" },
  },
  {
    key: "module",
    label: "所属模块",
    labelWidth: "80px",
    type: "select",
    props: {
      clearable: true,
      placeholder: "全部",
      options: moduleOptions.value,
    },
  },
  {
    key: "method",
    label: "请求方法",
    labelWidth: "80px",
    type: "select",
    props: {
      clearable: true,
      placeholder: "全部",
      options: methodOptions.value,
    },
  },
  {
    key: "result",
    label: "结果",
    type: "select",
    props: {
      clearable: true,
      placeholder: "全部",
      options: [
        { label: "成功", value: "success" },
        { label: "失败", value: "failed" },
      ],
    },
  },
]);

const sysPagination = computed(() => ({
  current: sysPage.value,
  size: sysSize.value,
  total: sysTotal.value,
}));

const sysColumns: ProColumn[] = [
  {
    prop: "created_at",
    label: "操作时间",
    width: 165,
    formatter: (row: OperationLogItem) => formatDateTime(row.created_at, true),
  },
  {
    prop: "username",
    label: "操作人",
    width: 110,
    formatter: (row: OperationLogItem) => row.username || "-",
  },
  {
    prop: "module",
    label: "模块",
    width: 110,
    formatter: (row: OperationLogItem) => row.module || "-",
  },
  {
    prop: "detail",
    label: "操作内容",
    minWidth: 260,
    showOverflowTooltip: true,
  },
  { prop: "status_code", label: "结果", width: 100 },
  {
    prop: "duration_ms",
    label: "耗时",
    width: 90,
    formatter: (row: OperationLogItem) => `${row.duration_ms} ms`,
  },
  {
    prop: "ip",
    label: "IP",
    width: 130,
    formatter: (row: OperationLogItem) => row.ip || "-",
  },
];

const sysExportColumns: ExportColumn[] = [
  {
    prop: "created_at",
    label: "操作时间",
    formatter: (r) => formatDateTime(r.created_at, true),
  },
  { prop: "username", label: "操作人", formatter: (r) => r.username || "-" },
  { prop: "module", label: "模块", formatter: (r) => r.module || "-" },
  {
    prop: "detail",
    label: "操作内容",
    width: 30,
    formatter: (r) => r.detail || "-",
  },
  { prop: "method", label: "请求方法" },
  { prop: "path", label: "请求路径", width: 40 },
  { prop: "status_code", label: "响应状态" },
  { prop: "duration_ms", label: "耗时(ms)" },
  { prop: "ip", label: "IP" },
];

function sysParams() {
  const q = sysQuery.value;
  const range = (q.dateRange || []) as string[];
  return {
    page: sysPage.value,
    page_size: sysSize.value,
    username: q.username || undefined,
    module: q.module || undefined,
    method: q.method || undefined,
    result: q.result || undefined,
    date_from: range[0] || undefined,
    date_to: range[1] || undefined,
  };
}

async function loadSys() {
  sysLoading.value = true;
  try {
    const { data } = await listOperationLogs(sysParams());
    sysRows.value = data.data.items;
    sysTotal.value = data.data.total;
  } finally {
    sysLoading.value = false;
  }
}

function onSysSearch() {
  sysPage.value = 1;
  loadSys();
}
function onSysReset() {
  sysPage.value = 1;
  loadSys();
}
function onSysPage(page: number) {
  sysPage.value = page;
  loadSys();
}
function onSysSize(size: number) {
  sysSize.value = size;
  sysPage.value = 1;
  loadSys();
}

/* ---------------- 业务流转日志 ---------------- */
const bizRows = ref<(BusinessLogItem & { rowKey: string })[]>([]);
const bizLoading = ref(false);
const bizPage = ref(1);
const bizSize = ref(20);
const bizTotal = ref(0);
const bizQuery = ref<Record<string, any>>({
  dateRange: [],
  bizType: "",
  operator: "",
});
const bizLoaded = ref(false);

const bizSearchItems = computed<SearchFormItem[]>(() => [
  {
    key: "dateRange",
    label: "时间范围",
    labelWidth: "80px",
    type: "daterange",
    props: {
      valueFormat: "YYYY-MM-DD",
      startPlaceholder: "开始日期",
      endPlaceholder: "结束日期",
      style: "width: 100%",
    },
  },
  {
    key: "bizType",
    label: "业务类型",
    labelWidth: "80px",
    type: "select",
    props: {
      clearable: true,
      placeholder: "全部",
      options: [
        { label: "告警", value: "alarm" },
        { label: "维修工单", value: "repair" },
        { label: "巡检", value: "inspection" },
        { label: "维保", value: "maintenance" },
      ],
    },
  },
  {
    key: "operator",
    label: "操作人",
    labelWidth: "80px",
    type: "input",
    props: { clearable: true, placeholder: "请输入姓名" },
  },
]);

const bizPagination = computed(() => ({
  current: bizPage.value,
  size: bizSize.value,
  total: bizTotal.value,
}));

const bizColumns: ProColumn[] = [
  {
    prop: "created_at",
    label: "发生时间",
    width: 165,
    formatter: (row: BusinessLogItem) => formatDateTime(row.created_at, true),
  },
  { prop: "biz_type", label: "类型", width: 105 },
  { prop: "biz_no", label: "业务编号", width: 150 },
  {
    prop: "biz_title",
    label: "业务对象",
    minWidth: 190,
    showOverflowTooltip: true,
    formatter: (row: BusinessLogItem) => row.biz_title || "-",
  },
  { prop: "action", label: "流转动作", width: 150 },
  {
    prop: "operator_name",
    label: "操作人",
    width: 110,
    formatter: (row: BusinessLogItem) => row.operator_name || "系统",
  },
  {
    prop: "detail",
    label: "说明",
    minWidth: 220,
    showOverflowTooltip: true,
    formatter: (row: BusinessLogItem) => row.detail || "-",
  },
];

const bizExportColumns: ExportColumn[] = [
  {
    prop: "created_at",
    label: "发生时间",
    formatter: (r) => formatDateTime(r.created_at, true),
  },
  {
    prop: "biz_type",
    label: "业务类型",
    formatter: (r) => bizTypeLabel(r.biz_type),
  },
  { prop: "biz_no", label: "业务编号" },
  {
    prop: "biz_title",
    label: "业务对象",
    width: 30,
    formatter: (r) => r.biz_title || "-",
  },
  { prop: "action", label: "流转动作", formatter: (r) => actionLabel(r) },
  {
    prop: "operator_name",
    label: "操作人",
    formatter: (r) => r.operator_name || "系统",
  },
  {
    prop: "detail",
    label: "说明",
    width: 40,
    formatter: (r) => r.detail || "-",
  },
];

function bizParams() {
  const q = bizQuery.value;
  const range = (q.dateRange || []) as string[];
  return {
    page: bizPage.value,
    page_size: bizSize.value,
    biz_type: q.bizType || "all",
    operator: q.operator || undefined,
    date_from: range[0] || undefined,
    date_to: range[1] || undefined,
  };
}

async function loadBiz() {
  bizLoading.value = true;
  try {
    const { data } = await listBusinessLogs(bizParams());
    bizRows.value = data.data.items.map((item) => ({
      ...item,
      rowKey: `${item.biz_type}-${item.id}`,
    }));
    bizTotal.value = data.data.total;
    bizLoaded.value = true;
  } finally {
    bizLoading.value = false;
  }
}

function onBizSearch() {
  bizPage.value = 1;
  loadBiz();
}
function onBizReset() {
  bizPage.value = 1;
  loadBiz();
}
function onBizPage(page: number) {
  bizPage.value = page;
  loadBiz();
}
function onBizSize(size: number) {
  bizSize.value = size;
  bizPage.value = 1;
  loadBiz();
}

/* ---------------- 系统操作内容：动作拆分与着色 ---------------- */
// detail 结构：`模块 · 动作[ · 业务对象]`
// 模块（次级灰）· 动作（按语义高亮）· 对象信息（编号/日期/计数再做子分词高亮）
const OP_ACTION_COLORS: Record<string, string> = {
  // 红：破坏性 / 拒绝 / 终止 / 停止
  删除: "danger",
  批量删除: "danger",
  取消: "danger",
  驳回: "danger",
  驳回派单: "danger",
  驳回工单: "danger",
  退回: "danger",
  撤回: "danger",
  拒绝: "danger",
  停用: "danger",
  禁用: "danger",
  停止: "danger",
  关闭: "danger",
  结束: "danger",
  终止: "danger",
  挂起: "danger",
  取消订阅: "danger",
  解绑: "danger",
  清理: "danger",
  清空: "danger",
  重置: "danger",
  重置密码: "danger",
  清理缓存: "danger",
  反归档: "danger",
  下架: "danger",
  回滚: "danger",
  恢复: "success",
  // 绿：创建 / 提交 / 完成 / 通过 / 启用
  新增: "success",
  创建: "success",
  上传: "success",
  导入: "success",
  复制: "success",
  克隆: "success",
  生成: "success",
  发布: "success",
  上架: "success",
  启用: "success",
  启动: "success",
  开启: "success",
  归档: "success",
  签收: "success",
  接单: "success",
  领取: "success",
  提交: "success",
  完工提交: "success",
  完成: "success",
  验收通过: "success",
  通过: "success",
  创建工单: "success",
  // 橙：修改类 / 状态 / 权限变更
  修改: "warning",
  更新: "warning",
  编辑: "warning",
  调整: "warning",
  变更: "warning",
  状态变更: "warning",
  修改密码: "warning",
  切换: "warning",
  转让: "warning",
  交接: "warning",
  延期: "warning",
  // 蓝：流转 / 派发 / 处理 / 同步
  派单: "primary",
  派发: "primary",
  自动派发: "primary",
  分配: "primary",
  指派: "primary",
  分派: "primary",
  改派: "primary",
  转派: "primary",
  转交: "primary",
  移交: "primary",
  处理: "primary",
  转维修工单: "primary",
  验收: "primary",
  审批: "primary",
  审核: "primary",
  认领: "primary",
  订阅: "primary",
  绑定: "primary",
  关联: "primary",
  发起工单: "primary",
  同步: "primary",
  推送: "primary",
  部署: "primary",
  // 灰蓝：查询 / 只读 / 系统操作
  用户登录: "info",
  登录: "info",
  登出: "info",
  导出: "info",
  下载: "info",
  预览: "info",
  收藏: "info",
  查看: "info",
  查询: "info",
  搜索: "info",
  刷新: "info",
  标记已读: "info",
  全部已读: "info",
  重建索引: "info",
  建立索引: "info",
  连接测试: "info",
  下载模板: "info",
  导入模板: "info",
  初始化: "info",
  生成报表: "info",
  导出报表: "info",
};

// 未命中精确映射时按关键词兜底归类（顺序：先难后易）
const OP_FALLBACK_KEYWORDS: [RegExp, string][] = [
  [/删除|驳回|取消|退回|撤回|拒绝|停用|禁用|停止|关闭|结束|终止|挂起|解绑|清理|清空|重置|反归档|下架|回滚/, "danger"],
  [/新增|创建|上传|导入|复制|克隆|生成|发布|上架|启用|启动|开启|归档|签收|接单|领取|提交|完成|通过/, "success"],
  [/修改|更新|编辑|调整|变更|切换|交接|延期/, "warning"],
  [/派|分发|指派|改派|转派|转交|移交|处理|转维修|验收|审批|审核|认领|订阅|绑定|关联|同步|推送|部署/, "primary"],
];

/** 操作内容拆为「模块 / 动作 / 对象信息」三段 */
function opParts(detail: string | null): {
  before: string;
  action: string;
  after: string;
} {
  if (!detail) return { before: "", action: "", after: "" };
  const parts = detail.split(" · ");
  if (parts.length < 2) return { before: "", action: "", after: "" };
  return {
    before: parts[0],
    action: parts[1],
    after: parts.slice(2).join(" · "),
  };
}

/** 动作词颜色类 */
function opActionCls(action: string): string {
  if (!action) return "";
  const exact = OP_ACTION_COLORS[action];
  if (exact) return `op-action op-${exact}`;
  for (const [re, color] of OP_FALLBACK_KEYWORDS) {
    if (re.test(action)) return `op-action op-${color}`;
  }
  return "op-action op-info";
}

type OpToken = { text: string; cls: string };
// 对象信息中的编号（RP-/AL-/XJ-/WB-/DA-/EQ-/WO- 等）、日期、数字计数单独着色
const AFTER_TOKEN_RE =
  /(?:[A-Z]{1,4}[-_][A-Z0-9-]+|DA\d{6,}|[A-Z]-\d{2,}|[A-Z]\d{4,})|\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?|第?\s?\d+\s?(?:项|条|人|次|个|台|台次|份|组|分钟|小时)/g;

/** 把对象信息再切成 token：编号紫、日期灰等宽、计数蓝粗，其余灰色 */
function tokenizeAfter(text: string): OpToken[] {
  if (!text) return [];
  const tokens: OpToken[] = [];
  let last = 0;
  const re = new RegExp(AFTER_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), cls: "op-obj" });
    const hit = m[0];
    let cls = "op-code";
    if (/^\d{4}-/.test(hit)) cls = "op-date";
    else if (/\d+(项|条|人|次|个|台|份|组)/.test(hit)) cls = "op-num";
    tokens.push({ text: hit, cls });
    last = m.index + hit.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), cls: "op-obj" });
  return tokens;
}

/** 操作内容完整 token 化：模块、动作、对象分段着色 */
function opTokens(detail: string | null) {
  const { before, action, after } = opParts(detail);
  return {
    module: before,
    action,
    actionCls: opActionCls(action),
    afterTokens: tokenizeAfter(after),
  };
}

/* ---------------- 公共：动作名 / 标签色 / 详情 ---------------- */
const REPAIR_ACTION_LABELS: Record<string, string> = {
  create: "创建工单",
  dispatch: "派单",
  reject_dispatch: "驳回派单",
  complete: "完工提交",
  accept_pass: "验收通过",
  accept_reject: "验收驳回",
  create_from_alarm: "告警自动转单",
};

const ALARM_ACTION_LABELS: Record<string, string> = {
  created: "告警生成",
  auto_repair: "自动转维修工单",
  repair_handle: "转维修工单",
  repair_rejected: "关联工单被驳回",
  repair_processing: "关联工单处理中",
  repair_pending_accept: "关联工单待验收",
  repair_closed: "关联工单已闭环",
};

const INSPECTION_ACTION_LABELS: Record<string, string> = {
  dispatch: "派发任务",
  claim: "认领任务",
  complete: "完成提交",
  create: "计划外补录",
};

const MAINTENANCE_ACTION_LABELS: Record<string, string> = {
  dispatch: "生成维保任务",
  create: "创建临时任务",
  submit: "完成提交",
  accept_pass: "验收通过",
  accept_reject: "验收驳回",
  to_repair: "转维修工单",
};

const BIZ_ACTION_LABELS: Record<string, Record<string, string>> = {
  alarm: ALARM_ACTION_LABELS,
  repair: REPAIR_ACTION_LABELS,
  inspection: INSPECTION_ACTION_LABELS,
  maintenance: MAINTENANCE_ACTION_LABELS,
};

const BIZ_TYPE_LABELS: Record<string, string> = {
  alarm: "告警",
  repair: "维修工单",
  inspection: "巡检",
  maintenance: "维保",
};

function bizTypeLabel(type: string): string {
  return BIZ_TYPE_LABELS[type] || type;
}

function bizTypeTag(type: string): "warning" | "primary" | "success" | "info" {
  if (type === "alarm") return "warning";
  if (type === "repair") return "primary";
  if (type === "inspection") return "success";
  return "info";
}

function actionLabel(row: BusinessLogItem): string {
  return BIZ_ACTION_LABELS[row.biz_type]?.[row.action] || row.action;
}

function methodTagType(method: string) {
  if (method === "POST") return "primary";
  if (method === "DELETE") return "danger";
  return "warning";
}

const detailVisible = ref(false);
const sysDetail = ref<OperationLogItem | null>(null);
const bizDetail = ref<BusinessLogItem | null>(null);
const detailTitle = computed(() =>
  sysDetail.value ? "系统操作日志" : "业务流转日志",
);
const detailSubtitle = computed(() => {
  if (sysDetail.value)
    return `${formatDateTime(sysDetail.value.created_at, true)} · ${sysDetail.value.username || "匿名"}`;
  if (bizDetail.value)
    return `${bizTypeLabel(bizDetail.value.biz_type)} · ${bizDetail.value.biz_no}`;
  return "";
});
const detailIcon = computed(() =>
  sysDetail.value ? "ri-shield-keyhole-line" : "ri-article-line",
);

function openSysDetail(row: OperationLogItem) {
  sysDetail.value = row;
  bizDetail.value = null;
  detailVisible.value = true;
}
function openBizDetail(row: BusinessLogItem) {
  bizDetail.value = row;
  sysDetail.value = null;
  detailVisible.value = true;
}

function onTabChange(name: string) {
  if (name === "business" && !bizLoaded.value) loadBiz();
}

onMounted(async () => {
  await Promise.all([
    loadSys(),
    fetchAuditOptions().then(({ data }) => {
      moduleOptions.value = data.data.modules.map((m) => ({
        label: m,
        value: m,
      }));
      methodOptions.value = data.data.methods.map((m) => ({
        label: m,
        value: m,
      }));
    }),
  ]);
});
</script>

<style scoped lang="scss">
.tab-page {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.hint {
  flex: 0 0 auto;
  margin-bottom: 12px;
}

.table-section {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
  margin-top: 12px;
}

.table-card {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 操作内容：动作着色 */
.op-module {
  color: var(--el-text-color-secondary);
}

.op-sep {
  margin: 0 6px;
  color: var(--el-text-color-placeholder);
}

.op-obj {
  color: var(--el-text-color-secondary);
}

.op-action {
  font-weight: 600;
}

/* 对象信息中的工单号 / 记录号：紫色等宽 */
.op-code {
  color: #8055db;
  font-family: "JetBrains Mono", "Menlo", "Monaco", monospace;
  font-size: 12.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(128, 85, 219, 0.08);
}

/* 计数（N 项 / N 条 / N 人）：蓝色加粗 */
.op-num {
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 日期：次级灰 + 等宽 */
.op-date {
  color: var(--el-text-color-secondary);
  font-family: "DIN Alternate", "JetBrains Mono", monospace;
  font-size: 12.5px;
}

.op-success {
  color: var(--el-color-success);
}

.op-warning {
  color: var(--el-color-warning);
}

.op-danger {
  color: var(--el-color-danger);
}

.op-primary {
  color: var(--el-color-primary);
}

.op-info {
  color: var(--el-color-info);
}
</style>

<!-- 非 scoped：ProDetailDrawer 用 append-to-body 传送，scoped :deep 无法命中，
     只能用全局类选择器；且加在本文件 <style> 段里不会污染其他抽屉 -->
<style>
/* 操作路径等长文本的等宽胶囊 */
.pd-code {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(60, 90, 140, 0.06);
  color: #3b577a;
  font-family: 'JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  word-break: break-all;
  line-height: 1.6;
}
</style>
