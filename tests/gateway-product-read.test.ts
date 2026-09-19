// Suíte Oficial de Testes da Fase 4C.3: Leitura Real de Produto do Bling no Gateway
import assert from 'node:assert';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresGatewayRepository } from '../src/gateway/database/postgres-repository.ts';
import { GatewayApp } from '../src/gateway/http/app.ts';
import { BlingOAuthClient } from '../src/gateway/integrations/bling/bling-oauth-client.ts';
import { BlingTokenManager } from '../src/gateway/integrations/bling/bling-token-manager.ts';
import { BlingProductClient } from '../src/gateway/integrations/bling/bling-product-client.ts';
import {
  createGatewaySessionToken,
  generateGatewayRefreshToken,
  hashSecret
} from '../src/gateway/crypto/pairing-state.ts';
import { encryptAesGcm } from '../src/gateway/crypto/aes-gcm.ts';
import { productReadLimiter } from '../src/gateway/security/rate-limiter.ts';
import type { GatewayConfig } from '../src/gateway/config.ts';
import type { BlingConnectionRecord } from '../src/gateway/types/contracts.ts';

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

class FakeBlingProductServer {
  public server: http.Server;
  public port: number = 0;
  public lastRequestHeaders: http.IncomingHttpHeaders = {};
  public lastRequestUrl: string = '';
  public productHandler?: (req: http.IncomingMessage, productId: string) => { status: number; body: any; headers?: Record<string, string> };
  public refreshHandler?: (req: http.IncomingMessage, body: string) => { status: number; body: any };

  constructor() {
    this.server = http.createServer(async (req, res) => {
      this.lastRequestUrl = req.url || '';
      this.lastRequestHeaders = req.headers;

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        // Rota de produtos: GET /Api/v3/produtos/:id
        const productMatch = req.url?.match(/^\/Api\/v3\/produtos\/([^\/\?]+)/);
        if (req.method === 'GET' && productMatch) {
          const productId = decodeURIComponent(productMatch[1]);
          if (this.productHandler) {
            const result = this.productHandler(req, productId);
            if (result.headers) {
              for (const [k, v] of Object.entries(result.headers)) {
                res.setHeader(k, v);
              }
            }
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.body));
            return;
          }

          // Resposta padrão válida
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              id: productId,
              nome: `Produto Bling #${productId}`,
              codigo: `SKU-${productId}`,
              preco: 149.90,
              precoCusto: 89.00,
              tipo: 'P',
              situacao: 'A'
            }
          }));
          return;
        }

        // Rota de refresh de token: POST /Api/v3/oauth/token
        if (req.method === 'POST' && req.url === '/Api/v3/oauth/token') {
          if (this.refreshHandler) {
            const result = this.refreshHandler(req, body);
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.body));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: `refreshed_access_token_${randomUUID().slice(0, 8)}`,
            refresh_token: `refreshed_refresh_token_${randomUUID().slice(0, 8)}`,
            expires_in: 21600,
            token_type: 'Bearer',
            scope: 'produtos'
          }));
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

