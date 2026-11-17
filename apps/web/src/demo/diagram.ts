import type { Asset, MeasurePoint } from './types';

export interface ProcessNode {
  id: string;
  assetId?: string;
  symbolId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  pointBindings: { pointId: string; displayRole: string }[];
  label?: string;
  visible: boolean;
  locked?: boolean;
}
export interface ProcessConnection {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  medium?: string;
}
export interface SceneHotspot {
  id: string;
  sceneId: string;
  assetId: string;
  xPct: number;
  yPct: number;
  label?: string;
  visible: boolean;
}
export interface ProcessDiagram {
  id: string;
  subsystemId: string;
  name: string;
  viewBox: { width: number; height: number };
  version: number;
  status: 'draft' | 'published';
  nodes: ProcessNode[];
  connections: ProcessConnection[];
  sprayEquipmentMigrated?: boolean;
}
export const SYMBOLS = {
  fog_cannon: { name: '射雾器', width: 91, height: 98 },
  water_tank: { name: '蓄水池', width: 160, height: 162 },
  centrifugal_pump: { name: '离心泵', width: 90, height: 89 },
  pressure_gauge: { name: '压力表', width: 52, height: 84 },
  flow_meter: { name: '流量计', width: 56, height: 56 },
  butterfly_valve: { name: '蝶阀', width: 50, height: 50 },
  label: { name: '说明标签', width: 120, height: 32 },
} as const;
export type SymbolId = keyof typeof SYMBOLS;
export const SPRAY_EQUIPMENT = [
  { id: 'spray-tank', symbolId: 'water_tank', label: '蓄水池', x: 36, y: 128 },
  { id: 'spray-pump-1', symbolId: 'centrifugal_pump', label: '1#泵', x: 278, y: 148 },
  { id: 'spray-pump-2', symbolId: 'centrifugal_pump', label: '2#泵', x: 278, y: 240 },
  { id: 'spray-pressure', symbolId: 'pressure_gauge', label: '末端压力均值', x: 560, y: 158 },
  { id: 'spray-flow', symbolId: 'flow_meter', label: '喷射流量合计', x: 648, y: 212 },
] as const;

export function migrateSprayEquipment(diagram: ProcessDiagram): ProcessDiagram {
  if (diagram.sprayEquipmentMigrated) return diagram;
  const equipment: ProcessNode[] = SPRAY_EQUIPMENT.map(({ id, symbolId, label, x, y }) => ({
    id, symbolId, label, position: { x, y },
    size: { width: SYMBOLS[symbolId].width, height: SYMBOLS[symbolId].height },
    pointBindings: [], visible: true,
  }));
  return { ...diagram, sprayEquipmentMigrated: true, nodes: [...diagram.nodes, ...equipment] };
}

export function cloneDiagram(diagram: ProcessDiagram): ProcessDiagram {
  return JSON.parse(JSON.stringify(diagram)) as ProcessDiagram;
}
export function defaultSprayDiagram(assets: Asset[]): ProcessDiagram {
  const positions = [{ x: 910, y: 92 }, { x: 1018, y: 92 }, { x: 910, y: 262 }, { x: 1018, y: 262 }];
  return {
    id: 'diagram-spray', subsystemId: 'spray', name: '射雾器除尘工艺图',
    viewBox: { width: 1200, height: 400 }, version: 1, status: 'published', connections: [],
    nodes: positions.flatMap((position, i) => {
      const asset = assets.find(item => item.code === `SP-00${i + 1}`);
      return asset ? [{ id: `node-${asset.id}`, assetId: asset.id, symbolId: 'fog_cannon', position, size: { width: 91, height: 98 }, pointBindings: [], label: asset.code, visible: true }] : [];
    }),
  };
}
export function nextSprayPosition(nodes: ProcessNode[], zone: 'A' | 'B'): { x: number; y: number } {
  const y = zone === 'A' ? 92 : 262;
  let x = 910;
  while (nodes.some(node => Math.abs(node.position.x - x) < 95 && Math.abs(node.position.y - y) < 95)) x += 108;
  return { x, y };
}
export function validateDiagram(diagram: ProcessDiagram, assets: Asset[], points: MeasurePoint[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const bound = new Set<string>();
  const assetIds = new Set(assets.filter(a => !a.archived).map(a => a.id));
  const pointById = new Map(points.map(p => [p.id, p]));
  for (const node of diagram.nodes) {
    if (!node.id || ids.has(node.id)) errors.push(`图元 ID 重复或为空：${node.id}`);
    ids.add(node.id);
    if (!(node.symbolId in SYMBOLS)) errors.push(`${node.id} 素材无效`);
    if (node.assetId && !assetIds.has(node.assetId)) errors.push(`${node.id} 设备引用无效`);
    if (node.assetId && bound.has(node.assetId)) errors.push(`${node.assetId} 重复绑定`);
    if (node.assetId) bound.add(node.assetId);
    const { x, y } = node.position;
    const { width, height } = node.size;
    if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > diagram.viewBox.width || y + height > diagram.viewBox.height) errors.push(`${node.id} 坐标或尺寸越界`);
    for (const binding of node.pointBindings) {
      const point = pointById.get(binding.pointId);
      if (!point || point.assetId !== node.assetId) errors.push(`${node.id} 测点引用无效：${binding.pointId}`);
    }
  }
  for (const line of diagram.connections) {
    if (!ids.has(line.sourceNodeId) || !ids.has(line.targetNodeId) || !line.sourcePortId || !line.targetPortId) errors.push(`${line.id} 连接端点无效`);
  }
  return errors;
}
