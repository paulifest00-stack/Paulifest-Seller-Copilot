/**
 * Rate Limiter em Memória para Proteção de Endpoints Sensíveis (Fase 4C.1).
 * 
 * NOTA ARQUITETURAL DE ESCOPO E PRODUÇÃO:
 * - Esta implementação opera estritamente na memória volátil do processo Node.js atual.
 * - NÃO é compartilhada entre múltiplos processos, workers ou réplicas horizontais.
 * - Reiniciar o processo do Gateway reinicializa os contadores a zero.
 * - Em ambientes de produção multi-instância (ex: Kubernetes, múltiplos containers Render/Fly.io),
 *   este rate limiting deve ser migrado para um store compartilhado atômico (Redis/Upstash)
 *   ou delegado para a camada de borda (Cloudflare WAF / API Gateway).
 */
interface RateLimitBucket {
  timestamps: number[];
}

export class MemoryRateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 10, windowSeconds: number = 60) {
    this.maxRequests = maxRequests;
    this.windowMs = windowSeconds * 1000;
  }

  /**
   * Verifica se a chave fornecida (IP ou identificador) excedeu o limite.
   */
  check(key: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key) || { timestamps: [] };

    // Filtra timestamps dentro da janela deslizante atual
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < this.windowMs);

    if (bucket.timestamps.length >= this.maxRequests) {
      const oldest = bucket.timestamps[0];
      const resetInMs = Math.max(0, this.windowMs - (now - oldest));
      return {
        allowed: false,
        remaining: 0,
        resetInMs
      };
    }

    bucket.timestamps.push(now);
    this.buckets.set(key, bucket);

    return {
      allowed: true,
      remaining: this.maxRequests - bucket.timestamps.length,
      resetInMs: this.windowMs
    };
  }

  /**
   * Limpa buckets antigos em memória.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      bucket.timestamps = bucket.timestamps.filter((t) => now - t < this.windowMs);
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  clearAll(): void {
    this.buckets.clear();
  }
}

// Limitador estrito para tentativas de handshake de sessão (10 tentativas por minuto por IP)
export const sessionHandshakeLimiter = new MemoryRateLimiter(10, 60);

// Limitador para início de autorização (15 requisições por minuto por IP)
export const startAuthLimiter = new MemoryRateLimiter(15, 60);

// Limitador para leitura de produtos do Bling (30 requisições por minuto por IP/conexão)
export const productReadLimiter = new MemoryRateLimiter(30, 60);