export async function runGatewayProductReadTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: GATEWAY BLING PRODUCT READ (FASE 4C.3)');
  console.log('================================================================\n');

  const databaseUrl = process.env.DATABASE_URL?.trim() || 'postgresql://postgres:postgres@127.0.0.1:5432/paulifest_test';
  const testPool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });

  const fakeBling = new FakeBlingProductServer();
  const fakePort = await fakeBling.start();
  const fakeBaseUrl = `http://127.0.0.1:${fakePort}`;

  const encryptionKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
  const jwtSecret = 'test_jwt_secret_min_32_characters_long_for_unit_tests';
  const repo = new PostgresGatewayRepository(testPool);

  const testConfig: GatewayConfig = {
    blingClientId: 'test_client_id',
    blingClientSecret: 'test_client_secret',
    blingRedirectUri: 'https://gateway.local/callback',
    blingBaseUrl: fakeBaseUrl,
    blingAuthUrl: `${fakeBaseUrl}/auth`,
    blingTimeoutMs: 1500,
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
    clientId: testConfig.blingClientId,
    clientSecret: testConfig.blingClientSecret,
    redirectUri: testConfig.blingRedirectUri,
    baseUrl: fakeBaseUrl,
    authUrl: testConfig.blingAuthUrl,
    timeoutMs: testConfig.blingTimeoutMs
  });

  const tokenManager = new BlingTokenManager({
    repository: repo,
    oauthClient,
    encryptionKey
  });

  const productClient = new BlingProductClient({
    baseUrl: fakeBaseUrl,
    timeoutMs: 1500
  });

  const app = new GatewayApp({
    config: testConfig,
    repository: repo,
    oauthClient,
    tokenManager,
    productClient
  });

  const gatewayPort = await app.listen(0);
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;

  // Helper para criar conexão ativa e sessão de teste no banco
  async function createTestConnectionAndSession(connectionId: string = `conn_${randomUUID().slice(0, 8)}`) {
    const rawAccessToken = `bling_access_token_${randomUUID().slice(0, 8)}`;
    const rawRefreshToken = `bling_refresh_token_${randomUUID().slice(0, 8)}`;

    const encAccess = encryptAesGcm(rawAccessToken, encryptionKey);
    const encRefresh = encryptAesGcm(rawRefreshToken, encryptionKey);

    const connRecord: BlingConnectionRecord = {
      id: connectionId,
      clientSessionId: 'test_ext_client',
      status: 'connected',
      encryptedAccessToken: encAccess.ciphertext,
      accessTokenIv: encAccess.iv,
      accessTokenTag: encAccess.authTag,
      encryptedRefreshToken: encRefresh.ciphertext,
      refreshTokenIv: encRefresh.iv,
      refreshTokenTag: encRefresh.authTag,
      keyVersion: 'v1',
      tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      scope: 'produtos',
      tokenVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await repo.saveConnection(connRecord);

    const sessionId = `sess_${randomUUID().slice(0, 8)}`;
    const tokenFamilyId = `fam_${randomUUID().slice(0, 8)}`;
    const grt = generateGatewayRefreshToken();
    const grtHash = hashSecret(grt);

    await repo.createGatewaySession({
      id: sessionId,
      connectionId,
      clientSessionId: 'test_ext_client',
      tokenFamilyId,
      refreshTokenHash: grtHash,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString()
    });

    const gst = createGatewaySessionToken(
      { connectionId, sessionId, clientSessionId: 'test_ext_client' },
      jwtSecret,
      900
    );

    return { connectionId, sessionId, gst, grt, rawAccessToken };
  }

  try {
    // 1. Produto válido
    await runTest('1. GET /integrations/bling/products/:id — Produto válido retorna 200 com DTO sanitizado e headers oficiais', async () => {
      fakeBling.productHandler = undefined; // Padrão 200
      const { gst } = await createTestConnectionAndSession();

      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/12345`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.product.id, '12345');
      assert.strictEqual(data.product.nome, 'Produto Bling #12345');
      assert.strictEqual(data.product.preco, 149.90);
      assert.strictEqual(fakeBling.lastRequestHeaders['enable-jwt'], '1');
      assert.strictEqual(fakeBling.lastRequestHeaders['accept'], 'application/json');
      assert.ok(fakeBling.lastRequestHeaders['authorization']?.startsWith('Bearer '));
    });

    // 2. Payload com campos desconhecidos
    await runTest('2. GET /integrations/bling/products/:id — Payload com campos desconhecidos: desconhecidos são filtrados e listados em unknownFields', async () => {
      fakeBling.productHandler = (_req, productId) => ({
        status: 200,
        body: {
          data: {
            id: productId,
            nome: 'Camiseta Básica',
            preco: 59.90,
            campoInexistenteNaApi: 'teste_invalido',
            outroCampoEstranho: 999
          }
        }
      });

      const { gst } = await createTestConnectionAndSession();
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/9988`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.product.id, '9988');
      assert.strictEqual((data.product as any).campoInexistenteNaApi, undefined);
      assert.ok(data.unknownFields.includes('campoInexistenteNaApi'));
      assert.ok(data.unknownFields.includes('outroCampoEstranho'));
    });

    // 3. Payload parcial
    await runTest('3. GET /integrations/bling/products/:id — Payload parcial (somente id e nome): omite campos faltantes de forma limpa', async () => {
      fakeBling.productHandler = (_req, productId) => ({
        status: 200,
        body: {
          data: {
            id: productId,
            nome: 'Produto Apenas com Nome'
          }
        }
      });

      const { gst } = await createTestConnectionAndSession();
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/7766`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.product.nome, 'Produto Apenas com Nome');
      assert.strictEqual(data.product.preco, undefined);
      assert.strictEqual(data.product.gtin, undefined);
    });

    // 4. Incoerência de identidade do produto
    await runTest('4. GET /integrations/bling/products/:id — Incoerência de identidade: ID retornado difere do solicitado rejeita com 422 INVALID_BLING_PAYLOAD', async () => {
      fakeBling.productHandler = () => ({
        status: 200,
        body: {
          data: {
            id: 999999, // ID diferente do solicitado (1111)
            nome: 'Produto com ID Errado'
          }
        }
      });

      const { gst } = await createTestConnectionAndSession();
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/1111`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 422);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'INVALID_BLING_PAYLOAD');
      assert.ok(data.message.includes('Incoerência de identidade'));
    });

    // 5. 404 do Bling
    await runTest('5. GET /integrations/bling/products/:id — 404 do Bling responde 404 BLING_PRODUCT_NOT_FOUND', async () => {
      fakeBling.productHandler = () => ({
        status: 404,
        body: { error: { message: 'Não encontrado' } }
      });

      const { gst } = await createTestConnectionAndSession();
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/0000`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'BLING_PRODUCT_NOT_FOUND');
    });

    // 6. 429 do Bling
    await runTest('6. GET /integrations/bling/products/:id — 429 do Bling responde 429 BLING_RATE_LIMITED com retryAfterMs', async () => {
      fakeBling.productHandler = () => ({
        status: 429,
        headers: { 'retry-after': '3' },
        body: { error: { message: 'Too Many Requests' } }
      });

      const { gst } = await createTestConnectionAndSession();
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/5555`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 429);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'BLING_RATE_LIMITED');
      assert.strictEqual(data.retryAfterMs, 3000);
    });

    // 7. 500 do Bling
    await runTest('7. GET /integrations/bling/products/:id — 500 do Bling responde 502 BLING_SERVER_ERROR', async () => {
      fakeBling.productHandler = () => ({
        status: 500,
        body: { error: { message: 'Internal Server Error' } }
      });

      const { gst } = await createTestConnectionAndSession();
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/5000`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 502);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'BLING_SERVER_ERROR');
    });

    // 8. Timeout do Bling
    await runTest('8. GET /integrations/bling/products/:id — Timeout do Bling responde 504 BLING_TIMEOUT', async () => {
      const slowClient = new BlingProductClient({
        baseUrl: fakeBaseUrl,
        timeoutMs: 150 // Timeout curto para o teste
      });

      const customApp = new GatewayApp({
        config: testConfig,
        repository: repo,
        oauthClient,
        tokenManager,
        productClient: slowClient
      });

      const customPort = await customApp.listen(0);

      fakeBling.productHandler = () => {
        // Bloqueia resposta
        return { status: 200, body: {} };
      };

      // Simula endpoint lento no FakeBling sobrescrevendo o listener
      const slowServer = http.createServer((_req, _res) => {
        // Nunca responde
      });
      await new Promise<void>(resolve => slowServer.listen(0, '127.0.0.1', () => resolve()));
      const slowPort = (slowServer.address() as any).port;

      const slowApp = new GatewayApp({
        config: { ...testConfig, blingBaseUrl: `http://127.0.0.1:${slowPort}` },
        repository: repo,
        oauthClient,
        tokenManager,
        productClient: new BlingProductClient({ baseUrl: `http://127.0.0.1:${slowPort}`, timeoutMs: 150 })
      });
      const slowAppPort = await slowApp.listen(0);

      const { gst } = await createTestConnectionAndSession();
      const res = await fetch(`http://127.0.0.1:${slowAppPort}/integrations/bling/products/123`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 504);
      const data = await res.json();
      assert.strictEqual(data.error, 'BLING_TIMEOUT');

      slowServer.close();
    });

    // 9. Primeiro 401 do Bling ativa auto-refresh
    await runTest('9. GET /integrations/bling/products/:id — Primeiro 401 do Bling ativa auto-refresh de access token e sucede no retry', async () => {
      let callCount = 0;
      fakeBling.productHandler = (_req, productId) => {
        callCount++;
        if (callCount === 1) {
          return { status: 401, body: { error: { message: 'Token expired' } } };
        }
        return {
          status: 200,
          body: { data: { id: productId, nome: 'Produto Após Refresh' } }
        };
      };

      const { gst } = await createTestConnectionAndSession();
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/4444`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.product.nome, 'Produto Após Refresh');
      assert.strictEqual(callCount, 2); // Exatamente 2 chamadas
    });

    // 10. Segundo 401 persistente
    await runTest('10. GET /integrations/bling/products/:id — Segundo 401 persistente marca requires_reauth e retorna 401', async () => {
      fakeBling.productHandler = () => ({
        status: 401,
        body: { error: { message: 'Unauthorized permanent' } }
      });

      const { connectionId, gst } = await createTestConnectionAndSession();
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/4444`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'REQUIRES_REAUTH');

      const connAfter = await repo.getConnection(connectionId);
      assert.strictEqual(connAfter?.status, 'requires_reauth');
    });

    // 11. Sessão revogada no PostgreSQL
    await runTest('11. GET /integrations/bling/products/:id — Sessão revogada no PostgreSQL rejeita requisição com 401 SESSION_REVOKED', async () => {
      fakeBling.productHandler = undefined;
      const { sessionId, gst } = await createTestConnectionAndSession();

      // Revoga a sessão no banco
      await testPool.query('UPDATE gateway_sessions SET revoked_at = NOW() WHERE id = $1', [sessionId]);

      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/12345`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'SESSION_REVOKED');
    });

    // 12. GST inválido ou ausente
    await runTest('12. GET /integrations/bling/products/:id — GST inválido ou ausente retorna 401 UNAUTHORIZED', async () => {
      const resNoAuth = await fetch(`${gatewayBaseUrl}/integrations/bling/products/12345`);
      assert.strictEqual(resNoAuth.status, 401);

      const resBadJwt = await fetch(`${gatewayBaseUrl}/integrations/bling/products/12345`, {
        headers: { 'Authorization': 'Bearer invalid.jwt.token' }
      });
      assert.strictEqual(resBadJwt.status, 401);
    });

    // 13. Conexão disconnected
    await runTest('13. GET /integrations/bling/products/:id — Conexão com status disconnected retorna 401 CONNECTION_DISCONNECTED', async () => {
      fakeBling.productHandler = undefined;
      const { connectionId, gst } = await createTestConnectionAndSession();

      await repo.updateConnectionStatus(connectionId, 'disconnected');

      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/12345`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'CONNECTION_DISCONNECTED');
    });

    // 14. Isolamento multi-tenant
    await runTest('14. GET /integrations/bling/products/:id — Isolamento multi-tenant: conexão A e conexão B utilizam seus próprios tokens', async () => {
      let tokensUsed: string[] = [];
      fakeBling.productHandler = (req, productId) => {
        const auth = req.headers['authorization'] || '';
        tokensUsed.push(auth);
        return { status: 200, body: { data: { id: productId, nome: `Prod ${productId}` } } };
      };

      const connA = await createTestConnectionAndSession();
      const connB = await createTestConnectionAndSession();

      await fetch(`${gatewayBaseUrl}/integrations/bling/products/1`, {
        headers: { 'Authorization': `Bearer ${connA.gst}` }
      });

      await fetch(`${gatewayBaseUrl}/integrations/bling/products/2`, {
        headers: { 'Authorization': `Bearer ${connB.gst}` }
      });

      assert.strictEqual(tokensUsed.length, 2);
      assert.notStrictEqual(tokensUsed[0], tokensUsed[1]);
      assert.strictEqual(tokensUsed[0], `Bearer ${connA.rawAccessToken}`);
      assert.strictEqual(tokensUsed[1], `Bearer ${connB.rawAccessToken}`);
    });

    // 15. Rate Limiting no Gateway
    await runTest('15. GET /integrations/bling/products/:id — Rate limiting do Gateway bloqueia excesso de consultas no endpoint', async () => {
      productReadLimiter.clearAll();
      fakeBling.productHandler = undefined;
      const { gst } = await createTestConnectionAndSession();

      // Dispara 35 requisições rápidas para estourar o limite de 30 req/min
      let lastStatus = 200;
      for (let i = 0; i < 35; i++) {
        const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/123`, {
          headers: {
            'Authorization': `Bearer ${gst}`,
            'x-forwarded-for': '10.15.0.1'
          }
        });
        lastStatus = res.status;
        if (lastStatus === 429) break;
      }

      assert.strictEqual(lastStatus, 429);
      productReadLimiter.clearAll();
    });

    // 16. Gateway Base URL configurável
    await runTest('16. GET /integrations/bling/products/:id — Gateway Base URL configurável em porta dinâmica', async () => {
      fakeBling.productHandler = undefined;
      const customClient = new BlingProductClient({ baseUrl: fakeBaseUrl, timeoutMs: 3000 });
      assert.strictEqual(customClient['baseUrl'], fakeBaseUrl);
    });

    // 17. Rate Limiting por identidade autenticada (connectionId)
    await runTest('17. GET /integrations/bling/products/:id — Rate limiting por connectionId bloqueia abuso mesmo rotacionando múltiplos IPs', async () => {
      productReadLimiter.clearAll();
      fakeBling.productHandler = undefined;
      const { gst } = await createTestConnectionAndSession();

      let blocked = false;
      // Dispara 35 requisições simulando IPs distintos a cada chamada
      for (let i = 0; i < 35; i++) {
        const rotatingIp = `192.168.1.${(i % 250) + 1}`;
        const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/123`, {
          headers: {
            'Authorization': `Bearer ${gst}`,
            'x-forwarded-for': rotatingIp
          }
        });
        if (res.status === 429) {
          blocked = true;
          const body = await res.json();
          assert.strictEqual(body.error, 'BLING_RATE_LIMITED');
          break;
        }
      }

      assert.strictEqual(blocked, true, 'Deveria bloquear por connectionId mesmo com rotação de IPs');
      productReadLimiter.clearAll();
    });

    // 18. Sessão não pertencente à conexão (incoerência de connectionId)
    await runTest('18. GET /integrations/bling/products/:id — GST com connectionId divergente da sessão no banco rejeita com 401', async () => {
      fakeBling.productHandler = undefined;
      const sessionData = await createTestConnectionAndSession();

      // Forja token com o sessionId válido, mas apontando para outra connectionId
      const forgedGst = createGatewaySessionToken(
        { connectionId: 'forged_foreign_conn_id', sessionId: sessionData.sessionId, clientSessionId: 'test_ext_client' },
        jwtSecret,
        900
      );

      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/123`, {
        headers: {
          'Authorization': `Bearer ${forgedGst}`,
          'x-forwarded-for': '10.18.0.1'
        }
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'SESSION_REVOKED');
    });

  } finally {
    await fakeBling.stop();
    await app.close();
    await testPool.end();
  }
}
