import { PGlite } from "@electric-sql/pglite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  scenarios,
  type ScenarioState,
  type Dashboard,
  type AiTask,
  type Audit,
} from "@water/contracts";
import { healthSimulation } from "./health-simulation";
import { seed } from "./seed";
export interface Stored {
  scenarioId: (typeof scenarios)[number];
  epoch: number;
  states: Record<string, ScenarioState>;
  dashboards: Dashboard[];
  tasks: AiTask[];
  audits: Audit[];
  features: Record<string, boolean>;
  preferences: Record<string, unknown>;
}
export class Database {
  pg!: PGlite;
  async init() {
    const path =
      process.env.WATER_DATA_DIR ?? resolve(process.cwd(), ".data/postgres");
    if (path !== "memory://") await mkdir(path, { recursive: true });
    this.pg = await PGlite.create(path);
    await this.pg.exec(
      `CREATE TABLE IF NOT EXISTS migrations(version integer PRIMARY KEY, applied_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS demo_state(id integer PRIMARY KEY CHECK(id=1), payload jsonb NOT NULL); INSERT INTO migrations(version) VALUES(1) ON CONFLICT DO NOTHING;`,
    );
    const initial: Stored = {
      scenarioId: "SCN-BASE",
      epoch: 1,
      states: Object.fromEntries(scenarios.map((id) => [id, seed(id)])),
      dashboards: [],
      tasks: [],
      audits: [],
      features: { reports: true, health: true },
      preferences: {},
    };
    await this.pg.query(
      "INSERT INTO demo_state(id,payload) VALUES(1,$1) ON CONFLICT DO NOTHING",
      [JSON.stringify(initial)],
    );
    // 非破坏性升级：保留已有工单、台账和场景，仅补齐旧版泵的 SIM 历史。
    await this.mutate(s => {
      for (const [id, state] of Object.entries(s.states)) {
        for (const a of state.assets) if (a.type === "pump" && !a.healthTelemetry)
          a.healthTelemetry = healthSimulation(id === "SCN-PUMP" && a.id === "medium-pressure-2n" ? "degrading" : "normal");
      }
    });
  }
  async read(): Promise<Stored> {
    const r = await this.pg.query<{ payload: Stored }>(
      "SELECT payload FROM demo_state WHERE id=1",
    );
    return r.rows[0]!.payload;
  }
  async mutate<T>(fn: (state: Stored) => T | Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      const r = await tx.query<{ payload: Stored }>(
        "SELECT payload FROM demo_state WHERE id=1 FOR UPDATE",
      );
      const state = r.rows[0]!.payload;
      const result = await fn(state);
      await tx.query("UPDATE demo_state SET payload=$1 WHERE id=1", [
        JSON.stringify(state),
      ]);
      return result;
    });
  }
  async close() {
    await this.pg.close();
  }
}
