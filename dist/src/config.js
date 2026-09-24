import { z } from "zod";
try {
    process.loadEnvFile();
}
catch (error) {
    if (error.code !== "ENOENT")
        throw error;
}
const booleanValue = z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1");
const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: booleanValue,
    API_KEYS: z.string().min(32),
    ADMIN_API_KEY: z.string().min(32),
    CORS_ORIGINS: z.string().default(""),
    AUTO_SYNC_ENABLED: z
        .enum(["true", "false", "1", "0"])
        .default("true")
        .transform((value) => value === "true" || value === "1"),
    TSE_ENVIRONMENT: z.enum(["oficial", "simulado"]).default("oficial"),
    TSE_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(60),
    TSE_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(60).default(15),
    TSE_NEWTON_BONIN_SQ_CANDIDATO: z.string().trim().default(""),
    TSE_NEWTON_BONIN_NUMERO: z.string().trim().default(""),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
    throw new Error(`Configuração inválida: ${details}`);
}
const raw = parsed.data;
function commaList(value) {
    return [
        ...new Set(value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)),
    ];
}
export const config = {
    ...raw,
    apiKeys: commaList(raw.API_KEYS),
    corsOrigins: commaList(raw.CORS_ORIGINS),
};
if (config.apiKeys.some((key) => key.length < 32)) {
    throw new Error("Cada chave em API_KEYS deve possuir pelo menos 32 caracteres.");
}
if (config.apiKeys.includes(config.ADMIN_API_KEY)) {
    throw new Error("ADMIN_API_KEY deve ser diferente das chaves públicas de API_KEYS.");
}
//# sourceMappingURL=config.js.map