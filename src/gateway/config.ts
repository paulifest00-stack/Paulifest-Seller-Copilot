import { createHash } from 'node:crypto';
import { OFFICIAL_BLING_AUTH_URL } from '../shared/gateway-contracts.ts';

export interface GatewayConfig {
  blingClientId: string;
  blingClientSecret: string;
  blingRedirectUri: string;
  blingBaseUrl: string;            // Default: 'https://api.bling.com.br'
  blingAuthUrl: string;            // Default: 'https://www.bling.com.br/Api/v3/oauth/authorize'
  blingTimeoutMs: number;          // Default: 8000ms
  encryptionKey: Buffer;           // Chave de 32 bytes para AES-256
  jwtSecret: string;
  port: number;
  environment: 'development' | 'test' | 'production';
  pairingTtlSeconds: number;       // Default: 300 (5 minutos)
  gstTtlSeconds: number;           // Default: 900 (15 minutos)
  sessionRefreshTtlDays: number;   // Default: 14 dias
  databaseUrl?: string;            // PostgreSQL connection string (Fase 4C.2)
  allowedExtensionOrigins?: string[]; // Allowlist explícita de origens de extensão
  trustProxy?: boolean;               // Habilita confiança em reverse proxy (X-Forwarded-For)
  allowLocalhostCors?: boolean;       // Permite localhost apenas em desenvolvimento/testes
  quickViewCacheMaxEntries?: number; // Default 1000, FIFO eviction and opportunistic expiry
  quickViewCacheTtlMs: number;        // Default: 60000 (60s)
}

