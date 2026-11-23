import {describe,expect,it} from 'vitest'
import sourceV25 from '../../../../../public/tanggang/cad/l1-v2_5/systems-v2.5.json'
import sourceV28 from '../../../../../public/tanggang/cad/l1-v2_8/process-endpoint-audit-v2.8.json'
import backendManifest from '../../../../../../backend/app/resources/tanggang_cad_connection_candidates.json'
import {defaultProcessDiagram} from '../fogDiagram'
import type {ProcessSchematicSection} from '../processSchematic'
import type {EditableProcessSystemId} from '@/api/tanggangProcessDiagrams'
import regions from '../../../../../public/tanggang/cad/l1-v2_3/region-equipment-v2.3.json'
import type {TanggangDevice} from '../../mapping/tanggangCatalog'

function sectionsFor(system:typeof sourceV25.systems[number]):ProcessSchematicSection[]{
  const mapping=new Map(regions.regions.flatMap(region=>region.devices.map(d=>[
    d.id,{...d,regionId:region.id,regionName:region.name} as TanggangDevice,
  ] as const)))
  return system.areaEquipment.map(g=>({
    id:g.regionId,title:g.regionId,
    devices:g.equipmentIds.map(id=>mapping.get(id)!),
  }))
}

describe('M19 CAD候选关系固定证据索引与五套工艺同源',()=>{
  it('44条设计连接与23条同介质可候选关系均可追溯，未创造真实管道关系',()=>{
    expect(backendManifest.schema_version).toBe(1)
    expect(backendManifest.source_version).toBe('L1 V2.8')
    let total=0,eligible=0
    for(const system of sourceV25.systems.filter(s=>s.id!=='fog')){
      const sid=system.id as EditableProcessSystemId
      const diagram=defaultProcessDiagram(sid,system.name,sectionsFor(system))
      const scope=backendManifest.systems[sid as keyof typeof backendManifest.systems]
      expect(scope.name).toBe(system.name)
      expect(scope.focus_layers).toEqual(system.focusPipeLayers)
      expect(scope.connections.length).toBe(diagram.connections.length)
      total+=scope.connections.length
      eligible+=scope.candidate_scope_count
      for(const connection of scope.connections){
        const actual=diagram.connections.find(c=>c.id===connection.connection_id)
        expect(actual).toBeTruthy()
        expect(actual?.source_node_id).toBe(connection.source_node_id)
        expect(actual?.target_node_id).toBe(connection.target_node_id)
        expect(actual?.medium).toBe(connection.medium)
        expect(connection).not.toHaveProperty('physical_connection_verified')
        if(connection.candidate_layer){
          expect(scope.focus_layers).toContain(connection.candidate_layer)
          expect(['water','sludge']).toContain(connection.medium)
          expect(backendManifest.handles_by_layer).toHaveProperty(connection.candidate_layer)
        }
      }
    }
    expect(total).toBe(44)
    expect(eligible).toBe(23)
  })
  it('全部候选源Handle都严格来自原始V2.8同层台账且没有自动设备归属',()=>{
    for(const [layer,handles] of Object.entries(backendManifest.handles_by_layer)){
      const expected=[...new Set(
        sourceV28.layers[layer as keyof typeof sourceV28.layers].endpoints
          .map(x=>x.handle.toUpperCase()),
      )].sort()
      expect(handles).toEqual(expected)
      expect(handles.length).toBeGreaterThan(0)
    }
    expect(backendManifest).not.toHaveProperty('verified_links')
    expect(backendManifest).not.toHaveProperty('auto_matched_facilities')
  })
  it('严禁把含矿水流程的非污泥专业连线、生活给水和PLC信号强行归入污泥或污水管',()=>{
    const mineral=backendManifest.systems.mineral.connections
    expect(mineral.filter(x=>x.candidate_layer).map(x=>x.medium)).toEqual(['sludge','sludge'])
    expect(mineral.filter(x=>x.medium==='water'||x.medium==='chemical')
      .every(x=>x.candidate_layer===null)).toBe(true)
    const domestic=backendManifest.systems.domestic.connections
    expect(domestic.find(x=>x.connection_id==='design-05')?.candidate_layer).toBeNull()
    const middle=backendManifest.systems.middle.connections
    expect(middle.find(x=>x.medium==='signal')?.candidate_layer).toBeNull()
  })
})
