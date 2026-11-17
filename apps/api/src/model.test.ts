import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLayout } from "@water/contracts";
import { Database } from "./db";
import { Service, user } from "./service";
import { AiService } from "./ai";

test("模型适配器校验与失败保护（本地替身，不代表真实模型验收）", async () => {
  process.env.WATER_DATA_DIR = "memory://";
  process.env.AI_GATEWAY_URL = "http://model.test/generate";
  delete process.env.AI_FORCE_OFFLINE;
  const db = new Database();
  await db.init();
  const service = new Service(db),
    ai = new AiService(service),
    u = user("manager");
  const originalFetch = globalThis.fetch;
  try {
    const saved = await service.saveDashboard(u, defaultLayout(u.scopes));
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          layout: { ...defaultLayout(u.scopes), script: "alert(1)" },
        }),
        { status: 200 },
      );
    const invalid = await ai.run(u, "生成雨水图");
    assert.equal(invalid.status, "failed");
    assert.equal((await db.read()).dashboards[0]!.version, saved.version);
    globalThis.fetch = async () => {
      throw new Error("模拟模型超时");
    };
    const offline = await ai.run(u, "生成雨水图");
    assert.equal(offline.status, "failed");
    assert.ok(offline.output.includes("旧版本已保留"));
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ layout: defaultLayout(u.scopes) }), {
        status: 200,
      });
    const valid = await ai.run(u, "生成雨水图");
    assert.equal(valid.mode, "模型");
    assert.equal(valid.status, "awaiting_approval");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.AI_GATEWAY_URL;
    await db.close();
  }
});
