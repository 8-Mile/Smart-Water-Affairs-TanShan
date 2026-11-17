<script setup lang="ts">
import PortBusinessJourney from "../components/PortBusinessJourney.vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NButton, NTag, useMessage } from "naive-ui";
import { useDemoStore } from "../demo/store";
import { useUnattendedStore } from "../demo/unattendedStore";
import { can, roleNames } from "../demo/permissions";
import {
  DUTY_MODE_NAMES, EVENT_STATUS_NAMES,
  assessPatrol, type EventStatus, type PatrolMode,
} from "../demo/unattended";

defineProps<{ embedded?: boolean }>();
const router = useRouter();
const route = useRoute();
const message = useMessage();
const demo = useDemoStore();
const duty = useUnattendedStore();
const selectedId = ref("");
watch(()=>route.query.eventId,id=>{
 if(typeof id==="string"&&id.trim())selectedId.value=id;
},{immediate:true});

const reason = ref("");
const latest = computed(() => duty.records[0] ?? null);
const active = computed(() => duty.openEvents);
const selected = computed(() => duty.events.find(e => e.id === selectedId.value) ?? duty.openEvents[0] ?? duty.events[0] ?? null);
const snapshot = computed(() => duty.snapshot());
const assessment = computed(() => assessPatrol(snapshot.value));
const canExecute = computed(() => can(demo.role, "unattended:execute"));
const canConfirm = computed(() => can(demo.role, "unattended:confirm"));
const canOrder = computed(() => can(demo.role, "workorder:create"));
const recentOrders = computed(() => demo.workorders.filter(w => w.title.includes("[值守")).slice().reverse().slice(0, 5));
const systemRows = computed(() => demo.subsystems.map(s => {
  const relevant = demo.assets.filter(a => a.subsystemId === s.id && !a.archived);
  return {
    ...s, assets: relevant.length,
    active: active.value.filter(e => e.subsystemId === s.id).length,
    monitoring: s.id === "medium-pressure" ? "已配置演示巡查" : "待配置专业巡查",
  };
}));
const statusName = (status: string) => EVENT_STATUS_NAMES[status as EventStatus] || status;

function run(): void {
  try {
    const record = duty.runPatrol();
    if (record.eventId) selectedId.value = record.eventId;
    message.success(record.eventId ? "巡查已完成，异常事件已关联" : "巡查已完成（MOCK）");
  } catch (error) { message.error((error as Error).message); }
}
function scene(mode: PatrolMode): void {
  try {
    const record = duty.simulate(mode);
    if (record.eventId) selectedId.value = record.eventId;
    message.success("已执行2轮模拟巡查（MOCK），请检查事件列表");
  } catch (error) { message.error((error as Error).message); }
}
function eventAction(id: string, to: EventStatus): void {
  try {
    duty.updateEvent(id, to, reason.value);
    reason.value = "";
    message.success("事件状态已更新");
  } catch (error) { message.error((error as Error).message); }
}
function createOrder(id: string): void {
  try {
    const orderId = duty.createEventOrder(id);
    message.success("已在现有工单系统创建检查工单草稿");
    void router.push({ path: "/operations/workorders", query: { workOrderId: orderId, returnTo: "/intelligent/unattended" } });
  } catch (error) { message.error((error as Error).message); }
}
function viewOrder(id: string): void {
  void router.push({ path: "/operations/workorders", query: { workOrderId: id, returnTo: "/intelligent/unattended" } });
}
function clear(): void {
  if (!confirm("仅重置无人值守DEMO状态？已创建的工单仍保留在工单模块。")) return;
  try { duty.resetDemo(); selectedId.value = ""; message.success("已重置值守演示"); }
  catch (error) { message.error((error as Error).message); }
}
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  // 仅浏览器页面处于打开状态时巡查，每30秒1次。并非服务端24小时调度。
  tick = setInterval(() => {
    if (duty.autoEnabled && canExecute.value) {
      try { duty.runPatrol(); } catch { /* 页面可展示下一轮错误 */ }
    }
  }, 30000);
});
onUnmounted(() => { if (tick) clearInterval(tick); });
</script>

