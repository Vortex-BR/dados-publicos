import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";

const publicPaths = new Set(["/", "/health/live", "/health/ready", "/openapi.json"]);

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function token(request: FastifyRequest) {
  const direct = request.headers["x-api-key"];
  if (typeof direct === "string") return direct;
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export function registerSecurity(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (publicPaths.has(path) || path.startsWith("/docs")) return;
    const supplied = token(request);
    const admin = path.startsWith("/v1/internal/");
    const accepted = admin
      ? secureEqual(supplied, config.ADMIN_API_KEY)
      : config.apiKeys.some((expected) => secureEqual(supplied, expected));
    if (!accepted) {
      await reply
        .code(401)
        .send({ error: "unauthorized", message: "Chave de API ausente ou inválida." });
    }
  });
}
