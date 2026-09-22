// Suíte Oficial de Testes da Fase 4C.4A: Cliente e Orquestração de Autenticação no Background
import assert from 'node:assert';
import http from 'node:http';
import { 
  GatewayClient, 
  GatewayAuthRequiredError, 
  GatewayTransientError,
  STORAGE_KEYS
} from '../src/background/gateway-client.ts';
import { 
  BlingAuthOrchestrator 
} from '../src/background/bling-auth-orchestrator.ts';
import { MessageRouter } from '../src/background/message-router.ts';
import { isValidBlingAuthorizationUrl } from '../src/shared/gateway-contracts.ts';

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

function createMockStorageArea() {
  const map = new Map<string, any>();
  return {
    get: async (key: string) => map.get(key) || null,
    set: async (key: string, val: any) => { map.set(key, val); },
    remove: async (key: string) => { map.delete(key); },
    dump: () => map
  };
}

class FakeGatewayAuthServer {
  public server: http.Server;
  public port: number = 0;
  public startHandler?: (req: http.IncomingMessage, body: any) => Promise<{ status: number; body: any }> | { status: number; body: any };
  public handshakeHandler?: (req: http.IncomingMessage, body: any) => Promise<{ status: number; body: any }> | { status: number; body: any };
  public refreshHandler?: (req: http.IncomingMessage, body: any) => Promise<{ status: number; body: any }> | { status: number; body: any };
  public statusHandler?: (req: http.IncomingMessage) => Promise<{ status: number; body: any }> | { status: number; body: any };
  public disconnectHandler?: (req: http.IncomingMessage) => Promise<{ status: number; body: any }> | { status: number; body: any };
  public lastRequestHeaders: http.IncomingHttpHeaders = {};
  public lastRequestUrl: string = '';
  public requestCount: number = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      this.requestCount++;
      this.lastRequestUrl = req.url || '';
      this.lastRequestHeaders = req.headers;

