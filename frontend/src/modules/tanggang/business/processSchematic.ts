/**
 * Six fixed engineering schematic groupings from the uploaded CAD-derived
 * region/device mapping. A group is SPATIAL, never a hydraulic flow edge.
 */
import type {
  TanggangCatalog,TanggangDevice,TanggangSystem,
} from '../mapping/tanggangCatalog'

export interface ProcessSchematicSection {
  id:string
  title:string
  devices:TanggangDevice[]
}
export interface ProcessSchematic {
  sections:ProcessSchematicSection[]
  devices:TanggangDevice[]
  missingIds:string[]
}

export function buildProcessSchematic(
  system:TanggangSystem,
  catalog:TanggangCatalog,
):ProcessSchematic {
  const seen=new Set<string>()
  const missing=new Set<string>()
  const sections:ProcessSchematicSection[]=[]
  const devices:TanggangDevice[]=[]
  for(const entry of system.areaEquipment){
    const region=catalog.regionMap.get(entry.regionId)
    const regionDevices:TanggangDevice[]=[]
    for(const id of entry.equipmentIds){
      if(seen.has(id))continue
      const device=catalog.deviceMap.get(id)
      if(!device){
        missing.add(id)
        continue
      }
      // A CAD region group must not silently import a facility whose
      // catalog region differs; flag it as an evidence mismatch instead.
      if(device.regionId!==entry.regionId){
        missing.add(id)
        continue
      }
      seen.add(id)
      regionDevices.push(device)
      devices.push(device)
    }
    if(regionDevices.length){
      sections.push({
        id:entry.regionId,
        title:region?.name||regionDevices[0]!.regionName,
        devices:regionDevices,
      })
    }
  }
  return {sections,devices,missingIds:Array.from(missing)}
}
