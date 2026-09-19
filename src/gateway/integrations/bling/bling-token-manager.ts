// Gerenciador de Tokens e Execução Autenticada Bling com Fencing/Heartbeat (Fase 4C.2B)
import { randomUUID } from 'node:crypto';
import { encryptPayload, decryptPayload } from '../../crypto/aes-gcm.ts';
import { gatewayLogger } from '../../security/logger.ts';
import type { IGatewayRepository } from '../../database/repository.ts';
import { BlingOAuthClient, BlingOAuthError } from './bling-oauth-client.ts';
import type { BlingConnectionRecord } from '../../types/contracts.ts';

export interface BlingTokenManagerOptions {
  repository: IGatewayRepository;
  oauthClient: BlingOAuthClient;
  encryptionKey: Buffer;
  leaseTtlMs?: number;        // Default: 15000ms
  heartbeatIntervalMs?: number; // Default: 5000ms
  refreshThresholdSeconds?: number; // Default: 300s (5 minutos antes de expirar)
}

export class BlingReauthRequiredError extends Error {
  constructor(message: string = 'A conexão com o Bling requer reautenticação.') {
    super(message);
    this.name = 'BlingReauthRequiredError';
    Object.setPrototypeOf(this, BlingReauthRequiredError.prototype);
  }
}

export class BlingTokenManager {
  private repository: IGatewayRepository;
  private oauthClient: BlingOAuthClient;
  private encryptionKey: Buffer;
  private leaseTtlMs: number;
  private heartbeatIntervalMs: number;
  private refreshThresholdSeconds: number;

  constructor(options: BlingTokenManagerOptions) {
    this.repository = options.repository;
    this.oauthClient = options.oauthClient;
    this.encryptionKey = options.encryptionKey;
    this.leaseTtlMs = options.leaseTtlMs || 15000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 5000;
    this.refreshThresholdSeconds = options.refreshThresholdSeconds || 300;
  }

