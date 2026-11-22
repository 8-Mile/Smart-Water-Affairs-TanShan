import {beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {SCENARIOS,calculateScenario} from '../engine'
import {assessSimMonitor} from '../monitorEvidence'
import {compareSupplyPlans} from '../supplyPlans'
import {analyzeSimOperationalImpact} from '../impactAnalysis'
import {useScenarioStore} from '../store'

describe('TG-205 供水与监护关联影响（仅同一轮SIM）',()=>{
  it('高峰场景缺口只定位到实际分配不足的演示终端，不扩大到所有设施',()=>{
    const s=SCENARIOS.peak
    const impact=analyzeSimOperationalImpact(s,calculateScenario(s),
      assessSimMonitor(s),compareSupplyPlans(s))
    expect(impact.dataMode).toBe('SIM')
    expect(impact.fieldVerified).toBe(false)
    expect(impact.affectedTerminals.map(x=>x.id)).toEqual(['DEMO-MD'])
    expect(impact.affectedTerminals[0]?.shortageM3h).toBe(34)
    expect(impact.shortageM3h).toBe(34)
    expect(impact.triggeredRules).toContain('运行时高电流')
    expect(impact.checkpoints.map(x=>x.key)).toContain('operations')
    expect(impact.inferenceType).toBe('RULE_EXPLANATION_NOT_AI_DIAGNOSIS')
    expect(impact.restriction).toContain('相关性不代表')
  })
  it('模拟泵故障只反映当前场景计算和监护条件，不宣称根因',()=>{
    const s=SCENARIOS['pump-fault']
    const out=analyzeSimOperationalImpact(s,calculateScenario(s),
      assessSimMonitor(s),compareSupplyPlans(s))
    expect(out.triggeredRules).toContain('泵组状态')
    expect(out.affectedTerminals.map(x=>x.id)).toEqual(['DEMO-MB','DEMO-MC'])
    expect(out.checkpoints.some(x=>x.key==='pump-condition')).toBe(true)
    expect(out.checkpoints.every(x=>x.fieldVerified===false)).toBe(true)
  })
  it('正常演示未出现缺口，但仍留工程核查条件，不能宣称现场安全',()=>{
    const s=SCENARIOS.baseline
    const out=analyzeSimOperationalImpact(s,calculateScenario(s),
      assessSimMonitor(s),compareSupplyPlans(s))
    expect(out.affectedTerminals).toHaveLength(0)
    expect(out.conclusion).toContain('不代表现场无风险')
    expect(out.planBoundaries.every(x=>x.status==='UNVERIFIED'||x.status==='CONSTRAINT_FAIL')).toBe(true)
  })
  it('不允许混用不同情景或截断的方案',()=>{
    const s=SCENARIOS.peak,other=SCENARIOS.baseline
    const result=calculateScenario(s),mon=assessSimMonitor(s),plans=compareSupplyPlans(s)
    expect(()=>analyzeSimOperationalImpact(other,result,mon,plans)).toThrow()
    expect(()=>analyzeSimOperationalImpact(s,result,mon,[])).toThrow()
    expect(()=>analyzeSimOperationalImpact(s,result,mon,plans.slice(0,3))).toThrow()
    expect(()=>analyzeSimOperationalImpact(s,result,{...mon,dataMode:'MEASURED' as 'SIM'},plans)).toThrow()
  })
  it('四方案排序、限制和延期需求来自同一算法；计算过程无修改原情景',()=>{
    const original=JSON.stringify(SCENARIOS)
    for(const s of Object.values(SCENARIOS)){
      const impact=analyzeSimOperationalImpact(s,calculateScenario(s),assessSimMonitor(s),compareSupplyPlans(s))
      expect(impact.planBoundaries.map(x=>x.id)).toEqual(['as-is','defer','storage-first','standby'])
      expect(impact.planBoundaries[1]!.deferredDemandM3h).toBeGreaterThanOrEqual(0)
      expect(impact.planBoundaries[3]?.status).toMatch(/UNVERIFIED|CONSTRAINT_FAIL/)
    }
    expect(JSON.stringify(SCENARIOS)).toBe(original)
  })
  describe('同一SIM状态贯穿供水、监护、方案和核查结果',()=>{
    beforeEach(()=>setActivePinia(createPinia()))
    it('运行改变后重新计算，核查引用相同runNumber，切情景全部重置',()=>{
      const store=useScenarioStore()
      expect(store.impactAnalysis).toBeNull()
      store.start('peak',{capacityM3h:125})
      const impact=store.impactAnalysis!
      expect(impact.shortageM3h).toBe(store.result?.shortageM3h)
      expect(impact.affectedTerminals[0]?.id).toBe('DEMO-MD')
      expect(impact.affectedTerminals[0]?.shortageM3h).toBe(24)
      store.beginMonitorReview()
      store.recordMonitorReview('requires-field-check','供水缺口和模拟电流需核对现场资料')
      expect(store.monitorReview?.runNumber).toBe(store.runNumber)
      store.start('baseline')
      expect(store.monitorReview).toBeNull()
      expect(store.impactAnalysis?.affectedTerminals).toHaveLength(0)
      store.stop()
      expect(store.impactAnalysis).toBeNull()
    })
  })
})
