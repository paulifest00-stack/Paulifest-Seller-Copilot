// Suíte Oficial de Testes da Fase 4C.2B: OAuth2 Real do Bling e Persistência PostgreSQL
import assert from 'node:assert';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { getPool } from '../src/gateway/database/connection.ts';
import { PostgresGatewayRepository } from '../src/gateway/database/postgres-repository.ts';
import { GatewayApp } from '../src/gateway/http/app.ts';
import { BlingOAuthClient, BlingOAuthError } from '../src/gateway/integrations/bling/bling-oauth-client.ts';
import { BlingTokenManager, BlingReauthRequiredError } from '../src/gateway/integrations/bling/bling-token-manager.ts';
import {
  generateOAuthState,
  generatePairingId,
  generatePairingSecret,
  generateGatewayRefreshToken,
  hashSecret,
  createGatewaySessionToken
} from '../src/gateway/crypto/pairing-state.ts';
import { encryptAesGcm, decryptAesGcm } from '../src/gateway/crypto/aes-gcm.ts';
import type { GatewayConfig } from '../src/gateway/config.ts';

const { Pool } = pg;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err?.stack || err?.message || err}`);
    process.exitCode = 1;
  }
}

/**
 * Servidor Fake HTTP que simula a API v3 do Bling com controle programático de respostas e inspeção de headers.
 */
class FakeBlingServer {
  public server: http.Server;
  public port: number = 0;
  public lastRequestHeaders: http.IncomingHttpHeaders = {};
  public lastRequestBody: string = '';
  public lastRequestUrl: string = '';
  public revokeCalls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: URLSearchParams; rawBody: string }> = [];
  public tokenHandler?: (req: http.IncomingMessage, body: URLSearchParams) => { status: number; body: any };
  public revokeHandler?: (req: http.IncomingMessage, body: URLSearchParams) => { status: number; body?: any };

  constructor() {
    this.server = http.createServer(async (req, res) => {
      this.lastRequestUrl = req.url || '';
      this.lastRequestHeaders = req.headers;

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        this.lastRequestBody = body;
        const params = new URLSearchParams(body);

        if (req.url === '/Api/v3/oauth/token') {
          if (this.tokenHandler) {
            const result = this.tokenHandler(req, params);
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
            return;
          }

          // Resposta padrão de sucesso 200 OK
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: `mock_access_token_${randomUUID()}`,
            refresh_token: `mock_refresh_token_${randomUUID()}`,
            expires_in: 21600,
            token_type: 'Bearer',
            scope: 'produtos,pedidos'
          }));
          return;
        }

        if (req.url === '/oauth/revoke') {
          this.revokeCalls.push({
            url: req.url || '',
            headers: req.headers,
            body: params,
            rawBody: body
          });

          if (this.revokeHandler) {
            const result = this.revokeHandler(req, params);
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.body || {}));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Token revogado com sucesso.' }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as any;
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

export async function runGatewayOAuthRealTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: GATEWAY BLING REAL OAUTH2 INTEGRATION (FASE 4C.2B)');
  console.log('================================================================\n');

  const databaseUrl = process.env.DATABASE_URL?.trim() || 'postgresql://postgres:postgres@127.0.0.1:5432/paulifest_test';
  const testPool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });

  // Inicia o Fake Bling Server em porta efêmera
  const fakeBling = new FakeBlingServer();
  const fakePort = await fakeBling.start();
  const fakeBaseUrl = `http://127.0.0.1:${fakePort}`;
  const fakeAuthUrl = `http://127.0.0.1:${fakePort}/Api/v3/oauth/authorize`;

  const encryptionKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
  const jwtSecret = 'test_jwt_secret_min_32_characters_long_for_unit_tests';
  const clientId = 'test_client_id_123';
  const clientSecret = 'test_client_secret_xyz';
  const redirectUri = 'https://gateway.paulifest.local/auth/bling/callback';

  const repo = new PostgresGatewayRepository(testPool);

  const testConfig: GatewayConfig = {
    blingClientId: clientId,
    blingClientSecret: clientSecret,
    blingRedirectUri: redirectUri,
    blingBaseUrl: fakeBaseUrl,
    blingAuthUrl: fakeAuthUrl,
    blingTimeoutMs: 2000,
    encryptionKey,
    jwtSecret,
    port: 0,
    environment: 'test',
    pairingTtlSeconds: 300,
    gstTtlSeconds: 900,
    sessionRefreshTtlDays: 14,
    databaseUrl
  };

  const oauthClient = new BlingOAuthClient({
    clientId,
    clientSecret,
    redirectUri,
    baseUrl: fakeBaseUrl,
    authUrl: fakeAuthUrl,
    timeoutMs: 2000
  });

  const tokenManager = new BlingTokenManager({
    repository: repo,
    oauthClient,
    encryptionKey,
    leaseTtlMs: 5000,
    heartbeatIntervalMs: 1000
  });

  const app = new GatewayApp({
    config: testConfig,
    repository: repo,
    oauthClient,
    tokenManager
  });

  // Helper para limpar tabelas entre testes
  async function clearDb() {
    await testPool.query(`
      TRUNCATE TABLE gateway_refresh_tokens, gateway_sessions, gateway_pairings, bling_connections CASCADE;
    `);
  }

  function mockConnectedTokens(customExpiresAt?: string) {
    const encAccess = encryptAesGcm('mock_access_token', encryptionKey);
    const encRefresh = encryptAesGcm('mock_refresh_token', encryptionKey);
    return {
      encryptedAccessToken: encAccess.ciphertext,
      accessTokenIv: encAccess.iv,
      accessTokenTag: encAccess.authTag,
      encryptedRefreshToken: encRefresh.ciphertext,
      refreshTokenIv: encRefresh.iv,
      refreshTokenTag: encRefresh.authTag,
      tokenExpiresAt: customExpiresAt || new Date(Date.now() + 21600000).toISOString()
    };
  }

  try {
    // -------------------------------------------------------------------------
    // 1. Contratos Oficiais e Headers Estritos por Endpoint (AJUSTE 1)
    // -------------------------------------------------------------------------

    await runTest('1. URL de autorização: monta com response_type=code, client_id e state corretos', () => {
      const state = generateOAuthState();
      const url = oauthClient.buildAuthorizationUrl(state);
      const parsed = new URL(url);
      assert.strictEqual(parsed.origin, fakeBaseUrl);
      assert.strictEqual(parsed.pathname, '/Api/v3/oauth/authorize');
      assert.strictEqual(parsed.searchParams.get('response_type'), 'code');
      assert.strictEqual(parsed.searchParams.get('client_id'), clientId);
      assert.strictEqual(parsed.searchParams.get('state'), state);
    });

    await runTest('2. Headers estritos de code exchange: Authorization Basic, Content-Type, Accept: 1.0 e enable-jwt: 1', async () => {
      fakeBling.tokenHandler = undefined;
      const res = await oauthClient.exchangeCodeForTokens('test_code_123');
      assert.ok(res.access_token);

      const headers = fakeBling.lastRequestHeaders;
      const expectedBasic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      assert.strictEqual(headers['authorization'], expectedBasic);
      assert.strictEqual(headers['content-type'], 'application/x-www-form-urlencoded');
      assert.strictEqual(headers['accept'], '1.0');
      assert.strictEqual(headers['enable-jwt'], '1');
      assert.ok(fakeBling.lastRequestBody.includes('grant_type=authorization_code'));
      assert.ok(fakeBling.lastRequestBody.includes('code=test_code_123'));
    });

    await runTest('3. Headers estritos de refresh: Authorization Basic, Content-Type, Accept: 1.0 e enable-jwt: 1', async () => {
      fakeBling.tokenHandler = undefined;
      const res = await oauthClient.refreshTokens('refresh_token_abc');
      assert.ok(res.access_token);

      const headers = fakeBling.lastRequestHeaders;
      assert.strictEqual(headers['accept'], '1.0');
      assert.strictEqual(headers['enable-jwt'], '1');
      assert.ok(fakeBling.lastRequestBody.includes('grant_type=refresh_token'));
      assert.ok(fakeBling.lastRequestBody.includes('refresh_token=refresh_token_abc'));
    });

    await runTest('4. Contrato oficial de revoke: Authorization Basic, Content-Type SEM enable-jwt ou Accept 1.0', async () => {
      fakeBling.revokeHandler = undefined;
      const res = await oauthClient.revokeToken('token_to_revoke', 'access_token');
      assert.strictEqual(res.success, true);

      const headers = fakeBling.lastRequestHeaders;
      assert.strictEqual(headers['content-type'], 'application/x-www-form-urlencoded');
      assert.strictEqual(headers['enable-jwt'], undefined, 'Revoke NÃO deve conter enable-jwt: 1');
      assert.notStrictEqual(headers['accept'], '1.0', 'Revoke NÃO deve conter Accept: 1.0');
      assert.ok(fakeBling.lastRequestBody.includes('token=token_to_revoke'));
      assert.ok(fakeBling.lastRequestBody.includes('token_type_hint=access_token'));
    });

    // -------------------------------------------------------------------------
    // 2. Classificação Semântica de Erros de Token (AJUSTE 2)
    // -------------------------------------------------------------------------

    await runTest('5. Resposta malformada (não-JSON): lança BlingOAuthError com retryable=true e requiresReauth=false', async () => {
      fakeBling.tokenHandler = () => ({ status: 200, body: 'Not valid JSON <<<' as any });
      let caught: any;
      try {
        await oauthClient.exchangeCodeForTokens('code_malformed');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
      assert.strictEqual(caught.retryable, true);
      assert.strictEqual(caught.requiresReauth, false);
    });

    await runTest('6. Campos ausentes no payload de token: lança BlingOAuthError com retryable=true', async () => {
      fakeBling.tokenHandler = () => ({ status: 200, body: { access_token: 'valid' } }); // sem refresh_token
      let caught: any;
      try {
        await oauthClient.refreshTokens('refresh_token_incomplete');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
      assert.strictEqual(caught.requiresReauth, false);
    });

    await runTest('7. Erro 429 (Rate Limit): categorizado como rate_limit com retryable=true e requiresReauth=false', async () => {
      fakeBling.tokenHandler = () => ({ status: 429, body: { error: 'too_many_requests' } });
      let caught: any;
      try {
        await oauthClient.refreshTokens('refresh_token_rate_limited');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.status, 429);
      assert.strictEqual(caught.category, 'rate_limit');
      assert.strictEqual(caught.retryable, true);
      assert.strictEqual(caught.requiresReauth, false);
    });

    await runTest('8. Erro 500 (Server Error): categorizado como server_error com retryable=true e requiresReauth=false', async () => {
      fakeBling.tokenHandler = () => ({ status: 500, body: { error: 'internal_server_error' } });
      let caught: any;
      try {
        await oauthClient.refreshTokens('refresh_token_server_err');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.status, 500);
      assert.strictEqual(caught.category, 'server_error');
      assert.strictEqual(caught.retryable, true);
      assert.strictEqual(caught.requiresReauth, false);
    });

    await runTest('9. Erro 400 com invalid_grant: categorizado como terminal com requiresReauth=true e retryable=false', async () => {
      fakeBling.tokenHandler = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Token expired' } });
      let caught: any;
      try {
        await oauthClient.refreshTokens('refresh_token_expired');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'auth');
      assert.strictEqual(caught.code, 'invalid_grant');
      assert.strictEqual(caught.requiresReauth, true);
      assert.strictEqual(caught.retryable, false);
    });

    await runTest('10. Erro 400 ambíguo em refresh: falha de forma recuperável (retryable=true, requiresReauth=false)', async () => {
      fakeBling.tokenHandler = () => ({ status: 400, body: { error: 'temporary_mismatch', error_description: 'Transient glitch' } });
      let caught: any;
      try {
        await oauthClient.refreshTokens('refresh_token_ambiguous');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.requiresReauth, false, 'Erro ambíguo NÃO deve destruir credenciais válidas');
      assert.strictEqual(caught.retryable, true);
    });

    // -------------------------------------------------------------------------
    // 3. Fluxo OAuth2 HTTP do Gateway com Fase C Atômica
    // -------------------------------------------------------------------------

    await runTest('11. POST /auth/bling/start: emite state, pairingId, pairingSecret e authorizationUrl oficial', async () => {
      await clearDb();

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'POST',
        url: '/auth/bling/start',
        headers: { host: 'localhost' },
        on: (event: string, cb: any) => {
          if (event === 'data') cb(JSON.stringify({ clientSessionId: 'extension_session_test_123' }));
          if (event === 'end') cb();
        }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.ok, true);
      assert.ok(parsed.pairingId);
      assert.ok(parsed.pairingSecret);
      assert.strictEqual(parsed.expiresInSeconds, 300);
      assert.ok(parsed.authorizationUrl.includes('/Api/v3/oauth/authorize'));
      assert.ok(parsed.authorizationUrl.includes('client_id=' + clientId));
    });

    await runTest('12. GET /auth/bling/callback com Sucesso: Fase A + B + C atômica persiste tokens cifrados', async () => {
      await clearDb();
      fakeBling.tokenHandler = undefined;

      const state = generateOAuthState();
      const stateHash = hashSecret(state);
      const pairingId = generatePairingId();
      const pairingSecret = generatePairingSecret();

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_full_callback_test',
        stateHash,
        pairingSecretHash: hashSecret(pairingSecret),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      let statusCode = 0;
      let responseHeaders: Record<string, string> = {};
      let htmlBody = '';

      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: (k: string, v: string) => { responseHeaders[k.toLowerCase()] = v; },
        end: (payload: string) => { htmlBody = payload; }
      };

      const fakeReq: any = {
        method: 'GET',
        url: `/auth/bling/callback?code=valid_test_code&state=${encodeURIComponent(state)}`,
        headers: { host: 'localhost' }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);
      assert.ok(htmlBody.includes('Conexão Concluída'));

      // Headers de segurança estritos
      assert.strictEqual(responseHeaders['cache-control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
      assert.strictEqual(responseHeaders['pragma'], 'no-cache');
      assert.strictEqual(responseHeaders['x-content-type-options'], 'nosniff');
      assert.ok(responseHeaders['content-security-policy']);

      // Consulta no PostgreSQL para comprovar Fase C atômica
      const updatedPairing = await repo.getPairingById(pairingId);
      assert.ok(updatedPairing?.stateConsumedAt, 'stateConsumedAt deve estar preenchido');
      assert.ok(updatedPairing?.connectionId, 'connectionId deve estar vinculado ao pairing');

      const conn = await repo.getConnection(updatedPairing!.connectionId!);
      assert.ok(conn, 'Conexão deve ter sido criada no PostgreSQL');
      assert.strictEqual(conn?.status, 'connected');
      assert.ok(conn?.encryptedAccessToken, 'Access token deve estar cifrado');
      assert.ok(conn?.encryptedRefreshToken, 'Refresh token deve estar cifrado');
    });

    await runTest('13. Fase C Atômica (createConnectionAndAttachPairing): Rollback completo se pairing inválido', async () => {
      await clearDb();

      // Tenta criar conexão e vincular a pairing que NÃO existe
      const doomedConn = {
        id: `conn_fail_${randomUUID()}`,
        status: 'connected' as const,
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const attached = await repo.createConnectionAndAttachPairing(doomedConn, 'non_existent_pairing_id');
      assert.strictEqual(attached, false);

      // Garante que a conexão NÃO foi gravada (zero conexões órfãs)
      const checkConn = await repo.getConnection(doomedConn.id);
      assert.strictEqual(checkConn, undefined, 'Conexão órfã NÃO deve ser persistida após rollback');
    });

    await runTest('14. Callback com State Replay: Fase A rejeita imediatamente sem chamar o Bling', async () => {
      let blingCalled = false;
      fakeBling.tokenHandler = () => {
        blingCalled = true;
        return { status: 200, body: {} };
      };

      const state = generateOAuthState();
      const stateHash = hashSecret(state);
      const pairingId = generatePairingId();

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_replay_test',
        stateHash,
        pairingSecretHash: hashSecret(generatePairingSecret()),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Primeiro consumo
      await repo.consumeOAuthState(stateHash);

      // Tentativa de replay via HTTP callback
      let statusCode = 0;
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: () => {}
      };

      const fakeReq: any = {
        method: 'GET',
        url: `/auth/bling/callback?code=some_code&state=${encodeURIComponent(state)}`,
        headers: { host: 'localhost' }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 400);
      assert.strictEqual(blingCalled, false, 'Bling NUNCA deve ser chamado quando state é rejeitado na Fase A');
    });

    await runTest('15. Callback falha na Fase B: state permanece consumido de forma irreversível', async () => {
      fakeBling.tokenHandler = () => ({
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Code expired' }
      });

      const state = generateOAuthState();
      const stateHash = hashSecret(state);
      const pairingId = generatePairingId();

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_fail_b_test',
        stateHash,
        pairingSecretHash: hashSecret(generatePairingSecret()),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      let statusCode = 0;
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: () => {}
      };

      const fakeReq: any = {
        method: 'GET',
        url: `/auth/bling/callback?code=bad_code&state=${encodeURIComponent(state)}`,
        headers: { host: 'localhost' }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 400);

      const pairing = await repo.getPairingById(pairingId);
      assert.ok(pairing?.stateConsumedAt, 'State continua consumido irreversivelmente');
      assert.strictEqual(pairing?.connectionId, null, 'Nenhuma conexão deve estar vinculada');
    });

    // -------------------------------------------------------------------------
    // 4. Sessão do Gateway, GST de 15 Minutos e GRT Rotativo
    // -------------------------------------------------------------------------

    await runTest('16. POST /auth/bling/session: emite GST com TTL estrito de 15 minutos (900s) e GRT', async () => {
      await clearDb();

      const pairingId = generatePairingId();
      const pairingSecret = generatePairingSecret();
      const connId = `conn_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_handshake_cli',
        stateHash: hashSecret(generateOAuthState()),
        pairingSecretHash: hashSecret(pairingSecret),
        connectionId: connId,
        stateConsumedAt: new Date().toISOString(),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'POST',
        url: '/auth/bling/session',
        headers: { host: 'localhost' },
        on: (event: string, cb: any) => {
          if (event === 'data') cb(JSON.stringify({ pairingId, pairingSecret }));
          if (event === 'end') cb();
        }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.status, 'connected');
      assert.strictEqual(parsed.expiresInSeconds, 900, 'GST deve ter expiração em exatamente 900 segundos');
      assert.ok(parsed.gatewaySessionToken);
      assert.ok(parsed.gatewayRefreshToken);

      // Valida que pairing foi consumido no PostgreSQL
      const p = await repo.getPairingById(pairingId);
      assert.ok(p?.pairingConsumedAt, 'pairing_consumed_at deve estar preenchido');

      // Valida que sessão e GRT foram criados atomicamente no PostgreSQL
      const sessionCount = await testPool.query('SELECT count(*) FROM gateway_sessions WHERE connection_id = $1', [connId]);
      assert.strictEqual(parseInt(sessionCount.rows[0].count, 10), 1);
      const grtCount = await testPool.query('SELECT count(*) FROM gateway_refresh_tokens WHERE session_id IN (SELECT id FROM gateway_sessions WHERE connection_id = $1)', [connId]);
      assert.strictEqual(parseInt(grtCount.rows[0].count, 10), 1);
    });

    await runTest('16b. Handshake Atômico (Rollback Sessão): falha simulada ao criar sessão faz rollback integral e pairing permanece utilizável', async () => {
      await clearDb();

      const pairingId = generatePairingId();
      const pairingSecret = generatePairingSecret();
      const connId = `conn_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_fail_sess',
        stateHash: hashSecret(generateOAuthState()),
        pairingSecretHash: hashSecret(pairingSecret),
        connectionId: connId,
        stateConsumedAt: new Date().toISOString(),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const existingSessionId = randomUUID();
      // Insere uma sessão existente com esse ID para forçar colisão de chave primária na criação da sessão
      await testPool.query('INSERT INTO gateway_sessions (id, connection_id, client_session_id) VALUES ($1, $2, $3)', [
        existingSessionId,
        connId,
        'dummy'
      ]);

      // Chama consumePairingAndCreateGatewaySession passando o sessionId duplicado
      let caughtErr = false;
      try {
        await repo.consumePairingAndCreateGatewaySession({
          pairingId,
          pairingSecret,
          sessionId: existingSessionId, // colisão intencional de PK
          tokenFamilyId: randomUUID(),
          refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
          sessionExpiresAt: new Date(Date.now() + 86400000).toISOString()
        });
      } catch {
        caughtErr = true;
      }
      assert.strictEqual(caughtErr, true, 'Deve ter lançado erro de colisão de sessão');

      // Verifica rollback no PostgreSQL: pairing_consumed_at continua NULL
      const checkPairing = await repo.getPairingById(pairingId);
      assert.strictEqual(checkPairing?.pairingConsumedAt, null, 'pairing_consumed_at deve permanecer NULL após rollback');

      // Verifica que o pairing continua 100% utilizável com novo sessionId
      const retryResult = await repo.consumePairingAndCreateGatewaySession({
        pairingId,
        pairingSecret,
        sessionId: randomUUID(),
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        sessionExpiresAt: new Date(Date.now() + 86400000).toISOString()
      });
      assert.strictEqual(retryResult.ok, true, 'Pairing deve continuar utilizável após o rollback');
    });

    await runTest('16c. Handshake Atômico (Rollback GRT): falha simulada no GRT reverte a sessão e mantém pairing não consumido', async () => {
      await clearDb();

      const pairingId = generatePairingId();
      const pairingSecret = generatePairingSecret();
      const connId = `conn_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_fail_grt',
        stateHash: hashSecret(generateOAuthState()),
        pairingSecretHash: hashSecret(pairingSecret),
        connectionId: connId,
        stateConsumedAt: new Date().toISOString(),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const dupTokenHash = hashSecret('duplicate_grt_token');
      // Cria uma sessão prévia com esse tokenHash para forçar colisão de UNIQUE(token_hash)
      const prevSessionId = randomUUID();
      await testPool.query('INSERT INTO gateway_sessions (id, connection_id, client_session_id) VALUES ($1, $2, $3)', [
        prevSessionId,
        connId,
        'dummy'
      ]);
      await testPool.query(
        'INSERT INTO gateway_refresh_tokens (id, session_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + interval \'1 day\')',
        [randomUUID(), prevSessionId, randomUUID(), dupTokenHash]
      );

      const targetSessionId = randomUUID();
      let caughtErr = false;
      try {
        await repo.consumePairingAndCreateGatewaySession({
          pairingId,
          pairingSecret,
          sessionId: targetSessionId,
          tokenFamilyId: randomUUID(),
          refreshTokenHash: dupTokenHash, // colisão intencional de UNIQUE
          sessionExpiresAt: new Date(Date.now() + 86400000).toISOString()
        });
      } catch {
        caughtErr = true;
      }
      assert.strictEqual(caughtErr, true, 'Deve ter lançado erro de colisão de token_hash');

      // Verifica que a sessão target NÃO foi criada (rollback completo)
      const checkSess = await repo.getSession(targetSessionId);
      assert.strictEqual(checkSess, undefined, 'Sessão do handshake que falhou NÃO pode existir');

      // Verifica que pairing continua intacto e não consumido
      const checkPairing = await repo.getPairingById(pairingId);
      assert.strictEqual(checkPairing?.pairingConsumedAt, null, 'pairing_consumed_at deve permanecer NULL');
    });

    await runTest('16d. Handshake Concorrente: duas requisições simultâneas com o mesmo pairing: exatamente 1 vence', async () => {
      await clearDb();

      const pairingId = generatePairingId();
      const pairingSecret = generatePairingSecret();
      const connId = `conn_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_concurrent',
        stateHash: hashSecret(generateOAuthState()),
        pairingSecretHash: hashSecret(pairingSecret),
        connectionId: connId,
        stateConsumedAt: new Date().toISOString(),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Dispara 2 requisições em paralelo
      const [res1, res2] = await Promise.all([
        repo.consumePairingAndCreateGatewaySession({
          pairingId,
          pairingSecret,
          sessionId: randomUUID(),
          tokenFamilyId: randomUUID(),
          refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
          sessionExpiresAt: new Date(Date.now() + 86400000).toISOString()
        }),
        repo.consumePairingAndCreateGatewaySession({
          pairingId,
          pairingSecret,
          sessionId: randomUUID(),
          tokenFamilyId: randomUUID(),
          refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
          sessionExpiresAt: new Date(Date.now() + 86400000).toISOString()
        })
      ]);

      const successCount = (res1.ok ? 1 : 0) + (res2.ok ? 1 : 0);
      assert.strictEqual(successCount, 1, 'Exatamente uma chamada deve ter sucesso');

      const failedRes = res1.ok ? res2 : res1;
      assert.strictEqual(failedRes.error, 'PAIRING_ALREADY_CONSUMED');
    });

    await runTest('16e. Handshake Replay: segunda chamada após o sucesso é recusada com 409 PAIRING_ALREADY_CONSUMED', async () => {
      const pairingId = generatePairingId();
      const pairingSecret = generatePairingSecret();
      const connId = `conn_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_replay',
        stateHash: hashSecret(generateOAuthState()),
        pairingSecretHash: hashSecret(pairingSecret),
        connectionId: connId,
        stateConsumedAt: new Date().toISOString(),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Primeiro consumo
      const first = await repo.consumePairingAndCreateGatewaySession({
        pairingId,
        pairingSecret,
        sessionId: randomUUID(),
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        sessionExpiresAt: new Date(Date.now() + 86400000).toISOString()
      });
      assert.strictEqual(first.ok, true);

      // Segundo consumo via HTTP
      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'POST',
        url: '/auth/bling/session',
        headers: { host: 'localhost' },
        on: (event: string, cb: any) => {
          if (event === 'data') cb(JSON.stringify({ pairingId, pairingSecret }));
          if (event === 'end') cb();
        }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 409);
      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.error, 'PAIRING_ALREADY_CONSUMED');
    });

    await runTest('16f. Handshake com Segredo Inválido: incrementa attempt_count sem consumir pairing', async () => {
      const pairingId = generatePairingId();
      const pairingSecret = generatePairingSecret();
      const connId = `conn_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_bad_secret',
        stateHash: hashSecret(generateOAuthState()),
        pairingSecretHash: hashSecret(pairingSecret),
        connectionId: connId,
        stateConsumedAt: new Date().toISOString(),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'POST',
        url: '/auth/bling/session',
        headers: { host: 'localhost' },
        on: (event: string, cb: any) => {
          if (event === 'data') cb(JSON.stringify({ pairingId, pairingSecret: 'wrong_secret_123' }));
          if (event === 'end') cb();
        }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 401);
      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.error, 'INVALID_PAIRING_SECRET');
      assert.strictEqual(parsed.remainingAttempts, 4);

      // Verifica no PostgreSQL que attempt_count = 1 e pairing_consumed_at continua NULL
      const check = await repo.getPairingById(pairingId);
      assert.strictEqual(check?.attemptCount, 1);
      assert.strictEqual(check?.pairingConsumedAt, null);
    });

    await runTest('17. POST /auth/session/refresh: rotação atômica consumindo body JSON e emitindo novo GST (900s)', async () => {
      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();
      const familyId = randomUUID();
      const grt = generateGatewayRefreshToken();

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_refresh_test',
        tokenFamilyId: familyId,
        refreshTokenHash: hashSecret(grt),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'POST',
        url: '/auth/session/refresh',
        headers: { host: 'localhost' },
        on: (event: string, cb: any) => {
          if (event === 'data') cb(JSON.stringify({ gatewayRefreshToken: grt }));
          if (event === 'end') cb();
        }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.expiresInSeconds, 900);
      assert.ok(parsed.gatewaySessionToken);
      assert.ok(parsed.gatewayRefreshToken);
      assert.notStrictEqual(parsed.gatewayRefreshToken, grt, 'Novo GRT deve ser gerado');
    });

    await runTest('18. Detecção de reuso de GRT no refresh: revoga imediatamente toda a família de sessões', async () => {
      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();
      const familyId = randomUUID();
      const grt = generateGatewayRefreshToken();

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_reuse_test',
        tokenFamilyId: familyId,
        refreshTokenHash: hashSecret(grt),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Primeiro consumo (válido)
      const rot = await repo.rotateGatewaySession(grt, generateGatewayRefreshToken());
      assert.strictEqual(rot.ok, true);

      // Segundo consumo (REUSO ILÍCITO)
      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'POST',
        url: '/auth/session/refresh',
        headers: { host: 'localhost' },
        on: (event: string, cb: any) => {
          if (event === 'data') cb(JSON.stringify({ gatewayRefreshToken: grt }));
          if (event === 'end') cb();
        }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 401);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.error, 'TOKEN_REUSE_DETECTED');

      // Verifica no PostgreSQL que a sessão foi revogada
      const sess = await repo.getSession(sessionId);
      assert.ok(sess?.revokedAt, 'Sessão deve ter sido revogada no banco após reuso');
    });

    // -------------------------------------------------------------------------
    // 5. Status e Desconexão
    // -------------------------------------------------------------------------

    await runTest('19. GET /integrations/bling/status: retorna payload minimizado sem segredos', async () => {
      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        lastRefreshAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_status_test',
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const gst = createGatewaySessionToken(
        { connectionId: connId, clientSessionId: 'cli_status_test', sessionId },
        jwtSecret,
        900
      );

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'GET',
        url: '/integrations/bling/status',
        headers: { host: 'localhost', authorization: `Bearer ${gst}` }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.connected, true);
      assert.strictEqual(parsed.status, 'connected');
      assert.strictEqual(parsed.requiresReauth, false);
      assert.strictEqual(parsed.encryptedAccessToken, undefined, 'NUNCA expor tokens');
    });

    await runTest('20. Status rejeita sessão revogada: JWT válido sozinho NÃO autoriza se sessão foi revogada', async () => {
      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_revoked_status',
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Revoga a sessão no banco
      await testPool.query('UPDATE gateway_sessions SET revoked_at = NOW() WHERE id = $1', [sessionId]);

      const gst = createGatewaySessionToken(
        { connectionId: connId, clientSessionId: 'cli_revoked_status', sessionId },
        jwtSecret,
        900
      );

      let statusCode = 0;
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: () => {}
      };

      const fakeReq: any = {
        method: 'GET',
        url: '/integrations/bling/status',
        headers: { host: 'localhost', authorization: `Bearer ${gst}` }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 401, 'Deve recusar com 401 se a sessão foi revogada no banco');
    });

    await runTest('21. DELETE /integrations/bling: revoga access e refresh tokens no Bling (200) e purga no PostgreSQL (remoteRevocation.complete: true)', async () => {
      fakeBling.revokeHandler = undefined; // retorna 200
      fakeBling.revokeCalls = [];

      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();
      const encAccess = encryptAesGcm('real_access_token', encryptionKey);
      const encRefresh = encryptAesGcm('real_refresh_token', encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() + 21600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_disconnect',
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const gst = createGatewaySessionToken(
        { connectionId: connId, clientSessionId: 'cli_disconnect', sessionId },
        jwtSecret,
        900
      );

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'DELETE',
        url: '/integrations/bling',
        headers: { host: 'localhost', authorization: `Bearer ${gst}` }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.status, 'disconnected');
      assert.strictEqual(parsed.localDisconnected, true);
      assert.strictEqual(parsed.remoteRevocation.accessToken, 'success');
      assert.strictEqual(parsed.remoteRevocation.refreshToken, 'success');
      assert.strictEqual(parsed.remoteRevocation.complete, true);

      // Validação no PostgreSQL: tokens devem ser NULL
      const { rows } = await testPool.query('SELECT * FROM bling_connections WHERE id = $1', [connId]);
      assert.strictEqual(rows[0].status, 'disconnected');
      assert.strictEqual(rows[0].access_token_cipher, null);
      assert.strictEqual(rows[0].refresh_token_cipher, null);

      assert.strictEqual(fakeBling.revokeCalls.length, 2, 'Deve ter executado exatamente 2 revogações (access e refresh)');
    });

    await runTest('21b. DELETE /integrations/bling: access success + refresh fail -> complete: false, localDisconnected: true', async () => {
      fakeBling.revokeHandler = (_req, params) => {
        if (params.get('token_type_hint') === 'access_token') return { status: 200 };
        return { status: 500 };
      };

      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();
      const encAccess = encryptAesGcm('access_ok', encryptionKey);
      const encRefresh = encryptAesGcm('refresh_fail', encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() + 21600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_partial_disc',
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const gst = createGatewaySessionToken(
        { connectionId: connId, clientSessionId: 'cli_partial_disc', sessionId },
        jwtSecret,
        900
      );

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'DELETE',
        url: '/integrations/bling',
        headers: { host: 'localhost', authorization: `Bearer ${gst}` }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.localDisconnected, true);
      assert.strictEqual(parsed.remoteRevocation.accessToken, 'success');
      assert.strictEqual(parsed.remoteRevocation.refreshToken, 'failed');
      assert.strictEqual(parsed.remoteRevocation.complete, false, 'Não pode alegar revogação completa');

      // Purga local executada mesmo assim
      const { rows } = await testPool.query('SELECT * FROM bling_connections WHERE id = $1', [connId]);
      assert.strictEqual(rows[0].status, 'disconnected');
      assert.strictEqual(rows[0].access_token_cipher, null);
    });

    await runTest('21c. DELETE /integrations/bling: access fail + refresh success -> complete: false, localDisconnected: true', async () => {
      fakeBling.revokeHandler = (_req, params) => {
        if (params.get('token_type_hint') === 'access_token') return { status: 500 };
        return { status: 200 };
      };

      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();
      const encAccess = encryptAesGcm('access_fail', encryptionKey);
      const encRefresh = encryptAesGcm('refresh_ok', encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() + 21600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_partial_disc_2',
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const gst = createGatewaySessionToken(
        { connectionId: connId, clientSessionId: 'cli_partial_disc_2', sessionId },
        jwtSecret,
        900
      );

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'DELETE',
        url: '/integrations/bling',
        headers: { host: 'localhost', authorization: `Bearer ${gst}` }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.localDisconnected, true);
      assert.strictEqual(parsed.remoteRevocation.accessToken, 'failed');
      assert.strictEqual(parsed.remoteRevocation.refreshToken, 'success');
      assert.strictEqual(parsed.remoteRevocation.complete, false);

      // Purga local executada
      const { rows } = await testPool.query('SELECT * FROM bling_connections WHERE id = $1', [connId]);
      assert.strictEqual(rows[0].status, 'disconnected');
      assert.strictEqual(rows[0].access_token_cipher, null);
    });

    await runTest('22. DELETE /integrations/bling: ambos os tokens falham na revogação remota -> complete: false, purga local executada', async () => {
      fakeBling.revokeHandler = () => ({ status: 500 }); // Bling com erro

      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();
      const encAccess = encryptAesGcm('access_token_err', encryptionKey);
      const encRefresh = encryptAesGcm('refresh_token_err', encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() + 21600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_disc_err',
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const gst = createGatewaySessionToken(
        { connectionId: connId, clientSessionId: 'cli_disc_err', sessionId },
        jwtSecret,
        900
      );

      let statusCode = 0;
      let responseBody = '';
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: () => {},
        end: (payload: string) => { responseBody = payload; }
      };

      const fakeReq: any = {
        method: 'DELETE',
        url: '/integrations/bling',
        headers: { host: 'localhost', authorization: `Bearer ${gst}` }
      };

      await app.handleRequest(fakeReq, fakeRes);
      assert.strictEqual(statusCode, 200);

      const parsed = JSON.parse(responseBody);
      assert.strictEqual(parsed.localDisconnected, true);
      assert.strictEqual(parsed.remoteRevocation.accessToken, 'failed');
      assert.strictEqual(parsed.remoteRevocation.refreshToken, 'failed');
      assert.strictEqual(parsed.remoteRevocation.complete, false, 'Deve indicar honestamente que a revogação remota falhou');

      // Purga local concluída com sucesso
      const { rows } = await testPool.query('SELECT * FROM bling_connections WHERE id = $1', [connId]);
      assert.strictEqual(rows[0].status, 'disconnected');
      assert.strictEqual(rows[0].access_token_cipher, null);
    });

    await runTest('22b. DELETE /integrations/bling: conformidade estrita de contrato: token_type_hint correto e zero uninstall/company', async () => {
      fakeBling.revokeHandler = undefined;
      fakeBling.revokeCalls = [];

      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();
      const encAccess = encryptAesGcm('tok_access', encryptionKey);
      const encRefresh = encryptAesGcm('tok_refresh', encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() + 21600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_contract_test',
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const gst = createGatewaySessionToken(
        { connectionId: connId, clientSessionId: 'cli_contract_test', sessionId },
        jwtSecret,
        900
      );

      const fakeReq: any = {
        method: 'DELETE',
        url: '/integrations/bling',
        headers: { host: 'localhost', authorization: `Bearer ${gst}` }
      };

      const fakeRes: any = {
        writeHead: () => {},
        setHeader: () => {},
        end: () => {}
      };

      await app.handleRequest(fakeReq, fakeRes);

      assert.strictEqual(fakeBling.revokeCalls.length, 2);

      const call1 = fakeBling.revokeCalls[0];
      const call2 = fakeBling.revokeCalls[1];

      assert.strictEqual(call1.body.get('token_type_hint'), 'access_token');
      assert.strictEqual(call2.body.get('token_type_hint'), 'refresh_token');

      // Garante que NENHUMA chamada enviou uninstall ou company
      for (const call of fakeBling.revokeCalls) {
        assert.strictEqual(call.body.get('revoke_action'), null, 'NÃO deve conter revoke_action');
        assert.strictEqual(call.body.get('revoke_target'), null, 'NÃO deve conter revoke_target');
        assert.strictEqual(call.rawBody.includes('uninstall'), false);
        assert.strictEqual(call.rawBody.includes('company'), false);
      }
    });

    // -------------------------------------------------------------------------
    // 6. BlingTokenManager: Coordenação Distribuída com Fencing e Heartbeat
    // -------------------------------------------------------------------------

    await runTest('23. BlingTokenManager: renovação coordenada via lease distribui e incrementa token_version', async () => {
      fakeBling.tokenHandler = undefined;
      const connId = `conn_${randomUUID()}`;
      const encAccess = encryptAesGcm('old_access', encryptionKey);
      const encRefresh = encryptAesGcm('old_refresh', encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() - 1000).toISOString(), // expirado
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const newToken = await tokenManager.ensureValidAccessToken(connId);
      assert.ok(newToken);
      assert.notStrictEqual(newToken, 'old_access');

      const updatedConn = await repo.getConnection(connId);
      assert.strictEqual(updatedConn?.tokenVersion, 2, 'token_version deve ser incrementado para 2');
      assert.strictEqual(updatedConn?.refreshLeaseOwner, null, 'Lease deve ter sido liberado');
    });

    await runTest('24. Fencing Token: worker obsoleto é bloqueado e não sobrescreve tokens mais novos (stale write)', async () => {
      const connId = `conn_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        tokenVersion: 5,
        refreshLeaseOwner: 'worker_winner',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const encA = encryptAesGcm('stale_token', encryptionKey);
      const encR = encryptAesGcm('stale_refresh', encryptionKey);

      // Worker antigo tentando gravar com version 4 (esperada era 5)
      const res = await repo.updateTokensWithFencing(connId, 'worker_old', 4, {
        encryptedAccessToken: encA.ciphertext,
        accessTokenIv: encA.iv,
        accessTokenTag: encA.authTag,
        encryptedRefreshToken: encR.ciphertext,
        refreshTokenIv: encR.iv,
        refreshTokenTag: encR.authTag,
        tokenExpiresAt: new Date().toISOString()
      });

      assert.strictEqual(res.success, false, 'Fencing deve barrar gravação de worker com versão desatualizada');

      const conn = await repo.getConnection(connId);
      assert.strictEqual(conn?.tokenVersion, 5, 'Versão do banco não deve sofrer alteração');
    });

    await runTest('25. Heartbeat de lease: estende o lease ativo antes que ele expire durante chamada longa', async () => {
      const connId = `conn_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        ...mockConnectedTokens(),
        refreshLeaseOwner: 'worker_heartbeat',
        refreshLeaseExpiresAt: new Date(Date.now() + 2000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const extended = await repo.extendRefreshLease(connId, 'worker_heartbeat', 20000);
      assert.strictEqual(extended, true);

      const state = await repo.getRefreshLeaseState(connId);
      const expiryMs = new Date(state.leaseExpiresAt!).getTime();
      assert.ok(expiryMs > Date.now() + 15000, 'Expiração do lease deve ter sido estendida pelo heartbeat');
    });

    await runTest('26. Helper executeWithBlingAuth: recupera chamada com 401 via auto-refresh preventivo único', async () => {
      fakeBling.tokenHandler = undefined;
      const connId = `conn_${randomUUID()}`;
      const encAccess = encryptAesGcm('current_token', encryptionKey);
      const encRefresh = encryptAesGcm('current_refresh', encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      let callCount = 0;
      const result = await tokenManager.executeWithBlingAuth(connId, async (token) => {
        callCount++;
        if (callCount === 1) {
          // Primeira chamada simula 401 do Bling
          const err: any = new Error('Unauthorized');
          err.status = 401;
          throw err;
        }
        return `SUCCESS_WITH_${token.slice(0, 15)}`;
      });

      assert.strictEqual(callCount, 2, 'Deve ter repetido a chamada após o refresh');
      assert.ok(result.startsWith('SUCCESS_WITH_'));
    });

    await runTest('27. Helper executeWithBlingAuth: segundo 401 consecutivo marca requires_reauth sem loop', async () => {
      fakeBling.tokenHandler = undefined;
      const connId = `conn_${randomUUID()}`;
      const encAccess = encryptAesGcm('token_die', encryptionKey);
      const encRefresh = encryptAesGcm('refresh_die', encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      let callCount = 0;
      let caught: any;
      try {
        await tokenManager.executeWithBlingAuth(connId, async () => {
          callCount++;
          const err: any = new Error('Unauthorized');
          err.status = 401;
          throw err;
        });
      } catch (err) {
        caught = err;
      }

      assert.strictEqual(callCount, 2, 'Deve ter tentado no máximo 2 vezes');
      assert.ok(caught instanceof BlingReauthRequiredError);

      const conn = await repo.getConnection(connId);
      assert.strictEqual(conn?.status, 'requires_reauth', 'Segundo 401 deve marcar conexão como requires_reauth');
    });

    // -------------------------------------------------------------------------
    // 7. Auditoria de Segurança: CORS com Allowlist Estrita (AJUSTE FASE 4C.2B)
    // -------------------------------------------------------------------------

    await runTest('28. CORS: Extensão autorizada em allowlist recebe Access-Control-Allow-Origin e preflight 204', async () => {
      const allowedExt = 'chrome-extension://knldjmfmopnppmplflldamadogfkgikb';
      const corsApp = new GatewayApp({
        config: {
          ...testConfig,
          environment: 'production',
          allowedExtensionOrigins: [allowedExt]
        },
        repository: repo,
        oauthClient,
        tokenManager
      });

      // 1. Preflight OPTIONS
      let preflightStatus = 0;
      const headersSet: Record<string, string> = {};
      const fakeResOptions: any = {
        writeHead: (code: number) => { preflightStatus = code; },
        setHeader: (k: string, v: string) => { headersSet[k.toLowerCase()] = v; },
        end: () => {}
      };
      await corsApp.handleRequest({
        method: 'OPTIONS',
        url: '/health',
        headers: { host: 'localhost', origin: allowedExt }
      } as any, fakeResOptions);

      assert.strictEqual(preflightStatus, 204);
      assert.strictEqual(headersSet['access-control-allow-origin'], allowedExt);
      assert.ok(headersSet['access-control-allow-methods'].includes('GET'));

      // 2. GET normal
      let getStatus = 0;
      const getHeaders: Record<string, string> = {};
      const fakeResGet: any = {
        writeHead: (code: number) => { getStatus = code; },
        setHeader: (k: string, v: string) => { getHeaders[k.toLowerCase()] = v; },
        end: () => {}
      };
      await corsApp.handleRequest({
        method: 'GET',
        url: '/health',
        headers: { host: 'localhost', origin: allowedExt }
      } as any, fakeResGet);

      assert.strictEqual(getStatus, 200);
      assert.strictEqual(getHeaders['access-control-allow-origin'], allowedExt);
    });

    await runTest('29. CORS: Extensão não autorizada é rejeitada (sem header e preflight 403)', async () => {
      const allowedExt = 'chrome-extension://knldjmfmopnppmplflldamadogfkgikb';
      const rogueExt = 'chrome-extension://unauthorizedextensionid12345';
      const corsApp = new GatewayApp({
        config: {
          ...testConfig,
          environment: 'production',
          allowedExtensionOrigins: [allowedExt]
        },
        repository: repo,
        oauthClient,
        tokenManager
      });

      // 1. Preflight OPTIONS com extensão não autorizada
      let preflightStatus = 0;
      const headersSet: Record<string, string> = {};
      const fakeResOptions: any = {
        writeHead: (code: number) => { preflightStatus = code; },
        setHeader: (k: string, v: string) => { headersSet[k.toLowerCase()] = v; },
        end: () => {}
      };
      await corsApp.handleRequest({
        method: 'OPTIONS',
        url: '/health',
        headers: { host: 'localhost', origin: rogueExt }
      } as any, fakeResOptions);

      assert.strictEqual(preflightStatus, 403, 'Preflight de extensão desconhecida deve retornar 403');
      assert.strictEqual(headersSet['access-control-allow-origin'], undefined, 'Não deve emitir Allow-Origin');

      // 2. Requisição GET com origem não autorizada
      let getStatus = 0;
      const getHeaders: Record<string, string> = {};
      const fakeResGet: any = {
        writeHead: (code: number) => { getStatus = code; },
        setHeader: (k: string, v: string) => { getHeaders[k.toLowerCase()] = v; },
        end: () => {}
      };
      await corsApp.handleRequest({
        method: 'GET',
        url: '/health',
        headers: { host: 'localhost', origin: rogueExt }
      } as any, fakeResGet);

      assert.strictEqual(getStatus, 200);
      assert.strictEqual(getHeaders['access-control-allow-origin'], undefined, 'GET não deve emitir Allow-Origin');
    });

    await runTest('30. CORS: Localhost é permitido em ambiente de development', async () => {
      const devApp = new GatewayApp({
        config: {
          ...testConfig,
          environment: 'development',
          allowLocalhostCors: true,
          allowedExtensionOrigins: []
        },
        repository: repo,
        oauthClient,
        tokenManager
      });

      const localOrigin = 'http://localhost:5173';
      const headersSet: Record<string, string> = {};
      let statusCode = 0;
      const fakeRes: any = {
        writeHead: (code: number) => { statusCode = code; },
        setHeader: (k: string, v: string) => { headersSet[k.toLowerCase()] = v; },
        end: () => {}
      };

      await devApp.handleRequest({
        method: 'GET',
        url: '/health',
        headers: { host: 'localhost', origin: localOrigin }
      } as any, fakeRes);

      assert.strictEqual(statusCode, 200);
      assert.strictEqual(headersSet['access-control-allow-origin'], localOrigin);
    });

    await runTest('31. CORS: Localhost é estritamente rejeitado em ambiente de production', async () => {
      const prodApp = new GatewayApp({
        config: {
          ...testConfig,
          environment: 'production',
          allowedExtensionOrigins: ['chrome-extension://valid_id_prod']
        },
        repository: repo,
        oauthClient,
        tokenManager
      });

      const localOrigin = 'http://localhost:5173';
      const headersSet: Record<string, string> = {};
      let preflightStatus = 0;
      const fakeRes: any = {
        writeHead: (code: number) => { preflightStatus = code; },
        setHeader: (k: string, v: string) => { headersSet[k.toLowerCase()] = v; },
        end: () => {}
      };

      await prodApp.handleRequest({
        method: 'OPTIONS',
        url: '/health',
        headers: { host: 'localhost', origin: localOrigin }
      } as any, fakeRes);

      assert.strictEqual(preflightStatus, 403, 'Produção deve rejeitar preflight de localhost');
      assert.strictEqual(headersSet['access-control-allow-origin'], undefined);
    });

    await runTest('32. CORS: Origem maliciosa com prefixo similar ao ID permitido é bloqueada (sem header)', async () => {
      const validId = 'chrome-extension://allowed_id_abc';
      const maliciousOrigin = 'chrome-extension://allowed_id_abc_attacker_controlled';
      const corsApp = new GatewayApp({
        config: {
          ...testConfig,
          environment: 'production',
          allowedExtensionOrigins: [validId]
        },
        repository: repo,
        oauthClient,
        tokenManager
      });

      const headersSet: Record<string, string> = {};
      let preflightStatus = 0;
      const fakeRes: any = {
        writeHead: (code: number) => { preflightStatus = code; },
        setHeader: (k: string, v: string) => { headersSet[k.toLowerCase()] = v; },
        end: () => {}
      };

      await corsApp.handleRequest({
        method: 'OPTIONS',
        url: '/health',
        headers: { host: 'localhost', origin: maliciousOrigin }
      } as any, fakeRes);

      assert.strictEqual(preflightStatus, 403);
      assert.strictEqual(headersSet['access-control-allow-origin'], undefined);
    });

    // -------------------------------------------------------------------------
    // 8. Auditoria de Segurança: X-Forwarded-For e Trusted Proxy (AJUSTE FASE 4C.2B)
    // -------------------------------------------------------------------------

    await runTest('33. X-Forwarded-For: Com trustProxy=false, tentativa de spoofing é ignorada e socket IP é usado', () => {
      const directApp = new GatewayApp({
        config: {
          ...testConfig,
          trustProxy: false
        },
        repository: repo,
        oauthClient,
        tokenManager
      });

      const fakeReq: any = {
        headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' },
        socket: { remoteAddress: '192.168.1.55' }
      };

      const extractedIp = directApp.extractClientIp(fakeReq);
      assert.strictEqual(extractedIp, '192.168.1.55', 'Deve ignorar o header forjado e utilizar o remoteAddress do socket');
    });

    await runTest('34. X-Forwarded-For: Com trustProxy=true, IP do cliente fornecido pelo reverse proxy é utilizado', () => {
      const proxyApp = new GatewayApp({
        config: {
          ...testConfig,
          trustProxy: true
        },
        repository: repo,
        oauthClient,
        tokenManager
      });

      const fakeReq: any = {
        headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' },
        socket: { remoteAddress: '10.0.0.1' }
      };

      const extractedIp = proxyApp.extractClientIp(fakeReq);
      assert.strictEqual(extractedIp, '203.0.113.195', 'Com trustProxy ativo, extrai o primeiro IP da cadeia');
    });

    // -------------------------------------------------------------------------
    // 9. Validação Estrita de Resposta do Token Endpoint (AJUSTE FASE 4C.2B)
    // -------------------------------------------------------------------------

    await runTest('35. Validação de Token: expires_in ausente lança invalid_payload', async () => {
      fakeBling.tokenHandler = () => ({
        status: 200,
        body: { access_token: 'acc_123', refresh_token: 'ref_123' } // sem expires_in
      });
      let caught: any;
      try {
        await oauthClient.exchangeCodeForTokens('code_no_expires');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
    });

    await runTest('36. Validação de Token: expires_in = 0 lança invalid_payload', async () => {
      fakeBling.tokenHandler = () => ({
        status: 200,
        body: { access_token: 'acc_123', refresh_token: 'ref_123', expires_in: 0 }
      });
      let caught: any;
      try {
        await oauthClient.exchangeCodeForTokens('code_zero_expires');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
    });

    await runTest('37. Validação de Token: expires_in negativo lança invalid_payload', async () => {
      fakeBling.tokenHandler = () => ({
        status: 200,
        body: { access_token: 'acc_123', refresh_token: 'ref_123', expires_in: -3600 }
      });
      let caught: any;
      try {
        await oauthClient.exchangeCodeForTokens('code_negative_expires');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
    });

    await runTest('38. Validação de Token: expires_in não numérico lança invalid_payload', async () => {
      fakeBling.tokenHandler = () => ({
        status: 200,
        body: { access_token: 'acc_123', refresh_token: 'ref_123', expires_in: 'duas_horas' }
      });
      let caught: any;
      try {
        await oauthClient.exchangeCodeForTokens('code_nan_expires');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
    });

    await runTest('39. Validação de Token: access_token vazio lança invalid_payload', async () => {
      fakeBling.tokenHandler = () => ({
        status: 200,
        body: { access_token: '   ', refresh_token: 'ref_123', expires_in: 21600 }
      });
      let caught: any;
      try {
        await oauthClient.exchangeCodeForTokens('code_empty_access');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
    });

    await runTest('40. Validação de Token: refresh_token vazio lança invalid_payload', async () => {
      fakeBling.tokenHandler = () => ({
        status: 200,
        body: { access_token: 'acc_123', refresh_token: '', expires_in: 21600 }
      });
      let caught: any;
      try {
        await oauthClient.exchangeCodeForTokens('code_empty_refresh');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
    });

    await runTest('41. Validação de Token: token_type incompatível ("Basic") lança invalid_payload', async () => {
      fakeBling.tokenHandler = () => ({
        status: 200,
        body: { access_token: 'acc_123', refresh_token: 'ref_123', expires_in: 21600, token_type: 'Basic' }
      });
      let caught: any;
      try {
        await oauthClient.exchangeCodeForTokens('code_wrong_token_type');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof BlingOAuthError);
      assert.strictEqual(caught.category, 'invalid_payload');
    });

    // -------------------------------------------------------------------------
    // 10. Auditoria de Claims Canônicos e Proteção de Segredos no Disconnect
    // -------------------------------------------------------------------------

    await runTest('42. GST Claims Canônicos: validação estrita de sub=connectionId, csid=clientSessionId, sid=sessionId, iss=paulifest-integration-gateway', () => {
      const connectionId = 'conn_test_claims_123';
      const clientSessionId = 'csid_test_claims_456';
      const sessionId = 'sid_test_claims_789';

      const token = createGatewaySessionToken(
        { connectionId, clientSessionId, sessionId },
        jwtSecret,
        900
      );

      const parts = token.split('.');
      assert.strictEqual(parts.length, 3);

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      assert.strictEqual(payload.sub, connectionId, 'sub deve ser exatamente connectionId');
      assert.strictEqual(payload.csid, clientSessionId, 'csid deve ser exatamente clientSessionId');
      assert.strictEqual(payload.sid, sessionId, 'sid deve ser exatamente sessionId');
      assert.strictEqual(payload.iss, 'paulifest-integration-gateway', 'iss deve ser paulifest-integration-gateway');
      assert.ok(typeof payload.iat === 'number');
      assert.ok(typeof payload.exp === 'number');
      assert.strictEqual(payload.exp - payload.iat, 900, 'Duração do GST deve ser estritamente 900 segundos');
    });

    await runTest('43. Disconnect Sanitization: confirma que remoteRevocation expõe apenas status e zero credenciais/tokens brutos', async () => {
      fakeBling.revokeHandler = undefined;
      const connId = `conn_${randomUUID()}`;
      const sessionId = randomUUID();
      const rawAccessToken = 'secret_access_token_raw_do_not_leak';
      const rawRefreshToken = 'secret_refresh_token_raw_do_not_leak';

      const encAccess = encryptAesGcm(rawAccessToken, encryptionKey);
      const encRefresh = encryptAesGcm(rawRefreshToken, encryptionKey);

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: encAccess.ciphertext,
        accessTokenIv: encAccess.iv,
        accessTokenTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh.ciphertext,
        refreshTokenIv: encRefresh.iv,
        refreshTokenTag: encRefresh.authTag,
        tokenExpiresAt: new Date(Date.now() + 21600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_leak_check',
        tokenFamilyId: randomUUID(),
        refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const gst = createGatewaySessionToken(
        { connectionId: connId, clientSessionId: 'cli_leak_check', sessionId },
        jwtSecret,
        900
      );

      let responsePayload = '';
      let resStatus = 0;
      const fakeRes: any = {
        writeHead: (code: number) => { resStatus = code; },
        setHeader: () => {},
        end: (body: string) => { responsePayload = body; }
      };

      await app.handleRequest({
        method: 'DELETE',
        url: '/integrations/bling',
        headers: { host: 'localhost', authorization: `Bearer ${gst}` }
      } as any, fakeRes);

      assert.strictEqual(resStatus, 200);
      assert.ok(!responsePayload.includes(rawAccessToken), 'A resposta NUNCA deve conter o access token bruto');
      assert.ok(!responsePayload.includes(rawRefreshToken), 'A resposta NUNCA deve conter o refresh token bruto');
      assert.ok(!responsePayload.includes(encAccess.ciphertext), 'A resposta NUNCA deve conter o ciphertext do access token');

      const parsed = JSON.parse(responsePayload);
      assert.strictEqual(parsed.remoteRevocation.accessToken, 'success');
      assert.strictEqual(parsed.remoteRevocation.refreshToken, 'success');
      assert.strictEqual(parsed.remoteRevocation.complete, true);
    });

  } finally {
    await fakeBling.stop();
    await testPool.end();
  }
}
