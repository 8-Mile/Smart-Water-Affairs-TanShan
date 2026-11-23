/**
 * M22: canonical telemetry envelope and quality gate for the Tanggang demo.
 * This is a source contract, not a live PLC/SCADA driver.
 *
 * SIM is always synthetic; the future MEASURED transport cannot be enabled
 * just by changing a flag. Authenticated binding + point metadata + sample
 * quality + timestamps must be verified by a separate backend ingestion path.
 */
import type {ScenarioDefinition,ScenarioInputs} from './engine'

export const TELEMETRY_CONTRACT_VERSION='tg-telemetry-envelope-v1'
export const MOCK_FEED_ID='tg-browser-mock-v1'
export const SAMPLE_STALE_AFTER_MS=30000
export const CLOCK_SKEW_ALLOW_MS=5000

export type TelemetryPointId=
  'pumpState'|'pressureMpa'|'flowM3h'|'currentA'|'rainMm'|
  'poolInitialM3'|'rainStorageInitialM3'
export type TelemetryUnit='state'|'MPa'|'m³/h'|'A'|'mm'|'m³'
export type TelemetryMode='SIM'|'MEASURED'
export type PointQuality='SYNTHETIC'|'GOOD'|'BAD'|'MISSING'
export type TelemetryFrameQuality='synthetic'|'valid'|'stale'|'missing'|'invalid'
export interface TelemetryPoint{
  pointId:TelemetryPointId
  value:number|string|null
  unit:TelemetryUnit
  quality:PointQuality
  sampleAt:string
  /** A distinct validated field key is required for production data. */
  deviceBinding:string|null
}
export interface TelemetryFrame{
  schemaVersion:typeof TELEMETRY_CONTRACT_VERSION
  feedId:string
  sequence:number
  sourceMode:TelemetryMode
  receivedAt:string
  scenarioId:string|null
  points:Record<TelemetryPointId,TelemetryPoint>
  fieldVerified:boolean
  modelOnly:boolean
}
export interface FrameAssessment{
  frameQuality:TelemetryFrameQuality
  sourceMode:TelemetryMode
  oldestAgeMs:number|null
  missingPoints:TelemetryPointId[]
  badPoints:TelemetryPointId[]
  stalePoints:TelemetryPointId[]
  modelCanCalculate:boolean
  productionEligible:false
}
const POINT_UNITS:Record<TelemetryPointId,TelemetryUnit>={
  pumpState:'state',pressureMpa:'MPa',flowM3h:'m³/h',currentA:'A',
  rainMm:'mm',poolInitialM3:'m³',rainStorageInitialM3:'m³',
}
export const TELEMETRY_POINTS=Object.keys(POINT_UNITS) as TelemetryPointId[]
export function makeMockTelemetryFrame(
  scenario:ScenarioDefinition,sequence:number,receivedAt:string,
):TelemetryFrame{
  if(!Number.isSafeInteger(sequence)||sequence<0||!Number.isFinite(Date.parse(receivedAt)))
    throw Error('Mock数据帧标识或时间戳非法')
  const raw:Record<TelemetryPointId,ScenarioInputs[TelemetryPointId]>={
    pumpState:scenario.inputs.pumpState,
    pressureMpa:scenario.inputs.pressureMpa,
    flowM3h:scenario.inputs.flowM3h,
    currentA:scenario.inputs.currentA,
    rainMm:scenario.inputs.rainMm,
    poolInitialM3:scenario.inputs.poolInitialM3,
    rainStorageInitialM3:scenario.inputs.rainStorageInitialM3,
  }
  const points={} as Record<TelemetryPointId,TelemetryPoint>
  for(const pointId of TELEMETRY_POINTS){
    const value=raw[pointId]
    points[pointId]={
      pointId,value,
      unit:POINT_UNITS[pointId],
      quality:value===null?'MISSING':'SYNTHETIC',
      sampleAt:receivedAt,
      deviceBinding:null,
    }
  }
  return {
    schemaVersion:TELEMETRY_CONTRACT_VERSION,
    feedId:MOCK_FEED_ID,sequence,
    sourceMode:'SIM',receivedAt,scenarioId:scenario.id,
    points,fieldVerified:false,modelOnly:true,
  }
}
/** Fail-closed validation; quality is derived from data, not from UI labels. */
export function assessTelemetryFrame(
  frame:TelemetryFrame,now:string,
):FrameAssessment{
  const assessment:FrameAssessment={
    frameQuality:'invalid',sourceMode:frame.sourceMode,
    oldestAgeMs:null,missingPoints:[],badPoints:[],stalePoints:[],
    modelCanCalculate:false,productionEligible:false,
  }
  const epoch=Date.parse(now)
  const received=Date.parse(frame.receivedAt)
  if(!Number.isFinite(epoch)||!Number.isFinite(received)||
    !Number.isSafeInteger(frame.sequence)||frame.sequence<0||
    frame.schemaVersion!==TELEMETRY_CONTRACT_VERSION||
    !frame.feedId||received>epoch+CLOCK_SKEW_ALLOW_MS||
    frame.sourceMode!=='SIM'||!frame.modelOnly||frame.fieldVerified||
    frame.feedId!==MOCK_FEED_ID)return assessment

  let oldest=0
  let malformed=false
  for(const id of TELEMETRY_POINTS){
    const item=frame.points?.[id]
    if(!item||item.pointId!==id||item.unit!==POINT_UNITS[id]||
      item.deviceBinding!==null){
      malformed=true
      assessment.badPoints.push(id)
      continue
    }
    const at=Date.parse(item.sampleAt)
    const age=epoch-at
    if(!Number.isFinite(at)||at>epoch+CLOCK_SKEW_ALLOW_MS||at>received+CLOCK_SKEW_ALLOW_MS){
      malformed=true
      assessment.badPoints.push(id)
      continue
    }
    oldest=Math.max(oldest,age)
    if(item.quality==='MISSING'||item.value===null){
      assessment.missingPoints.push(id)
      continue
    }
    if(item.quality!=='SYNTHETIC'||
      (id==='pumpState'?item.value!=='fault'&&item.value!=='running':
        typeof item.value!=='number'||!Number.isFinite(item.value))){
      assessment.badPoints.push(id)
      continue
    }
    if(age>SAMPLE_STALE_AFTER_MS)assessment.stalePoints.push(id)
  }
  assessment.oldestAgeMs=oldest
  assessment.frameQuality=malformed||assessment.badPoints.length?'invalid':
    assessment.stalePoints.length?'stale':
    assessment.missingPoints.length?'missing':'synthetic'
  assessment.modelCanCalculate=assessment.frameQuality==='synthetic'
  // MEASURED data is not accepted by this browser adapter. It requires an
  // authenticated field-gateway backend; never turn SIM into actual alarms.
  return assessment
}
