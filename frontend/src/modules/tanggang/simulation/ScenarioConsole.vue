<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage,ElMessageBox} from 'element-plus'
import {SCENARIOS,SCENARIO_IDS,type ScenarioId} from './engine'
import {useScenarioStore} from './store'
const router=useRouter()
const store=useScenarioStore()
const selected=ref<ScenarioId>('peak')
watch(()=>store.consoleOpen,(open)=>{if(open&&store.activeId)selected.value=store.activeId})
const definition=computed(()=>SCENARIOS[selected.value])
const result=computed(()=>store.result)
async function run(){
  try{
    store.start(selected.value)
    ElMessage({type:'info',message:'已进入演示情景：所有业务视图按同一组SIM数据联动，真实数据未更改'})
  }catch(e){ElMessage.error(e instanceof Error?e.message:'启动失败')}
}
function exit(){store.stop();ElMessage.info('情景已退出，演示数据不再在业务页面显示')}
function go(path:string){store.closeConsole();void router.push(path)}
async function reset(){
  if(!store.running)return
  try{
    await ElMessageBox.confirm('退出模拟情景？演示数据将从页面撤除，正式业务数据不会改变。','退出情景',{type:'warning'})
    exit()
  }catch{return}
}
const nav=[
  {title:'大机供水保障',path:'/port/water/supply',desc:'用水负荷、供水缺口、储量趋势'},
  {title:'主动智能监护',path:'/port/operations/monitor',desc:'多参数联判、模拟事件证据'},
  {title:'雨水调蓄风险',path:'/port/water/rain-risk',desc:'雨量、收集库容、溢流风险'},
]
</script>
<template>
  <div class="tg-sim-global" aria-label="统一情景推演入口">
    <button type="button" class="tg-sim-launch" :class="{active:store.running}"
      :aria-label="store.running?'情景推演运行中，打开统一控制台':'打开统一情景推演控制台'"
      @click="store.openConsole()">
      <span class="tg-sim-launch-icon">◇</span>
      <span v-if="store.running"><strong>SIM 推演中</strong><small>{{store.activeScenario?.title}} · {{store.result?.events.length||0}}条模拟线索</small></span>
      <span v-else><strong>情景推演</strong><small>统一入口 · 跨页面联动</small></span>
    </button>
    <el-drawer v-model="store.consoleOpen" size="min(580px, 94vw)" direction="rtl"
      title="全系统情景推演控制台" append-to-body custom-class="tg-sim-drawer" :with-header="true">
      <div class="tg-sim-console">
        <div class="tg-sim-warning">
          <strong>SIM · 独立演示环境</strong>
          <p>所有数字为规则化演示假设，非唐港实时测量、实际库容或实际管网能力。只影响当前浏览器的视图，不写设备、告警、工单和PLC。</p>
        </div>
        <div class="tg-sim-title"><b>① 选择统一推演情景</b><span>业务页面不再单独调整用水量</span></div>
        <div class="tg-sim-presets" role="group" aria-label="预置模拟情景">
          <button v-for="id in SCENARIO_IDS" :key="id" type="button" class="tg-sim-preset"
            :class="{picked:selected===id,live:store.activeId===id}" :aria-pressed="selected===id"
            @click="selected=id">
            <span class="tg-sim-preset-head"><b>{{SCENARIOS[id].title}}</b>
              <span v-if="store.activeId===id" class="tg-sim-live-mark">当前执行</span>
              <small v-else>{{SCENARIOS[id].category}}</small>
            </span>
            <span>{{SCENARIOS[id].subtitle}}</span>
          </button>
        </div>
        <p class="tg-sim-summary">{{definition.summary}}</p>
        <div class="tg-sim-actions">
          <el-button type="primary" @click="run">{{store.running?'应用选定情景':'启动情景推演'}}</el-button>
          <el-button v-if="store.running" plain @click="reset">退出模拟</el-button>
        </div>
        <div class="tg-sim-title"><b>② 本轮联动结果</b>
          <span :class="store.running?'tg-sim-status active':'tg-sim-status'">{{store.running?'SIM 运行中':'未启动'}}</span>
        </div>
        <template v-if="store.running&&result">
          <div class="tg-sim-metrics">
            <div><small>模拟用水需求</small><strong>{{result.demandedM3h}}<i>m³/h</i></strong></div>
            <div><small>可分配供水</small><strong>{{result.deliveredM3h}}<i>m³/h</i></strong></div>
            <div><small>假设供水缺口</small><strong :class="{warn:result.shortageM3h>0}">{{result.shortageM3h}}<i>m³/h</i></strong></div>
          </div>
          <div v-if="result.events.length" class="tg-sim-events">
            <div v-for="event in result.events" :key="event.id" class="tg-sim-event">
              <span class="tg-sim-chip" :class="event.level">{{event.id}}</span>
              <div><b>{{event.title}}</b><small>{{event.evidence}}</small></div>
              <button type="button" @click="go(event.path)">查看关联页</button>
            </div>
          </div>
          <p v-else class="tg-sim-clean">当前演示假设下未触发已定义的风险规则，不代表现场安全。</p>
        </template>
        <div v-else class="tg-sim-empty">请选择情景并点击“启动情景推演”。其他页面不会显示模拟结果。</div>
        <div class="tg-sim-title"><b>③ 查看跨页面联动</b><span>统一数据 · 不重复填写</span></div>
        <div class="tg-sim-links">
          <button v-for="item in nav" :key="item.path" type="button" @click="go(item.path)">
            <b>{{item.title}}</b><span>{{item.desc}}</span><i>打开 →</i>
          </button>
        </div>
        <div class="tg-sim-foot">
          <b>联动边界</b>
          <p>当前三个业务页直接订阅同一套内存数据；三维场景可订阅 tanggang:scenario-visual 展示模式切换，但未经工程确认的管线不能自动假定相连。真实告警和工单仍由原业务系统独立管理。</p>
        </div>
      </div>
    </el-drawer>
  </div>
