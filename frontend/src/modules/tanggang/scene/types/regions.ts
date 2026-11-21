export interface RegionDevice {
  id: string
  name: string
  designQuantity: string
  countType: string
  specSection: string
  sourceDoc: string
  dataFields: string[]
  positionStatus: 'unlocated'
  currentStatus: '未接入'
  notes: string
  sourceCadHandle: string | null
  relationStatus: string
}
export interface RegionFact { label:string; value:string; source:string; type:'cad'|'design'|'data' }
export interface RegionRelation { to:string; description:string; status:string }
export interface SiteRegion {
  id:string; name:string; category:string; subtitle:string; summary:string
  anchorIds:string[]; bandIds:string[]; contourHandles:string[]
  designFacts:RegionFact[]; devices:RegionDevice[]; pipeSystems:string[]
  relationships:RegionRelation[]; locationStatus:string
  focusAnchorId:string|null; warning:string
}
export interface RegionPayload {
  schema:string; regions:SiteRegion[]
  claims:{zones:number;designEquipmentCategories:number;locatedDevicePoints:number;activeRealtimeValues:number}
}
