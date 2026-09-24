import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { clearState, finishRun, getState, getStoredResult, listStoredResults, saveResult, setState, startRun, touchNotModified, withCollectorLock, } from "./repository.js";
import { FIRST_ROUND_START, SECOND_ROUND_START, TECHNICAL_URL, TseHttpError, discoverSecondRoundElection, fetchTseJson, firstRoundTargets, normalizePayload, payloadHash, resultWindowIsOpen, secondRoundPresidentTarget, tseSettings, } from "./tse.js";
const settings = tseSettings();
export class Collector {
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    async sync(trigger, force = false) {
        const result = await withCollectorLock(() => this.runLocked(trigger, force));
        if (result)
            return result;
        return {
            runId: randomUUID(),
            trigger,
            status: "skipped",
            fetched: 0,
            changed: 0,
            errors: [],
            reason: "Outra instância já está executando a sincronização.",
        };
    }
    async runLocked(trigger, force) {
        const runId = await startRun(settings.environment, trigger);
        const report = {
            runId,
            trigger,
            status: "success",
            fetched: 0,
            changed: 0,
            errors: [],
        };
        try {
            if (!resultWindowIsOpen(settings)) {
                report.status = "skipped";
                report.reason = "A janela oficial da apuração ainda não foi aberta.";
                return report;
            }
            const backoff = await getState(this.stateKey("backoff"));
            if (backoff && new Date(backoff.until).getTime() > Date.now()) {
                report.status = "skipped";
                report.reason = `Recuo de segurança ativo até ${backoff.until}.`;
                return report;
            }
            const targets = await this.targets();
            for (const target of targets) {
                const previous = await getStoredResult(target.key);
                if (previous?.final && !force)
                    continue;
                try {
                    const fetched = await fetchTseJson(target.url, {
                        etag: previous?.sourceEtag ?? null,
                        lastModified: previous?.sourceLastModified ?? null,
                    });
                    report.fetched += 1;
                    if (fetched.status === "not-modified") {
                        await touchNotModified(target.key, fetched.etag, fetched.lastModified);
                        continue;
                    }
                    const normalized = normalizePayload(fetched.payload, target, settings);
                    const changed = await saveResult(normalized, {
                        payloadSha256: payloadHash(fetched.raw),
                        etag: fetched.etag,
                        lastModified: fetched.lastModified,
                    });
                    if (changed)
                        report.changed += 1;
                }
                catch (error) {
                    const status = error instanceof TseHttpError ? error.status : undefined;
                    const item = {
                        target: target.key,
                        ...(status ? { status } : {}),
                        message: error instanceof Error ? error.message : "Erro desconhecido durante a coleta.",
                    };
                    report.errors.push(item);
                    await this.rememberError(target, item.message, status ?? 500);
                    this.logger.warn({ target: target.key, status, error: item.message }, "Falha ao consultar arquivo do TSE");
                    if (status === 404 || status === 429)
                        break;
                }
            }
            if (report.errors.length)
                report.status = report.fetched > 0 ? "partial" : "failed";
            else
                await clearState(this.stateKey("last-error"));
            if (!report.errors.length)
                await clearState(this.stateKey("backoff"));
            return report;
        }
        catch (error) {
            const status = error instanceof TseHttpError ? error.status : 500;
            report.status = "failed";
            report.errors.push({
                target: "configuração",
                status,
                message: error instanceof Error ? error.message : "Falha desconhecida durante a sincronização.",
            });
            await this.rememberError(null, report.errors[report.errors.length - 1]?.message ?? "Falha desconhecida.", status);
            this.logger.error({ error }, "Sincronização do TSE interrompida");
            return report;
        }
        finally {
            await finishRun(report);
            this.logger.info({
                runId: report.runId,
                status: report.status,
                fetched: report.fetched,
                changed: report.changed,
            }, "Sincronização do TSE concluída");
        }
    }
    async targets() {
        const targets = firstRoundTargets(settings);
        if (Date.now() < SECOND_ROUND_START.getTime())
            return targets;
        const key = this.stateKey("president-second-round");
        const cached = await getState(key);
        if (cached?.electionId)
            return [...targets, secondRoundPresidentTarget(cached.electionId, settings)];
        if (cached && new Date(cached.checkedAt).getTime() > Date.now() - 5 * 60_000)
            return targets;
        const fetched = await fetchTseJson(settings.configUrl);
        if (fetched.status === "not-modified")
            return targets;
        const electionId = discoverSecondRoundElection(fetched.payload, settings.presidentElectionId);
        await setState(key, { electionId, checkedAt: new Date().toISOString() });
        return electionId ? [...targets, secondRoundPresidentTarget(electionId, settings)] : targets;
    }
    async rememberError(target, message, status) {
        const now = new Date();
        const delay = status === 404 || status === 429 ? 10 * 60_000 : 2 * 60_000;
        const error = {
            message,
            code: status,
            at: now.toISOString(),
            target: target?.key ?? "configuração",
        };
        const backoff = {
            ...error,
            status,
            until: new Date(now.getTime() + delay).toISOString(),
        };
        await Promise.all([
            setState(this.stateKey("last-error"), error),
            setState(this.stateKey("backoff"), backoff),
        ]);
    }
    async apiPayload() {
        const [rows, lastError, backoff] = await Promise.all([
            listStoredResults(settings.environment),
            getState(this.stateKey("last-error")),
            getState(this.stateKey("backoff")),
        ]);
        const contests = rows.map(({ payloadSha256: _hash, sourceEtag: _etag, sourceLastModified: _modified, ...row }) => row);
        const windowOpen = resultWindowIsOpen(settings);
        const allFinal = contests.length > 0 && contests.every((contest) => contest.final);
        const status = !contests.length
            ? windowOpen && lastError
                ? "erro"
                : "aguardando"
            : allFinal
                ? "finalizado"
                : "apurando";
        return {
            status,
            automatic: config.AUTO_SYNC_ENABLED,
            pollingSeconds: 30,
            serverIntervalSeconds: config.TSE_POLL_INTERVAL_SECONDS,
            now: new Date().toISOString(),
            scheduledStart: FIRST_ROUND_START.toISOString(),
            secondRoundStart: SECOND_ROUND_START.toISOString(),
            windowOpen,
            source: {
                name: "Tribunal Superior Eleitoral (TSE)",
                official: settings.official,
                environment: settings.environment,
                baseUrl: settings.root,
                technicalUrl: TECHNICAL_URL,
                exclusive: true,
            },
            scope: {
                deputy: "Deputado Federal — Paraná — Newton Bonin",
                president: "Presidente da República — Brasil",
            },
            contests,
            lastError,
            backoffUntil: backoff && new Date(backoff.until).getTime() > Date.now() ? backoff.until : null,
            collector: {
                service: "campania-ninja-tse-collector",
                storage: "postgresql",
                version: "1.0.0",
            },
        };
    }
    stateKey(name) {
        return `${settings.environment}:${name}`;
    }
}
//# sourceMappingURL=collector.js.map