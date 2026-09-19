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
