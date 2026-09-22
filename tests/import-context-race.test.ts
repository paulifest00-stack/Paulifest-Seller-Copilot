import assert from 'node:assert/strict';
import { GatewayClient } from '../src/background/gateway-client.ts';
import { MessageRouter } from '../src/background/message-router.ts';
import { tabContextManager } from '../src/background/tab-context-manager.ts';
import { importCommitGate } from '../src/background/import-commit-gate.ts';
import { loadSheet, saveSheet } from '../src/core/storage/storage.ts';
import { createInitialSheet } from '../src/core/schema/product.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function run(name: string, test: () => Promise<void>) {
  const oldChrome = (globalThis as any).chrome;
  const link = tabContextManager.linkSheetToTab;
  try {
    delete (globalThis as any).chrome;
    await tabContextManager.clearAll();
    await test(); console.log('  ✓ PASS: ' + name);
  } catch (error) { console.error('  ✗ FAIL: ' + name); console.error(error); process.exitCode = 1; }
  finally { (globalThis as any).chrome = oldChrome; tabContextManager.linkSheetToTab = link; }
}
async function setup(mockMode = false) {
  const sheet = createInitialSheet();
  await tabContextManager.registerOrUpdateTab(900, {platform: 'bling', pageType: 'product_form_edit',
    detectedProduct: {id: 'A'}, pageInstanceId: 'document-A', activeSheetId: sheet.id});
  const client = new GatewayClient();
  client.fetchBlingProduct = async () => ({ok: true, product: {id: 'A', nome: 'Produto A', precoCusto: 8.42},
    warnings: [], unknownFields: [], retrievedAt: new Date().toISOString()});
  const router = new MessageRouter(client, {mockMode});
  let links = 0;
  const original = tabContextManager.linkSheetToTab.bind(tabContextManager);
  tabContextManager.linkSheetToTab = async (...args) => { links++; return original(...args); };
  const writes: any[] = [];
  const stored = new Map<string, any>();
  stored.set('paulifest_sheet_' + sheet.id, structuredClone(sheet));
  const local = {
    get: async (key: string) => ({[key]: structuredClone(stored.get(key))}),
    set: async (value: any) => { writes.push(structuredClone(value)); for (const [k,v] of Object.entries(value)) stored.set(k, structuredClone(v)); },
    remove: async (key: string) => { stored.delete(key); }
  };
  (globalThis as any).chrome = {storage: {local}};
  const request = () => new Promise<any>((resolve, reject) => {
    void router.handleMessage({type: 'BLING_ACTION_TRIGGERED', pageInstanceId: 'document-A',
      payload: {action: 'prepare_mercadolivre'}}, {tab: {id: 900} as chrome.tabs.Tab}, resolve).catch(reject);
  });
  return {sheet, client, router, local, writes, stored, request, links: () => links};
}

