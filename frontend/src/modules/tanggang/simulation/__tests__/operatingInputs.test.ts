import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {SCENARIOS} from '../engine'
import {useScenarioStore} from '../store'
import {calculateScenario} from '../engine'

describe('M23运行参数统一入口：业务数据可见可改，自动与人工互斥',()=>{
  beforeEach(()=>setActivePinia(createPinia()))
  it('改用水需求及总供水能力，直接联动实际分配与缺口',()=>{
    const s=useScenarioStore()
    s.startAuto()
    const copy=structuredClone(SCENARIOS.peak.inputs)
    copy.capacityM3h=82
    copy.reservedM3h=12
    copy.terminals[0]!.demandM3h=67
    s.applyOperatorInputs(copy,'peak')
    expect(s.activeId).toBe('peak')
    expect(s.autoEnabled).toBe(false)
    expect(s.autoTelemetryFrame).toBeNull()
    expect(s.result?.usableCapacityM3h).toBe(70)
    expect(s.result?.terminalAssessments[0]?.demandM3h).toBe(67)
    expect(s.result?.shortageM3h).toBeGreaterThan(0)
    expect(s.waterEconomics?.shortageM3h).toEqual(s.result?.shortageM3h)
    expect(s.supplyPlans).toHaveLength(4)
  })
  it('中压泵异常在真实规则计算中出现，自动恢复能重新按Mock帧运行',()=>{
    const s=useScenarioStore()
    s.startAuto()
    const copy=structuredClone(SCENARIOS.baseline.inputs)
    copy.pumpState='fault'
    copy.pressureMpa=0.78
    copy.currentA=132
    s.applyOperatorInputs(copy,'baseline')
    expect(s.monitorEvidence?.risk).toBe('critical')
    expect(s.result?.events.map(e=>e.id)).toContain('SIM-PUMP')
    expect(s.autoEnabled).toBe(false)
    s.advanceAuto()
    expect(s.activeInputs?.pumpState).toBe('fault')
    s.resumeAuto()
    expect(s.autoEnabled).toBe(true)
    expect(s.result?.events.map(e=>e.id)).not.toContain('SIM-PUMP')
    expect(s.autoTelemetryFrame?.sourceMode).toBe('SIM')
  })
  it('直接编辑降雨及集水参数，模型响应雨量并计算条件溢流',()=>{
    const s=useScenarioStore()
    s.startAuto()
    const copy=structuredClone(SCENARIOS.storm.inputs)
    copy.rainMm=120
    copy.rainStorageCapacityM3=800
    copy.rainStorageInitialM3=730
    s.applyOperatorInputs(copy,'storm')
    expect(s.result?.input.rainMm).toBe(120)
    expect(s.result?.rainOverflowM3).toBeGreaterThan(0)
    expect(s.result?.rainRisk).toBe('critical')
  })
  it('校验失败时原工况保持不变，不能污染自动模型',()=>{
    const s=useScenarioStore()
    s.startAuto()
    const previous=JSON.parse(JSON.stringify(s.activeInputs))
    const inputs=structuredClone(SCENARIOS.baseline.inputs)
    inputs.reservedM3h=inputs.capacityM3h+1
    expect(()=>s.applyOperatorInputs(inputs,'baseline')).toThrow()
    expect(s.autoEnabled).toBe(true)
    expect(s.activeInputs).toEqual(previous)
    inputs.reservedM3h=10
    inputs.terminals=[]
    expect(()=>s.applyOperatorInputs(inputs,'baseline')).toThrow()
    expect(s.autoEnabled).toBe(true)
  })
})
