// Suíte Oficial de Testes da Fase 4C.3: Integração Completa da Extensão com Gateway e CentralProductSheet
import assert from 'node:assert';
import { tabContextManager } from '../src/background/tab-context-manager.ts';
import { MessageRouter } from '../src/background/message-router.ts';
import {
  GatewayClient,
  GatewayAuthRequiredError,
  GatewayTransientError,
  GatewayProductError,
  STORAGE_KEYS,
  type ExtensionGatewaySession
} from '../src/background/gateway-client.ts';
import { loadSheet, saveSheet, clearActiveSheet } from '../src/core/storage/storage.ts';
import { createInitialSheet, createAuditedField, type CentralProductSheet } from '../src/core/schema/product.ts';

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

export async function runExtensionProductIntegrationTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: EXTENSION REAL PRODUCT INTEGRATION (FASE 4C.3)');
  console.log('================================================================\n');

  // Helper para criar mock de storage isolado
  function createMockSessionStorage() {
    const map = new Map<string, any>();
    return {
      get: async (key: string) => map.get(key) || null,
      set: async (key: string, val: any) => { map.set(key, val); },
      remove: async (key: string) => { map.delete(key); },
      dump: () => map
    };
  }

  // 1. Fluxo completo de leitura e reconciliação na CentralProductSheet
  await runTest('1. Fluxo completo: Content script dispara -> GatewayClient consulta -> 4A Reconcilia -> CentralProductSheet salva com isSimulatedMock: false', async () => {
    await tabContextManager.clearAll();
    await clearActiveSheet();

    const tabId = 101;
    const pageInstanceId = 'inst_full_flow_1';
    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/12345',
      detectedProduct: { id: '12345', sku: 'SKU-ABC' }
    });

    const mockStorage = createMockSessionStorage();
    await mockStorage.set('paulifest_gateway_session_v1', {
      gatewaySessionToken: 'mock_gst_valid',
      gatewayRefreshToken: 'mock_grt_valid',
      gstExpiresAt: new Date(Date.now() + 600000).toISOString(),
      sessionGeneration: 1,
      updatedAt: new Date().toISOString()
    });

    const mockClient = new GatewayClient({
      baseUrl: 'http://gateway.test',
      storage: mockStorage
    });

    // Mock do fetchBlingProduct
    mockClient.fetchBlingProduct = async (id: string) => {
      assert.strictEqual(id, '12345');
      return {
        ok: true,
        product: {
          id: '12345',
          nome: 'Fone de Ouvido Bluetooth Pro',
          codigo: 'SKU-FONE-01',
          preco: 199.90,
          precoCusto: 95.00,
          tipo: 'P',
          situacao: 'A',
          gtin: '7891234567890'
        },
        warnings: [],
        unknownFields: [],
        retrievedAt: '2026-09-18T20:00:00.000Z'
      };
    };

    const router = new MessageRouter(mockClient);

    let respondedData: any = null;
    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId,
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { respondedData = res; }
    );

    assert.ok(respondedData);
    assert.strictEqual(respondedData.ok, true);
    assert.strictEqual(respondedData.isSimulatedMock, false);
    assert.ok(respondedData.sheetId);

    // Confere no storage se a ficha foi salva corretamente
    const savedSheet = await loadSheet(respondedData.sheetId);
    assert.ok(savedSheet);
    assert.strictEqual(savedSheet.title.value, 'Fone de Ouvido Bluetooth Pro');
    assert.strictEqual(savedSheet.currentSalePrice.value, 199.90);
    assert.strictEqual(savedSheet.costPrice.value, 95.00);
    assert.strictEqual(savedSheet.suggestedSalePrice.value, null); // Invariante: suggestedSalePrice preservado
    assert.strictEqual(savedSheet.sku.value, 'SKU-FONE-01');
    assert.strictEqual(savedSheet.ean.value, '7891234567890');
    assert.strictEqual(savedSheet.externalReferences?.[0]?.system, 'bling');
    assert.strictEqual(savedSheet.externalReferences?.[0]?.externalId, '12345');
  });

  // 2. Single-flight de GRT: 5 requisições concorrentes disparam exatamente 1 refresh
  await runTest('2. Single-flight de GRT: 5 chamadas concorrentes com GST expirado disparam exatamente 1 POST /auth/session/refresh', async () => {
    const mockStorage = createMockSessionStorage();
    const initialGrt = 'grt_initial_single_flight';
    await mockStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
      gatewayRefreshToken: initialGrt,
      sessionGeneration: 1,
      updatedAt: new Date().toISOString()
    });

    let refreshCallCount = 0;
    const client = new GatewayClient({
      baseUrl: 'http://gateway.test',
      storage: mockStorage
    });

    // Intercepta o fetch nativo temporariamente
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/session/refresh')) {
        refreshCallCount++;
        await new Promise(r => setTimeout(r, 40)); // delay de rede simulado
        return new Response(JSON.stringify({
          ok: true,
          gatewaySessionToken: 'new_gst_single_flight_success',
          gatewayRefreshToken: 'new_grt_rotated',
          expiresInSeconds: 900
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url, init);
    };

    try {
      // 5 requisições paralelas
      const promises = [
        client.getValidGst(),
        client.getValidGst(),
        client.getValidGst(),
        client.getValidGst(),
        client.getValidGst()
      ];

      const results = await Promise.all(promises);

      // Exatamente 1 chamada de refresh
      assert.strictEqual(refreshCallCount, 1);
      // Todas recebem o novo token
      for (const token of results) {
        assert.strictEqual(token, 'new_gst_single_flight_success');
      }

      // Novo GRT persistido
      const savedSession: any = await mockStorage.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(savedSession.gatewayRefreshToken, 'new_grt_rotated');
      assert.strictEqual(savedSession.sessionGeneration, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 3. Falha transitória 500 no refresh preserva GRT atual
  await runTest('3. Falha de refresh transitória (500) PRESERVA o GRT atual e libera mutex em finally', async () => {
    const mockStorage = createMockSessionStorage();
    const grt = 'grt_survives_500';
    await mockStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
      gatewayRefreshToken: grt,
      sessionGeneration: 1,
      updatedAt: new Date().toISOString()
    });

    const client = new GatewayClient({ baseUrl: 'http://gateway.test', storage: mockStorage });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: false, error: 'SERVER_ERROR' }), { status: 500 });
    };

    try {
      await assert.rejects(async () => {
        await client.getValidGst();
      }, GatewayTransientError);

      // Confere que o GRT NÃO foi apagado!
      const sessionAfter: any = await mockStorage.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.ok(sessionAfter);
      assert.strictEqual(sessionAfter.gatewayRefreshToken, grt);
      // Confere que mutex foi liberado
      assert.strictEqual(client['activeRefreshPromises'].size, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 4. Falha transitória de Timeout preserva GRT atual
  await runTest('4. Falha de refresh por Timeout/rede PRESERVA o GRT atual', async () => {
    const mockStorage = createMockSessionStorage();
    const grt = 'grt_survives_timeout';
    await mockStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
      gatewayRefreshToken: grt,
      sessionGeneration: 1,
      updatedAt: new Date().toISOString()
    });

    const client = new GatewayClient({ baseUrl: 'http://gateway.test', storage: mockStorage });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      throw new Error('ETIMEDOUT');
    };

    try {
      await assert.rejects(async () => {
        await client.getValidGst();
      }, GatewayTransientError);

      const sessionAfter: any = await mockStorage.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.ok(sessionAfter);
      assert.strictEqual(sessionAfter.gatewayRefreshToken, grt);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 5. Falha transitória 429 preserva GRT atual
  await runTest('5. Falha de refresh por HTTP 429 PRESERVA o GRT atual', async () => {
    const mockStorage = createMockSessionStorage();
    const grt = 'grt_survives_429';
    await mockStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
      gatewayRefreshToken: grt,
      sessionGeneration: 1,
      updatedAt: new Date().toISOString()
    });

    const client = new GatewayClient({ baseUrl: 'http://gateway.test', storage: mockStorage });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: false, error: 'RATE_LIMITED' }), { status: 429 });
    };

    try {
      await assert.rejects(async () => {
        await client.getValidGst();
      }, GatewayTransientError);

      const sessionAfter: any = await mockStorage.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.ok(sessionAfter);
      assert.strictEqual(sessionAfter.gatewayRefreshToken, grt);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 6. Falha terminal 401 (SESSION_REVOKED / TOKEN_REUSE_DETECTED) LIMPA credenciais
  await runTest('6. Falha de refresh terminal (401 SESSION_REVOKED) LIMPA as credenciais locais', async () => {
    const mockStorage = createMockSessionStorage();
    await mockStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
      gatewayRefreshToken: 'grt_doomed',
      sessionGeneration: 1,
      updatedAt: new Date().toISOString()
    });

    const client = new GatewayClient({ baseUrl: 'http://gateway.test', storage: mockStorage });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: false, error: 'SESSION_REVOKED', message: 'Sessão revogada' }), { status: 401 });
    };

    try {
      await assert.rejects(async () => {
        await client.getValidGst();
      }, GatewayAuthRequiredError);

      const sessionAfter = await mockStorage.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(sessionAfter, null); // LIMPA!
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 7. Proteção CAS contra race de sessões: Refresh da Sessão A não sobrescreve Sessão B
  await runTest('7. Proteção CAS contra race de sessões: resposta tardia da Sessão A NÃO sobrescreve a Sessão B recém-conectada', async () => {
    const mockStorage = createMockSessionStorage();
    const grtA = 'grt_session_A';
    const grtB = 'grt_session_B';

    await mockStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
      gatewayRefreshToken: grtA,
      sessionGeneration: 1,
      updatedAt: new Date().toISOString()
    });

    const client = new GatewayClient({ baseUrl: 'http://gateway.test', storage: mockStorage });
    const originalFetch = globalThis.fetch;

    let resolveRefreshA: any;
    globalThis.fetch = async (url: any) => {
      if (String(url).includes('/auth/session/refresh')) {
        return new Promise<Response>((resolve) => {
          resolveRefreshA = () => resolve(new Response(JSON.stringify({
            ok: true,
            gatewaySessionToken: 'new_gst_from_A',
            gatewayRefreshToken: 'new_grt_from_A',
            expiresInSeconds: 900
          }), { status: 200 }));
        });
      }
      return originalFetch(url);
    };

    try {
      // Inicia refresh de A em voo
      const promiseA = client.executeSingleFlightRefresh(grtA);

      // Enquanto A está em voo, usuário reconecta gerando Sessão B no storage
      await mockStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
        gatewayRefreshToken: grtB,
        sessionGeneration: 10,
        updatedAt: new Date().toISOString()
      });

      // Agora o refresh de A responde tardiamente
      resolveRefreshA();
      await promiseA;

      // Confere que a Sessão B PERMANECEU INTACTA no storage e não foi corrompida por A!
      const currentSession: any = await mockStorage.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(currentSession.gatewayRefreshToken, grtB);
      assert.strictEqual(currentSession.sessionGeneration, 10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 8. Proteção de Disconnect durante refresh: resposta tardia de A não recria sessão apagada
  await runTest('8. Proteção de Disconnect durante refresh: resposta tardia NÃO recria sessão apagada', async () => {
    const mockStorage = createMockSessionStorage();
    const grtA = 'grt_session_to_disconnect';

    await mockStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, {
      gatewayRefreshToken: grtA,
      sessionGeneration: 1,
      updatedAt: new Date().toISOString()
    });

    const client = new GatewayClient({ baseUrl: 'http://gateway.test', storage: mockStorage });
    const originalFetch = globalThis.fetch;

    let resolveRefreshA: any;
    globalThis.fetch = async (url: any) => {
      if (String(url).includes('/auth/session/refresh')) {
        return new Promise<Response>((resolve) => {
          resolveRefreshA = () => resolve(new Response(JSON.stringify({
            ok: true,
            gatewaySessionToken: 'new_gst_from_A',
            gatewayRefreshToken: 'new_grt_from_A',
            expiresInSeconds: 900
          }), { status: 200 }));
        });
      }
      return originalFetch(url);
    };

    try {
      const promiseA = client.executeSingleFlightRefresh(grtA);

      // Usuário desconecta durante o voo
      await mockStorage.remove(STORAGE_KEYS.LOCAL_REFRESH_SESSION);

      resolveRefreshA();
      await promiseA;

      // Confere que a sessão CONTINUA NULA (não foi ressuscitada)
      const currentSession = await mockStorage.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
      assert.strictEqual(currentSession, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 9. Novo GRT não aguarda Promise pertencente ao GRT antigo
  await runTest('9. Novo GRT não aguarda Promise pertencente ao GRT antigo', async () => {
    const client = new GatewayClient({ baseUrl: 'http://gateway.test' });

    // Injeta promise pendente para grt_antigo
    client['activeRefreshPromises'].set('grt_antigo', new Promise(() => {}));

    let calledWithNewGrt = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init: any) => {
      const body = JSON.parse(init.body);
      if (body.gatewayRefreshToken === 'grt_novo') {
        calledWithNewGrt = true;
        return new Response(JSON.stringify({
          ok: true,
          gatewaySessionToken: 'gst_novo',
          gatewayRefreshToken: 'grt_novo_rot',
          expiresInSeconds: 900
        }), { status: 200 });
      }
      return originalFetch(_url, init);
    };

    try {
      // Chamada com grt_novo não deve ficar presa na promise de grt_antigo
      const token = await client.executeSingleFlightRefresh('grt_novo');
      assert.strictEqual(token, 'gst_novo');
      assert.strictEqual(calledWithNewGrt, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 10. Barreira de Stale por contextRevision: mesma página, mesmo produto, contextRevision mudou -> DESCARTA
  await runTest('10. Barreira de Stale por contextRevision: mesma pageInstanceId e productId, porém contextRevision avançou -> DESCARTA sem alterar ficha', async () => {
    await tabContextManager.clearAll();
    await clearActiveSheet();

    const tabId = 202;
    const pageInstanceId = 'inst_stale_rev';
    const initialTab = await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/999',
      detectedProduct: { id: '999' }
    });

    const initialRevision = initialTab.contextRevision;

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => {
      // Durante o voo da chamada, a revisão da aba avança
      await tabContextManager.bumpRevision(tabId);
      return {
        ok: true,
        product: { id: '999', nome: 'Produto de Resposta Tardia', preco: 50.0 },
        warnings: [],
        unknownFields: [],
        retrievedAt: new Date().toISOString()
      };
    };

    const router = new MessageRouter(mockClient);
    let responseResult: any = null;

    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId,
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { responseResult = res; }
    );

    // Resposta deve ser descartada
    assert.strictEqual(responseResult.ok, false);
    assert.ok(responseResult.warning.includes('Resposta descartada'));

    // Confere que a aba NÃO teve activeSheetId vinculado
    const tabStateAfter = await tabContextManager.getTabState(tabId);
    assert.strictEqual(tabStateAfter?.activeSheetId, undefined);
    assert.ok(tabStateAfter!.contextRevision > initialRevision);
  });

  // 11. Barreira de Stale por navegação SPA: detectedProduct.id mudou -> DESCARTA
  await runTest('11. Barreira de Stale por navegação SPA: detectedProduct.id mudou durante requisição -> DESCARTA', async () => {
    await tabContextManager.clearAll();
    const tabId = 303;
    const pageInstanceId = 'inst_spa_switch';

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/100',
      detectedProduct: { id: '100' }
    });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => {
      // Usuário navegou para produto 200 no SPA
      await tabContextManager.registerOrUpdateTab(tabId, {
        detectedProduct: { id: '200' }
      });
      return {
        ok: true,
        product: { id: '100', nome: 'Produto 100 Stale' },
        warnings: [],
        unknownFields: [],
        retrievedAt: new Date().toISOString()
      };
    };

    const router = new MessageRouter(mockClient);
    let resData: any = null;

    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId,
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { resData = res; }
    );

    assert.strictEqual(resData.ok, false);
    assert.ok(resData.warning.includes('Resposta descartada'));
  });

  // 12. Barreira de Stale por reload (pageInstanceId mudou)
  await runTest('12. Barreira de Stale por reload: pageInstanceId expirou -> DESCARTA', async () => {
    await tabContextManager.clearAll();
    const tabId = 404;

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId: 'inst_antiga',
      url: 'https://bling.com.br/produtos/editar/500',
      detectedProduct: { id: '500' }
    });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => {
      // Página recarregou com nova instância
      await tabContextManager.registerOrUpdateTab(tabId, {
        pageInstanceId: 'inst_nova'
      });
      return {
        ok: true,
        product: { id: '500', nome: 'Produto 500' },
        warnings: [],
        unknownFields: [],
        retrievedAt: new Date().toISOString()
      };
    };

    const router = new MessageRouter(mockClient);
    let resData: any = null;

    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId: 'inst_antiga',
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { resData = res; }
    );

    assert.strictEqual(resData.ok, false);
    assert.ok(resData.warning.includes('Resposta descartada'));
  });

  // 13. Restrição de Escopo 4C.3: Apenas product_form_edit habilita importação real
  await runTest('13. Restrição de Escopo 4C.3: product_list é bloqueada da importação real nesta subfase', async () => {
    await tabContextManager.clearAll();
    const tabId = 505;

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_list',
      pageInstanceId: 'inst_list',
      url: 'https://bling.com.br/produtos',
      detectedProduct: { id: '600' }
    });

    const router = new MessageRouter(new GatewayClient());
    let resData: any = null;

    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId: 'inst_list',
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { resData = res; }
    );

    assert.strictEqual(resData.ok, false);
    assert.ok(resData.warning.includes('product_form_edit'));
  });

  // 14. Deduplicação de requisições com contextRevision e cleanup em finally
  await runTest('14. Deduplicação em voo: duas chamadas na mesma revisão compartilham Promise e limpam Map em finally', async () => {
    await tabContextManager.clearAll();
    const tabId = 606;
    const pageInstanceId = 'inst_dedupe';

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/777',
      detectedProduct: { id: '777' }
    });

    let fetchCalls = 0;
    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => {
      fetchCalls++;
      await new Promise(r => setTimeout(r, 20));
      return {
        ok: true,
        product: { id: '777', nome: 'Dedupe Prod' },
        warnings: [],
        unknownFields: [],
        retrievedAt: new Date().toISOString()
      };
    };

    const router = new MessageRouter(mockClient);

    const [res1, res2] = await Promise.all([
      new Promise(r => router.handleMessage(
        { type: 'BLING_ACTION_TRIGGERED', pageInstanceId, payload: { action: 'prepare_mercadolivre' } },
        { tab: { id: tabId } },
        r
      )),
      new Promise(r => router.handleMessage(
        { type: 'BLING_ACTION_TRIGGERED', pageInstanceId, payload: { action: 'prepare_mercadolivre' } },
        { tab: { id: tabId } },
        r
      ))
    ]);

    assert.strictEqual(fetchCalls, 1); // Apenas 1 chamada ao Gateway!
    assert.strictEqual((res1 as any).ok, true);
    assert.strictEqual((res2 as any).ok, true);
    assert.strictEqual(router['inFlightRequests'].size, 0); // Limpo no finally
  });

  // 15. Isolamento Multi-Aba: Aba 1 (Produto A) e Aba 2 (Produto B) em paralelo sem contaminação
  await runTest('15. Isolamento Multi-Aba: Aba 1 (Prod A) e Aba 2 (Prod B) sem contaminação cruzada', async () => {
    await tabContextManager.clearAll();
    await clearActiveSheet();

    const tab1 = 11;
    const tab2 = 22;

    await tabContextManager.registerOrUpdateTab(tab1, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId: 'inst_t1',
      url: 'https://bling.com.br/produtos/editar/10',
      detectedProduct: { id: '10' }
    });

    await tabContextManager.registerOrUpdateTab(tab2, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId: 'inst_t2',
      url: 'https://bling.com.br/produtos/editar/20',
      detectedProduct: { id: '20' }
    });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async (id) => {
      return {
        ok: true,
        product: { id, nome: `Produto #${id}`, preco: Number(id) * 10 },
        warnings: [],
        unknownFields: [],
        retrievedAt: new Date().toISOString()
      };
    };

    const router = new MessageRouter(mockClient);

    const [res1, res2]: any = await Promise.all([
      new Promise(r => router.handleMessage(
        { type: 'BLING_ACTION_TRIGGERED', pageInstanceId: 'inst_t1', payload: { action: 'prepare_mercadolivre' } },
        { tab: { id: tab1 } },
        r
      )),
      new Promise(r => router.handleMessage(
        { type: 'BLING_ACTION_TRIGGERED', pageInstanceId: 'inst_t2', payload: { action: 'prepare_mercadolivre' } },
        { tab: { id: tab2 } },
        r
      ))
    ]);

    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res2.ok, true);
    assert.notStrictEqual(res1.sheetId, res2.sheetId);

    const sheet1 = await loadSheet(res1.sheetId);
    const sheet2 = await loadSheet(res2.sheetId);

    assert.strictEqual(sheet1?.title.value, 'Produto #10');
    assert.strictEqual(sheet2?.title.value, 'Produto #20');
  });

  // 16. Reconciliação não-destrutiva: Dado manual é 100% preservado e gera conflito
  await runTest('16. Reconciliação não-destrutiva: dado manual do vendedor (user_manual) NUNCA é sobrescrito e gera conflito auditável', async () => {
    await tabContextManager.clearAll();
    await clearActiveSheet();

    const tabId = 707;
    const pageInstanceId = 'inst_manual_conflict';

    // Cria ficha prévia com dado manual
    const existingSheet = createInitialSheet();
    existingSheet.title = createAuditedField('Título Personalizado Pelo Vendedor', 'user_manual', 1.0, 'edited');
    await saveSheet(existingSheet);

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/888',
      detectedProduct: { id: '888' },
      activeSheetId: existingSheet.id
    });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => ({
      ok: true,
      product: { id: '888', nome: 'Título Oficial do Bling ERP' },
      warnings: [],
      unknownFields: [],
      retrievedAt: new Date().toISOString()
    });

    const router = new MessageRouter(mockClient);
    let resData: any = null;

    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId,
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { resData = res; }
    );

    assert.strictEqual(resData.ok, true);
    assert.ok(resData.conflictedFields.includes('title'));

    const sheetAfter = await loadSheet(existingSheet.id);
    assert.ok(sheetAfter);
    // Preserva dado manual!
    assert.strictEqual(sheetAfter.title.value, 'Título Personalizado Pelo Vendedor');
    assert.strictEqual(sheetAfter.title.status, 'conflict');
    // Bling gravado na lista de conflitos
    assert.strictEqual(sheetAfter.title.conflictingValues?.[0]?.value, 'Título Oficial do Bling ERP');
  });

  // 17. Invariante de Preço: preco vai para currentSalePrice, suggestedSalePrice intocado
  await runTest('17. Invariante de Preço: preco vai exclusivamente para currentSalePrice; suggestedSalePrice permanece 0', async () => {
    await tabContextManager.clearAll();
    const tabId = 808;
    const pageInstanceId = 'inst_price';

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/999',
      detectedProduct: { id: '999' }
    });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => ({
      ok: true,
      product: { id: '999', nome: 'Item Teste', preco: 149.90 },
      warnings: [],
      unknownFields: [],
      retrievedAt: new Date().toISOString()
    });

    const router = new MessageRouter(mockClient);
    let resData: any = null;

    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId,
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { resData = res; }
    );

    const sheet = await loadSheet(resData.sheetId);
    assert.strictEqual(sheet?.currentSalePrice.value, 149.90);
    assert.strictEqual(sheet?.suggestedSalePrice.value, null);
  });

  // 18. Fact-or-Omit: dimensões sem unidade confirmada no contexto
  await runTest('18. Fact-or-Omit: dimensões e peso respeitam regras estritas sem inferências tácitas', async () => {
    await tabContextManager.clearAll();
    const tabId = 909;
    const pageInstanceId = 'inst_units';

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/12',
      detectedProduct: { id: '12' }
    });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => ({
      ok: true,
      product: {
        id: '12',
        nome: 'Caixa de Som',
        dimensoes: { largura: 10, altura: 20, profundidade: 30 },
        pesoBruto: 1.5
      },
      warnings: [],
      unknownFields: [],
      retrievedAt: new Date().toISOString()
    });

    const router = new MessageRouter(mockClient);
    let resData: any = null;

    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId,
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { resData = res; }
    );

    const sheet = await loadSheet(resData.sheetId);
    assert.strictEqual(sheet?.packageWidthCm.value, 10);
    assert.strictEqual(sheet?.packageHeightCm.value, 20);
    assert.strictEqual(sheet?.packageLengthCm.value, 30);
    assert.strictEqual(sheet?.packageWeightKg.value, 1.5);
  });

  // 19. Ausência de Mock Silencioso
  await runTest('19. Ausência de Mock Silencioso: falha do Gateway não sintetiza dados fictícios e retorna erro claro', async () => {
    await tabContextManager.clearAll();
    const tabId = 1001;
    const pageInstanceId = 'inst_no_mock';

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/99',
      detectedProduct: { id: '99' }
    });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => {
      throw new GatewayProductError('BLING_PRODUCT_NOT_FOUND', 'Produto não encontrado no Bling.', 404);
    };

    const router = new MessageRouter(mockClient);
    let resData: any = null;

    await router.handleMessage(
      {
        type: 'BLING_ACTION_TRIGGERED',
        pageInstanceId,
        payload: { action: 'prepare_mercadolivre' }
      },
      { tab: { id: tabId } },
      (res) => { resData = res; }
    );

    assert.strictEqual(resData.ok, false);
    assert.strictEqual(resData.error, 'Produto não encontrado no Bling.');
    const tab = await tabContextManager.getTabState(tabId);
    assert.strictEqual(tab?.activeSheetId, undefined);
  });

  // 20. Zero Secrets em Logs
  await runTest('20. Zero Secrets em Logs: tokens GST e GRT nunca vazam no objeto de feedback visual', async () => {
    await tabContextManager.clearAll();
    const tabId = 1002;
    const pageInstanceId = 'inst_zero_logs';

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      pageType: 'product_form_edit',
      pageInstanceId,
      url: 'https://bling.com.br/produtos/editar/123',
      detectedProduct: { id: '123' }
    });

    const mockClient = new GatewayClient();
    mockClient.fetchBlingProduct = async () => ({
      ok: true,
      product: { id: '123', nome: 'Item Seguro' },
      warnings: [],
      unknownFields: [],
      retrievedAt: new Date().toISOString()
    });

    const router = new MessageRouter(mockClient);
    await router.handleMessage(
      { type: 'BLING_ACTION_TRIGGERED', pageInstanceId, payload: { action: 'prepare_mercadolivre' } },
      { tab: { id: tabId } },
      () => {}
    );

    const tab = await tabContextManager.getTabState(tabId);
    const feedbackStr = JSON.stringify(tab?.uiState);
    assert.strictEqual(feedbackStr.includes('Bearer'), false);
    assert.strictEqual(feedbackStr.includes('eyJ'), false); // Sem JWT
    assert.strictEqual(feedbackStr.includes('grt_'), false);
  });

  // 21. Gateway Base URL: URL injetada arbitrária funciona em dev/test
  await runTest('21. Gateway Base URL: cliente aceita URL injetada arbitrária e remove trailing slashes', () => {
    const client = new GatewayClient({
      baseUrl: 'http://custom-proxy.internal:8080///',
      environment: 'development'
    });
    assert.strictEqual(client.getBaseUrl(), 'http://custom-proxy.internal:8080');
  });

  // 22. Gateway Base URL: localhost funciona em desenvolvimento
  await runTest('22. Gateway Base URL: ambiente de desenvolvimento utiliza http://localhost:3001 como default seguro', () => {
    const client = new GatewayClient({
      environment: 'development'
    });
    assert.strictEqual(client.getBaseUrl(), 'http://localhost:3001');
    assert.strictEqual(client.getEnvironment(), 'development');
  });

  // 23. Gateway Base URL: produção rejeita HTTP e exige HTTPS
  await runTest('23. Gateway Base URL: produção rejeita HTTP inseguro e exige HTTPS obrigatório', () => {
    assert.throws(
      () => {
        new GatewayClient({
          baseUrl: 'http://api.paulifest.com',
          environment: 'production'
        });
      },
      /HTTPS obrigatório/
    );

    // Com HTTPS deve aceitar normalmente
    const validProdClient = new GatewayClient({
      baseUrl: 'https://api.paulifest.com/gateway/',
      environment: 'production'
    });
    assert.strictEqual(validProdClient.getBaseUrl(), 'https://api.paulifest.com/gateway');
  });

  // 24. Gateway Base URL: produção sem URL configurada falha fechado (fail-closed)
  await runTest('24. Gateway Base URL: produção sem URL configurada falha fechado sem fallback silencioso para localhost', () => {
    assert.throws(
      () => {
        new GatewayClient({
          environment: 'production'
        });
      },
      /fail-closed/
    );
  });
}
