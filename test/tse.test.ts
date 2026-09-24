import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.API_KEYS = "test-public-key-123456789012345678901234";
process.env.ADMIN_API_KEY = "test-admin-key-1234567890123456789012345";
process.env.TSE_ENVIRONMENT = "simulado";

const tse = await import("../src/tse.js");

function payload(options: { president: boolean; newton?: boolean }) {
  const candidate = options.president
    ? {
        n: "99",
        sqcand: "202600000001",
        nm: "CANDIDATO PRESIDENTE QA",
        nmu: "PRESIDENTE QA",
        e: "n",
        st: "2º turno",
        dvt: "Válido",
        vap: "600",
        pvapn: "60.0",
        vs: [{ nm: "VICE QA", nmu: "VICE QA" }],
      }
    : {
        n: "1234",
        sqcand: "202600000002",
        nm: options.newton ? "NEWTON BONIN" : "OUTRO CANDIDATO",
        nmu: options.newton ? "NEWTON BONIN" : "OUTRO",
        e: "s",
        st: "Eleito",
        dvt: "Válido",
        vap: "45678",
        pvapn: "1.25",
      };
  return {
    ele: options.president ? "21270" : "21272",
    cdabr: options.president ? "br" : "pr",
    and: "n",
    dg: "04/10/2026",
    hg: "18:00:00",
    idg: options.president ? "qa-presidente-1" : "qa-deputado-1",
    s: { ts: "1000", st: "750", pstn: "75.0" },
    e: { te: "100000", c: "80000", a: "20000" },
    v: { tv: "80000", vv: "76000", vb: "1500", tvn: "2500" },
    carg: [
      {
        cd: options.president ? "1" : "6",
        agr: [{ par: [{ n: "99", sg: "PQA", nm: "Partido QA", cand: [candidate] }] }],
      },
    ],
  };
}

test("constrói somente os dois alvos permitidos no primeiro turno", () => {
  const settings = tse.tseSettings("simulado");
  const targets = tse.firstRoundTargets(settings);
  assert.equal(targets.length, 2);
  assert.match(targets[0]?.url ?? "", /br-c0001-e021270-u\.json$/);
  assert.match(targets[1]?.url ?? "", /pr-c0006-e021272-u\.json$/);
});

test("normaliza o resultado presidencial EA20", () => {
  const settings = tse.tseSettings("simulado");
  const target = tse.firstRoundTargets(settings)[0];
  assert.ok(target);
  const result = tse.normalizePayload(payload({ president: true }), target, settings);
  assert.equal(result.cargo, "presidente");
  assert.equal(result.sections.percentage, 75);
  assert.equal(result.candidates[0]?.votes, 600);
  assert.equal(result.candidates[0]?.vice?.ballotName, "VICE QA");
});

test("identifica Newton Bonin e mantém somente o candidato-alvo para deputado federal", () => {
  const settings = tse.tseSettings("simulado");
  const target = tse.firstRoundTargets(settings)[1];
  assert.ok(target);
  const result = tse.normalizePayload(
    payload({ president: false, newton: true }),
    target,
    settings,
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.targetCandidate?.ballotName, "NEWTON BONIN");
  assert.equal(result.targetCandidate?.identifiedBy, "nome");
  assert.equal(result.targetCandidate?.votes, 45_678);
  assert.equal(result.targetCandidate?.percentage, 1.25);
});

test("descobre dinamicamente a eleição presidencial de segundo turno", () => {
  const election = tse.discoverSecondRoundElection(
    {
      pl: [
        {
          e: [
            { cd: "21270", cdt2: "21271" },
            { cd: "21272", cdt2: "21273" },
          ],
        },
      ],
    },
    "21270",
  );
  assert.equal(election, "21271");
});

test("bloqueia qualquer fonte que não pertença ao TSE", async () => {
  await assert.rejects(
    () => tse.fetchTseJson("https://example.com/resultado.json"),
    /domínios oficiais/,
  );
});

test("ambiente oficial não consulta antes da abertura e simulado permanece disponível", () => {
  assert.equal(
    tse.resultWindowIsOpen(tse.tseSettings("oficial"), new Date("2026-10-04T16:59:59-03:00")),
    false,
  );
  assert.equal(
    tse.resultWindowIsOpen(tse.tseSettings("oficial"), new Date("2026-10-04T17:00:00-03:00")),
    true,
  );
  assert.equal(
    tse.resultWindowIsOpen(tse.tseSettings("simulado"), new Date("2020-01-01T00:00:00Z")),
    true,
  );
});
