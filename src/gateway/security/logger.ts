// Logger Seguro com Sanitização Estrita de Segredos e Tokens (Fase 4C.1)

const SENSITIVE_KEYS = new Set([
  'client_secret',
  'clientsecret',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'pairingsecret',
  'pairing_secret',
  'password',
  'authorization',
  'cookie',
  'set-cookie',
  'code',
  'state',
  'token',
  'database_url',
  'databaseurl',
  'db_url',
  'connection_string'
]);

/**
 * Higieniza recursivamente objetos, arrays e strings mascarando qualquer segredo.
 */
export function sanitizeForLogs(value: unknown, depth: number = 0): unknown {
  if (depth > 6) return '[MaxDepthExceeded]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    // Mascara connection strings de banco (ex: postgres://user:password@host:port/db)
    let sanitized = value.replace(/postgres(?:ql)?:\/\/[^:]+:[^@]+@[^\s"']+/gi, 'postgresql://[REDACTED]@[REDACTED]');
    // Mascara Bearer tokens
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]');
    // Mascara Basic auth
    sanitized = sanitized.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]');
    return sanitized;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogs(item, depth + 1));
  }

  if (typeof value === 'object') {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = k.toLowerCase().replace(/[-_]/g, '');
      if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('token')) {
        sanitizedObj[k] = '[REDACTED]';
      } else {
        sanitizedObj[k] = sanitizeForLogs(v, depth + 1);
      }
    }
    return sanitizedObj;
  }

  return value;
}

export class SafeLogger {
  private prefix: string;

  constructor(prefix: string = '[Paulifest Gateway]') {
    this.prefix = prefix;
  }

  info(message: string, ...args: unknown[]): void {
    const sanitizedArgs = args.map((a) => sanitizeForLogs(a));
    console.info(`${this.prefix} ${message}`, ...sanitizedArgs);
  }

  warn(message: string, ...args: unknown[]): void {
    const sanitizedArgs = args.map((a) => sanitizeForLogs(a));
    console.warn(`${this.prefix} ${message}`, ...sanitizedArgs);
  }

  error(message: string, ...args: unknown[]): void {
    const sanitizedArgs = args.map((a) => sanitizeForLogs(a));
    console.error(`${this.prefix} ${message}`, ...sanitizedArgs);
  }

  debug(message: string, ...args: unknown[]): void {
    const sanitizedArgs = args.map((a) => sanitizeForLogs(a));
    console.debug(`${this.prefix} ${message}`, ...sanitizedArgs);
  }
}

export const gatewayLogger = new SafeLogger();
