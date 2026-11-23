import {describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {SCENARIOS,calculateScenario} from '../engine'
import {autoScenarioAt} from '../autoWaterFeed'
import {useScenarioStore} from '../store'
import {
  TELEMETRY_CONTRACT_VERSION,TELEMETRY_POINTS,
  SAMPLE_STALE_AFTER_MS,makeMockTelemetryFrame,assessTelemetryFrame,
} from '../telemetryContract'
import {
  asSimulatedEvents,asProductionAlarmSummaries,separateOperationsEventLanes,
} from '../operationsEventReadModel'
import {
  emptyCaseState,evaluateOperatingCases,
} from '../operationsCases'
import type {AlarmItem} from '@/api/alarm'
import type {OperatingCase} from '../operationsCases'

const AT='2026-11-23T09:30:00.000Z'
const later=(ms:number)=>new Date(Date.parse(AT)+ms).toISOString()
const fresh=()=>makeMockTelemetryFrame(autoScenarioAt(0),0,AT)

describe('M22采集字段契约和数据质量守门',()=>{
  it('自动Mock包携带来源、单位、时间与质量，不是正式设备点位',()=>{
    const frame=fresh()
    expect(frame.schemaVersion).toBe(TELEMETRY_CONTRACT_VERSION)
    expect(frame.sourceMode).toBe('SIM')
    expect(frame.fieldVerified).toBe(false)
    expect(frame.modelOnly).toBe(true)
    expect(Object.keys(frame.points).sort()).toEqual([...TELEMETRY_POINTS].sort())
    expect(Object.values(frame.points).every(p=>
      p.deviceBinding===null&&p.quality==='SYNTHETIC'&&p.sampleAt===AT)).toBe(true)
    const a=assessTelemetryFrame(frame,AT)
    expect(a.frameQuality).toBe('synthetic')
    expect(a.modelCanCalculate).toBe(true)
    expect(a.productionEligible).toBe(false)
    for(let seq=0;seq<20;seq++){
      const at=later(seq*8000)
      const f=makeMockTelemetryFrame(autoScenarioAt(seq),seq,at)
      expect(assessTelemetryFrame(f,at).modelCanCalculate).toBe(true)
    }
  })
  it('缺测、坏数据、过期时间和未来时间均不能进入自动分析',()=>{
    const missing=fresh()
    missing.points.pressureMpa={...missing.points.pressureMpa,value:null,quality:'MISSING'}
    const m=assessTelemetryFrame(missing,AT)
    expect(m.frameQuality).toBe('missing')
    expect(m.missingPoints).toContain('pressureMpa')
    expect(m.modelCanCalculate).toBe(false)

    const stale=assessTelemetryFrame(fresh(),later(SAMPLE_STALE_AFTER_MS+1))
    expect(stale.frameQuality).toBe('stale')
    expect(stale.stalePoints).toContain('rainMm')
    expect(stale.modelCanCalculate).toBe(false)

    const altered=fresh()
    altered.points.currentA.value=Infinity
    expect(assessTelemetryFrame(altered,AT).frameQuality).toBe('invalid')

    const future=fresh()
    future.points.flowM3h.sampleAt=later(30000)
    expect(assessTelemetryFrame(future,AT).frameQuality).toBe('invalid')
    expect(()=>makeMockTelemetryFrame(SCENARIOS.baseline,-1,AT)).toThrow()
  })
  it('伪造现场测量或设备绑定不能把模拟点升级成生产数据',()=>{
    const fake=fresh()
    fake.sourceMode='MEASURED'
    fake.fieldVerified=true
    fake.modelOnly=false
    fake.feedId='field-gateway'
    expect(assessTelemetryFrame(fake,AT)).toMatchObject({
      frameQuality:'invalid',modelCanCalculate:false,productionEligible:false,
    })
    const badBind=fresh()
    badBind.points.pressureMpa.deviceBinding='PLANT-PLC-01'
    expect(assessTelemetryFrame(badBind,AT).frameQuality).toBe('invalid')
    const badQuality=fresh()
    badQuality.points.pressureMpa.quality='GOOD'
    expect(assessTelemetryFrame(badQuality,AT).frameQuality).toBe('invalid')
  })
  it('统一状态保留最新一帧质量并且切人工模式/退出时清空Mock来源',()=>{
    setActivePinia(createPinia())
    const store=useScenarioStore()
    store.startAuto()
    expect(store.autoTelemetryFrame?.sequence).toBe(0)
    expect(store.telemetryAssessment?.frameQuality).toBe('synthetic')
    expect(store.telemetryAssessment?.productionEligible).toBe(false)
    store.advanceAuto()
    expect(store.autoTelemetryFrame?.sequence).toBe(1)
    expect(store.simulatedEventViews).toEqual([])
    for(let i=0;i<5;i++)store.advanceAuto()
    expect(store.simulatedEventViews.length).toBeGreaterThan(0)
    expect(store.simulatedEventViews.every(x=>x.lane==='SIMULATION'&&!x.canDispatch)).toBe(true)
    store.start('peak')
    expect(store.autoTelemetryFrame).toBeNull()
    store.stop()
    expect(store.simulatedEventViews).toEqual([])
  })
})

describe('M22事件读模型：模拟与正式告警严格分轨',()=>{
  const official={
    id:1,rule_id:7,rule_name:'已配置的现场规则',equipment_id:12,
    equipment_name:'泵房设备',alarm_type_code:'PRESSURE',alarm_level:2,
    alarm_status:'pending',alarm_time:AT,
  } as AlarmItem

  it('两类事件可采用同结构呈现，但ID、跳转、来源完全隔离',()=>{
    const result=calculateScenario(SCENARIOS.peak)
    let state=emptyCaseState()
    state=evaluateOperatingCases(state,result,0,AT)
    state=evaluateOperatingCases(state,result,1,later(8000))
    const groups=separateOperationsEventLanes(state.cases,[official])
    expect(groups.simulation.length).toBeGreaterThan(0)
    expect(groups.production).toHaveLength(1)
    expect(groups.simulation.every(x=>
      x.key.startsWith('sim:')&&x.lane==='SIMULATION'&&
      x.quality==='SYNTHETIC'&&!x.canDispatch&&!x.fieldVerified)).toBe(true)
    expect(groups.production[0]).toMatchObject({
      key:'alarm:1',lane:'PRODUCTION',quality:'NOT_ASSESSED',
      fieldVerified:false,detailUrl:'/alarm/realtime',canDispatch:false,
    })
    expect(groups.simulation.every(x=>x.key!==groups.production[0]?.key)).toBe(true)
  })
  it('正式告警只有有效数据库标识才能进入生产读通道',()=>{
    expect(()=>asProductionAlarmSummaries([{...official,id:0}])).toThrow()
    expect(()=>asProductionAlarmSummaries([{...official,alarm_time:'not-time'}])).toThrow()
    expect(()=>asProductionAlarmSummaries([{...official,alarm_level:7}])).toThrow()
    expect(asProductionAlarmSummaries([])).toEqual([])
    expect(asSimulatedEvents([])).toEqual([])
  })
  it('任何伪装正式处理的SIM事件被拒绝',()=>{
    let state=emptyCaseState()
    state=evaluateOperatingCases(state,calculateScenario(SCENARIOS.storm),0,AT)
    state=evaluateOperatingCases(state,calculateScenario(SCENARIOS.storm),1,later(8000))
    const forged={...state.cases[0]!,productionAlarmCreated:true} as unknown as OperatingCase
    expect(()=>asSimulatedEvents([forged])).toThrow()
  })
})
