<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SiteRegion, RegionDevice } from './types/regions'

const props = defineProps<{
  regions: SiteRegion[]
  selectedRegionId: string
  navOpen: boolean
  systemName?: string
  systemIntro?: string
  systemDisclaimer?: string
}>()
const emit = defineEmits<{
  selectRegion: [id: string]
  toggleNav: []
}>()
const deviceId = ref('')
const selectedRegion = computed(() => props.regions.find(r => r.id === props.selectedRegionId))
const selectedDevice = computed(() => selectedRegion.value?.devices.find(d => d.id === deviceId.value))
watch(() => [props.selectedRegionId,props.systemName], () => { deviceId.value = '' })
function regionName(id:string) { return props.regions.find(r=>r.id===id)?.name || id }
function choose(id:string) { deviceId.value=''; emit('selectRegion', id) }
function chooseDevice(device:RegionDevice) { deviceId.value=device.id }
</script>

<template>
  <div class="region-overlay" aria-label="主要区域及设备设计信息">
    <aside v-if="navOpen" class="region-nav">
      <header class="nav-header">
        <div><small class="kicker">{{systemName?'SYSTEM AREAS':'AREA DIRECTORY'}}</small><strong>{{systemName?'涉及区域':'主要区域'}}</strong></div>
        <span>{{ regions.length }} 区域</span>
      </header>
      <div class="nav-items">
        <button v-for="(region,index) in regions" :key="region.id"
          class="nav-item" :class="{active:region.id===selectedRegionId}"
          @click="choose(region.id)">
          <span class="nav-index">{{ String(index+1).padStart(2,'0') }}</span>
          <span class="nav-copy">
            <strong>{{ region.name }}</strong>
            <small>{{ region.category }} · {{ region.devices.length }}类设备</small>
          </span>
        </button>
      </div>
      <footer class="nav-note">设备为设计清单，尚不是安装台账</footer>
    </aside>

    <aside v-if="selectedRegion" class="region-card" data-testid="region-detail">
      <header class="region-card-header">
        <div>
          <small class="kicker">{{systemName?'BUSINESS SYSTEM / AREA':'REGION / EQUIPMENT'}}</small>
          <h3>{{ selectedRegion.name }}</h3>
          <p>{{ selectedRegion.subtitle }}</p>
        </div>
        <button class="nav-toggle" @click="emit('toggleNav')">{{ navOpen?'收起目录':'区域目录' }}</button>
      </header>
      <div class="region-scroll">
        <div v-if="systemName&&!selectedDevice" class="business-context">
          <strong>{{systemName}} <span>业务视图</span></strong>
          <p>{{systemIntro}}</p>
          <small>展示范围依据原CAD与设计规格；未连接在线设备数据</small>
        </div>
        <template v-if="selectedDevice">
          <div class="back"><button @click="deviceId=''">← 返回区域设备清单</button><span>设计设备</span></div>
          <h4 class="device-name">{{ selectedDevice.name }}</h4>
          <div class="notconnected">点位未核实 · 实时数据未接入</div>
          <dl class="device-details">
            <dt>设计配置</dt><dd>{{ selectedDevice.designQuantity }}</dd>
            <dt>设计依据</dt><dd>{{ selectedDevice.specSection }}</dd>
            <dt>设备类别ID</dt><dd>{{ selectedDevice.id }}</dd>
            <dt>物理位置</dt><dd>未取得单设备CAD点位</dd>
            <dt>运行状态</dt><dd>未接入</dd>
          </dl>
          <h5>预期关联数据字段</h5>
          <div class="metric-rows">
            <div v-for="field in selectedDevice.dataFields" :key="field" class="metric">
              <span>{{field}}</span><strong>未接入</strong>
            </div>
          </div>
          <p class="device-notes">{{ selectedDevice.notes || '设备坐标、编号与测点待现场及设计资料核对。' }}</p>
          <p class="caution">不会在Three.js中虚构设备安装点。完成设备编号、CAD定位和PLC测点对账后，才可生成真实设备交互节点。</p>
        </template>
        <template v-else>
          <p class="region-intro">{{selectedRegion.summary}}</p>
          <div class="location-status"><i></i>{{selectedRegion.locationStatus}}</div>
          <div class="section-title"><strong>区域设备与设施</strong><span>{{selectedRegion.devices.length}}类 · 设计清单</span></div>
          <div class="device-list">
            <button v-for="d in selectedRegion.devices" :key="d.id" class="device-item"
              :data-device-id="d.id" @click="chooseDevice(d)">
              <span class="device-symbol"><i></i></span>
              <span class="device-text"><strong>{{d.name}}</strong><small>{{d.designQuantity}}</small></span>
              <span class="chevron">›</span>
            </button>
          </div>
          <div class="section-title"><strong>区域设计要点</strong><span>来源可追溯</span></div>
          <div class="keyfacts">
            <div v-for="fact in selectedRegion.designFacts" :key="fact.label" class="fact">
              <small>{{fact.label}}</small><strong>{{fact.value}}</strong>
              <span :title="fact.source">{{fact.type==='cad'?'CAD依据':fact.type==='data'?'数据状态':'规格书设计'}}</span>
            </div>
          </div>
          <div class="section-title"><strong>相关水系统</strong><span>设计关系</span></div>
          <div class="systems">
            <span v-for="sys in selectedRegion.pipeSystems" :key="sys">{{sys}}</span>
          </div>
          <div class="section-title"><strong>关联区域</strong><span>不代表已核实物理连通</span></div>
          <div class="region-relations">
            <button v-for="(link,i) in selectedRegion.relationships" :key="i" @click="choose(link.to)">
              <strong>{{regionName(link.to)}}</strong>
              <small>{{link.description}}（{{link.status}}）</small>
            </button>
          </div>
          <div class="source-note">
            <strong>核查边界</strong>
            <p v-if="systemDisclaimer">{{systemDisclaimer}}</p>
            <p>{{selectedRegion.warning}}</p>
          </div>
        </template>
      </div>
      <footer class="region-card-footer">
        <span><i></i>设计设备 · 非在线状态</span>
        <a href="/tanggang/audit/cad-review/v2/index.html" target="_blank" rel="noopener">二维CAD核查</a>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.region-overlay{position:absolute;inset:0;z-index:3;pointer-events:none}
