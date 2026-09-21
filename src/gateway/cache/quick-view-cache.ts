// Cache volátil em memória no Gateway para Quick View (Fase 4D.2)
// Chave estrita: authenticatedConnectionId + productId (derivado exclusivamente da sessão GST validada)
// Sem persistência, sem compartilhamento entre contas (isolamento multi-tenant).
import type { BlingProductQuickView } from '../types/contracts.ts';

export interface QuickViewCacheEntry {
  data: BlingProductQuickView;
  expiresAt: number;
}

export class QuickViewCache {
  private cache = new Map<string, QuickViewCacheEntry>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  private makeKey(connectionId: string, productId: string): string {
    return `${connectionId.trim()}:${productId.trim()}`;
  }

  get(connectionId: string, productId: string): BlingProductQuickView | null {
    if (!connectionId || !productId) return null;
    const key = this.makeKey(connectionId, productId);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(connectionId: string, productId: string, data: BlingProductQuickView, ttlMs?: number): void {
    if (!connectionId || !productId || !data) return;
    const key = this.makeKey(connectionId, productId);
    const ttl = ttlMs !== undefined && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl
    });
  }

  invalidate(connectionId: string, productId: string): boolean {
    if (!connectionId || !productId) return false;
    return this.cache.delete(this.makeKey(connectionId, productId));
  }

  clearForConnection(connectionId: string): void {
    if (!connectionId) return;
    const prefix = `${connectionId.trim()}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export const quickViewCache = new QuickViewCache(60_000);
