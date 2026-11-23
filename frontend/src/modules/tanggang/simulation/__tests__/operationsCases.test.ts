import {beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {SCENARIOS,calculateScenario} from '../engine'
import {
  emptyCaseState,evaluateOperatingCases,acknowledgeOperatingCase,
  closeRecoveredOperatingCase,activeOperatingCases,
  OPEN_CONFIRM_FRAMES,RECOVERY_CONFIRM_FRAMES,
} from '../operationsCases'
import {useScenarioStore} from '../store'

const TIME='2026-11-23T08:30:00.000Z'
const sample=(name:keyof typeof SCENARIOS)=>calculateScenario(SCENARIOS[name])
const add=(state:ReturnType<typeof emptyCaseState>,name:keyof typeof SCENARIOS,frame:number)=>
  evaluateOperatingCases(state,sample(name),frame,TIME)

describe('M21 自动监护事件：同一Mock源业务闭环',()=>{
  it('连续异常达到确认门槛自动生成事件，去重并保留工程限定',()=>{
    let state=emptyCaseState()
    state=add(state,'peak',0)
    expect(state.cases).toHaveLength(0)
    state=add(state,'peak',1)
    expect(state.cases.length).toBeGreaterThan(0)
    expect(state.cases.every(c=>c.confirmationCount>=OPEN_CONFIRM_FRAMES)).toBe(true)
    expect(state.cases.every(c=>c.dataMode==='SIM'&&
      !c.fieldVerified&&!c.productionAlarmCreated&&
      !c.productionWorkOrderCreated&&!c.commandExecuted)).toBe(true)
    const titles=state.cases.map(c=>c.eventId)
    state=add(state,'peak',2)
    expect(state.cases.map(c=>c.eventId)).toEqual(titles)
    expect(new Set(state.cases.map(c=>c.eventId)).size).toBe(state.cases.length)
    expect(state.cases.some(c=>c.eventId==='SIM-PUMP')).toBe(true)
    expect(state.cases.some(c=>c.eventId==='SIM-SUPPLY')).toBe(true)
  })
  it('中压泵事件只提示设计业务邻接，不假定射雾泵物理故障',()=>{
    let state=add(add(emptyCaseState(),'pump-fault',0),'pump-fault',1)
    const casePump=state.cases.find(c=>c.eventId==='SIM-PUMP')!
    expect(casePump.sourceProcess).toBe('middle')
    expect(casePump.relatedProcesses.some(p=>p.systemId==='pool')).toBe(true)
    expect(casePump.relatedProcesses.some(p=>p.systemId==='domestic')).toBe(false)
    expect(casePump.relatedProcesses.every(p=>p.verified===false)).toBe(true)
    expect(casePump.recommendations.some(s=>s.includes('确认'))).toBe(true)
  })
  it('未人工确认、未连续两帧恢复或异常再次出现时禁止关闭',()=>{
    let state=add(add(emptyCaseState(),'pump-fault',0),'pump-fault',1)
    const id=state.cases.find(c=>c.eventId==='SIM-PUMP')!.id
    expect(()=>closeRecoveredOperatingCase(state,id,'现场尚未核查，先做关闭',TIME))
      .toThrow('先人工确认')
    expect(()=>acknowledgeOperatingCase(state,id,'短',TIME)).toThrow('8至600字')
    state=acknowledgeOperatingCase(state,id,'核对压力与泵组状态，待人工复核',TIME)
    expect(()=>acknowledgeOperatingCase(state,id,'重复确认事件不能再次修改',TIME))
      .toThrow('重复确认')
    expect(()=>closeRecoveredOperatingCase(state,id,'仅第一轮未恢复，无现场证据',TIME))
      .toThrow('两帧')
    state=add(state,'baseline',2)
    expect(state.cases.find(c=>c.id===id)?.normalFrames).toBe(1)
    expect(()=>closeRecoveredOperatingCase(state,id,'连续采样不足不能关闭事件',TIME))
      .toThrow('两帧')
    state=add(state,'pump-fault',3)
    expect(state.cases.find(c=>c.id===id)?.normalFrames).toBe(0)
    state=add(add(state,'baseline',4),'baseline',5)
    expect(state.cases.find(c=>c.id===id)?.normalFrames).toBe(RECOVERY_CONFIRM_FRAMES)
    state=closeRecoveredOperatingCase(state,id,'已核对连续两个模拟恢复帧，仅关闭SIM候选事件',TIME)
    expect(state.cases.find(c=>c.id===id)?.status).toBe('closed')
    expect(state.cases.find(c=>c.id===id)?.productionAlarmCreated).toBe(false)
    expect(activeOperatingCases(state)).toHaveLength(
      state.cases.filter(c=>c.status!=='closed').length)
    state=add(add(state,'pump-fault',6),'pump-fault',7)
    const pumpEpisodes=state.cases.filter(c=>c.eventId==='SIM-PUMP')
    expect(pumpEpisodes).toHaveLength(2)
    expect(pumpEpisodes[0]?.id).not.toBe(pumpEpisodes[1]?.id)
  })
  it('模拟雨水事件只与雨污水业务链关联，不与生活污水混池',()=>{
    let state=add(add(emptyCaseState(),'storm',0),'storm',1)
    const rain=state.cases.find(c=>c.eventId==='SIM-RAIN')
    expect(rain).toBeTruthy()
    expect(rain?.sourceProcess).toBe('rain')
    expect(rain?.relatedProcesses.some(p=>p.systemId==='mineral')).toBe(true)
    expect(rain?.relatedProcesses.some(p=>p.systemId==='domestic')).toBe(false)
  })
  it('未经认证的数据不能伪造、非法时间戳失败',()=>{
    expect(()=>evaluateOperatingCases(emptyCaseState(),sample('peak'),-1,TIME))
      .toThrow()
    expect(()=>evaluateOperatingCases(emptyCaseState(),sample('peak'),1,'abc'))
      .toThrow()
    expect(()=>acknowledgeOperatingCase(emptyCaseState(),'x','这是一条有效的模拟复核意见',TIME))
      .toThrow()
  })
})
describe('M21 Pinia业务页同源运行、手动控制及注销隔离',()=>{
  beforeEach(()=>setActivePinia(createPinia()))
  it('自动推进到高峰时自动建候选；路由切换不清空；退出登录模拟复位清空',()=>{
    const store=useScenarioStore()
    store.startAuto()
    expect(store.operatingCases).toHaveLength(0)
    for(let i=0;i<7;i++)store.advanceAuto()
    expect(store.pendingCaseCount).toBeGreaterThan(0)
    expect(store.newCaseCount).toBeGreaterThan(0)
    const id=store.activeCases[0]!.id
    store.acknowledgeCase(id,'记录自动发现的异常待核查，不发现场指令')
    expect(store.operatingCases.find(x=>x.id===id)?.status).toBe('acknowledged')
    const previousLength=store.operatingCases.length
    store.start('baseline')
    expect(store.autoEnabled).toBe(false)
    expect(store.operatingCases).toHaveLength(previousLength)
    expect(()=>store.closeRecoveredCase(id,'已在手动模式，不能自动恢复复核')).toThrow()
    store.stop()
    expect(store.pendingCaseCount).toBe(0)
    expect(store.operatingCases).toHaveLength(0)
  })
})
