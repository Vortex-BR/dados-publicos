import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDatabase, migrate } from "./db.js";
import { startScheduler } from "./scheduler.js";

await migrate();
const { app, collector } = await createApp();
const stopScheduler = startScheduler(collector, app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Encerrando serviço");
  stopScheduler();
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error, "Não foi possível iniciar o serviço");
  stopScheduler();
  await closeDatabase();
  process.exit(1);
}
