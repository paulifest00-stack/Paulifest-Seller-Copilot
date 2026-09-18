/**
 * Repositório de Integração do Gateway (Fase 4C.1 - Security Foundation)
 * 
 * DECLARAÇÃO EXPLÍCITA DE AMBIENTE (DEV/TEST vs. PRODUÇÃO):
 * -----------------------------------------------------------------------------
 * 1. IMPLEMENTAÇÃO ATUAL: `InMemoryGatewayRepository` é uma implementação 100%
 *    EM MEMÓRIA VOLÁTIL para uso em ambiente de DESENVOLVIMENTO LOCAL e TESTES UNITÁRIOS.
 * 2. NÃO GRAVA EM POSTGRESQL NEM EM SQLITE NESTA FASE 4C.1.
 * 3. Todo o estado é perdido ao reiniciar o processo do Node.js.
 * 4. GARANTIAS DE CONCORRÊNCIA E TRANSAÇÕES EM PRODUÇÃO:
 *    - Em memória, a atomicidade de operações concorrentes é garantida via travas (mutexes)
 *      sincronizadas no event-loop do Node.js.
 *    - Na implementação de produção futura (PostgreSQL / SQLite durável), a atomicidade
 *      e proteção contra race conditions dependerão obrigatoriamente de:
 *      a) Transações ACID (`BEGIN TRANSACTION ... COMMIT`);
 *      b) Row-level locking pessimista (`SELECT ... FOR UPDATE`);
 *      c) Constraints únicas no banco (`UNIQUE(state_hash)`, `UNIQUE(refresh_token_hash)`);
 *      d) Updates condicionais atômicos (ex: `UPDATE oauth_pairing_requests SET consumed = TRUE WHERE pairing_id = $1 AND consumed = FALSE RETURNING *`).
 * 5. O arquivo `schema.ts` (`GATEWAY_SCHEMA_SQL`) permanece como o CONTRATO FORMAL
 *    de DDL SQL para a persistência futura.
 */

import { randomUUID } from 'node:crypto';
import { constantTimeCompare, hashSecret } from '../crypto/pairing-state.ts';
import type {
  BlingConnectionRecord,
  OAuthPairingRequestRecord,
  GatewaySessionRecord
} from '../types/contracts.ts';

/**
 * Mutex assíncrono para serializar operações críticas e garantir que chamadas
 * concorrentes não entrem em condições de corrida (Race Conditions).
 */
class AsyncMutex {
  private queue = Promise.resolve();

  runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(() => task());
    this.queue = result.then(() => {}, () => {});
    return result;
  }
}

export interface IGatewayRepository {
  // Conexões Bling
  saveConnection(conn: BlingConnectionRecord): Promise<void>;
  getConnection(id: string): Promise<BlingConnectionRecord | undefined>;
  getConnectionByClientSession(clientSessionId: string): Promise<BlingConnectionRecord | undefined>;
  updateConnectionTokens(
    id: string,
    tokens: {
      encryptedAccessToken: string;
      accessTokenIv: string;
      accessTokenTag: string;
      encryptedRefreshToken: string;
      refreshTokenIv: string;
      refreshTokenTag: string;
      tokenExpiresAt: string;
    }
  ): Promise<void>;
  updateConnectionStatus(id: string, status: BlingConnectionRecord['status']): Promise<void>;
  deleteConnection(id: string): Promise<void>;

  // Pareamentos OAuth (Pairing Requests)
  savePairingRequest(pairing: OAuthPairingRequestRecord): Promise<void>;
  getPairingByStateHash(stateHash: string): Promise<OAuthPairingRequestRecord | undefined>;
  attachConnectionToPairing(stateHash: string, connectionId: string): Promise<boolean>;
  verifyAndAttachConnectionToPairing(
    stateHash: string,
    connectionId: string
  ): Promise<{
    ok: boolean;
    pairing?: OAuthPairingRequestRecord;
    error?: string;
  }>;
  verifyAndConsumePairing(
    pairingId: string,
    pairingSecret: string
  ): Promise<{
    ok: boolean;
    pairing?: OAuthPairingRequestRecord;
    error?: string;
    remainingAttempts?: number;
  }>;

