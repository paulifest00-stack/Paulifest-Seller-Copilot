// Repositório de Persistência Durável PostgreSQL do Gateway (Fase 4C.2A)
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getPool } from './connection.ts';
import { constantTimeCompare, hashSecret } from '../crypto/pairing-state.ts';
import type { IGatewayRepository } from './repository.ts';
import type {
  BlingConnectionRecord,
  OAuthPairingRequestRecord,
  ConsumeOAuthStateResult,
  GatewaySessionRecord,
  RefreshLeaseAcquireResult,
  RefreshLeaseState,
  RefreshTokensUpdateData,
  ConsumePairingAndCreateSessionParams,
  ConsumePairingAndCreateSessionResult
} from '../types/contracts.ts';

export class PostgresGatewayRepository implements IGatewayRepository {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  private async acquireClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  // ---------------------------------------------------------------------------
  // 1. Conexões Bling ERP
  // ---------------------------------------------------------------------------

  async saveConnection(conn: BlingConnectionRecord): Promise<void> {
    const queryText = `
      INSERT INTO bling_connections (
        id,
        status,
        access_token_cipher,
        access_token_iv,
        access_token_tag,
        refresh_token_cipher,
        refresh_token_iv,
        refresh_token_tag,
        key_version,
        expires_at,
        scope,
        account_identifier,
        last_refresh_at,
        refresh_lease_owner,
        refresh_lease_expires_at,
        token_version,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        access_token_cipher = EXCLUDED.access_token_cipher,
        access_token_iv = EXCLUDED.access_token_iv,
        access_token_tag = EXCLUDED.access_token_tag,
        refresh_token_cipher = EXCLUDED.refresh_token_cipher,
        refresh_token_iv = EXCLUDED.refresh_token_iv,
        refresh_token_tag = EXCLUDED.refresh_token_tag,
        key_version = EXCLUDED.key_version,
        expires_at = EXCLUDED.expires_at,
        scope = EXCLUDED.scope,
        account_identifier = EXCLUDED.account_identifier,
        last_refresh_at = EXCLUDED.last_refresh_at,
        updated_at = NOW();
    `;

    const nowIso = new Date().toISOString();
    const values = [
      conn.id,
      conn.status || 'connected',
      conn.encryptedAccessToken || null,
      conn.accessTokenIv || null,
      conn.accessTokenTag || null,
      conn.encryptedRefreshToken || null,
      conn.refreshTokenIv || null,
      conn.refreshTokenTag || null,
      conn.keyVersion || 'v1',
      conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null,
      conn.scope || null,
      conn.accountIdentifier || conn.accountId || null,
      conn.lastRefreshAt ? new Date(conn.lastRefreshAt) : null,
      conn.refreshLeaseOwner || null,
      conn.refreshLeaseExpiresAt ? new Date(conn.refreshLeaseExpiresAt) : null,
      conn.tokenVersion || 1,
      conn.createdAt ? new Date(conn.createdAt) : new Date(nowIso),
      conn.updatedAt ? new Date(conn.updatedAt) : new Date(nowIso)
    ];

    await this.pool.query(queryText, values);
  }

