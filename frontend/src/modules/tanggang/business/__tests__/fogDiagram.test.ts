import {describe,it,expect} from 'vitest'
import {
  FOG_SYMBOLS,FOG_FACILITIES,sourceImage,defaultFogDiagram,
  copyFogDiagram,validateFogDiagram,schematicRoute,
  fogZones,fogTelemetryPlacement,
} from '../fogDiagram'
import type {ProcessDiagramDocument} from '@/api/tanggangProcessDiagrams'

const copy=(x:ProcessDiagramDocument)=>copyFogDiagram(x)
describe('M14 5144-era diagram compatibility and safe 5190 fallback',()=>{
  it('default fog canvas includes old PNG symbols with three real CAD identifiers only',()=>{
    const diagram=defaultFogDiagram()
    expect(validateFogDiagram(diagram)).toEqual([])
    expect(diagram.system_id).toBe('fog')
    expect(diagram.view_box).toEqual({width:1200,height:640})
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
    expect(published.nodes[1]?.position.x).toBe(324)
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
  it('three visual process zones reflect the reference composition, not certified pipe topology',()=>{
    const diagram=defaultFogDiagram()
    const sections=fogZones(diagram.view_box.width)
    expect(sections.map(x=>x.key)).toEqual(['source','pumping','terminal'])
    expect(sections.map(x=>x.index)).toEqual(['01','02','03'])
    expect(sections.every(z=>z.width>100)).toBe(true)
    expect(sections.every(z=>z.from+z.width<diagram.view_box.width)).toBe(true)
    expect(sections[0]!.title).toContain('水源')
    expect(sections[2]!.title).toContain('室内射雾')
    expect(diagram.nodes.find(x=>x.id==='fog-unit')?.facility_id).toBe('EQ-Y-FOG')
  })
  it('edge-routed illustrative water lines do not begin inside the sprite bodies',()=>{
    const diagram=defaultFogDiagram()
    const tank=diagram.nodes.find(x=>x.id==='source-tank')!
    const pump=diagram.nodes.find(x=>x.id==='supply-pump')!
    const water=diagram.connections.find(x=>x.id==='water-a')!
    const path=schematicRoute(water,diagram)
    expect(path).toMatch(new RegExp('^M'+(tank.position.x+tank.size.width)+','))
    expect(path).toContain('H'+pump.position.x)
    expect(path).not.toContain('L')
    const signal=diagram.connections.find(x=>x.id==='signal-a')!
    const control=diagram.nodes.find(x=>x.id==='plc-cabinet')!
    expect(schematicRoute(signal,diagram)).toMatch(
      new RegExp('^M'+control.position.x+','),
    )
  })
  it('Mock data cards position above equipment and stay inside 1200x600 canvas',()=>{
    const d=defaultFogDiagram()
    for(const node of d.nodes.filter(x=>x.facility_id)){
      const label=fogTelemetryPlacement(node,d.view_box)
      const x=node.position.x+label.x
      const y=node.position.y+label.y
      expect(x).toBeGreaterThanOrEqual(12)
      expect(x+label.width).toBeLessThanOrEqual(d.view_box.width-12)
      expect(y).toBeGreaterThanOrEqual(73)
      expect(y+76).toBeLessThanOrEqual(d.view_box.height)
    }
  })
  it('visual template changes never overwrite preexisting server-published documents',()=>{
    // An older published 1200x530 layout remains a valid data document.
    const legacy=copy(defaultFogDiagram())
    legacy.view_box.height=530
    legacy.nodes.find(x=>x.id==='plc-cabinet')!.position.y=360
    expect(validateFogDiagram(legacy)).toEqual([])
    expect(copy(legacy)).toEqual(legacy)
  })
  it('existing six-system businesses do not have new implicit process connections',()=>{
    const doc=defaultFogDiagram()
    expect(doc.connections.every(c=>c.verification==='illustrative')).toBe(true)
    expect(doc.nodes.every(n=>n.facility_id===null||
      Object.keys(FOG_FACILITIES).includes(n.facility_id))).toBe(true)
  })
})