export function loadGatewayConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const environment = (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development') as GatewayConfig['environment'];
  const port = parseInt(env.GATEWAY_PORT || '3001', 10);
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const blingBaseUrl = env.BLING_BASE_URL?.trim() || 'https://api.bling.com.br';
  const blingAuthUrl = env.BLING_AUTH_URL?.trim() || OFFICIAL_BLING_AUTH_URL;
  const blingTimeoutMs = parseInt(env.BLING_TIMEOUT_MS || '8000', 10);
  const allowedExtensionOrigins = env.GATEWAY_ALLOWED_EXTENSION_ORIGINS
    ? env.GATEWAY_ALLOWED_EXTENSION_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const trustProxy = env.GATEWAY_TRUST_PROXY === 'true';
  const quickViewCacheTtlMs = parseInt(env.GATEWAY_QUICK_VIEW_CACHE_TTL_MS || '60000', 10);

  const quickViewCacheMaxEntries = Number(env.GATEWAY_QUICK_VIEW_CACHE_MAX_ENTRIES || 1000);
  if (!Number.isInteger(quickViewCacheMaxEntries) || quickViewCacheMaxEntries < 1 || !Number.isFinite(quickViewCacheTtlMs) || quickViewCacheTtlMs <= 0) {
    throw new Error('Limites de cache Quick View inválidos.');
  }

  if (environment === 'production') {
    // Validação estrita em Produção: nenhum segredo pode usar fallback fictício
    const blingClientId = env.BLING_CLIENT_ID?.trim();
    if (!blingClientId) {
      throw new Error('Configuração de produção inválida: BLING_CLIENT_ID é obrigatório.');
    }

    const blingClientSecret = env.BLING_CLIENT_SECRET?.trim();
    if (!blingClientSecret) {
      throw new Error('Configuração de produção inválida: BLING_CLIENT_SECRET é obrigatório.');
    }

    const blingRedirectUri = env.BLING_REDIRECT_URI?.trim();
    if (!blingRedirectUri || !blingRedirectUri.startsWith('https://')) {
      throw new Error('Configuração de produção inválida: BLING_REDIRECT_URI com HTTPS é obrigatório.');
    }

    const rawEncKey = env.GATEWAY_ENCRYPTION_KEY?.trim();
    if (!rawEncKey) {
      throw new Error('Configuração de produção inválida: GATEWAY_ENCRYPTION_KEY é obrigatório.');
    }

    const jwtSecret = env.GATEWAY_JWT_SECRET?.trim();
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('Configuração de produção inválida: GATEWAY_JWT_SECRET com no mínimo 32 caracteres é obrigatório.');
    }

    let encryptionKey: Buffer;
    if (rawEncKey.length === 64) {
      encryptionKey = Buffer.from(rawEncKey, 'hex');
    } else if (rawEncKey.length === 44 && rawEncKey.endsWith('=')) {
      encryptionKey = Buffer.from(rawEncKey, 'base64');
    } else {
      encryptionKey = createHash('sha256').update(rawEncKey).digest();
    }

    if (encryptionKey.length !== 32) {
      throw new Error('GATEWAY_ENCRYPTION_KEY inválida: a chave AES-256 deve possuir exatamente 32 bytes.');
    }

    return {
      blingClientId,
      blingClientSecret,
      blingRedirectUri,
      blingBaseUrl,
      blingAuthUrl,
      blingTimeoutMs,
      encryptionKey,
      jwtSecret,
      port,
      environment,
      pairingTtlSeconds: 300,        // 5 minutos
      gstTtlSeconds: 900,           // 15 minutos
      sessionRefreshTtlDays: 14,    // 14 dias
      databaseUrl,
      allowedExtensionOrigins,
      trustProxy,
      allowLocalhostCors: false,
      quickViewCacheTtlMs, quickViewCacheMaxEntries
    };
  }

  if (environment === 'development') {
    // Ambiente de Desenvolvimento: NÃO inicia silenciosamente com secrets conhecidos/hardcoded.
    // Exige configuração explícita fornecida pelo operador no arquivo .env ou variáveis de ambiente.
    const blingClientId = env.BLING_CLIENT_ID?.trim();
    if (!blingClientId) {
      throw new Error('Configuração de desenvolvimento incompleta: BLING_CLIENT_ID é obrigatório. Configure no .env ou variáveis de ambiente.');
    }

    const blingClientSecret = env.BLING_CLIENT_SECRET?.trim();
    if (!blingClientSecret) {
      throw new Error('Configuração de desenvolvimento incompleta: BLING_CLIENT_SECRET é obrigatório. Configure no .env ou variáveis de ambiente.');
    }

    const rawEncKey = env.GATEWAY_ENCRYPTION_KEY?.trim();
    if (!rawEncKey) {
      throw new Error('Configuração de desenvolvimento incompleta: GATEWAY_ENCRYPTION_KEY é obrigatória. Configure no .env ou variáveis de ambiente.');
    }

    const jwtSecret = env.GATEWAY_JWT_SECRET?.trim();
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('Configuração de desenvolvimento incompleta: GATEWAY_JWT_SECRET (mínimo 32 caracteres) é obrigatório. Configure no .env ou variáveis de ambiente.');
    }

    const blingRedirectUri = env.BLING_REDIRECT_URI?.trim() || `http://localhost:${port}/auth/bling/callback`;

    let encryptionKey: Buffer;
    if (rawEncKey.length === 64) {
      encryptionKey = Buffer.from(rawEncKey, 'hex');
    } else if (rawEncKey.length === 44 && rawEncKey.endsWith('=')) {
      encryptionKey = Buffer.from(rawEncKey, 'base64');
    } else {
      encryptionKey = createHash('sha256').update(rawEncKey).digest();
    }

    if (encryptionKey.length !== 32) {
      throw new Error('GATEWAY_ENCRYPTION_KEY inválida: a chave AES-256 deve possuir exatamente 32 bytes.');
    }

    return {
      blingClientId,
      blingClientSecret,
      blingRedirectUri,
      blingBaseUrl,
      blingAuthUrl,
      blingTimeoutMs,
      encryptionKey,
      jwtSecret,
      port,
      environment,
      pairingTtlSeconds: 300,
      gstTtlSeconds: 900,
      sessionRefreshTtlDays: 14,
      databaseUrl,
      allowedExtensionOrigins,
      trustProxy,
      allowLocalhostCors: env.GATEWAY_ALLOW_LOCALHOST_CORS !== 'false',
      quickViewCacheTtlMs, quickViewCacheMaxEntries
    };
  }

  // Ambiente de Testes Automatizados (NODE_ENV === 'test'): permite mocks controlados para execução offline da suíte
  const blingClientId = env.BLING_CLIENT_ID || 'test_bling_client_id';
  const blingClientSecret = env.BLING_CLIENT_SECRET || 'test_bling_client_secret';
  const blingRedirectUri = env.BLING_REDIRECT_URI || 'https://gateway.paulifest.local/auth/bling/callback';
  const rawEncKey = env.GATEWAY_ENCRYPTION_KEY;
  const jwtSecret = env.GATEWAY_JWT_SECRET || 'test_jwt_secret_min_32_characters_long_for_unit_tests';

  let encryptionKey: Buffer;
  if (rawEncKey) {
    if (rawEncKey.length === 64) {
      encryptionKey = Buffer.from(rawEncKey, 'hex');
    } else if (rawEncKey.length === 44 && rawEncKey.endsWith('=')) {
      encryptionKey = Buffer.from(rawEncKey, 'base64');
    } else {
      encryptionKey = createHash('sha256').update(rawEncKey).digest();
    }
  } else {
    // Chave padrão determinística restrita exclusivamente à suíte de testes
    encryptionKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
  }

  return {
    blingClientId,
    blingClientSecret,
    blingRedirectUri,
    blingBaseUrl,
    blingAuthUrl,
    blingTimeoutMs,
    encryptionKey,
    jwtSecret,
    port,
    environment,
    pairingTtlSeconds: 300,
    gstTtlSeconds: 900,
    sessionRefreshTtlDays: 14,
    databaseUrl,
    allowedExtensionOrigins,
    trustProxy,
    allowLocalhostCors: env.GATEWAY_ALLOW_LOCALHOST_CORS !== 'false',
    quickViewCacheTtlMs, quickViewCacheMaxEntries
  };
}
