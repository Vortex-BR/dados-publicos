export type Environment = "oficial" | "simulado";
export type Cargo = "presidente" | "deputado_federal";

export type Candidate = {
  number: string;
  sqCand: string;
  name: string;
  ballotName: string;
  party: string;
  partyName: string;
  partyNumber: string;
  federation: string;
  votes: number;
  percentage: number;
  position: number;
  elected: boolean;
  status: string;
  destination: string;
  identifiedBy?: "sq_candidato" | "numero" | "nome";
  vice: { name: string; ballotName: string } | null;
};

export type Sections = { total: number; totalized: number; percentage: number };
export type Electorate = { total: number; attendance: number; abstentions: number };
export type Votes = { total: number; valid: number; blank: number; null: number };

export type Target = {
  key: string;
  cargo: Cargo;
  cargoCode: "0001" | "0006";
  scope: "br" | "pr";
  uf: "BR" | "PR";
  turn: 1 | 2;
  electionId: string;
  pleitoId: string;
  url: string;
};

export type NormalizedResult = {
  key: string;
  environment: Environment;
  cargo: Cargo;
  turn: 1 | 2;
  scope: string;
  uf: string;
  electionId: string;
  pleitoId: string;
  idg: string;
  generatedAt: string;
  final: boolean;
  sections: Sections;
  electorate: Electorate;
  votes: Votes;
  targetCandidate: Candidate | null;
  candidates: Candidate[];
  sourceUrl: string;
};

export type StoredResult = NormalizedResult & {
  available: true;
  syncedAt: string;
  payloadSha256: string;
  sourceEtag: string | null;
  sourceLastModified: string | null;
};

export type SyncReport = {
  runId: string;
  trigger: "scheduler" | "manual" | "startup";
  status: "success" | "partial" | "failed" | "skipped";
  fetched: number;
  changed: number;
  errors: Array<{ target: string; status?: number; message: string }>;
  reason?: string;
};