</template>
<style>
/* 独立全局入口，固定在右下角；避开原AI机器人默认底部120px以上区域。 */
.tg-sim-global{position:fixed;right:22px;bottom:22px;z-index:2600;pointer-events:none}
.tg-sim-launch{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:10px 15px;
  border:1px solid rgba(255,255,255,.85);border-radius:14px;cursor:pointer;
  background:linear-gradient(135deg,rgba(246,252,255,.88),rgba(214,235,248,.83));
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  box-shadow:0 7px 26px rgba(25,75,118,.22);font-family:inherit;text-align:left;color:#28526b}
.tg-sim-launch.active{border-color:#f1c58b;background:linear-gradient(145deg,rgba(255,250,236,.91),rgba(248,235,215,.83))}
.tg-sim-launch:hover{transform:translateY(-2px);box-shadow:0 10px 32px rgba(20,87,139,.23)}
.tg-sim-launch span:not(.tg-sim-launch-icon){display:flex;flex-direction:column;gap:2px}
.tg-sim-launch strong{font-size:13px;font-weight:750}.tg-sim-launch small{font-size:10px;opacity:.73}
.tg-sim-launch-icon{font-size:21px;color:#1f89ac}
.tg-sim-drawer{--el-drawer-padding-primary:20px}
.tg-sim-drawer .el-drawer__header{margin-bottom:0;border-bottom:1px solid #e2eaf0;padding-bottom:16px}
.tg-sim-drawer .el-drawer__body{padding:0}
.tg-sim-console{height:100%;overflow:auto;padding:18px 20px 26px;font-family:inherit;color:#284a62;background:linear-gradient(145deg,#f5fafd,#edf5fa)}
.tg-sim-warning{background:#fff7e9;border:1px solid #f2ddba;border-radius:12px;padding:13px 15px;font-size:12px}
.tg-sim-warning strong{color:#9b6924}.tg-sim-warning p{margin:4px 0 0;color:#826c4d;line-height:1.7}
.tg-sim-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:20px 0 11px}
.tg-sim-title b{font-size:15px}.tg-sim-title>span{color:#7c93a4;font-size:11px;text-align:right}
.tg-sim-presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.tg-sim-preset{display:flex;flex-direction:column;gap:7px;padding:12px;text-align:left;font-family:inherit;
 background:rgba(255,255,255,.75);border:1px solid #d8e5ee;border-radius:11px;cursor:pointer;color:#2f5469}
.tg-sim-preset.picked{border-color:#2b98c0;background:#ebf7fc;box-shadow:0 0 0 1px #7abbd9 inset}
.tg-sim-preset.live{box-shadow:inset 0 0 0 1px #e7be80}
.tg-sim-preset-head{display:flex;justify-content:space-between;align-items:center;gap:5px}
.tg-sim-preset b{font-size:13px}.tg-sim-preset span:not(.tg-sim-preset-head){font-size:11px;color:#8299a7}
.tg-sim-preset small{font-size:10px;color:#7997a9}
.tg-sim-live-mark{font-size:10px;color:#ae7636!important}
.tg-sim-summary{font-size:12px;line-height:1.65;color:#658299;margin:10px 0}
.tg-sim-actions{display:flex;align-items:center;gap:7px;margin:12px 0 19px}
.tg-sim-status.active{color:#a9752d}.tg-sim-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.tg-sim-metrics>div{background:rgba(255,255,255,.8);border:1px solid #dbeaf0;border-radius:11px;padding:12px 10px}
.tg-sim-metrics small{display:block;color:#7793a1;font-size:10px;margin-bottom:6px}
.tg-sim-metrics strong{font-size:22px;color:#267ea3;font-variant-numeric:tabular-nums}
.tg-sim-metrics strong.warn{color:#d48938}.tg-sim-metrics i{font-size:10px;font-style:normal;margin-left:3px;font-weight:500}
.tg-sim-events{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.tg-sim-event{display:flex;gap:9px;padding:11px;background:rgba(255,255,255,.8);
  border:1px solid #dfebf0;border-radius:10px;align-items:flex-start}
.tg-sim-chip{white-space:nowrap;border-radius:6px;font-size:9px;padding:3px 5px;background:#edf1f5;color:#718798}
.tg-sim-chip.critical{background:#fff0e8;color:#b95a32}.tg-sim-chip.attention{background:#fff5e4;color:#a87822}
.tg-sim-event>div{flex:1;min-width:0}.tg-sim-event b{font-size:12px}
.tg-sim-event small{display:block;font-size:11px;line-height:1.55;color:#7b94a5;margin-top:4px}
.tg-sim-event>button{font-size:11px;color:#2489b2;border:0;background:transparent;cursor:pointer;white-space:nowrap}
.tg-sim-empty,.tg-sim-clean{padding:16px;border-radius:10px;background:#f0f7fa;color:#78919f;font-size:12px}
.tg-sim-links{display:flex;flex-direction:column;gap:8px}
.tg-sim-links button{display:grid;grid-template-columns:120px 1fr 52px;gap:7px;align-items:center;padding:13px;
 text-align:left;border:1px solid #dce9ef;border-radius:10px;background:rgba(255,255,255,.75);cursor:pointer;color:#31576b}
.tg-sim-links button:hover{border-color:#80bad2;background:#f5fbff}
.tg-sim-links b{font-size:12px}.tg-sim-links span{font-size:11px;color:#8299a7}
.tg-sim-links i{font-size:11px;font-style:normal;color:#2281a9;text-align:right}
.tg-sim-foot{margin:19px 0 0;font-size:11px;color:#7b92a2;line-height:1.65}
.tg-sim-foot b{color:#648393}.tg-sim-foot p{margin:3px 0}
@media(max-width:680px){.tg-sim-global{right:12px;bottom:12px}.tg-sim-launch{padding:9px 11px}
 .tg-sim-links button{grid-template-columns:1fr 1fr}.tg-sim-links i{grid-column:2}
}
@media(prefers-reduced-motion:reduce){.tg-sim-launch{transition:none}.tg-sim-launch:hover{transform:none}}
</style>
