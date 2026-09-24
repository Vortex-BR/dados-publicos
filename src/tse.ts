import { createHash } from "node:crypto";
import { config } from "./config.js";
import type { Candidate, Environment, NormalizedResult, Target } from "./types.js";

export const TECHNICAL_URL =
  "https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados";
export const FIRST_ROUND_START = new Date("2026-10-04T17:00:00-03:00");
export const SECOND_ROUND_START = new Date("2026-10-25T17:00:00-03:00");

export type TseSettings = {
  environment: Environment;
  official: boolean;
  root: string;
  configUrl: string;
  pleitoId: string;
  presidentElectionId: string;
  deputyElectionId: string;
};

export function tseSettings(environment: Environment = config.TSE_ENVIRONMENT): TseSettings {
  if (environment === "simulado") {
    return {
      environment,
      official: false,
      root: "https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026",
      configUrl: "https://resultados-sim.tse.jus.br/simulado/simulado2026/comum/config/ele-c.json",
      pleitoId: "17801",
      presidentElectionId: "21270",
      deputyElectionId: "21272",
    };
  }
  return {
    environment,
    official: true,
    root: "https://resultados.tse.jus.br/oficial/ele2026",
    configUrl: "https://resultados.tse.jus.br/oficial/ele2026/comum/config/ele-c.json",
    pleitoId: "3220",
    presidentElectionId: "6257",
    deputyElectionId: "6259",
  };
}

export function resultWindowIsOpen(settings = tseSettings(), now = new Date()) {
  return !settings.official || now.getTime() >= FIRST_ROUND_START.getTime();
}

function target(
  key: string,
  cargo: Target["cargo"],
  cargoCode: Target["cargoCode"],
  scope: Target["scope"],
  uf: Target["uf"],
  turn: Target["turn"],
  electionId: string,
  settings: TseSettings,
): Target {
  const paddedElection = electionId.padStart(6, "0");
  return {
    key: `${settings.environment}-${key}`,
    cargo,
    cargoCode,
    scope,
    uf,
    turn,
    electionId,
    pleitoId: settings.pleitoId,
    url: `${settings.root}/${encodeURIComponent(electionId)}/dados/${scope}/${scope}-c${cargoCode}-e${paddedElection}-u.json`,
  };
}

export function firstRoundTargets(settings = tseSettings()): Target[] {
  return [
    target(
      "presidente-br-t1",
      "presidente",
      "0001",
      "br",
      "BR",
      1,
      settings.presidentElectionId,
      settings,
    ),
    target(
      "deputado-federal-pr-t1",
      "deputado_federal",
      "0006",
      "pr",
      "PR",
      1,
      settings.deputyElectionId,
      settings,
    ),
  ];
}

export function secondRoundPresidentTarget(electionId: string, settings = tseSettings()): Target {
  return target("presidente-br-t2", "presidente", "0001", "br", "BR", 2, electionId, settings);
}

type FetchOptions = { etag?: string | null; lastModified?: string | null };
export type FetchResult =
  | { status: "not-modified"; etag: string | null; lastModified: string | null }
  | {
      status: "ok";
      payload: Record<string, unknown>;
      raw: string;
      etag: string | null;
      lastModified: string | null;
    };

export class TseHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "TseHttpError";
  }
}

export async function fetchTseJson(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const parsed = new URL(url);
  if (
    !new Set(["resultados.tse.jus.br", "resultados-sim.tse.jus.br"]).has(parsed.hostname) ||
    parsed.protocol !== "https:"
  ) {
    throw new Error("A origem solicitada não pertence aos domínios oficiais de resultados do TSE.");
  }
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": "Campania-Ninja-TSE-Collector/1.0",
  });
  if (options.etag) headers.set("If-None-Match", options.etag);
  if (options.lastModified) headers.set("If-Modified-Since", options.lastModified);

  let response: Response;
  try {
    response = await fetch(parsed, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(config.TSE_REQUEST_TIMEOUT_SECONDS * 1_000),
    });
  } catch (error) {
    throw new TseHttpError(
      `Não foi possível alcançar o TSE: ${error instanceof Error ? error.message : "falha de rede"}`,
      503,
      url,
    );
  }
  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  if (response.status === 304) return { status: "not-modified", etag, lastModified };
  if (!response.ok)
    throw new TseHttpError(`O TSE respondeu com HTTP ${response.status}.`, response.status, url);

  const raw = await response.text();
  if (!raw || Buffer.byteLength(raw) > 15 * 1024 * 1024) {
    throw new TseHttpError(
      "O arquivo do TSE está vazio ou excede o limite de segurança.",
      502,
      url,
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new TseHttpError("O TSE respondeu com JSON inválido.", 502, url);
  }
  if (!isRecord(payload))
    throw new TseHttpError("A raiz do arquivo do TSE não é um objeto JSON.", 502, url);
  return { status: "ok", payload, raw, etag, lastModified };
}

export function payloadHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function discoverSecondRoundElection(
  payload: Record<string, unknown>,
  firstRoundElectionId: string,
) {
  for (const pleito of array(payload.pl)) {
    for (const election of array(record(pleito).e)) {
      const item = record(election);
      if (text(item.cd) === firstRoundElectionId && text(item.cdt2)) return text(item.cdt2);
    }
  }
  return "";
}

