import {beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {SCENARIOS,calculateScenario} from '../engine'
import {useScenarioStore} from '../store'
describe('唐港统一情景推演计算和隔离',()=>{
  it('常态无缺口，未误报',()=>{
    const r=calculateScenario(SCENARIOS.baseline)
    expect(r.demandedM3h).toBe(56)
    expect(r.deliveredM3h).toBe(56)
    expect(r.shortageM3h).toBe(0)
    expect(r.events).toHaveLength(0)
  })
  it('小数流量不能因单终端舍入误报供水缺口或泵组关注',()=>{
    const scenario={...SCENARIOS.baseline,inputs:{
      ...SCENARIOS.baseline.inputs,
      capacityM3h:107.87,
      terminals:[
        {...SCENARIOS.baseline.inputs.terminals[0]!,demandM3h:33.97},
        {...SCENARIOS.baseline.inputs.terminals[1]!,demandM3h:22.14},
      ],
      currentA:83.9,pressureMpa:1.209,
    }}
    const r=calculateScenario(scenario)
    expect(r.demandedM3h).toBe(56.1)
    expect(r.deliveredM3h).toBe(56.1)
    expect(r.shortageM3h).toBe(0)
    expect(r.events).toHaveLength(0)
    expect(r.pumpDiagnosis.level).toBe('normal')
  })
  it('仅供水能力不足不应虚构泵设备监护异常',()=>{
    const scenario={...SCENARIOS.baseline,inputs:{
      ...SCENARIOS.baseline.inputs,
      capacityM3h:36,
      pressureMpa:1.22,currentA:85,pumpState:'running' as const,
    }}
    const result=calculateScenario(scenario)
    expect(result.shortageM3h).toBeGreaterThan(0)
    expect(result.events.map(x=>x.id)).toContain('SIM-SUPPLY')
    expect(result.events.map(x=>x.id)).not.toContain('SIM-PUMP')
    expect(result.pumpDiagnosis.level).toBe('normal')
  })
  it('多机集中用水使供水缺口、储量预测、监护线索一致',()=>{
    const r=calculateScenario(SCENARIOS.peak)
    expect(r.demandedM3h).toBe(139)
    expect(r.usableCapacityM3h).toBe(105)
    expect(r.deliveredM3h).toBe(105)
    expect(r.shortageM3h).toBe(34)
    expect(r.hoursToSafety).toBe(11)
    expect(r.forecastPoolM3).toBe(350)
    expect(r.pumpDiagnosis.level).toBe('attention')
    expect(r.events.map(e=>e.id)).toContain('SIM-SUPPLY')
    expect(r.events.map(e=>e.id)).toContain('SIM-POOL')
  })
  it('泵故障降低假设能力，保留需人工核查的监护证据',()=>{
    const r=calculateScenario(SCENARIOS['pump-fault'])
    expect(r.demandedM3h).toBe(94)
    expect(r.usableCapacityM3h).toBe(45)
    expect(r.shortageM3h).toBe(49)
    expect(r.pumpDiagnosis.level).toBe('critical')
    expect(r.pumpDiagnosis.title).toContain('模拟')
  })
  it('强降雨只改变演示集水池，不能直接当生产供水',()=>{
    const r=calculateScenario(SCENARIOS.storm)
    expect(r.rainCapturedM3).toBe(1036.8)
    expect(r.rainOverflowM3).toBe(406.8)
    expect(r.rainRisk).toBe('critical')
    expect(r.shortageM3h).toBe(0)
    expect(r.events.map(e=>e.id)).toContain('SIM-RAIN')
  })
  it('不合理库容和重复终端必须拒绝计算',()=>{
    expect(()=>calculateScenario({...SCENARIOS.peak,inputs:{...SCENARIOS.peak.inputs,poolSafetyM3:3000}})).toThrow()
    expect(()=>calculateScenario({...SCENARIOS.baseline,inputs:{...SCENARIOS.baseline.inputs,terminals:[
      SCENARIOS.baseline.inputs.terminals[0]!,SCENARIOS.baseline.inputs.terminals[0]!,
    ]}})).toThrow()
  })
  describe('单入口共享数据源与停止隔离',()=>{
    beforeEach(()=>setActivePinia(createPinia()))
    it('所有业务页读取相同的计算结果，退出后模拟数据撤除',()=>{
      const s=useScenarioStore()
      expect(s.result).toBeNull()
      s.start('peak')
      expect(s.result?.shortageM3h).toBe(34)
      const firstRun=s.runNumber
      s.start('storm')
      expect(s.result?.rainOverflowM3).toBe(406.8)
      expect(s.runNumber).toBe(firstRun+1)
      s.stop()
      expect(s.running).toBe(false)
      expect(s.result).toBeNull()
    })
  })
})
