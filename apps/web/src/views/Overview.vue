<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Icon from "../components/overview/OverviewIcon.vue";
import WaterChart from "../components/overview/OverviewWaterChart.vue";
import portPicture from "../assets/dasboard/gongyi.png";
import { useDemoStore } from "../demo/store";
import { useUiStore } from "../demo/ui";
import { can, roleNames } from "../demo/permissions";
import { useUnattendedStore } from "../demo/unattendedStore";
import { buildRoleQueue } from "../demo/roleQueue";
import type { SceneHotspot } from "../demo/diagram";
import { isPumpAsset, scorePumpHealth } from "../demo/health";
import { ENGINEERING_CHECKS,readEngineeringReviews } from "../demo/engineering";
import {topologySummary} from "../demo/engineeringTopology";
import {workOrderStatusLabels} from "../demo/workorderMeta";

const store = useDemoStore();
const ui = useUiStore();
const duty = useUnattendedStore();
const roleTaskCount = computed(() => buildRoleQueue(
  store.role, store.alarms, store.workorders, duty.events, store.assets,
).tasks.length);
const sceneEditing = ref(false);
const sceneAssetId = ref('');
const movingHotspotId = ref('');
const sceneItems = computed(() => store.sceneHotspots.filter(item => item.sceneId === 'overview-port' && item.visible && store.getAsset(item.assetId)));
function placeHotspot(event: MouseEvent): void {
  if (!sceneEditing.value || !sceneAssetId.value) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const asset = store.getAsset(sceneAssetId.value);
  if (!asset) return;
  const hotspot: SceneHotspot = { id: movingHotspotId.value || `scene-${asset.id}`, sceneId: 'overview-port', assetId: asset.id, xPct: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), yPct: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)), label: asset.code, visible: true };
  store.upsertSceneHotspot(hotspot);
  movingHotspotId.value = '';
}
function editHotspot(hotspot: SceneHotspot): void { movingHotspotId.value = hotspot.id; sceneAssetId.value = hotspot.assetId; sceneEditing.value = true; }
const period = ref<"day" | "week" | "month">("day");
const fmt = (n: number | null | undefined, digits = 1) => n == null ? "缺测" : n.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const positions: Record<string, [number, number]> = { spray: [315, 151], "medium-pressure": [603, 194], mining: [885, 146], rainwater: [231, 278], pool: [608, 313], domestic: [918, 267] };
const icons: Record<string, string> = { spray: "spray", "medium-pressure": "tap", mining: "flask", rainwater: "rain", pool: "tank", domestic: "water" };
const alarms = computed(() => store.alarms.filter(a => a.status === "active"));
const focusedPump = computed(() => store.scenarioId==="SCN-PUMP-FAULT"
  ?store.getAsset("asset-p002"):null);
