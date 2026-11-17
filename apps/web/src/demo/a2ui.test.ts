import test from "node:test";
import assert from "node:assert/strict";
import {
  A2UI_CATALOG_ID,
  applyMessages,
  composeEnergySurface,
  composeRainSurface,
  dashboardToMessages,
  surfaceToWidgets,
} from "./a2ui";
import type { A2uiMessage, Surface } from "./a2ui";
import { buildSeed } from "./seed";

const seed = buildSeed("SCN-NORMAL");

function baseMessages(): A2uiMessage[] {
  return [
    {
      type: "createSurface",
      surface: {
        surfaceId: "surface-test",
        root: "metric-1",
        catalogId: A2UI_CATALOG_ID,
        dataModel: { params: { chartType: "line", rangeCount: 3, showAverage: false } },
      },
    },
    {
      type: "updateComponents",
      surfaceId: "surface-test",
      components: [
        {
          id: "metric-1",
          component: "MetricCard",
          props: { label: "活动告警", value: 2, unit: "条", hint: "status=active" },
        },
      ],
    },
  ];
}

function baseSurface(): Surface {
  const result = applyMessages(null, baseMessages(), "manager");
  assert.equal(result.rejected, false);
  assert.ok(result.surface);
  return result.surface;
}

test("合法 createSurface + updateComponents 得到可渲染 Surface", () => {
  const result = applyMessages(null, baseMessages(), "manager");
  assert.equal(result.rejected, false);
  assert.equal(result.errors.length, 0);
  assert.ok(result.surface);
  assert.equal(result.surface?.surfaceId, "surface-test");
  assert.equal(result.surface?.root, "metric-1");
  assert.equal(result.surface?.catalogId, A2UI_CATALOG_ID);
  assert.equal(result.surface?.components.length, 1);
  assert.equal(result.surface?.components[0].component, "MetricCard");
  assert.deepEqual(result.surface?.dataModel.params, {
    chartType: "line",
    rangeCount: 3,
    showAverage: false,
  });
});

test("未知组件整条消息拒绝，保留最近一次合法 Surface", () => {
  const previous = baseSurface();
  const result = applyMessages(
    previous,
    [
      {
        type: "updateComponents",
        surfaceId: previous.surfaceId,
        components: [
          { id: "evil-1", component: "HtmlInjection", props: { html: "<b>x</b>" } },
        ],
      },
    ],
    "manager",
  );
  assert.equal(result.rejected, true);
  assert.equal(result.errors[0].code, "UNKNOWN_COMPONENT");
  assert.deepEqual(result.surface, previous);
  assert.equal(result.surface?.components.length, 1);
  assert.equal(result.surface?.components[0].id, "metric-1");
});

test("非法属性拒绝且不产生部分更新", () => {
  const previous = baseSurface();
  const result = applyMessages(
    previous,
    [
      {
        type: "updateComponents",
        surfaceId: previous.surfaceId,
        components: [
          {
            id: "metric-1",
            component: "MetricCard",
            props: { label: "合法组件", value: 1, unit: "条" },
          },
          {
            id: "metric-2",
            component: "MetricCard",
            props: { label: "缺少数值", value: { nested: true } },
          },
          {
            id: "metric-3",
            component: "MetricCard",
            props: { label: "未知属性", value: 1, dangerouslySetInnerHTML: "<b>x</b>" },
          },
        ],
      },
    ],
    "manager",
  );
  assert.equal(result.rejected, true);
  assert.ok(result.errors.some((error) => error.code === "INVALID_PROPS"));
  assert.deepEqual(result.surface, previous);
  assert.equal(result.surface?.components.length, 1);
  assert.equal(result.surface?.components[0].props?.label, "活动告警");
});

