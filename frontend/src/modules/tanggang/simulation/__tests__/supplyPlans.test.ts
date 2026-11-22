import {beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {SCENARIOS,calculateScenario, type ScenarioInputs} from '../engine'
import {SUPPLY_PLAN_MODEL,compareSupplyPlans} from '../supplyPlans'
import {useScenarioStore} from '../store'

describe('TG-201~204 唐港供水方案软件推演（非现场数据）',()=>{
  it('四方案共用一个可追溯的假设快照；不会修改预置输入',()=>{
    const before=JSON.stringify(SCENARIOS.peak)
    const plans=compareSupplyPlans(SCENARIOS.peak)
    expect(plans.map(x=>x.id)).toEqual(['as-is','defer','storage-first','standby'])
    expect(plans.every(x=>x.modelVersion===SUPPLY_PLAN_MODEL&&x.sourceMode==='SIM'&&!x.fieldValidated)).toBe(true)
    expect(JSON.stringify(SCENARIOS.peak)).toBe(before)
    expect(plans[0]?.result.shortageM3h).toBe(calculateScenario(SCENARIOS.peak).shortageM3h)
  })

  it('增大假设备用能力使短时缺口下降，但会耗尽水池：必须阻止误判为可执行',()=>{
    const plans=compareSupplyPlans(SCENARIOS.peak)
    const base=plans[0]!,standby=plans[3]!
    expect(base.result.shortageM3h).toBe(34)
    expect(standby.result.shortageM3h).toBe(0)
    expect(standby.rawEndStorageM3).toBeLessThan(0)
    expect(standby.result.forecastPoolM3).toBe(0)
    expect(standby.constraint).toBe('CONSTRAINT_FAIL')
    expect(standby.blockers.join('|')).toMatch(/抽空水池/)
    expect(standby.blockers.join('|')).toMatch(/备用设备/)
  })

  it('错峰不得把顺延需求当作节水，且低优先级需求原始数据保持不变',()=>{
    const original=SCENARIOS.peak.inputs.terminals.map(x=>x.demandM3h)
    const plans=compareSupplyPlans(SCENARIOS.peak)
    const defer=plans[1]!
    expect(defer.deferredDemandM3h).toBe(33.5)
    expect(defer.result.demandedM3h+defer.deferredDemandM3h).toBe(139)
    expect(defer.blockers.join('|')).toMatch(/延后需求未消失/)
    expect(SCENARIOS.peak.inputs.terminals.map(x=>x.demandM3h)).toEqual(original)
  })

  it('安全储量优先方案可以约束末期水位，但可能增大当期缺口',()=>{
    const plans=compareSupplyPlans(SCENARIOS.peak)
    const storage=plans[2]!,base=plans[0]!
    expect(storage.rawEndStorageM3).toBeGreaterThanOrEqual(storage.input.poolSafetyM3)
    expect(storage.result.shortageM3h).toBeGreaterThan(base.result.shortageM3h)
    expect(storage.constraint).toBe('UNVERIFIED')
    expect(storage.fieldValidated).toBe(false)
  })

  it('所有方案的供需总量和储量变化公式自洽（保留显示取整容差）',()=>{
    for(const scenario of Object.values(SCENARIOS)){
      for(const plan of compareSupplyPlans(scenario)){
        const demand=plan.result.terminalAssessments.reduce((a,t)=>a+t.demandM3h,0)
        const allocated=plan.result.terminalAssessments.reduce((a,t)=>a+t.allocatedM3h,0)
        expect(plan.result.demandedM3h).toBeCloseTo(demand,1)
        expect(plan.result.deliveredM3h).toBeCloseTo(allocated,1)
        expect(plan.result.shortageM3h).toBeCloseTo(demand-allocated,1)
        expect(plan.rawEndStorageM3).toBeCloseTo(
          plan.input.poolInitialM3+(plan.input.poolInflowM3h-plan.result.deliveredM3h)*plan.input.horizonHours,1
        )
      }
    }
  })

  describe('单入口全局参数可编辑；非法参数不可污染运行情景',()=>{
    beforeEach(()=>setActivePinia(createPinia()))
    it('修改参数只影响本轮SIM，跨业务结果共享，退出即清空',()=>{
      const store=useScenarioStore()
      const original=SCENARIOS.peak.inputs.capacityM3h
      store.start('peak',{capacityM3h:125,poolInflowM3h:75})
      expect(store.activeInputs?.capacityM3h).toBe(125)
      expect(store.result?.usableCapacityM3h).toBe(115)
      expect(store.supplyPlans).toHaveLength(4)
      expect(store.supplyPlans[0]?.result.shortageM3h).toBe(store.result?.shortageM3h)
      expect(SCENARIOS.peak.inputs.capacityM3h).toBe(original)
      store.stop()
      expect(store.activeInputs).toBeNull()
      expect(store.result).toBeNull()
      expect(store.supplyPlans).toHaveLength(0)
    })

    it('越界/非法/超出白名单输入要被拒绝，旧运行结果和runNumber保持不变',()=>{
      const store=useScenarioStore()
      store.start('peak')
      const oldRun=store.runNumber, oldResults=store.result
      expect(()=>store.start('storm',{poolSafetyM3:3000})).toThrow()
      expect(()=>store.start('storm',{horizonHours:0})).toThrow()
      expect(()=>store.start('storm',{capacityM3h:NaN})).toThrow()
      expect(()=>store.start('storm',{terminals:[] } as Partial<ScenarioInputs>)).toThrow()
      expect(store.runNumber).toBe(oldRun)
      expect(store.activeId).toBe('peak')
      expect(store.result?.shortageM3h).toEqual(oldResults?.shortageM3h)
    })
  })
})
