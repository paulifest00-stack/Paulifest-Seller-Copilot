CREATE TABLE IF NOT EXISTS ml_connections (
  connection_id VARCHAR(128) PRIMARY KEY REFERENCES bling_connections(id) ON DELETE CASCADE,
  seller_id VARCHAR(32) NOT NULL,
  tokens JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ml_oauth_states (
  state_hash VARCHAR(64) PRIMARY KEY,
  connection_id VARCHAR(128) NOT NULL REFERENCES bling_connections(id) ON DELETE CASCADE,
  session_id VARCHAR(64) NOT NULL REFERENCES gateway_sessions(id) ON DELETE CASCADE,
  verifier JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ml_oauth_expiry ON ml_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS ml_pictures (
  connection_id VARCHAR(128) NOT NULL REFERENCES bling_connections(id) ON DELETE CASCADE,
  picture_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(connection_id, picture_id)
);
CREATE TABLE IF NOT EXISTS ml_operations (
  id UUID PRIMARY KEY,
  connection_id VARCHAR(128) NOT NULL REFERENCES bling_connections(id) ON DELETE CASCADE,
  seller_id VARCHAR(32) NOT NULL,
  sheet_id VARCHAR(128) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  endpoint VARCHAR(128) NOT NULL,
  state VARCHAR(32) NOT NULL CHECK(state IN ('prepared','publishing','published','failed','uncertain')),
  item_id VARCHAR(32),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, sheet_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS ml_operation_sheet ON ml_operations(connection_id, sheet_id);