const focusedAlarm = computed(() => store.alarms.find(a=>a.id==="ALM-P002-01"));
const focusedOrder = computed(() => store.workorders.find(o=>o.id==="wo-2026-014"));
const focusedAlarmLabel = computed(() => {
 const value=focusedAlarm.value?.status;
 if(value==="active")return "待人工确认";
 if(value==="acknowledged")return "已确认待复核";
 if(value==="closed")return "人工已关闭";
 return "未发现关联告警";
});
const systems = computed(() => store.subsystems.map(item => {
  const devices = store.assets.filter(a => a.subsystemId === item.id && !a.archived);
  const warning = devices.some(a => a.status === "fault") || alarms.value.some(a => a.subsystemId === item.id && a.level === "critical");
  return { ...item, icon: icons[item.id], position: positions[item.id],
    displayName: item.id === "domestic" ? "生活污水外送" : item.name,
    state: warning ? "MOCK设备异常" : devices.some(a => a.status === "running") ? "MOCK设备运行" : "状态待核验", warning };
}));
const activeSystemId = ref<string | null>(null);
const popoverStyle = ref<Record<string, string>>({});
const popoverBelow = ref(false);
const activeDetail = computed(() => {
  const system = systems.value.find((item) => item.id === activeSystemId.value);
  if (!system) return null;
  const devices = store.assets.filter((asset) => asset.subsystemId === system.id && !asset.archived);
  const readings = devices
    .flatMap((asset) => store.getPoints(asset.id))
    .slice(0, 3)
    .map((point) => {
      const sample = store.latest(point.id);
      const value = sample?.value;
      const valid = sample?.quality === "valid" && value !== null && value !== undefined;
      return {
        id: point.id,
        label: point.label,
        value: valid ? (typeof value === "number" ? fmt(value, 2) : String(value)) : "缺测",
        unit: point.unit ?? "",
        source: sample?.source ?? point.source,
      };
    });
  return {
    ...system,
    devices: devices.length,
    running: devices.filter((asset) => asset.status === "running").length,
    alarms: alarms.value.filter((alarm) => alarm.subsystemId === system.id).length,
    readings,
  };
});
function openSystem(id: string, event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = Math.min(330, window.innerWidth - 24);
  const half = width / 2;
  const center = Math.min(Math.max(rect.left + rect.width / 2, half + 12), window.innerWidth - half - 12);
  popoverBelow.value = rect.top < 330;
  const available = popoverBelow.value ? window.innerHeight - rect.bottom - 16 : rect.top - 16;
  activeSystemId.value = id;
  popoverStyle.value = {
    left: `${center}px`,
    top: popoverBelow.value ? `${rect.bottom + 12}px` : `${rect.top - 10}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(200, Math.min(440, available))}px`,
    transform: popoverBelow.value ? "translate(-50%, 0)" : "translate(-50%, -100%)",
  };
}
function closeSystem(): void {
  activeSystemId.value = null;
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeSystem();
}
function onDocClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".system-popover") && !target?.closest(".hotspot")) closeSystem();
}
function onScroll(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest?.(".system-popover")) closeSystem();
}
watch(activeSystemId, (value) => {
  if (typeof document === "undefined") return;
  if (value) {
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("click", onDocClick);
    window.addEventListener("resize", closeSystem);
    window.addEventListener("scroll", onScroll, true);
  } else {
    window.removeEventListener("keydown", onKeydown);
    window.removeEventListener("click", onDocClick);
    window.removeEventListener("resize", closeSystem);
    window.removeEventListener("scroll", onScroll, true);
  }
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("click", onDocClick);
  window.removeEventListener("resize", closeSystem);
  window.removeEventListener("scroll", onScroll, true);
});
const latestStorage = computed(() => store.kpis.find(k => k.label === "最近雨次末段储量")?.value);
const daily = computed(() => store.seed.dailyWater);
const today = computed(() => daily.value.at(-1)!);
const greenMetrics = computed(() => {
  const total = today.value.consumed;
  const share = (n:number) => total ? n / total * 100 : 0;
  return [
    { key: "tap", icon: "tap", label: "自来水用量", value: today.value.supply.tap, share: share(today.value.supply.tap) },
    { key: "reclaimed", icon: "recycle", label: "中水用量", value: today.value.supply.reclaimed, share: share(today.value.supply.reclaimed) },
    { key: "rain", icon: "rain", label: "循环利用·雨水", value: today.value.supply.rain, share: share(today.value.supply.rain) },
  ];
});
// REVIEWED_DEMO is an audit of a local note, never a real equipment acceptance.
const engineeringTopology = topologySummary(readEngineeringReviews(localStorage));
const verifiedEquipmentCount = engineeringTopology.fieldVerified;
const engineeringOpenCount = ENGINEERING_CHECKS.length;
const scoredPumps = computed(() => store.assets.filter(a => !a.archived && isPumpAsset(a)).map(asset => {
  const reading = (metric: string) => {
    const point = store.getPoints(asset.id).find(p => p.label.includes(metric));
    const sample = point && store.latest(point.id);
    return sample?.quality === "valid" && typeof sample.value === "number" ? sample.value : null;
  };
  const health = scorePumpHealth({ asset, readings: { vibration: reading("振动"), temperature: reading("温度"), current: reading("电流") }, runtimeHours: asset.runtimeHours, startCount: asset.startCount, asOf: store.seed.referenceTime });
  return { asset, score: health.score, band: health.band };
}).sort((a,b) => (a.score ?? Infinity) - (b.score ?? Infinity)));
const pumps = computed(() => scoredPumps.value.slice(0, 3));
const highRisk = computed(() => scoredPumps.value.filter(p => p.score !== null && p.score < 80).length);
const ordersPending = computed(() => store.workorders.filter(o => ["draft", "pending_dispatch"].includes(o.status)));
const ordersActive = computed(() => store.workorders.filter(o => o.status === "in_progress"));
const counts = computed(() => [
  { icon: "clipboard", title: "待处理工单", value: ordersPending.value.length, note: `其中紧急 ${ordersPending.value.filter(o => o.priority === "urgent").length} 项`, to: "/operations/workorders" },
  { icon: "tools", title: "进行中工单", value: ordersActive.value.length, note: `待验收 ${store.workorders.filter(o => o.status === "pending_acceptance").length} 项`, to: "/operations/workorders" },
  { icon: "checklist", title: "巡检记录", value: store.inspections.length, note: `异常记录 ${store.inspections.filter(o => o.result === "abnormal").length} 项`, to: "/operations/assets?tab=records" },
]);
function elapsed(at: string) {
  const minutes = Math.max(0, Math.round((Date.parse(store.seed.referenceTime) - Date.parse(at)) / 60000));
  return minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes/60)} 小时前` : `${Math.floor(minutes/1440)} 天前`;
}
</script>

<template>
  <section class="panorama" aria-label="港区全景监控">
    <div class="metrics">
      <RouterLink to="/water/balance?returnTo=/overview" class="glass metric metric-water" title="同周期水量守恒与供需动态平衡 · MOCK">
        <span class="emblem"><Icon name="rain" /></span>
        <div class="metric-main"><h2>动态平衡</h2><strong class="needs-check">模型演示</strong><p>来水 / 处理 / 回用</p></div>
      </RouterLink>
      <RouterLink to="/process/mining" class="glass metric metric-supply">
        <span class="emblem"><Icon name="flask" /></span><div class="metric-main"><h2>环保处理</h2><strong class="needs-check">水质待核</strong></div>
        <div class="metric-detail"><p>处理能力 <b>待核</b></p><p>回用管网 <b>待核</b></p></div>
      </RouterLink>
      <RouterLink to="/water/machine-supply?returnTo=/overview" class="glass metric metric-environment">
        <span class="emblem"><Icon name="shield" /></span><div class="metric-main"><h2>供水保障</h2><strong class="needs-check">终端待核</strong></div>
        <div class="metric-detail"><p>供水拓扑 <b>未知</b></p><p>现场验收 <b>{{ verifiedEquipmentCount }}</b></p></div>
      </RouterLink>
      <RouterLink to="/operations/alarms?status=active" class="glass metric metric-risks">
        <span class="emblem"><Icon name="risk" /></span><div class="metric-main"><h2>MOCK重点事件</h2><strong class="risk">{{ alarms.length }} <small>项</small></strong></div>
        <div class="metric-detail"><p>设备健康需关注 <b class="risk">{{ highRisk }}</b></p><p>待协调工单 <b>{{ ordersPending.length }}</b></p></div>
      </RouterLink>
    </div>

    <section class="core-business" aria-label="港口三大核心业务链">
      <RouterLink to="/water/overview?returnTo=/overview" class="core-card">
        <span class="core-no">01 / 循环利用</span><strong>自来水 · 中水 · 循环水</strong>
        <small>来源 → 处理 → 回用 → 分账</small><b>查看水量账本 ›</b>
      </RouterLink>
      <RouterLink to="/water/machine-supply?returnTo=/overview" class="core-card">
        <span class="core-no">02 / 生产保障</span><strong>各大机 · 供水需求</strong>
        <small>作业状态 → 需水量 → 保障能力</small><b>验证供水缺口 ›</b>
      </RouterLink>
      <RouterLink to="/water/balance?returnTo=/overview" class="core-card">
        <span class="core-no">03 / 动态平衡</span><strong>收集 · 处理 · 回用</strong>
        <small>同周期水量 → 池容 → 风险</small><b>进入平衡分析 ›</b>
      </RouterLink>
    </section>

    <div class="middle">
      <section class="map-wrap" aria-label="港区工艺全景">
        <div v-if="can(store.role, 'scene:write')" class="scene-tools">
          <button type="button" @click="sceneEditing = !sceneEditing">{{ sceneEditing ? '完成热点编辑' : '管理设备热点' }}</button>
          <template v-if="sceneEditing">
            <select v-model="sceneAssetId" aria-label="选择热点设备"><option value="">选择设备</option><option v-for="asset in store.assets.filter(item => !item.archived)" :key="asset.id" :value="asset.id">{{ asset.code }} {{ asset.name }}</option></select>
            <span>选择设备后点击图片定位；点击已有热点可移动</span>
          </template>
        </div>
        <div class="map" @click="placeHotspot">
          <img :src="portPicture" alt="京唐港区 51、52 号泊位六套工艺示意图" />
          
          <RouterLink to="/engineering/registry?focus=topology" class="map-evidence-link" @click.stop>水路关系 {{ engineeringTopology.fieldVerified }}/{{ engineeringTopology.total }} 现场已确认 · 查看核查</RouterLink>
          <span class="map-evidence-flag">六工艺位置示意 · 连通关系待图纸核查</span>
          <div v-if="focusedPump" class="fault-focus" aria-label="中压泵模拟故障聚焦">
            <div class="fault-focus-heading">
              <small>MOCK 异常聚焦 · 不代表现场故障</small>
              <strong>{{ focusedPump.code }} · {{ focusedPump.name }}</strong>
            </div>
            <div class="fault-focus-status">
              <span>告警：{{ focusedAlarmLabel }}</span>
              <span>工单：{{ focusedOrder?workOrderStatusLabels[focusedOrder.status]:'无关联记录' }}</span>
            </div>
            <nav aria-label="模拟故障核查入口">
              <RouterLink to="/process/medium-pressure">工艺</RouterLink>
              <RouterLink to="/operations/asset-workspace?assetId=asset-p002&tab=events">设备核查</RouterLink>
              <RouterLink to="/operations/workorders?workOrderId=wo-2026-014">原工单</RouterLink>
            </nav>
          </div>
          <span class="berth first">51号泊位</span><span class="berth second">52号泊位</span>
          <button v-for="s in systems" :key="s.id" type="button" class="hotspot" :data-system="s.id"
            :title="s.id === 'domestic' ? '生活污水关联管理示意，现场建设范围待核实' : s.name+'工艺示意'"
            :class="{'hotspot-risk':s.warning}"
            :aria-label="'查看'+s.name+'系统基础信息'"
            :style="{left:'clamp(80px, '+(s.position[0]/1048*100)+'%, calc(100% - 80px))',top:(s.position[1]/379*100)+'%'}"
            @click="openSystem(s.id, $event)">
            <Icon :name="s.icon" /><div>{{ s.displayName }}系统<small :class="{warning:s.warning}"><i />{{ s.state }}</small></div>
          </button>
          <button v-for="item in sceneItems" :key="item.id" type="button" class="scene-device-hotspot" :style="{ left: `${item.xPct * 100}%`, top: `${item.yPct * 100}%` }" :title="`${item.label} · ${store.getAsset(item.assetId)?.name}`" @click.stop="sceneEditing ? editHotspot(item) : ui.openAsset(item.assetId)">{{ item.label || store.getAsset(item.assetId)?.code }}</button>
        </div>
        <div v-if="sceneEditing && movingHotspotId" class="scene-tools"><button type="button" @click="store.removeSceneHotspot(movingHotspotId); movingHotspotId = ''">删除所选热点</button><span>点击图片可移动所选热点</span></div>
        <div class="glass process-strip"><strong><Icon name="layers" />六工艺状态（MOCK）</strong>
          <RouterLink v-for="s in systems" :key="s.id" :to="'/process/'+s.id"><Icon :name="s.icon"/><div>{{ s.displayName }}<small :class="{warning:s.warning}">{{ s.state }}</small></div></RouterLink>
        </div>
      </section>
      <aside class="right-stack">
        <section class="glass panel-box green-port">
          <div class="green-port-art">
            <h2>绿能港口</h2>
            <span>绿色调度 · 节能运行</span>
          </div>
          <div class="green-port-metrics">
            <RouterLink v-for="m in greenMetrics" :key="m.key" class="green-metric"
              :to="{path:'/water/ledger',query:{source:m.key==='tap'?'自来水':m.key==='reclaimed'?'中水':'雨水',returnTo:'/overview'}}">
              <Icon :name="m.icon" />
              <span>{{ m.label }}</span>
              <strong>{{ fmt(m.value, 0) }}<small>m³</small></strong>
              <em v-if="m.share !== undefined">占比 {{ m.share.toFixed(1) }}%</em>
              <em v-else>今日累计</em>
            </RouterLink>
          </div>
          <p class="green-source">MOCK源端样例 · 自来水 / 中水 / 循环利用中的雨水子项；未包含洗车及其他循环水，不代表循环水总量 · 今日样例总量 {{ fmt(today.consumed) }} m³</p>
        </section>
        <section class="glass panel-box events-panel">
          <header><h2><Icon name="bell" />重点运行事件（{{ alarms.length }}）</h2><RouterLink to="/operations/alarms">查看全部 <span>›</span></RouterLink></header>
          <div class="events-list"><RouterLink v-for="a in alarms.slice(0,3)" :key="a.id" :to="{path:'/operations/events',query:{tab:'queue',eventRef:'alarm:'+a.id,returnTo:'/overview'}}" class="event" :title="a.title+'：'+a.detail">
            <b class="event-level" :class="a.level">{{ a.level === 'critical' ? '高' : a.level === 'warning' ? '中' : '低' }}</b>
            <span class="event-text"><strong>{{ a.title }}</strong><small>{{ a.detail }}</small></span><time>{{ elapsed(a.occurredAt) }}</time>
          </RouterLink><p v-if="!alarms.length" class="empty">暂无活动事件</p></div>
        </section>
      </aside>
    </div>

    <div class="bottom">
      <section class="glass panel-box trend-panel">
        <header><h2><Icon name="chart" />近7日用水与回用占比趋势</h2><div class="period-switch" role="group" aria-label="用水趋势统计周期"><button v-for="p in (['day','week','month'] as const)" :key="p" :class="{selected:period===p}" :aria-pressed="period===p" @click="period=p">{{ {day:'日',week:'周',month:'月'}[p] }}</button></div></header>
        <WaterChart :records="daily" :period="period" />
      </section>
      <section class="glass panel-box health-panel">
        <header><h2><Icon name="health" />设备健康关注与风险</h2><RouterLink to="/decision/health">全部设备 <span>›</span></RouterLink></header>
        <div class="summary-list"><RouterLink v-for="p in pumps" :key="p.asset.id" :to="{name:'health',query:{assetId:p.asset.id}}" class="health-row">
          <Icon name="pump" /><b class="pump-code">{{ p.asset.code }}</b><b class="pump-name" :title="p.asset.name">{{ p.asset.name }}</b>
          <div class="health-score" :class="p.score === null ? 'missing' : p.score < 80 ? 'risk' : 'good'"><div><strong>{{ p.score === null ? '待评价' : fmt(p.score,0) }}<small v-if="p.score !== null">分</small></strong><b>{{ p.score === null ? '缺测' : p.band }}</b></div><span class="health-track"><i :style="{width:(p.score ?? 0)+'%'}" /></span></div><span class="row-arrow">›</span>
        </RouterLink></div>
      </section>
      <section class="glass panel-box work-panel">
        <header><h2><Icon name="clipboard" />协同处置进展</h2>
          <div class="role-header-links">
            <span class="role-summary">{{roleNames[store.role]}} · 可办理常规事项 {{roleTaskCount}} 项</span>
            <RouterLink to="/operations/events?focus=tasks">查看岗位待办 <span>›</span></RouterLink>
          </div></header>
        <div class="summary-list"><RouterLink v-for="row in counts" :key="row.title" :to="row.to" class="work-row"><span class="work-icon"><Icon :name="row.icon" /></span><b>{{ row.title }}</b><strong>{{ row.value }} <small>项</small></strong><span class="work-note">（{{ row.note }}）</span></RouterLink></div>
      </section>
    </div>
    <footer class="overview-data-note"><span>V3.0业务定位 · {{ engineeringOpenCount }} 项P0工程事项待核查 · MOCK数据 {{ store.seed.referenceTime.slice(0, 10) }}</span><RouterLink to="/water/rainfall"><span>最近雨次末段储量</span> {{ fmt(latestStorage) }} m³ · 南北同一时刻</RouterLink></footer>

    <Teleport to="body">
      <Transition name="system-dialog">
        <div v-if="activeDetail" class="system-popover" :class="{ below: popoverBelow }" :style="popoverStyle" role="dialog" :aria-label="activeDetail.name + '系统基础信息'">
            <header class="system-dialog-head">
              <span class="system-dialog-icon"><Icon :name="activeDetail.icon" /></span>
              <div>
                <h2>{{ activeDetail.name }}系统</h2>
                <p><i :class="{ warning: activeDetail.warning }" />{{ activeDetail.state }} · {{ activeDetail.warning ? "存在运行关注" : "暂无高风险告警" }}</p>
              </div>
              <button type="button" class="system-dialog-close" aria-label="关闭" @click="closeSystem">×</button>
            </header>
            <div class="system-dialog-stats">
              <div><span>设备总数</span><strong>{{ activeDetail.devices }}<small>台</small></strong></div>
              <div><span>运行设备</span><strong class="good">{{ activeDetail.running }}<small>台</small></strong></div>
              <div><span>活动告警</span><strong :class="activeDetail.alarms ? 'risk' : 'good'">{{ activeDetail.alarms }}<small>条</small></strong></div>
            </div>
            <section class="system-dialog-readings">
              <h3>关键测点</h3>
              <p v-if="!activeDetail.readings.length" class="system-dialog-empty">暂无可用测点，进入详情查看完整档案。</p>
              <ul v-else>
                <li v-for="reading in activeDetail.readings" :key="reading.id">
                  <span>{{ reading.label }}</span>
                  <strong>{{ reading.value }} <small>{{ reading.unit }}</small></strong>
                  <em>{{ reading.source }}</em>
                </li>
              </ul>
            </section>
            <p class="system-dialog-note">仅为MOCK设备及测点；不代表真实运行正常、水质达标或工艺之间已连通。</p>
            <footer class="system-dialog-foot">
              <button type="button" class="system-dialog-cancel" @click="closeSystem">关闭</button>
              <RouterLink class="system-dialog-enter" :to="`/process/${activeDetail.id}`" @click="closeSystem">
                进入详情 <span>›</span>
              </RouterLink>
            </footer>
            <span class="system-popover-arrow" aria-hidden="true" />
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.fault-focus{position:absolute;z-index:5;top:3px;left:11px;width:min(238px,calc(100% - 24px));
  padding:4px 9px;border:1px solid #f1b671;border-radius:9px;
  color:#fff;background:linear-gradient(120deg,#273f51ef,#1c5265ea);
  box-shadow:0 7px 20px #001b3b4d;backdrop-filter:blur(9px);pointer-events:auto}
.fault-focus-heading{display:grid;gap:1px;min-width:0}
.fault-focus small{font-size:10px;line-height:14px;color:#ffddb4;letter-spacing:.02em}
.fault-focus strong{font-size:12px;line-height:16px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fault-focus-status{display:flex;gap:5px;flex-wrap:nowrap;font-size:10px;color:#deebf1;
  line-height:14px;margin:2px 0;white-space:nowrap}
.fault-focus nav{display:flex;gap:5px;margin-top:3px}
.fault-focus nav a{flex:1;text-align:center;padding:4px 3px;border:1px solid #94cce2a6;
  border-radius:5px;color:#e9faff!important;background:#ffffff15;font-size:10px;line-height:13px;white-space:nowrap}
.fault-focus nav a:hover{background:#ffffff35}
.hotspot.hotspot-risk{border-color:#ffc66c;box-shadow:0 0 0 2px #ec9f4b70,0 0 15px #f7b14ca6,inset 0 0 12px #86d9e580}
.hotspot.hotspot-risk:focus-visible{outline:3px solid #ffcc6a}
.map-evidence-link{position:absolute;z-index:4;top:9px;right:11px;max-width:60%;font-size:11px;padding:7px 10px;background:#053b5ec9;border:1px solid #83c7e699;color:#eaf8ff!important;border-radius:7px;text-decoration:none;white-space:normal}
.map-evidence-link:hover{background:#005b84e8}

.panorama { color:#080c3f; width:100%; display:grid; gap:12px; position:relative; font-family:"Microsoft YaHei","PingFang SC",sans-serif; }
/* V3 product hierarchy: three port-specific workstreams; keep established visual language. */
.needs-check{font-size:19px!important;color:#98764f!important}
.core-business{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.core-card{position:relative;min-width:0;padding:9px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto;row-gap:3px;align-items:center;border:1px solid #c9e2ed;border-radius:11px;background:linear-gradient(125deg,#eaf7fc,#fbfdff 65%,#eef9f6);box-shadow:0 3px 10px #1c71920c}
.core-no{grid-column:1/-1;font-size:10px;color:#5f91a8;font-weight:600}
.core-card strong{font-size:13px;color:#2b6683;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.core-card small{grid-column:1;grid-row:3;font-size:10px;color:#829ba9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.core-card b{grid-column:2;grid-row:2/4;color:#1d8ca7;font-size:11px;font-weight:600;margin-left:8px;white-space:nowrap}
.core-card:hover{border-color:#79bfd7;background:#eefaff}
.map-evidence-flag{position:absolute;z-index:3;bottom:9px;left:10px;background:#07354aaa;color:#e2f6ff;font-size:10px;padding:6px 10px;border:1px solid #80c2de99;border-radius:7px;pointer-events:none;letter-spacing:.02em}

h2,p { margin:0; } .panorama a { color:inherit; text-decoration:none; } .panorama a:focus-visible,.panorama button:focus-visible { outline:3px solid #006cff; outline-offset:2px; }
.glass { background:linear-gradient(120deg,#eef8ffd6,#e9f5ffc4 48%,#e3f1ffd2); border:1.5px solid #ffffffd9; border-radius:16px; box-shadow:0 2px 1px #75bfff8c,0 6px 16px #338be32e,inset 0 0 14px #ffffffc4; backdrop-filter:blur(18px) saturate(155%); -webkit-backdrop-filter:blur(18px) saturate(155%); min-width:0; }
.metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
.metric { min-height:92px; display:flex; align-items:center; gap:10px; padding:10px 12px; position:relative; overflow:hidden; }
.emblem { width:46px; height:46px; display:grid; place-items:center; flex:none; border-radius:50%; background:linear-gradient(140deg,#f3fcff,#c3e6ff); }
.emblem svg { width:33px; height:37px; filter:drop-shadow(0 2px 2px #fff); }
.metric h2 { font-size:15px; line-height:24px; font-weight:750; white-space:nowrap; }
.metric-main { flex:none; z-index:1; white-space:nowrap; }.metric strong { display:block; font-size:26px; line-height:32px; font-weight:750; letter-spacing:.5px; }
.metric strong small { font-size:16px; }.metric p { font-size:12px; line-height:23px; }.metric-water p b { margin-left:5px; font-size:13px; }
.metric-water .metric-main { padding-top:4px; }.metric-water h2 { line-height:23px; }.metric-water strong { line-height:31px; }.metric-water p { line-height:20px; }.metric-supply .metric-main,.metric-environment .metric-main,.metric-risks .metric-main { transform:translateY(-3px); }.sparkline { position:absolute; bottom:3px; right:0; width:82px; height:26px; opacity:.7; }
.metric-detail { flex:1; border-left:1px solid #b0daff; padding-left:10px; margin-left:1px; height:56px; display:flex; flex-direction:column; justify-content:space-between; white-space:nowrap; }
.metric-detail p { display:flex; gap:5px; align-items:baseline; font-size:12px; font-weight:500; }.metric-detail b { font-size:16px; margin-left:auto; }.metric-supply .metric-main { width:62px; }.metric-environment .metric-main { width:82px; }.metric-environment .metric-main strong { font-size:21px; }.metric-risks .metric-main { width:94px; }.metric-risks strong { font-size:29px; line-height:34px; }.metric-risks strong small { font-size:20px; }
.good { color:#079613!important; }.stable { color:#3c26fc; }.risk { color:#ff1705!important; }.missing { color:#6f8199; }
.middle { display:grid; grid-template-columns:minmax(0,1fr) minmax(300px,26%); gap:10px; }.map-wrap { min-width:0; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(280px,1fr) auto; }.map { position:relative; width:100%; min-height:280px; overflow:hidden; isolation:isolate; }
.map img { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; }
.flow-layer { position:absolute; inset:0; z-index:1; width:100%; height:100%; pointer-events:none; overflow:visible; mix-blend-mode:screen; }
@media(prefers-reduced-motion:reduce) { .flow-layer { display:none; } }
.map:after { content:""; position:absolute; top:0; left:0; right:0; height:22px; background:linear-gradient(#dcefffbb,transparent); pointer-events:none; }
.berth,.hotspot { z-index:2; position:absolute; transform:translate(-50%,-50%); white-space:nowrap; }.berth { top:8.4%; color:#fff; font-size:13px; font-weight:650; line-height:24px; height:26px; padding:0 10px; border:1px solid #d1f9ff; border-radius:10px; background:linear-gradient(#7be4ff,#0083fb 55%,#0091e5); box-shadow:0 0 6px #c3ffff; }.berth:after { content:""; position:absolute; left:44%; bottom:-5px; width:9px; height:9px; background:#0590ef; transform:rotate(45deg); }.first { left:31.4%; }.second { left:82.1%; }
.hotspot { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; height:46px; padding:5px 9px; font-family:inherit; cursor:pointer; color:#fff!important; border:1.5px solid #aeffff; border-radius:12px; background:linear-gradient(145deg,#438c9ef5,#00344cf5 50%,#00647cf5); box-shadow:0 0 9px #60f5ff,inset 0 0 13px #64d9ff; font-weight:650; font-size:13px; line-height:20px; text-shadow:0 1px 2px #004153; }
.hotspot>svg { width:26px; height:28px; flex:none; }.hotspot small { display:flex; justify-content:center; align-items:center; gap:5px; color:#24ff00; font-size:12px; line-height:18px; }.hotspot i { width:10px; height:10px; border-radius:100%; background:currentColor; box-shadow:0 0 4px currentColor; }.hotspot .warning { color:#ffd26d; }.hotspot:hover { filter:brightness(1.16); }.hotspot:after { content:""; position:absolute; bottom:-24px; height:22px; width:2px; background:linear-gradient(#37f6ff00,#37f6ff); }.hotspot:before { content:""; position:absolute; bottom:-27px; width:6px; height:6px; border-radius:50%; background:#c3ffff; box-shadow:0 0 8px 3px #00eaff; }
.process-strip { display:grid; grid-template-columns:172px repeat(6,minmax(0,1fr)); align-items:center; padding:7px 10px; position:relative; z-index:1; }.process-strip>strong { display:flex; align-items:center; gap:7px; font-size:15px; width:172px; flex:none; }.process-strip>strong svg { width:25px; height:25px; color:#007bff; }.process-strip a { display:flex; justify-content:center; gap:4px; align-items:flex-start; flex:1; min-width:0; height:34px; border-left:1px solid #85c4ff; font-size:12px; font-weight:600; white-space:nowrap; }.process-strip a svg { width:20px; height:22px; color:#0079ff; flex:none; }.process-strip small { display:block; color:#049514; text-align:center; font-size:12px; line-height:18px; }.process-strip .warning { color:#ba7800; }
.right-stack { display:grid; grid-template-rows:minmax(192px,1.12fr) minmax(170px,.88fr); gap:10px; }.panel-box { padding:10px; }.panel-box header { display:flex; justify-content:space-between; align-items:center; height:28px; margin:0 5px 7px; }.panel-box h2 { display:flex; align-items:center; gap:6px; font-size:16px; line-height:24px; font-weight:750; white-space:nowrap; }.panel-box h2>svg { width:23px; height:23px; color:#0074ff; flex:none; }.panel-box header>a { display:flex; align-items:center; gap:4px; white-space:nowrap; color:#0061ff; font-size:12px; font-weight:600; }.panel-box header>a span { font-size:24px; font-weight:400; line-height:20px; }
.events-panel { padding:10px 9px 8px; display:flex; flex-direction:column; }.events-panel header { flex:none; }.events-list { flex:1; display:flex; flex-direction:column; justify-content:space-evenly; background:linear-gradient(110deg,#f5fbff85,#f3faff45); border-radius:12px; padding:0 8px; min-height:110px; }.event { display:flex; align-items:flex-start; gap:9px; min-height:58px; padding:8px 0; border-bottom:1px solid #d7eafa; }.event:last-child { border:0; }.event-level { width:35px; height:25px; margin-top:2px; display:grid; place-items:center; font-size:13px; border-radius:6px; color:#fff; flex:none; background:linear-gradient(#ffbb54,#ff8a00); box-shadow:inset 0 1px 3px #fff6; }.event-level.critical { background:linear-gradient(#ff8277,#ff3732); }.event-level.info { background:linear-gradient(#7ac6ff,#209aff); }.event-text { flex:1; min-width:0; }.event strong,.event small { display:block; overflow:hidden; }.event strong { font-size:14px; line-height:21px; white-space:nowrap; text-overflow:ellipsis; }.event small { font-size:12px; line-height:18px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }.event time { font-size:11px; line-height:16px; margin-top:5px; flex:none; }.empty { padding:30px; text-align:center; color:#67839d; }
.resources { padding:10px 12px; }.resources header { margin:0 0 14px; }.resources h2 { font-size:15px; gap:5px; }.resources h2 small { font-size:11px; margin-left:0; }.resources h2>svg { width:24px; height:25px; }.resources header>a { font-size:12px; gap:1px; }.water-bar { height:21px; border:1px solid #e9fbff; border-radius:15px; overflow:hidden; display:flex; box-shadow:inset 0 2px 5px #fff; }.water-bar span { height:100%; box-shadow:inset 0 3px 6px #ffffff6b; }.shares { display:grid; grid-template-columns:repeat(3,1fr); text-align:center; margin:12px 0; }.shares>div+div { border-left:1px solid #b5dcff; }.shares span { display:flex; justify-content:center; gap:7px; align-items:center; font-size:13px; font-weight:600; height:21px; }.shares i { width:14px; height:14px; border-radius:4px; box-shadow:inset 0 1px 3px #fff9; }.shares strong { display:block; font-size:24px; line-height:30px; }.resource-foot { display:flex; align-items:center; border-top:1px solid #c7e4fa; padding-top:9px; gap:7px; white-space:nowrap; font-size:13px; }.resource-foot>svg { width:36px; height:36px; padding:5px; border-radius:50%; background:#fff; color:#04af00; }.resource-foot>strong { font-size:21px; }.resource-foot>span { margin-left:auto; font-weight:650; }.resource-foot small { font-size:12px; }
.bottom { display:grid; grid-template-columns:1.05fr 1fr 1fr; gap:10px; }.bottom .panel-box { min-height:196px; padding:9px 10px; }.bottom header { margin-bottom:7px; }.trend-panel header { margin-right:4px; margin-left:7px; }.trend-panel h2 { font-size:16px; gap:5px; }.trend-panel h2 svg { width:23px; }.period-switch { display:flex; align-items:center; height:27px; border:1px solid #bcddff; border-radius:16px; background:linear-gradient(#f8fdff,#d9edff); }.period-switch button { border:0; border-radius:15px; width:29px; padding:0; height:25px; cursor:pointer; color:#080e42; background:none; line-height:25px; font-size:13px; }.period-switch button.selected { color:#fff; background:linear-gradient(#67d8ff,#0071ff 70%,#008cff); box-shadow:0 1px 3px #58aaff; }
.summary-list { background:linear-gradient(125deg,#f6fcffc9,#f5fbff87); border-radius:12px; overflow:hidden; padding:3px 9px; box-shadow:0 4px 8px #b5dfff44; }.health-row { display:flex; align-items:center; min-height:52px; gap:7px; border-bottom:1px solid #d1e7fa; }.health-row:last-child { border:0; }.health-row>svg { width:39px; height:36px; flex:none; }.pump-code { font-size:13px; flex:none; width:48px; }.pump-name { font-size:13px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.health-score { width:100px; flex:none; }.health-score>div { display:flex; align-items:center; justify-content:center; gap:7px; line-height:28px; }.health-score strong { font-size:20px; }.health-score strong small { font-size:12px; margin-left:5px; }.health-score b { font-size:12px; }.health-score.risk b { color:#ff6200; }.health-track { height:8px; display:block; border-radius:6px; background:#e9eae9; overflow:hidden; }.health-track i { display:block; height:100%; background:linear-gradient(90deg,#ff1704,#ffdf51); border-radius:5px; }.health-score.good i { background:linear-gradient(90deg,#00aa1b,#b1ed9a); }.row-arrow { font-size:30px; line-height:1; margin-left:3px; }
.work-row { display:flex; align-items:center; gap:8px; min-height:51px; border-bottom:1px solid #d1e7fa; }.work-row:last-child { border:0; }.work-icon { width:36px; height:36px; flex:none; border-radius:8px; background:linear-gradient(145deg,#f4fcff,#d3eaff); padding:5px; color:#007cff; }.work-icon svg { width:26px; height:26px; }.work-row>b { font-size:14px; min-width:72px; flex:none; }.work-row>strong { font-size:21px; color:#04146c; white-space:nowrap; }.work-row>strong small { font-size:13px; margin-left:3px; }.work-note { font-size:12px; white-space:nowrap; margin-left:auto; }
.overview-data-note { display:flex; flex-wrap:wrap; gap:4px 12px; padding:0 3px; justify-content:space-between; color:#557b9f; font-size:11px; line-height:16px; }.overview-data-note a { color:#557b9f; }

/* Reflow keeps text legible when the browser is resized. */
@media(max-width:1500px) {
  .process-strip { grid-template-columns:repeat(6,minmax(0,1fr)); gap:7px 0; }.process-strip>strong { width:auto; grid-column:1/-1; }.process-strip a { border-left:0; }
  .metric-detail { padding-left:8px; }.metric-detail p { gap:3px; }.metric { gap:8px; }.metric-risks .metric-main { width:90px; }
  .resources h2 small { display:none; }.resources header { margin-bottom:12px; }
  .resource-foot { gap:5px; flex-wrap:wrap; }.resource-foot>svg { width:28px; height:28px; }.resource-foot>span { font-size:12px; }
  .health-row { flex-wrap:nowrap; padding:4px 0; gap:5px; }.health-row>svg { width:30px; height:30px; }.health-row .pump-name { min-width:0; }.pump-code { width:44px; }.health-score { width:92px; margin-left:auto; }.row-arrow { font-size:22px; }
  .work-row { flex-wrap:nowrap; padding:4px 0; gap:6px; }.work-row>b { min-width:64px; }.work-note { margin-left:auto; overflow:hidden; text-overflow:ellipsis; }
  .trend-panel header { flex-wrap:wrap; height:auto; gap:6px; }
}
@media(max-width:1240px) {
  .metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }.metric { gap:12px; }.metric-detail { margin-left:auto; max-width:55%; }
  .middle { grid-template-columns:minmax(0,1fr); }.map-wrap { grid-template-rows:auto auto; }.map { aspect-ratio:1048 / 379; min-height:280px; }
  .right-stack { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:auto; }.right-stack>.panel-box { min-height:192px; }
  .bottom { grid-template-columns:repeat(2,minmax(0,1fr)); }.trend-panel { grid-column:1/-1; }.bottom .panel-box { min-height:230px; }
  .trend-panel header { flex-wrap:nowrap; }
}
@media(max-width:1000px) { .process-strip { grid-template-columns:repeat(3,minmax(0,1fr)); }.resources header { flex-wrap:wrap; height:auto; gap:4px; } }
@media(max-width:840px) {
  .metric { flex-wrap:wrap; }.metric-detail { flex-basis:100%; max-width:none; margin:0; border-left:0; border-top:1px solid #c4e2fa; padding:6px 0 0; height:auto; gap:2px; }
}
@media(max-width:760px) {
  .metric { padding:10px; gap:8px; flex-wrap:wrap; }.metric-detail { flex-basis:100%; max-width:none; margin:0; border-left:0; border-top:1px solid #c4e2fa; padding:6px 0 0; height:auto; gap:2px; }
  .metric strong { font-size:24px; }.metric-environment .metric-main strong { font-size:20px; }.metric h2 { font-size:14px; }.emblem { width:39px; height:39px; }.emblem svg { width:29px; height:31px; }.metric-risks .metric-main { width:auto; }
  .bottom,.right-stack { grid-template-columns:minmax(0,1fr); }.trend-panel { grid-column:auto; }.right-stack>.panel-box { min-height:180px; }.bottom .panel-box { min-height:220px; }
  .health-row,.work-row { flex-wrap:nowrap; }.overview-data-note { font-size:10px; }
}
@media(max-width:960px) {.core-business{grid-template-columns:1fr}.core-card strong,.core-card small{white-space:normal}}
@media(max-width:540px) {
  .fault-focus{top:8px;left:7px;width:min(228px,calc(100% - 18px));padding:6px 8px}
  .fault-focus-status{display:none}
  .fault-focus nav{margin-top:4px}
  .fault-focus strong{font-size:11px}
  .panorama { gap:10px; }.metrics { gap:8px; }.metric h2 { font-size:13px; }.metric-main { flex:1; }.metric-main strong { white-space:nowrap; }.metric-water .emblem { display:none; }
  .sparkline { width:60px; opacity:.4; }.metric-detail p { font-size:12px; }.metric-detail b { font-size:14px; }
  .map { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); aspect-ratio:auto; min-height:0; padding-top:51%; gap:8px; overflow:visible; }.map img { width:100%; height:auto; top:0; border-radius:12px; }.flow-layer { display:none; }.map:after { display:none; }
  .hotspot { position:relative; left:auto!important; top:auto!important; transform:none; height:48px; border-radius:9px; font-size:12px; padding:5px; gap:5px; }.hotspot:before,.hotspot:after { display:none; }.hotspot>svg { width:24px; height:26px; }.hotspot small { font-size:12px; }.berth { top:22px; font-size:12px; }.process-strip { display:none; }
  .panel-box header { margin-inline:0; }.panel-box h2,.trend-panel h2 { font-size:15px; }.panel-box h2>svg { width:21px; height:21px; }.trend-panel h2 { gap:3px; }.period-switch button { width:25px; }
  .health-row>svg { width:32px; }.pump-code { width:43px; font-size:12px; }.pump-name { font-size:12px; }.health-row .pump-name { min-width:0; }.health-score { width:88px; }.health-score strong { font-size:18px; }.row-arrow { font-size:24px; }
  .work-icon { width:30px; height:30px; padding:4px; }.work-icon svg { width:22px; height:22px; }.work-row>b { min-width:70px; font-size:13px; }.work-note { font-size:11px; }
}

/* Allocate vertical space independently of width and font size. The minimum
   keeps controls readable in very short windows, where the main area scrolls. */
@media(min-width:1241px) {
  .panorama {
    flex:1 0 632px;
    min-height:632px;
    grid-template-rows:clamp(84px,11dvh,104px) auto minmax(305px,2fr) minmax(176px,0.72fr) auto;
    gap:8px;
  }
  .metrics,.middle,.bottom { min-height:0; }
  .metric { min-height:0; padding:6px 10px; gap:8px; }
  .metric-water .metric-main { padding-top:0; }
  .metric-water h2 { line-height:21px; }
  .metric-water strong { line-height:29px; }
  .metric-water p { line-height:18px; }
  .emblem { width:40px; height:40px; }
  .metric-detail { height:auto; gap:4px; padding-left:6px; }
  .metric-detail p { white-space:normal; line-height:18px; }
  .map-wrap { min-height:0; grid-template-rows:minmax(0,1fr) auto; }
  .map { min-height:0; }
  .right-stack { min-height:0; grid-template-rows:minmax(0,1fr) minmax(0,1fr); gap:8px; }
  .right-stack>.panel-box { min-height:0; overflow-y:auto; scrollbar-width:thin; }
  .bottom .panel-box { min-height:0; display:flex; flex-direction:column; }
  .panel-box header { flex-shrink:0; }
  .bottom .summary-list { min-height:0; overflow-y:auto; scrollbar-width:thin; }
  .health-row,.work-row { min-height:41px; }
  .overview-data-note { flex-wrap:nowrap; }
}
@media(min-width:1601px) {
  .middle { grid-template-columns:minmax(0,1fr) minmax(340px,25%); }
}
@media(min-width:1241px) and (max-height:760px) {
  .panorama { flex-basis:600px; min-height:600px; grid-template-rows:clamp(80px,10dvh,96px) auto minmax(300px,2fr) minmax(160px,0.7fr) auto; }
  .health-row,.work-row { min-height:38px; }
  .bottom .panel-box { padding-block:7px; }
}
@media(min-width:1241px) and (max-height:820px) {
  .panel-box { padding:7px 9px; }
  .panel-box header { height:24px; margin-bottom:5px; }
  .trend-panel header { flex-wrap:nowrap; }
  .events-panel { padding:6px 9px; }
  .events-list { min-height:0; padding-inline:4px; }
  .event { min-height:0; padding:5px 0; }
  .event small { display:block; white-space:nowrap; text-overflow:ellipsis; line-height:17px; }
  .event strong,.event small { line-height:17px; }
  .event time { margin-top:2px; }
  .resources { padding:6px 10px; }
  .resources header { margin-bottom:6px; }
  .water-bar { height:15px; }
  .shares { margin:7px 0; }
  .shares span { height:18px; }
  .shares strong { font-size:22px; line-height:26px; }
  .resource-foot { padding-top:5px; gap:4px; flex-wrap:nowrap; }
  .resource-foot>svg { width:26px; height:26px; }
  .resource-foot>strong { font-size:20px; }
  .process-strip { padding-block:4px; gap:3px 0; }
  .health-row,.work-row { padding-block:3px; }
  .hotspot:after { height:12px; bottom:-14px; }
  .hotspot:before { bottom:-17px; }
}

/* System popover: anchored above the clicked process hotspot. */
.system-popover { position:fixed; z-index:1500; overflow-y:auto; padding:12px 13px 10px; border:1.5px solid #ffffffd9; border-radius:16px; background:linear-gradient(135deg,#f6fcfff2,#e6f4ffdf 55%,#eaf7ffeb); backdrop-filter:blur(24px) saturate(170%); -webkit-backdrop-filter:blur(24px) saturate(170%); box-shadow:0 18px 44px #062f5547,inset 0 0 20px #ffffffb3; color:#080c3f; }
.system-popover-arrow { position:absolute; left:50%; bottom:-8px; width:16px; height:16px; margin-left:-8px; background:#e9f6ffe8; border-right:1.5px solid #ffffffd9; border-bottom:1.5px solid #ffffffd9; transform:rotate(45deg); }
.system-popover.below .system-popover-arrow { top:-8px; bottom:auto; border:0; border-left:1.5px solid #ffffffd9; border-top:1.5px solid #ffffffd9; }
.system-dialog-head { display:flex; align-items:center; gap:12px; }
.system-dialog-icon { width:40px; height:40px; flex:none; display:grid; place-items:center; border-radius:12px; background:linear-gradient(145deg,#e6f8ff,#b9e2ff); box-shadow:inset 0 0 10px #fff; }
.system-dialog-icon svg { width:25px; height:27px; color:#0074ff; }
.system-dialog-head h2 { font-size:16px; line-height:22px; font-weight:750; }
.system-dialog-head p { display:flex; align-items:center; gap:6px; font-size:11px; line-height:17px; color:#3c6b95; }
.system-dialog-head p i { width:9px; height:9px; border-radius:50%; background:#12b76a; box-shadow:0 0 6px #12b76a; }
.system-dialog-head p i.warning { background:#ff9f0a; box-shadow:0 0 6px #ff9f0a; }
.system-dialog-close { margin-left:auto; align-self:flex-start; width:26px; height:26px; border:1px solid #c4e2fb; border-radius:50%; background:#ffffffb8; color:#2c5f8a; font-size:17px; line-height:1; cursor:pointer; }
.system-dialog-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:10px 0 9px; }
.system-dialog-stats>div { padding:6px 8px; border:1px solid #ffffff; border-radius:10px; background:#ffffffa8; box-shadow:inset 0 0 10px #ffffff8c; text-align:center; }
.system-dialog-stats span { display:block; font-size:10px; line-height:15px; color:#52779a; }
.system-dialog-stats strong { font-size:18px; line-height:24px; }
.system-dialog-stats strong small { margin-left:3px; font-size:10px; }
.system-dialog-readings h3 { font-size:12px; line-height:18px; font-weight:700; color:#123f6b; }
.system-dialog-readings ul { list-style:none; margin:4px 0 0; padding:0; border-radius:10px; overflow:hidden; background:#ffffff96; }
.system-dialog-readings li { display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid #d8ecfb; font-size:11px; }
.system-dialog-readings li:last-child { border:0; }
.system-dialog-readings li>span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.system-dialog-readings li>strong { font-size:13px; }
.system-dialog-readings li>strong small { font-size:10px; color:#5a7897; }
.system-dialog-readings li>em { font-style:normal; font-size:9px; color:#7a93ab; }
.system-dialog-empty { padding:10px; border-radius:10px; background:#ffffff96; font-size:11px; color:#5a7897; }
.system-dialog-note { margin:8px 0 0; font-size:10px; line-height:15px; color:#5f7f9d; }
.system-dialog-foot { display:flex; justify-content:flex-end; gap:8px; margin-top:9px; }
.system-dialog-cancel { height:30px; padding:0 16px; border:1px solid #b9d9f5; border-radius:15px; background:#ffffffe0; color:#215b8c; font-size:12px; cursor:pointer; }
.system-dialog-enter { display:inline-flex; align-items:center; gap:4px; height:30px; padding:0 16px; border-radius:15px; background:linear-gradient(#67d8ff,#0071ff 70%,#008cff); box-shadow:0 3px 9px #58aaff66; color:#fff!important; font-size:12px; font-weight:650; }
.system-dialog-enter-active,.system-dialog-leave-active { transition:opacity .16s ease; }
.system-dialog-enter-from,.system-dialog-leave-to { opacity:0; }

/* Green port card: type sizes follow the card width (cqw) to match the design at any size. */
.green-port { container-type:inline-size; padding:8px 8px 5px; display:flex; flex-direction:column; gap:6px; overflow:hidden; background:linear-gradient(160deg,#f3fff8,#d9f9e6); border-color:#b9efc8; }
.green-port-art { position:relative; flex:1 1 auto; min-height:96px; background:url("../assets/dasboard/lvse.png") center top/100% 100% no-repeat; }
.green-port .green-port-art h2 { position:absolute; left:26%; right:3%; top:26%; height:32%; display:flex; align-items:center; justify-content:center; font-size:clamp(20px,9.4cqw,42px); line-height:1; color:#fff; letter-spacing:.04em; white-space:nowrap; text-shadow:0 2px 6px #00602a,0 0 14px #1fd268; }
.green-port-art>span { position:absolute; left:22%; right:18%; top:59%; height:17%; display:flex; align-items:center; justify-content:center; font-size:clamp(11px,4cqw,19px); line-height:1; font-weight:800; color:#0f7a2c; white-space:nowrap; }
.green-port-metrics { flex:none; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
.green-metric { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:2px 5px; padding:5px 6px 4px; border:1px solid #ffffff; border-radius:10px; background:#ffffffe0; backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); box-shadow:0 3px 8px #1f8a4a24; }
.green-metric>svg { width:clamp(14px,3.6cqw,18px); height:auto; color:#0a9b46; }
.green-metric>span { font-size:clamp(10px,2.9cqw,13px); line-height:1.35; color:#2f6b4b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.green-metric>strong { grid-column:1/-1; text-align:center; font-size:clamp(15px,5cqw,23px); line-height:1.25; color:#063f1f; white-space:nowrap; font-variant-numeric:tabular-nums; }
.green-metric>strong small { margin-left:2px; font-size:.55em; color:#3a6b4d; }
.green-metric>em { grid-column:1/-1; text-align:center; font-style:normal; font-size:clamp(9px,2.4cqw,11px); line-height:1.35; color:#4a7a5d; }
.green-source { flex:none; margin:0; text-align:center; font-size:clamp(9px,2.2cqw,11px); line-height:1.4; color:#2c6a45; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
@media(max-width:1240px) {
  .right-stack>.green-port { min-height:0; }
  .green-port-art { flex:none; aspect-ratio:1020 / 540; }
}
@media(min-width:1241px) and (max-height:820px) {
  .green-port { padding:6px 6px 4px; gap:4px; }
  .green-port-art>span { display:none; }
  .green-port-metrics { gap:4px; }
  .green-metric { padding:3px 5px 2px; }
}

/* Unified type scale for the overview page.
   标题 16 / 主行 14 / 次要 12 / 注释 11 / 行内数值 20 / 顶部 KPI 24. */
.panorama { --t-panel:16px; --t-row:14px; --t-sub:12px; --t-note:11px; --t-num:20px; --t-kpi:24px; }
.panel-box h2,.trend-panel h2,.process-strip>strong { font-size:var(--t-panel); }
.metric h2 { font-size:var(--t-row); }
.metric strong { font-size:var(--t-kpi); }
.metric strong small { font-size:14px; }
.metric-risks strong { font-size:var(--t-kpi); line-height:32px; }
.metric-risks strong small { font-size:14px; }
.metric-environment .metric-main strong { font-size:21px; }
.health-score strong,.work-row>strong { font-size:var(--t-num); }
.health-score strong small,.work-row>strong small { font-size:12px; }
.work-row>b { font-size:var(--t-row); }
.pump-code,.pump-name,.event strong,.process-strip a,.hotspot { font-size:var(--t-row); }
.event small,.process-strip small,.metric p,.metric-detail p,.work-note { font-size:var(--t-sub); }
.metric-detail b { font-size:15px; }
.event time,.overview-data-note,.hotspot small { font-size:var(--t-note); }
.bottom .panel-box header { height:30px; }
.bottom .health-row,.bottom .work-row { min-height:44px; }
.health-score.missing strong { font-size:17px; white-space:nowrap; }
.health-score.missing>div { gap:5px; }
</style>
<style scoped>
.scene-tools { display:flex; align-items:center; gap:8px; padding:6px 10px; color:#24516d; background:#eef8ff; font-size:12px; }
/* The editable-hotspot toolbar adds a real grid row. Give it an explicit
   track; never let it overflow the middle section and cover bottom controls.
   In short laptop windows the main area scrolls instead of allowing overlap. */
.map-wrap:has(.scene-tools) { grid-template-rows:auto minmax(280px,1fr) auto; }
@media(min-width:1241px){
  .panorama{flex:1 0 792px;min-height:792px;grid-template-rows:clamp(84px,11dvh,104px) auto minmax(405px,2fr) minmax(176px,0.72fr) auto}
  .map-wrap:has(.scene-tools){min-height:0}
}

.scene-tools button,.scene-tools select { padding:4px 8px; border:1px solid #9cc7e8; border-radius:6px; background:#fff; color:#165685; cursor:pointer; }
.scene-device-hotspot { position:absolute; z-index:5; transform:translate(-50%,-50%); border:1px solid #b6f7ff; border-radius:8px; padding:5px 8px; background:#0b638c; color:white; box-shadow:0 0 8px #3bc9e8; cursor:pointer; font-weight:700; }
</style>
