// Aplicação HTTP do Integration Gateway (Fase 4C.1 e Fase 4C.2B)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadGatewayConfig, type GatewayConfig } from '../config.ts';
import {
  generateOAuthState,
  generatePairingId,
  generatePairingSecret,
  generateGatewayRefreshToken,
  hashSecret,
  createGatewaySessionToken,
  verifyGatewaySessionToken
} from '../crypto/pairing-state.ts';
import { encryptPayload, decryptPayload } from '../crypto/aes-gcm.ts';
import { gatewayRepository, type IGatewayRepository } from '../database/repository.ts';
import { sessionHandshakeLimiter, startAuthLimiter } from '../security/rate-limiter.ts';
import { gatewayLogger } from '../security/logger.ts';
import { BlingOAuthClient } from '../integrations/bling/bling-oauth-client.ts';
import { BlingTokenManager } from '../integrations/bling/bling-token-manager.ts';
import type {
  OAuthPairingRequestRecord,
  BlingConnectionRecord,
  BlingStatusResponse,
  DisconnectResponse,
  RefreshSessionResponse
} from '../types/contracts.ts';

export interface GatewayAppOptions {
  config?: GatewayConfig;
  repository?: IGatewayRepository;
  oauthClient?: BlingOAuthClient;
  tokenManager?: BlingTokenManager;
}

export class GatewayApp {
  private config: GatewayConfig;
  private repository: IGatewayRepository;
  private oauthClient: BlingOAuthClient;
  private tokenManager: BlingTokenManager;

  constructor(options: GatewayAppOptions = {}) {
    this.config = options.config || loadGatewayConfig();
    this.repository = options.repository || gatewayRepository;
    this.oauthClient = options.oauthClient || new BlingOAuthClient({
      clientId: this.config.blingClientId,
      clientSecret: this.config.blingClientSecret,
      redirectUri: this.config.blingRedirectUri,
      baseUrl: this.config.blingBaseUrl,
      authUrl: this.config.blingAuthUrl,
      timeoutMs: this.config.blingTimeoutMs
    });
    this.tokenManager = options.tokenManager || new BlingTokenManager({
      repository: this.repository,
      oauthClient: this.oauthClient,
      encryptionKey: this.config.encryptionKey
    });
  }

  getBlingTokenManager(): BlingTokenManager {
    return this.tokenManager;
  }

  getBlingOAuthClient(): BlingOAuthClient {
    return this.oauthClient;
  }

