<script setup lang="ts">
import { computed, ref } from "vue";
import { NTag } from "naive-ui";
import { useDemoStore } from "../demo/store";
import { evaluateTelemetryCoverage,summarizeTelemetryCoverage } from "../demo/telemetryCoverage";
const demo=useDemoStore();
const lines=computed(()=>evaluateTelemetryCoverage(demo.assets,demo.points,pointId=>demo.latest(pointId),demo.seed.referenceTime));
const summary=computed(()=>summarizeTelemetryCoverage(lines.value));
const expanded=ref(false);
</script>

<template>
  <section class="coverage">
    <header>
      <div>
        <div class="eyebrow">SCADA / 采集能力与数据来源</div>
        <h3>六工艺测点可用性与实际接入缺口</h3>
        <p>测点有模拟值不等于仪表已经安装、在线、标定或可用于24小时值守。这里分别报告DEMO数据的新鲜度和真实工程数据的确认情况。</p>
      </div>
      <NTag type="warning" size="small">现场在线接入已验收：{{ summary.actualOnlineAcceptedPoints }} 点</NTag>
    </header>
    <div class="coverage-overview">
      <div><span>DEMO设备记录</span><strong>{{ summary.demoAssets }}</strong><small>非真实设备清单</small></div>
      <div><span>DEMO测点记录</span><strong>{{ summary.demoPoints }}</strong><small>配置的模拟测点</small></div>
      <div><span>模拟时标及质量有效</span><strong>{{ summary.mockFreshPoints }}</strong><small>仅按种子参考时点核对</small></div>
      <div><span>24小时现场自动监护</span><strong>未具备证明</strong><small>需点表、实测、授时和岗位责任验收</small></div>
    </div>
    <div class="coverage-table-wrap">
      <table>
        <thead><tr><th>工艺系统</th><th>DEMO设备 / 测点</th><th>MOCK样本可用性</th><th>已核实现场点</th><th>关键工程前置条件</th><th>核查入口</th></tr></thead>
        <tbody>
          <tr v-for="line in lines" :key="line.subsystemId">
            <td><strong>{{ line.name }}</strong><small>未证明真实在线覆盖</small></td>
            <td>{{ line.assetCount }} 台 / {{ line.pointCount }} 点</td>
            <td>
              <div class="mini-progress"><i :style="{width:line.sampleCoveragePercent+'%'}"/></div>
              <span class="sample">{{ line.mockFreshPointCount }}/{{ line.pointCount }} · {{ line.sampleCoveragePercent }}%</span>
            </td>
            <td><NTag size="tiny" type="warning">0 · 待核</NTag></td>
            <td class="critical">{{ line.critical }}</td>
            <td><router-link :to="'/engineering/registry?item='+line.pointRequirements[0]">{{ line.pointRequirements[0] }} 核对</router-link></td>
          </tr>
        </tbody>
      </table>
    </div>
    <button type="button" class="more" :aria-expanded="expanded" @click="expanded=!expanded">{{ expanded?'收起':'查看' }}数据质量与自动化验收判据</button>
    <div v-if="expanded" class="quality-gates">
      <div><b>设备是否存在</b><span>批准设备清单、安装/调试记录、站点位号与台账一一对应</span></div>
      <div><b>仪表是否可信</b><span>量程、单位、精度、标定有效期、仪表健康与失效替代策略</span></div>
      <div><b>控制是否安全</b><span>PLC本地联锁/FAT/SAT、远程权限、控制/信息网络隔离</span></div>
      <div><b>数据是否有效</b><span>源点ID、统一时标、数据质量码、断点重传和异常可追溯</span></div>
      <div><b>报警是否闭环</b><span>责任岗位、值守覆盖、异常升级、现场检查与恢复核验记录</span></div>
      <div><b>环境是否适配</b><span>港口盐雾、粉尘、潮湿、腐蚀、防雷、EMC和检修空间</span></div>
    </div>
    <p class="note">以上“模拟时标及质量有效”的百分比不能用于正式建设验收或业主汇报中的实测覆盖率。系统暂不接入真实SCADA，未配置现场LIVE数据来源和签认流程；不得宣称已经实现无人值守。</p>
  </section>
</template>

<style scoped>
.coverage{background:#fff;border-radius:10px;border:1px solid #d8e9f1;box-shadow:0 5px 18px #277a9909;padding:17px;min-width:0;color:#326581}
.coverage header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.eyebrow{font-size:10px;color:#91adba;letter-spacing:.06em}
.coverage h3{font-size:16px;color:#286d87;margin:7px 0}.coverage header p{max-width:850px;font-size:11px;line-height:1.75;color:#8ea8b6;margin:0}
.coverage-overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:16px 0}
.coverage-overview>div{padding:13px;background:#f5fafc;border-radius:7px;border:1px solid #e3edf3;display:grid;gap:6px}
.coverage-overview span{font-size:11px;color:#7994a4}.coverage-overview strong{font-size:22px;color:#327a95}.coverage-overview small{font-size:10px;color:#98adbb}
.coverage-table-wrap{max-width:100%;overflow:auto}
.coverage table{width:100%;border-collapse:collapse;min-width:900px}
.coverage th{text-align:left;font-size:11px;color:#6b91a5;background:#f4fafc;font-weight:600;padding:11px 9px}
.coverage td{border-bottom:1px solid #e8f0f4;padding:11px 9px;vertical-align:middle;font-size:11px;color:#658699}
.coverage td:first-child strong{display:block;font-size:12px;color:#397b96}.coverage td:first-child small{display:block;color:#a1b0ba;margin-top:5px;font-size:10px}
.coverage .critical{max-width:320px;line-height:1.6}.coverage td a{font-size:11px;color:#1b87ab;text-decoration:none;white-space:nowrap}
.mini-progress{height:7px;width:120px;border-radius:5px;background:#eaf1f5;overflow:hidden;margin-bottom:5px}
.mini-progress i{display:block;height:100%;background:#76b5cf;border-radius:5px}.sample{font-size:10px;color:#89a6b4}
.more{border:0;background:transparent;color:#247d9c;font-size:11px;cursor:pointer;margin-top:12px;padding:6px}
.quality-gates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:7px}
.quality-gates>div{display:grid;gap:6px;padding:12px;background:#f5fafd;border:1px solid #e4eff5;border-radius:7px}
.quality-gates b{font-size:11px;color:#427990}.quality-gates span{font-size:11px;color:#829eac;line-height:1.65}
.note{font-size:10px;color:#9b865e;background:#fffaf2;border-radius:7px;padding:9px 12px;line-height:1.75;margin:12px 0 0}
@media(max-width:1000px){.coverage-overview{grid-template-columns:repeat(2,minmax(0,1fr))}.quality-gates{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:660px){.coverage header{flex-direction:column}.coverage-overview,.quality-gates{grid-template-columns:1fr}}
</style>
