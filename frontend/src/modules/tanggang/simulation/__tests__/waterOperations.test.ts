import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {SCENARIOS,calculateScenario} from '../engine'
import {autoScenarioId,autoScenarioAt,AUTO_CYCLE_FRAMES} from '../autoWaterFeed'
import {
  WATER_PROCESSES,WATER_RELATIONSHIPS,systemNeighbors,processName,
  calculateWaterEconomics,calculateProcessImpacts,DEFAULT_WATER_POLICY,
  operationsSnapshot,
} from '../waterOperations'
import {useScenarioStore} from '../store'

const near=(a:number,b:number,digits=4)=>expect(a).toBeCloseTo(b,digits)
describe('港区六系统协同设计业务关系',()=>{
  it('六系统均入图，污水处理和生活污水隔离，未经核实物理管道',()=>{
    expect(WATER_PROCESSES).toHaveLength(6)
    expect(new Set(WATER_PROCESSES.map(x=>x.id)).size).toBe(6)
    expect(WATER_RELATIONSHIPS).toHaveLength(5)
    for(const edge of WATER_RELATIONSHIPS){
      expect(WATER_PROCESSES.some(x=>x.id===edge.from)).toBe(true)
      expect(WATER_PROCESSES.some(x=>x.id===edge.to)).toBe(true)
      expect(edge.basis).toBe('V2.3_区域水路关系')
      expect(['design','conditional']).toContain(edge.relation)
      expect(edge.id).not.toBe('verified_pipe')
    }
    expect(systemNeighbors('domestic')).toEqual({
      upstream:[],downstream:[],independent:true,
    })
    expect(systemNeighbors('pool').upstream.map(x=>x.from)).toEqual(['mineral'])
    expect(systemNeighbors('pool').downstream.map(x=>x.to)).toEqual(['middle','fog'])
    expect(systemNeighbors('rain').upstream[0]?.relation).toBe('conditional')
    expect(processName('mineral')).toBe('含矿污水处理')
  })
})
describe('同等供水量下真实计算的能耗与费用对比（假设值，不是节能实测）',()=>{
  const result=calculateScenario(SCENARIOS.baseline)
  it('基准、成本优先、节电优先均供应同一已分配流量',()=>{
    const comparison=calculateWaterEconomics(result)
    expect(comparison.fieldVerified).toBe(false)
    expect(comparison.dataMode).toBe('SIM')
    expect(comparison.comparable).toBe(true)
    for(const plan of [comparison.base,comparison.optimized,comparison.energyPriority]){
      near(plan.assignedM3h,result.deliveredM3h)
      near(plan.allocation.reduce((s,row)=>s+row.volumeM3h,0),result.deliveredM3h)
      expect(plan.unmetM3h).toBe(0)
      near(plan.energyKwhH,plan.sourceEnergyKwhH+plan.deliveryEnergyKwhH,1)
      near(plan.specificKwhM3!,plan.energyKwhH/plan.assignedM3h,2)
    }
    near(comparison.savedEnergyKwhH!,
      comparison.base.energyKwhH-comparison.optimized.energyKwhH)
    near(comparison.savedCostYuanH!,
      comparison.base.costYuanH-comparison.optimized.costYuanH)
    expect(comparison.optimized.costYuanH).toBeLessThanOrEqual(
      comparison.energyPriority.costYuanH)
    expect(comparison.energyPriority.energyKwhH).toBeLessThanOrEqual(
      comparison.optimized.energyKwhH)
    expect(comparison.reusePercent).toBeGreaterThan(0)
    expect(comparison.blockers.length).toBeGreaterThan(2)
  })
  it('模型可以显示成本下降但电耗上升，禁止把水源回用说成必然节能',()=>{
    const c=calculateWaterEconomics(result)
    expect(c.savedCostYuanH).toBeGreaterThan(0)
    expect(c.savedEnergyKwhH).toBeLessThan(0)
    expect(c.energyReductionPercent).toBeLessThan(0)
    expect(c.energyPriority.energyKwhH).toBeLessThan(c.base.energyKwhH)
  })
  it('水质不具备资格或水源容量不足时不显示可比节能率',()=>{
    const p=structuredClone(DEFAULT_WATER_POLICY)
    for(const x of p.source)x.maxM3h=2
    const c=calculateWaterEconomics(result,p)
    expect(c.comparable).toBe(false)
    expect(c.savedCostYuanH).toBeNull()
    expect(c.savedEnergyKwhH).toBeNull()
    expect(c.energyReductionPercent).toBeNull()
    expect(c.blockers.some(s=>s.includes('容量不足'))).toBe(true)
  })
  it('条件不满足的水源不得参与优化；单位成本和参数非法要拒绝',()=>{
    const p=structuredClone(DEFAULT_WATER_POLICY)
    p.source.find(s=>s.id==='treated')!.assumedQualityEligible=false
    const c=calculateWaterEconomics(result,p)
    expect(c.optimized.allocation.find(s=>s.id==='treated')?.volumeM3h).toBe(0)
    p.source.find(s=>s.id==='tap')!.sourceKwhM3=-1
    expect(()=>calculateWaterEconomics(result,p)).toThrow()
  })
  it('需求缺口独立保留，不能将错峰及供水不足冒充节水',()=>{
    const c=calculateWaterEconomics(calculateScenario(SCENARIOS.peak))
    expect(c.shortageM3h).toBeGreaterThan(0)
    expect(c.blockers.some(x=>x.includes('未满足用水需求'))).toBe(true)
    near(c.base.assignedM3h,calculateScenario(SCENARIOS.peak).deliveredM3h)
    expect(c.base.assignedM3h).toBeLessThan(calculateScenario(SCENARIOS.peak).demandedM3h)
  })
})
describe('六系统自动运行和异常影响范围',()=>{
  it('自动数据源按时间帧变化，使用同一工程计算，不会污染DOM或PLC',()=>{
    expect(autoScenarioId(0)).toBe('baseline')
    expect(autoScenarioId(5)).toBe('peak')
    expect(autoScenarioId(10)).toBe('pump-fault')
    expect(autoScenarioId(13)).toBe('storm')
    expect(autoScenarioId(AUTO_CYCLE_FRAMES)).toBe('baseline')
    for(let i=0;i<40;i++){
      const s=autoScenarioAt(i)
      const result=calculateScenario(s)
      const econ=calculateWaterEconomics(result)
      expect(result.demandedM3h).toBeGreaterThan(0)
      expect(econ.modelVersion).toBe('tg-water-operations-sim-v1')
      expect(econ.fieldVerified).toBe(false)
    }
    expect(autoScenarioAt(3)).toEqual(autoScenarioAt(3))
    expect(()=>autoScenarioAt(-1)).toThrow()
  })
  it('异常仅传播风险提示，不把中压泵故障直接定为射雾实际故障',()=>{
    const s=operationsSnapshot(SCENARIOS['pump-fault'])
    const mid=s.impacts.find(x=>x.systemId==='middle')
    const fog=s.impacts.find(x=>x.systemId==='fog')
    expect(mid?.level).toBe('critical')
    expect(fog?.level).not.toBe('critical')
    expect(s.impacts.find(x=>x.systemId==='domestic')?.level).toBe('independent')
    const storm=operationsSnapshot(SCENARIOS.storm)
    expect(storm.impacts.find(x=>x.systemId==='rain')?.level).not.toBe('normal')
    expect(calculateProcessImpacts(SCENARIOS.baseline,
      calculateScenario(SCENARIOS.baseline))).toHaveLength(6)
  })
  it('默认自动Mock -> 自动下一帧 -> 人工分析覆盖 -> 明确恢复自动',()=>{
    setActivePinia(createPinia())
    const s=useScenarioStore()
    const event=vi.spyOn(window,'dispatchEvent')
    s.startAuto()
    expect(s.autoEnabled).toBe(true)
    expect(s.running).toBe(true)
    expect(s.activeId).toBe('baseline')
    expect(s.autoHistory).toHaveLength(1)
    s.advanceAuto()
    expect(s.autoFrame).toBe(1)
    expect(s.autoHistory).toHaveLength(2)
    expect(s.waterEconomics?.fieldVerified).toBe(false)
    for(let i=0;i<4;i++)s.advanceAuto()
    expect(s.activeId).toBe('peak')
    expect(s.runNumber).toBe(2)
    s.start('pump-fault')
    expect(s.autoEnabled).toBe(false)
    expect(s.activeId).toBe('pump-fault')
    const frame=s.autoFrame
    s.advanceAuto()
    expect(s.autoFrame).toBe(frame)
    s.stop()
    s.startAuto()
    expect(s.autoEnabled).toBe(true)
    expect(s.activeId).toBe('baseline')
    expect(s.autoHistory).toHaveLength(1)
    expect(event).toHaveBeenCalled()
    event.mockRestore()
  })
})