<template>
  <div class="duty-simple">
  <PortBusinessJourney v-if="!embedded" />
    <div class="duty-heading">
      <div>
        <div class="overline">智能运行 / 集中值守</div>
        <h2>系统主动发现问题，人员只处理异常</h2>
        <p>日常工作只看三件事：系统是否在监护、有没有待处理事件、事件是否恢复。</p>
      </div>
      <div class="duty-heading-actions">
        <router-link class="corr-entry" to="/intelligent/correlation">跨系统异常关联处置 →</router-link>
        <NTag size="small" type="warning">DEMO · 非真实现场数据</NTag>
      </div>
    </div>

    <div class="duty-metrics">
      <div class="duty-metric"><span>当前值守状态</span><strong :class="{ red: active.length }">{{ active.length ? '有异常待处理' : duty.records.length ? '当前无待处理事件' : '尚未进行巡查' }}</strong><small>仅中压供水配置了演示规则</small></div>
      <div class="duty-metric"><span>需要人工处理</span><strong class="number" :class="{ red: active.length }">{{ active.length }}<em>件</em></strong><small>异常事件自动汇总，避免重复建单</small></div>
      <div class="duty-metric"><span>最近巡查结果</span><strong>{{ latest ? latest.result === 'normal' ? '正常' : latest.result === 'abnormal' ? '发现异常' : '无法确认' : '暂无记录' }}</strong><small>累计执行 {{ duty.records.length }} 轮 · 模拟检查</small></div>
    </div>

    <div class="duty-steps">
      <span><b>01</b> 系统自动巡查</span><i>→</i>
      <span><b>02</b> 异常主动提醒</span><i>→</i>
      <span><b>03</b> 人员确认处理</span><i>→</i>
      <span><b>04</b> 系统验证恢复</span>
    </div>

    <div class="duty-main">
      <section class="duty-surface event-surface">
        <div class="surface-heading">
          <div><h3>需要处理的事件</h3><p>值班员只需要从这里开始工作，不必逐个打开工艺监控页面。</p></div>
          <NTag size="small" :type="active.length ? 'error' : 'success'">{{ active.length ? '待处理 ' + active.length : '暂无待处理' }}</NTag>
        </div>
        <div v-if="!duty.events.length" class="empty-state">
          <strong>当前没有事件</strong>
          <p>正常值守时，这里不需要人员反复操作。演示故障请展开页面底部的「演示与测试」。</p>
        </div>
        <div v-else class="event-options">
          <button v-for="event in duty.events.slice(0, 8)" :key="event.id" type="button" class="event-item" :class="{ chosen: selected?.id === event.id, closed: event.status === 'closed' || event.status === 'dismissed' }" @click="selectedId = event.id">
            <span class="event-flag" :class="{ clear: event.status === 'closed' }"></span>
            <span class="event-brief"><strong>{{ event.title }}</strong><small>{{ event.id }} · 中压供水 P-002 · {{ event.occurrences }}次检测</small></span>
            <span class="event-status">{{ statusName(event.status) }}</span>
            <span class="event-arrow">›</span>
          </button>
        </div>

        <div v-if="selected" class="event-focus">
          <div class="focus-heading"><strong>当前事件 · {{ selected.id }}</strong><span :class="{ red: active.some(e => e.id === selected?.id) }">{{ statusName(selected.status) }}</span></div>
          <p class="focus-summary">{{ selected.detail }}</p>
          <div class="focus-steps"><span :class="{ done: selected.status !== 'pending_verification' }">发现</span><span :class="{ done: !['pending_verification','acknowledged'].includes(selected.status) }">确认</span><span :class="{ done: ['pending_recovery','ready_to_close','closed'].includes(selected.status) }">处置</span><span :class="{ done: selected.status === 'ready_to_close' || selected.status === 'closed' }">恢复验证</span><span :class="{ done: selected.status === 'closed' }">关闭</span></div>
          <div class="focus-next">
            <template v-if="selected.status === 'pending_verification'">
              <div><strong>下一步：确认是否真实异常</strong><small>先核对证据，再由值班员确认。</small></div>
              <NButton type="primary" :disabled="!canConfirm" @click="eventAction(selected.id, 'acknowledged')">确认异常</NButton>
            </template>
            <template v-else-if="selected.status === 'acknowledged'">
              <div><strong>下一步：安排检查处理</strong><small>可创建现有工单；无需新建另一套事件。</small></div>
              <NButton type="primary" :disabled="!canConfirm" @click="eventAction(selected.id, 'processing')">开始处置</NButton>
            </template>
            <template v-else-if="selected.status === 'processing'">
              <div><strong>下一步：完成处理并申请恢复验证</strong><small>涉及设备故障时，应在工单系统完成处理与验收。</small></div>
              <NButton v-if="!selected.workOrderId" :disabled="!canOrder" @click="createOrder(selected.id)">生成检查工单</NButton>
              <NButton v-else secondary @click="viewOrder(selected.workOrderId!)">打开关联工单</NButton>
              <NButton type="primary" :disabled="!canConfirm" @click="eventAction(selected.id, 'pending_recovery')">申请恢复验证</NButton>
            </template>
            <template v-else-if="selected.status === 'pending_recovery'">
              <div><strong>等待监测值恢复并通过验证</strong><small>连续两轮有效巡查；异常仍在则自动退回处理中。</small></div>
              <span class="verify-status">有效恢复 {{ selected.validRecoveryChecks }}/2 轮</span>
            </template>
            <template v-else-if="selected.status === 'ready_to_close'">
              <div><strong>下一步：人工确认关闭</strong><small>压力异常须先完成关联工单验收；监测恢复不代表维修完成。</small></div>
              <span class="verify-status">有效恢复 {{ selected.validRecoveryChecks }}/2 轮</span>
              <NButton type="primary" :disabled="!canConfirm" @click="eventAction(selected.id, 'closed')">确认关闭事件</NButton>
            </template>
            <template v-else>
              <div><strong>{{ selected.status === 'closed' ? '已闭环' : '已归档' }}</strong><small>完整处理记录可在下面展开查看。</small></div>
            </template>
          </div>
          <div v-if="selected.status === 'pending_verification' || selected.status === 'acknowledged'" class="false-alarm">
            <textarea v-model="reason" placeholder="误报时填写核实依据；不确定时请先进一步检查" rows="2" :disabled="!canConfirm"></textarea>
            <NButton size="small" secondary :disabled="!canConfirm" @click="eventAction(selected.id, 'dismissed')">误报归档</NButton>
          </div>
          <div v-if="selected.workOrderId" class="focus-order"><span>关联工单：{{ selected.workOrderId }} · 状态 {{ demo.workorders.find(o => o.id === selected?.workOrderId)?.status ?? '未知' }}</span><button @click="viewOrder(selected.workOrderId!)">查看工单 →</button></div>
          <details class="focus-details"><summary>查看判断依据和完整处理记录</summary>
            <div class="evidence-title">事件证据（均为MOCK）</div>
            <div v-for="evidence in selected.evidence" :key="evidence" class="evidence-row">{{ evidence }}</div>
            <div class="evidence-title">事件时间轴</div>
            <div v-for="(item, index) in selected.history.slice().reverse()" :key="index" class="timeline-entry"><strong>{{ item.action }}</strong><small>{{ new Date(item.at).toLocaleString('zh-CN', { hour12:false }) }} · {{ item.by }}</small><p>{{ item.detail }}</p></div>
          </details>
        </div>
      </section>

      <aside class="duty-side">
        <section class="duty-surface">
          <div class="surface-heading"><div><h3>六套工艺监护状态</h3><p>未接入监护规则，不会显示为正常。</p></div></div>
          <div class="system-list">
            <div v-for="system in systemRows" :key="system.id" class="system-row">
              <span class="system-indicator" :class="{ linked: system.id === 'medium-pressure', alarming: system.active }"></span>
              <div><strong>{{ system.name }}</strong><small>{{ system.id === 'medium-pressure' ? (system.active ? '检测到需处理事件' : '已配置模拟监护') : '专业规则待配置' }}</small></div>
              <router-link :to="'/process/' + system.id">查看工艺 ›</router-link>
            </div>
          </div>
        </section>
        <section class="duty-surface inspection-status">
          <div class="surface-heading"><div><h3>巡查结果摘要</h3><p>系统执行检查，人员只关注异常。</p></div></div>
          <div class="inspection-stats"><span>当前对象</span><strong>P-002 · 中压供水2号泵</strong></div>
          <div class="inspection-stats device-strip"><span>压力</span><strong>{{ snapshot.pressureMpa === null ? '缺数' : snapshot.pressureMpa.toFixed(2) + ' MPa' }}</strong></div>
          <div class="inspection-stats"><span>数据质量</span><strong>{{ snapshot.pressureQuality === 'valid' ? '有效（模拟）' : '失效 / 缺测' }}</strong></div>
          <details class="focus-details"><summary>展开四项专业巡查明细</summary>
            <div v-for="check in (latest?.checks ?? assessment.checks)" :key="check.id" class="check-row">
              <span :class="check.result">{{ check.result === 'normal' ? '正常' : check.result === 'abnormal' ? '异常' : '待核实' }}</span>
              <div><strong>{{ check.name }}</strong><small>{{ check.note }}</small></div><b>{{ check.value }}</b>
            </div>
          </details>
        </section>
      </aside>
    </div>

    <details class="demo-tools">
      <summary><strong>演示与测试</strong><span>仅用于体验故障流程，日常值班不需要操作这些按钮</span></summary>
      <div class="demo-body">
        <div class="demo-actions">
          <NButton :disabled="!canExecute" @click="run">执行一次巡查</NButton>
          <NButton :disabled="!canExecute" :type="duty.mode === 'normal' ? 'primary' : 'default'" @click="scene('normal')">正常巡查 / 恢复</NButton>
          <NButton :disabled="!canExecute" :type="duty.mode === 'pressure' ? 'error' : 'default'" @click="scene('pressure')">模拟压力异常</NButton>
          <NButton :disabled="!canExecute" :type="duty.mode === 'signal' ? 'warning' : 'default'" @click="scene('signal')">模拟通信中断</NButton>
          <NButton :disabled="!canExecute" :type="duty.mode === 'ocr' ? 'warning' : 'default'" @click="scene('ocr')">模拟视频识别失败</NButton>
          <NButton :disabled="!canExecute" secondary @click="duty.toggleAuto()">{{ duty.autoEnabled ? '停止页面定时巡查' : '开启页面定时巡查（30秒）' }}</NButton>
          <NButton :disabled="!canExecute" secondary @click="clear">重置演示</NButton>
        </div>
        <p>演示使用MOCK数据。连续两轮发现异常才创建事件；定时巡查仅在当前浏览器页面打开时执行，不能代替正式服务端24小时值守。当前角色：{{ roleNames[demo.role] }}。模拟状态：{{ DUTY_MODE_NAMES[duty.mode] }}。</p>
      </div>
    </details>
    <details class="demo-tools">
      <summary><strong>历史巡查记录与关联工单</strong><span>专业人员需要追溯时再展开</span></summary>
      <div class="demo-body history-panel">
        <div v-if="!duty.records.length" class="empty-state">暂无已执行巡查</div>
        <div v-for="record in duty.records.slice(0, 12)" :key="record.id" class="patrol-row">
          <strong>{{ record.id }}</strong>
          <span>{{ new Date(record.at).toLocaleString('zh-CN', { hour12:false }) }}</span>
          <span>{{ DUTY_MODE_NAMES[record.mode] }}</span>
          <span>{{ record.result === 'normal' ? '正常' : record.result === 'abnormal' ? '异常' : '待核实' }}</span>
          <button v-if="record.eventId" @click="selectedId = record.eventId!">{{ record.eventId }}</button>
        </div>
        <div class="evidence-title">关联工单</div>
        <div v-if="!recentOrders.length" class="empty-state">暂无值守关联工单</div>
        <button v-for="order in recentOrders" :key="order.id" class="order-row" @click="viewOrder(order.id)">{{ order.code }} · {{ order.title }} · {{ order.status }} →</button>
      </div>
    </details>
    <p class="duty-footnote">第一阶段仅验证中压供水的模拟流程。六系统监护、OCR和24小时后端调度尚未全部接入；演示结果不能作为现场运行依据。</p>
  </div>
