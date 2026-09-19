// Funções Criptográficas de Alta Entropia, Hashes e Timing-Safe Comparison (Fase 4C.1)
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Gera um OAuth State com 256 bits de entropia criptográfica (CSPRNG).
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Gera um UUID v4 para pareamento.
 */
export function generatePairingId(): string {
  return randomUUID();
}

/**
 * Gera um Pairing Secret efêmero de uso único com 256 bits de entropia.
 */
export function generatePairingSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Gera um token de refresh da sessão do Gateway com 256 bits de entropia.
 */
export function generateGatewayRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Gera o hash SHA-256 de um segredo (state, pairingSecret, refreshToken).
 * O Gateway armazena exclusivamente esse hash, nunca o segredo em texto puro.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Comparação em tempo constante para evitar Timing Attacks na validação de segredos e hashes.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // timingSafeEqual exige buffers do mesmo tamanho.
  // Se forem de tamanhos diferentes, comparamos bufA contra ele mesmo para manter tempo constante e retornamos false.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Emite um Gateway Session Token (GST) assinado com HMAC-SHA256 (JWT).
 */
export function createGatewaySessionToken(
  claims: { connectionId: string; clientSessionId: string; sessionId?: string },
  jwtSecret: string,
  expiresInSeconds: number = 900
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: claims.connectionId,
    csid: claims.clientSessionId,
    sid: claims.sessionId,
    iat: now,
    exp: now + expiresInSeconds,
    iss: 'paulifest-integration-gateway'
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', jwtSecret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

/**
 * Valida um Gateway Session Token (GST) em tempo constante e verifica expiração.
 */
export function verifyGatewaySessionToken(
  token: string,
  jwtSecret: string
): { valid: boolean; claims?: { connectionId: string; clientSessionId: string; sessionId?: string }; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token ausente ou malformado.' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Formato de JWT inválido.' };
  }

  const [b64Header, b64Payload, signature] = parts;

  let parsedHeader: { alg?: string; typ?: string };
  try {
    const headerJson = Buffer.from(b64Header, 'base64url').toString('utf8');
    parsedHeader = JSON.parse(headerJson);
  } catch {
    return { valid: false, error: 'Header de JWT malformado.' };
  }

  // Validação estrita de algoritmo: impede 'none', 'RS256' ou qualquer algoritmo não suportado
  if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') {
    return { valid: false, error: 'Algoritmo ou tipo de token não suportado.' };
  }

  const expectedSig = createHmac('sha256', jwtSecret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  if (!constantTimeCompare(signature, expectedSig)) {
    return { valid: false, error: 'Assinatura do token inválida.' };
  }

  try {
    const payloadJson = Buffer.from(b64Payload, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    // Validação da estrutura mínima dos claims esperados
    if (!payload || typeof payload !== 'object') {
      return { valid: false, error: 'Payload de sessão inválido.' };
    }

    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      return { valid: false, error: 'Claim sub (connectionId) ausente ou inválida.' };
    }

    if (typeof payload.csid !== 'string' || !payload.csid.trim()) {
      return { valid: false, error: 'Claim csid (clientSessionId) ausente ou inválida.' };
    }

    if (typeof payload.exp !== 'number') {
      return { valid: false, error: 'Claim exp ausente ou inválida.' };
    }

    // Validação de emissor confiável (iss)
    if (payload.iss !== 'paulifest-integration-gateway') {
      return { valid: false, error: 'Issuer do token inválido.' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > payload.exp) {
      return { valid: false, error: 'Token de sessão expirado.' };
    }

    return {
      valid: true,
      claims: {
        connectionId: payload.sub,
        clientSessionId: payload.csid,
        sessionId: payload.sid
      }
    };
  } catch {
    return { valid: false, error: 'Payload de sessão corrompido.' };
  }
}
