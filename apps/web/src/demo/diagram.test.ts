import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSprayDiagram, nextSprayPosition, validateDiagram } from './diagram';
import { buildSeed } from './seed';

test('射雾器图元容量不受原四台槽位限制，新增设备不自动连接管线', () => {
  const seed = buildSeed('SCN-NORMAL');
  const diagram = defaultSprayDiagram(seed.assets);
  const first = nextSprayPosition(diagram.nodes, 'B');
  diagram.nodes.push({ id: 'node-sp005', assetId: 'sp005', symbolId: 'fog_cannon', position: first, size: { width: 91, height: 98 }, pointBindings: [], visible: true });
  const second = nextSprayPosition(diagram.nodes, 'B');
  diagram.nodes.push({ id: 'node-sp006', assetId: 'sp006', symbolId: 'fog_cannon', position: second, size: { width: 91, height: 98 }, pointBindings: [], visible: true });
  diagram.viewBox.width = Math.max(diagram.viewBox.width, second.x + 130);
  assert.equal(diagram.nodes.length, 6);
  assert.notDeepEqual(first, second);
  assert.deepEqual(diagram.connections, []);
  const assets = [...seed.assets, ...['sp005', 'sp006'].map(id => ({ ...seed.assets[0], id, code: id.toUpperCase() }))];
  assert.deepEqual(validateDiagram(diagram, assets, seed.points), []);
});

test('发布校验拒绝重复绑定与无效测点', () => {
  const seed = buildSeed('SCN-NORMAL');
  const diagram = defaultSprayDiagram(seed.assets);
  diagram.nodes[1].assetId = diagram.nodes[0].assetId;
  diagram.nodes[0].pointBindings.push({ pointId: 'missing', displayRole: 'label' });
  const errors = validateDiagram(diagram, seed.assets, seed.points);
  assert.ok(errors.some(item => item.includes('重复绑定')));
  assert.ok(errors.some(item => item.includes('测点引用无效')));
});