.region-nav,.region-card{position:absolute;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;
 background:linear-gradient(150deg,#ffffffee,#eff8fced);border:1px solid #d2e5ee;
 box-shadow:0 12px 30px #698fa629;backdrop-filter:blur(15px);border-radius:13px}
.region-nav{left:17px;top:146px;width:215px;max-height:calc(100% - 207px)}
.nav-header{padding:11px 12px 9px;border-bottom:1px solid #e1ecf2;display:flex;justify-content:space-between;align-items:center;gap:9px}
.kicker{font-size:9px;font-weight:790;letter-spacing:1.15px;color:#339db3;display:block}
.nav-header strong{display:block;font-size:14px;color:#2c607c;margin-top:3px}
.nav-header>span{font-size:10px;border-radius:7px;padding:4px 7px;background:#e8f5fa;color:#5899ae;white-space:nowrap}
.nav-items{padding:6px;min-height:0;overflow:auto;scrollbar-width:thin}
.nav-item{width:100%;display:flex;align-items:center;gap:8px;padding:8px 6px;text-align:left;background:transparent;border:1px solid transparent;border-radius:8px;cursor:pointer}
.nav-item.active,.nav-item:hover{background:#fff;border-color:#b4dce8}
.nav-index{font-size:10px;font-weight:750;color:#8cafbd;flex:none}
.nav-copy{flex:1;min-width:0}
.nav-copy strong{display:block;font-size:10px;color:#3b6e85;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.nav-copy small{display:block;font-size:9px;color:#91a8b5;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin-top:4px}
.nav-note{font-size:9px;color:#93a6b0;padding:8px 11px;border-top:1px solid #e0edf3}
.region-card{top:140px;right:15px;width:318px;max-height:calc(100% - 197px)}
.region-card-header{padding:11px 13px;display:flex;justify-content:space-between;align-items:start;gap:10px;border-bottom:1px solid #dfecf3}
.region-card h3{font-size:15px;line-height:1.5;color:#2c6580;margin:4px 0 1px}
.region-card-header p{font-size:10px;color:#869eac;margin:0;line-height:1.5}
.nav-toggle{flex:none;font-size:10px;color:#4c91a6;background:#f9fdff;border:1px solid #d7e9f0;border-radius:7px;padding:6px;cursor:pointer}
.region-scroll{padding:10px 13px;overflow-y:auto;scrollbar-width:thin;min-height:0}
.region-intro{font-size:10px;color:#567b8d;line-height:1.7;margin:0 0 8px}
.location-status{font-size:10px;color:#799aa8;line-height:1.6;padding:6px 7px;background:#f4f9fb;border-radius:7px;margin-bottom:9px}
.location-status i,.region-card-footer i{display:inline-block;width:6px;height:6px;background:#ddaf62;border-radius:50%;margin-right:5px}
.keyfacts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.fact{border:1px solid #e3eef3;background:#fff;border-radius:9px;padding:7px;min-width:0}
.fact small{display:block;font-size:9px;line-height:1.5;color:#94aab6}
.fact strong{display:block;font-size:12px;line-height:1.5;color:#3a7289;overflow-wrap:anywhere;margin:3px 0}
.fact span{font-size:8px;color:#a6b2bc}
.section-title{display:flex;align-items:center;justify-content:space-between;margin:12px 0 6px;gap:8px}
.section-title strong{font-size:11px;color:#3a6c82}.section-title span{font-size:9px;color:#96a9b4}
.device-list{display:grid;gap:5px}
.device-item{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #e2edf3;border-radius:8px;background:#fff;cursor:pointer;text-align:left}
.device-item:hover{border-color:#9ad5e5;background:#f5fcff}
.device-symbol{flex:none;width:25px;height:25px;background:#e7f5fa;border:1px solid #c8e5ef;border-radius:8px;display:grid;place-items:center}
.device-symbol i{width:10px;height:10px;border:2px solid #63afc3;border-radius:3px}
.device-text{flex:1;min-width:0}
.device-text strong{display:block;font-size:10px;line-height:1.5;color:#385f73}
.device-text small{font-size:9px;color:#8ca3af}
.chevron{font-size:19px;color:#9dbbc8}
.systems{display:flex;flex-wrap:wrap;gap:5px}
.systems span{font-size:9px;color:#42869c;background:#eaf7fa;border:1px solid #cde8f1;padding:4px 7px;border-radius:12px}
.region-relations{display:grid;gap:5px}
.region-relations button{background:#f8fcfd;border:1px dashed #cfe3eb;border-radius:8px;padding:7px;text-align:left;cursor:pointer}
.region-relations button:hover{border-color:#8dc9d8}
.region-relations strong{display:block;font-size:10px;color:#4b8b9f}
.region-relations small{display:block;font-size:9px;color:#839fac;line-height:1.5;margin-top:3px}
.source-note,.caution{border:1px solid #f0e4d2;background:#fffbf5;border-radius:9px;padding:9px;margin-top:10px;font-size:9px;line-height:1.7;color:#9a876e}
.source-note strong{display:block;font-size:10px;color:#96754b}
.source-note p{margin:4px 0 0}
.region-card-footer{border-top:1px solid #deebf2;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:9px;color:#91a7b1}
.region-card-footer a{color:#398da6;text-decoration:none}
.back{display:flex;justify-content:space-between;align-items:center;font-size:9px;color:#8da6b1}
.back button{border:none;background:transparent;color:#3292aa;padding:4px 0;cursor:pointer}
.device-name{font-size:16px;color:#2e6581;margin:12px 0 10px}
.notconnected{color:#a0875d;background:#fff5e4;border-radius:7px;padding:8px;font-size:10px;margin-bottom:10px}
.device-details{display:grid;grid-template-columns:85px minmax(0,1fr);gap:8px;font-size:10px}
.device-details dt{color:#8ba3b1}
.device-details dd{margin:0;color:#47758a;text-align:right;overflow-wrap:anywhere}
.region-card h5{font-size:11px;color:#436d82;margin:15px 0 8px}
.metric-rows{display:grid;gap:5px}
.metric{display:flex;justify-content:space-between;gap:8px;padding:8px;border:1px solid #e1edf3;border-radius:7px;background:#fff;font-size:10px}
.metric span{color:#568598}.metric strong{color:#9cabb3;font-weight:550}
.device-notes{font-size:10px;line-height:1.7;color:#7b9ba9}
@media(max-width:1450px){.region-nav{left:7px;width:177px}.region-card{right:7px;width:274px}}
@media(max-width:1120px){.region-nav{width:155px}.region-card{width:240px}.nav-copy strong{font-size:9px}}
</style>

<style scoped>
.business-context{padding:8px 9px;margin-bottom:10px;border:1px solid #bde3ed;border-left:3px solid #54b4c8;
 background:linear-gradient(110deg,#e7f8fc,#fff);border-radius:9px}
.business-context strong{display:flex;align-items:center;justify-content:space-between;color:#27748c;font-size:12px}
.business-context strong span{font-size:9px;color:#5297a9;background:#fff9;padding:3px 5px;border-radius:5px;font-weight:500}
.business-context p{font-size:10px;line-height:1.6;color:#5b8092;margin:6px 0}
.business-context small{font-size:9px;color:#9eaaae}
</style>
