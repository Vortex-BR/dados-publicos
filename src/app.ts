import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { Collector } from "./collector.js";
import { config } from "./config.js";
import { databaseReady } from "./db.js";
import { recentRuns } from "./repository.js";
import { registerSecurity } from "./security.js";

export async function createApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 64 * 1024,
    requestTimeout: 20_000,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    maxAge: 86_400,
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => String(request.headers["x-api-key"] ?? request.ip),
    allowList: (request) => request.url.startsWith("/health/"),
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Campania Ninja — API de Apuração TSE 2026",
        version: "1.1.2",
        description: "Resultados oficiais do TSE normalizados e armazenados em PostgreSQL.",
      },
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  registerSecurity(app);

  const collector = new Collector(app.log);

  app.get("/", async () => ({
    service: "campania-ninja-tse-collector",
    version: "1.1.2",
    documentation: "/docs",
    health: "/health/ready",
  }));

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      const ready = await databaseReady();
      return {
        status: ready ? "ready" : "unavailable",
        database: ready ? "connected" : "unavailable",
      };
    } catch {
      return reply.code(503).send({ status: "unavailable", database: "disconnected" });
    }
  });

  app.get("/openapi.json", async () => app.swagger());

  app.get(
    "/v1/apuracao",
    { schema: { security: [{ ApiKeyAuth: [] }] } },
    async (_request, reply) => {
      reply.header("Cache-Control", "private, max-age=3, stale-while-revalidate=5");
      return collector.apiPayload();
    },
  );

  app.get(
    "/v1/apuracao/presidente",
    { schema: { security: [{ ApiKeyAuth: [] }] } },
    async (_request, reply) => {
      const payload = await collector.apiPayload();
      reply.header("Cache-Control", "private, max-age=3, stale-while-revalidate=5");
      return {
        ...payload,
        contests: payload.contests.filter((contest) => contest.cargo === "presidente"),
      };
    },
  );

  app.get(
    "/v1/apuracao/deputado-federal/newton-bonin",
    { schema: { security: [{ ApiKeyAuth: [] }] } },
    async (_request, reply) => {
      const payload = await collector.apiPayload();
      reply.header("Cache-Control", "private, max-age=3, stale-while-revalidate=5");
      return {
        ...payload,
        contests: payload.contests.filter((contest) => contest.cargo === "deputado_federal"),
      };
    },
  );

  app.post(
    "/v1/internal/sync",
    { schema: { security: [{ ApiKeyAuth: [] }] } },
    async (_request, reply) => {
      const report = await collector.sync("manual", true);
      return reply
        .code(report.status === "failed" ? 502 : 200)
        .send({ report, data: await collector.apiPayload() });
    },
  );

  app.get("/v1/internal/runs", { schema: { security: [{ ApiKeyAuth: [] }] } }, async () => ({
    runs: await recentRuns(50),
  }));

  return { app, collector };
}
