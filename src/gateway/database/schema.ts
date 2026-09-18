// DDL e Schema SQL Formal do Banco de Dados do Gateway (Fase 4C.1)

export const GATEWAY_SCHEMA_SQL = `
-- 1. Conexões autenticadas com o Bling ERP
CREATE TABLE IF NOT EXISTS bling_connections (
  id VARCHAR(64) PRIMARY KEY,                  -- UUID da conexão
  client_session_id VARCHAR(64) NOT NULL,      -- ID da instalação da extensão (Indexado)
  account_id VARCHAR(64),                      -- ID da conta Bling (se disponível)
  account_name VARCHAR(128),                    -- Nome da conta Bling
  encryption_key_version INT NOT NULL DEFAULT 1, -- Versão da chave mestra de criptografia
  
  -- Tokens Criptografados com AES-256-GCM Completo
  encrypted_access_token TEXT NOT NULL,        -- Base64 do Ciphertext
  access_token_iv VARCHAR(32) NOT NULL,        -- Base64 (12 bytes)
  access_token_tag VARCHAR(32) NOT NULL,       -- Base64 (16 bytes Auth Tag)
  
  encrypted_refresh_token TEXT NOT NULL,       -- Base64 do Ciphertext
  refresh_token_iv VARCHAR(32) NOT NULL,       -- Base64 (12 bytes)
  refresh_token_tag VARCHAR(32) NOT NULL,      -- Base64 (16 bytes Auth Tag)
  
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  scope VARCHAR(255),
  status VARCHAR(32) NOT NULL,                 -- 'connected' | 'disconnected' | 'requires_reauth' | 'rate_limited'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_connections_client_session ON bling_connections(client_session_id);

-- 2. Pareamentos Efêmeros One-Time (Handshake de Autorização)
CREATE TABLE IF NOT EXISTS oauth_pairing_requests (
  pairing_id VARCHAR(64) PRIMARY KEY,          -- UUID gerado no /auth/bling/start
  client_session_id VARCHAR(64) NOT NULL,
  pairing_secret_hash VARCHAR(64) NOT NULL,    -- SHA-256 do pairingSecret
  state_hash VARCHAR(64) NOT NULL UNIQUE,      -- SHA-256 do state OAuth
  connection_id VARCHAR(64),                   -- Vinculado após sucesso no callback
  failed_attempts INT NOT NULL DEFAULT 0,      -- Proteção contra DoS / Brute Force
  max_attempts INT NOT NULL DEFAULT 5,         -- Limite máximo antes de invalidação
  consumed BOOLEAN NOT NULL DEFAULT FALSE,     -- Single-use
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,-- TTL 5 minutos
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pairing_state_hash ON oauth_pairing_requests(state_hash);
CREATE INDEX IF NOT EXISTS idx_pairing_expires ON oauth_pairing_requests(expires_at);

-- 3. Sessões do Gateway para a Extensão (com Rotação e Detecção de Reuse)
CREATE TABLE IF NOT EXISTS gateway_sessions (
  id VARCHAR(64) PRIMARY KEY,                  -- UUID da sessão
  connection_id VARCHAR(64) NOT NULL,
  token_family_id VARCHAR(64) NOT NULL,        -- Identificador da família de tokens (Reuse Detection)
  refresh_token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 do refresh token da sessão
  replaced_by_hash VARCHAR(64),                -- SHA-256 do novo token emitido na rotação
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,         -- Data de revogação se violado ou logout
  used_at TIMESTAMP WITH TIME ZONE,            -- Data em que foi consumido na rotação
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_connection ON gateway_sessions(connection_id);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON gateway_sessions(token_family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_hash ON gateway_sessions(refresh_token_hash);
`;
