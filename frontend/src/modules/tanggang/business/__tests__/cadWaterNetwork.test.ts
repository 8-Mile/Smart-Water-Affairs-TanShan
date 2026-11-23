import {describe,expect,it} from 'vitest'
import derived from '../cadWaterNetwork.generated.json'
import source from '../../../../../public/tanggang/audit/cad-review/v2/manifest-v2.json'

describe('M23 CAD水资源回路索引真正源自原V2审查文件',()=>{
  it('全部25条设计关系由原CAD参考文件同字段抽取，不自行绘制造水管',()=>{
    expect(derived.sourceDWG).toBe(source.sourceDWG)
    expect(derived.sourceSHA256).toBe(source.sourceSHA256)
    expect(derived.sourceVersion).toBe(source.version)
    expect(derived.allConnectionsVerified).toBe(false)
    expect(derived.designRelationships).toEqual(source.designRelationships)
    expect(derived.designRelationships).toHaveLength(25)
    expect(derived.designRelationships.filter(x=>x.status==='alternative')).toHaveLength(2)
  })
  it('南北池、处理后回用、生态条件回补与生活水隔离均有对应CAD记录',()=>{
    expect(derived.designRelationships.some(x=>x.id==='L02'&&x.to==='north')).toBe(true)
    expect(derived.designRelationships.some(x=>x.id==='L03'&&x.to==='south')).toBe(true)
    expect(derived.designRelationships.some(x=>x.id==='L12'&&x.from==='clear'&&x.to==='dusttank')).toBe(true)
    expect(derived.designRelationships.some(x=>x.id==='L14'&&x.status==='conditional')).toBe(true)
    expect(derived.designRelationships.some(x=>x.id==='X01'&&x.view==='separate')).toBe(true)
  })
  it('所有源CAD锚点是同V2对象，非推断物理连通与泵的真实流量',()=>{
    for(const [key,anchor] of Object.entries(derived.cadAnchors)){
      const object=source.objects.find(x=>x.objectId===key)
      expect(object).toBeTruthy()
      expect(anchor.sourceHandle).toBe(object?.sourceHandle)
      expect(anchor.sourceLayer).toBe(object?.sourceLayer)
    }
    expect(Object.keys(derived.cadAnchors).length).toBe(26)
  })
})
