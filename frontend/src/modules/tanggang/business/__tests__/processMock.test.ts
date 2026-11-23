import {describe,it,expect} from 'vitest'
import {SCENARIOS} from '../../simulation/engine'
import {
  mockProcessDevice,processDeviceKind,PROCESS_MOCK_MODEL,
} from '../processMock'
import type {TanggangDevice} from '../../mapping/tanggangCatalog'
import regions from '../../../../../public/tanggang/cad/l1-v2_3/region-equipment-v2.3.json'
import systems from '../../../../../public/tanggang/cad/l1-v2_5/systems-v2.5.json'

const catalog=new Map<string,TanggangDevice>()
for(const region of regions.regions){
  for(const device of region.devices){
    catalog.set(device.id,{
      ...device,regionId:region.id,regionName:region.name,
    })
  }
}
function device(id:string):TanggangDevice{
  const value=catalog.get(id)
  if(!value)throw Error('missing fixture '+id)
  return value
}

describe('TG-104 六系统工艺节点Mock数据源',()=>{
  it('六套工艺从原始CAD设备类别生成独立Mock，不制造SCADA业务写入',()=>{
    const ids=new Set<string>()
    for(const system of systems.systems){
      for(const section of system.areaEquipment){
        for(const id of section.equipmentIds)ids.add(id)
      }
    }
    expect(ids.size).toBeGreaterThan(35)
    for(const id of ids){
      const profile=mockProcessDevice(device(id),null)
      expect(profile.facilityId).toBe(id)
      expect(profile.modelVersion).toBe(PROCESS_MOCK_MODEL)
      expect(profile.context).toBe('MOCK_BASELINE')
      expect(profile.fieldVerified).toBe(false)
      expect(profile.productionControlEnabled).toBe(false)
      expect(profile.state).not.toBe('fault')
      expect(profile.readings.map(x=>x.key)).toEqual(device(id).dataFields)
      expect(profile.readings.every(x=>x.dataMode==='SIM'&&
        x.provenance==='MOCK_PROFILE')).toBe(true)
    }
  })
  it('相同设施、相同情景、不同页面生成一致Mock，刷新不随机漂移',()=>{
    const shared=device('EQ-P-PLC') // both fog and middle
    const run=SCENARIOS.peak
    const a=mockProcessDevice(shared,run)
    const b=mockProcessDevice(shared,run)
    expect(a).toEqual(b)
    expect(mockProcessDevice(shared,null).readings).toEqual(
      mockProcessDevice(shared,null).readings,
    )
    // A shared PLC fixture is not automatically affected by the peak
    // model, even if some related pumps are highlighted.
    expect(a.context).toBe('MOCK_BASELINE')
    expect(a.scenarioId).toBeNull()
    const pump=mockProcessDevice(device('EQ-P-MID'),run)
    expect(pump.context).toBe('ACTIVE_SCENARIO')
    expect(pump.scenarioId).toBe('peak')
  })
  it('泵故障情景仅作用于明确的中压泵组，其他共用泵不自动故障',()=>{
    const fault=SCENARIOS['pump-fault']
    const mid=mockProcessDevice(device('EQ-P-MID'),fault)
    expect(mid.state).toBe('fault')
    expect(mid.readings.find(x=>x.key==='泵运行状态')?.value).toBe('模拟故障')
    expect(mid.readings.find(x=>x.key==='故障')?.provenance)
      .toBe('SCENARIO_INPUT')
    expect(mid.readings.find(x=>x.key==='出口压力')?.value).toBe('0.85 MPa')
    expect(mid.readings.find(x=>x.key==='出口流量')?.value).toBe('45.0 m³/h')
    const meter=mockProcessDevice(device('EQ-P-METER'),fault)
    expect(meter.state).toBe('attention')
    expect(meter.readings.find(x=>x.key==='压力')?.value).toBe('0.85 MPa')
    expect(meter.readings.find(x=>x.key==='瞬时流量')?.value).toBe('45.0 m³/h')
    const others=['EQ-P-FOG','EQ-NPOOL-LIFT','EQ-SPOOL-LIFT','EQ-WWT-CLEAN']
    for(const id of others){
      const affected=mockProcessDevice(device(id),fault)
      expect(affected.state).not.toBe('fault')
      expect(affected.readings.every(x=>x.provenance==='MOCK_PROFILE'))
        .toBe(true)
    }
  })
  it('强降雨是全局单池推演，不把单池储量复制成南北两个真实集水池液位',()=>{
    const storm=SCENARIOS.storm
    for(const id of ['EQ-NPOOL-POOL','EQ-SPOOL-POOL','EQ-NPOOL-RADAR']){
      const mock=mockProcessDevice(device(id),storm)
      expect(['available','attention']).toContain(mock.state)
      expect(mock.readings.every(x=>x.provenance==='MOCK_PROFILE')).toBe(true)
      expect(mock.readings.map(x=>x.value).join(';'))
        .not.toContain(String(storm.inputs.rainStorageCapacityM3))
    }
  })
  it('模拟场景缺测保留缺测，不当作0；值存在但不代表质检合格',()=>{
    const data={
      ...SCENARIOS.peak,
      inputs:{...SCENARIOS.peak.inputs,pressureMpa:null,flowM3h:null},
    }
    const mock=mockProcessDevice(device('EQ-P-METER'),data)
    expect(mock.readings.find(x=>x.key==='压力')?.value).toBe('缺测（SIM）')
    expect(mock.readings.find(x=>x.key==='瞬时流量')?.value)
      .toBe('缺测（SIM）')
    const quality=mockProcessDevice(device('EQ-WWT-WQ'),SCENARIOS.peak)
    expect(quality.readings.map(x=>x.key)).toEqual(['pH','SS','氯离子'])
    expect(quality.readings.every(x=>x.provenance==='MOCK_PROFILE')).toBe(true)
    expect(JSON.stringify(quality)).not.toMatch(/水质达标|合格|可回用/)
  })
  it('各水池库存单位是立方米，不把库存误称流量',()=>{
    const pool=mockProcessDevice(device('EQ-DP-TANK'),null)
    for(const key of ['可用水量','消防保留水量']){
      const value=pool.readings.find(x=>x.key===key)?.value
      expect(value).toMatch(/ m³$/)
      expect(value).not.toMatch(/m³\/h/)
    }
  })
  it('强降雨与高峰仅提示业务关注，不将单池演示结果伪装为多个池读数',()=>{
    const rain=mockProcessDevice(device('EQ-NPOOL-POOL'),SCENARIOS.storm)
    expect(rain.state).toBe('attention')
    expect(rain.readings.every(x=>x.provenance==='MOCK_PROFILE')).toBe(true)
    const mid=mockProcessDevice(device('EQ-P-MID'),SCENARIOS.peak)
    expect(mid.state).toBe('attention')
    expect(mid.readings.find(x=>x.key==='出口压力')?.value)
      .toBe('1.17 MPa')
  })
  it('设备节点专业类型识别，不改变原CAD类别和接口ID',()=>{
    expect(processDeviceKind(device('EQ-P-MID'))).toBe('pump')
    expect(processDeviceKind(device('EQ-DP-TANK'))).toBe('pool')
    expect(processDeviceKind(device('EQ-NPOOL-RADAR'))).toBe('meter')
    expect(processDeviceKind(device('EQ-WWT-PURIFIER'))).toBe('treatment')
    expect(processDeviceKind(device('EQ-P-PLC'))).toBe('controller')
    expect(processDeviceKind(device('EQ-Y-DUST'))).toBe('pipe')
  })
})
