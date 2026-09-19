// Testes Unitários: Fase 4B - MessageRouter, Pipeline Mock 4A e Bloqueio em Produto Novo
import assert from 'node:assert';
import { messageRouter } from '../src/background/message-router.ts';
import { tabContextManager } from '../src/background/tab-context-manager.ts';
import { loadActiveSheet, clearActiveSheet, loadSheet, saveSheet } from '../src/core/storage/storage.ts';
import { createInitialSheet } from '../src/core/schema/product.ts';

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

export async function runMessageRouterTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: MESSAGE ROUTER & MOCK 4A (FASE 4B)');
  console.log('================================================================\n');

  messageRouter.setMockMode(true);
  try {
    await tabContextManager.clearAll();
    await clearActiveSheet();

  // 1. Rejeição de Mensagem sem sender.tab.id confiável
  await runTest('1. Segurança de Aba: rejeita mensagens de content script sem sender.tab.id verificado', async () => {
    let responded = false;
    let responseData: any = null;

    const dummySender: any = {}; // sem tab.id
    const message = {
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_1',
      payload: { url: 'https://www.bling.com.br/produtos', pageType: 'product_list' }
    };

    const handled = await messageRouter.handleMessage(message, dummySender, (res) => {
      responded = true;
      responseData = res;
    });

    assert.strictEqual(handled, false);
    assert.strictEqual(responded, true);
    assert.strictEqual(responseData?.ok, false);
  });

  // 2. Registro e Incremento de contextRevision via BLING_DOM_CONTEXT_DETECTED
  await runTest('2. Registro de Contexto: processa BLING_DOM_CONTEXT_DETECTED e incrementa contextRevision', async () => {
    const sender: any = { tab: { id: 77 } };
    const message = {
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_abc',
      payload: {
        url: 'https://www.bling.com.br/produtos/editar/3344',
        pageType: 'product_form_edit',
        detectedProduct: { id: '3344', sku: 'SKU-3344' }
      }
    };

    let result: any = null;
    await messageRouter.handleMessage(message, sender, (res) => {
      result = res;
    });

    assert.strictEqual(result?.ok, true);
    assert.strictEqual(result?.contextRevision, 1);

    const savedState = await tabContextManager.getTabState(77);
    assert.strictEqual(savedState?.detectedProduct?.id, '3344');
    assert.strictEqual(savedState?.uiState.canImport, true);
    assert.strictEqual(savedState?.uiState.dockVisible, true);
  });

  // 3. Ação Bloqueada em Produto Novo (Regra 6 e 7)
  await runTest('3. Bloqueio em Produto Novo: ação prepare_mercadolivre em product_form_new sem ID é rejeitada', async () => {
    const sender: any = { tab: { id: 88 } };

    // Registra aba em /produtos/novo
    await tabContextManager.registerOrUpdateTab(88, {
      url: 'https://www.bling.com.br/produtos/novo',
      pageType: 'product_form_new'
    });

    const actionMessage = {
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_new',
      payload: {
        action: 'prepare_mercadolivre'
      }
    };

    let actionResult: any = null;
    await messageRouter.handleMessage(actionMessage, sender, (res) => {
      actionResult = res;
    });

    assert.strictEqual(actionResult?.ok, false);
    assert.ok(actionResult?.warning?.includes('Importação bloqueada'));
  });

  // 4. Execução do Pipeline Mock 4A com Transparência de Simulação
  await runTest('4. Pipeline Mock 4A: executa validador, mapper e reconciliação da 4A com badge isSimulatedMock', async () => {
    await clearActiveSheet();
    const sender: any = { tab: { id: 99 } };

    // Registra aba com ID confirmado
    await tabContextManager.registerOrUpdateTab(99, {
      url: 'https://www.bling.com.br/produtos/editar/555666',
      pageType: 'product_form_edit',
      detectedProduct: { id: '555666', sku: 'SKU-MOCK' }
    });

    const actionMessage = {
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_mock',
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: '555666', sku: 'SKU-MOCK' }
      }
    };

    let actionResult: any = null;
    await messageRouter.handleMessage(actionMessage, sender, (res) => {
      actionResult = res;
    });

    assert.strictEqual(actionResult?.ok, true);
    assert.strictEqual(actionResult?.isSimulatedMock, true);

    // Confirma que a ficha foi salva em storage.local (SSOT)
    const activeSheet = await loadActiveSheet();
    assert.ok(activeSheet);
    assert.strictEqual(activeSheet?.schemaVersion, 2);
    assert.ok(activeSheet?.title.value.includes('555666'));
    assert.strictEqual(activeSheet?.costPrice.value, 89.00);
    assert.strictEqual(activeSheet?.currentSalePrice.value, 149.90);
    assert.strictEqual(activeSheet?.currentSalePrice.source, 'bling_erp');

    // Confirma que o tabContextState apenas referenciou a ficha por ID sem conter o objeto sheet
    const tabState = await tabContextManager.getTabState(99);
    assert.strictEqual(tabState?.activeSheetId, activeSheet?.id);
    assert.strictEqual((tabState as any)?.sheet, undefined);
  });

  // 5. Ação Abrir no Seller Copilot
  await runTest('5. Abertura no Copilot: responde positivamente para ação open_in_copilot', async () => {
    const sender: any = { tab: { id: 99 } };
    const actionMessage = {
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_mock',
      payload: {
        action: 'open_in_copilot'
      }
    };

    let actionResult: any = null;
    await messageRouter.handleMessage(actionMessage, sender, (res) => {
      actionResult = res;
    });

    assert.strictEqual(actionResult?.ok, true);
    assert.strictEqual(actionResult?.action, 'open_in_copilot');
  });

  // 6. Eliminação de Contaminação de Ficha Entre Abas (Requisito 2)
  await runTest('6. Isolamento de Fichas por Aba: Aba 1 importa Produto A, Aba 2 importa Produto B com IDs distintos e sem contaminação', async () => {
    await clearActiveSheet();
    const senderTab1: any = { tab: { id: 101 } };
    const senderTab2: any = { tab: { id: 202 } };

    // 1. Aba 1 registra contexto e importa Produto A
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_tab1',
      payload: {
        url: 'https://www.bling.com.br/produtos/editar/1001',
        pageType: 'product_form_edit',
        detectedProduct: { id: '1001', sku: 'SKU-PROD-A' }
      }
    }, senderTab1, () => {});

    let resultA: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_tab1',
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: '1001', sku: 'SKU-PROD-A' }
      }
    }, senderTab1, (res) => { resultA = res; });

    assert.strictEqual(resultA?.ok, true);
    const sheetIdA = resultA?.sheetId;
    assert.ok(sheetIdA, 'Deveria ter gerado sheetId para Produto A');

    // 2. Aba 2 registra contexto e importa Produto B
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_tab2',
      payload: {
        url: 'https://www.bling.com.br/produtos/editar/2002',
        pageType: 'product_form_edit',
        detectedProduct: { id: '2002', sku: 'SKU-PROD-B' }
      }
    }, senderTab2, () => {});

    let resultB: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_tab2',
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: '2002', sku: 'SKU-PROD-B' }
      }
    }, senderTab2, (res) => { resultB = res; });

    assert.strictEqual(resultB?.ok, true);
    const sheetIdB = resultB?.sheetId;
    assert.ok(sheetIdB, 'Deveria ter gerado sheetId para Produto B');

    // 3. As duas fichas têm IDs distintos
    assert.notStrictEqual(sheetIdA, sheetIdB, 'Fichas de abas distintas DEVEM ter IDs diferentes');

    // 4. Produto B não altera valores da Ficha A
    const sheetA = await loadSheet(sheetIdA);
    const sheetB = await loadSheet(sheetIdB);

    assert.ok(sheetA, 'Ficha A deve existir no storage');
    assert.ok(sheetB, 'Ficha B deve existir no storage');
    assert.ok(sheetA?.title.value.includes('1001'), 'Ficha A deve conter exclusivamente Produto A');
    assert.ok(sheetB?.title.value.includes('2002'), 'Ficha B deve conter exclusivamente Produto B');
    assert.strictEqual(sheetA?.hasUnresolvedConflicts, false, 'Ficha A não deve receber conflitos espúrios da importação B');

    // 5. Alternar entre as abas recupera a ficha correta de cada uma
    const tab1State = await tabContextManager.getTabState(101);
    const tab2State = await tabContextManager.getTabState(202);

    assert.strictEqual(tab1State?.activeSheetId, sheetIdA);
    assert.strictEqual(tab2State?.activeSheetId, sheetIdB);

    const recoveredForTab1 = await loadSheet(tab1State!.activeSheetId!);
    const recoveredForTab2 = await loadSheet(tab2State!.activeSheetId!);
    assert.ok(recoveredForTab1?.title.value.includes('1001'));
    assert.ok(recoveredForTab2?.title.value.includes('2002'));
  });

  // 7. Validação de pageInstanceId e Corrida Concorrente (Requisito 3)
  await runTest('7. Corrida e Validação de pageInstanceId: ação de instância documental antiga é rejeitada', async () => {
    const sender: any = { tab: { id: 303 } };

    // 1. Documento A registra contexto
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'doc_instance_A',
      payload: {
        url: 'https://www.bling.com.br/produtos/editar/777',
        pageType: 'product_form_edit',
        detectedProduct: { id: '777' }
      }
    }, sender, () => {});

    // 2. Refresh ou nova navegação cria Documento B e B passa a ser atual
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'doc_instance_B',
      payload: {
        url: 'https://www.bling.com.br/produtos/editar/778',
        pageType: 'product_form_edit',
        detectedProduct: { id: '778' }
      }
    }, sender, () => {});

    // 3. Ação tardia de A chega no background
    let staleActionResult: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'doc_instance_A', // INSTÂNCIA OBSOLETA
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: '777' }
      }
    }, sender, (res) => { staleActionResult = res; });

    // 4. Ação de A é rejeitada sem executar mock ou gravar ficha
    assert.strictEqual(staleActionResult?.ok, false);
    assert.ok(staleActionResult?.error?.includes('desatualizado') || staleActionResult?.error?.includes('rejeitada'));

    // 5. Ação de B (atual) é aceita
    let currentActionResult: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'doc_instance_B', // INSTÂNCIA ATUAL
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: '778' }
      }
    }, sender, (res) => { currentActionResult = res; });

    assert.strictEqual(currentActionResult?.ok, true);
    assert.ok(currentActionResult?.sheetId);
  });

  // 8. Não Confiar no pageType do Content Script (Requisito 4)
  await runTest('8. Autoridade de pageType no Background: background recalcula contexto da URL com classifyBlingUrl', async () => {
    const sender: any = { tab: { id: 404 } };

    // Content script mente/alega que /produtos/novo é product_form_edit com ID falso
    let detectResult: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_lying',
      payload: {
        url: 'https://www.bling.com.br/produtos/novo',
        pageType: 'product_form_edit', // NÃO CONFIÁVEL
        detectedProduct: { id: 'FAKE-ID' }
      }
    }, sender, (res) => { detectResult = res; });

    assert.strictEqual(detectResult?.ok, true);

    // O background recalculou para product_form_new e eliminou o ID
    const savedState = await tabContextManager.getTabState(404);
    assert.strictEqual(savedState?.pageType, 'product_form_new', 'Background deve forçar product_form_new');
    assert.strictEqual(savedState?.uiState.canImport, false, 'Importação deve ser bloqueada em produto novo');

    // Tentativa de importação deve ser rejeitada
    let actionResult: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_lying',
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: 'FAKE-ID' }
      }
    }, sender, (res) => { actionResult = res; });

    assert.strictEqual(actionResult?.ok, false);
    assert.ok(actionResult?.warning?.includes('Importação bloqueada'));
  });

  // 9. Validação Estrita de Domínio no Router (Requisito 6)
  await runTest('9. Validação Estrita de Domínio: rejeita URLs de domínios maliciosos ou não autorizados', async () => {
    const sender: any = { tab: { id: 505 } };

    let result: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_evil',
      payload: {
        url: 'https://evil-bling.com.br/produtos/editar/999',
        pageType: 'product_form_edit',
        detectedProduct: { id: '999' }
      }
    }, sender, (res) => { result = res; });

    assert.strictEqual(result?.ok, false);
    assert.ok(result?.error?.includes('domínio não autorizado') || result?.error?.includes('não pertence'));
  });

  // 10. Ciclo E2E na Mesma Aba (Requisito 1)
  await runTest('10. Ciclo E2E na Mesma Aba: Produto A -> navega B (limpa vínculo) -> importa B -> A intacta -> volta para A sem reutilizar ficha errada', async () => {
    const tabId = 501;
    const sender: any = { tab: { id: tabId } };

    // 1. Aba 501 detecta Produto A (101) e importa para Ficha A
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_501_a',
      payload: {
        url: 'https://www.bling.com.br/produtos/editar/101',
        pageType: 'product_form_edit',
        detectedProduct: { id: '101', sku: 'SKU-101' }
      }
    }, sender, () => {});

    let importAResult: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_501_a',
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: '101', sku: 'SKU-101' }
      }
    }, sender, (res) => { importAResult = res; });

    assert.strictEqual(importAResult?.ok, true);
    const sheetIdA = importAResult.sheetId;
    assert.ok(sheetIdA);

    const tabAfterA = await tabContextManager.getTabState(tabId);
    assert.strictEqual(tabAfterA?.activeSheetId, sheetIdA);

    // 2. Navegação na mesma aba para Produto B (202)
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_501_b',
      payload: {
        url: 'https://www.bling.com.br/produtos/editar/202',
        pageType: 'product_form_edit',
        detectedProduct: { id: '202', sku: 'SKU-202' }
      }
    }, sender, () => {});

    // 3. Confirmar que activeSheetId foi limpo na troca de produto
    const tabAfterNavToB = await tabContextManager.getTabState(tabId);
    assert.strictEqual(tabAfterNavToB?.activeSheetId, undefined, 'activeSheetId deve ser limpo ao navegar para outro produto');

    // 4. Importar Produto B cria Ficha B
    let importBResult: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_501_b',
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: '202', sku: 'SKU-202' }
      }
    }, sender, (res) => { importBResult = res; });

    assert.strictEqual(importBResult?.ok, true);
    const sheetIdB = importBResult.sheetId;
    assert.ok(sheetIdB);
    assert.notStrictEqual(sheetIdA, sheetIdB, 'Ficha B deve ser um novo ID');

    // 5. Ficha A permanece intacta no storage
    const sheetA = await loadSheet(sheetIdA);
    const sheetB = await loadSheet(sheetIdB);
    assert.ok(sheetA?.title.value.includes('101'), 'Ficha A deve preservar dados do produto 101');
    assert.ok(sheetB?.title.value.includes('202'), 'Ficha B deve conter dados do produto 202');

    // 6. Voltar ao Produto A na mesma aba
    await messageRouter.handleMessage({
      type: 'BLING_DOM_CONTEXT_DETECTED',
      pageInstanceId: 'inst_501_a2',
      payload: {
        url: 'https://www.bling.com.br/produtos/editar/101',
        pageType: 'product_form_edit',
        detectedProduct: { id: '101', sku: 'SKU-101' }
      }
    }, sender, () => {});

    // 7. Confirma que activeSheetId NÃO reutiliza ficha B nem reativa sem vínculo
    const tabAfterReturn = await tabContextManager.getTabState(tabId);
    assert.strictEqual(tabAfterReturn?.activeSheetId, undefined, 'Retornar ao produto A não deve reutilizar ficha B');
  });

  // 11. Defesa em Profundidade no MessageRouter (Requisito 2)
  await runTest('11. Defesa em Profundidade: rejeita reconciliar contra ficha de outro produto Bling e cria nova ficha', async () => {
    const tabId = 601;
    const sender: any = { tab: { id: tabId } };

    // Registra a aba com Produto 303
    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/303',
      pageType: 'product_form_edit',
      detectedProduct: { id: '303' }
    });

    // Simula uma inconsistência grave: a aba aponta para uma ficha do Produto 999
    const alienSheet = createInitialSheet();
    alienSheet.title.value = 'Produto Bling #999 Antigo';
    alienSheet.externalReferences = [{ system: 'bling', externalId: '999' }];
    await saveSheet(alienSheet);
    await tabContextManager.linkSheetToTab(tabId, alienSheet.id);

    // Dispara importação do Produto 303
    let result: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_601',
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: '303' }
      }
    }, sender, (res) => { result = res; });

    assert.strictEqual(result?.ok, true);
    const newSheetId = result.sheetId;

    // Confirma que a reconciliação NÃO ocorreu em cima da ficha alienígena
    assert.notStrictEqual(newSheetId, alienSheet.id, 'Deve criar nova ficha e não reconciliar sobre ficha de outro produto Bling');

    // Confirma que a ficha anterior permaneceu intacta
    const loadedAlien = await loadSheet(alienSheet.id);
    assert.strictEqual(loadedAlien?.title.value, 'Produto Bling #999 Antigo');

    // Confirma que a nova ficha foi associada à aba
    const updatedTab = await tabContextManager.getTabState(tabId);
    assert.strictEqual(updatedTab?.activeSheetId, newSheetId);
  });

  // 12. Identidade Canônica no Background (Requisito 5)
  await runTest('12. Identidade Canônica: prepare_mercadolivre usa estritamente currentTab.detectedProduct.id ignorando spoofing do clique', async () => {
    const tabId = 701;
    const sender: any = { tab: { id: tabId } };

    // Background validou Produto 777 da URL
    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/editar/777',
      pageType: 'product_form_edit',
      detectedProduct: { id: '777' }
    });

    // Clique envia ID adulterado
    let result: any = null;
    await messageRouter.handleMessage({
      type: 'BLING_ACTION_TRIGGERED',
      pageInstanceId: 'inst_701',
      payload: {
        action: 'prepare_mercadolivre',
        detectedProduct: { id: 'SPOOFED_888' }
      }
    }, sender, (res) => { result = res; });

    assert.strictEqual(result?.ok, true);
    const sheet = await loadSheet(result.sheetId);
    assert.ok(sheet?.title.value.includes('777'), 'Ficha deve usar ID validado pelo background (777)');
    assert.ok(!sheet?.title.value.includes('SPOOFED_888'), 'Ficha não deve usar ID adulterado do payload do clique');
  });

  // 13. Vínculo de Novo Produto da Sidebar (Requisito 4)
  await runTest('13. Vínculo Sidebar: LINK_SHEET_TO_TAB associa nova ficha criada pela Sidebar à aba ativa', async () => {
    const tabId = 801;

    await tabContextManager.registerOrUpdateTab(tabId, {
      platform: 'bling',
      url: 'https://www.bling.com.br/produtos/novo',
      pageType: 'product_form_new'
    });

    // Simula a Sidebar criando nova ficha e requisitando vínculo
    const newSidebarSheet = createInitialSheet();
    await saveSheet(newSidebarSheet);

    let linkResult: any = null;
    await messageRouter.handleMessage({
      type: 'LINK_SHEET_TO_TAB',
      tabId,
      sheetId: newSidebarSheet.id
    }, {} as any, (res) => { linkResult = res; });

    assert.strictEqual(linkResult?.ok, true);
    assert.strictEqual(linkResult?.state?.activeSheetId, newSidebarSheet.id);

    const tabState = await tabContextManager.getTabState(tabId);
    assert.strictEqual(tabState?.activeSheetId, newSidebarSheet.id, 'Aba deve estar vinculada à nova ficha criada na Sidebar');
  });
  } finally {
    messageRouter.setMockMode(false);
  }
}

