<script setup lang="ts">
import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {ElButton} from 'element-plus'
import {usePermissions} from '@/utils/permissions'
import './business.css'
const props=defineProps<{domain:'water'|'operations'|'assets'|'analysis'}>()
const router=useRouter()
const perms=usePermissions()
interface ModuleLink{title:string;desc:string;path:string;perm?:string;ready:boolean}
const configs:Record<typeof props.domain,{title:string;subtitle:string;flow:string[];modules:ModuleLink[];note:string}>={
 water:{
  title:'水资源管理',subtitle:'围绕供水保障、用水计量、污染水收集处理和回用建立可核验的水量链条',
  flow:['市政中水/自来水/收集水','储水与供水','港口生产用水','污染水收集','处理及合规回用'],
  modules:[
   {title:'大机供水保障',desc:'联合卸船机作业、副水箱液位和管网压力判断供水风险；需要厂家接口。',path:'/port/process/middle',ready:false},
   {title:'雨水收集与调蓄',desc:'从集水池、液位与雨次分析建立调蓄决策，库容和管网需工程核实。',path:'/port/process/rain',ready:false},
   {title:'含矿污水处理与回用',desc:'跟踪进水、处理、水质与可回用量，不接管厂家内部加药控制。',path:'/port/process/mineral',ready:false},
   {title:'水池供水与多水源',desc:'梳理水池、水源和补水路线，按设计关系核对相应设施。',path:'/port/process/pool',ready:false},
   {title:'供水统计（5175）',desc:'保留原运管平台成熟统计页面；尚需换成唐港口径与数据。',path:'/water/stats',perm:'water:stats',ready:true},
   {title:'能耗分析（5175）',desc:'保留原运管平台能耗图表及查询能力；单位水量能耗待测点对接。',path:'/energy/stats',perm:'energy:stats',ready:true},
  ],
  note:'水量平衡、雨次预测、调蓄优化与水源成本不是现阶段已经上线的功能。须先拿到水量表、液位、泵性能及回用水质数据。',
 },
 operations:{
  title:'运行处置',subtitle:'统一汇集事件、告警、现场核查、维修工单与恢复复核，避免重复建立事件状态',
  flow:['状态采集与数据质量','规则发现异常','事件归并与研判','授权派工','反馈与恢复验证'],
  modules:[
   {title:'告警中心（5175）',desc:'实时/历史告警、告警规则及告警类型，继续使用同一条告警记录。',path:'/alarm/realtime',perm:'alarm:realtime',ready:true},
   {title:'维修工单（5175）',desc:'从告警关联维修工单，记录派发、处理、验收，不建立第二套工单。',path:'/repair/list',perm:'repair:list',ready:true},
   {title:'六工艺异常定位',desc:'利用系统ID与CAD设施关联确定专业工艺与空间区域。',path:'/port/monitor',ready:false},
   {title:'设备巡检',desc:'结合巡检任务与设备历史记录，补齐现场核验反馈。',path:'/inspection/tasks',perm:'insp:task:list',ready:true},
  ],
  note:'主动智能监护、关联事件中心、应急协同属于后续业务集成；当前不将已有告警中心冒充AI自动闭环。',
 },
 assets:{
  title:'设备运维',subtitle:'沿用5175成熟的设备台账、巡检、维保、维修工单及档案工作流',
  flow:['设备建档','状态与健康评估','巡检/维保计划','故障维修','结果归档与分析'],
  modules:[
   {title:'设备台账',desc:'泵、阀、仪表、控制柜等统一资产及详情。',path:'/equipment/list',perm:'eq:list',ready:true},
   {title:'设备巡检',desc:'巡检任务、异常发现与回执。',path:'/inspection/tasks',perm:'insp:task:list',ready:true},
   {title:'计划维保',desc:'周期计划、维保执行与历史记录。',path:'/maintenance/plans',perm:'maint:plan:list',ready:true},
   {title:'维修工单',desc:'维修受理、处理、验收和记录。',path:'/repair/list',perm:'repair:list',ready:true},
   {title:'档案管理',desc:'设备图纸、厂家资料与维修文档。',path:'/archive',perm:'archive:list',ready:true},
   {title:'CAD设施与设备关系',desc:'设计对象与现场资产统一关联仍待完善。',path:'/port/monitor',ready:false},
  ],
  note:'现有设备台账的数据模型主要面向原运管平台。接入唐港前要增加 facilityId/CAD Handle、系统归属和测点映射，防止设备重复建档。',
 },
 analysis:{
  title:'分析中心',subtitle:'以真实数据与计算依据为基础进行水务分析、报表和AI辅助，不以虚构指标证明效果',
  flow:['数据获取与质量校验','统计与指标计算','证据追溯','AI辅助解释','保存成果及复核'],
  modules:[
   {title:'供水统计',desc:'使用现有报表和图表组件，随后对接唐港水量账本。',path:'/water/stats',perm:'water:stats',ready:true},
   {title:'能耗分析',desc:'运行电量与用水量的统计分析基础。',path:'/energy/stats',perm:'energy:stats',ready:true},
   {title:'AI智能助手',desc:'使用5175现有AI交互入口；唐港知识库和操作工具仍需接入。',path:'/ai/chat',ready:true},
   {title:'AI分析工作台与A2UI',desc:'保留5174功能需求；生成、预览、保存和发布尚需在5190重新实现。',path:'/port/analysis',ready:false},
  ],
  note:'AI生成的分析必须注明查询数据、时间区间、指标口径与来源。不得把模拟数据描述成实测，也不得直接生成现场PLC控制命令。',
 },
}
const cfg=computed(()=>configs[props.domain])
const modules=computed(()=>cfg.value.modules.filter(m=>!m.perm||perms.hasPerm(m.perm)))
</script>
<template>
  <main class="tg-biz page-fill">
    <div class="tg-biz-head">
      <div><h1>{{cfg.title}}</h1><p class="tg-biz-sub">{{cfg.subtitle}}</p></div>
      <ElButton @click="router.push('/dashboard')">返回三维总览</ElButton>
    </div>
    <div class="tg-biz-steps">
      <template v-for="(step,i) in cfg.flow" :key="step"><b v-if="i">→</b><span>{{step}}</span></template>
    </div>
    <div class="tg-biz-note"><strong>建设边界：</strong>{{cfg.note}}</div>
    <div class="tg-biz-grid">
      <section v-for="module in modules" :key="module.title" class="tg-biz-card art-card" :data-clickable="module.path!==('/port/'+props.domain)" role="link" tabindex="0"
        @click="module.path!==('/port/'+props.domain) && router.push(module.path)"
        @keydown.enter="module.path!==('/port/'+props.domain) && router.push(module.path)">
        <div class="tg-biz-card-head"><h3>{{module.title}}</h3><span class="tg-biz-chip" :class="module.ready?'ok':'warn'">{{module.ready?'已有页面':'专业深化'}}</span></div>
        <p>{{module.desc}}</p>
        <div v-if="module.path!==('/port/'+props.domain)" class="tg-biz-link">查看相关功能 →</div>
        <div v-else class="tg-biz-label">此功能尚未开发，保留需求入口</div>
      </section>
    </div>
    <section class="tg-biz-card art-card">
      <h2>跨模块一致性要求</h2>
      <p>同一设施、资产、测点、告警和工单必须使用统一ID及相同的数据权限。首页引擎只提供空间定位与状态呈现；业务页面负责状态查询、规则校验、人员协作、记录和追溯。</p>
    </section>
  </main>
</template>
