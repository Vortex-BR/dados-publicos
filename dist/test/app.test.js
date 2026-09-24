import assert from "node:assert/strict";
import test from "node:test";
process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.API_KEYS = "test-public-key-123456789012345678901234";
process.env.ADMIN_API_KEY = "test-admin-key-1234567890123456789012345";
process.env.AUTO_SYNC_ENABLED = "false";
const { createApp } = await import("../src/app.js");
test("expõe identificação e liveness sem autenticação", async () => {
    const { app } = await createApp();
    try {
        const root = await app.inject({ method: "GET", url: "/" });
        const live = await app.inject({ method: "GET", url: "/health/live" });
        assert.equal(root.statusCode, 200);
        assert.equal(root.json().service, "campania-ninja-tse-collector");
        assert.equal(live.statusCode, 200);
    }
    finally {
        await app.close();
    }
});
test("protege resultados e rotas internas com chaves diferentes", async () => {
    const { app } = await createApp();
    try {
        const publicDenied = await app.inject({ method: "GET", url: "/v1/apuracao" });
        const adminDeniedWithPublicKey = await app.inject({
            method: "POST",
            url: "/v1/internal/sync",
            headers: { "x-api-key": process.env.API_KEYS ?? "" },
        });
        assert.equal(publicDenied.statusCode, 401);
        assert.equal(adminDeniedWithPublicKey.statusCode, 401);
    }
    finally {
        await app.close();
    }
});
//# sourceMappingURL=app.test.js.map