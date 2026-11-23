import {describe,it,expect} from 'vitest'
import systems from '../../../../../public/tanggang/cad/l1-v2_5/systems-v2.5.json'
import regions from '../../../../../public/tanggang/cad/l1-v2_3/region-equipment-v2.3.json'
import {defaultProcessDiagram} from '../fogDiagram'
import {calculateProcessFlowRoute,routeHitsUnrelatedNodes} from '../processFlowRouting'
import type {ProcessSchematicSection} from '../processSchematic'
import type {TanggangDevice} from '../../mapping/tanggangCatalog'
import type {EditableProcessSystemId} from '@/api/tanggangProcessDiagrams'

const catalog=new Map(regions.regions.flatMap(r=>r.devices.map(d=>[
  d.id,{...d,regionId:r.id,regionName:r.name} as TanggangDevice,
] as const)))
function sections(id:string):ProcessSchematicSection[]{
  const system=systems.systems.find(s=>s.id===id)!
  return system.areaEquipment.map(a=>({
    id:a.regionId,title:a.regionId,devices:a.equipmentIds.map(id=>catalog.get(id)!),
  }))
}
describe('M17 CAD流程图避让布局',()=>{
  for(const system of systems.systems.filter(s=>s.id!=='fog')){
    it(system.id+' 连接从设备边缘出发、不穿越无关设施',()=>{
      const doc=defaultProcessDiagram(system.id as EditableProcessSystemId,
        system.name,sections(system.id))
      for(const c of doc.connections){
        const route=calculateProcessFlowRoute(c,doc)
        expect(route.path,c.id).toMatch(/^M/)
        expect(route.points.length,c.id).toBeGreaterThanOrEqual(2)
        expect(routeHitsUnrelatedNodes(route,c,doc),system.id+'/'+c.id).toEqual([])
        const from=doc.nodes.find(n=>n.id===c.source_node_id)!
        const at=route.points[0]!
        expect([
          from.position.x,from.position.x+from.size.width,
          from.position.y,from.position.y+from.size.height,
        ].some(v=>[at.x,at.y].includes(v)),c.id).toBe(true)
      }
    })
  }
  it('缺失端点不生成假线',()=>{
    const doc=defaultProcessDiagram('middle','中压供水',sections('middle'))
    expect(calculateProcessFlowRoute({
      id:'bad',source_node_id:'unknown',target_node_id:'cad-EQ-Y-DUST',
      medium:'water',verification:'illustrative',
    },doc).path).toBe('')
  })
  it('设备拖动后线路重新计算，不改变设备资料',()=>{
    const doc=defaultProcessDiagram('middle','中压供水',sections('middle'))
    const l=doc.connections[0]!
    const before=calculateProcessFlowRoute(l,doc).path
    const first=doc.nodes.find(n=>n.id===l.source_node_id)!
    first.position.y+=30
    const after=calculateProcessFlowRoute(l,doc).path
    expect(after).not.toBe(before)
    expect(doc.nodes.length).toBeGreaterThan(7)
  })
})
