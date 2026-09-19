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
  clientSessionId?: string;        // ID da instalação da extensão
  accountId?: string;              // ID da conta no Bling
  accountName?: string;            // Nome fantasia da conta
  accountIdentifier?: string;      // Identificador de conta unificado (Fase 4C.2)
  encryptionKeyVersion?: number;
  keyVersion?: string;             // Versão da chave (ex: 'v1')
  encryptedAccessToken?: string | null;    // Base64 (NULL no disconnect)
  accessTokenIv?: string | null;           // Base64 (12 bytes) (NULL no disconnect)
  accessTokenTag?: string | null;          // Base64 (16 bytes Auth Tag) (NULL no disconnect)
  encryptedRefreshToken?: string | null;   // Base64 (NULL no disconnect)
  refreshTokenIv?: string | null;          // Base64 (12 bytes) (NULL no disconnect)
  refreshTokenTag?: string | null;         // Base64 (16 bytes Auth Tag) (NULL no disconnect)
  tokenExpiresAt?: string | null;          // ISO 8601 (NULL no disconnect)
  scope?: string | null;
  status: ConnectionStatus;
  lastRefreshAt?: string | null;
  
  // Coordenação de Refresh Distribuído (Fase 4C.2)
  refreshLeaseOwner?: string | null;
  refreshLeaseExpiresAt?: string | null;
  tokenVersion?: number;

  createdAt: string;               // ISO 8601
  updatedAt: string;               // ISO 8601
}

export interface OAuthPairingRequestRecord {
  pairingId: string;               // UUID gerado no start
  clientSessionId: string;
  pairingSecretHash: string;       // SHA-256 do segredo
  stateHash: string;               // SHA-256 do state OAuth gerado
  connectionId?: string | null;    // Vinculado no callback
  failedAttempts?: number;         // Alias compatível 4C.1
  attemptCount?: number;           // Contador de tentativas (Fase 4C.2)
  maxAttempts?: number;            // Limite máximo de tentativas (default: 5)
  consumed?: boolean;              // Compatibilidade 4C.1
  stateConsumedAt?: string | null; // Data de consumo do state (Fase 4C.2)
  pairingConsumedAt?: string | null; // Data de consumo do pairing (Fase 4C.2)
  expiresAt: string;               // ISO 8601 (TTL 5 min)
  createdAt: string;               // ISO 8601
}

export interface ConsumeOAuthStateResult {
  ok: boolean;
  pairingId?: string;
  clientSessionId?: string;
  pairing?: OAuthPairingRequestRecord;
  error?: string;
}

export interface GatewaySessionRecord {
  id: string;                      // UUID da sessão
  connectionId: string;
  clientSessionId?: string;        // ID da instalação da extensão (Fase 4C.2)
  tokenFamilyId: string;           // Identificador da família para detecção de reuse
  refreshTokenHash: string;        // SHA-256 do refresh token da sessão
  replacedByHash?: string;         // SHA-256 do token que substituiu este
  expiresAt: string;               // ISO 8601
  revokedAt?: string;              // ISO 8601 se revogada
  usedAt?: string;                 // ISO 8601 se consumida para rotação
  createdAt: string;               // ISO 8601
}

export interface GatewayRefreshTokenRecord {
  id: string;
  sessionId: string;
  familyId: string;
  tokenHash: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface RefreshLeaseAcquireResult {
  acquired: boolean;
  tokenVersion: number;
  currentOwner?: string;
}

export interface RefreshLeaseState {
  isLeased: boolean;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  tokenVersion: number;
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

export interface RefreshSessionRequest {
  gatewayRefreshToken: string;
}

export interface RefreshSessionResponse {
  ok: boolean;
  gatewaySessionToken?: string;
  gatewayRefreshToken?: string;
  expiresInSeconds?: number;
  error?: string;
}

export interface BlingStatusResponse {
  ok: boolean;
  connected: boolean;
  status: ConnectionStatus;
  requiresReauth: boolean;
  lastRefreshAt?: string | null;
}

export interface RemoteRevocationStatus {
  accessToken: 'success' | 'failed' | 'not_available';
  refreshToken: 'success' | 'failed' | 'not_available';
  complete: boolean;
}

export interface DisconnectResponse {
  ok: boolean;
  status: 'disconnected';
  localDisconnected: boolean;
  remoteRevocation: RemoteRevocationStatus;
  message: string;
}

export interface ConsumePairingAndCreateSessionParams {
  pairingId: string;
  pairingSecret: string;
  sessionId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  sessionExpiresAt: string;
}

export interface ConsumePairingAndCreateSessionResult {
  ok: boolean;
  connectionId?: string;
  clientSessionId?: string;
  pairing?: OAuthPairingRequestRecord;
  error?: 'PAIRING_NOT_FOUND' | 'PAIRING_EXPIRED' | 'PAIRING_ALREADY_CONSUMED' | 'PAIRING_MAX_ATTEMPTS_EXCEEDED' | 'INVALID_PAIRING_SECRET' | 'OAUTH_FLOW_NOT_COMPLETED' | 'DATABASE_ERROR';
  remainingAttempts?: number;
}

export interface BlingTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token: string;
}

export interface BlingOAuthErrorData {
  status?: number;
  category: 'auth' | 'rate_limit' | 'server_error' | 'network' | 'invalid_payload';
  code?: string;
  message: string;
  retryable: boolean;
  requiresReauth: boolean;
}

export interface BlingRevokeResult {
  success: boolean;
  error?: string;
}

export interface RefreshTokensUpdateData {
  encryptedAccessToken: string;
  accessTokenIv: string;
  accessTokenTag: string;
  encryptedRefreshToken: string;
  refreshTokenIv: string;
  refreshTokenTag: string;
  tokenExpiresAt: string;
  scope?: string | null;
  keyVersion?: string;
}
