import {describe,expect,it} from 'vitest'
import {SCENARIOS,calculateScenario} from '../../simulation/engine'
import {processWorkflow,processMonitorRelevant} from '../processWorkflow'

describe('M12 six-system domain-specific workflow & scenario scope',()=>{
  it('six systems never all route into the unrelated middle-pump monitor',()=>{
    const table={
      fog:null,
      middle:'/port/water/supply',
      mineral:null,
      rain:'/port/water/rain-risk',
      pool:'/port/water/supply',
      domestic:null,
    }
    for(const [id,path] of Object.entries(table)){
      const workflow=processWorkflow(id,null)
      expect(workflow.primary?.path||null,id).toBe(path)
      expect(workflow.supportsDecision,id).toBe(['middle','pool'].includes(id))
      expect(workflow.scope).not.toBe('')
      expect(workflow.simSummary).toBeNull()
    }
  })
  it('only explicitly defined middle-pump facility can open middle-pump monitor',()=>{
    for(const system of ['fog','mineral','rain','pool','domestic']){
      expect(processMonitorRelevant(system,'EQ-P-MID'),system).toBe(false)
      expect(processMonitorRelevant(system,'EQ-NPOOL-LIFT'),system).toBe(false)
    }
    expect(processMonitorRelevant('middle','EQ-P-MID')).toBe(true)
    expect(processMonitorRelevant('middle','EQ-P-METER')).toBe(true)
    expect(processMonitorRelevant('middle','EQ-P-PLC')).toBe(false)
  })
  it('rain risk is single independent demo basin, not two named real pools',()=>{
    const wet=processWorkflow('rain',calculateScenario(SCENARIOS.storm))
    expect(wet.simSummary).toContain('独立模拟集水单元')
    expect(wet.simSummary).toContain('80 mm')
    expect(wet.simSummary).not.toMatch(/北侧|南侧|全部雨水管网/)
    const dry=processWorkflow('rain',calculateScenario(SCENARIOS.peak))
    expect(dry.simSummary).toBeNull()
    expect(dry.simNoEvidence).toContain('未设置降雨')
  })
  it('supply model never claims real pool capacities or engineering pipe linkage',()=>{
    const peak=calculateScenario(SCENARIOS.peak)
    const supply=processWorkflow('middle',peak)
    expect(supply.simSummary).toContain('139 m³/h')
    expect(supply.simSummary).toContain('34 m³/h')
    const pool=processWorkflow('pool',peak)
    expect(pool.simSummary).toContain('统一模拟水池')
    expect(pool.simSummary).not.toContain('除尘水池储量')
    expect(pool.scope).toContain('不能')
    const unrelated=processWorkflow('middle',calculateScenario(SCENARIOS.storm))
    expect(unrelated.simSummary).toContain('独立供水参考')
  })
  it('three systems without a quantitative model keep local mock checks but no fake professional alerts',()=>{
    const storm=calculateScenario(SCENARIOS.storm)
    for(const id of ['fog','mineral','domestic']){
      const m=processWorkflow(id,storm)
      expect(m.primary).toBeNull()
      expect(m.simSummary).toBeNull()
      expect(m.simNoEvidence).toContain('没有覆盖')
      expect(m.scope).toContain('Mock')
      expect(m.supportsDecision).toBe(false)
    }
  })
})
