import {describe,expect,it} from 'vitest'
import cad from '../cadWaterNetwork.generated.json'
import regions from '../../../../../public/tanggang/cad/l1-v2_3/region-equipment-v2.3.json'
import master from '../../../../../public/tanggang/audit/cad-review/v2/manifest-v2.json'
import {
  CAD_TRACE_AREA,CAD_PROCESS_RELATIONS,anchorFocusUrl,
  knownCadAnchor,relationSourceIsCadHandle,relationsForProcess,
} from '../cadWaterTrace'

describe('M24 CAD区域/证据/工艺跳转严格溯源',()=>{
  it('所有关联节点有唯一追溯定义；区域必须来自上传CAD业务目录',()=>{
    const endpoints=new Set(cad.designRelationships.flatMap(r=>[r.from,r.to]))
    expect(new Set(Object.keys(CAD_TRACE_AREA))).toEqual(endpoints)
    const regionIds=new Set(regions.regions.map(r=>r.id))
    for(const area of Object.values(CAD_TRACE_AREA)){
      if(area.regionId)expect(regionIds.has(area.regionId)).toBe(true)
      for(const id of area.anchors){
        const a=knownCadAnchor(id)
        expect(a).not.toBeNull()
        expect(master.objects.find(x=>x.objectId===id)?.sourceHandle).toEqual(a?.sourceHandle)
        expect(anchorFocusUrl(id)).toMatch(/^\/tanggang\/audit\/cad-review\/index\.html\?focus=\d{2}$/)
      }
    }
  })
  it('没有把设计依据 Axx/Dxx 当CAD Handle或已确认管段',()=>{
    expect(cad.allConnectionsVerified).toBe(false)
    for(const rel of cad.designRelationships){
      for(const source of rel.sources){
        expect(relationSourceIsCadHandle(source)).toBe(false)
      }
    }
    expect(CAD_TRACE_AREA.dusttank.anchors).toEqual([])
    expect(CAD_TRACE_AREA.clear.anchors).toContain('TG-CAD-26')
    expect(knownCadAnchor('TG-CAD-26')?.isPhysicalEntity).toBe(false)
    expect(knownCadAnchor('TG-CAD-23')?.type).toBe('设计文字（非设施中心）')
    expect(CAD_TRACE_AREA.firepump.process).toBeNull()
  })
  it('南北集水池分列；南池两条都是设计备选；不能认作双开',()=>{
    expect(CAD_TRACE_AREA.north.anchors).toEqual(['TG-CAD-09'])
    expect(CAD_TRACE_AREA.south.anchors).toEqual(['TG-CAD-10'])
    expect(cad.designRelationships.filter(r=>r.status==='alternative').map(r=>r.id))
      .toEqual(['L07','L08'])
  })
  it('生活污水备选注记独立保留；不误接含矿污水站',()=>{
    expect(CAD_TRACE_AREA.lifetreat.anchors).toEqual(['TG-CAD-16','TG-CAD-17'])
    const routes=relationsForProcess('domestic')
    expect(routes.map(x=>x.id)).toEqual(['X01'])
    expect(routes[0]?.status).toBe('cad_note')
  })
  it('所有工艺关联均引用真实V2关系ID，6系统有双向返回入口',()=>{
    const valid=new Set(cad.designRelationships.map(r=>r.id))
    for(const [system,ids] of Object.entries(CAD_PROCESS_RELATIONS)){
      expect(ids.length).toBeGreaterThan(0)
      expect(new Set(ids).size).toBe(ids.length)
      for(const id of ids)expect(valid.has(id)).toBe(true)
      expect(relationsForProcess(system).map(x=>x.id)).toEqual(ids)
    }
  })
  it('未建立设备级sourceCadHandle时禁止宣称已验证设备-图纸映射',()=>{
    const devices=regions.regions.flatMap(r=>r.devices||[])
    expect(devices.length).toBeGreaterThan(20)
    expect(devices.filter(x=>!!x.sourceCadHandle)).toHaveLength(0)
    for(const id of Object.keys(cad.cadAnchors)){
      expect(knownCadAnchor(id)).not.toBeNull()
    }
  })
})
