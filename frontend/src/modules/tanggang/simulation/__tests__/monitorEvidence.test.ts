import {describe,expect,it} from 'vitest'
import {SCENARIOS} from '../engine'
import {assessSimMonitor,syntheticMonitorTrace} from '../monitorEvidence'

describe('TG-301-305 监护质量、持续规则和恢复复核（纯SIM，不写告警）',()=>{
  it('常态演示不命中异常规则；恢复条件也只是合成快照判断',()=>{
    const r=assessSimMonitor(SCENARIOS.baseline)
    expect(r.risk).toBe('normal')
    expect(r.rules.every(x=>x.outcome==='CLEAR')).toBe(true)
    expect(r.recoveryCandidate).toBe(true)
    expect(r.dataMode).toBe('SIM')
    expect(r.fieldValidated).toBe(false)
    expect(r.qualityVerified).toBe(false)
  })
  it('高峰时模拟电流持续越限，引出待核查线索而非确认故障',()=>{
    const r=assessSimMonitor(SCENARIOS.peak)
    expect(r.risk).toBe('attention')
    const c=r.rules.find(x=>x.id==='SIM-HIGH-CURRENT')!
    expect(c.outcome).toBe('TRIGGERED')
    expect(c.sustainedSec).toBe(90)
    expect(c.requiredSec).toBe(60)
    expect(r.recoveryCandidate).toBe(false)
    expect(r.dataWarnings.join('|')).toMatch(/合成样本/)
  })
  it('泵故障状态是直接演示异常，不将停机或异常状态下的低压误判为持续低压规则',()=>{
    const r=assessSimMonitor(SCENARIOS['pump-fault'])
    expect(r.risk).toBe('critical')
    expect(r.rules[0]?.outcome).toBe('TRIGGERED')
    expect(r.rules[1]?.outcome).toBe('INSUFFICIENT')
    expect(r.rules[2]?.outcome).toBe('INSUFFICIENT')
  })
  it('实际缺测时不按0参与规则；GOOD配非法数据直接拒绝',()=>{
    const samples=syntheticMonitorTrace(SCENARIOS.peak)
    for(const p of samples){p.currentA=null;p.quality.currentA='MISSING'}
    const r=assessSimMonitor(SCENARIOS.peak,samples)
    expect(r.rules[2]?.outcome).toBe('INSUFFICIENT')
    expect(r.risk).toBe('insufficient')
    samples[0]!.quality.currentA='GOOD'
    expect(()=>assessSimMonitor(SCENARIOS.peak,samples)).toThrow()
  })
  it('停机时正常的零流量和低压力，不自动产生运行时故障',()=>{
    const samples=syntheticMonitorTrace(SCENARIOS.baseline)
    for(const p of samples){p.pumpState='stopped';p.pressureMpa=0;p.currentA=0;p.flowM3h=0}
    const r=assessSimMonitor(SCENARIOS.baseline,samples)
    expect(r.rules[0]?.outcome).toBe('CLEAR')
    expect(r.rules[1]?.outcome).toBe('INSUFFICIENT')
    expect(r.rules[2]?.outcome).toBe('INSUFFICIENT')
    expect(r.risk).toBe('insufficient')
  })
  it('持续越限需连贯；数据中断会重置连续命中时间',()=>{
    const samples=syntheticMonitorTrace(SCENARIOS.peak)
    samples[2]!.quality.currentA='OFFLINE'
    const r=assessSimMonitor(SCENARIOS.peak,samples)
    expect(r.rules[2]?.outcome).toBe('CLEAR')
    expect(r.rules[2]?.sustainedSec).toBe(30)
  })
  it('时间乱序和混入真实dataMode必须拒绝，不伪造历史',()=>{
    const a=syntheticMonitorTrace(SCENARIOS.peak)
    a[1]!.offsetSec=a[0]!.offsetSec
    expect(()=>assessSimMonitor(SCENARIOS.peak,a)).toThrow()
    const b=syntheticMonitorTrace(SCENARIOS.peak)
    b[0]!.dataMode='MEASURED' as 'SIM'
    expect(()=>assessSimMonitor(SCENARIOS.peak,b)).toThrow()
  })
  it('多个情景的监护规则与供水情景共用同一输入，不篡改原始预置',()=>{
    const before=JSON.stringify(SCENARIOS)
    for(const s of Object.values(SCENARIOS)){
      const r=assessSimMonitor(s)
      expect(r.scenarioId).toBe(s.id)
      expect(r.trace[r.trace.length-1]?.currentA).toBe(s.inputs.currentA)
      expect(r.trace[r.trace.length-1]?.pressureMpa).toBe(s.inputs.pressureMpa)
    }
    expect(JSON.stringify(SCENARIOS)).toBe(before)
  })
})
