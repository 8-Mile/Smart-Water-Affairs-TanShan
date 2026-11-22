import {beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useScenarioStore} from '../store'

describe('TG-303-305 SIM-only monitor case workflow',()=>{
  beforeEach(()=>setActivePinia(createPinia()))
  it('无情景时不能发起核查、也不能写任何正式状态',()=>{
    const s=useScenarioStore()
    expect(()=>s.beginMonitorReview()).toThrow()
    expect(s.monitorReview).toBeNull()
    expect(s.monitorEvidence).toBeNull()
  })
  it('统一情景下可以核查并记录，不能冒充现场复核',()=>{
    const s=useScenarioStore()
    s.start('peak')
    s.beginMonitorReview()
    const reviewId=s.monitorReview?.caseId
    expect(reviewId).toBe('SIM-RUN-1-MON')
    expect(s.monitorReview?.status).toBe('investigating')
    expect(s.monitorReview?.fieldValidated).toBe(false)
    expect(()=>s.recordMonitorReview('requires-field-check','无')).toThrow()
    expect(()=>s.recordMonitorReview('sim-recovery-conditions','继续检查电流异常')).toThrow()
    s.recordMonitorReview('requires-field-check','需要核对真实泵站设备铭牌、点表与运行历史')
    expect(s.monitorReview?.status).toBe('recorded')
    expect(s.monitorReview?.outcome).toBe('requires-field-check')
    expect(s.monitorReview?.dataMode).toBe('SIM')
    expect(()=>s.recordMonitorReview('requires-field-check','重复提交')).toThrow()
  })
  it('演示恢复条件为真也不等于正式设备恢复',()=>{
    const s=useScenarioStore()
    s.start('baseline')
    expect(s.monitorEvidence?.recoveryCandidate).toBe(true)
    s.beginMonitorReview()
    s.recordMonitorReview('sim-recovery-conditions','合成样本满足演示恢复条件，但需要现场人工验证')
    expect(s.monitorReview?.fieldValidated).toBe(false)
    expect(s.monitorReview?.outcome).toBe('sim-recovery-conditions')
  })
  it('切换场景、停止时清空模拟复核记录',()=>{
    const s=useScenarioStore()
    s.start('peak')
    s.beginMonitorReview()
    s.recordMonitorReview('requires-field-check','需要现场核对电流测点及运行工况')
    const oldRun=s.runNumber
    s.start('pump-fault')
    expect(s.runNumber).toBe(oldRun+1)
    expect(s.monitorReview).toBeNull()
    s.beginMonitorReview()
    expect(s.monitorReview?.runNumber).toBe(s.runNumber)
    s.stop()
    expect(s.monitorReview).toBeNull()
    expect(s.monitorEvidence).toBeNull()
  })
  it('规则结果复用当前有效全局模拟输入，不使用另一套状态',()=>{
    const s=useScenarioStore()
    s.start('peak',{capacityM3h:125})
    expect(s.monitorEvidence?.scenarioId).toBe('peak')
    expect(s.result?.usableCapacityM3h).toBe(115)
    expect(s.monitorEvidence?.rules.find(x=>x.id==='SIM-HIGH-CURRENT')?.outcome).toBe('TRIGGERED')
    expect(s.monitorEvidence?.dataMode).toBe('SIM')
  })
})
