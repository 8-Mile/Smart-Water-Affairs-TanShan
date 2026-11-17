import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Query,
  Param,
  Module,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Catch,
  HttpException,
  type ExceptionFilter,
  type ArgumentsHost,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  roles,
  scenarios,
  asOf,
  RainInput,
  SupplyInput,
  metricDefinitions,
  type User,
} from "@water/contracts";
import { runRain, supplyHours } from "@water/domain";
import { Database } from "./db";
import { Service, user, permit, audit, validateLayout } from "./service";
import { AiService } from "./ai";
const db = new Database();
await db.init();
const service = new Service(db),
  ai = new AiService(service);
const sessions = new Map<string, { user: User; expires: number }>();
function identity(auth?: string) {
  const session = sessions.get(auth?.replace(/^Bearer /, "") ?? "");
  if (!session || session.expires < Date.now())
    throw new UnauthorizedException("演示登录已失效，请重新选择角色");
  return session.user;
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new BadRequestException(
      r.error.issues.map((x) => x.message).join("；"),
    );
  return r.data;
}
const text = z.string().trim().min(1).max(2000),
  epoch = z.number().int().positive();
@Catch()
class Errors implements ExceptionFilter {
  async catch(e: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<{
      headers: { authorization?: string };
      url: string;
    }>();
    const response = http.getResponse<{
      status: (n: number) => { json: (v: unknown) => void };
    }>();
    const status = e instanceof HttpException ? e.getStatus() : 500;
    const message = e instanceof HttpException ? e.message : "服务暂时不可用";
    if (status === 403) {
      const session = sessions.get(
        request.headers.authorization?.replace(/^Bearer /, "") ?? "",
      );
      if (session)
        await db.mutate((s) =>
          audit(s, session.user, "denied", request.url, message),
        );
    }
    if (status === 500) console.error(e);
    response
      .status(status)
      .json({ statusCode: status, message, requestId: randomUUID() });
  }
}
@Controller("api")
class ApiController {
  @Get("health") health() {
    return { status: "ok", storage: "PGlite/PostgreSQL", dataMode: "SIM" };
  }
  @Post("demo/session") async login(@Body() raw: unknown) {
    const body = parse(z.object({ role: z.enum(roles) }).strict(), raw);
    const token = randomUUID(),
      u = user(body.role);
    sessions.set(token, { user: u, expires: Date.now() + 8 * 3600000 });
    await db.mutate((s) => audit(s, u, "session.login", u.id, "隔离演示账号"));
    return { token, user: u };
  }
  @Get("me") me(@Headers("authorization") a?: string) {
    return identity(a);
  }
  @Get("snapshot") snapshot(@Headers("authorization") a?: string) {
    return service.snapshot(identity(a));
  }
  @Get("subsystems") async list(
    @Headers("authorization") a?: string,
    @Query("scenarioId") id?: string,
  ) {
    const u = identity(a),
      s = await db.read();
    const scenarioId = id ? parse(z.enum(scenarios), id) : s.scenarioId;
    return {
      result: service.summaries(s.states[scenarioId]!, u),
      scenarioId,
      dataMode: "SIM",
      asOf,
    };
  }
  @Get("subsystems/:id") async detail(
    @Param("id") id: string,
    @Headers("authorization") a?: string,
    @Query("scenarioId") scenario?: string,
  ) {
    const data = await this.list(a, scenario);
    const result = data.result.find((p) => p.id === id);
    if (!result) throw new NotFoundException("工艺不存在");
    return { ...data, result };
  }
  @Get("assets/:id") asset(
    @Param("id") id: string,
    @Headers("authorization") a?: string,
  ) {
    return service.asset(identity(a), id);
  }
  @Post("alarms/:id/transition") alarm(
    @Param("id") id: string,
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const b = parse(
      z
        .object({
          action: z.enum(["acknowledge", "recover", "close"]),
          note: text,
          epoch,
        })
        .strict(),
      raw,
    );
    return service.alarm(identity(a), id, b.action, b.note, b.epoch);
  }
  @Post("workorders") work(
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const b = parse(
      z
        .object({
          assetId: text,
          eventId: text.nullable().optional(),
          title: text,
          description: text,
          epoch,
        })
        .strict(),
      raw,
    );
    return db.mutate((s) => service.createWork(s, identity(a), b, b.epoch));
  }
  @Post("workorders/:id/transition") transition(
    @Param("id") id: string,
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const b = parse(
      z
        .object({
          action: z.enum([
            "submit",
            "assign",
            "start",
            "review",
            "close",
            "cancel",
          ]),
          note: text,
          epoch,
          version: epoch,
        })
        .strict(),
      raw,
    );
    return service.work(identity(a), id, b.action, b.note, b.epoch, b.version);
  }
  @Post("decision/four-pre/run") async rain(
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const u = identity(a);
    permit(u, "decision:run");
    const p = parse(RainInput, raw);
    const base = runRain(p),
      plan = runRain({ ...p, outflow: p.outflow * 1.5 });
    await db.mutate((s) =>
      audit(s, u, "decision.run", "rain", JSON.stringify(p)),
    );
    return {
      base,
      plan,
      meta: {
        dataMode: "CALC",
        formulaVersion: "water-balance-1.0",
        inputRefs: ["SIM user parameters"],
        assumptions: base.assumptions,
      },
    };
  }
  @Post("admin/scenarios") scene(
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const b = parse(
      z
        .object({
          scenarioId: z.enum(scenarios),
          reset: z.boolean(),
          keepDashboards: z.boolean().default(true),
        })
        .strict(),
      raw,
    );
    return service.scenario(
      identity(a),
      b.scenarioId,
      b.reset,
      b.keepDashboards,
    );
  }
  @Get("admin/audit") async logs(@Headers("authorization") a: string) {
    permit(identity(a), "audit:read");
    return (await db.read()).audits.slice(-300).reverse();
  }
  @Post("admin/features") feature(
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const u = identity(a);
    permit(u, "admin:write");
    const b = parse(
      z
        .object({
          feature: z.enum(["reports", "health"]),
          enabled: z.boolean(),
        })
        .strict(),
      raw,
    );
    return db.mutate((s) => {
      s.features[b.feature] = b.enabled;
      audit(s, u, "feature.update", b.feature, String(b.enabled));
      return s.features;
    });
  }
  @Get("dashboards") async dashboards(@Headers("authorization") a: string) {
    const u = identity(a);
    return (await db.read()).dashboards.filter((d) => d.ownerId === u.id);
  }
  @Post("dashboards") save(
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const b = parse(
      z
        .object({
          layout: z.unknown(),
          id: z.string().optional(),
          version: epoch.optional(),
        })
        .strict(),
      raw,
    );
    return service.saveDashboard(identity(a), b.layout, b.id, b.version);
  }
  @Post("dashboards/:id/restore") restore(
    @Param("id") id: string,
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const b = parse(z.object({ target: epoch, version: epoch }).strict(), raw);
    return service.restoreDashboard(identity(a), id, b.target, b.version);
  }
  @Post("metrics/query") datasets(
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const u = identity(a),
      layout = validateLayout(raw, u);
    return service.datasets(u, layout);
  }
  @Get("preferences/:key") async prefs(
    @Param("key") key: string,
    @Headers("authorization") a: string,
  ) {
    const u = identity(a);
    return (await db.read()).preferences[`${u.id}:${key}`] ?? null;
  }
  @Post("preferences/:key") prefSave(
    @Param("key") key: string,
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const u = identity(a);
    permit(u, "dashboard:write");
    const b = parse(
      z
        .object({
          columns: z
            .array(z.enum(["name", "status", "area", "runtime"]))
            .min(1)
            .max(4),
          search: z.string().max(100),
          sort: z.enum(["name", "runtime", "status"]),
        })
        .strict(),
      raw,
    );
    return db.mutate((s) => {
      s.preferences[`${u.id}:${key}`] = b;
      return b;
    });
  }
  @Get("ai/tasks") async tasks(@Headers("authorization") a: string) {
    const u = identity(a);
    return (await db.read()).tasks.filter((t) => t.ownerId === u.id).reverse();
  }
  @Post("ai/tasks") task(
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const u = identity(a),
      b = parse(
        z
          .object({
            prompt: text,
            layout: z.unknown().optional(),
            assetId: z.string().optional(),
          })
          .strict(),
        raw,
      );
    return ai.run(
      u,
      b.prompt,
      b.layout ? validateLayout(b.layout, u) : undefined,
      b.assetId,
    );
  }
  @Post("ai/tasks/:id/approve") approve(
    @Param("id") id: string,
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const b = parse(
      z
        .object({
          dashboardId: z.string().optional(),
          version: epoch.optional(),
        })
        .strict(),
      raw,
    );
    return service.approveTask(identity(a), id, b.dashboardId, b.version);
  }
  @Get("metrics/definitions") definitions(@Headers("authorization") a: string) {
    identity(a);
    return metricDefinitions;
  }
  @Post("decision/supply/run") async supply(
    @Headers("authorization") a: string,
    @Body() raw: unknown,
  ) {
    const u = identity(a);
    permit(u, "decision:run");
    const p = parse(SupplyInput, raw);
    const result = {
      hours: supplyHours(p.storage, p.reserve, p.demand),
      dataMode: "CALC",
      metricCode: "pool.supply_hours",
      unit: "h",
      formulaVersion: "supply-1.0",
      assumptions: [
        "SIM 恒定需求假设",
        "保留储量不参与普通经济用水",
        "不包含未来补水和水质可达性判断",
      ],
      inputRefs: p,
    };
    await db.mutate((s) =>
      audit(s, u, "decision.run", "supply", JSON.stringify(p)),
    );
    return result;
  }
  @Get("reports") async reports(@Headers("authorization") a: string) {
    const u = identity(a),
      app = await service.snapshot(u);
    if (!app.features.reports) throw new BadRequestException("报表模块已停用");
    return {
      water: app.ledger,
      assets: app.assets,
      alarms: app.alarms,
      workorders: app.workorders,
    };
  }
}
@Module({ controllers: [ApiController] })
class AppModule {}
const app = await NestFactory.create(AppModule);
app.useGlobalFilters(new Errors());
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001), "127.0.0.1");
process.on("SIGINT", async () => {
  await app.close();
  await db.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await app.close();
  await db.close();
  process.exit(0);
});
