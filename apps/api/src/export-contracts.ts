import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DashboardSchema,
  RainInput,
  SupplyInput,
  metricDefinitions,
} from "@water/contracts";
const source = await readFile(resolve("src/main.ts"), "utf8");
const paths: Record<string, Record<string, unknown>> = {};
for (const match of source.matchAll(/@(Get|Post)\("([^"]+)"\)/g)) {
  const method = match[1]!.toLowerCase();
  const route = "/api/" + match[2]!.replace(/:([a-zA-Z]+)/g, "{$1}");
  const parameters = [...route.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    in: "path",
    name: m[1],
    required: true,
    schema: { type: "string" },
  }));
  paths[route] ??= {};
  paths[route]![method] = {
    summary: route,
    security:
      route === "/api/health" || route === "/api/demo/session"
        ? []
        : [{ bearerAuth: [] }],
    parameters,
    responses: {
      [method === "post" ? "201" : "200"]: {
        description: "成功；业务字段参见共享TypeScript契约及契约与指标.md",
      },
      "400": { description: "参数不合法" },
      "401": { description: "演示会话无效" },
      "403": { description: "无操作或数据范围权限" },
      "409": { description: "版本、场景或状态冲突" },
    },
  };
}
const document = {
  openapi: "3.1.0",
  info: {
    title: "唐港智慧水务 DEMO API",
    version: "1.0.0",
    description:
      "本地模拟业务；接口清单由实际控制器导出。跨字段权限、状态与锁定组件约束由后端补充校验。",
  },
  servers: [{ url: "http://127.0.0.1:3001" }],
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: {
      DashboardLayout: z.toJSONSchema(DashboardSchema),
      RainParameters: z.toJSONSchema(RainInput),
      SupplyParameters: z.toJSONSchema(SupplyInput),
    },
  },
};
await mkdir(resolve("../../docs/api"), { recursive: true });
await writeFile(
  resolve("../../docs/api/openapi.json"),
  JSON.stringify(document, null, 2),
);
await writeFile(
  resolve("../../docs/api/metric-definitions.json"),
  JSON.stringify(metricDefinitions, null, 2),
);
console.log(`导出 ${Object.keys(paths).length} 条 API 路径与指标字典`);
