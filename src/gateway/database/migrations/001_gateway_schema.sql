-- Migration 001: Schema Durável do Gateway (Fase 4C.2)

-- 1. Conexões autenticadas com o Bling ERP
CREATE TABLE IF NOT EXISTS bling_connections (
    id VARCHAR(128) PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'connected', -- 'connected' | 'requires_reauth' | 'disconnected'
    
    -- Colunas de tokens cifrados (NULLABLE para permitir purga no disconnect)
    access_token_cipher TEXT NULL,
    access_token_iv VARCHAR(64) NULL,
    access_token_tag VARCHAR(64) NULL,
    
    refresh_token_cipher TEXT NULL,
    refresh_token_iv VARCHAR(64) NULL,
    refresh_token_tag VARCHAR(64) NULL,
    
    key_version VARCHAR(32) NOT NULL DEFAULT 'v1',
    expires_at TIMESTAMPTZ NULL,
    scope VARCHAR(255) NULL,
    account_identifier VARCHAR(255) NULL,
    last_refresh_at TIMESTAMPTZ NULL,
    
    -- Coordenação de Refresh Distribuído (Lease/Claim)
    refresh_lease_owner VARCHAR(64) NULL,
    refresh_lease_expires_at TIMESTAMPTZ NULL,
    token_version INT NOT NULL DEFAULT 1,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint de status permitido
    CONSTRAINT chk_bling_connection_status 
        CHECK (status IN ('connected', 'requires_reauth', 'disconnected')),

    -- Constraint condicional de segurança
    CONSTRAINT chk_bling_connected_tokens 
        CHECK (status != 'connected' OR (access_token_cipher IS NOT NULL AND refresh_token_cipher IS NOT NULL AND expires_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_connections_status ON bling_connections (status);

-- 2. Tabela Unificada de Pareamentos Efêmeros OAuth
CREATE TABLE IF NOT EXISTS gateway_pairings (
    pairing_id VARCHAR(64) PRIMARY KEY,
    client_session_id VARCHAR(128) NOT NULL,
    state_hash VARCHAR(64) NOT NULL UNIQUE,
    pairing_secret_hash VARCHAR(64) NOT NULL,
    connection_id VARCHAR(128) NULL REFERENCES bling_connections(id) ON DELETE SET NULL,
    state_consumed_at TIMESTAMPTZ NULL,
    pairing_consumed_at TIMESTAMPTZ NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pairings_state_hash 
    ON gateway_pairings (state_hash) 
    WHERE state_consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pairings_client_session 
    ON gateway_pairings (client_session_id);

CREATE INDEX IF NOT EXISTS idx_pairings_expires_at 
    ON gateway_pairings (expires_at);

-- 3. Sessões do Gateway
CREATE TABLE IF NOT EXISTS gateway_sessions (
    id VARCHAR(64) PRIMARY KEY,
    connection_id VARCHAR(128) NOT NULL REFERENCES bling_connections(id) ON DELETE CASCADE,
    client_session_id VARCHAR(128) NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_conn ON gateway_sessions (connection_id);
CREATE INDEX IF NOT EXISTS idx_sessions_client ON gateway_sessions (client_session_id);

-- 4. Tokens de Refresh do Gateway (Rotação com Token Family & Detecção de Reuso)
CREATE TABLE IF NOT EXISTS gateway_refresh_tokens (
    id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES gateway_sessions(id) ON DELETE CASCADE,
    family_id VARCHAR(64) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    used_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grt_hash ON gateway_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_grt_family ON gateway_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_grt_session ON gateway_refresh_tokens (session_id);
