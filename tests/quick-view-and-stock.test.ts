import { SidepanelContextSync } from '../src/sidepanel/context-sync.ts';
// Suíte Oficial de Testes da Subfase 4D.2: Leitura Real de Custo/Estoque, Cache e Quick View
import assert from 'node:assert';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresGatewayRepository } from '../src/gateway/database/postgres-repository.ts';
import { GatewayApp } from '../src/gateway/http/app.ts';
import { BlingOAuthClient } from '../src/gateway/integrations/bling/bling-oauth-client.ts';
import { BlingTokenManager } from '../src/gateway/integrations/bling/bling-token-manager.ts';
import { BlingProductClient } from '../src/gateway/integrations/bling/bling-product-client.ts';
import { QuickViewCache } from '../src/gateway/cache/quick-view-cache.ts';
import {
  createGatewaySessionToken,
  generateGatewayRefreshToken,
  hashSecret
} from '../src/gateway/crypto/pairing-state.ts';
import { encryptAesGcm } from '../src/gateway/crypto/aes-gcm.ts';
import type { GatewayConfig } from '../src/gateway/config.ts';
import type { BlingConnectionRecord } from '../src/gateway/types/contracts.ts';
import {
  GatewayClient,
  GatewayAuthRequiredError,
  GatewayTransientError,
  GatewayProductError,
  STORAGE_KEYS
} from '../src/background/gateway-client.ts';
import { tabContextManager } from '../src/background/tab-context-manager.ts';
import { MessageRouter } from '../src/background/message-router.ts';
import { reconcileBlingPatch } from '../src/integrations/bling/reconciliation.ts';
import { createInitialSheet, createAuditedField, type CentralProductSheet } from '../src/core/schema/product.ts';
import { loadSheet, clearActiveSheet } from '../src/core/storage/storage.ts';
import { formatQuickViewDisplay, BlingShadowUi } from '../src/content-scripts/bling/shadow-ui.ts';

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

class FakeBlingQuickViewServer {
  public server: http.Server;
  public port: number = 0;
  public productRequestCount: number = 0;
  public stockRequestCount: number = 0;
  public refreshRequestCount: number = 0;

  public productHandler?: (req: http.IncomingMessage, productId: string) => { status: number; body: any; headers?: Record<string, string> };
  public stockHandler?: (req: http.IncomingMessage, productId: string) => { status: number; body: any; headers?: Record<string, string> };
  public refreshHandler?: (req: http.IncomingMessage, body: string) => { status: number; body: any };

