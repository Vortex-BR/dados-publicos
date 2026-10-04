import { config } from "./config.js";
import { Collector } from "./collector.js";
import {
  CONFIG_PREFLIGHT_START,
  FIRST_ROUND_START,
  SECOND_ROUND_START,
  tseSettings,
} from "./tse.js";

type Logger = {
  info: (properties: object, message: string) => void;
  error: (properties: object, message: string) => void;
};

const PREFLIGHT_INTERVAL_MS = 15 * 60_000;

export function nextPreOpeningDelay(now = Date.now()) {
  const untilOpening = FIRST_ROUND_START.getTime() - now;
  return Math.max(1_000, Math.min(PREFLIGHT_INTERVAL_MS, untilOpening));
}

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
      if (settings.official && Date.now() < FIRST_ROUND_START.getTime()) {
        // Continue o preflight a cada 15 minutos, mas acorde exatamente na
        // abertura. Sem esse limite, um ciclo iniciado pouco antes das 17h
        // poderia adiar a primeira coleta em até 15 minutos.
        schedule(nextPreOpeningDelay());
        return;
      }
    } catch (error) {
      logger.error({ error }, "Falha no ciclo automático do coletor");
    }
    schedule(config.TSE_POLL_INTERVAL_SECONDS * 1_000);
  };

  if (config.AUTO_SYNC_ENABLED) {
    const firstDelay =
      settings.official && Date.now() < CONFIG_PREFLIGHT_START.getTime()
        ? CONFIG_PREFLIGHT_START.getTime() - Date.now()
        : 1_000;
    schedule(firstDelay);
  }

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
