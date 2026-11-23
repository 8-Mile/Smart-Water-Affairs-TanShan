import {describe,expect,it} from 'vitest'
import systemSource from '../../../../../public/tanggang/cad/l1-v2_5/systems-v2.5.json'
import regionSource from '../../../../../public/tanggang/cad/l1-v2_3/region-equipment-v2.3.json'
import {defaultProcessDiagram,validateFogDiagram} from '../fogDiagram'
import type {TanggangDevice} from '../../mapping/tanggangCatalog'
import type {ProcessSchematicSection} from '../processSchematic'
import type {EditableProcessSystemId} from '@/api/tanggangProcessDiagrams'

const sourceDevices=new Map<string,TanggangDevice>()
for(const region of regionSource.regions){
  for(const device of region.devices){
    sourceDevices.set(device.id,{
      ...device,regionId:region.id,regionName:region.name,
    } as TanggangDevice)
  }
}
function sectionsOf(system:typeof systemSource.systems[number]):ProcessSchematicSection[]{
  return system.areaEquipment.map(group=>({
    id:group.regionId,title:group.regionId,
    devices:group.equipmentIds.map(id=>{
      const device=sourceDevices.get(id)
      if(!device)throw Error('Missing CAD facility '+id)
      return device
    }),
  }))
}

describe('六套工艺共用正式组态编辑/发布的数据结构',()=>{
  it('六套工程模板各自绑定原始CAD设计设施，不编造水力连通',()=>{
    const expected:Record<string,number>={
      fog:3,middle:7,mineral:16,rain:10,pool:11,domestic:3,
    }
    for(const system of systemSource.systems){
      const sections=sectionsOf(system)
      const facilities=sections.flatMap(s=>s.devices)
      const diagram=defaultProcessDiagram(
        system.id as EditableProcessSystemId,system.name,sections,
      )
      const bound=diagram.nodes.filter(node=>node.facility_id)
      expect(bound.length,system.id).toBe(expected[system.id])
      expect(new Set(bound.map(x=>x.facility_id)).size,system.id)
        .toBe(expected[system.id])
      expect(diagram.system_id).toBe(system.id)
      expect(validateFogDiagram(diagram,facilities),system.id).toEqual([])
      if(system.id!=='fog')expect(diagram.connections).toEqual([])
      for(const node of diagram.nodes){
        if(node.facility_id)
          expect(facilities.some(d=>d.id===node.facility_id)).toBe(true)
      }
    }
  })
  it('跨系统CAD设施不能绑定，也不允许编造正式核实水路',()=>{
    const system=systemSource.systems.find(x=>x.id==='middle')!
    const sections=sectionsOf(system)
    const facilities=sections.flatMap(s=>s.devices)
    const doc=defaultProcessDiagram('middle',system.name,sections)
    doc.nodes[0]!.facility_id='EQ-DOM-SEWAGE'
    expect(validateFogDiagram(doc,facilities)).toContain('未知的CAD设计设施')
    doc.nodes[0]!.facility_id=facilities[0]!.id
    doc.connections.push({id:'line-fake',source_node_id:doc.nodes[0]!.id,
      target_node_id:doc.nodes[1]!.id,medium:'water',verification:'illustrative'})
    expect(validateFogDiagram(doc,facilities)).toEqual([])
  })
})
