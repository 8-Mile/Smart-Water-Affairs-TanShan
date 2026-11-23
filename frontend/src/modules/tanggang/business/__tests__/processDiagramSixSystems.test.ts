import {describe,expect,it} from 'vitest'
import systemSource from '../../../../../public/tanggang/cad/l1-v2_5/systems-v2.5.json'
import regionSource from '../../../../../public/tanggang/cad/l1-v2_3/region-equipment-v2.3.json'
import {defaultProcessDiagram,validateFogDiagram} from '../fogDiagram'
import {processFlowZones,isLegacyUnconnectedTemplate} from '../processFlow'
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
  it('六套工程模板均绑定原始CAD设施；另五套用设计关系绘制流程而非散装图元',()=>{
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
      if(system.id!=='fog'){
        expect(diagram.connections.length,system.id).toBeGreaterThanOrEqual(4)
        expect(diagram.connections.every(c=>c.verification==='illustrative')).toBe(true)
        expect(diagram.connections.every(c=>c.relation==='design'||
          c.relation==='conditional')).toBe(true)
        expect(processFlowZones(diagram.system_id).length).toBeGreaterThanOrEqual(3)
        for(const c of diagram.connections){
          expect(diagram.nodes.some(n=>n.id===c.source_node_id)).toBe(true)
          expect(diagram.nodes.some(n=>n.id===c.target_node_id)).toBe(true)
        }
        for(const n of diagram.nodes){
          expect(n.position.x+n.size.width).toBeLessThanOrEqual(diagram.view_box.width)
          expect(n.position.y+n.size.height).toBeLessThanOrEqual(diagram.view_box.height)
        }
      }
      for(const node of diagram.nodes){
        if(node.facility_id)
          expect(facilities.some(d=>d.id===node.facility_id)).toBe(true)
      }
    }
  })
  it('含矿污水单独表示加药、污泥与回用；南侧路径和生态回用为条件关联',()=>{
    const mineral=systemSource.systems.find(s=>s.id==='mineral')!
    const doc=defaultProcessDiagram('mineral',mineral.name,sectionsOf(mineral))
    expect(doc.connections.some(c=>c.medium==='chemical')).toBe(true)
    expect(doc.connections.some(c=>c.medium==='sludge')).toBe(true)
    expect(doc.connections.some(c=>c.relation==='conditional')).toBe(true)
  })
  it('生活污水处理不把办公生活给水表串接进污水处理管路',()=>{
    const domestic=systemSource.systems.find(s=>s.id==='domestic')!
    const doc=defaultProcessDiagram('domestic',domestic.name,sectionsOf(domestic))
    const meter='cad-EQ-DOM-METER'
    expect(doc.connections.filter(c=>c.target_node_id===meter))
      .toHaveLength(1)
    expect(doc.connections.some(c=>c.source_node_id===meter)).toBe(false)
    expect(doc.connections.some(c=>c.source_node_id==='cad-EQ-DOM-SEWAGE'&&
      c.target_node_id==='cad-EQ-DOM-LINK')).toBe(false)
    expect(doc.connections.filter(c=>c.source_node_id==='ref-sewage-in')
      .every(c=>c.relation==='conditional')).toBe(true)
  })
  it('仅自动识别旧版无连线CAD模板，升级必须显式保存发布',()=>{
    const middle=systemSource.systems.find(s=>s.id==='middle')!
    const doc=defaultProcessDiagram('middle',middle.name,sectionsOf(middle))
    expect(isLegacyUnconnectedTemplate('middle',doc)).toBe(false)
    doc.connections=[]
    doc.nodes=doc.nodes.filter(n=>n.id.startsWith('cad-'))
    expect(isLegacyUnconnectedTemplate('middle',doc)).toBe(true)
  })
  it('跨系统CAD设施不能绑定，也不允许编造正式核实水路',()=>{
    const system=systemSource.systems.find(x=>x.id==='middle')!
    const sections=sectionsOf(system)
    const facilities=sections.flatMap(s=>s.devices)
    const doc=defaultProcessDiagram('middle',system.name,sections)
    doc.nodes[0]!.facility_id='EQ-DOM-SEWAGE'
    expect(validateFogDiagram(doc,facilities)).toContain('未知的CAD设计设施')
    doc.nodes[0]!.facility_id=doc.nodes[0]!.id.replace('cad-','')
    doc.connections.push({id:'line-fake',source_node_id:doc.nodes[0]!.id,
      target_node_id:doc.nodes[1]!.id,medium:'water',verification:'illustrative'})
    expect(validateFogDiagram(doc,facilities)).toEqual([])
  })
})
