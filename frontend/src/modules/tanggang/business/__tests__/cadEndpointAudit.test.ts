import {describe,expect,it} from 'vitest'
import cadAudit from '../../../../../public/tanggang/cad/l1-v2_8/process-endpoint-audit-v2.8.json'
import systems from '../../../../../public/tanggang/cad/l1-v2_5/systems-v2.5.json'

describe('M18 CAD端点证据审核和专业图层边界',()=>{
  it('V2.8核查数据满足原始台账统计且不会虚构核实状态',()=>{
    const layers=Object.values(cadAudit.layers)
    expect(cadAudit.total.endpoints).toBe(1098)
    expect(cadAudit.total.candidateContacts).toBe(770)
    expect(cadAudit.total.unresolved).toBe(328)
    expect(cadAudit.total.suspicions).toBe(129)
    expect(cadAudit.total.highSuspicions).toBe(46)
    expect(layers.reduce((n,l)=>n+l.endpoints.length,0)).toBe(1098)
    expect(layers.reduce((n,l)=>n+l.suspicions.length,0)).toBe(129)
    expect(layers.every(layer=>layer.endpointCount===layer.endpoints.length)).toBe(true)
    for(const layer of layers){
      for(const endpoint of layer.endpoints){
        expect(endpoint).not.toHaveProperty('verified')
        expect(endpoint).not.toHaveProperty('connectedFacility')
        expect(endpoint).not.toHaveProperty('hydraulicLink')
        expect(endpoint.handle.length).toBeGreaterThan(1)
      }
    }
  })
  it('各子系统只查看其CAD覆盖图层，射雾无匹配数据不做关联',()=>{
    const expected:Record<string,{endpoints:number;unresolved:number;suspicions:number;high:number}>={
      middle:{endpoints:56,unresolved:19,suspicions:6,high:1},
      mineral:{endpoints:44,unresolved:9,suspicions:0,high:0},
      rain:{endpoints:178,unresolved:35,suspicions:7,high:5},
      pool:{endpoints:72,unresolved:23,suspicions:0,high:0},
      domestic:{endpoints:32,unresolved:9,suspicions:1,high:0},
    }
    for(const system of systems.systems){
      if(system.id==='fog'){
        expect(system.focusPipeLayers).toEqual([])
        continue
      }
      const match=system.focusPipeLayers.map(name=>cadAudit.layers[name as keyof typeof cadAudit.layers])
      expect(match.every(x=>!!x)).toBe(true)
      const sum={
        endpoints:match.reduce((n,x)=>n+x.endpointCount,0),
        unresolved:match.reduce((n,x)=>n+x.unresolvedCount,0),
        suspicions:match.reduce((n,x)=>n+x.suspiciousCount,0),
        high:match.reduce((n,x)=>n+x.suspiciousHighCount,0),
      }
      expect(sum).toEqual(expected[system.id])
    }
  })
  it('候选端点接触不自动计为核验完成',()=>{
    for(const layer of Object.values(cadAudit.layers)){
      const found=layer.endpoints.filter(x=>x.status==='touches_another_visible_candidate').length
      expect(layer.endpointCount-layer.unresolvedCount).toBe(found)
      expect(layer.statuses.touches_another_visible_candidate||0).toBe(found)
    }
  })
})
