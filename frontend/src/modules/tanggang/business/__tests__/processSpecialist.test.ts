import {beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {SCENARIOS} from '../../simulation/engine'
import {mockProcessDevice} from '../processMock'
import {
  SPECIALIST_CASES,SPECIALIST_SYSTEM_IDS,applySpecialistCase,specialistAttentionFacilityIds,
  getSpecialistCase,isSpecialistSystem,specialistAffectsDevice,
} from '../processSpecialist'
import {useProcessSpecialistStore} from '../processSpecialistStore'
import type {TanggangDevice} from '../../mapping/tanggangCatalog'
import regions from '../../../../../public/tanggang/cad/l1-v2_3/region-equipment-v2.3.json'

const catalog=new Map<string,TanggangDevice>()
for(const region of regions.regions){
  for(const device of region.devices){
    catalog.set(device.id,{
      ...device,regionId:region.id,regionName:region.name,
    })
  }
}
function asset(id:string):TanggangDevice{
  const item=catalog.get(id)
  if(!item)throw Error('missing CAD fixture: '+id)
  return item
}
function output(system:string,id:string,caseId:string|null){
  return applySpecialistCase(
    system,mockProcessDevice(asset(id),null),
    getSpecialistCase(caseId,system),
  )
}
describe('M13 射雾、含矿污水与生活污水专业Mock演练',()=>{
  beforeEach(()=>setActivePinia(createPinia()))
  it('三个专业系统有互不混用的9个工况和原始CAD设计设施检查点',()=>{
    expect(Object.keys(SPECIALIST_CASES)).toHaveLength(9)
    for(const [system,profiles] of Object.entries(SPECIALIST_SYSTEM_IDS)){
      expect(isSpecialistSystem(system)).toBe(true)
      expect(profiles).toHaveLength(3)
      for(const id of profiles){
        const caseDef=getSpecialistCase(id,system)!
        expect(caseDef).not.toBeNull()
        expect(caseDef.checkpoints.length).toBeGreaterThanOrEqual(2)
        expect(caseDef.scope).toBeTruthy()
        expect(caseDef.rule).toBeTruthy()
        expect(caseDef.suggestedAction).toBeTruthy()
        for(const point of caseDef.checkpoints){
          expect(catalog.has(point.facilityId),id+':'+point.facilityId).toBe(true)
        }
      }
    }
    expect(getSpecialistCase('fog-low-pressure','mineral')).toBeNull()
    expect(getSpecialistCase('../../script','fog')).toBeNull()
  })
  it('射雾低压只影响室内射雾设备和供水泵，演示阈值不是工程设定',()=>{
    const c=output('fog','EQ-P-FOG','fog-low-pressure')
    const indoor=output('fog','EQ-Y-FOG','fog-low-pressure')
    const plc=output('fog','EQ-P-PLC','fog-low-pressure')
    expect(c.readings.find(x=>x.key==='出口压力')?.value).toBe('0.32 MPa')
    expect(c.readings.find(x=>x.key==='供水流量')?.value).toBe('10.0 L/s')
    expect(indoor.readings.find(x=>x.key==='压力')?.value).toBe('0.29 MPa')
    expect(c.state).toBe('attention')
    expect(indoor.state).toBe('attention')
    expect(plc.state).toBe('running')
    expect([c,indoor,plc].every(x=>x.context==='MOCK_BASELINE')).toBe(true)
    expect([c,indoor,plc].every(x=>!x.productionControlEnabled&&!x.fieldVerified)).toBe(true)
    expect(SPECIALIST_CASES['fog-low-pressure'].rule).toContain('不是设计')
    expect(specialistAttentionFacilityIds(SPECIALIST_CASES['fog-low-pressure']))
      .toEqual(['EQ-P-FOG','EQ-Y-FOG'])
  })
  it('射雾PLC通讯中断不能反推供水泵也故障',()=>{
    const ctrl=output('fog','EQ-P-PLC','fog-control-offline')
    const pump=output('fog','EQ-P-FOG','fog-control-offline')
    expect(ctrl.state).toBe('attention')
    expect(ctrl.readings.find(x=>x.key==='通讯状态')?.value).toBe('Mock中断')
    expect(pump.state).toBe('running')
    expect(pump.readings.every(x=>x.provenance==='MOCK_PROFILE')).toBe(true)
    expect(ctrl.scenarioId).toBeNull()
  })
  it('含矿污水SS和污泥高液位是不同专业检查，不构成排污达标判断',()=>{
    const purifier=output('mineral','EQ-WWT-PURIFIER','mineral-ss-rise')
    const water=output('mineral','EQ-WWT-WQ','mineral-ss-rise')
    const sludge=output('mineral','EQ-WWT-SLUDGE','mineral-ss-rise')
    expect(purifier.state).toBe('attention')
    expect(purifier.readings.find(x=>x.key==='出口SS')?.value).toBe('88 mg/L')
    expect(water.readings.find(x=>x.key==='SS')?.value).toBe('83 mg/L')
    expect(sludge.state).not.toBe('attention')
    const high=output('mineral','EQ-WWT-SLUDGE','mineral-sludge-high')
    expect(high.readings.find(x=>x.key==='污泥液位')?.value).toBe('3.40 m')
    expect(output('mineral','EQ-WWT-FILTER','mineral-sludge-high').state)
      .toBe('attention')
    expect(SPECIALIST_CASES['mineral-ss-rise'].rule).toContain('不作为排放标准')
  })
  it('生活污水备选方案互斥，未选择时没有两路线同时运行的假象',()=>{
    const localId='EQ-DOM-SEWAGE',outboundId='EQ-DOM-LINK'
    const noneA=output('domestic',localId,null)
    const noneB=output('domestic',outboundId,null)
    expect(noneA.readings[0]?.value).toBe('路线待选择（Mock）')
    expect(noneB.highlight?.value).toBe('路线待选择（Mock）')
    expect(noneA.stateLabel).toBe('备选方案未启用')
    expect(noneB.stateLabel).toBe('备选方案未启用')
    const a=output('domestic',localId,'domestic-local-reference')
    const aOther=output('domestic',outboundId,'domestic-local-reference')
    expect(a.readings.find(x=>x.key==='污水处理量')?.value).toBe('24.0 m³/h')
    expect(aOther.readings[0]?.value).toBe('路线待选择（Mock）')
    const b=output('domestic',outboundId,'domestic-outbound-reference')
    const bOther=output('domestic',localId,'domestic-outbound-reference')
    expect(b.readings.find(x=>x.key==='污水流量')?.value).toBe('19.0 m³/h')
    expect(bOther.readings[0]?.value).toBe('路线待选择（Mock）')
    const risk=output('domestic',outboundId,'domestic-outbound-low-flow')
    expect(risk.state).toBe('attention')
    expect(risk.readings.find(x=>x.key==='污水流量')?.value).toBe('2.0 m³/h')
  })
  it('专业Mock互不影响其他系统，也不改变统一供水SIM纯函数输入',()=>{
    const current=mockProcessDevice(asset('EQ-P-MID'),SCENARIOS['pump-fault'])
    const fog=applySpecialistCase('middle',current,SPECIALIST_CASES['fog-low-pressure'])
    expect(fog).toEqual(current)
    expect(current.state).toBe('fault')
    expect(current.readings.find(x=>x.key==='出口压力')?.value).toBe('0.85 MPa')
    expect(specialistAffectsDevice('fog','EQ-Y-FOG',SPECIALIST_CASES['fog-low-pressure'])).toBe(true)
    expect(specialistAffectsDevice('fog','EQ-P-PLC',SPECIALIST_CASES['fog-low-pressure'])).toBe(false)
  })
  it('操作记录仅在Pinia当前浏览器内存；每步模拟查看后生成不含正式事件的记录',()=>{
    const store=useProcessSpecialistStore()
    expect(()=>store.mark('fog','source',true)).toThrow()
    expect(()=>store.select('fog','mineral-ss-rise')).toThrow()
    store.select('fog','fog-low-pressure')
    const steps=SPECIALIST_CASES['fog-low-pressure'].checkpoints
    expect(()=>store.mark('fog','not-real',true)).toThrow()
    store.mark('fog',steps[0]!.id,true)
    expect(()=>store.finish('fog','仅作本轮Mock模拟排查记录')).toThrow('逐项')
    for(const step of steps.slice(1))store.mark('fog',step.id,true)
    expect(()=>store.finish('fog','太短')).toThrow()
    const record=store.finish('fog','模拟确认压力指标为演示阈值，需人工验证真实工况')
    expect(record.data_mode).toBe('MOCK')
    expect(record.field_verified).toBe(false)
    expect(record.production_alarm_created).toBe(false)
    expect(record.repair_order_created).toBe(false)
    expect(record.commands_issued).toBe(false)
    expect(record.independent_of_global_sim).toBe(true)
    expect(store.records.fog?.checkpoint_ids).toHaveLength(3)
    store.select('fog','fog-control-offline')
    expect(store.reviewed.fog).toEqual([])
    expect(store.records.fog).toBeNull()
    store.reset('fog')
    expect(store.selected.fog).toBeNull()
  })
  it('三系统各自演练状态相互独立，切换不污染当前工艺',()=>{
    const store=useProcessSpecialistStore()
    store.select('fog','fog-normal')
    store.select('mineral','mineral-ss-rise')
    store.select('domestic','domestic-outbound-low-flow')
    store.mark('mineral','quality',true)
    expect(store.selected.fog).toBe('fog-normal')
    expect(store.selected.domestic).toBe('domestic-outbound-low-flow')
    expect(store.reviewed.fog).toEqual([])
    expect(store.reviewed.mineral).toEqual(['quality'])
    expect(store.activeCount).toBe(3)
    store.reset('mineral')
    expect(store.activeCount).toBe(2)
  })
})
