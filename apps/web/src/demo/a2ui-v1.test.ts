import test from "node:test";
import assert from "node:assert/strict";
import { A2UI_CATALOG_ID } from "./a2ui";
import { applyOfficialMessages, officialAction } from "./a2ui-v1";

const surfaceId = "rain";
const metric = {
  id: "root",
  component: "MetricCard",
  label: "末段储量",
  unit: "m³",
  value: { "@path": "/volume" },
};
const create = {
  version: "1.0",
  createSurface: {
    surfaceId,
    catalogId: A2UI_CATALOG_ID,
    dataModel: { volume: 450 },
    components: [metric],
  },
};

test("官方 1.0 消息创建、更新绑定值、更新组件及删除 Surface", () => {
  const initial = applyOfficialMessages(null, [create], "manager");
  assert.equal(initial.error, null);
  const updated = applyOfficialMessages(
    initial.current,
    [
      {
        version: "1.0",
        updateDataModel: { surfaceId, path: "/volume", value: 550 },
      },
      {
        version: "1.0",
        updateComponents: {
          surfaceId,
          components: [{ ...metric, label: "北区" }],
        },
      },
    ],
    "manager",
  );
  assert.equal(updated.error, null);
  assert.equal(updated.current?.surface.components[0].props?.value, 550);
  assert.equal(updated.current?.surface.components[0].props?.label, "北区");
  assert.deepEqual(
    applyOfficialMessages(
      updated.current,
      [{ version: "1.0", deleteSurface: { surfaceId } }],
      "manager",
    ),
    { current: null, error: null },
  );
});

test("官方 1.0 批次拒绝缺失绑定、未知组件、非法路径和未授权动作", () => {
  const { current } = applyOfficialMessages(null, [create], "manager");
  assert.ok(current);
  const bad = [
    { updateDataModel: { surfaceId, path: "/volume", value: null } },
    { updateDataModel: { surfaceId, path: "/__proto__", value: 1 } },
    {
      updateComponents: {
        surfaceId,
        components: [{ ...metric, component: "HTML" }],
      },
    },
    {
      updateComponents: {
        surfaceId,
        components: [
          {
            ...metric,
            action: {
              event: {
                name: "saveDashboard",
                context: {},
              },
            },
          },
        ],
      },
    },
  ];
  for (const message of bad) {
    const result = applyOfficialMessages(
      current,
      [{ version: "1.0", ...message }],
      "viewer",
    );
    assert.ok(result.error);
    assert.equal(result.current, current);
  }
  assert.equal(
    officialAction(current.surface, "root", "viewer", new Date(0)),
    null,
  );
});
