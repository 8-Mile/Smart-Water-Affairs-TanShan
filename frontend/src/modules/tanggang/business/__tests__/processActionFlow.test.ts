import {beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useScenarioStore} from '../../simulation/store'
import {simContext} from '../../simulation/mockContext'
import {simNodeOrigin,simNodeReturnPath} from '../processReviewNavigation'

describe('M11 工艺节点模拟核查与处置链',()=>{
  beforeEach(()=>setActivePinia(createPinia()))
  const entry={
    systemId:'middle' as const,
    facilityId:'EQ-P-MID',
    facilityName:'中压除尘泵组',
    state:'fault' as const,
    note:'当前为模拟泵组故障，建议核对压力电流及泵组运行状态',
  }
  it('没有当前SIM情景不能保存节点核查，不可虚构工单',()=>{
    const s=useScenarioStore()
    expect(()=>s.recordProcessCheck(entry)).toThrow('未启动')
    expect(s.processChecks).toHaveLength(0)
  })
  it('核查可跨工艺与监护页面复用，但只保存在同轮SIM内存',()=>{
    const s=useScenarioStore()
    s.start('pump-fault')
    const result=s.recordProcessCheck(entry)
    expect(result.run_uid).toBe(s.runUid)
    expect(result.scenario_id).toBe('pump-fault')
    expect(result.data_mode).toBe('SIM')
    expect(result.field_verified).toBe(false)
    expect(result.production_alarm_created).toBe(false)
    expect(result.repair_order_created).toBe(false)
    expect(s.processChecks).toHaveLength(1)
    const context=simContext(s)!
    expect(context.process_checks).toEqual([result])
    expect(context.process_checks?.[0]?.run_uid).toBe(context.run_uid)
    const from={
      from_system:'middle',from_facility:'EQ-P-MID',run_uid:s.runUid,
    }
    expect(simNodeOrigin(from,s.processChecks,s.runUid)).toEqual(result)
    expect(simNodeReturnPath(result)).toBe('/port/process/middle?facility=EQ-P-MID')
    // Repeated notes update one current-run snapshot; no shadow production case.
    s.recordProcessCheck({...entry,note:'第二次模拟核查，保持需人工确认结论'})
    expect(s.processChecks).toHaveLength(1)
    expect(s.processChecks[0]?.note).toContain('第二次')
    s.start('peak')
    expect(s.processChecks).toHaveLength(0)
    expect(simNodeOrigin(from,s.processChecks,s.runUid)).toBeNull()
  })
  it('非法设施、状态、跨轮次来源和无效核查意见必须拒绝',()=>{
    const s=useScenarioStore()
    s.start('peak')
    expect(()=>s.recordProcessCheck({...entry,facilityId:'../../admin'})).toThrow()
    expect(()=>s.recordProcessCheck({...entry,systemId:'foreign' as never})).toThrow()
    expect(()=>s.recordProcessCheck({...entry,state:'repaired' as never})).toThrow()
    expect(()=>s.recordProcessCheck({...entry,note:'太短'})).toThrow()
    expect(()=>s.recordProcessCheck({...entry,note:'a'.repeat(601)})).toThrow()
    expect(s.processChecks).toHaveLength(0)
    const ok=s.recordProcessCheck({...entry,state:'attention'})
    expect(simNodeOrigin({
      from_system:'middle',from_facility:'EQ-P-MID',run_uid:'fake',
    },s.processChecks,s.runUid)).toBeNull()
    expect(simNodeOrigin({
      from_system:'fog',from_facility:'EQ-P-MID',run_uid:s.runUid,
    },s.processChecks,s.runUid)).toBeNull()
    expect(simNodeOrigin({
      from_system:'middle',from_facility:'EQ-OTHER',run_uid:s.runUid,
    },s.processChecks,s.runUid)).toBeNull()
    expect(ok.state).toBe('attention')
  })
  it('六系统每个节点的意见隔离，退出情景即清空',()=>{
    const s=useScenarioStore()
    s.start('storm')
    for(const [systemId,facilityId] of [
      ['rain','EQ-Y-DRAIN'],
      ['middle','EQ-P-MID'],
      ['pool','EQ-DP-TANK'],
      ['fog','EQ-Y-FOG'],
      ['mineral','EQ-WWT-WQ'],
      ['domestic','EQ-DOM-SEWAGE'],
    ] as const){
      s.recordProcessCheck({...entry,systemId,facilityId,
        state:'attention',note:'为当前SIM节点记录独立的人工模拟核查依据'})
    }
    expect(s.processChecks.map(x=>x.system_id))
      .toEqual(['rain','middle','pool','fog','mineral','domestic'])
    expect(simContext(s)?.process_checks).toHaveLength(6)
    s.stop()
    expect(s.processChecks).toEqual([])
    expect(simContext(s)).toBeUndefined()
  })
})
