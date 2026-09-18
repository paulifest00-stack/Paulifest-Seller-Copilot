// Testes Unitários: Fase 4B - TabContextManager, Isolamento de Abas e Reidratação Pós-Suspensão
import assert from 'node:assert';
import { TabContextManager } from '../src/background/tab-context-manager.ts';
import { extractVerifiedSenderTabId } from '../src/shared/tab-context-contracts.ts';

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

export async function runTabContextManagerTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: TAB CONTEXT MANAGER (FASE 4B)');
  console.log('================================================================\n');

  const manager = new TabContextManager();
  await manager.clearAll();

  // 1. Autoridade de Revisão e Idempotência (Requisito 1)
  await runTest('1. Idempotência e Autoridade: chamadas idênticas mantêm revisão; mudança semântica incrementa', async () => {
    await manager.clearAll();
    const state1 = await manager.registerOrUpdateTab(10, {
      url: 'https://www.bling.com.br/produtos/editar/100',
      pageType: 'product_form_edit',
      detectedProduct: { id: '100' }
    });

    assert.strictEqual(state1.contextRevision, 1);

    // Chamada idêntica NÃO deve incrementar a revisão (idempotência)
    const state2 = await manager.registerOrUpdateTab(10, {
      url: 'https://www.bling.com.br/produtos/editar/100',
      pageType: 'product_form_edit',
      detectedProduct: { id: '100' }
    });

    assert.strictEqual(state2.contextRevision, 1, 'Chamada com payload idêntico deve manter contextRevision inalterada');

    // Mudança semântica de produto DEVE incrementar a revisão
    const state3 = await manager.registerOrUpdateTab(10, {
      url: 'https://www.bling.com.br/produtos/editar/101',
      pageType: 'product_form_edit',
      detectedProduct: { id: '101' }
    });

    assert.strictEqual(state3.contextRevision, 2, 'Mudança semântica deve incrementar contextRevision');

    const rev = await manager.bumpRevision(10);
    assert.strictEqual(rev, 3);
  });

  // 2. Reidratação Pós-Suspensão do Service Worker
  await runTest('2. Reidratação Pós-Suspensão: novo manager recupera abas a partir do session storage', async () => {
    await manager.clearAll();
    await manager.registerOrUpdateTab(15, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/999',
      pageType: 'product_form_edit',
      detectedProduct: { id: '999', sku: 'SKU-999' }
    });

    // Simula reinicialização completa do Service Worker instanciando um novo TabContextManager
    const freshWorkerManager = new TabContextManager();
    const recovered = await freshWorkerManager.getTabState(15);

    assert.ok(recovered, 'Deveria recuperar o estado após suspensão do worker');
    assert.strictEqual(recovered?.tabId, 15);
    assert.strictEqual(recovered?.detectedProduct?.id, '999');
    assert.strictEqual(recovered?.pageType, 'product_form_edit');
  });

  // 3. Isolamento de Múltiplas Abas
  await runTest('3. Isolamento de Múltiplas Abas: abas com produtos distintos não se contaminam', async () => {
    await manager.clearAll();

    // Aba 1 com Furadeira
    await manager.registerOrUpdateTab(1, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/101',
      pageType: 'product_form_edit',
      detectedProduct: { id: '101', sku: 'FURADEIRA-101' }
    });

    // Aba 2 com Parafusadeira
    await manager.registerOrUpdateTab(2, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/202',
      pageType: 'product_form_edit',
      detectedProduct: { id: '202', sku: 'PARAFUSADEIRA-202' }
    });

    const tab1 = await manager.getTabState(1);
    const tab2 = await manager.getTabState(2);

    assert.strictEqual(tab1?.detectedProduct?.id, '101');
    assert.strictEqual(tab1?.detectedProduct?.sku, 'FURADEIRA-101');

    assert.strictEqual(tab2?.detectedProduct?.id, '202');
    assert.strictEqual(tab2?.detectedProduct?.sku, 'PARAFUSADEIRA-202');
  });

  // 4. Fechamento de Aba
  await runTest('4. Fechamento de Aba: removeTab expurga da memória e do session storage', async () => {
    await manager.clearAll();
    await manager.registerOrUpdateTab(30, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos',
      pageType: 'product_list'
    });

    assert.ok(await manager.getTabState(30));

    await manager.removeTab(30);

    const freshManager = new TabContextManager();
    const afterRemoval = await freshManager.getTabState(30);
    assert.strictEqual(afterRemoval, undefined);
  });

  // 5. Persistência Externa da Ficha (Regra 1: CentralProductSheet fora do contexto da aba)
  await runTest('5. Ficha Fora do Contexto: TabContextState contém apenas activeSheetId, nunca o objeto da ficha', async () => {
    await manager.clearAll();
    const updated = await manager.registerOrUpdateTab(40, {
      activeSheetId: 'sheet_prod_9988'
    });

    assert.strictEqual(updated.activeSheetId, 'sheet_prod_9988');
    assert.strictEqual((updated as any).sheet, undefined, 'sheet NÃO deve existir em TabContextState');
  });

  // 6. Troca de Produto na Mesma Aba
  await runTest('6. Troca de Produto na Mesma Aba: navegação SPA substitui ID e incrementa revisão', async () => {
    await manager.clearAll();
    const first = await manager.registerOrUpdateTab(50, {
      pageType: 'product_form_edit',
      detectedProduct: { id: 'PROD-A' }
    });
    assert.strictEqual(first.detectedProduct?.id, 'PROD-A');
    assert.strictEqual(first.contextRevision, 1);

    const second = await manager.registerOrUpdateTab(50, {
      pageType: 'product_form_edit',
      detectedProduct: { id: 'PROD-B' }
    });
    assert.strictEqual(second.detectedProduct?.id, 'PROD-B');
    assert.strictEqual(second.contextRevision, 2);
  });

  // 7. Rejeição de Spoofing de sender.tab.id
  await runTest('7. Rejeição de Spoofing: extractVerifiedSenderTabId rejeita sender nulo, negativo ou sem tab', () => {
    assert.strictEqual(extractVerifiedSenderTabId(undefined), null);
    assert.strictEqual(extractVerifiedSenderTabId({} as any), null);
    assert.strictEqual(extractVerifiedSenderTabId({ tab: {} } as any), null);
    assert.strictEqual(extractVerifiedSenderTabId({ tab: { id: -1 } } as any), null);
    assert.strictEqual(extractVerifiedSenderTabId({ tab: { id: 42 } }), 42);
  });

  // 8. Deduplicação de Mesma Navegação Concorrente (Requisito 1)
  await runTest('8. Deduplicação Concorrente: mesma navegação via webNavigation, tabs.onUpdated e ContentScript gera transição única', async () => {
    await manager.clearAll();
    const tabId = 123;
    const targetUrl = 'https://www.bling.com.br/produtos/editar/555444';

    // 1. Chega via webNavigation.onHistoryStateUpdated
    const s1 = await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: targetUrl,
      pageType: 'product_form_edit',
      detectedProduct: { id: '555444' }
    });
    assert.strictEqual(s1.contextRevision, 1, 'Primeira detecção deve registrar revisão 1');

    // 2. Chega via tabs.onUpdated (evento concorrente da mesma navegação)
    const s2 = await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: targetUrl,
      pageType: 'product_form_edit',
      detectedProduct: { id: '555444' }
    });
    assert.strictEqual(s2.contextRevision, 1, 'tabs.onUpdated idêntico NÃO deve criar revisão duplicada');

    // 3. Chega via BLING_DOM_CONTEXT_DETECTED do Content Script (mesma navegação, trazendo pageInstanceId)
    const s3 = await manager.registerOrUpdateTab(tabId, {
      pageInstanceId: 'inst_nav_555',
      platform: 'bling',
      url: targetUrl,
      pageType: 'product_form_edit',
      detectedProduct: { id: '555444' }
    });
    assert.strictEqual(s3.contextRevision, 1, 'BLING_DOM_CONTEXT_DETECTED da mesma navegação NÃO deve triplicar revisão');
    assert.strictEqual(s3.pageInstanceId, 'inst_nav_555', 'Deve associar o pageInstanceId à aba');
  });

  // 9. Limpeza de activeSheetId ao trocar de produto na mesma aba (Requisito 1)
  await runTest('9. Limpeza de activeSheetId: troca de produto limpa vínculo; evento duplicado mantém vínculo', async () => {
    await manager.clearAll();
    const tabId = 200;

    // 1. Produto A com ID 101 registrado e vinculado à ficha A
    await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/101',
      pageType: 'product_form_edit',
      detectedProduct: { id: '101' }
    });
    const linkedA = await manager.linkSheetToTab(tabId, 'sheet_A');
    assert.strictEqual(linkedA?.activeSheetId, 'sheet_A', 'Aba deve estar vinculada à sheet_A');

    // 2. Navegação na mesma aba para Produto B (ID 202)
    const stateB = await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/202',
      pageType: 'product_form_edit',
      detectedProduct: { id: '202' }
    });

    // 3. Confirmar que activeSheetId foi limpo automaticamente
    assert.strictEqual(stateB.activeSheetId, undefined, 'activeSheetId DEVE ser limpo na troca de produto');
    assert.strictEqual((stateB as any).activeSheetId, undefined);

    // 4. Vincula Produto B à ficha B
    await manager.linkSheetToTab(tabId, 'sheet_B');
    const linkedB = await manager.getTabState(tabId);
    assert.strictEqual(linkedB?.activeSheetId, 'sheet_B');

    // 5. Evento duplicado do MESMO produto 202 NÃO deve limpar o vínculo
    const dupB = await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/202',
      pageType: 'product_form_edit',
      detectedProduct: { id: '202' }
    });
    assert.strictEqual(dupB.activeSheetId, 'sheet_B', 'Evento duplicado do mesmo produto não deve limpar vínculo');
  });

  // 10. Limpeza ao entrar em product_form_new e ao sair para other (Requisito 1)
  await runTest('10. Limpeza de Contexto: limpa activeSheetId ao entrar em product_form_new ou sair para other', async () => {
    await manager.clearAll();
    const tabId = 300;

    // Registra Produto 101 com ficha
    await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/101',
      pageType: 'product_form_edit',
      detectedProduct: { id: '101' }
    });
    await manager.linkSheetToTab(tabId, 'sheet_101');

    // Navega para /produtos/novo (product_form_new)
    const stateNew = await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/novo',
      pageType: 'product_form_new'
    });
    assert.strictEqual(stateNew.activeSheetId, undefined, 'Entrar em product_form_new deve limpar activeSheetId');
    assert.strictEqual(stateNew.detectedProduct, undefined, 'detectedProduct deve ser limpo em product_form_new');

    // Vincula ficha e depois navega para /pedidos (other)
    await manager.linkSheetToTab(tabId, 'sheet_temp');
    const stateOther = await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/pedidos',
      pageType: 'other'
    });
    assert.strictEqual(stateOther.activeSheetId, undefined, 'Sair para other deve limpar activeSheetId');
  });

  // 11. Voltar ao mesmo Produto A sem vínculo automático (Requisito 1)
  await runTest('11. Retorno ao Produto A: não reativa automaticamente ficha antiga nem reutiliza ficha errada', async () => {
    await manager.clearAll();
    const tabId = 400;

    // 1. Produto 101 -> vinculado à sheet_A
    await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/101',
      pageType: 'product_form_edit',
      detectedProduct: { id: '101' }
    });
    await manager.linkSheetToTab(tabId, 'sheet_A');

    // 2. Navega para Produto 202 -> vinculado à sheet_B
    await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/202',
      pageType: 'product_form_edit',
      detectedProduct: { id: '202' }
    });
    await manager.linkSheetToTab(tabId, 'sheet_B');

    // 3. Retorna para Produto 101
    const returnToA = await manager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/101',
      pageType: 'product_form_edit',
      detectedProduct: { id: '101' }
    });

    // 4. activeSheetId deve estar limpo (undefined), NÃO reutilizando sheet_B
    assert.strictEqual(returnToA.activeSheetId, undefined, 'Voltar ao Produto A não deve reutilizar sheet_B');
  });
}