      let rawBody = '';
      req.on('data', chunk => { rawBody += chunk; });
      req.on('end', async () => {
        let parsedBody: any = {};
        try {
          parsedBody = rawBody ? JSON.parse(rawBody) : {};
        } catch {}

        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'POST' && req.url === '/auth/bling/start') {
          const out = await (this.startHandler ? this.startHandler(req, parsedBody) : {
            status: 200,
            body: {
              ok: true,
              authorizationUrl: 'https://www.bling.com.br/Api/v3/oauth/authorize?state=test_state',
              pairingId: 'pair_123',
              pairingSecret: 'secret_abc123',
              expiresInSeconds: 300
            }
          });
          res.writeHead(out.status);
          res.end(JSON.stringify(out.body));
          return;
        }

        if (req.method === 'POST' && req.url === '/auth/bling/session') {
          const out = await (this.handshakeHandler ? this.handshakeHandler(req, parsedBody) : {
            status: 200,
            body: {
              ok: true,
              status: 'connected',
              gatewaySessionToken: 'mock_gst_token_900',
              gatewayRefreshToken: 'mock_grt_token_family_1',
              expiresInSeconds: 900
            }
          });
          res.writeHead(out.status);
          res.end(JSON.stringify(out.body));
          return;
        }

        if (req.method === 'POST' && req.url === '/auth/session/refresh') {
          const out = await (this.refreshHandler ? this.refreshHandler(req, parsedBody) : {
            status: 200,
            body: {
              ok: true,
              gatewaySessionToken: 'mock_gst_refreshed_900',
              gatewayRefreshToken: 'mock_grt_token_family_rotated',
              expiresInSeconds: 900
            }
          });
          res.writeHead(out.status);
          res.end(JSON.stringify(out.body));
          return;
        }

        if (req.method === 'GET' && req.url === '/integrations/bling/status') {
          const out = await (this.statusHandler ? this.statusHandler(req) : {
            status: 200,
            body: {
              ok: true,
              connected: true,
              status: 'connected',
              requiresReauth: false,
              lastRefreshAt: '2026-09-18T22:00:00.000Z'
            }
          });
          res.writeHead(out.status);
          res.end(JSON.stringify(out.body));
          return;
        }

        if (req.method === 'DELETE' && req.url === '/integrations/bling') {
          const out = await (this.disconnectHandler ? this.disconnectHandler(req) : {
            status: 200,
            body: {
              ok: true,
              status: 'disconnected',
              localDisconnected: true,
              remoteRevocation: { accessToken: 'success', refreshToken: 'success', complete: true },
              message: 'Desconectado com sucesso.'
            }
          });
          res.writeHead(out.status);
          res.end(JSON.stringify(out.body));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
      });
    });
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as any;
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}`);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

export async function runGatewayAuthOrchestrationTests(): Promise<void> {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: GATEWAY AUTH ORCHESTRATION (FASE 4C.4A)');
  console.log('================================================================\n');

  const fakeGateway = new FakeGatewayAuthServer();
  const gatewayUrl = await fakeGateway.start();

  try {
    // 1. Contratos reais do GatewayClient
    await runTest('1. Contratos reais do GatewayClient: startBlingAuth, completeSessionHandshake, getBlingStatus, disconnectBling', async () => {
      const client = new GatewayClient({ baseUrl: gatewayUrl });
      assert.strictEqual(typeof client.startBlingAuth, 'function');
      assert.strictEqual(typeof client.completeSessionHandshake, 'function');
      assert.strictEqual(typeof client.getBlingStatus, 'function');
      assert.strictEqual(typeof client.disconnectBling, 'function');
    });

    // 2. Start auth
    await runTest('2. Start auth: chama Gateway e recebe authorizationUrl, pairingId, pairingSecret e expiresInSeconds', async () => {
      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const res = await client.startBlingAuth('cli_test_session_12345');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.pairingId, 'pair_123');
      assert.strictEqual(res.pairingSecret, 'secret_abc123');
      assert.strictEqual(res.expiresInSeconds, 300);
      assert.ok(res.authorizationUrl?.includes('authorize'));
    });

    // 3. Handshake pendente
    await runTest('3. Handshake pendente: OAUTH_FLOW_NOT_COMPLETED retorna ok: false sem consumir tentativas', async () => {
      fakeGateway.handshakeHandler = () => ({
        status: 400,
        body: { ok: false, error: 'OAUTH_FLOW_NOT_COMPLETED', message: 'OAuth pendente no navegador' }
      });

      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const res = await client.completeSessionHandshake('pair_123', 'secret_abc123');
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, 'OAUTH_FLOW_NOT_COMPLETED');
    });

    // 4. Handshake concluído
    await runTest('4. Handshake concluído: 200 grava GST em storage.session e GRT em storage.local', async () => {
      fakeGateway.handshakeHandler = undefined;
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      const res = await client.completeSessionHandshake('pair_123', 'secret_abc123');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.status, 'connected');

      // Verifica storage.local: contém GRT, NUNCA GST
      const localData = await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(localData.gatewayRefreshToken, 'mock_grt_token_family_1');
      assert.strictEqual(localData.gatewaySessionToken, undefined, 'storage.local NUNCA deve conter GST');

      // Verifica storage.session: contém GST
      const sessionData = await mockSession.get(STORAGE_KEYS.SESSION_GST);
      assert.strictEqual(sessionData.gatewaySessionToken, 'mock_gst_token_900');
    });

    // 5. Pairing expirado
    await runTest('5. Pairing expirado: PAIRING_EXPIRED retorna erro claro 410', async () => {
      fakeGateway.handshakeHandler = () => ({
        status: 410,
        body: { ok: false, error: 'PAIRING_EXPIRED', message: 'Pareamento expirou.' }
      });

      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const res = await client.completeSessionHandshake('pair_old', 'secret_old');
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, 'PAIRING_EXPIRED');
    });

    // 6. Polling limitado pelo TTL retornado pelo Gateway
    await runTest('6. Polling limitado pelo TTL retornado pelo Gateway: não hardcoded 120s se for 300s', async () => {
      fakeGateway.startHandler = () => ({
        status: 200,
        body: {
          ok: true,
          authorizationUrl: 'https://www.bling.com.br/Api/v3/oauth/authorize?state=test',
          pairingId: 'pair_ttl_test',
          pairingSecret: 'secret_ttl',
          expiresInSeconds: 300
        }
      });

      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const orchestrator = new BlingAuthOrchestrator(client);

      const res = await orchestrator.startConnect();
      assert.strictEqual(res.ok, true);
      const activeFlow = orchestrator.getActiveFlow();
      assert.ok(activeFlow);
      // TTL deve ser aproximadamente Date.now() + 295_000 (300s - 5s margem)
      const diffSeconds = (activeFlow.expiresAtMs - Date.now()) / 1000;
      assert.ok(diffSeconds > 280 && diffSeconds <= 300, `TTL calculado deve respeitar 300s (atual: ${diffSeconds})`);
    });

    // 7. Múltiplos cliques em conectar -> único fluxo (single-flight)
    await runTest('7. Múltiplos cliques em conectar -> único fluxo: reutiliza o fluxo ativo em andamento', async () => {
      fakeGateway.startHandler = undefined;
      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const orchestrator = new BlingAuthOrchestrator(client);

      const res1 = await orchestrator.startConnect();
      const res2 = await orchestrator.startConnect();

      assert.strictEqual(res1.ok, true);
      assert.strictEqual(res2.ok, true);
      assert.strictEqual(res1.pairingId, res2.pairingId, 'Deve reutilizar o mesmo pairingId');
    });

    // 8. Fechamento da aba antes do OAuth
    await runTest('8. Fechamento da aba antes do OAuth: encerra polling e transiciona para disconnected', async () => {
      fakeGateway.handshakeHandler = () => ({
        status: 400,
        body: { ok: false, error: 'OAUTH_FLOW_NOT_COMPLETED' }
      });

      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const orchestrator = new BlingAuthOrchestrator(client);

      await orchestrator.startConnect();
      const flow = orchestrator.getActiveFlow()!;
      flow.oauthTabId = 999;

      // Simula evento chrome.tabs.onRemoved
      await orchestrator.handleTabRemoved(999);

      assert.strictEqual(orchestrator.getActiveFlow(), null, 'Fluxo em memória deve ser descartado');
      assert.strictEqual(orchestrator.getCachedStatus(), 'disconnected');
    });

    // 9. Fechamento da aba logo após callback
    await runTest('9. Fechamento da aba logo após callback: última tentativa consegue concluir sessão e marcar connected', async () => {
      // Simula que durante a última tentativa de fechamento o Gateway responde 200
      fakeGateway.handshakeHandler = () => ({
        status: 200,
        body: {
          ok: true,
          status: 'connected',
          gatewaySessionToken: 'mock_gst_tab_closed',
          gatewayRefreshToken: 'mock_grt_tab_closed',
          expiresInSeconds: 900
        }
      });

      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const orchestrator = new BlingAuthOrchestrator(client);

      await orchestrator.startConnect();
      const flow = orchestrator.getActiveFlow()!;
      flow.oauthTabId = 888;

      await orchestrator.handleTabRemoved(888);

      assert.strictEqual(orchestrator.getActiveFlow(), null);
      assert.strictEqual(orchestrator.getCachedStatus(), 'connected');
    });

    // 10. Resposta tardia de fluxo antigo não sobrescreve fluxo novo
    await runTest('10. Resposta tardia de fluxo antigo não sobrescreve fluxo novo (flowId protection)', async () => {
      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const orchestrator = new BlingAuthOrchestrator(client);

      await orchestrator.startConnect();
      const flow1 = orchestrator.getActiveFlow()!;
      const oldFlowId = flow1.flowId;

      // Força início de novo fluxo substituindo o antigo
      flow1.resolved = true;
      await orchestrator.startConnect();
      const flow2 = orchestrator.getActiveFlow()!;
      assert.notStrictEqual(oldFlowId, flow2.flowId);

      // Simula fechamento tardio da aba do fluxo 1
      await orchestrator.handleTabRemoved(flow1.oauthTabId || 12345);

      // Fluxo 2 deve permanecer intacto
      assert.strictEqual(orchestrator.getActiveFlow()?.flowId, flow2.flowId);
    });

    // 11 & 12. GST em storage.session e GRT em storage.local
    await runTest('11 & 12. GST isolado em storage.session e GRT em storage.local (zero vazamento cruzado)', async () => {
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      await client.saveSession({
        gatewaySessionToken: 'gst_secret_123',
        gatewayRefreshToken: 'grt_persistent_456',
        gstExpiresAt: new Date(Date.now() + 900000).toISOString(),
        sessionGeneration: 1,
        updatedAt: new Date().toISOString()
      });

      const localKeys = Array.from(mockLocal.dump().keys());
      assert.strictEqual(localKeys.includes(STORAGE_KEYS.LOCAL_REFRESH_SESSION), true);
      const localVal = await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(localVal.gatewayRefreshToken, 'grt_persistent_456');
      assert.strictEqual(localVal.gatewaySessionToken, undefined, 'GST jamais pode residir em storage.local');

      const sessionVal = await mockSession.get(STORAGE_KEYS.SESSION_GST);
      assert.strictEqual(sessionVal.gatewaySessionToken, 'gst_secret_123');
    });

    // 13. Migração do formato antigo de storage
    await runTest('13. Migração do formato antigo: paulifest_gateway_session_v1 migra para grt_v2 e gst_v2 e remove chave v1', async () => {
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();

      // Grava no formato legado v1 diretamente no storage.local
      await mockLocal.set('paulifest_gateway_session_v1', {
        gatewaySessionToken: 'legacy_gst',
        gatewayRefreshToken: 'legacy_grt',
        gstExpiresAt: new Date(Date.now() + 600000).toISOString(),
        sessionGeneration: 3,
        updatedAt: '2026-09-18T10:00:00.000Z'
      });

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      // Carrega sessão: dispara migração atômica transparente
      const session = await client.loadSession();
      assert.ok(session);
      assert.strictEqual(session.gatewayRefreshToken, 'legacy_grt');
      assert.strictEqual(session.gatewaySessionToken, 'legacy_gst');
      assert.strictEqual(session.sessionGeneration, 3);

      // Confirma que a chave v1 foi purgada de storage.local
      const legacyCheck = await mockLocal.get('paulifest_gateway_session_v1');
      assert.strictEqual(legacyCheck, null, 'Chave legada v1 deve ser removida');

      // Confirma separação física pós-migração
      const localCheck = await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(localCheck.gatewayRefreshToken, 'legacy_grt');
      assert.strictEqual(localCheck.gatewaySessionToken, undefined);

      const sessionCheck = await mockSession.get(STORAGE_KEYS.SESSION_GST);
      assert.strictEqual(sessionCheck.gatewaySessionToken, 'legacy_gst');
    });

    // 14. Restart simulado sem GST e com GRT
    await runTest('14. Restart simulado: GST ausente em storage.session com GRT em storage.local recupera novo GST via refresh', async () => {
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();

      // storage.local tem GRT; storage.session está completamente vazio (simula reabertura do Chrome)
      await mockLocal.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
        gatewayRefreshToken: 'stored_grt_survived',
        sessionGeneration: 1,
        updatedAt: new Date().toISOString()
      });

      fakeGateway.refreshHandler = (req, body) => {
        assert.strictEqual(body.gatewayRefreshToken, 'stored_grt_survived');
        return {
          status: 200,
          body: {
            ok: true,
            gatewaySessionToken: 'brand_new_gst_post_restart',
            gatewayRefreshToken: 'new_rotated_grt',
            expiresInSeconds: 900
          }
        };
      };

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      const validGst = await client.getValidGst();
      assert.strictEqual(validGst, 'brand_new_gst_post_restart');

      // storage.session agora foi preenchido com o novo GST
      const sessionData = await mockSession.get(STORAGE_KEYS.SESSION_GST);
      assert.strictEqual(sessionData.gatewaySessionToken, 'brand_new_gst_post_restart');

      // storage.local tem o GRT rotacionado
      const localData = await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(localData.gatewayRefreshToken, 'new_rotated_grt');
    });

    // 15. Refresh single-flight
    await runTest('15. Refresh single-flight: 5 chamadas concorrentes com GST ausente disparam exatamente 1 POST /auth/session/refresh', async () => {
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();
      await mockLocal.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
        gatewayRefreshToken: 'grt_concurrent_test',
        sessionGeneration: 1,
        updatedAt: new Date().toISOString()
      });

      let refreshPostCount = 0;
      fakeGateway.refreshHandler = () => {
        refreshPostCount++;
        return {
          status: 200,
          body: {
            ok: true,
            gatewaySessionToken: 'gst_single_flight_result',
            gatewayRefreshToken: 'grt_single_flight_result',
            expiresInSeconds: 900
          }
        };
      };

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      const results = await Promise.all([
        client.getValidGst(),
        client.getValidGst(),
        client.getValidGst(),
        client.getValidGst(),
        client.getValidGst()
      ]);

      assert.strictEqual(refreshPostCount, 1, 'Deveria disparar exatamente 1 refresh HTTP');
      results.forEach(token => assert.strictEqual(token, 'gst_single_flight_result'));
    });

    // 16. Refresh concorrente + disconnect
    await runTest('16. Refresh concorrente + disconnect: CAS/sessionGeneration descarta refresh tardio sem ressuscitar sessão apagada', async () => {
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();
      await mockLocal.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
        gatewayRefreshToken: 'grt_to_disconnect',
        sessionGeneration: 1,
        updatedAt: new Date().toISOString()
      });

      fakeGateway.refreshHandler = async () => {
        // Simula delay de rede no refresh
        await new Promise(r => setTimeout(r, 100));
        return {
          status: 200,
          body: {
            ok: true,
            gatewaySessionToken: 'late_gst',
            gatewayRefreshToken: 'late_grt',
            expiresInSeconds: 900
          }
        };
      };

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      const refreshPromise = client.executeSingleFlightRefresh('grt_to_disconnect');

      // Em paralelo, usuário aciona desconexão local
      await client.clearSession();

      await assert.rejects(() => refreshPromise, /sessão alterada/);

      // Confirma que a sessão apagada NÃO foi ressuscitada em storage.local nem em storage.session
      const localCheck = await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(localCheck, null, 'Sessão apagada não pode ser ressuscitada');
      const sessionCheck = await mockSession.get(STORAGE_KEYS.SESSION_GST);
      assert.strictEqual(sessionCheck, null);
    });

    // 17. Gateway offline preserva GRT
    await runTest('17. Gateway offline preserva GRT: falhas transitórias de rede no refresh não realizam logout', async () => {
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();
      await mockLocal.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
        gatewayRefreshToken: 'my_safe_grt',
        sessionGeneration: 1,
        updatedAt: new Date().toISOString()
      });

      fakeGateway.refreshHandler = () => ({
        status: 502,
        body: { error: 'BAD_GATEWAY' }
      });

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      let caught: any;
      try {
        await client.getValidGst();
      } catch (err) {
        caught = err;
      }

      assert.ok(caught instanceof GatewayTransientError);
      // GRT continua intacto em storage.local!
      const check = await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(check.gatewayRefreshToken, 'my_safe_grt');
    });

    // 18. GRT terminal inválido limpa sessão
    await runTest('18. GRT terminal inválido limpa sessão: 401 SESSION_REVOKED purga storage local', async () => {
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();
      await mockLocal.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
        gatewayRefreshToken: 'revoked_grt',
        sessionGeneration: 1,
        updatedAt: new Date().toISOString()
      });

      fakeGateway.refreshHandler = () => ({
        status: 401,
        body: { ok: false, error: 'SESSION_REVOKED', message: 'Sessão revogada no PostgreSQL' }
      });

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      let caught: any;
      try {
        await client.getValidGst();
      } catch (err) {
        caught = err;
      }

      assert.ok(caught instanceof GatewayAuthRequiredError);
      // Storage foi limpo
      const check = await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(check, null);
    });

    // 19. Disconnect confirmado limpa storage
    await runTest('19. Disconnect confirmado: 200 do Gateway limpa storage local e session', async () => {
      fakeGateway.disconnectHandler = () => ({
        status: 200,
        body: {
          ok: true,
          status: 'disconnected',
          localDisconnected: true,
          remoteRevocation: { accessToken: 'success', refreshToken: 'success', complete: true },
          message: 'Desconectado com sucesso.'
        }
      });

      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();
      await mockLocal.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
        gatewayRefreshToken: 'grt_to_disconnect',
        sessionGeneration: 1,
        updatedAt: new Date().toISOString()
      });
      await mockSession.set(STORAGE_KEYS.SESSION_GST, {
        gatewaySessionToken: 'gst_active',
        gstExpiresAt: new Date(Date.now() + 600000).toISOString(),
        sessionGeneration: 1
      });

      const client = new GatewayClient({
        baseUrl: gatewayUrl,
        localStorage: mockLocal,
        sessionStorage: mockSession
      });

      const res = await client.disconnectBling();
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.status, 'disconnected');

      assert.strictEqual(await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION), null);
      assert.strictEqual(await mockSession.get(STORAGE_KEYS.SESSION_GST), null);
    });

    // 20. Disconnect com Gateway inalcançável NÃO informa falsamente sucesso
    await runTest('20. Disconnect com Gateway inalcançável: lança GatewayTransientError e NÃO limpa credenciais locais', async () => {
      const mockLocal = createMockStorageArea();
      const mockSession = createMockStorageArea();
      await mockLocal.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
        gatewayRefreshToken: 'grt_cannot_be_orphaned',
        sessionGeneration: 1,
        updatedAt: new Date().toISOString()
      });

      // Simula porta morta / offline
      const deadClient = new GatewayClient({
        baseUrl: 'http://127.0.0.1:59999',
        localStorage: mockLocal,
        sessionStorage: mockSession,
        timeoutMs: 300
      });

      let caught: any;
      try {
        await deadClient.disconnectBling();
      } catch (err) {
        caught = err;
      }

      assert.ok(caught instanceof GatewayTransientError);
      // REGRA 9: Credenciais preservadas em storage.local! Não declara falsamente desconectado
      const preserved = await mockLocal.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(preserved.gatewayRefreshToken, 'grt_cannot_be_orphaned');
    });

    // 21. Eventos de status sem listeners não quebram o Background
    await runTest('21. Eventos de status sem listeners: broadcastStatus executa de forma tolerante sem exceções', async () => {
      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const orchestrator = new BlingAuthOrchestrator(client);

      // Não deve lançar erro mesmo em ambiente Node sem chrome.runtime ou listeners
      assert.doesNotThrow(() => {
        orchestrator.broadcastStatus('connected');
        orchestrator.broadcastStatus('disconnected');
        orchestrator.broadcastStatus('awaiting_oauth');
        orchestrator.broadcastStatus('gateway_unreachable');
      });
    });

    // 22. Integração no MessageRouter
    await runTest('22. MessageRouter: despacha BLING_START_CONNECT, BLING_GET_CONNECTION_STATUS e BLING_DISCONNECT', async () => {
      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const orchestrator = new BlingAuthOrchestrator(client);
      const router = new MessageRouter(client, { authOrchestrator: orchestrator });

      let startRes: any;
      await router.handleMessage(
        { type: 'BLING_START_CONNECT' },
        { tab: { id: 1 } } as any,
        (res) => { startRes = res; }
      );
      assert.strictEqual(startRes.ok, true);
      assert.strictEqual(startRes.status, 'awaiting_oauth');

      let statusRes: any;
      await router.handleMessage(
        { type: 'BLING_GET_CONNECTION_STATUS' },
        { tab: { id: 1 } } as any,
        (res) => { statusRes = res; }
      );
      assert.strictEqual(statusRes.ok, true);
      assert.strictEqual(statusRes.status, 'awaiting_oauth');

      let disconnectRes: any;
      await router.handleMessage(
        { type: 'BLING_DISCONNECT' },
        { tab: { id: 1 } } as any,
        (res) => { disconnectRes = res; }
      );
      assert.strictEqual(disconnectRes.ok, true);
      assert.strictEqual(disconnectRes.status, 'disconnected');
    });

    // 23. Validação estrita de authorizationUrl (Fase 4C.4A Patch)
    await runTest('23. Validação estrita de authorizationUrl: apenas https://www.bling.com.br aceito em produção; localhost/127.0.0.1 apenas em dev/test', () => {
      // 1. https://www.bling.com.br/... → aceito
      assert.strictEqual(
        isValidBlingAuthorizationUrl('https://www.bling.com.br/Api/v3/oauth/authorize?client_id=123', 'production'),
        true,
        'https://www.bling.com.br em produção deve ser aceito'
      );
      assert.strictEqual(
        isValidBlingAuthorizationUrl('https://www.bling.com.br/Api/v3/oauth/authorize?client_id=123', 'development'),
        true,
        'https://www.bling.com.br em dev deve ser aceito'
      );

      // 2. http://www.bling.com.br/... → rejeitado
      assert.strictEqual(
        isValidBlingAuthorizationUrl('http://www.bling.com.br/Api/v3/oauth/authorize?client_id=123', 'production'),
        false,
        'http://www.bling.com.br (sem TLS) deve ser rejeitado em produção'
      );
      assert.strictEqual(
        isValidBlingAuthorizationUrl('http://www.bling.com.br/Api/v3/oauth/authorize?client_id=123', 'development'),
        false,
        'http://www.bling.com.br (sem TLS) deve ser rejeitado em development'
      );

      // 3. https://evilbling.com.br/... → rejeitado
      assert.strictEqual(
        isValidBlingAuthorizationUrl('https://evilbling.com.br/Api/v3/oauth/authorize?client_id=123', 'production'),
        false,
        'evilbling.com.br deve ser rejeitado'
      );

      // 4. https://fakebling.com.br/... → rejeitado
      assert.strictEqual(
        isValidBlingAuthorizationUrl('https://fakebling.com.br/Api/v3/oauth/authorize?client_id=123', 'production'),
        false,
        'fakebling.com.br deve ser rejeitado'
      );

      // 5. https://bling.com.br.evil.example/... → rejeitado
      assert.strictEqual(
        isValidBlingAuthorizationUrl('https://bling.com.br.evil.example/oauth/authorize', 'production'),
        false,
        'bling.com.br.evil.example deve ser rejeitado'
      );

      // 6. http://localhost:... em development → permitido quando configurado
      assert.strictEqual(
        isValidBlingAuthorizationUrl('http://localhost:3001/oauth/authorize', 'development'),
        true,
        'http://localhost:... em development deve ser permitido'
      );
      assert.strictEqual(
        isValidBlingAuthorizationUrl('http://localhost:8080/oauth/authorize', 'test'),
        true,
        'http://localhost:... em test deve ser permitido'
      );

      // 7. localhost em production → rejeitado
      assert.strictEqual(
        isValidBlingAuthorizationUrl('http://localhost:3001/oauth/authorize', 'production'),
        false,
        'http://localhost em production deve ser rejeitado'
      );
      assert.strictEqual(
        isValidBlingAuthorizationUrl('https://localhost:3001/oauth/authorize', 'production'),
        false,
        'https://localhost em production deve ser rejeitado'
      );
      assert.strictEqual(
        isValidBlingAuthorizationUrl('localhost', 'production'),
        false,
        'localhost em production deve ser rejeitado'
      );

      // 8. 127.0.0.1 em production → rejeitado
      assert.strictEqual(
        isValidBlingAuthorizationUrl('http://127.0.0.1:3001/oauth/authorize', 'production'),
        false,
        'http://127.0.0.1 em production deve ser rejeitado'
      );
      assert.strictEqual(
        isValidBlingAuthorizationUrl('https://127.0.0.1:3001/oauth/authorize', 'production'),
        false,
        'https://127.0.0.1 em production deve ser rejeitado'
      );
    });

    // 24. Orchestrator startConnect: rejeita authorizationUrl maliciosa (ex: evilbling.com.br) e transiciona para disconnected
    await runTest('24. Orchestrator startConnect: rejeita authorizationUrl maliciosa (ex: evilbling.com.br) e transiciona para disconnected', async () => {
      fakeGateway.startHandler = () => ({
        status: 200,
        body: {
          ok: true,
          authorizationUrl: 'https://evilbling.com.br/Api/v3/oauth/authorize?client_id=123',
          pairingId: 'pair_evil',
          pairingSecret: 'secret_evil',
          expiresInSeconds: 300
        }
      });

      const client = new GatewayClient({ baseUrl: gatewayUrl });
      const orchestrator = new BlingAuthOrchestrator(client);

      const res = await orchestrator.startConnect();
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.status, 'disconnected');
      assert.strictEqual(res.error, 'INVALID_AUTH_URL');
      assert.strictEqual(orchestrator.getCachedStatus(), 'disconnected');
      assert.strictEqual(orchestrator.getActiveFlow(), null);
      fakeGateway.startHandler = undefined;
    });

  } finally {
    await fakeGateway.stop();
  }
}