test("越权动作返回 FORBIDDEN_ACTION，授权角色可通过", () => {
  const previous = baseSurface();
  const message: A2uiMessage = {
    type: "updateComponents",
    surfaceId: previous.surfaceId,
    components: [
      {
        id: "metric-1",
        component: "MetricCard",
        props: {
          label: "活动告警",
          value: 2,
          unit: "条",
          action: { kind: "askAi", label: "问 AI" },
        },
      },
    ],
  };

  const denied = applyMessages(previous, [message], "viewer");
  assert.equal(denied.rejected, true);
  assert.equal(denied.errors[0].code, "FORBIDDEN_ACTION");
  assert.deepEqual(denied.surface, previous);

  const allowed = applyMessages(previous, [message], "manager");
  assert.equal(allowed.rejected, false);
  assert.equal(allowed.surface?.components[0].props?.action !== undefined, true);
});

test("本地无电耗测点时拒绝生成并返回 MISSING_DATA", () => {
  const result = composeEnergySurface(seed.points);
  assert.equal(result.rejected, true);
  assert.equal(result.messages.length, 0);
  assert.equal(result.errors[0].code, "MISSING_DATA");
  assert.ok(
    seed.points.every(
      (point) => point.unit !== "kW" && point.unit !== "kWh" && !point.label.includes("电耗"),
    ),
  );
});

test("改图型 / 改范围 / 平均值参数反映在组件 props", () => {
  const first = composeRainSurface(seed, {
    chartType: "bar",
    rangeCount: 2,
    showAverage: true,
  });
  assert.equal(first.rejected, false);
  assert.equal(first.params?.chartType, "bar");

  const applied = applyMessages(null, first.messages, "manager");
  assert.equal(applied.rejected, false);
  const surface = applied.surface;
  assert.ok(surface);
  const chart = surface.components.find((component) => component.component === "CompareChart");
  assert.ok(chart);
  assert.equal(chart.props?.chartType, "bar");
  assert.equal(chart.props?.showAverage, true);
  assert.equal((chart.props?.labels as string[]).length, 2);
  const series = chart.props?.series as { name: string; values: number[] }[];
  assert.equal(series.length, 3);
  assert.equal(series[2].name, "南北均值");

  const second = composeRainSurface(seed, {
    chartType: "line",
    rangeCount: 1,
    showAverage: false,
  });
  const reapplied = applyMessages(surface, second.messages, "manager");
  assert.equal(reapplied.rejected, false);
  const nextChart = reapplied.surface?.components.find(
    (component) => component.component === "CompareChart",
  );
  assert.ok(nextChart);
  assert.equal(nextChart.props?.chartType, "line");
  assert.equal(nextChart.props?.showAverage, false);
  assert.equal((nextChart.props?.labels as string[]).length, 1);
  assert.equal((nextChart.props?.series as unknown[]).length, 2);
});

test("Surface 转 widget 后保留生成参数，并可回转为消息恢复", () => {
  const composed = composeRainSurface(seed, {
    chartType: "bar",
    rangeCount: 3,
    showAverage: true,
  });
  const applied = applyMessages(null, composed.messages, "manager");
  assert.ok(applied.surface);
  const widgets = surfaceToWidgets(applied.surface);
  assert.equal(widgets.length, 2);
  const chart = widgets.find((widget) => widget.component === "CompareChart");
  assert.ok(chart);
  assert.equal(chart.props.chartType, "bar");
  assert.equal(chart.props.rangeCount, 3);
  assert.equal(chart.props.showAverage, true);
  assert.equal((chart.props.rainEventIds as string[]).length, 3);

  const restored = applyMessages(
    null,
    dashboardToMessages({
      id: "dash-test",
      name: "测试看板",
      ownerId: "demo-user",
      ownerRole: "manager",
      scope: "personal",
      widgets,
      version: 2,
      createdAt: seed.referenceTime,
      updatedAt: seed.referenceTime,
      history: [],
    }),
    "manager",
  );
  assert.equal(restored.rejected, false);
  assert.equal(restored.surface?.components.length, 2);
  assert.equal(restored.surface?.dataModel.params !== undefined, true);
});