export function normalizePayload(
  payload: Record<string, unknown>,
  targetDefinition: Target,
  settings = tseSettings(),
): NormalizedResult {
  validatePayload(payload, targetDefinition);
  const cargo = record(array(payload.carg)[0]);
  let candidates = flattenCandidates(cargo).sort((left, right) => {
    if (left.votes === right.votes) return left.ballotName.localeCompare(right.ballotName, "pt-BR");
    return right.votes - left.votes;
  });
  candidates = candidates.map((candidate, index) => ({ ...candidate, position: index + 1 }));

  let targetCandidate: Candidate | null = null;
  if (targetDefinition.cargo === "deputado_federal") {
    targetCandidate = findNewtonBonin(candidates);
    candidates = targetCandidate ? [targetCandidate] : [];
  }

  const sections = record(payload.s);
  const electorate = record(payload.e);
  const votes = record(payload.v);
  return {
    key: targetDefinition.key,
    environment: settings.environment,
    cargo: targetDefinition.cargo,
    turn: targetDefinition.turn,
    scope: targetDefinition.scope.toUpperCase(),
    uf: targetDefinition.uf,
    electionId: targetDefinition.electionId,
    pleitoId: targetDefinition.pleitoId,
    idg: text(payload.idg),
    generatedAt: generatedAt(payload),
    final: text(payload.and).toLowerCase() === "f",
    sections: {
      total: integer(sections.ts),
      totalized: integer(sections.st),
      percentage: decimal(sections.pstn ?? sections.pst),
    },
    electorate: {
      total: integer(electorate.te),
      attendance: integer(electorate.c),
      abstentions: integer(electorate.a),
    },
    votes: {
      total: integer(votes.tv),
      valid: integer(votes.vv ?? votes.vvc),
      blank: integer(votes.vb),
      null: integer(votes.tvn ?? votes.vn),
    },
    targetCandidate,
    candidates,
    sourceUrl: targetDefinition.url,
  };
}

function validatePayload(payload: Record<string, unknown>, definition: Target) {
  if (text(payload.ele) !== definition.electionId)
    throw new Error("O arquivo do TSE pertence a outra eleição.");
  if (text(payload.cdabr).toLowerCase() !== definition.scope)
    throw new Error("O arquivo do TSE possui outra abrangência.");
  const cargo = record(array(payload.carg)[0]);
  if (text(cargo.cd).padStart(4, "0") !== definition.cargoCode)
    throw new Error("O arquivo do TSE pertence a outro cargo.");
}

function flattenCandidates(cargo: Record<string, unknown>): Candidate[] {
  const candidates: Candidate[] = [];
  for (const groupValue of array(cargo.agr)) {
    const group = record(groupValue);
    for (const partyValue of array(group.par)) {
      const party = record(partyValue);
      for (const candidateValue of array(party.cand)) {
        const candidate = record(candidateValue);
        const viceData = record(array(candidate.vs)[0]);
        candidates.push({
          number: text(candidate.n),
          sqCand: text(candidate.sqcand),
          name: text(candidate.nm),
          ballotName: text(candidate.nmu || candidate.nm),
          party: text(party.sg),
          partyName: text(party.nm),
          partyNumber: text(party.n),
          federation: text(party.nfed),
          votes: integer(candidate.vap),
          percentage: decimal(candidate.pvapn ?? candidate.pvap),
          position: 0,
          elected: text(candidate.e).toLowerCase() === "s",
          status: text(candidate.st),
          destination: text(candidate.dvt),
          vice: Object.keys(viceData).length
            ? { name: text(viceData.nm), ballotName: text(viceData.nmu || viceData.nm) }
            : null,
        });
      }
    }
  }
  return candidates;
}

function findNewtonBonin(candidates: Candidate[]): Candidate | null {
  if (config.TSE_NEWTON_BONIN_SQ_CANDIDATO) {
    const candidate = candidates.find(
      (item) => item.sqCand === config.TSE_NEWTON_BONIN_SQ_CANDIDATO,
    );
    if (candidate) return { ...candidate, identifiedBy: "sq_candidato" };
  }
  if (config.TSE_NEWTON_BONIN_NUMERO) {
    const candidate = candidates.find((item) => item.number === config.TSE_NEWTON_BONIN_NUMERO);
    if (candidate) return { ...candidate, identifiedBy: "numero" };
  }
  const candidate = candidates.find((item) => {
    const name = normalizeName(`${item.name} ${item.ballotName}`);
    return name.includes("NEWTON") && name.includes("BONIN");
  });
  return candidate ? { ...candidate, identifiedBy: "nome" } : null;
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function generatedAt(payload: Record<string, unknown>) {
  const date = text(payload.dg || payload.dt);
  const time = text(payload.hg || payload.ht) || "00:00:00";
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (!match) return new Date().toISOString();
  const [, day, month, year] = match;
  const parsed = new Date(
    `${year}-${month}-${day}T${time.length === 5 ? `${time}:00` : time}-03:00`,
  );
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function integer(value: unknown) {
  const cleaned = String(value ?? "").replace(/[^0-9-]/g, "");
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decimal(value: unknown) {
  let cleaned = String(value ?? "").trim();
  if (cleaned.includes(",")) cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 500);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