  // Sessões do Gateway (com Rotação e Reuse Detection)
  createGatewaySession(session: GatewaySessionRecord): Promise<void>;
  rotateGatewaySession(
    oldRefreshToken: string,
    newRefreshToken: string,
    expiresInDays?: number
  ): Promise<{
    ok: boolean;
    newSession?: GatewaySessionRecord;
    error?: string;
    familyRevoked?: boolean;
  }>;
  revokeSessionFamily(tokenFamilyId: string): Promise<void>;
  getSessionByRefreshHash(refreshHash: string): Promise<GatewaySessionRecord | undefined>;

  // Limpeza
  cleanupExpired(): Promise<{ pairingsRemoved: number; sessionsRemoved: number }>;
  clearAll(): Promise<void>;
}

export class InMemoryGatewayRepository implements IGatewayRepository {
  private connections = new Map<string, BlingConnectionRecord>();
  private pairings = new Map<string, OAuthPairingRequestRecord>();
  private sessions = new Map<string, GatewaySessionRecord>();
  private mutex = new AsyncMutex();

  // ---------------------------------------------------------------------------
  // Conexões Bling
  // ---------------------------------------------------------------------------
  async saveConnection(conn: BlingConnectionRecord): Promise<void> {
    this.connections.set(conn.id, { ...conn });
  }

  async getConnection(id: string): Promise<BlingConnectionRecord | undefined> {
    const found = this.connections.get(id);
    return found ? { ...found } : undefined;
  }

  async getConnectionByClientSession(clientSessionId: string): Promise<BlingConnectionRecord | undefined> {
    for (const conn of this.connections.values()) {
      if (conn.clientSessionId === clientSessionId && conn.status !== 'disconnected') {
        return { ...conn };
      }
    }
    return undefined;
  }

