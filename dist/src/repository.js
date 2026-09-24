import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
export async function withCollectorLock(work) {
    const client = await pool.connect();
    try {
        const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", ["campania-ninja-tse-collector"]);
        if (!lock.rows[0]?.locked)
            return null;
        try {
            return await work();
        }
        finally {
            await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
                "campania-ninja-tse-collector",
            ]);
        }
    }
    finally {
        client.release();
    }
}
export async function getStoredResult(key) {
    const result = await pool.query("SELECT * FROM election_results WHERE key = $1", [key]);
    return result.rows[0] ? mapResult(result.rows[0]) : null;
}
export async function listStoredResults(environment) {
    const result = await pool.query("SELECT * FROM election_results WHERE environment = $1 ORDER BY turn ASC, cargo ASC", [environment]);
    return result.rows.map((row) => mapResult(row));
}
export async function saveResult(normalized, metadata) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const previous = await client.query("SELECT payload_sha256 FROM election_results WHERE key = $1 FOR UPDATE", [normalized.key]);
        const changed = previous.rows[0]?.payload_sha256 !== metadata.payloadSha256;
        await client.query(`INSERT INTO election_results (
        key, environment, cargo, turn, scope, uf, election_id, pleito_id, idg, generated_at, final,
        sections_total, sections_totalized, sections_percentage, electorate_total, attendance, abstentions,
        votes_total, votes_valid, votes_blank, votes_null, target_candidate, candidates, source_url,
        source_etag, source_last_modified, payload_sha256, synced_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,
        $24,$25,$26,$27,now(),now()
      )
      ON CONFLICT (key) DO UPDATE SET
        environment=EXCLUDED.environment, cargo=EXCLUDED.cargo, turn=EXCLUDED.turn, scope=EXCLUDED.scope,
        uf=EXCLUDED.uf, election_id=EXCLUDED.election_id, pleito_id=EXCLUDED.pleito_id, idg=EXCLUDED.idg,
        generated_at=EXCLUDED.generated_at, final=EXCLUDED.final, sections_total=EXCLUDED.sections_total,
        sections_totalized=EXCLUDED.sections_totalized, sections_percentage=EXCLUDED.sections_percentage,
        electorate_total=EXCLUDED.electorate_total, attendance=EXCLUDED.attendance, abstentions=EXCLUDED.abstentions,
        votes_total=EXCLUDED.votes_total, votes_valid=EXCLUDED.votes_valid, votes_blank=EXCLUDED.votes_blank,
        votes_null=EXCLUDED.votes_null, target_candidate=EXCLUDED.target_candidate, candidates=EXCLUDED.candidates,
        source_url=EXCLUDED.source_url, source_etag=EXCLUDED.source_etag,
        source_last_modified=EXCLUDED.source_last_modified, payload_sha256=EXCLUDED.payload_sha256,
        synced_at=now(), updated_at=now()`, [
            normalized.key,
            normalized.environment,
            normalized.cargo,
            normalized.turn,
            normalized.scope,
            normalized.uf,
            normalized.electionId,
            normalized.pleitoId,
            normalized.idg,
            normalized.generatedAt,
            normalized.final,
            normalized.sections.total,
            normalized.sections.totalized,
            normalized.sections.percentage,
            normalized.electorate.total,
            normalized.electorate.attendance,
            normalized.electorate.abstentions,
            normalized.votes.total,
            normalized.votes.valid,
            normalized.votes.blank,
            normalized.votes.null,
            JSON.stringify(normalized.targetCandidate),
            JSON.stringify(normalized.candidates),
            normalized.sourceUrl,
            metadata.etag,
            metadata.lastModified,
            metadata.payloadSha256,
        ]);
        if (changed) {
            await client.query(`INSERT INTO election_result_history
          (id, result_key, environment, payload_sha256, idg, sections_percentage, snapshot, source_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
         ON CONFLICT (result_key, payload_sha256) DO NOTHING`, [
                randomUUID(),
                normalized.key,
                normalized.environment,
                metadata.payloadSha256,
                normalized.idg,
                normalized.sections.percentage,
                JSON.stringify(normalized),
                normalized.sourceUrl,
            ]);
        }
        await client.query("COMMIT");
        return changed;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
export async function touchNotModified(key, etag, lastModified) {
    await pool.query(`UPDATE election_results
     SET synced_at = now(), source_etag = COALESCE($2, source_etag),
         source_last_modified = COALESCE($3, source_last_modified), updated_at = now()
     WHERE key = $1`, [key, etag, lastModified]);
}
export async function getState(key) {
    const result = await pool.query("SELECT value FROM collector_state WHERE key = $1", [key]);
    return result.rows[0]?.value ?? null;
}
export async function setState(key, value) {
    await pool.query(`INSERT INTO collector_state (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
}
export async function clearState(key) {
    await pool.query("DELETE FROM collector_state WHERE key = $1", [key]);
}
export async function startRun(environment, trigger) {
    const id = randomUUID();
    await pool.query("INSERT INTO sync_runs (id, environment, trigger, status) VALUES ($1,$2,$3,'running')", [id, environment, trigger]);
    return id;
}
export async function finishRun(report) {
    await pool.query(`UPDATE sync_runs SET status=$2, fetched=$3, changed=$4, errors=$5::jsonb, finished_at=now() WHERE id=$1`, [report.runId, report.status, report.fetched, report.changed, JSON.stringify(report.errors)]);
}
export async function recentRuns(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = await pool.query(`SELECT id, environment, trigger, status, fetched, changed, errors, started_at AS "startedAt",
            finished_at AS "finishedAt"
     FROM sync_runs ORDER BY started_at DESC LIMIT $1`, [safeLimit]);
    return result.rows;
}
function mapResult(row) {
    return {
        key: String(row.key),
        environment: row.environment,
        cargo: row.cargo,
        turn: Number(row.turn),
        scope: String(row.scope),
        uf: String(row.uf).trim(),
        electionId: String(row.election_id),
        pleitoId: String(row.pleito_id),
        idg: String(row.idg ?? ""),
        generatedAt: iso(row.generated_at),
        final: Boolean(row.final),
        sections: {
            total: number(row.sections_total),
            totalized: number(row.sections_totalized),
            percentage: number(row.sections_percentage),
        },
        electorate: {
            total: number(row.electorate_total),
            attendance: number(row.attendance),
            abstentions: number(row.abstentions),
        },
        votes: {
            total: number(row.votes_total),
            valid: number(row.votes_valid),
            blank: number(row.votes_blank),
            null: number(row.votes_null),
        },
        targetCandidate: row.target_candidate ?? null,
        candidates: row.candidates ?? [],
        sourceUrl: String(row.source_url),
        available: true,
        syncedAt: iso(row.synced_at),
        payloadSha256: String(row.payload_sha256),
        sourceEtag: row.source_etag ? String(row.source_etag) : null,
        sourceLastModified: row.source_last_modified ? String(row.source_last_modified) : null,
    };
}
function number(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}
function iso(value) {
    if (value instanceof Date)
        return value.toISOString();
    const parsed = new Date(String(value ?? ""));
    return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}
export async function transaction(work) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const output = await work(client);
        await client.query("COMMIT");
        return output;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=repository.js.map