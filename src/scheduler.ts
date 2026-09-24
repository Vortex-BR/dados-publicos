import { config } from "./config.js";
import { Collector } from "./collector.js";
import { FIRST_ROUND_START, SECOND_ROUND_START, tseSettings } from "./tse.js";

type Logger = {
  info: (properties: object, message: string) => void;
  error: (properties: object, message: string) => void;
};

export function startScheduler(collector: Collector, logger: Logger) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const settings = tseSettings();

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(tick, Math.max(1_000, Math.min(delay, 2_147_000_000)));
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const report = await collector.sync("scheduler");
      const payload = await collector.apiPayload();
      logger.info(
        { status: report.status, nextMode: payload.status },
        "Ciclo automático do coletor executado",
      );

      if (payload.status === "finalizado") {
        if (settings.official && Date.now() < SECOND_ROUND_START.getTime()) {
          schedule(SECOND_ROUND_START.getTime() - Date.now());
          return;
        }
        schedule(60 * 60_000);
        return;
      }
    } catch (error) {
      logger.error({ error }, "Falha no ciclo automático do coletor");
    }
    schedule(config.TSE_POLL_INTERVAL_SECONDS * 1_000);
  };

  if (config.AUTO_SYNC_ENABLED) {
    const firstDelay =
      settings.official && Date.now() < FIRST_ROUND_START.getTime()
        ? FIRST_ROUND_START.getTime() - Date.now()
        : 1_000;
    schedule(firstDelay);
  }

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
