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
  private reads = new Set<{ connectionId: string; valid: boolean }>();

  beginRead(connectionId: string) {
    const ticket = { connectionId, valid: true };
    this.reads.add(ticket);
    return ticket;
  }

  endRead(ticket: { connectionId: string; valid: boolean }): void { this.reads.delete(ticket); }

  private prune(): void {
    for (const [key, entry] of this.cache) if (Date.now() >= entry.expiresAt) this.cache.delete(key);
  }

  constructor(defaultTtlMs: number = 60_000, private maxEntries = 1000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Invalid cache limit');
    this.defaultTtlMs = defaultTtlMs;
  }

  private makeKey(connectionId: string, productId: string): string {
    return JSON.stringify([connectionId.trim(), productId.trim()]);
  }

  get(connectionId: string, productId: string): BlingProductQuickView | null {
    if (!connectionId || !productId) return null;
    const key = this.makeKey(connectionId, productId);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(connectionId: string, productId: string, data: BlingProductQuickView, ttlMs?: number): void {
    if (!connectionId || !productId || !data) return;
    const key = this.makeKey(connectionId, productId);
    const ttl = ttlMs !== undefined && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    this.prune();
    this.cache.delete(key);
    while (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
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
    for (const ticket of this.reads) if (ticket.connectionId === connectionId) ticket.valid = false;
    for (const key of this.cache.keys()) {
      if (JSON.parse(key)[0] === connectionId.trim()) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    for (const ticket of this.reads) ticket.valid = false;
    this.cache.clear();
  }

  size(): number {
    this.prune();
    return this.cache.size;
  }
}

export const quickViewCache = new QuickViewCache(60_000);