  /**
   * Ponto de entrada para processamento de requisições HTTP do Node.js.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() || 'GET';
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';

    // CORS defensivo (permite apenas extensões e localhost em desenvolvimento)
    const origin = req.headers.origin;
    if (origin) {
      if (origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost:')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, enable-jwt');
      }
    }

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 1. GET /health
      if (method === 'GET' && pathname === '/health') {
        this.sendJson(res, 200, {
          status: 'ok',
          environment: this.config.environment,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // 2. POST /auth/bling/start
      if (method === 'POST' && pathname === '/auth/bling/start') {
        await this.handleStartAuth(req, res, clientIp);
        return;
      }

      // 3. POST /auth/bling/session (Handshake com pairingSecret)
      if (method === 'POST' && pathname === '/auth/bling/session') {
        await this.handleSessionHandshake(req, res, clientIp);
        return;
      }

      // 4. GET /auth/bling/callback (Callback OAuth com headers seguros)
      if (method === 'GET' && pathname === '/auth/bling/callback') {
        await this.handleOAuthCallback(parsedUrl, res);
        return;
      }

      // 5. POST /auth/session/refresh (Renovação da sessão Gateway via GRT)
      if (method === 'POST' && pathname === '/auth/session/refresh') {
        await this.handleSessionRefresh(req, res, clientIp);
        return;
      }

      // 6. GET /integrations/bling/status (Consulta de status autenticada por GST)
      if (method === 'GET' && pathname === '/integrations/bling/status') {
        await this.handleBlingStatus(req, res);
        return;
      }

      // 7. DELETE /integrations/bling (Desconexão com revogação remota e purga local)
      if (method === 'DELETE' && pathname === '/integrations/bling') {
        await this.handleBlingDisconnect(req, res);
        return;
      }

      // Rota não encontrada
      this.sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (err: any) {
      gatewayLogger.error('Erro interno ao processar requisição:', err?.message || err);
      this.sendJson(res, 500, { ok: false, error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  // ---------------------------------------------------------------------------
  // Handlers dos Endpoints
  // ---------------------------------------------------------------------------

  private async handleStartAuth(req: IncomingMessage, res: ServerResponse, clientIp: string): Promise<void> {
    const rateCheck = startAuthLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      this.sendJson(res, 429, {
        ok: false,
        error: 'RATE_LIMITED',
        message: 'Muitas tentativas de autorização. Aguarde antes de tentar novamente.',
        retryAfterMs: rateCheck.resetInMs
      });
      return;
    }

    const body = await this.readJsonBody(req);
    const clientSessionId = typeof body?.clientSessionId === 'string' ? body.clientSessionId.trim() : '';

    if (!clientSessionId || clientSessionId.length < 16) {
      this.sendJson(res, 400, {
        ok: false,
        error: 'INVALID_CLIENT_SESSION_ID',
        message: 'clientSessionId válido e com entropia suficiente é obrigatório.'
      });
      return;
    }

    // Geração criptográfica
    const state = generateOAuthState();
    const pairingId = generatePairingId();
    const pairingSecret = generatePairingSecret();

    const stateHash = hashSecret(state);
    const pairingSecretHash = hashSecret(pairingSecret);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.pairingTtlSeconds * 1000).toISOString();

    const record: OAuthPairingRequestRecord = {
      pairingId,
      clientSessionId,
      pairingSecretHash,
      stateHash,
      attemptCount: 0,
      expiresAt,
      createdAt: now.toISOString()
    };

    await this.repository.savePairingRequest(record);

    // Monta URL oficial de consentimento do Bling via client
    const authorizationUrl = this.oauthClient.buildAuthorizationUrl(state);

    this.sendJson(res, 200, {
      ok: true,
      authorizationUrl,
      pairingId,
      pairingSecret,
      expiresInSeconds: this.config.pairingTtlSeconds
    });
  }

  private async handleSessionHandshake(req: IncomingMessage, res: ServerResponse, clientIp: string): Promise<void> {
    const rateCheck = sessionHandshakeLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      this.sendJson(res, 429, {
        ok: false,
        error: 'RATE_LIMITED',
        message: 'Muitas tentativas de handshake. Aguarde antes de tentar novamente.',
        retryAfterMs: rateCheck.resetInMs
      });
      return;
    }

    const body = await this.readJsonBody(req);
    const pairingId = typeof body?.pairingId === 'string' ? body.pairingId.trim() : '';
    const pairingSecret = typeof body?.pairingSecret === 'string' ? body.pairingSecret.trim() : '';

    if (!pairingId || !pairingSecret) {
      this.sendJson(res, 400, {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'pairingId e pairingSecret são obrigatórios.'
      });
      return;
    }

    const sessionId = randomUUID();
    const tokenFamilyId = randomUUID();
    const gatewayRefreshToken = generateGatewayRefreshToken();
    const refreshTokenHash = hashSecret(gatewayRefreshToken);

    const now = Date.now();
    const sessionExpiresAt = new Date(now + this.config.sessionRefreshTtlDays * 24 * 60 * 60 * 1000).toISOString();

    const result = await this.repository.consumePairingAndCreateGatewaySession({
      pairingId,
      pairingSecret,
      sessionId,
      tokenFamilyId,
      refreshTokenHash,
      sessionExpiresAt
    });

    if (!result.ok) {
      if (result.error === 'INVALID_PAIRING_SECRET') {
        this.sendJson(res, 401, {
          ok: false,
          error: 'INVALID_PAIRING_SECRET',
          message: 'Segredo de pareamento inválido.',
          remainingAttempts: result.remainingAttempts
        });
        return;
      }
      if (result.error === 'PAIRING_MAX_ATTEMPTS_EXCEEDED') {
        this.sendJson(res, 429, {
          ok: false,
          error: 'PAIRING_MAX_ATTEMPTS_EXCEEDED',
          message: 'Limite máximo de tentativas excedido para este pareamento.'
        });
        return;
      }
      if (result.error === 'PAIRING_EXPIRED') {
        this.sendJson(res, 410, {
          ok: false,
          error: 'PAIRING_EXPIRED',
          message: 'O pareamento expirou. Inicie um novo fluxo de conexão.'
        });
        return;
      }
      if (result.error === 'PAIRING_ALREADY_CONSUMED') {
        this.sendJson(res, 409, {
          ok: false,
          error: 'PAIRING_ALREADY_CONSUMED',
          message: 'Este pareamento já foi consumido anteriormente.'
        });
        return;
      }
      if (result.error === 'OAUTH_FLOW_NOT_COMPLETED') {
        this.sendJson(res, 400, {
          ok: false,
          error: 'OAUTH_FLOW_NOT_COMPLETED',
          message: 'O fluxo de autorização no Bling ainda não foi concluído na janela do navegador.'
        });
        return;
      }

      this.sendJson(res, 404, { ok: false, error: 'PAIRING_NOT_FOUND' });
      return;
    }

    const connectionId = result.connectionId!;
    const clientSessionId = result.clientSessionId || '';

    // Emissão do Gateway Session Token (GST) de curta duração (estrito 15 minutos / 900s)
    const gatewaySessionToken = createGatewaySessionToken(
      { connectionId, clientSessionId, sessionId },
      this.config.jwtSecret,
      this.config.gstTtlSeconds
    );

    gatewayLogger.info(`Sessão do Gateway emitida com sucesso para conexão ${connectionId}`);

    this.sendJson(res, 200, {
      ok: true,
      status: 'connected',
      gatewaySessionToken,
      gatewayRefreshToken,
      expiresInSeconds: this.config.gstTtlSeconds
    });
  }

  private async handleSessionRefresh(req: IncomingMessage, res: ServerResponse, clientIp: string): Promise<void> {
    const rateCheck = sessionHandshakeLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      this.sendJson(res, 429, {
        ok: false,
        error: 'RATE_LIMITED',
        message: 'Muitas tentativas de renovação de sessão.',
        retryAfterMs: rateCheck.resetInMs
      });
      return;
    }

    // Lê corpo JSON sem jamais logar o request body sensível
    const body = await this.readJsonBody(req);
    const gatewayRefreshToken = typeof body?.gatewayRefreshToken === 'string' ? body.gatewayRefreshToken.trim() : '';

    if (!gatewayRefreshToken) {
      this.sendJson(res, 400, {
        ok: false,
        error: 'MISSING_GATEWAY_REFRESH_TOKEN',
        message: 'gatewayRefreshToken é obrigatório no corpo da requisição.'
      });
      return;
    }

    const newRefreshToken = generateGatewayRefreshToken();
    const rotateResult = await this.repository.rotateGatewaySession(
      gatewayRefreshToken,
      newRefreshToken,
      this.config.sessionRefreshTtlDays
    );

    if (!rotateResult.ok) {
      if (rotateResult.familyRevoked) {
        gatewayLogger.warn('[GatewayHttpApp] Detecção de reuso de GRT! Família de sessões revogada imediatamente.');
        this.sendJson(res, 401, {
          ok: false,
          error: 'TOKEN_REUSE_DETECTED',
          message: 'Token de refresh já utilizado. Toda a família de sessões foi revogada por segurança.'
        });
        return;
      }

      if (rotateResult.error === 'SESSION_EXPIRED') {
        this.sendJson(res, 401, {
          ok: false,
          error: 'SESSION_EXPIRED',
          message: 'A sessão do Gateway expirou. Novo pareamento é necessário.'
        });
        return;
      }

      this.sendJson(res, 401, {
        ok: false,
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Token de refresh inválido ou inexistente.'
      });
      return;
    }

    const newSession = rotateResult.newSession!;
    const gatewaySessionToken = createGatewaySessionToken(
      { connectionId: newSession.connectionId, clientSessionId: newSession.clientSessionId || '', sessionId: newSession.id },
      this.config.jwtSecret,
      this.config.gstTtlSeconds
    );

    const responseData: RefreshSessionResponse = {
      ok: true,
      gatewaySessionToken,
      gatewayRefreshToken: newRefreshToken,
      expiresInSeconds: this.config.gstTtlSeconds
    };

    this.sendJson(res, 200, responseData);
  }

  private async handleOAuthCallback(parsedUrl: URL, res: ServerResponse): Promise<void> {
    // Registra entrada do callback sem incluir a query string ou segredos em logs
    gatewayLogger.info('[GatewayHttpApp] Processando requisição de callback OAuth');

    const code = parsedUrl.searchParams.get('code');
    const state = parsedUrl.searchParams.get('state');

    // Headers HTTP estritos de segurança
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline';");
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (!code || !state) {
      res.writeHead(400);
      res.end(this.renderErrorHtml('Falha na Autorização', 'Parâmetros de retorno ausentes ou inválidos. Feche esta janela e tente novamente pela extensão.'));
      return;
    }

    const stateHash = hashSecret(state);

    // Fase A: Consumo atômico do state OAuth (transação curta no PostgreSQL sem chamada de rede)
    const consumeResult = await this.repository.consumeOAuthState(stateHash);

    if (!consumeResult.ok || !consumeResult.pairing) {
      res.writeHead(400);
      res.end(this.renderErrorHtml('Sessão Expirada ou Inválida', 'O estado desta autorização expirou, é inválido ou já foi utilizado. Inicie uma nova conexão pela extensão.'));
      return;
    }

    // Fase B: Troca HTTP externa no endpoint /Api/v3/oauth/token do Bling (FORA de qualquer transação de banco)
    let tokenResponse;
    try {
      tokenResponse = await this.oauthClient.exchangeCodeForTokens(code);
    } catch (tokenErr: any) {
      gatewayLogger.warn('[GatewayHttpApp] Falha na troca do code por tokens no Bling');
      res.writeHead(400);
      res.end(this.renderErrorHtml('Falha na Autorização', 'Não foi possível concluir a autorização junto ao Bling. Por favor, feche esta janela e inicie um novo pareamento pela extensão.'));
      return;
    }

    // Fase C: Criação da conexão com tokens cifrados e associação atômica ao pairing
    const encAccessToken = encryptPayload(tokenResponse.access_token, this.config.encryptionKey);
    const encRefreshToken = encryptPayload(tokenResponse.refresh_token, this.config.encryptionKey);
    const connectionId = `conn_${randomUUID()}`;
    const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();

    const connectionRecord: BlingConnectionRecord = {
      id: connectionId,
      clientSessionId: consumeResult.clientSessionId || consumeResult.pairing.clientSessionId,
      status: 'connected',
      encryptedAccessToken: encAccessToken.ciphertext,
      accessTokenIv: encAccessToken.iv,
      accessTokenTag: encAccessToken.authTag,
      encryptedRefreshToken: encRefreshToken.ciphertext,
      refreshTokenIv: encRefreshToken.iv,
      refreshTokenTag: encRefreshToken.authTag,
      keyVersion: 'v1',
      tokenExpiresAt,
      scope: tokenResponse.scope,
      tokenVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const attached = await this.repository.createConnectionAndAttachPairing(
      connectionRecord,
      consumeResult.pairing.pairingId
    );

    if (!attached) {
      gatewayLogger.error('[GatewayHttpApp] Falha ao persistir conexão e vincular pairing atomicamente na Fase C.');
      res.writeHead(500);
      res.end(this.renderErrorHtml('Erro de Vinculação', 'Falha ao concluir a vinculação da conta. Feche esta janela e tente novamente.'));
      return;
    }

    // HTML de sucesso limpo e seguro: NUNCA reflete code, state, access_token ou segredos
    res.writeHead(200);
    res.end(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>Paulifest Copilot • Autorização Concluída</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: white; padding: 32px 40px; border-radius: 18px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); text-align: center; max-width: 400px; }
          .icon { width: 56px; height: 56px; background: #34c759; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 20px; }
          h2 { font-size: 20px; font-weight: 600; margin: 0 0 10px; color: #1d1d1f; }
          p { font-size: 14px; color: #86868b; line-height: 1.5; margin: 0 0 24px; }
          .badge { display: inline-block; background: #e8f5e9; color: #2e7d32; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 12px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✓</div>
          <h2>Conexão Concluída</h2>
          <p>Sua conta do Bling foi autorizada com sucesso. Você pode fechar esta aba e retornar à extensão.</p>
          <div class="badge">Pronto para uso</div>
        </div>
      </body>
      </html>
    `);
  }

  private async handleBlingStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = await this.authenticateWithGst(req, res);
    if (!auth) return;

    const conn = await this.repository.getConnection(auth.connectionId);
    if (!conn) {
      this.sendJson(res, 404, { ok: false, error: 'CONNECTION_NOT_FOUND', message: 'Conexão não encontrada.' });
      return;
    }

    // Minimização estrita: expõe apenas estado operacional sem vazar tokens decodificados ou claims do Bling
    const statusData: BlingStatusResponse = {
      ok: true,
      connected: conn.status === 'connected',
      status: conn.status,
      requiresReauth: conn.status === 'requires_reauth',
      lastRefreshAt: conn.lastRefreshAt || null
    };

    this.sendJson(res, 200, statusData);
  }

  private async handleBlingDisconnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = await this.authenticateWithGst(req, res);
    if (!auth) return;

    const conn = await this.repository.getConnection(auth.connectionId);

    // Tentativa prévia de revogação remota oficial no Bling para access e refresh token (best-effort)
    let accessStatus: 'success' | 'failed' | 'not_available' = 'not_available';
    let refreshStatus: 'success' | 'failed' | 'not_available' = 'not_available';

    if (conn) {
      // 1. Tenta revogar o access token
      if (conn.encryptedAccessToken && conn.accessTokenIv && conn.accessTokenTag) {
        try {
          const accessToken = decryptPayload(
            {
              ciphertext: conn.encryptedAccessToken,
              iv: conn.accessTokenIv,
              authTag: conn.accessTokenTag,
              keyVersion: 1
            },
            this.config.encryptionKey
          );

          const revokeAccessRes = await this.oauthClient.revokeToken(accessToken, 'access_token');
          accessStatus = revokeAccessRes.success ? 'success' : 'failed';
        } catch (err: any) {
          gatewayLogger.warn(`[GatewayHttpApp] Falha ao tentar revogar access token no Bling: ${err?.message || err}`);
          accessStatus = 'failed';
        }
      }

      // 2. Tenta revogar o refresh token
      if (conn.encryptedRefreshToken && conn.refreshTokenIv && conn.refreshTokenTag) {
        try {
          const refreshToken = decryptPayload(
            {
              ciphertext: conn.encryptedRefreshToken,
              iv: conn.refreshTokenIv,
              authTag: conn.refreshTokenTag,
              keyVersion: 1
            },
            this.config.encryptionKey
          );

          const revokeRefreshRes = await this.oauthClient.revokeToken(refreshToken, 'refresh_token');
          refreshStatus = revokeRefreshRes.success ? 'success' : 'failed';
        } catch (err: any) {
          gatewayLogger.warn(`[GatewayHttpApp] Falha ao tentar revogar refresh token no Bling: ${err?.message || err}`);
          refreshStatus = 'failed';
        }
      }
    }

    // Desconexão e purga LOCAL obrigatória e irrevogável no PostgreSQL SEMPRE
    await this.repository.disconnect(auth.connectionId);

    const availableTokens = [accessStatus, refreshStatus].filter(s => s !== 'not_available');
    const complete = availableTokens.length > 0 && availableTokens.every(s => s === 'success');

    const disconnectData: DisconnectResponse = {
      ok: true,
      status: 'disconnected',
      localDisconnected: true,
      remoteRevocation: {
        accessToken: accessStatus,
        refreshToken: refreshStatus,
        complete
      },
      message: 'Desconexão local concluída e credenciais purgadas com sucesso.'
    };

    this.sendJson(res, 200, disconnectData);
  }

  // ---------------------------------------------------------------------------
  // Utilitários Internos de Autenticação e Resposta
  // ---------------------------------------------------------------------------

  private async authenticateWithGst(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<{ connectionId: string; clientSessionId: string; sessionId?: string } | null> {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.sendJson(res, 401, {
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Token de sessão do Gateway (GST) é obrigatório.'
      });
      return null;
    }

    const token = authHeader.slice(7).trim();
    const verifyRes = verifyGatewaySessionToken(token, this.config.jwtSecret);

    if (!verifyRes.valid || !verifyRes.claims) {
      this.sendJson(res, 401, {
        ok: false,
        error: 'UNAUTHORIZED',
        message: verifyRes.error || 'Token de sessão do Gateway inválido ou expirado.'
      });
      return null;
    }

    // Validação estrita no banco: JWT válido sozinho não basta se a sessão já foi revogada
    if (verifyRes.claims.sessionId) {
      const session = await this.repository.getSession(verifyRes.claims.sessionId);
      if (!session || session.revokedAt) {
        this.sendJson(res, 401, {
          ok: false,
          error: 'SESSION_REVOKED',
          message: 'A sessão do Gateway foi revogada.'
        });
        return null;
      }
    }

    return verifyRes.claims;
  }

  private renderErrorHtml(title: string, message: string): string {
    return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>Erro de Autorização</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff5f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: white; padding: 32px 40px; border-radius: 18px; box-shadow: 0 4px 24px rgba(239,68,68,0.1); text-align: center; max-width: 400px; border: 1px solid #fee2e2; }
          .icon { width: 56px; height: 56px; background: #ef4444; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 20px; }
          h2 { font-size: 20px; font-weight: 600; margin: 0 0 10px; color: #991b1b; }
          p { font-size: 14px; color: #7f1d1d; line-height: 1.5; margin: 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✕</div>
          <h2>${title}</h2>
          <p>${message}</p>
        </div>
      </body>
      </html>
    `;
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(payload);
  }

  private async readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) {
          // Limite defensivo de 64KB no payload JSON
          req.destroy();
          resolve(null);
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  /**
   * Inicializa um servidor HTTP nativo.
   */
  listen(port?: number): Promise<number> {
    const listenPort = port ?? this.config.port;
    const server = createServer((req, res) => this.handleRequest(req, res));
    return new Promise((resolve, reject) => {
      server.listen(listenPort, () => {
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
        gatewayLogger.info(`Gateway Server rodando na porta ${actualPort} [${this.config.environment}]`);
        resolve(actualPort);
      });
      server.on('error', reject);
    });
  }
}
