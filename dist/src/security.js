import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
const publicPaths = new Set(["/", "/health/live", "/health/ready", "/openapi.json"]);
function secureEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function token(request) {
    const direct = request.headers["x-api-key"];
    if (typeof direct === "string")
        return direct;
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}
export function registerSecurity(app) {
    app.addHook("onRequest", async (request, reply) => {
        const path = request.url.split("?", 1)[0] ?? request.url;
        if (publicPaths.has(path) || path.startsWith("/docs"))
            return;
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
//# sourceMappingURL=security.js.map