  async updateConnectionTokens(
    id: string,
    tokens: {
      encryptedAccessToken: string;
      accessTokenIv: string;
      accessTokenTag: string;
      encryptedRefreshToken: string;
      refreshTokenIv: string;
      refreshTokenTag: string;
      tokenExpiresAt: string;
    }
  ): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Conexão não encontrada: ${id}`);

    conn.encryptedAccessToken = tokens.encryptedAccessToken;
    conn.accessTokenIv = tokens.accessTokenIv;
    conn.accessTokenTag = tokens.accessTokenTag;
    conn.encryptedRefreshToken = tokens.encryptedRefreshToken;
    conn.refreshTokenIv = tokens.refreshTokenIv;
    conn.refreshTokenTag = tokens.refreshTokenTag;
    conn.tokenExpiresAt = tokens.tokenExpiresAt;
    conn.status = 'connected';
    conn.updatedAt = new Date().toISOString();

    this.connections.set(id, conn);
  }

  async updateConnectionStatus(id: string, status: BlingConnectionRecord['status']): Promise<void> {
    const conn = this.connections.get(id);
    if (conn) {
      conn.status = status;
      conn.updatedAt = new Date().toISOString();
      this.connections.set(id, conn);
    }
  }

  async deleteConnection(id: string): Promise<void> {
    this.connections.delete(id);
    // Invalida todas as sessões atreladas a esta conexão
    for (const [sId, s] of this.sessions.entries()) {
      if (s.connectionId === id) {
        this.sessions.delete(sId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pareamentos OAuth (Guardrail 1: DoS Prevention & Single-Use)
  // ---------------------------------------------------------------------------
  async savePairingRequest(pairing: OAuthPairingRequestRecord): Promise<void> {
    this.pairings.set(pairing.pairingId, { ...pairing });
  }

  async getPairingByStateHash(stateHash: string): Promise<OAuthPairingRequestRecord | undefined> {
    for (const pairing of this.pairings.values()) {
      if (constantTimeCompare(pairing.stateHash, stateHash)) {
        return { ...pairing };
      }
    }
    return undefined;
  }

  async attachConnectionToPairing(stateHash: string, connectionId: string): Promise<boolean> {
    const res = await this.verifyAndAttachConnectionToPairing(stateHash, connectionId);
    return res.ok;
  }

  /**
   * Validação atômica e consumo do State OAuth no callback (Guardrail de Concorrência e Anti-Replay).
   * 
   * Ordem estrita de validação:
   * 1. Existência e comparação em tempo constante do stateHash;
   * 2. Verificação de TTL (expiração);
   * 3. Verificação de estado já consumido ou previamente vinculado;
   * 4. Consumo imediato e atômico (stateHash é limpo para impedir qualquer replay ou concorrência).
   */
  async verifyAndAttachConnectionToPairing(
    stateHash: string,
    connectionId: string
  ): Promise<{
    ok: boolean;
    pairing?: OAuthPairingRequestRecord;
    error?: string;
  }> {
    return this.mutex.runExclusive(async () => {
      if (!stateHash) {
        return { ok: false, error: 'MISSING_STATE_HASH' };
      }

      let targetPairing: OAuthPairingRequestRecord | undefined;
      for (const pairing of this.pairings.values()) {
        if (pairing.stateHash && constantTimeCompare(pairing.stateHash, stateHash)) {
          targetPairing = pairing;
          break;
        }
      }

      // 1. Verificação de existência
      if (!targetPairing) {
        return { ok: false, error: 'STATE_NOT_FOUND' };
      }

      // 2. Verificação de single-use prévio
      if (targetPairing.consumed) {
        return { ok: false, error: 'PAIRING_ALREADY_CONSUMED' };
      }

      // 3. Verificação de TTL (expiração)
      const now = Date.now();
      if (now > new Date(targetPairing.expiresAt).getTime()) {
        return { ok: false, error: 'PAIRING_EXPIRED' };
      }

      // 4. Verificação de conexão já vinculada
      if (targetPairing.connectionId) {
        return { ok: false, error: 'PAIRING_ALREADY_ATTACHED' };
      }

      // 5. Sucesso: vínculo da conexão e consumo definitivo do stateHash (Anti-Replay)
      targetPairing.connectionId = connectionId;
      targetPairing.stateHash = ''; // Invalida o stateHash para chamadas subsequentes/concorrentes
      this.pairings.set(targetPairing.pairingId, targetPairing);

      return {
        ok: true,
        pairing: { ...targetPairing }
      };
    });
  }

  /**
   * Validação atômica do pairingSecret com proteção contra DoS e Single-Use (Guardrail 1).
   */
  async verifyAndConsumePairing(
    pairingId: string,
    pairingSecret: string
  ): Promise<{
    ok: boolean;
    pairing?: OAuthPairingRequestRecord;
    error?: string;
    remainingAttempts?: number;
  }> {
    return this.mutex.runExclusive(async () => {
      const pairing = this.pairings.get(pairingId);

      // 1. Verificação de existência
      if (!pairing) {
        return { ok: false, error: 'PAIRING_NOT_FOUND' };
      }

      // 2. Verificação de single-use
      if (pairing.consumed) {
        return { ok: false, error: 'PAIRING_ALREADY_CONSUMED' };
      }

      // 3. Verificação de TTL (expiração)
      const now = Date.now();
      const expiresAt = new Date(pairing.expiresAt).getTime();
      if (now > expiresAt) {
        return { ok: false, error: 'PAIRING_EXPIRED' };
      }

      // 4. Guardrail 1: Proteção contra Brute Force / DoS
      if (pairing.failedAttempts >= pairing.maxAttempts) {
        return { ok: false, error: 'PAIRING_MAX_ATTEMPTS_EXCEEDED', remainingAttempts: 0 };
      }

      // 5. Comparação em tempo constante do hash do pairingSecret
      const providedHash = hashSecret(pairingSecret);
      const matches = constantTimeCompare(providedHash, pairing.pairingSecretHash);

      if (!matches) {
        // Falha de senha NÃO consome/destrói o pairing imediatamente (evita DoS por atacante avulso)
        pairing.failedAttempts += 1;
        this.pairings.set(pairingId, pairing);
        const remaining = Math.max(0, pairing.maxAttempts - pairing.failedAttempts);
        return {
          ok: false,
          error: 'INVALID_PAIRING_SECRET',
          remainingAttempts: remaining
        };
      }

      // 6. Confirmação de conexão associada
      if (!pairing.connectionId) {
        return { ok: false, error: 'OAUTH_FLOW_NOT_COMPLETED' };
      }

      // 7. Sucesso: consumo definitivo atômico (single-use)
      pairing.consumed = true;
      this.pairings.set(pairingId, pairing);

      return {
        ok: true,
        pairing: { ...pairing }
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Sessões do Gateway (Guardrail 2: Rotação e Detecção de Reuse)
  // ---------------------------------------------------------------------------
  async createGatewaySession(session: GatewaySessionRecord): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async getSessionByRefreshHash(refreshHash: string): Promise<GatewaySessionRecord | undefined> {
    for (const s of this.sessions.values()) {
      if (constantTimeCompare(s.refreshTokenHash, refreshHash)) {
        return { ...s };
      }
    }
    return undefined;
  }

  async rotateGatewaySession(
    oldRefreshToken: string,
    newRefreshToken: string,
    expiresInDays: number = 14
  ): Promise<{
    ok: boolean;
    newSession?: GatewaySessionRecord;
    error?: string;
    familyRevoked?: boolean;
  }> {
    return this.mutex.runExclusive(async () => {
      const oldHash = hashSecret(oldRefreshToken);
      let targetSession: GatewaySessionRecord | undefined;

      for (const s of this.sessions.values()) {
        if (constantTimeCompare(s.refreshTokenHash, oldHash)) {
          targetSession = s;
          break;
        }
      }

      if (!targetSession) {
        return { ok: false, error: 'SESSION_NOT_FOUND' };
      }

      // 1. Verificação se a sessão já está revogada
      if (targetSession.revokedAt) {
        return { ok: false, error: 'SESSION_REVOKED' };
      }

      // 2. Guardrail 2: DETECÇÃO DE REUSE DE TOKEN
      // Se o token já foi usado anteriormente para gerar outro (usedAt preenchido), temos um reuse!
      if (targetSession.usedAt || targetSession.replacedByHash) {
        // Revoga imediatamente toda a família de tokens
        await this.revokeSessionFamily(targetSession.tokenFamilyId);
        return {
          ok: false,
          error: 'TOKEN_REUSE_DETECTED',
          familyRevoked: true
        };
      }

      // 3. Verificação de expiração da sessão
      const now = Date.now();
      if (now > new Date(targetSession.expiresAt).getTime()) {
        return { ok: false, error: 'SESSION_EXPIRED' };
      }

      // 4. Rotação bem-sucedida
      const newHash = hashSecret(newRefreshToken);
      const nowIso = new Date().toISOString();
      const newExpiresAt = new Date(now + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

      // Marca a sessão antiga como consumida e vincula ao novo hash
      targetSession.usedAt = nowIso;
      targetSession.replacedByHash = newHash;
      this.sessions.set(targetSession.id, targetSession);

      // Cria a nova sessão na mesma família
      const newSession: GatewaySessionRecord = {
        id: randomUUID(),
        connectionId: targetSession.connectionId,
        tokenFamilyId: targetSession.tokenFamilyId,
        refreshTokenHash: newHash,
        expiresAt: newExpiresAt,
        createdAt: nowIso
      };

      this.sessions.set(newSession.id, newSession);

      return {
        ok: true,
        newSession: { ...newSession }
      };
    });
  }

  async revokeSessionFamily(tokenFamilyId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    for (const [id, s] of this.sessions.entries()) {
      if (s.tokenFamilyId === tokenFamilyId && !s.revokedAt) {
        s.revokedAt = nowIso;
        this.sessions.set(id, s);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Limpeza Automática (Guardrail 4)
  // ---------------------------------------------------------------------------
  async cleanupExpired(): Promise<{ pairingsRemoved: number; sessionsRemoved: number }> {
    const now = Date.now();
    let pairingsRemoved = 0;
    let sessionsRemoved = 0;

    // Remove pairings expirados ou consumidos
    for (const [id, p] of this.pairings.entries()) {
      const expires = new Date(p.expiresAt).getTime();
      if (now > expires || p.consumed) {
        this.pairings.delete(id);
        pairingsRemoved++;
      }
    }

    // Remove sessões expiradas ou revogadas
    for (const [id, s] of this.sessions.entries()) {
      const expires = new Date(s.expiresAt).getTime();
      if (now > expires || (s.revokedAt && now - new Date(s.revokedAt).getTime() > 24 * 60 * 60 * 1000)) {
        this.sessions.delete(id);
        sessionsRemoved++;
      }
    }

    return { pairingsRemoved, sessionsRemoved };
  }

  async clearAll(): Promise<void> {
    this.connections.clear();
    this.pairings.clear();
    this.sessions.clear();
  }
}

// Exportações explícitas
export { InMemoryGatewayRepository as MemoryGatewayRepository };
export const gatewayRepository = new InMemoryGatewayRepository();
