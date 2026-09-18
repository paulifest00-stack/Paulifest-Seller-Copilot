// Contratos e Tipos da Fundação de Segurança do Integration Gateway (Fase 4C.1)

export type ConnectionStatus = 'connected' | 'disconnected' | 'requires_reauth' | 'rate_limited';

export interface EncryptedPayload {
  ciphertext: string;       // Base64
  iv: string;               // Base64 (12 bytes)
  authTag: string;          // Base64 (16 bytes)
  keyVersion: number;       // Versão da chave mestra (suporte a rotação)
}

export interface BlingConnectionRecord {
  id: string;                      // UUID da conexão
  clientSessionId: string;         // ID da instalação da extensão
  accountId?: string;              // ID da conta no Bling
  accountName?: string;            // Nome fantasia da conta
  encryptionKeyVersion: number;
  encryptedAccessToken: string;    // Base64
  accessTokenIv: string;           // Base64 (12 bytes)
  accessTokenTag: string;          // Base64 (16 bytes)
  encryptedRefreshToken: string;   // Base64
  refreshTokenIv: string;          // Base64 (12 bytes)
  refreshTokenTag: string;         // Base64 (16 bytes)
  tokenExpiresAt: string;          // ISO 8601
  scope?: string;
  status: ConnectionStatus;
  createdAt: string;               // ISO 8601
  updatedAt: string;               // ISO 8601
}

export interface OAuthPairingRequestRecord {
  pairingId: string;               // UUID gerado no start
  clientSessionId: string;
  pairingSecretHash: string;       // SHA-256 do segredo
  stateHash: string;               // SHA-256 do state OAuth gerado
  connectionId?: string;           // Vinculado no callback
  failedAttempts: number;          // Contador para proteção contra DoS / Brute Force
  maxAttempts: number;             // Limite máximo de tentativas (default: 5)
  consumed: boolean;               // Single-use
  expiresAt: string;               // ISO 8601 (TTL 5 min)
  createdAt: string;               // ISO 8601
}

export interface GatewaySessionRecord {
  id: string;                      // UUID da sessão
  connectionId: string;
  tokenFamilyId: string;           // Identificador da família para detecção de reuse
  refreshTokenHash: string;        // SHA-256 do refresh token da sessão
  replacedByHash?: string;         // SHA-256 do token que substituiu este
  expiresAt: string;               // ISO 8601
  revokedAt?: string;              // ISO 8601 se revogada
  usedAt?: string;                 // ISO 8601 se consumida para rotação
  createdAt: string;               // ISO 8601
}

export interface StartAuthRequest {
  clientSessionId: string;
}

export interface StartAuthResponse {
  ok: boolean;
  authorizationUrl: string;
  pairingId: string;
  pairingSecret: string;
  expiresInSeconds: number;
}

export interface SessionHandshakeRequest {
  pairingId: string;
  pairingSecret: string;
}

export interface SessionHandshakeResponse {
  ok: boolean;
  status: ConnectionStatus;
  gatewaySessionToken?: string;
  gatewayRefreshToken?: string;
  expiresInSeconds?: number;
  error?: string;
  remainingAttempts?: number;
}
