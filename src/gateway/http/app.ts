// Aplicação HTTP do Integration Gateway (Fase 4C.1 - Security Foundation)
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
  createGatewaySessionToken
} from '../crypto/pairing-state.ts';
import { gatewayRepository, type IGatewayRepository } from '../database/repository.ts';
import { sessionHandshakeLimiter, startAuthLimiter } from '../security/rate-limiter.ts';
import { gatewayLogger } from '../security/logger.ts';
import type {
  OAuthPairingRequestRecord,
  GatewaySessionRecord
} from '../types/contracts.ts';

export interface GatewayAppOptions {
  config?: GatewayConfig;
  repository?: IGatewayRepository;
}

export class GatewayApp {
  private config: GatewayConfig;
  private repository: IGatewayRepository;

  constructor(options: GatewayAppOptions = {}) {
    this.config = options.config || loadGatewayConfig();
    this.repository = options.repository || gatewayRepository;
  }

  /**
   * Ponto de entrada para processamento de requisições HTTP do Node.js.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() || 'GET';
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';

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

      // 4. GET /auth/bling/callback (Guardrail 3 - Headers seguros sem expor segredos)
      if (method === 'GET' && pathname === '/auth/bling/callback') {
        await this.handleOAuthCallback(parsedUrl, res);
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
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt,
      createdAt: now.toISOString()
    };

    await this.repository.savePairingRequest(record);

    // Constrói URL oficial de autorização da API v3 do Bling
    const authorizationUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(
      this.config.blingClientId
    )}&state=${encodeURIComponent(state)}`;

    gatewayLogger.info(`Iniciado pareamento OAuth ${pairingId} para sessão ${clientSessionId}`);

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
        message: 'Muitas tentativas de handshake de sessão. Aguarde.',
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
        error: 'MISSING_CREDENTIALS',
        message: 'pairingId e pairingSecret são obrigatórios.'
      });
      return;
    }

    // Executa validação com Guardrail 1 (sem DoS prematuro, comparando hashes em tempo constante)
    const result = await this.repository.verifyAndConsumePairing(pairingId, pairingSecret);

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

    const pairing = result.pairing!;
    const connectionId = pairing.connectionId!;

    // Emissão do Gateway Session Token (GST) de curta duração (2h)
    const gatewaySessionToken = createGatewaySessionToken(
      { connectionId, clientSessionId: pairing.clientSessionId },
      this.config.jwtSecret,
      this.config.gstTtlSeconds
    );

    // Emissão do Gateway Refresh Token com rotação (Guardrail 2)
    const gatewayRefreshToken = generateGatewayRefreshToken();
    const tokenFamilyId = randomUUID();
    const refreshHash = hashSecret(gatewayRefreshToken);

    const now = Date.now();
    const refreshExpiresAt = new Date(now + this.config.sessionRefreshTtlDays * 24 * 60 * 60 * 1000).toISOString();

    const sessionRecord: GatewaySessionRecord = {
      id: randomUUID(),
      connectionId,
      tokenFamilyId,
      refreshTokenHash: refreshHash,
      expiresAt: refreshExpiresAt,
      createdAt: new Date().toISOString()
    };

    await this.repository.createGatewaySession(sessionRecord);

    gatewayLogger.info(`Sessão do Gateway emitida com sucesso para conexão ${connectionId}`);

    this.sendJson(res, 200, {
      ok: true,
      status: 'connected',
      gatewaySessionToken,
      gatewayRefreshToken,
      expiresInSeconds: this.config.gstTtlSeconds
    });
  }

  private async handleOAuthCallback(parsedUrl: URL, res: ServerResponse): Promise<void> {
    const code = parsedUrl.searchParams.get('code');
    const state = parsedUrl.searchParams.get('state');

    // Guardrail 3: Headers HTTP altamente restritivos
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline';");
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (!code || !state) {
      res.writeHead(400);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Erro de Autorização</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>Falha na Autorização</h2>
          <p>Parâmetros de retorno ausentes ou inválidos. Feche esta janela e tente novamente.</p>
        </body>
        </html>
      `);
      return;
    }

    const stateHash = hashSecret(state);

    // Fase A: Consumo atômico do state OAuth (transação curta sem espera de rede)
    const consumeResult = await this.repository.consumeOAuthState(stateHash);

    if (!consumeResult.ok || !consumeResult.pairing) {
      res.writeHead(400);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Erro de Autorização</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>Sessão Expirada ou Inválida</h2>
          <p>O estado desta autorização expirou, é inválido ou já foi utilizado. Inicie uma nova conexão pela extensão.</p>
        </body>
        </html>
      `);
      return;
    }

    // Fase B: (Fase 4C.2B) Chamada externa ao Bling ocorrerá aqui fora de qualquer transação de banco

    // Fase C: Persistência da conexão e vinculação ao pairingId
    const connectionId = `conn_${randomUUID()}`;
    await this.repository.saveConnection({
      id: connectionId,
      status: 'requires_reauth',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await this.repository.attachConnectionToPairing(consumeResult.pairing.pairingId, connectionId);

    // HTML de sucesso: NUNCA reflete code, state, access_token ou segredos
    res.writeHead(200);
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Paulifest Copilot • Autorização Concluída</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: white; padding: 32px 40px; border-radius: 18px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); text-align: center; max-width: 400px; }
          .icon { font-size: 40px; margin-bottom: 16px; }
          h2 { font-size: 18px; margin: 0 0 8px 0; color: #1d1d1f; }
          p { font-size: 13px; color: #86868b; line-height: 1.5; margin: 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✓</div>
          <h2>Conexão Autorizada com Sucesso!</h2>
          <p>Sua conta Bling ERP foi vinculada com segurança. Você já pode fechar esta aba e retornar ao Seller Copilot.</p>
        </div>
      </body>
      </html>
    `);
  }

  // ---------------------------------------------------------------------------
  // Utilitários HTTP
  // ---------------------------------------------------------------------------

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store'
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
