import {describe,it,expect} from 'vitest'
import systemSource from '../../../../../public/tanggang/cad/l1-v2_5/systems-v2.5.json'
import regionSource from '../../../../../public/tanggang/cad/l1-v2_3/region-equipment-v2.3.json'
import {buildProcessSchematic} from '../processSchematic'
import type {
  TanggangSystem,TanggangCatalog,TanggangRegion,TanggangDevice,
} from '../../mapping/tanggangCatalog'

function realCadCatalog():TanggangCatalog{
  const systems=systemSource.systems as TanggangSystem[]
  // Raw CAD region JSON lacks normalized regionId/regionName on each device;
  // test setup below intentionally adds those properties before use.
  const regions=regionSource.regions as unknown as TanggangRegion[]
  const deviceMap=new Map<string,TanggangDevice>()
  const regionMap=new Map<string,TanggangRegion>()
  for(const region of regions){
    regionMap.set(region.id,region)
    for(const device of region.devices||[]){
      deviceMap.set(device.id,{
        ...device,regionId:region.id,regionName:region.name,
      })
    }
  }
  const deviceSystems=new Map<string,string[]>()
  for(const system of systems){
    for(const group of system.areaEquipment){
      for(const id of group.equipmentIds){
        const current=deviceSystems.get(id)||[]
        if(!current.includes(system.id))current.push(system.id)
        deviceSystems.set(id,current)
      }
    }
  }
  return {
    systems,regions,deviceMap,regionMap,deviceSystems,
    systemMap:new Map(systems.map(s=>[s.id,s])),
  }
}

describe('唐港六系统 CAD 设计设施分区组态底座',()=>{
  const catalog=realCadCatalog()
  it('以原始设计清单生成六系统分区，每个类别只显示一次',()=>{
    const expected:Record<string,number>={
      fog:3,middle:7,mineral:16,rain:10,pool:11,domestic:3,
    }
    for(const system of catalog.systems){
      const structure=buildProcessSchematic(system,catalog)
      expect(structure.missingIds,system.id).toEqual([])
      expect(structure.devices.length,system.id).toBe(expected[system.id])
      expect(new Set(structure.devices.map(x=>x.id)).size,system.id)
        .toBe(structure.devices.length)
      expect(structure.sections.flatMap(s=>s.devices.map(d=>d.id)).sort())
        .toEqual(structure.devices.map(d=>d.id).sort())
      for(const section of structure.sections){
        expect(section.devices.every(d=>d.regionId===section.id),system.id)
          .toBe(true)
        expect(section.title.trim().length).toBeGreaterThan(0)
      }
    }
  })
  it('射雾器是设计室内系统，不偷用室外消防参考管为专属水路',()=>{
    const fog=catalog.systemMap.get('fog')!
    const model=buildProcessSchematic(fog,catalog)
    expect(fog.subtitle).toContain('室内')
    expect(fog.focusPipeLayers).toHaveLength(0)
    expect(model.devices.every(d=>d.dataFields.length>0)).toBe(true)
    // Node grouping has *no* edges or asserted water-flow relationships.
    expect(model.sections[0]).not.toHaveProperty('connections')
    expect(model.sections[0]).not.toHaveProperty('edges')
  })
  it('南北集水池、泵房、水处理场、生活污水被保留在各自设计区域',()=>{
    const mineral=buildProcessSchematic(catalog.systemMap.get('mineral')!,catalog)
    expect(mineral.sections.map(x=>x.title).join('、'))
      .toContain('北侧集水池')
    expect(mineral.sections.map(x=>x.title).join('、'))
      .toContain('南侧集水池')
    expect(mineral.sections.map(x=>x.title).join('、'))
      .toContain('含矿污水处理场')
    const domestic=buildProcessSchematic(catalog.systemMap.get('domestic')!,catalog)
    expect(domestic.devices).toHaveLength(3)
    expect(domestic.devices.some(x=>x.name.includes('外送'))).toBe(false)
    // The source's '一体化处理设施' entry is still shown as source data,
    // not silently deleted/converted into a confirmed operating process.
    expect(domestic.devices.some(x=>x.name.includes('一体化'))).toBe(true)
  })
  it('缺失或区域错误的设计设施不由程序臆造',()=>{
    const system=catalog.systemMap.get('fog')!
    const altered:TanggangSystem={
      ...system,areaEquipment:[
        {...system.areaEquipment[0]!,
          equipmentIds:[...system.areaEquipment[0]!.equipmentIds,'EQ-DOES-NOT-EXIST',
            system.areaEquipment[1]!.equipmentIds[0]!] },
        system.areaEquipment[1]!,
      ],
    }
    const model=buildProcessSchematic(altered,catalog)
    expect(model.devices).toHaveLength(3)
    expect(model.missingIds).toContain('EQ-DOES-NOT-EXIST')
    expect(model.missingIds).toContain('EQ-P-FOG')
  })
})