  /**
   * Garante que um Access Token válido esteja disponível para a conexão informada.
   * Se o token estiver próximo da expiração ou se forceRefresh for true, coordena o refresh via lease.
   */
  async ensureValidAccessToken(
    connectionId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<string> {
    const conn = await this.repository.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Conexão ${connectionId} não encontrada.`);
    }

    if (conn.status === 'disconnected') {
      throw new BlingReauthRequiredError(`Conexão ${connectionId} está desconectada.`);
    }

    if (conn.status === 'requires_reauth') {
      throw new BlingReauthRequiredError(`Conexão ${connectionId} requer reautenticação.`);
    }

    const needsRefresh = options.forceRefresh || this.isTokenNearingExpiry(conn);

    if (!needsRefresh) {
      return this.decryptAccessToken(conn);
    }

    // Executa renovação coordenada via lease distribuído
    return this.refreshWithDistributedLease(connectionId);
  }

  /**
   * Helper de execução autenticada resiliente:
   * - Executa action com token válido;
   * - Se retornar 401, força 1 refresh;
   * - Repete a chamada uma única vez;
   * - Se o segundo retorno for 401, marca requires_reauth e interrompe sem loop infinito.
   */
  async executeWithBlingAuth<T>(
    connectionId: string,
    action: (accessToken: string) => Promise<T>
  ): Promise<T> {
    const initialToken = await this.ensureValidAccessToken(connectionId);

    try {
      return await action(initialToken);
    } catch (err: any) {
      const is401 = err?.status === 401 || err?.statusCode === 401 || err?.message?.includes('401');
      if (!is401) {
        throw err;
      }

      gatewayLogger.warn(`[BlingTokenManager] Resposta 401 recebida para conexão ${connectionId}. Tentando auto-refresh.`);

      // Força 1 renovação de token
      let refreshedToken: string;
      try {
        refreshedToken = await this.ensureValidAccessToken(connectionId, { forceRefresh: true });
      } catch (refreshErr) {
        gatewayLogger.error(`[BlingTokenManager] Falha ao renovar token após 401:`, refreshErr);
        throw refreshErr;
      }

      // Repete a requisição exatamente UMA vez
      try {
        return await action(refreshedToken);
      } catch (secondErr: any) {
        const isSecond401 = secondErr?.status === 401 || secondErr?.statusCode === 401 || secondErr?.message?.includes('401');
        if (isSecond401) {
          gatewayLogger.error(`[BlingTokenManager] Segundo 401 persistente na conexão ${connectionId}. Marcando requires_reauth.`);
          await this.repository.updateConnectionStatus(connectionId, 'requires_reauth');
          throw new BlingReauthRequiredError('Credencial do Bling definitivamente rejeitada (segundo 401).');
        }
        throw secondErr;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Algoritmo de Lease Distribuído com Fencing e Heartbeat
  // ---------------------------------------------------------------------------

  private async refreshWithDistributedLease(connectionId: string): Promise<string> {
    const workerId = `worker_${randomUUID().slice(0, 8)}`;
    const leaseRes = await this.repository.acquireRefreshLease(connectionId, workerId, this.leaseTtlMs);

    if (leaseRes.acquired) {
      return this.executeWinnerRefresh(connectionId, workerId, leaseRes.tokenVersion);
    }

    // Instância seguidora: aguarda o worker vencedor concluir
    return this.waitForRefreshedToken(connectionId, leaseRes.tokenVersion);
  }

  private async executeWinnerRefresh(
    connectionId: string,
    workerId: string,
    expectedVersion: number
  ): Promise<string> {
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      // Inicia heartbeat periódico para estender lease durante chamadas longas
      heartbeatTimer = setInterval(async () => {
        try {
          await this.repository.extendRefreshLease(connectionId, workerId, this.leaseTtlMs);
        } catch {
          // Heartbeat silencioso em falha
        }
      }, this.heartbeatIntervalMs);

      const conn = await this.repository.getConnection(connectionId);
      if (!conn || !conn.encryptedRefreshToken || !conn.refreshTokenIv || !conn.refreshTokenTag) {
        throw new BlingReauthRequiredError('Conexão sem refresh token armazenado.');
      }

      const refreshToken = decryptPayload(
        {
          ciphertext: conn.encryptedRefreshToken,
          iv: conn.refreshTokenIv,
          authTag: conn.refreshTokenTag,
          keyVersion: 1
        },
        this.encryptionKey
      );

      // Chamada HTTP externa com timeout de 8s (menor que o lease de 15s) e FORA de transação SQL
      const tokenResponse = await this.oauthClient.refreshTokens(refreshToken);

      // Criptografa novos tokens com AES-256-GCM
      const encAccessToken = encryptPayload(tokenResponse.access_token, this.encryptionKey);
      const encRefreshToken = encryptPayload(tokenResponse.refresh_token, this.encryptionKey);

      const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();

      // Gravação atômica com Fencing Token (owner + expectedVersion)
      const fencingRes = await this.repository.updateTokensWithFencing(
        connectionId,
        workerId,
        expectedVersion,
        {
          encryptedAccessToken: encAccessToken.ciphertext,
          accessTokenIv: encAccessToken.iv,
          accessTokenTag: encAccessToken.authTag,
          encryptedRefreshToken: encRefreshToken.ciphertext,
          refreshTokenIv: encRefreshToken.iv,
          refreshTokenTag: encRefreshToken.authTag,
          tokenExpiresAt,
          scope: tokenResponse.scope,
          keyVersion: 'v1'
        }
      );

      if (fencingRes.success) {
        gatewayLogger.info(`[BlingTokenManager] Refresh concluído com sucesso. Nova token_version: ${fencingRes.newTokenVersion}`);
        return tokenResponse.access_token;
      }

      // Se perdeu fencing: outro worker tomou o lease ou a versão avançou
      gatewayLogger.warn(`[BlingTokenManager] Worker ${workerId} perdeu fencing para conexão ${connectionId}. Descartando gravação stale.`);
      const updatedConn = await this.repository.getConnection(connectionId);
      if (!updatedConn) {
        throw new Error('Conexão não encontrada após perda de fencing.');
      }
      return this.decryptAccessToken(updatedConn);
    } catch (err: any) {
      // Classificação semântica do erro
      if (err instanceof BlingOAuthError && err.requiresReauth) {
        gatewayLogger.error(`[BlingTokenManager] Refresh token definitivamente inválido. Marcando requires_reauth.`);
        await this.repository.updateConnectionStatus(connectionId, 'requires_reauth');
        await this.repository.releaseRefreshLease(connectionId, workerId);
        throw new BlingReauthRequiredError(err.message);
      }

      // Erros transitórios (timeout, 429, 5xx, rede): libera lease preservando conexão e tokens atuais
      gatewayLogger.warn(`[BlingTokenManager] Erro transitório durante refresh no Bling. Preservando conexão: ${err.message}`);
      await this.repository.releaseRefreshLease(connectionId, workerId);
      throw err;
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
  }

  private async waitForRefreshedToken(
    connectionId: string,
    initialVersion: number,
    timeoutMs: number = 10000
  ): Promise<string> {
    const startTime = Date.now();
    const pollInterval = 250;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const currentVersion = await this.repository.getConnectionTokenVersion(connectionId);
      if (currentVersion && currentVersion > initialVersion) {
        // Vencedor atualizou os tokens
        const updatedConn = await this.repository.getConnection(connectionId);
        if (updatedConn) {
          return this.decryptAccessToken(updatedConn);
        }
      }

      const leaseState = await this.repository.getRefreshLeaseState(connectionId);
      if (!leaseState.isLeased) {
        // Lease do vencedor expirou ou foi liberado: tenta adquirir
        return this.refreshWithDistributedLease(connectionId);
      }
    }

    throw new Error(`Timeout aguardando refresh concorrente na conexão ${connectionId}.`);
  }

  private isTokenNearingExpiry(conn: BlingConnectionRecord): boolean {
    if (!conn.tokenExpiresAt) return true;
    const expiresAt = new Date(conn.tokenExpiresAt).getTime();
    const now = Date.now();
    const thresholdMs = this.refreshThresholdSeconds * 1000;
    return expiresAt - now < thresholdMs;
  }

  private decryptAccessToken(conn: BlingConnectionRecord): string {
    if (!conn.encryptedAccessToken || !conn.accessTokenIv || !conn.accessTokenTag) {
      throw new BlingReauthRequiredError('Conexão sem tokens de acesso válidos.');
    }

    return decryptPayload(
      {
        ciphertext: conn.encryptedAccessToken,
        iv: conn.accessTokenIv,
        authTag: conn.accessTokenTag,
        keyVersion: 1
      },
      this.encryptionKey
    );
  }
}