  async getConnection(id: string): Promise<BlingConnectionRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM bling_connections WHERE id = $1',
      [id]
    );
    if (rows.length === 0) return undefined;
    return this.mapConnectionRow(rows[0]);
  }

  async getConnectionByClientSession(clientSessionId: string): Promise<BlingConnectionRecord | undefined> {
    const queryText = `
      SELECT c.*
      FROM bling_connections c
      JOIN gateway_sessions s ON s.connection_id = c.id
      WHERE s.client_session_id = $1
        AND c.status != 'disconnected'
        AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC
      LIMIT 1;
    `;
    const { rows } = await this.pool.query(queryText, [clientSessionId]);
    if (rows.length === 0) return undefined;
    return this.mapConnectionRow(rows[0]);
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
    const queryText = `
      UPDATE bling_connections
      SET access_token_cipher = $2,
          access_token_iv = $3,
          access_token_tag = $4,
          refresh_token_cipher = $5,
          refresh_token_iv = $6,
          refresh_token_tag = $7,
          expires_at = $8,
          last_refresh_at = NOW(),
          updated_at = NOW()
      WHERE id = $1;
    `;
    const res = await this.pool.query(queryText, [
      id,
      tokens.encryptedAccessToken,
      tokens.accessTokenIv,
      tokens.accessTokenTag,
      tokens.encryptedRefreshToken,
      tokens.refreshTokenIv,
      tokens.refreshTokenTag,
      new Date(tokens.tokenExpiresAt)
    ]);
    if (res.rowCount === 0) {
      throw new Error(`Conexão não encontrada para atualização de tokens: ${id}`);
    }
  }

  async updateConnectionStatus(id: string, status: BlingConnectionRecord['status']): Promise<void> {
    const queryText = `
      UPDATE bling_connections
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1;
    `;
    await this.pool.query(queryText, [id, status]);
  }

  /**
   * Política de Desconexão Segura (Disconnect):
   * 1. Status passa para 'disconnected';
   * 2. Ciphertext, IV e Auth Tag de access e refresh token tornam-se NULL (purga definitiva);
   * 3. Sessões e Refresh Tokens atrelados à conexão são revogados;
   * 4. Metadados de auditoria (id, created_at, updated_at) são preservados.
   */
  async deleteConnection(id: string): Promise<void> {
    const client = await this.acquireClient();
    try {
      await client.query('BEGIN');

      // 1. Purga tokens na tabela de conexões sem violar a constraint chk_bling_connected_tokens
      await client.query(
        `UPDATE bling_connections
         SET status = 'disconnected',
             access_token_cipher = NULL,
             access_token_iv = NULL,
             access_token_tag = NULL,
             refresh_token_cipher = NULL,
             refresh_token_iv = NULL,
             refresh_token_tag = NULL,
             expires_at = NULL,
             refresh_lease_owner = NULL,
             refresh_lease_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [id]
      );

      // 2. Revoga todas as sessões do Gateway atreladas à conexão
      await client.query(
        `UPDATE gateway_sessions
         SET revoked_at = NOW()
         WHERE connection_id = $1 AND revoked_at IS NULL`,
        [id]
      );

      // 3. Revoga todos os tokens de refresh daquelas sessões
      await client.query(
        `UPDATE gateway_refresh_tokens
         SET revoked_at = NOW()
         WHERE session_id IN (SELECT id FROM gateway_sessions WHERE connection_id = $1)
           AND revoked_at IS NULL`,
        [id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Pareamentos OAuth (Pairing Requests) & Concorrência de State
  // ---------------------------------------------------------------------------

  async savePairingRequest(pairing: OAuthPairingRequestRecord): Promise<void> {
    const queryText = `
      INSERT INTO gateway_pairings (
        pairing_id,
        client_session_id,
        state_hash,
        pairing_secret_hash,
        connection_id,
        state_consumed_at,
        pairing_consumed_at,
        attempt_count,
        expires_at,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
    `;

    const values = [
      pairing.pairingId,
      pairing.clientSessionId,
      pairing.stateHash,
      pairing.pairingSecretHash,
      pairing.connectionId || null,
      pairing.stateConsumedAt ? new Date(pairing.stateConsumedAt) : null,
      pairing.pairingConsumedAt ? new Date(pairing.pairingConsumedAt) : null,
      pairing.attemptCount ?? pairing.failedAttempts ?? 0,
      new Date(pairing.expiresAt),
      pairing.createdAt ? new Date(pairing.createdAt) : new Date()
    ];

    await this.pool.query(queryText, values);
  }

  async getPairingByStateHash(stateHash: string): Promise<OAuthPairingRequestRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM gateway_pairings WHERE state_hash = $1',
      [stateHash]
    );
    if (rows.length === 0) return undefined;
    return this.mapPairingRow(rows[0]);
  }

  async getPairingById(pairingId: string): Promise<OAuthPairingRequestRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM gateway_pairings WHERE pairing_id = $1',
      [pairingId]
    );
    if (rows.length === 0) return undefined;
    return this.mapPairingRow(rows[0]);
  }

  /**
   * Fase A do Callback: Consumo atômico do state OAuth via transação curta com bloqueio de linha.
   * Não cria conexões placeholder; apenas valida TTL, estado virgem e marca state_consumed_at = NOW().
   */
  async consumeOAuthState(stateHash: string): Promise<ConsumeOAuthStateResult> {
    const client = await this.acquireClient();

    try {
      await client.query('BEGIN');

      const selectText = `
        SELECT * FROM gateway_pairings
        WHERE state_hash = $1
        FOR UPDATE;
      `;
      const { rows } = await client.query(selectText, [stateHash]);

      if (rows.length === 0) {
        await client.query('COMMIT');
        return { ok: false, error: 'STATE_NOT_FOUND' };
      }

      const row = rows[0];
      const now = Date.now();
      const expiresAtMs = new Date(row.expires_at).getTime();

      if (now > expiresAtMs) {
        await client.query('COMMIT');
        return { ok: false, error: 'STATE_EXPIRED' };
      }

      if (row.state_consumed_at !== null) {
        await client.query('COMMIT');
        return { ok: false, error: 'STATE_ALREADY_CONSUMED' };
      }

      // Consome atomicamente o state sem criar conexões placeholder
      const updateText = `
        UPDATE gateway_pairings
        SET state_consumed_at = NOW()
        WHERE pairing_id = $1
        RETURNING *;
      `;
      const updatedRes = await client.query(updateText, [row.pairing_id]);
      await client.query('COMMIT');

      const updatedRecord = this.mapPairingRow(updatedRes.rows[0]);
      return {
        ok: true,
        pairingId: updatedRecord.pairingId,
        clientSessionId: updatedRecord.clientSessionId,
        pairing: updatedRecord
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      return { ok: false, error: `INTERNAL_ERROR: ${err.message}` };
    } finally {
      client.release();
    }
  }

  /**
   * Fase C do Callback: Associa connectionId ao pairingId após troca de tokens bem-sucedida.
   * Não altera state_consumed_at e não torna o state reutilizável.
   */
  async attachConnectionToPairing(pairingId: string, connectionId: string): Promise<boolean> {
    const updateText = `
      UPDATE gateway_pairings
      SET connection_id = $2
      WHERE pairing_id = $1
      RETURNING pairing_id;
    `;
    const res = await this.pool.query(updateText, [pairingId, connectionId]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Fase C Atômica do Callback:
   * Cria a conexão com os tokens já cifrados e associa ao pairing_id em uma ÚNICA transação SQL.
   * Se qualquer etapa falhar ou o pairing já tiver connectionId, dá rollback completo e nenhuma conexão órfã é criada.
   */
  async createConnectionAndAttachPairing(
    conn: BlingConnectionRecord,
    pairingId: string
  ): Promise<boolean> {
    const client = await this.acquireClient();
    try {
      await client.query('BEGIN');

      // 1. Localiza e bloqueia a linha de pareamento no banco
      const checkPairing = await client.query(
        `SELECT * FROM gateway_pairings WHERE pairing_id = $1 FOR UPDATE;`,
        [pairingId]
      );

      if (checkPairing.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const pairingRow = checkPairing.rows[0];
      // Exige que o state tenha sido consumido na Fase A e que o pairing ainda não possua conexão vinculada
      if (pairingRow.state_consumed_at === null || pairingRow.connection_id !== null) {
        await client.query('ROLLBACK');
        return false;
      }

      // 2. Insere a conexão com os tokens já cifrados
      const insertConnText = `
        INSERT INTO bling_connections (
          id,
          status,
          access_token_cipher,
          access_token_iv,
          access_token_tag,
          refresh_token_cipher,
          refresh_token_iv,
          refresh_token_tag,
          key_version,
          expires_at,
          scope,
          account_identifier,
          last_refresh_at,
          refresh_lease_owner,
          refresh_lease_expires_at,
          token_version,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        );
      `;

      await client.query(insertConnText, [
        conn.id,
        conn.status,
        conn.encryptedAccessToken || null,
        conn.accessTokenIv || null,
        conn.accessTokenTag || null,
        conn.encryptedRefreshToken || null,
        conn.refreshTokenIv || null,
        conn.refreshTokenTag || null,
        conn.keyVersion || 'v1',
        conn.tokenExpiresAt || null,
        conn.scope || null,
        conn.accountIdentifier || null,
        conn.lastRefreshAt || null,
        conn.refreshLeaseOwner || null,
        conn.refreshLeaseExpiresAt || null,
        conn.tokenVersion || 1,
        conn.createdAt || new Date().toISOString(),
        conn.updatedAt || new Date().toISOString()
      ]);

      // 3. Associa a conexão ao pairing de forma estrita
      const updatePairingText = `
        UPDATE gateway_pairings
        SET connection_id = $2
        WHERE pairing_id = $1 AND connection_id IS NULL
        RETURNING pairing_id;
      `;
      const updateRes = await client.query(updatePairingText, [pairingId, conn.id]);

      if ((updateRes.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Método composto mantido para compatibilidade: consome state (Fase A) e anexa conexão (Fase C).
   */
  async verifyAndAttachConnectionToPairing(
    stateHash: string,
    connectionId: string
  ): Promise<{
    ok: boolean;
    pairing?: OAuthPairingRequestRecord;
    error?: string;
  }> {
    const consumeRes = await this.consumeOAuthState(stateHash);
    if (!consumeRes.ok || !consumeRes.pairing) {
      return consumeRes;
    }

    // Garante que a conexão existe se for inserida previamente
    await this.pool.query(
      `INSERT INTO bling_connections (id, status, created_at, updated_at)
       VALUES ($1, 'requires_reauth', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING;`,
      [connectionId]
    );

    const attached = await this.attachConnectionToPairing(consumeRes.pairing.pairingId, connectionId);
    if (!attached) {
      return { ok: false, error: 'ATTACH_FAILED' };
    }

    return {
      ok: true,
      pairing: { ...consumeRes.pairing, connectionId }
    };
  }

  /**
   * Handshake de Sessão: validação atômica com timing-safe compare e bloqueio de linha.
   * Concorrência: Duas requisições simultâneas com o mesmo pairingId + pairingSecret:
   * - Apenas uma consegue marcar pairing_consumed_at; a segunda falha com PAIRING_ALREADY_CONSUMED.
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
    const client = await this.acquireClient();

    try {
      await client.query('BEGIN');

      const selectText = `
        SELECT * FROM gateway_pairings
        WHERE pairing_id = $1
        FOR UPDATE;
      `;
      const { rows } = await client.query(selectText, [pairingId]);

      if (rows.length === 0) {
        await client.query('COMMIT');
        return { ok: false, error: 'PAIRING_NOT_FOUND' };
      }

      const row = rows[0];
      const now = Date.now();
      const expiresAtMs = new Date(row.expires_at).getTime();

      if (now > expiresAtMs) {
        await client.query('COMMIT');
        return { ok: false, error: 'PAIRING_EXPIRED' };
      }

      if (row.pairing_consumed_at !== null) {
        await client.query('COMMIT');
        return { ok: false, error: 'PAIRING_ALREADY_CONSUMED' };
      }

      const maxAttempts = 5;
      if (row.attempt_count >= maxAttempts) {
        await client.query('COMMIT');
        return { ok: false, error: 'PAIRING_MAX_ATTEMPTS_EXCEEDED' };
      }

      // Validação em tempo constante do segredo
      const inputSecretHash = hashSecret(pairingSecret);
      const isSecretValid = constantTimeCompare(inputSecretHash, row.pairing_secret_hash);

      if (!isSecretValid) {
        const newAttempts = row.attempt_count + 1;
        await client.query(
          'UPDATE gateway_pairings SET attempt_count = $2 WHERE pairing_id = $1',
          [pairingId, newAttempts]
        );
        await client.query('COMMIT');

        return {
          ok: false,
          error: 'INVALID_PAIRING_SECRET',
          remainingAttempts: Math.max(0, maxAttempts - newAttempts)
        };
      }

      // O fluxo OAuth precisou ser concluído no callback previamente
      if (!row.connection_id) {
        await client.query('COMMIT');
        return { ok: false, error: 'OAUTH_FLOW_NOT_COMPLETED' };
      }

      // Marca o pairing como consumido atomicamente
      const updateText = `
        UPDATE gateway_pairings
        SET pairing_consumed_at = NOW()
        WHERE pairing_id = $1
        RETURNING *;
      `;
      const updatedRes = await client.query(updateText, [pairingId]);
      await client.query('COMMIT');

      return {
        ok: true,
        pairing: this.mapPairingRow(updatedRes.rows[0])
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      return { ok: false, error: `INTERNAL_ERROR: ${err.message}` };
    } finally {
      client.release();
    }
  }

  /**
   * Operação atômica que consome o pairing e cria a sessão + primeiro GRT na MESMA transação PostgreSQL:
   * 1. SELECT gateway_pairings ... FOR UPDATE;
   * 2. Valida TTL, pairing_consumed_at IS NULL, connection_id IS NOT NULL;
   * 3. Validação constante de pairingSecret (preservando attempt_count anti-DoS se inválido);
   * 4. INSERT INTO gateway_sessions;
   * 5. INSERT INTO gateway_refresh_tokens;
   * 6. UPDATE gateway_pairings SET pairing_consumed_at = NOW();
   * 7. COMMIT.
   * Qualquer falha durante o processo resulta em ROLLBACK completo: pairing continua intacto e não consumido.
   */
  async consumePairingAndCreateGatewaySession(
    params: ConsumePairingAndCreateSessionParams
  ): Promise<ConsumePairingAndCreateSessionResult> {
    const client = await this.acquireClient();

    try {
      await client.query('BEGIN');

      const selectText = `
        SELECT * FROM gateway_pairings
        WHERE pairing_id = $1
        FOR UPDATE;
      `;
      const { rows } = await client.query(selectText, [params.pairingId]);

      if (rows.length === 0) {
        await client.query('COMMIT');
        return { ok: false, error: 'PAIRING_NOT_FOUND' };
      }

      const row = rows[0];
      const now = Date.now();
      const expiresAtMs = new Date(row.expires_at).getTime();

      if (now > expiresAtMs) {
        await client.query('COMMIT');
        return { ok: false, error: 'PAIRING_EXPIRED' };
      }

      if (row.pairing_consumed_at !== null) {
        await client.query('COMMIT');
        return { ok: false, error: 'PAIRING_ALREADY_CONSUMED' };
      }

      const maxAttempts = 5;
      if (row.attempt_count >= maxAttempts) {
        await client.query('COMMIT');
        return { ok: false, error: 'PAIRING_MAX_ATTEMPTS_EXCEEDED', remainingAttempts: 0 };
      }

      // Validação em tempo constante do segredo
      const inputSecretHash = hashSecret(params.pairingSecret);
      const isSecretValid = constantTimeCompare(inputSecretHash, row.pairing_secret_hash);

      if (!isSecretValid) {
        const newAttempts = row.attempt_count + 1;
        await client.query(
          'UPDATE gateway_pairings SET attempt_count = $2 WHERE pairing_id = $1',
          [params.pairingId, newAttempts]
        );
        await client.query('COMMIT');

        return {
          ok: false,
          error: 'INVALID_PAIRING_SECRET',
          remainingAttempts: Math.max(0, maxAttempts - newAttempts)
        };
      }

      // O fluxo OAuth precisou ser concluído no callback previamente
      if (!row.connection_id) {
        await client.query('COMMIT');
        return { ok: false, error: 'OAUTH_FLOW_NOT_COMPLETED' };
      }

      // 1. Insere gateway_sessions
      const sessionQuery = `
        INSERT INTO gateway_sessions (
          id, connection_id, client_session_id, revoked_at, created_at
        ) VALUES ($1, $2, $3, NULL, NOW());
      `;
      await client.query(sessionQuery, [
        params.sessionId,
        row.connection_id,
        row.client_session_id
      ]);

      // 2. Insere primeiro gateway_refresh_tokens
      const tokenQuery = `
        INSERT INTO gateway_refresh_tokens (
          id, session_id, family_id, token_hash, used_at, revoked_at, expires_at, created_at
        ) VALUES ($1, $2, $3, $4, NULL, NULL, $5, NOW());
      `;
      await client.query(tokenQuery, [
        randomUUID(),
        params.sessionId,
        params.tokenFamilyId,
        params.refreshTokenHash,
        new Date(params.sessionExpiresAt)
      ]);

      // 3. Marca pairing como consumido atomicamente
      const updateText = `
        UPDATE gateway_pairings
        SET pairing_consumed_at = NOW()
        WHERE pairing_id = $1
        RETURNING *;
      `;
      const updatedRes = await client.query(updateText, [params.pairingId]);
      await client.query('COMMIT');

      return {
        ok: true,
        connectionId: row.connection_id,
        clientSessionId: row.client_session_id,
        pairing: this.mapPairingRow(updatedRes.rows[0])
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Sessões do Gateway & Rotação com Token Family (Reuse Detection)
  // ---------------------------------------------------------------------------

  async createGatewaySession(session: GatewaySessionRecord): Promise<void> {
    const client = await this.acquireClient();
    try {
      await client.query('BEGIN');

      // 1. Insere a sessão principal (falha fechado em colisão)
      const sessionQuery = `
        INSERT INTO gateway_sessions (
          id, connection_id, client_session_id, revoked_at, created_at
        ) VALUES ($1, $2, $3, $4, $5);
      `;
      await client.query(sessionQuery, [
        session.id,
        session.connectionId,
        session.clientSessionId || session.id,
        session.revokedAt ? new Date(session.revokedAt) : null,
        session.createdAt ? new Date(session.createdAt) : new Date()
      ]);

      // 2. Insere o refresh token inicial da família (falha fechado em colisão)
      const tokenQuery = `
        INSERT INTO gateway_refresh_tokens (
          id, session_id, family_id, token_hash, used_at, revoked_at, expires_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
      `;
      await client.query(tokenQuery, [
        randomUUID(),
        session.id,
        session.tokenFamilyId,
        session.refreshTokenHash,
        session.usedAt ? new Date(session.usedAt) : null,
        session.revokedAt ? new Date(session.revokedAt) : null,
        new Date(session.expiresAt),
        session.createdAt ? new Date(session.createdAt) : new Date()
      ]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Rotação de Gateway Refresh Token (GRT) em transação única com bloqueio de linha:
   * 1. Bloqueia linha do token_hash com FOR UPDATE;
   * 2. Se used_at IS NOT NULL: DETECÇÃO DE REUSO -> revoga toda a family_id e a sessão;
   * 3. Se token for inédito e válido: marca used_at = NOW(), cria novo token e comita.
   */
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
    const oldHash = hashSecret(oldRefreshToken);
    const newHash = hashSecret(newRefreshToken);
    const client = await this.acquireClient();

    try {
      await client.query('BEGIN');

      const selectQuery = `
        SELECT grt.*, gs.connection_id, gs.client_session_id
        FROM gateway_refresh_tokens grt
        JOIN gateway_sessions gs ON gs.id = grt.session_id
        WHERE grt.token_hash = $1
        FOR UPDATE OF grt;
      `;
      const { rows } = await client.query(selectQuery, [oldHash]);

      if (rows.length === 0) {
        await client.query('COMMIT');
        return { ok: false, error: 'TOKEN_NOT_FOUND' };
      }

      const tokenRow = rows[0];

      // Já revogado
      if (tokenRow.revoked_at !== null) {
        await client.query('COMMIT');
        return { ok: false, error: 'TOKEN_REVOKED' };
      }

      // Guardrail 2: DETECÇÃO DE REUSO DE REFRESH TOKEN
      if (tokenRow.used_at !== null) {
        // Revoga imediatamente toda a família de tokens e a sessão
        await client.query(
          'UPDATE gateway_refresh_tokens SET revoked_at = NOW() WHERE family_id = $1',
          [tokenRow.family_id]
        );
        await client.query(
          'UPDATE gateway_sessions SET revoked_at = NOW() WHERE id = $1',
          [tokenRow.session_id]
        );
        await client.query('COMMIT');

        return {
          ok: false,
          error: 'TOKEN_REUSE_DETECTED',
          familyRevoked: true
        };
      }

      // Verificação de TTL do token
      const now = Date.now();
      if (now > new Date(tokenRow.expires_at).getTime()) {
        await client.query('COMMIT');
        return { ok: false, error: 'TOKEN_EXPIRED' };
      }

      // Rotação atômica bem-sucedida
      await client.query(
        'UPDATE gateway_refresh_tokens SET used_at = NOW() WHERE id = $1',
        [tokenRow.id]
      );

      const newId = randomUUID();
      const expiresAtDate = new Date(now + expiresInDays * 24 * 60 * 60 * 1000);
      const insertNewToken = `
        INSERT INTO gateway_refresh_tokens (
          id, session_id, family_id, token_hash, used_at, revoked_at, expires_at, created_at
        ) VALUES ($1, $2, $3, $4, NULL, NULL, $5, NOW())
        RETURNING *;
      `;
      await client.query(insertNewToken, [
        newId,
        tokenRow.session_id,
        tokenRow.family_id,
        newHash,
        expiresAtDate
      ]);

      await client.query('COMMIT');

      const sessionRecord: GatewaySessionRecord = {
        id: tokenRow.session_id,
        connectionId: tokenRow.connection_id,
        clientSessionId: tokenRow.client_session_id,
        tokenFamilyId: tokenRow.family_id,
        refreshTokenHash: newHash,
        expiresAt: expiresAtDate.toISOString(),
        createdAt: new Date(tokenRow.created_at).toISOString()
      };

      return {
        ok: true,
        newSession: sessionRecord
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      return { ok: false, error: `ROTATION_ERROR: ${err.message}` };
    } finally {
      client.release();
    }
  }

  async revokeSessionFamily(tokenFamilyId: string): Promise<void> {
    const client = await this.acquireClient();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE gateway_refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL',
        [tokenFamilyId]
      );
      await client.query(
        `UPDATE gateway_sessions
         SET revoked_at = NOW()
         WHERE id IN (SELECT session_id FROM gateway_refresh_tokens WHERE family_id = $1)
           AND revoked_at IS NULL`,
        [tokenFamilyId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSessionByRefreshHash(refreshHash: string): Promise<GatewaySessionRecord | undefined> {
    const queryText = `
      SELECT grt.*, gs.connection_id, gs.client_session_id, gs.created_at as session_created_at
      FROM gateway_refresh_tokens grt
      JOIN gateway_sessions gs ON gs.id = grt.session_id
      WHERE grt.token_hash = $1;
    `;
    const { rows } = await this.pool.query(queryText, [refreshHash]);
    if (rows.length === 0) return undefined;

    const row = rows[0];
    return {
      id: row.session_id,
      connectionId: row.connection_id,
      clientSessionId: row.client_session_id,
      tokenFamilyId: row.family_id,
      refreshTokenHash: row.token_hash,
      expiresAt: new Date(row.expires_at).toISOString(),
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : undefined,
      usedAt: row.used_at ? new Date(row.used_at).toISOString() : undefined,
      createdAt: new Date(row.session_created_at).toISOString()
    };
  }

  async getSession(sessionId: string): Promise<GatewaySessionRecord | undefined> {
    const queryText = `
      SELECT * FROM gateway_sessions WHERE id = $1;
    `;
    const { rows } = await this.pool.query(queryText, [sessionId]);
    if (rows.length === 0) return undefined;

    const row = rows[0];
    return {
      id: row.id,
      connectionId: row.connection_id,
      clientSessionId: row.client_session_id,
      tokenFamilyId: row.token_family_id || '',
      refreshTokenHash: '',
      expiresAt: '',
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Coordenação de Refresh Distribuído Bling (Padrão Lease/Claim)
  // ---------------------------------------------------------------------------

  /**
   * Tenta adquirir o lease de renovação de tokens para a conexão Bling.
   * Concorrência: Condição atômica UPDATE ... WHERE ... RETURNING garante que
   * apenas uma instância adquire o lease.
   */
  async acquireRefreshLease(
    connectionId: string,
    ownerId: string,
    durationMs: number = 15000
  ): Promise<RefreshLeaseAcquireResult> {
    const queryText = `
      UPDATE bling_connections
      SET refresh_lease_owner = $2,
          refresh_lease_expires_at = NOW() + ($3 || ' milliseconds')::INTERVAL,
          updated_at = NOW()
      WHERE id = $1
        AND (
          refresh_lease_owner IS NULL
          OR refresh_lease_expires_at < NOW()
          OR refresh_lease_owner = $2
        )
      RETURNING token_version, refresh_lease_owner;
    `;

    const { rows } = await this.pool.query(queryText, [connectionId, ownerId, durationMs]);

    if (rows.length > 0) {
      return {
        acquired: true,
        tokenVersion: rows[0].token_version,
        currentOwner: rows[0].refresh_lease_owner
      };
    }

    // Não adquiriu: consulta o proprietário e a versão atuais
    const currentRes = await this.pool.query(
      'SELECT token_version, refresh_lease_owner FROM bling_connections WHERE id = $1',
      [connectionId]
    );

    return {
      acquired: false,
      tokenVersion: currentRes.rows[0]?.token_version ?? 1,
      currentOwner: currentRes.rows[0]?.refresh_lease_owner || undefined
    };
  }

  /**
   * Estende a validade do lease ativo (Heartbeat) antes que ele expire durante operações longas.
   */
  async extendRefreshLease(
    connectionId: string,
    ownerId: string,
    durationMs: number = 15000
  ): Promise<boolean> {
    const queryText = `
      UPDATE bling_connections
      SET refresh_lease_expires_at = NOW() + ($3 || ' milliseconds')::INTERVAL,
          updated_at = NOW()
      WHERE id = $1 AND refresh_lease_owner = $2
      RETURNING id;
    `;
    const res = await this.pool.query(queryText, [connectionId, ownerId, durationMs]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Libera o lease de refresh adquirido. Opcionalmente incrementa token_version se o refresh foi concluído.
   */
  async releaseRefreshLease(
    connectionId: string,
    ownerId: string,
    options: { incrementVersion?: boolean } = {}
  ): Promise<boolean> {
    const increment = options.incrementVersion === true;
    const queryText = `
      UPDATE bling_connections
      SET refresh_lease_owner = NULL,
          refresh_lease_expires_at = NULL,
          token_version = CASE WHEN $3 = TRUE THEN token_version + 1 ELSE token_version END,
          updated_at = NOW()
      WHERE id = $1 AND refresh_lease_owner = $2;
    `;
    const res = await this.pool.query(queryText, [connectionId, ownerId, increment]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Atualização final atômica com Fencing Token:
   * Grava os novos tokens e incrementa token_version APENAS se o worker ainda for o proprietário
   * do lease e se token_version for o esperado. Descarta gravações obsoletas (stale writes).
   */
  async updateTokensWithFencing(
    connectionId: string,
    ownerId: string,
    expectedVersion: number,
    updateData: RefreshTokensUpdateData
  ): Promise<{ success: boolean; newTokenVersion?: number }> {
    const queryText = `
      UPDATE bling_connections
      SET access_token_cipher = $1,
          access_token_iv = $2,
          access_token_tag = $3,
          refresh_token_cipher = $4,
          refresh_token_iv = $5,
          refresh_token_tag = $6,
          expires_at = $7,
          scope = COALESCE($8, scope),
          key_version = COALESCE($9, key_version),
          token_version = token_version + 1,
          refresh_lease_owner = NULL,
          refresh_lease_expires_at = NULL,
          last_refresh_at = NOW(),
          updated_at = NOW()
      WHERE id = $10
        AND refresh_lease_owner = $11
        AND token_version = $12
      RETURNING token_version;
    `;

    const res = await this.pool.query(queryText, [
      updateData.encryptedAccessToken,
      updateData.accessTokenIv,
      updateData.accessTokenTag,
      updateData.encryptedRefreshToken,
      updateData.refreshTokenIv,
      updateData.refreshTokenTag,
      updateData.tokenExpiresAt,
      updateData.scope || null,
      updateData.keyVersion || 'v1',
      connectionId,
      ownerId,
      expectedVersion
    ]);

    if ((res.rowCount ?? 0) > 0) {
      return { success: true, newTokenVersion: res.rows[0].token_version };
    }
    return { success: false };
  }

  async disconnect(connectionId: string): Promise<void> {
    return this.deleteConnection(connectionId);
  }

  async getRefreshLeaseState(connectionId: string): Promise<RefreshLeaseState> {
    const { rows } = await this.pool.query(
      `SELECT refresh_lease_owner,
              refresh_lease_expires_at,
              token_version,
              refresh_lease_owner IS NOT NULL
                AND refresh_lease_expires_at > NOW() AS is_leased
       FROM bling_connections
       WHERE id = $1`,
      [connectionId]
    );
    if (rows.length === 0) {
      return { isLeased: false, tokenVersion: 1 };
    }
    const row = rows[0];

    return {
      isLeased: row.is_leased === true,
      leaseOwner: row.refresh_lease_owner,
      leaseExpiresAt: row.refresh_lease_expires_at ? new Date(row.refresh_lease_expires_at).toISOString() : null,
      tokenVersion: row.token_version ?? 1
    };
  }

  async getConnectionTokenVersion(connectionId: string): Promise<number | undefined> {
    const { rows } = await this.pool.query(
      'SELECT token_version FROM bling_connections WHERE id = $1',
      [connectionId]
    );
    return rows[0]?.token_version;
  }

  // ---------------------------------------------------------------------------
  // 5. Limpeza e Reset
  // ---------------------------------------------------------------------------

  async cleanupExpired(): Promise<{ pairingsRemoved: number; sessionsRemoved: number }> {
    const pairingsRes = await this.pool.query(
      'DELETE FROM gateway_pairings WHERE expires_at < NOW() OR pairing_consumed_at IS NOT NULL'
    );
    const sessionsRes = await this.pool.query(
      `DELETE FROM gateway_refresh_tokens
       WHERE expires_at < NOW()
          OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day')`
    );

    return {
      pairingsRemoved: pairingsRes.rowCount || 0,
      sessionsRemoved: sessionsRes.rowCount || 0
    };
  }

  async clearAll(): Promise<void> {
    await this.pool.query(`
      TRUNCATE TABLE gateway_refresh_tokens, gateway_sessions, gateway_pairings, bling_connections CASCADE;
    `);
  }

  // ---------------------------------------------------------------------------
  // Utilitários de Mapeamento Linha -> Objeto de Domínio
  // ---------------------------------------------------------------------------

  private mapConnectionRow(row: any): BlingConnectionRecord {
    return {
      id: row.id,
      status: row.status,
      encryptedAccessToken: row.access_token_cipher,
      accessTokenIv: row.access_token_iv,
      accessTokenTag: row.access_token_tag,
      encryptedRefreshToken: row.refresh_token_cipher,
      refreshTokenIv: row.refresh_token_iv,
      refreshTokenTag: row.refresh_token_tag,
      keyVersion: row.key_version,
      tokenExpiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      scope: row.scope,
      accountIdentifier: row.account_identifier,
      lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at).toISOString() : null,
      refreshLeaseOwner: row.refresh_lease_owner,
      refreshLeaseExpiresAt: row.refresh_lease_expires_at ? new Date(row.refresh_lease_expires_at).toISOString() : null,
      tokenVersion: row.token_version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  private mapPairingRow(row: any): OAuthPairingRequestRecord {
    return {
      pairingId: row.pairing_id,
      clientSessionId: row.client_session_id,
      stateHash: row.state_hash,
      pairingSecretHash: row.pairing_secret_hash,
      connectionId: row.connection_id,
      attemptCount: row.attempt_count,
      failedAttempts: row.attempt_count,
      consumed: row.pairing_consumed_at !== null,
      stateConsumedAt: row.state_consumed_at ? new Date(row.state_consumed_at).toISOString() : null,
      pairingConsumedAt: row.pairing_consumed_at ? new Date(row.pairing_consumed_at).toISOString() : null,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString()
    };
  }
}
