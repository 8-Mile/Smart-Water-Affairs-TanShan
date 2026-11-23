import {describe,expect,it} from 'vitest'
import {layoutProcessRegions,SCHEMATIC_VIEW_WIDTH} from '../processDiagramLayout'
import type {TanggangDevice} from '../../mapping/tanggangCatalog'
import type {ProcessSchematicSection} from '../processSchematic'

function region(id:string,count:number):ProcessSchematicSection{
  return {id,title:'CAD分区-'+id,devices:Array.from({length:count},(_,i)=>({
    id:id+'-'+i,name:'设备'+i,regionId:id,regionName:id,
  } as TanggangDevice))}
}

describe('六系统非水力组态区域排布',()=>{
  it('按既有区域和设施顺序排列，不虚构连接',()=>{
    const sections=[region('north',4),region('south',3),region('plant',7)]
    const d=layoutProcessRegions(sections)
    expect(d.width).toBe(SCHEMATIC_VIEW_WIDTH)
    expect(d.regions.map(r=>r.id)).toEqual(['north','south','plant'])
    expect(d.regions.flatMap(r=>r.nodes.map(n=>n.device.id)))
      .toEqual(sections.flatMap(s=>s.devices.map(x=>x.id)))
    expect(d).not.toHaveProperty('connections')
    expect(d).not.toHaveProperty('edges')
  })
  it('每区最多四列，七设施自动换行且节点不超画布',()=>{
    const d=layoutProcessRegions([region('wastewater',7)])
    const r=d.regions[0]!
    expect(r.nodes[0]!.y).toBe(r.nodes[3]!.y)
    expect(r.nodes[4]!.y).toBeGreaterThan(r.nodes[3]!.y)
    expect(r.nodes[6]!.x+204).toBeLessThan(d.width)
    expect(r.nodes[6]!.y+96).toBeLessThan(r.y+r.height)
  })
  it('无设施返回空区域但保留最小视口',()=>{
    const d=layoutProcessRegions([])
    expect(d.height).toBeGreaterThanOrEqual(270)
    expect(d.regions).toEqual([])
  })
})
