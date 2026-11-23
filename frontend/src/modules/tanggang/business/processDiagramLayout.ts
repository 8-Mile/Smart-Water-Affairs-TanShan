/**
 * CAD region grouping rendered as a schematic *layout*, not a hydraulic graph.
 * Region order and facility IDs are inherited from the engineering catalog;
 * all x/y here are visual coordinates with no physical positioning authority.
 */
import type {TanggangDevice} from '../mapping/tanggangCatalog'
import type {ProcessSchematicSection} from './processSchematic'

export interface SchematicNodePosition {
  device:TanggangDevice
  x:number
  y:number
}
export interface SchematicRegionLayout {
  id:string
  title:string
  y:number
  height:number
  nodes:SchematicNodePosition[]
}
export interface SchematicDiagramLayout {
  width:number
  height:number
  regions:SchematicRegionLayout[]
}
export const SCHEMATIC_VIEW_WIDTH=1160

export function layoutProcessRegions(sections:ProcessSchematicSection[]):SchematicDiagramLayout {
  const regions:SchematicRegionLayout[]=[]
  let y=28
  const cardX=230
  const cardY=64
  const dx=220
  const dy=112
  for(const section of sections){
    const rowCount=Math.ceil(section.devices.length/4)
    const height=68+rowCount*dy
    regions.push({
      id:section.id,title:section.title,y,height,
      nodes:section.devices.map((device,i)=>({
        device,x:cardX+(i%4)*dx,y:y+cardY+Math.floor(i/4)*dy,
      })),
    })
    y+=height+18
  }
  return {width:SCHEMATIC_VIEW_WIDTH,height:Math.max(270,y+26),regions}
}