export async function runImportContextRaceTests() {
  // Pause the actual chrome.storage.local.get used by loadSheet, not a fake router barrier.
  for (const mock of [false, true]) for (const change of ['product', 'document', 'revision', 'removed-tab', 'auth', 'platform', 'route', 'ABA']) {
    await run(`Importação ${mock ? 'mock' : 'real'}: ${change} durante loadSheet não grava nem vincula`, async () => {
      const env = await setup(mock), started = deferred<void>(), read = deferred<void>();
      const original = env.local.get;
      env.local.get = async key => { const value = await original(key); started.resolve(); await read.promise; return value; };
      const pending = env.request(); await started.promise;
      if (change === 'product') await tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
      if (change === 'document') await tabContextManager.registerOrUpdateTab(900, {pageInstanceId: 'document-B'});
      if (change === 'revision') await tabContextManager.bumpRevision(900);
      if (change === 'removed-tab') await tabContextManager.removeTab(900);
      if (change === 'auth') await env.client.invalidateAuth();
      if (change === 'platform') await tabContextManager.registerOrUpdateTab(900, {platform: 'neutral'});
      if (change === 'route') await tabContextManager.registerOrUpdateTab(900, {pageType: 'product_list'});
      if (change === 'ABA') {
        await tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
        await tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'A'}});
      }
      const before = structuredClone(tabContextManager.peekTabState(900));
      read.resolve(); const response = await pending;
      assert.equal(response.ok, false); assert.equal(env.writes.length, 0); assert.equal(env.links(), 0);
      assert.deepEqual(tabContextManager.peekTabState(900), before);
    });
  }
  for (const mock of [false, true]) await run(`Importação ${mock ? 'mock' : 'real'}: happy path com loadSheet assíncrono`, async () => {
    const env = await setup(mock), started = deferred<void>(), read = deferred<void>();
    const original = env.local.get;
    env.local.get = async key => { started.resolve(); await read.promise; return original(key); };
    const pending = env.request(); await started.promise;
    assert.equal(env.writes.length, 0); read.resolve();
    const response = await pending;
    assert.equal(response.ok, true); assert.equal(env.writes.length, 1); assert.equal(env.links(), 1);
    assert.equal(tabContextManager.peekTabState(900)?.activeSheetId, response.sheetId);
    assert.equal(env.writes[0]['paulifest_sheet_' + response.sheetId].externalReferences[0].externalId, 'A');
  });
  for (const staggered of [false, true]) await run('Importação: deduplicação integral ' + (staggered ? 'após loading' : 'simultânea'), async () => {
    const env = await setup(), started = deferred<void>(), upstream = deferred<any>(); let fetches = 0;
    env.client.fetchBlingProduct = async () => {fetches++; started.resolve(); return upstream.promise;};
    const first = env.request(); if (staggered) await started.promise;
    const second = env.request(); await started.promise;
    await new Promise(resolve => setImmediate(resolve));
    upstream.resolve({ok: true, product: {id: 'A', nome: 'Produto A'}, warnings: [], unknownFields: [], retrievedAt: new Date().toISOString()});
    const results = await Promise.all([first, second]);
    assert.equal(fetches, 1); assert.equal(env.writes.length, 1); assert.equal(env.links(), 1);
    assert.equal(results[0].ok, true); assert.deepEqual(results[0], results[1]);
  });
  await run('Importação: erro upstream antigo não publica feedback na aba B', async () => {
    const env = await setup(), started = deferred<void>(), upstream = deferred<any>();
    env.client.fetchBlingProduct = async () => {started.resolve(); return upstream.promise;};
    const pending = env.request(); await started.promise;
    await tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
    const before = structuredClone(tabContextManager.peekTabState(900));
    upstream.reject(new Error('Erro antigo')); assert.equal((await pending).ok, false);
    assert.deepEqual(tabContextManager.peekTabState(900), before); assert.equal(env.writes.length, 0); assert.equal(env.links(), 0);
  });
  await run('Importação: contexto muda durante persistência do loading', async () => {
    const env = await setup(), started = deferred<void>(), persist = deferred<void>(); let first = true;
    (globalThis as any).chrome.storage.session = {set: async () => { if (first) { first = false; started.resolve(); await persist.promise; } }};
    const pending = env.request(); await started.promise;
    const changed = tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
    assert.equal(tabContextManager.peekTabState(900)?.detectedProduct?.id, 'B');
    persist.resolve(); await changed; assert.equal((await pending).ok, false); assert.equal(env.writes.length, 0); assert.equal(env.links(), 0);
  });
  await run('Importação: revalida após aguardar outro commit', async () => {
    const env = await setup(), started = deferred<void>(), read = deferred<void>();
    const original = env.local.get;
    env.local.get = async key => {const result = await original(key); started.resolve(); await read.promise; return result;};
    const pending = env.request(); await started.promise;
    const commitStarted = deferred<void>(), unlock = deferred<void>();
    const other = importCommitGate.commit(async () => {
      commitStarted.resolve(); await unlock.promise;
      await tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
    });
    await commitStarted.promise; read.resolve(); await new Promise(resolve => setImmediate(resolve));
    unlock.resolve(); await other;
    assert.equal((await pending).ok, false); assert.equal(env.writes.length, 0); assert.equal(env.links(), 0);
  });
  for (const phase of ['save', 'link']) for (const mutation of ['navigation', 'logout', 'remove']) {
    await run(`Importação: ${mutation} durante ${phase} invalida imediatamente e restaura storage`, async () => {
      const env = await setup(), started = deferred<void>(), persist = deferred<void>();
      const before = structuredClone(env.stored);
      if (phase === 'save') {
        const original = env.local.set; let first = true;
        env.local.set = async data => {if (first) {first = false; started.resolve(); await persist.promise;} await original(data);};
      } else {
        let first = true;
        (globalThis as any).chrome.storage.session = {
          set: async (data: any) => {
            const state: any = Object.values(data)[0];
            if (first && state.uiState.actionFeedback?.type === 'success') {first = false; started.resolve(); await persist.promise;}
          }, remove: async () => {}
        };
      }
      const oldAuth = env.client.getAuthGeneration();
      const pending = env.request(); await started.promise;
      let changed: Promise<unknown>;
      if (mutation === 'logout') {
        changed = env.client.invalidateAuth();
        assert.ok(env.client.getAuthGeneration() > oldAuth);
      } else if (mutation === 'remove') {
        changed = tabContextManager.removeTab(900); assert.equal(tabContextManager.peekTabState(900), undefined);
      } else {
        changed = tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
        assert.equal(tabContextManager.peekTabState(900)?.detectedProduct?.id, 'B');
      }
      let readFinished = false;
      const reader = loadSheet(env.sheet.id).then(value => {readFinished = true; return value;});
      await new Promise(resolve => setImmediate(resolve)); assert.equal(readFinished, false);
      persist.resolve(); const response = await pending; await changed;
      assert.equal(response.ok, false); assert.deepEqual(env.stored, before);
      assert.deepEqual(await reader, env.sheet);
      assert.equal(env.links(), phase === 'save' ? 0 : 1);
      assert.notEqual(tabContextManager.peekTabState(900)?.uiState.actionFeedback?.type, 'success');
      assert.equal(importCommitGate.isBlocked(), false);
    });
  }
  await run('Importação: gate FIFO libera fila após erro sem bloquear contexto', async () => {
    const first = deferred<void>(), started = deferred<void>(); const order: number[] = [];
    const a = importCommitGate.commit(async () => {order.push(1); started.resolve(); await first.promise; throw new Error('falha');});
    const rejected = assert.rejects(a, /falha/); await started.promise;
    const b = importCommitGate.commit(async () => {order.push(2);});
    const c = importCommitGate.commit(async () => {order.push(3);});
    await tabContextManager.registerOrUpdateTab(901, {platform: 'bling', detectedProduct: {id: 'B'}});
    assert.deepEqual(order, [1]); first.resolve(); await Promise.all([rejected,b,c]);
    assert.deepEqual(order, [1,2,3]); assert.equal(importCommitGate.isBlocked(), false);
  });
  await run('Importação: rollback não sobrescreve edição manual concorrente', async () => {
    const env = await setup(), started = deferred<void>(), persist = deferred<void>();
    const original = env.local.set; let first = true;
    env.local.set = async value => {if (first) {first = false; started.resolve(); await persist.promise;} await original(value);};
    const pending = env.request(); await started.promise;
    const manual = structuredClone(env.sheet); manual.title.value = 'Edição manual';
    const edit = saveSheet(manual);
    await tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
    persist.resolve(); assert.equal((await pending).ok, false); await edit;
    assert.equal((await loadSheet(manual.id))?.title.value, 'Edição manual');
  });
  await run('Importação: nova ficha stale é removida, sem substituir a ficha ativa anterior', async () => {
    const env = await setup(), started = deferred<void>(), persist = deferred<void>();
    env.stored.set('paulifest_active_product_sheet_v1', structuredClone(env.sheet));
    await tabContextManager.removeTab(900);
    await tabContextManager.registerOrUpdateTab(900, {platform: 'bling', pageType: 'product_form_edit', detectedProduct: {id: 'A'}, pageInstanceId: 'document-A'});
    const before = structuredClone(env.stored), original = env.local.set; let first = true;
    env.local.set = async value => {if (first) {first = false; started.resolve(); await persist.promise;} await original(value);};
    const pending = env.request(); await started.promise;
    await tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
    persist.resolve(); assert.equal((await pending).ok, false); assert.deepEqual(env.stored, before); assert.equal(env.links(), 0);
  });
  await run('Importação: edição da ficha durante espera pelo gate é preservada', async () => {
    const env = await setup(), unlock = deferred<void>(), started = deferred<void>();
    const held = importCommitGate.commit(async () => {started.resolve(); await unlock.promise;}); await started.promise;
    const pending = env.request(); await new Promise(resolve => setImmediate(resolve));
    const manual = structuredClone(env.sheet); manual.title.value = 'Decisão humana'; await saveSheet(manual);
    unlock.resolve(); await held;
    assert.equal((await pending).ok, false); assert.equal(env.links(), 0);
    assert.equal((await loadSheet(manual.id))?.title.value, 'Decisão humana');
  });
  await run('Importação: erro no vínculo restaura ficha e libera fila para retry', async () => {
    const env = await setup(), before = structuredClone(env.stored); let fail = true;
    (globalThis as any).chrome.storage.session = {set: async (data: any) => {
      const state: any = Object.values(data)[0];
      if (fail && state.uiState.actionFeedback?.type === 'success') {fail = false; throw new Error('erro no vínculo');}
    }};
    assert.equal((await env.request()).ok, false); assert.deepEqual(env.stored, before);
    assert.equal(importCommitGate.isBlocked(), false); assert.equal((await env.request()).ok, true);
  });
  await run('Quick View: navegação durante persistência do resultado não publica A em B', async () => {
    const env = await setup(), started = deferred<void>(), persist = deferred<void>(), messages: any[] = [];
    env.client.fetchBlingProductQuickView = async () => ({productId: 'A', costPrice: 8.42, stockInfo: null, retrievedAt: 'now'});
    (globalThis as any).chrome.tabs = {sendMessage: async (_id: number, message: any) => {messages.push(message);}};
    let first = true;
    (globalThis as any).chrome.storage.session = {set: async (data: any) => {
      const state: any = Object.values(data)[0];
      if (first && state.uiState.quickView?.productId === 'A') {first = false; started.resolve(); await persist.promise;}
    }};
    const pending = new Promise<any>(resolve => {void env.router.handleMessage({type: 'BLING_GET_QUICK_VIEW', pageInstanceId: 'document-A', payload: {productId: 'A'}}, {tab: {id: 900} as chrome.tabs.Tab}, resolve);});
    await started.promise;
    const changed = tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
    persist.resolve(); assert.equal((await pending).ok, false); await changed;
    assert.equal(messages.some(message => message.uiState?.quickView?.productId === 'A'), false);
  });
  await run('Importação: falha de persistência libera seção crítica e não vincula', async () => {
    const env = await setup(); env.local.set = async () => {throw new Error('storage indisponível');};
    assert.equal((await env.request()).ok, false); assert.equal(env.links(), 0); assert.equal(importCommitGate.isBlocked(), false);
    await tabContextManager.registerOrUpdateTab(900, {detectedProduct: {id: 'B'}});
    assert.equal(tabContextManager.peekTabState(900)?.detectedProduct?.id, 'B');
  });
}