</template>

<style scoped>
.duty-heading-actions{display:flex;align-items:center;flex-wrap:wrap;gap:9px}
.corr-entry{font-size:12px;color:#227ea8;text-decoration:none;background:white;border:1px solid #cbe2ee;padding:8px 11px;border-radius:7px;white-space:nowrap}
.corr-entry:hover{background:#e9f6fc}

.duty-simple{display:grid;gap:15px;color:#234761;padding-bottom:24px}
.duty-heading{background:linear-gradient(108deg,#e5f3fe,#fff 60%,#eaf6fd);border:1px solid #cfe4f2;border-radius:12px;display:flex;justify-content:space-between;gap:18px;align-items:center;padding:22px 25px}
.overline{font-size:12px;color:#4f8bac;margin-bottom:6px}
.duty-heading h2{font-size:23px;margin:0;font-weight:750;color:#153d5b}
.duty-heading p{font-size:13px;color:#7893a4;margin:6px 0 0;line-height:1.6}
.duty-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.duty-metric{display:grid;gap:7px;padding:18px 20px;border:1px solid #deebf4;border-radius:10px;background:#fff}
.duty-metric>span{font-size:12px;color:#7c95a6}
.duty-metric strong{font-size:19px;color:#2778a7;font-weight:730}
.duty-metric strong.number{font-size:27px}.duty-metric strong.red,.focus-heading .red{color:#d34e51}
.duty-metric strong em{font-style:normal;font-size:13px;color:#7c95a6;margin-left:5px}
.duty-metric small{font-size:11px;color:#92a6b5}
.duty-steps{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;background:#f4f9fd;border:1px solid #e0eef7;border-radius:9px;padding:13px}
.duty-steps span{font-size:12px;color:#597e97;white-space:nowrap}.duty-steps b{font-weight:650;color:#0e81b7;margin-right:4px}.duty-steps i{font-style:normal;color:#9bbccb}
.duty-main{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,0.92fr);gap:13px;align-items:start}
.duty-side{display:grid;gap:13px;min-width:0}.duty-surface{background:#fff;border:1px solid #dae9f3;border-radius:11px;padding:19px;min-width:0;box-shadow:0 6px 20px rgba(35,90,125,.04)}
.surface-heading{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:16px}
.surface-heading h3{font-size:16px;margin:0;color:#1d4b6a}.surface-heading p{font-size:11px;line-height:1.55;color:#8da4b3;margin:5px 0 0}
.empty-state{border:1px dashed #d7e6ef;background:#f8fbfe;border-radius:9px;padding:33px 20px;text-align:center}
.empty-state strong{font-size:15px;color:#2f6d91}.empty-state p{font-size:12px;color:#8299aa;line-height:1.8;margin:8px 0 0}
.event-options{display:grid;gap:8px}.event-item{display:flex;align-items:center;text-align:left;gap:10px;width:100%;padding:13px 12px;background:#f9fbfe;border:1px solid #e1ebf2;border-radius:8px;cursor:pointer;color:#335c77}
.event-item.chosen{border-color:#85c6e9;background:#f0f9ff}.event-item.closed{opacity:.75}
.event-flag{height:9px;width:9px;border-radius:50%;background:#ef7b64;flex:none}.event-flag.clear{background:#35b783}
.event-brief{flex:1;min-width:0;display:grid;gap:5px}.event-brief strong{font-size:13px}.event-brief small{font-size:11px;color:#8ca5b6}
.event-status{font-size:11px;color:#bb7652;white-space:nowrap}.event-arrow{font-size:20px;color:#8eb0c3}
.event-focus{margin-top:18px;border-top:1px solid #e7edf3;padding-top:17px}
.focus-heading{display:flex;align-items:center;justify-content:space-between;color:#3a7395;font-size:13px}
.focus-heading span{font-size:11px;color:#21936a}
.focus-summary{font-size:12px;color:#657e91;line-height:1.8;margin:12px 0}
.focus-steps{display:flex;justify-content:space-between;gap:6px;background:#f4f8fb;padding:12px 9px;border-radius:7px}
.focus-steps span{font-size:11px;color:#a0adba}.focus-steps span.done{color:#238cb9;font-weight:650}
.focus-next{display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:#f0f8ff;border:1px solid #d8ebf8;padding:13px;border-radius:8px;margin-top:12px}
.focus-next>div{flex:1;min-width:200px;display:grid;gap:4px}.focus-next strong{font-size:13px}.focus-next small{font-size:11px;color:#7d98aa;line-height:1.6}
.verify-status{font-size:11px;color:#1584aa;white-space:nowrap}
.false-alarm{display:flex;align-items:center;gap:8px;margin-top:11px}
.false-alarm textarea{flex:1;min-width:0;border:1px solid #dae7f0;border-radius:7px;padding:8px;font-size:12px;resize:vertical}
.focus-order{display:flex;align-items:center;justify-content:space-between;gap:9px;font-size:11px;margin-top:12px;color:#5c8299;flex-wrap:wrap}
.focus-order button{border:0;background:transparent;color:#1689ba;cursor:pointer}
.focus-details{border-top:1px solid #e9f1f6;margin-top:15px;padding-top:12px}.focus-details summary{font-size:12px;color:#2980aa;cursor:pointer;list-style:revert}
.evidence-title{font-size:12px;color:#456d88;font-weight:700;margin:15px 0 8px}.evidence-row{background:#f5f9fc;margin-bottom:4px;padding:7px;font-size:11px;color:#688397;border-left:2px solid #aad3ed}
.timeline-entry{display:grid;gap:3px;border-left:2px solid #b4dbed;margin:8px 0 8px 2px;padding-left:10px}
.timeline-entry strong{font-size:12px}.timeline-entry small{font-size:10px;color:#91a6b4}.timeline-entry p{font-size:11px;color:#69869a;margin:0}
.system-list{display:grid}.system-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #e9f0f4}
.system-indicator{height:9px;width:9px;border-radius:50%;background:#b6c7d0;flex:none}.system-indicator.linked{background:#3bad87}.system-indicator.alarming{background:#e86b65}
.system-row div{flex:1;display:grid;gap:4px}.system-row strong{font-size:12px;color:#3a6078}.system-row small{font-size:10px;color:#94a8b5}
.system-row a{font-size:11px;color:#278ebc;white-space:nowrap}
.inspection-stats{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid #edf3f8}
.inspection-stats span{font-size:12px;color:#91a4b3}.inspection-stats strong{font-size:12px;color:#476d88}
.check-row{display:flex;gap:8px;padding:10px 0;border-bottom:1px solid #e9f0f5;align-items:center}
.check-row>span{color:#17a175;font-size:11px;white-space:nowrap}.check-row>span.abnormal{color:#cc5754}.check-row>span.unknown{color:#bf9041}
.check-row>div{flex:1;display:grid;gap:5px}.check-row strong{font-size:12px}.check-row small{font-size:10px;color:#9baab6}.check-row b{font-size:11px;color:#6b8496;white-space:nowrap}
.demo-tools{background:#fff;border:1px solid #dbeaf3;border-radius:10px;padding:0 18px}
.demo-tools>summary{display:flex;align-items:center;gap:14px;cursor:pointer;padding:16px 0;list-style:revert}
.demo-tools>summary strong{font-size:13px;color:#386d8b}.demo-tools>summary span{font-size:11px;color:#91a6b4}
.demo-body{padding:5px 0 17px;border-top:1px solid #edf1f5}
.demo-actions{display:flex;gap:8px;flex-wrap:wrap;padding-top:15px}
.demo-body>p{font-size:11px;color:#849cab;line-height:1.8;margin:13px 0 0}
.patrol-row{display:grid;grid-template-columns:75px 1.4fr 1fr 65px 65px;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #edf2f6;font-size:11px;color:#69879b}
.patrol-row strong{color:#367fa5}.patrol-row button,.order-row{background:transparent;border:0;color:#2384ae;cursor:pointer}
.order-row{display:block;padding:8px 0;text-align:left;width:100%;border-bottom:1px solid #edf1f5;font-size:11px}
.duty-footnote{color:#9babba;font-size:11px;margin:0;line-height:1.6}
@media(max-width:1170px){.duty-main{grid-template-columns:1fr}.duty-side{grid-template-columns:1fr 1fr}}
@media(max-width:780px){.duty-metrics{grid-template-columns:1fr 1fr}.duty-side{grid-template-columns:1fr}.duty-heading{flex-direction:column;align-items:start}.duty-steps{justify-content:flex-start}}
@media(max-width:530px){.duty-metrics{grid-template-columns:1fr}.duty-steps i{display:none}.focus-next{align-items:flex-start}.patrol-row{grid-template-columns:1fr 1fr}}
</style>
