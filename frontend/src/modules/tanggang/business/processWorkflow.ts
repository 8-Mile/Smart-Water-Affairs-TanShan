import type {ScenarioResult} from '../simulation/engine'

/**
 * Keep specialist process navigation aligned to the existing product:
 * only three domains currently have an independent numeric scenario model.
 * Do NOT route fog/mineral/domestic to the unrelated middle-pump monitor.
 */
export interface ProcessWorkflow {
  primary:{path:string;label:string}|null
  supportsDecision:boolean
  scope:string
  simSummary:string|null
  simNoEvidence:string
}

export function processWorkflow(
  systemId:string,
  result:ScenarioResult|null,
):ProcessWorkflow {
  const supply={path:'/port/water/supply',label:'供水保障分析'}
  const rain={path:'/port/water/rain-risk',label:'雨水调蓄模拟'}
  if(systemId==='middle'){
    return {
      primary:supply,supportsDecision:true,
      scope:'中压泵监护和供水分配均为同轮SIM模型；未验证真实泵组或管线。',
      simSummary:result?
        (result.id==='storm'?'独立供水参考（本轮主情景为强降雨）：':'模拟供水：')+
        '需求 '+result.demandedM3h+' m³/h，分配 '+result.deliveredM3h+
        ' m³/h，缺口 '+result.shortageM3h+' m³/h':null,
      simNoEvidence:'请运行统一SIM情景以查看中压泵与供水模拟。',
    }
  }
  if(systemId==='pool'){
    return {
      primary:supply,supportsDecision:true,
      scope:'当前仅有统一演示水池模型，不能将其储量赋给除尘水池或其他实体池。',
      simSummary:result?'统一模拟水池：'+result.input.horizonHours+
        '小时后预测储量 '+result.forecastPoolM3+' m³（非本节点实际储量）':null,
      simNoEvidence:'请运行统一SIM情景以查看共享水池模型的供水约束。',
    }
  }
  if(systemId==='rain'){
    return {
      primary:rain,supportsDecision:false,
      scope:'雨水风险仅针对独立演示集水单元，不表示南北集水池的真实连通、库容或许可外排。',
      simSummary:result&&result.input.rainMm>0?
        '独立模拟集水单元：假设降雨 '+result.input.rainMm+
        ' mm，条件溢流 '+result.rainOverflowM3+' m³（非任何实体池实测）':null,
      simNoEvidence:result?
        '本轮SIM未设置降雨；以下设施仅展示独立Mock参考值，不能据此判断雨水调蓄。':
        '可在统一SIM情景中选择“强降雨入池”进行演示。',
    }
  }
  const titles:Record<string,string>={
    fog:'射雾器除尘',
    mineral:'含矿污水处理',
    domestic:'生活污水提升与外送',
  }
  const name=titles[systemId]||'当前专业系统'
  return {
    primary:null,supportsDecision:false,
    scope:name+'暂未建立独立的定量SIM工艺模型；节点读数为Mock示例，不应套用中压泵监护、供水方案或雨水调蓄结论。',
    simSummary:null,
    simNoEvidence:result?
      '当前SIM没有覆盖'+name+'的专业工艺计算；本系统仍可记录本轮人工模拟核查。':
      '本系统提供Mock设施浏览和人工模拟核查；暂无独立定量推演。',
  }
}

export function processMonitorRelevant(systemId:string,facilityId:string|null):boolean {
  return systemId==='middle'&&
    (facilityId==='EQ-P-MID'||facilityId==='EQ-P-METER')
}