  constructor() {
    this.server = http.createServer(async (req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        // Stock balances endpoint: GET /Api/v3/estoques/saldos?idsProdutos[]=:id
        if (req.method === 'GET' && req.url?.startsWith('/Api/v3/estoques/saldos')) {
          this.stockRequestCount++;
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          const productId = urlObj.searchParams.get('idsProdutos[]') || '';

          if (this.stockHandler) {
            const result = this.stockHandler(req, productId);
            if (result.headers) {
              for (const [k, v] of Object.entries(result.headers)) {
                res.setHeader(k, v);
              }
            }
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.body));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            data: [
              {
                produto: { id: productId },
                saldoFisicoTotal: 37, saldoVirtualTotal: 35,
                depositos: [{ id: 101, saldoFisico: 37, saldoVirtual: 35 }]
              }
            ]
          }));
          return;
        }

        // Product endpoint: GET /Api/v3/produtos/:id
        const productMatch = req.url?.match(/^\/Api\/v3\/produtos\/([^\/\?]+)/);
        if (req.method === 'GET' && productMatch) {
          this.productRequestCount++;
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

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              id: productId,
              nome: `Produto QuickView #${productId}`,
              codigo: `SKU-${productId}`,
              preco: 49.90,
              fornecedor: { precoCusto: 8.42 },
              tipo: 'P',
              situacao: 'A'
            }
          }));
          return;
        }

        // Token refresh endpoint: POST /Api/v3/oauth/token
        if (req.method === 'POST' && req.url === '/Api/v3/oauth/token') {
          this.refreshRequestCount++;
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
            scope: 'produtos estoques'
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

export async function runQuickViewAndStockTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: QUICK VIEW, ESTOQUE REAL E CACHE (FASE 4D.2)');
  console.log('================================================================\n');

  // =========================================================================
  // PARTE 1: TESTES DE UNIDADE — Fact-or-Omit, Parser de Custo e Estoque
  // =========================================================================

  await runTest('1. Parser de Custo: Custo positivo é preservado como número válido', () => {
    assert.strictEqual(BlingProductClient.parseCostPrice(8.42), 8.42);
    assert.strictEqual(BlingProductClient.parseCostPrice(150), 150);
    assert.strictEqual(BlingProductClient.parseCostPrice('29.99'), 29.99);
  });

  await runTest('2. Parser de Custo: Custo ZERO explícito é preservado como 0.00 factual (não vira null)', () => {
    assert.strictEqual(BlingProductClient.parseCostPrice(0), 0);
    assert.strictEqual(BlingProductClient.parseCostPrice('0'), 0);
    assert.strictEqual(BlingProductClient.parseCostPrice('0.00'), 0);
  });

  await runTest('3. Parser de Custo: Custo ausente (null/undefined) retorna null (Fact-or-Omit, sem sintetizar zero)', () => {
    assert.strictEqual(BlingProductClient.parseCostPrice(null), null);
    assert.strictEqual(BlingProductClient.parseCostPrice(undefined), null);
  });

  await runTest('4. Parser de Custo: Custo inválido (negativo, string malformada, NaN) retorna null fail-closed', () => {
    assert.strictEqual(BlingProductClient.parseCostPrice(-5), null);
    assert.strictEqual(BlingProductClient.parseCostPrice(-0.01), null);
    assert.strictEqual(BlingProductClient.parseCostPrice('invalido'), null);
    assert.strictEqual(BlingProductClient.parseCostPrice(NaN), null);
    assert.strictEqual(BlingProductClient.parseCostPrice(Infinity), null);
  });

  const dummyClient = new BlingProductClient({ baseUrl: 'http://127.0.0.1:9999', timeoutMs: 1000 });

  await runTest('5. Estoque Real: Físico + Virtual mapeados corretamente com saldo positivo', async () => {
    const fakeServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          {
            produto: { id: 12345 },
            saldoFisicoTotal: 50, saldoVirtualTotal: 45,
            depositos: [{ id: 1, saldoFisico: 50, saldoVirtual: 45 }]
          }
        ]
      }));
    });

    await new Promise<void>(resolve => fakeServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (fakeServer.address() as any).port;
    const client = new BlingProductClient({ baseUrl: `http://127.0.0.1:${port}` });

    try {
      const stock = await client.fetchStockBalances('12345', 'dummy_token');
      assert.ok(stock);
      assert.strictEqual(stock.physicalTotal, 50);
      assert.strictEqual(stock.virtualTotal, 45);
      assert.strictEqual(stock.source, 'bling_erp');
      assert.strictEqual(stock.deposits!.length, 1);
      assert.strictEqual(stock.deposits![0].depositName, undefined);
    } finally {
      fakeServer.close();
    }
  });

  await runTest('6. Estoque Real: Múltiplos depósitos são todos preservados e totais somados', async () => {
    const fakeServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          {
            produto: { id: 12345 },
            saldoFisicoTotal: 35, saldoVirtualTotal: 33,
            depositos: [{ id: 1, saldoFisico: 20, saldoVirtual: 18 }, { id: 2, saldoFisico: 15, saldoVirtual: 15 }]
          }
        ]
      }));
    });

    await new Promise<void>(resolve => fakeServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (fakeServer.address() as any).port;
    const client = new BlingProductClient({ baseUrl: `http://127.0.0.1:${port}` });

    try {
      const stock = await client.fetchStockBalances('12345', 'dummy_token');
      assert.ok(stock);
      assert.strictEqual(stock.physicalTotal, 35);
      assert.strictEqual(stock.virtualTotal, 33);
      assert.strictEqual(stock.deposits!.length, 2);
      assert.strictEqual(stock.deposits![0].depositName, undefined);
      assert.strictEqual(stock.deposits![1].depositName, undefined);
    } finally {
      fakeServer.close();
    }
  });

  await runTest('7. Estoque Real: Estoque ZERO explícito é preservado como 0 (fato real, não vira ausente)', async () => {
    const fakeServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          {
            produto: { id: 12345 },
            saldoFisicoTotal: 0, saldoVirtualTotal: 0,
            depositos: [{ id: 1, saldoFisico: 0, saldoVirtual: 0 }]
          }
        ]
      }));
    });

    await new Promise<void>(resolve => fakeServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (fakeServer.address() as any).port;
    const client = new BlingProductClient({ baseUrl: `http://127.0.0.1:${port}` });

    try {
      const stock = await client.fetchStockBalances('12345', 'dummy_token');
      assert.ok(stock);
      assert.strictEqual(stock.physicalTotal, 0);
      assert.strictEqual(stock.virtualTotal, 0);
    } finally {
      fakeServer.close();
    }
  });

  await runTest('8. Estoque Real: Estoque ausente (array vazio) retorna null; 404 permanece erro (Fact-or-Omit, sem inventar zero)', async () => {
    // Array vazio
    const fakeServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });

    await new Promise<void>(resolve => fakeServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (fakeServer.address() as any).port;
    const client = new BlingProductClient({ baseUrl: `http://127.0.0.1:${port}` });

    try {
      const stock = await client.fetchStockBalances('12345', 'dummy_token');
      assert.strictEqual(stock, null);
    } finally {
      fakeServer.close();
    }

    // 404 Not Found
    const fakeServer404 = http.createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Saldo não encontrado' }));
    });

    await new Promise<void>(resolve => fakeServer404.listen(0, '127.0.0.1', () => resolve()));
    const port404 = (fakeServer404.address() as any).port;
    const client404 = new BlingProductClient({ baseUrl: `http://127.0.0.1:${port404}` });

    try {
      await assert.rejects(() => client404.fetchStockBalances('12345', 'dummy_token'), /não encontrada/);
    } finally {
      fakeServer404.close();
    }
  });

  await runTest('9. Estoque Real: Payload malformado falha closed com erro apropriado', async () => {
    const fakeServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: 'isso_nao_e_um_array' }));
    });

    await new Promise<void>(resolve => fakeServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (fakeServer.address() as any).port;
    const client = new BlingProductClient({ baseUrl: `http://127.0.0.1:${port}` });

    try {
      await assert.rejects(async () => {
        await client.fetchStockBalances('12345', 'dummy_token');
      }, /Envelope da resposta de estoque do Bling inválido/);
    } finally {
      fakeServer.close();
    }
  });

  // =========================================================================
  // PARTE 2: TESTES DO CACHE VOLÁTIL NO GATEWAY
  // =========================================================================

  await runTest('10. Cache Gateway: Miss inicial, Hit em leitura subsequente e Invalidação explícita', () => {
    const cache = new QuickViewCache(60000);
    const connId = 'conn_test_1';
    const prodId = 'prod_100';

    // Miss inicial
    assert.strictEqual(cache.get(connId, prodId), null);

    // Set
    const mockData: any = {
      productId: prodId,
      sku: 'SKU-100',
      name: 'Item Teste',
      costPrice: 42.50,
      stockInfo: null,
      retrievedAt: new Date().toISOString()
    };
    cache.set(connId, prodId, mockData);

    // Hit
    const cached = cache.get(connId, prodId);
    assert.ok(cached);
    assert.strictEqual(cached.costPrice, 42.50);

    // Invalidação pontual
    cache.invalidate(connId, prodId);
    assert.strictEqual(cache.get(connId, prodId), null);
  });

  await runTest('11. Cache Gateway: Isolamento estrito entre contas (Tenant A vs Tenant B)', () => {
    const cache = new QuickViewCache(60000);
    const tenantA = 'conn_tenant_a';
    const tenantB = 'conn_tenant_b';
    const sharedProdId = 'prod_shared';

    cache.set(tenantA, sharedProdId, {
      productId: sharedProdId,
      name: 'Produto da Conta A',
      costPrice: 10.00,
      stockInfo: null,
      retrievedAt: new Date().toISOString()
    });

    // Tenant B tem miss mesmo para o mesmo productId
    assert.strictEqual(cache.get(tenantB, sharedProdId), null);

    // Tenant B grava o seu dado
    cache.set(tenantB, sharedProdId, {
      productId: sharedProdId,
      name: 'Produto da Conta B',
      costPrice: 20.00,
      stockInfo: null,
      retrievedAt: new Date().toISOString()
    });

    assert.strictEqual(cache.get(tenantA, sharedProdId)?.costPrice, 10.00);
    assert.strictEqual(cache.get(tenantB, sharedProdId)?.costPrice, 20.00);

    // Invalidação da Conta A NÃO afeta Conta B
    cache.clearForConnection(tenantA);
    assert.strictEqual(cache.get(tenantA, sharedProdId), null);
    assert.strictEqual(cache.get(tenantB, sharedProdId)?.costPrice, 20.00);
  });

  await runTest('12. Cache Gateway: Expiração por TTL', async () => {
    const shortCache = new QuickViewCache(30); // 30ms TTL
    shortCache.set('conn_ttl', 'prod_ttl', {
      productId: 'prod_ttl',
      costPrice: 5.0,
      stockInfo: null,
      retrievedAt: new Date().toISOString()
    });

    assert.ok(shortCache.get('conn_ttl', 'prod_ttl'));
    await new Promise(r => setTimeout(r, 45));
    assert.strictEqual(shortCache.get('conn_ttl', 'prod_ttl'), null);
  });

  // =========================================================================
  // PARTE 3: TESTES E2E DO GATEWAY (HTTP, AUTH, RESILIENTE, RATE LIMIT)
  // =========================================================================

  const databaseUrl = process.env.DATABASE_URL?.trim() || 'postgresql://postgres:postgres@127.0.0.1:5432/paulifest_test';
  const testPool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });

  const fakeBling = new FakeBlingQuickViewServer();
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
    databaseUrl,
    quickViewCacheTtlMs: 60000
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
      scope: 'produtos estoques',
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
    // 13. Auth ausente retorna 401
    await runTest('13. Gateway Quick View: Auth ausente retorna 401 UNAUTHORIZED', async () => {
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/123/quick-view`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'UNAUTHORIZED');
    });

    // 14. GST inválido ou expirado retorna 401
    await runTest('14. Gateway Quick View: GST inválido ou expirado retorna 401 UNAUTHORIZED', async () => {
      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/123/quick-view`, {
        headers: { 'Authorization': 'Bearer token_completamente_invalido' }
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'UNAUTHORIZED');
    });

    // 15. Sucesso 200 com DTO sanitizado, custo e estoque reais
    await runTest('15. Gateway Quick View: Sucesso 200 retorna DTO sanitizado com custo e estoque', async () => {
      fakeBling.productHandler = undefined;
      fakeBling.stockHandler = undefined;
      const { gst } = await createTestConnectionAndSession();

      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/555/quick-view`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.ok(body.quickView);
      assert.strictEqual(body.quickView.productId, '555');
      assert.strictEqual(body.quickView.costPrice, 8.42);
      assert.ok(body.quickView.stockInfo);
      assert.strictEqual(body.quickView.stockInfo.physicalTotal, 37);
      assert.strictEqual(body.quickView.stockInfo.virtualTotal, 35);
      assert.strictEqual('stock' in body.quickView, false);
    });

    // 16. Cache Hit no Gateway: segunda chamada não bate no Bling
    await runTest('16. Gateway Quick View: Cache hit evita chamadas repetidas ao Bling upstream', async () => {
      fakeBling.productHandler = undefined;
      fakeBling.stockHandler = undefined;
      const { gst } = await createTestConnectionAndSession();

      const pCountBefore = fakeBling.productRequestCount;
      const sCountBefore = fakeBling.stockRequestCount;

      // 1ª chamada (Miss)
      const res1 = await fetch(`${gatewayBaseUrl}/integrations/bling/products/777/quick-view`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(fakeBling.productRequestCount, pCountBefore + 1);
      assert.strictEqual(fakeBling.stockRequestCount, sCountBefore + 1);

      // 2ª chamada (Hit)
      const res2 = await fetch(`${gatewayBaseUrl}/integrations/bling/products/777/quick-view`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });
      assert.strictEqual(res2.status, 200);
      // Contadores não aumentam!
      assert.strictEqual(fakeBling.productRequestCount, pCountBefore + 1);
      assert.strictEqual(fakeBling.stockRequestCount, sCountBefore + 1);
    });

    // 17. 401 Upstream com auto-refresh bem-sucedido
    await runTest('17. Gateway Quick View: 401 no Bling dispara auto-refresh via BlingTokenManager e conclui com 200', async () => {
      let callCount = 0;
      fakeBling.productHandler = (_req, id) => {
        callCount++;
        if (callCount === 1) {
          return { status: 401, body: { error: { message: 'Token expirado' } } };
        }
        return {
          status: 200,
          body: {
            data: { id, nome: 'Produto Pós-Refresh', preco: 100, fornecedor: { precoCusto: 50 } }
          }
        };
      };
      fakeBling.stockHandler = undefined;
      const { gst } = await createTestConnectionAndSession();

      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/999/quick-view`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.quickView.costPrice, 50);
    });

    // 18. Segundo 401 upstream marca requires_reauth e falha com 401
    await runTest('18. Gateway Quick View: Segundo 401 upstream marca requires_reauth e falha com 401', async () => {
      fakeBling.productHandler = () => ({
        status: 401,
        body: { error: { message: 'Token revogado definitivamente' } }
      });
      fakeBling.stockHandler = undefined;
      const { gst, connectionId } = await createTestConnectionAndSession();

      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/888/quick-view`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'REQUIRES_REAUTH');

      // Verifica no banco que conexão agora é 'requires_reauth'
      const conn = await repo.getConnection(connectionId);
      assert.strictEqual(conn?.status, 'requires_reauth');
    });

    // 19. 429 Upstream repassa 429 para cliente
    await runTest('19. Gateway Quick View: 429 upstream repassa 429 com erro apropriado', async () => {
      fakeBling.productHandler = () => ({
        status: 429,
        body: { error: { message: 'Too Many Requests' } },
        headers: { 'Retry-After': '5' }
      });
      fakeBling.stockHandler = undefined;
      const { gst } = await createTestConnectionAndSession();

      const res = await fetch(`${gatewayBaseUrl}/integrations/bling/products/4291/quick-view`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });
      assert.strictEqual(res.status, 429);
      const data = await res.json();
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.error, 'BLING_RATE_LIMITED');
    });

    // 20. Invalidação de cache ao desconectar
    await runTest('20. Gateway Disconnect: Desconexão limpa todo o cache de Quick View da conexão', async () => {
      fakeBling.productHandler = undefined;
      fakeBling.stockHandler = undefined;
      const { gst, connectionId } = await createTestConnectionAndSession();

      // Grava no cache do Gateway
      const res1 = await fetch(`${gatewayBaseUrl}/integrations/bling/products/cache_dis/quick-view`, {
        headers: { 'Authorization': `Bearer ${gst}` }
      });
      assert.strictEqual(res1.status, 200);

      // Desconecta via DELETE /integrations/bling
      const disRes = await fetch(`${gatewayBaseUrl}/integrations/bling`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${gst}` }
      });
      assert.strictEqual(disRes.status, 200);

      // Desconexão marca conexão no banco como disconnected
      const conn = await repo.getConnection(connectionId);
      assert.strictEqual(conn?.status, 'disconnected');
      assert.strictEqual(app.getQuickViewCache().get(connectionId, 'cache_dis'), null);
    });


    await runTest('Gateway → Background → estado → broadcast → Dock/Sidepanel, sem secrets', async () => {
      fakeBling.productHandler = (_req, id) => ({status: 200, body: {data: {id, nome: '<img src=x onerror=alert(1)>', fornecedor: {precoCusto: 8.42, access_token: 'UPSTREAM_SECRET'}, access_token: 'UPSTREAM_SECRET'}}});
      fakeBling.stockHandler = undefined;
      const {gst, grt} = await createTestConnectionAndSession();
      const local = new Map<string, any>(); const session = new Map<string, any>();
      const area = (map: Map<string, any>) => ({get: async (k: string) => map.get(k), set: async (k: string,v: any) => {map.set(k,v);}, remove: async (k: string) => {map.delete(k);}});
      const client = new GatewayClient({baseUrl: gatewayBaseUrl, localStorage: area(local), sessionStorage: area(session)});
      await client.saveSession({gatewaySessionToken: gst, gatewayRefreshToken: grt, sessionGeneration: 1, updatedAt: new Date().toISOString(), gstExpiresAt: new Date(Date.now()+600000).toISOString()});
      await tabContextManager.clearAll();
      await tabContextManager.registerOrUpdateTab(700,{platform:'bling',pageType:'product_form_edit',pageInstanceId:'e2e',detectedProduct:{id:'700'}});
      const oldChrome = (globalThis as any).chrome;
      const messages: any[] = [];
      const dock = new BlingShadowUi({onAction: () => {}});
      const panelStates: any[] = [];
      const panel = new SidepanelContextSync(async () => (await tabContextManager.getTabState(700)) ?? null, state => {panelStates.push(state);});
      (globalThis as any).chrome = {runtime:{sendMessage:async(message:any)=>{messages.push(message); await panel.refresh();}},tabs:{sendMessage:async(_tab:number,message:any)=>{messages.push(message);dock.update(message.uiState,message.pageType,message.detectedProduct);}}};
      try {
        const router = new MessageRouter(client); let response:any;
        await router.handleMessage({type:'BLING_GET_QUICK_VIEW',pageInstanceId:'e2e',payload:{productId:'700'}},{tab:{id:700} as chrome.tabs.Tab},res=>{response=res;});
        await panel.refresh();
        assert.strictEqual(response.ok,true);
        assert.ok(messages.some(m=>m.uiState?.quickViewLoading));
        assert.strictEqual((dock as any).currentUiState.quickView.costPrice,8.42);
        assert.strictEqual(panelStates.at(-1).uiState.quickView.stockInfo.virtualTotal,35);
        assert.strictEqual(formatQuickViewDisplay((dock as any).currentUiState.quickView).costText,'Custo: R$ 8,42');
        const boundary=JSON.stringify({response,messages});
        for(const secret of [gst,grt,'UPSTREAM_SECRET']) assert.strictEqual(boundary.includes(secret),false);
        assert.strictEqual('stock' in response.quickView,false);
        assert.strictEqual((await tabContextManager.getTabState(700))?.activeSheetId,undefined);
      } finally {(globalThis as any).chrome=oldChrome;}
    });

    await runTest('Gateway: request em voo não repovoa cache após disconnect real', async () => {
      const {gst,connectionId}=await createTestConnectionAndSession();
      const original=productClient.fetchQuickView;
      let release!: (value: any)=>void; let signal!: ()=>void;
      const started=new Promise<void>(resolve=>{signal=resolve;});
      productClient.fetchQuickView=async()=>{signal();return await new Promise(resolve=>{release=resolve;});};
      try {
        const pending=fetch(gatewayBaseUrl+'/integrations/bling/products/701/quick-view',{headers:{Authorization:'Bearer '+gst}});
        await started;
        const disconnected=await fetch(gatewayBaseUrl+'/integrations/bling',{method:'DELETE',headers:{Authorization:'Bearer '+gst}});
        assert.strictEqual(disconnected.status,200);
        release({productId:'701',costPrice:8.42,stockInfo:null,retrievedAt:new Date().toISOString()});
        const response=await pending;assert.strictEqual(response.status,401);
        assert.strictEqual(app.getQuickViewCache().get(connectionId,'701'),null);
      } finally {productClient.fetchQuickView=original;}
    });
  } finally {
    await app.close();
    await fakeBling.stop();
    await testPool.end();
  }

  // =========================================================================
  // PARTE 4: TESTES DO BACKGROUND, MENSAGERIA E STALE-RESPONSE BARRIER
  // =========================================================================

  function createMockSessionStorage() {
    const map = new Map<string, any>();
    return {
      get: async (key: string) => map.get(key) || null,
      set: async (key: string, val: any) => { map.set(key, val); },
      remove: async (key: string) => { map.delete(key); },
      dump: () => map
    };
  }

  await runTest('21. Background: chamadas sequenciais sempre consultam Gateway; não há cache local', async () => {
    const mockStorage = createMockSessionStorage();
    const client = new GatewayClient({ baseUrl: 'http://gateway.test', storage: mockStorage });
    await client.saveSession({
      gatewayRefreshToken: 'mock_grt',
      gatewaySessionToken: 'valid_gst_token',
      gstExpiresAt: new Date(Date.now() + 600000).toISOString(),
      sessionGeneration: 3, updatedAt: new Date().toISOString()
    });

    let fetchCount = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/quick-view')) {
        fetchCount++;
        return new Response(JSON.stringify({
          ok: true,
          quickView: {
            productId: '101',
            costPrice: 12.50,
            stockInfo: { physicalTotal: 10, virtualTotal: 8, deposits: [], retrievedAt: new Date().toISOString(), source: 'bling_erp' },
            retrievedAt: new Date().toISOString()
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input);
    };

    try {
      // 1ª chamada -> Gateway
      const res1 = await client.fetchBlingProductQuickView('101');
      assert.strictEqual(fetchCount, 1);
      assert.strictEqual(res1.costPrice, 12.50);

      // 2ª chamada -> Local Cache Hit
      const res2 = await client.fetchBlingProductQuickView('101');
      assert.strictEqual(fetchCount, 2); // Sempre consulta Gateway
      assert.strictEqual(res2.costPrice, 12.50);

      // clearSession expurga cache local
      await client.clearSession();

      // Reconfigura sessão com nova geração
      await client.saveSession({
        gatewayRefreshToken: 'mock_grt_4',
        gatewaySessionToken: 'valid_gst_token_gen4',
        gstExpiresAt: new Date(Date.now() + 600000).toISOString(),
        sessionGeneration: 4, updatedAt: new Date().toISOString()
      });

      // 3ª chamada -> Novo fetch
      const res3 = await client.fetchBlingProductQuickView('101');
      assert.strictEqual(fetchCount, 3);
      assert.strictEqual(res3.costPrice, 12.50);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest('22. MessageRouter: sender.tab.id continua sendo a autoridade estrita (rejeita requisições sem tab)', async () => {
    const mockClient = new GatewayClient();
    const router = new MessageRouter(mockClient);

    let respondedData: any = null;
    await router.handleMessage(
      {
        type: 'BLING_GET_QUICK_VIEW',
        pageInstanceId: 'inst_no_tab',
        payload: { productId: '123' }
      },
      {}, // sender sem tab.id
      (res) => { respondedData = res; }
    );

    assert.strictEqual(respondedData.ok, false);
    assert.strictEqual(respondedData.error, 'Remetente sem tabId confiável da plataforma.');
  });

  await runTest('23. Stale-Response Barrier: Navegação para novo pageInstanceId descarta resposta atrasada', async () => {
    await tabContextManager.clearAll();
    const tabId = 201;
    const pageInstanceId1 = 'inst_product_A';
    const pageInstanceId2 = 'inst_product_B';

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId: pageInstanceId1,
      url: 'https://bling.com.br/produtos/editar/1001',
      detectedProduct: { id: '1001' }
    });

    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    let resolveSlowFetch: (val: any) => void;
    const slowFetchPromise = new Promise((resolve) => { resolveSlowFetch = resolve; });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProductQuickView = async () => {
      markStarted();
      await slowFetchPromise;
      return {
        productId: '1001',
        sku: 'SKU-1001',
        name: 'Produto 1001',
        costPrice: 99.00,
        stockInfo: null,
          retrievedAt: new Date().toISOString()
      };
    };

    const router = new MessageRouter(mockClient);

    // Inicia request para produto A
    let responseA: any = null;
    const requestAPromise = router.handleMessage(
      {
        type: 'BLING_GET_QUICK_VIEW',
        pageInstanceId: pageInstanceId1,
        payload: { productId: '1001' }
      },
      { tab: { id: tabId } as chrome.tabs.Tab },
      (res) => { responseA = res; }
    );

    await started;
    // Usuário navega para o produto B antes de A terminar!
    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId: pageInstanceId2,
      url: 'https://bling.com.br/produtos/editar/1002',
      detectedProduct: { id: '1002' }
    });

    // Agora o fetch de A termina
    resolveSlowFetch!({});
    await requestAPromise;

    // Resposta de A foi descartada como stale
    assert.strictEqual(responseA.ok, false);
    assert.ok(responseA.warning?.includes('descartada') || responseA.error?.includes('expirado'));

    // Estado da aba permanece limpo para o produto B, sem poluição de A
    const tabState = await tabContextManager.getTabState(tabId);
    assert.strictEqual(tabState?.pageInstanceId, pageInstanceId2);
    assert.strictEqual(tabState?.uiState.quickView, null);
  });

  await runTest('24. Stale-Response Barrier: Troca de productId dentro da mesma aba descarta resposta antiga', async () => {
    await tabContextManager.clearAll();
    const tabId = 202;
    const pageInstanceId = 'inst_spa_swap';

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/2001',
      detectedProduct: { id: '2001' }
    });

    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    let resolveSlowFetch: (val: any) => void;
    const slowFetchPromise = new Promise((resolve) => { resolveSlowFetch = resolve; });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProductQuickView = async () => {
      markStarted();
      await slowFetchPromise;
      return {
        productId: '2001',
        sku: 'SKU-2001',
        name: 'Produto 2001',
        costPrice: 15.00,
        stockInfo: null,
          retrievedAt: new Date().toISOString()
      };
    };

    const router = new MessageRouter(mockClient);

    let responseA: any = null;
    const requestAPromise = router.handleMessage(
      {
        type: 'BLING_GET_QUICK_VIEW',
        pageInstanceId,
        payload: { productId: '2001' }
      },
      { tab: { id: tabId } as chrome.tabs.Tab },
      (res) => { responseA = res; }
    );

    await started;
    // Contexto é atualizado com novo produto detectado 2002
    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/2002',
      detectedProduct: { id: '2002' }
    });

    resolveSlowFetch!({});
    await requestAPromise;

    assert.strictEqual(responseA.ok, false);
    assert.ok(responseA.warning?.includes('descartada') || responseA.error?.includes('expirado'));
  });

  // =========================================================================
  // PARTE 5: RECONCILIAÇÃO E NÃO-SOBRESCRITA DA CentralProductSheet
  // =========================================================================

  await runTest('25. Reconciliação: Quick View/Stock não sobrescreve valores user_manual na ficha', () => {
    const existingSheet = createInitialSheet();
    // Usuário definiu manualmente o custo como 120.00
    existingSheet.costPrice = {
      value: 120.00,
      status: 'edited',
      confidence: 1,
      source: 'user_manual',
      evidence: { capturedAt: new Date().toISOString() }
    };
    // Usuário definiu manualmente estoque como 99
    existingSheet.stockInfo = {
      value: {
        physicalTotal: 99,
        virtualTotal: 99,
        deposits: [],
        retrievedAt: new Date().toISOString(),
        source: 'bling_erp'
      },
      status: 'edited',
      confidence: 1,
      source: 'user_manual',
      evidence: { capturedAt: new Date().toISOString() }
    };

    // Patch vindo do Bling com custo 50 e estoque 10
    const blingPatch: any = {
      costPrice: createAuditedField(50.00, 'bling_erp', 1, 'pending_review'),
      stockInfo: createAuditedField({
        physicalTotal: 10,
        virtualTotal: 10,
        deposits: [],
        retrievedAt: new Date().toISOString(),
        source: 'bling_erp'
      }, 'bling_erp', 1, 'pending_review')
    };

    const reconciled = reconcileBlingPatch(existingSheet, {
      patch: blingPatch,
      warnings: [],
      unknownFields: []
    });

    // Valores do usuário são estritamente PRESERVADOS
    assert.strictEqual(reconciled.sheet.costPrice.value, 120.00);
    assert.strictEqual(reconciled.sheet.costPrice.source, 'user_manual');
    assert.strictEqual(reconciled.sheet.stockInfo?.value?.physicalTotal, 99);
    assert.strictEqual(reconciled.sheet.stockInfo?.source, 'user_manual');

    // Conflitos são registrados de forma auditável
    assert.strictEqual(reconciled.conflictedFields.length, 2);
  });

  await runTest('26. Quick View isolado executa router e não grava ficha', async () => {
    const originalChrome = (globalThis as any).chrome;
    const writes: string[] = [];
    (globalThis as any).chrome = { storage: { local: {
      get: async () => ({}), set: async (value: object) => { writes.push(...Object.keys(value)); }
    } } };
    try {
      await tabContextManager.clearAll();
      await tabContextManager.registerOrUpdateTab(999, { platform: 'bling', pageType: 'product_form_edit', pageInstanceId: 'page', detectedProduct: { id: '999' } });
      const client = new GatewayClient();
      client.fetchBlingProductQuickView = async () => ({productId: '999', costPrice: 15, stockInfo: null, retrievedAt: new Date().toISOString()});
      const router = new MessageRouter(client);
      let response: any;
      await router.handleMessage({ type: 'BLING_GET_QUICK_VIEW', pageInstanceId: 'page', payload: {productId: '999'} }, {tab: {id: 999} as chrome.tabs.Tab}, res => { response = res; });
      assert.strictEqual(response.ok, true);
      assert.strictEqual((await tabContextManager.getTabState(999))?.uiState.quickView?.costPrice, 15);
      assert.deepStrictEqual(writes, []);
    } finally { (globalThis as any).chrome = originalChrome; }
  });

  // =========================================================================
  // PARTE 6: UI, TEXTCONTENT, FACT-OR-OMIT E ANTI-XSS
  // =========================================================================

  await runTest('27. UI Dock & Quick View Formatting: Fact-or-Omit e sem sintetizar zero para dados ausentes', () => {
    // 1. Caso Normal: Custo positivo e estoque positivo
    const display1 = formatQuickViewDisplay({
      costPrice: 8.42,
      stockInfo: { physicalTotal: 37, virtualTotal: 35, deposits: [], retrievedAt: '', source: 'bling_erp' },
      productId: '1',
      retrievedAt: ''
    });
    assert.strictEqual(display1.stockText, 'Estoque: 35 disp. (37 físico)');
    assert.strictEqual(display1.costText, 'Custo: R$ 8,42');
    assert.strictEqual(display1.hasStock, true);
    assert.strictEqual(display1.hasCost, true);

    // 2. Caso Zero Explícito: Custo zero e estoque zero
    const displayZero = formatQuickViewDisplay({
      costPrice: 0,
      stockInfo: { physicalTotal: 0, virtualTotal: 0, deposits: [], retrievedAt: '', source: 'bling_erp' },
      productId: '2',
      retrievedAt: ''
    });
    assert.strictEqual(displayZero.stockText, 'Estoque: 0 disp. (0 físico)');
    assert.strictEqual(displayZero.costText, 'Custo: R$ 0,00');
    assert.strictEqual(displayZero.hasStock, true);
    assert.strictEqual(displayZero.hasCost, true);

    // 3. Caso Ausente: Custo null e estoque null -> NUNCA EXIBE ZERO SINTÉTICO
    const displayMissing = formatQuickViewDisplay({
      costPrice: null,
      stockInfo: null,
      productId: '3',
      retrievedAt: ''
    });
    assert.strictEqual(displayMissing.stockText, 'Estoque: Não informado');
    assert.strictEqual(displayMissing.costText, 'Custo: Não informado');
    assert.strictEqual(displayMissing.hasStock, false);
    assert.strictEqual(displayMissing.hasCost, false);

    // 4. Caso null/undefined de quickView
    const displayNull = formatQuickViewDisplay(null);
    assert.strictEqual(displayNull.stockText, 'Estoque: Não informado');
    assert.strictEqual(displayNull.costText, 'Custo: Não informado');


  });

}
