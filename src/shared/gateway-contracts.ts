// Contratos de Transporte Compartilhados Gateway ↔ Extensão (Fase 4C.3)
// FONTE ÚNICA DE VERDADE para payloads de transporte entre Extensão e Gateway
// Este arquivo reside em src/shared/ e é seguro para importação pela extensão (zero secrets)

export interface BlingProductDto {
  id?: string | number;
  nome?: string;
  codigo?: string;
  preco?: number | string;
  precoCusto?: number | string;
  tipo?: string;
  situacao?: string;
  formato?: string;
  descricaoCurta?: string;
  descricaoComplementar?: string;
  unidade?: string;
  pesoLiquido?: number | string;
  pesoBruto?: number | string;
  gtin?: string | number;
  gtinEmbalagem?: string | number;
  marca?: string;
  dimensoes?: {
    largura?: number | string;
    altura?: number | string;
    profundidade?: number | string;
    unidadeMedida?: number;
  };
  tributacao?: {
    ncm?: string;
    origem?: number;
    cest?: string;
    [key: string]: unknown;
  };
  midia?: {
    imagens?: {
      externas?: Array<{ link?: string; url?: string }>;
      internas?: Array<{ link?: string; url?: string }>;
    };
    [key: string]: unknown;
  };
  imagensUrl?: string[];
  categoria?: {
    id?: number | string;
    nome?: string;
  };
  imagens?: Array<{
    url: string;
    ordem?: number;
  }>;
  camposCustomizados?: Record<string, unknown>;
  estoque?: Record<string, unknown>;
}

export type GatewayBlingProductDTO = BlingProductDto;

export interface GetBlingProductResponse {
  ok: true;
  product: BlingProductDto;
  warnings: string[];
  unknownFields: string[];
  retrievedAt: string;
}

export type GatewayProductErrorCode =
  | 'UNAUTHORIZED'
  | 'SESSION_REVOKED'
  | 'REQUIRES_REAUTH'
  | 'CONNECTION_DISCONNECTED'
  | 'BLING_PRODUCT_NOT_FOUND'
  | 'BLING_RATE_LIMITED'
  | 'BLING_FORBIDDEN'
  | 'BLING_SERVER_ERROR'
  | 'BLING_TIMEOUT'
  | 'INVALID_BLING_PAYLOAD'
  | 'INTERNAL_ERROR';

export interface GatewayProductErrorResponse {
  ok: false;
  error: GatewayProductErrorCode;
  message: string;
  statusCode?: number;
  retryAfterMs?: number;
}

export interface RefreshSessionResponse {
  ok: boolean;
  gatewaySessionToken?: string;
  gatewayRefreshToken?: string;
  expiresInSeconds?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Contratos de Conexão e Autenticação Gateway ↔ Extensão (Fase 4C.4A)
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'connected' | 'disconnected' | 'requires_reauth' | 'rate_limited';

export type BlingConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'awaiting_oauth'
  | 'connected'
  | 'refreshing'
  | 'requires_reauth'
  | 'session_expired'
  | 'gateway_unreachable'
  | 'configuration_error';

export interface StartAuthRequest {
  clientSessionId: string;
}

export interface StartAuthResponse {
  ok: boolean;
  authorizationUrl?: string;
  pairingId?: string;
  pairingSecret?: string;
  expiresInSeconds?: number;
  error?: string;
  message?: string;
  retryAfterMs?: number;
}

export interface SessionHandshakeRequest {
  pairingId: string;
  pairingSecret: string;
}

export interface SessionHandshakeResponse {
  ok: boolean;
  status?: ConnectionStatus;
  gatewaySessionToken?: string;
  gatewayRefreshToken?: string;
  expiresInSeconds?: number;
  error?: string;
  message?: string;
  remainingAttempts?: number;
}

export interface RefreshSessionRequest {
  gatewayRefreshToken: string;
}

export interface BlingStatusResponse {
  ok: boolean;
  connected?: boolean;
  status?: ConnectionStatus;
  requiresReauth?: boolean;
  lastRefreshAt?: string | null;
  error?: string;
  message?: string;
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
  error?: string;
}

// ---------------------------------------------------------------------------
// Mensagens Internas da Extensão (Sidebar / Content Script <-> Background)
// ---------------------------------------------------------------------------

export interface BlingStartConnectMessage {
  type: 'BLING_START_CONNECT';
}

export interface BlingStartConnectResponse {
  ok: boolean;
  status: BlingConnectionStatus;
  authorizationUrl?: string;
  pairingId?: string;
  error?: string;
  message?: string;
}

export interface BlingGetConnectionStatusMessage {
  type: 'BLING_GET_CONNECTION_STATUS';
}

export interface BlingGetConnectionStatusResponse {
  ok: boolean;
  status: BlingConnectionStatus;
  lastRefreshAt?: string | null;
  error?: string;
  message?: string;
}

export interface BlingDisconnectMessage {
  type: 'BLING_DISCONNECT';
}

export interface BlingDisconnectResponseMessage {
  ok: boolean;
  status: 'disconnected';
  error?: string;
  message?: string;
}

export interface BlingConnectionStatusChangedMessage {
  type: 'BLING_CONNECTION_STATUS_CHANGED';
  status: BlingConnectionStatus;
  lastRefreshAt?: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Mensagens Adicionais de UI (Fase 4C.4B)
// ---------------------------------------------------------------------------

/**
 * Solicita ao Background que foque a aba OAuth em andamento (se existir).
 * A UI NÃO recebe oauthTabId, pairingId nem pairingSecret — Background é autoridade.
 */
export interface BlingFocusOAuthTabMessage {
  type: 'BLING_FOCUS_OAUTH_TAB';
}

export interface BlingFocusOAuthTabResponse {
  ok: boolean;
  focused: boolean; // false se não houver aba OAuth ativa (resposta segura, sem detalhes internos)
}

/**
 * Solicita ao Background que reavalie o estado de sessão atual, sem iniciar novo OAuth.
 * Usado no botão "Tentar novamente" de gateway_unreachable.
 * Ordem de tentativa:
 *   1. Se GST válido → consulta /integrations/bling/status
 *   2. Se GST ausente/expirado + GRT disponível → tenta refresh
 *   3. Se não recuperável → retorna estado terminal (requires_reauth | session_expired | disconnected)
 * NUNCA inicia novo fluxo OAuth automaticamente.
 */
export interface BlingRetryConnectionMessage {
  type: 'BLING_RETRY_CONNECTION';
}

export interface BlingRetryConnectionResponse {
  ok: boolean;
  status: BlingConnectionStatus;
  lastRefreshAt?: string | null;
  error?: string;
  message?: string;
}

