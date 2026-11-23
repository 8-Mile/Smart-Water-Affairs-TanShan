import {describe,it,expect} from 'vitest'
import {
  FOG_SYMBOLS,FOG_FACILITIES,sourceImage,defaultFogDiagram,
  copyFogDiagram,validateFogDiagram,schematicRoute,
} from '../fogDiagram'
import type {ProcessDiagramDocument} from '@/api/tanggangProcessDiagrams'

const copy=(x:ProcessDiagramDocument)=>copyFogDiagram(x)
describe('M14 5144-era diagram compatibility and safe 5190 fallback',()=>{
  it('default fog canvas includes old PNG symbols with three real CAD identifiers only',()=>{
    const diagram=defaultFogDiagram()
    expect(validateFogDiagram(diagram)).toEqual([])
    expect(diagram.system_id).toBe('fog')
    expect(diagram.view_box).toEqual({width:1200,height:530})
    expect(diagram.nodes.length).toBeGreaterThanOrEqual(5)
    const bound=diagram.nodes.filter(x=>x.facility_id)
    expect(new Set(bound.map(n=>n.facility_id))).toEqual(new Set([
      'EQ-P-FOG','EQ-Y-FOG','EQ-P-PLC',
    ]))
    expect(diagram.connections.every(x=>x.verification==='illustrative')).toBe(true)
    expect(diagram.connections.some(x=>x.medium==='signal')).toBe(true)
    expect(diagram.nodes.filter(x=>!x.facility_id).some(x=>
      x.label.includes('未绑定')||x.label.includes('待核实'))).toBe(true)
  })
  it('restores old explicit sprite symbols and blocks arbitrary URL embedding',()=>{
    expect(FOG_SYMBOLS.fog_cannon.name).toBe('室内射雾器')
    expect(sourceImage('fog_cannon')).toBe('/tanggang/process-symbols/fog_cannon.png')
    expect(sourceImage('pipe_straight')).toBe('/tanggang/process-symbols/pipe_straight.png')
    expect(sourceImage('label')).toBeNull()
    expect(new Set(Object.keys(FOG_FACILITIES)).size).toBe(3)
  })
  it('supports safe drag, undo clone and connection paths without mutating published layout',()=>{
    const published=defaultFogDiagram()
    const draft=copy(published)
    draft.nodes[1]!.position.x+=24
    draft.nodes[1]!.label='设备测试调整'
    expect(validateFogDiagram(draft)).toEqual([])
    expect(published.nodes[1]?.label).not.toBe(draft.nodes[1]?.label)
    expect(published.nodes[1]?.position.x).toBe(292)
    expect(schematicRoute(published.connections[0]!,published)).toMatch(/^M\d/)
    expect(schematicRoute({
      id:'line-missing',source_node_id:'not-found',target_node_id:'fog-unit',
      medium:'water',verification:'illustrative',
    },published)).toBe('')
  })
  it('rejects non-CAD ids, verified pipes, duplicate assets and out-of-bounds geometry',()=>{
    const basic=defaultFogDiagram()
    const bad:ProcessDiagramDocument[]=[]
    const nonCAD=copy(basic);nonCAD.nodes[0]!.facility_id='EQ-UNKNOWN';bad.push(nonCAD)
    const dup=copy(basic);dup.nodes[0]!.facility_id='EQ-P-FOG';bad.push(dup)
    const overflow=copy(basic);overflow.nodes[0]!.position.x=2200;bad.push(overflow)
    const invalidLink=copy(basic);invalidLink.connections[0]!.target_node_id='unknown';bad.push(invalidLink)
    const verified=copy(basic);verified.connections[0]!.verification='field_verified' as never;bad.push(verified)
    const noBound=copy(basic);noBound.nodes[0]!.point_keys=['实测压力'];bad.push(noBound)
    for(const d of bad)expect(validateFogDiagram(d)).not.toEqual([])
  })
  it('existing six-system businesses do not have new implicit process connections',()=>{
    const doc=defaultFogDiagram()
    expect(doc.connections.every(c=>c.verification==='illustrative')).toBe(true)
    expect(doc.nodes.every(n=>n.facility_id===null||
      Object.keys(FOG_FACILITIES).includes(n.facility_id))).toBe(true)
  })
})
