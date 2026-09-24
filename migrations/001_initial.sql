CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS election_results (
  key text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('oficial', 'simulado')),
  cargo text NOT NULL CHECK (cargo IN ('presidente', 'deputado_federal')),
  turn smallint NOT NULL CHECK (turn IN (1, 2)),
  scope text NOT NULL,
  uf char(2) NOT NULL,
  election_id text NOT NULL,
  pleito_id text NOT NULL,
  idg text,
  generated_at timestamptz,
  final boolean NOT NULL DEFAULT false,
  sections_total bigint NOT NULL DEFAULT 0,
  sections_totalized bigint NOT NULL DEFAULT 0,
  sections_percentage double precision NOT NULL DEFAULT 0,
  electorate_total bigint NOT NULL DEFAULT 0,
  attendance bigint NOT NULL DEFAULT 0,
  abstentions bigint NOT NULL DEFAULT 0,
  votes_total bigint NOT NULL DEFAULT 0,
  votes_valid bigint NOT NULL DEFAULT 0,
  votes_blank bigint NOT NULL DEFAULT 0,
  votes_null bigint NOT NULL DEFAULT 0,
  target_candidate jsonb,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_url text NOT NULL,
  source_etag text,
  source_last_modified text,
  payload_sha256 char(64) NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS election_results_environment_cargo_idx
  ON election_results (environment, cargo, turn);

CREATE TABLE IF NOT EXISTS election_result_history (
  id uuid PRIMARY KEY,
  result_key text NOT NULL REFERENCES election_results(key) ON DELETE CASCADE,
  environment text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  idg text,
  sections_percentage double precision NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL,
  source_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (result_key, payload_sha256)
);

CREATE INDEX IF NOT EXISTS election_result_history_key_date_idx
  ON election_result_history (result_key, created_at DESC);

CREATE TABLE IF NOT EXISTS collector_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY,
  environment text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped')),
  fetched integer NOT NULL DEFAULT 0,
  changed integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS sync_runs_started_at_idx ON sync_runs (started_at DESC);
