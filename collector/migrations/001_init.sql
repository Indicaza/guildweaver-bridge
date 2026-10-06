CREATE TABLE IF NOT EXISTS collector_enrollment_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS collector_installations (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS collector_events (
  id BIGSERIAL PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES collector_installations(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision > 0),
  envelope_schema_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  realm TEXT,
  region TEXT,
  character_id TEXT,
  guild_id TEXT,
  envelope JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installation_id, idempotency_key),
  UNIQUE (installation_id, stream_key, revision)
);

CREATE INDEX IF NOT EXISTS collector_events_cursor_idx
  ON collector_events(id);
CREATE INDEX IF NOT EXISTS collector_events_type_cursor_idx
  ON collector_events(event_type, id);
CREATE INDEX IF NOT EXISTS collector_events_character_cursor_idx
  ON collector_events(character_id, id) WHERE character_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS collector_events_realm_cursor_idx
  ON collector_events(realm, id) WHERE realm IS NOT NULL;

CREATE TABLE IF NOT EXISTS collector_consumers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS collector_consumer_checkpoints (
  consumer_id TEXT PRIMARY KEY REFERENCES collector_consumers(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL DEFAULT 0 CHECK (event_id >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
