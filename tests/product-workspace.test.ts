import { GatewayApp } from '../src/gateway/http/app.ts';
import { loadGatewayConfig } from '../src/gateway/config.ts';
import { InMemoryGatewayRepository } from '../src/gateway/database/repository.ts';
import { BlingTokenManager } from '../src/gateway/integrations/bling/bling-token-manager.ts';
import { createGatewaySessionToken } from '../src/gateway/crypto/pairing-state.ts';
import assert from 'node:assert/strict';
import { createAuditedField, createInitialSheet } from '../src/core/schema/product.ts';
import { saveSheet, loadSheet, listSavedSheets, clearActiveSheet, saveWorkspace, loadWorkspace } from '../src/core/storage/storage.ts';
import { listingFacts, buildCompleteDescriptionFallback, applyListingContent } from '../src/core/services/listing-content.ts';
import { runProductIdentification } from '../src/core/engines/identification/product-identifier.ts';
import { GeminiAIProvider } from '../src/core/services/ai-provider.service.ts';
import { BlingProductClient } from '../src/gateway/integrations/bling/bling-product-client.ts';
import { MessageRouter } from '../src/background/message-router.ts';
import { GatewayClient } from '../src/background/gateway-client.ts';
import { SidepanelContextSync } from '../src/sidepanel/context-sync.ts';

export async function runProductWorkspaceTests() {
  const originalChrome = (globalThis as any).chrome;
  const originalFetch = globalThis.fetch;
  const records: Record<string, unknown> = {};
  const runtime = { id: 'test-extension', getURL: (path: string) => 'chrome-extension://test-extension/' + path };
  (globalThis as any).chrome = { runtime, storage: { local: {
    async get(key: string | null) { return key === null ? structuredClone(records) : { [key]: structuredClone(records[key]) }; },
    async set(value: Record<string, unknown>) { Object.assign(records, structuredClone(value)); },
    async remove(key: string) { delete records[key]; }
  } } };
  async function test(name: string, fn: () => unknown | Promise<unknown>) {
    try { await fn(); console.log('  ✓ PASS: Workspace: ' + name); }
    catch (error) { console.error('  ✗ FAIL: Workspace: ' + name, error); process.exitCode = 1; }
    finally { globalThis.fetch = originalFetch; }
  }
  try {
    await test('salvar não modifica snapshot usado pela identificação', async () => {
      const sheet = createInitialSheet(); sheet.updatedAt = '2020-01-01T00:00:00Z';
      const before = structuredClone(sheet); Object.freeze(sheet);
      await saveSheet(sheet); assert.deepEqual(sheet, before);
      assert.notEqual((await loadSheet(sheet.id))!.updatedAt, before.updatedAt);
    });
    await test('biblioteca conserva duas fichas ao trocar ou limpar referência ativa', async () => {
      const a = createInitialSheet(), b = createInitialSheet();
      a.title = createAuditedField('Produto A'); b.title = createAuditedField('Produto B');
      await saveSheet(a); await saveSheet(b); await clearActiveSheet();
      const saved = await listSavedSheets(); assert.ok(saved.some(s => s.id === a.id)); assert.ok(saved.some(s => s.id === b.id));
      assert.equal((await loadSheet(a.id))!.title.value, 'Produto A');
    });
    await test('produto selecionado e etapa não mudam com navegação ou importação de outro produto', async () => {
      const a = createInitialSheet(), b = createInitialSheet(); await saveSheet(a);
      await saveWorkspace({ sheetId: a.id, step: 4 }); await saveSheet(b);
      let context: unknown;
      const sync = new SidepanelContextSync(async () => null, value => { context = value; });
      await sync.refresh(); assert.equal(context, null);
      assert.deepEqual(await loadWorkspace(), { sheetId: a.id, step: 4 }); sync.dispose();
    });
    await test('parâmetros de preço sobrevivem à recuperação da ficha', async () => {
      const sheet = createInitialSheet();
      sheet.pricingDraft = { mode: 'free_price', listingType: 'gold_pro', targetMargin: 23, targetNetReceive: 30, freePrice: 89, taxRate: 8, packagingCost: 3, weightKg: 2 };
      await saveSheet(sheet); assert.deepEqual((await loadSheet(sheet.id))!.pricingDraft, sheet.pricingDraft);
    });
    await test('resposta real de identificação preenche títulos e preserva dados existentes ausentes na resposta', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: { value: 'Copo Vidro 300ml', evidence: 'Copo vidro 300ml', confidence: .9 }, titleBling: { value: 'COPO VIDRO 300ML', evidence: 'Copo vidro 300ml', confidence: .9 } }) }] } }] }));
      const sheet = createInitialSheet(); sheet.brand = createAuditedField('Marca cadastrada', 'bling_erp', .9, 'pending_review');
      const result = await runProductIdentification({ rawName: 'Copo vidro 300ml' }, sheet, new GeminiAIProvider('test-key'));
      assert.equal(result.sheet.title.value, 'Copo Vidro 300ml'); assert.equal(result.sheet.titleBling!.value, 'COPO VIDRO 300ML');
      assert.deepEqual(result.sheet.brand, sheet.brand); assert.equal(result.researchResult, undefined);
    });
    await test('dimensão conflitante e atributo não revisado não viram fatos', () => {
      const sheet = createInitialSheet(); sheet.packageHeightCm = createAuditedField(10);
      sheet.packageWidthCm = createAuditedField(90, 'ai_generated', .8, 'conflict');
      sheet.brand = createAuditedField('Sugestão', 'ai_generated', .8, 'pending_review');
      const facts = listingFacts(sheet); assert.equal(facts.alturaCm, 10); assert.equal(facts.larguraCm, undefined); assert.equal(facts.comprimentoCm, undefined); assert.equal(facts.marca, undefined);
    });
    await test('texto básico não inventa origem, estoque, quantidade ou envio e geração permanece pendente', () => {
      const sheet = createInitialSheet(); sheet.title = createAuditedField('Copo');
      const text = buildCompleteDescriptionFallback(sheet);
      assert.equal(text, 'Produto: Copo');
      const applied = applyListingContent(sheet, structuredClone(sheet), 'descriptionPlain', text);
      assert.equal(applied.descriptionPlain.status, 'pending_review');
    });
    await test('catálogo pagina e busca SKU sem vazar campos extras', async () => {
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.searchParams.get('pagina'), '2'); assert.equal(url.searchParams.get('limite'), '30');
        assert.equal(url.searchParams.get('codigo'), 'ABC&123'); assert.equal(url.searchParams.get('nome'), null);
        assert.equal((init!.headers as any).Authorization, 'Bearer test-token');
        return new Response(JSON.stringify({ data: [{ id: 123, nome: 'Copo', codigo: 'ABC&123', preco: 0, internal: 'omit' }] }));
      };
      const result = await new BlingProductClient().searchProducts('ABC&123', 2, 'sku', 'test-token');
      assert.deepEqual(result, { items: [{ id: '123', name: 'Copo', sku: 'ABC&123', price: 0 }], page: 2, hasMore: false });
    });
    await test('catálogo propaga expiração de token e rejeita envelope inválido', async () => {
      const client = new BlingProductClient(); globalThis.fetch = async () => new Response('{}', { status: 401 });
      await assert.rejects(client.searchProducts('', 1, 'name', 'test'), (error: any) => error.status === 401);
      globalThis.fetch = async () => new Response('{"data":{}}');
      await assert.rejects(client.searchProducts('', 1, 'name', 'test'), (error: any) => error.code === 'INVALID_BLING_PAYLOAD');
    });
    await test('rota HTTP de catálogo autentica, pagina e bloqueia sessão revogada', async () => {
      const config = loadGatewayConfig({ NODE_ENV: 'test' });
      const repository = new InMemoryGatewayRepository();
      const now = new Date().toISOString();
      await repository.saveConnection({ id: 'workspace-conn', status: 'connected', createdAt: now, updatedAt: now });
      await repository.createGatewaySession({ id: 'workspace-session', connectionId: 'workspace-conn', clientSessionId: 'workspace-client', tokenFamilyId: 'workspace-family', refreshTokenHash: 'test-only', expiresAt: '2099-01-01T00:00:00Z', createdAt: now });
      let calls = 0;
      const productClient = new BlingProductClient();
      productClient.searchProducts = async (query, page, searchBy, token) => {
        calls++; assert.equal(query, 'copo'); assert.equal(searchBy, 'name'); assert.equal(token, 'test-only');
        return { items: [{ id: '123', name: 'Copo', sku: 'COP', price: 10 }], page, hasMore: false };
      };
      const manager = { executeWithBlingAuth: async (id: string, callback: (token: string) => unknown) => { assert.equal(id, 'workspace-conn'); return callback('test-only'); } } as BlingTokenManager;
      const app = new GatewayApp({ config, repository, productClient, tokenManager: manager });
      const port = await app.listen(0);
      const url = 'http://127.0.0.1:' + port + '/integrations/bling/products?query=copo&page=2&searchBy=name';
      const token = createGatewaySessionToken({ connectionId: 'workspace-conn', clientSessionId: 'workspace-client', sessionId: 'workspace-session' }, config.jwtSecret, 600);
      const headers = { Authorization: 'Bearer ' + token };
      try {
        assert.equal((await originalFetch(url)).status, 401); assert.equal(calls, 0);
        const response = await originalFetch(url, { headers }); assert.equal(response.status, 200);
        const body = await response.json(); assert.equal(body.page, 2); assert.equal(body.items[0].id, '123');
        assert.equal((await originalFetch(url.replace('page=2', 'page=-1'), { headers })).status, 400); assert.equal(calls, 1);
        await repository.revokeSessionFamily('workspace-family');
        assert.equal((await originalFetch(url, { headers })).status, 401); assert.equal(calls, 1);
      } finally { await app.close(); }
    });
    await test('catálogo só atende o painel confiável e rejeita respostas depois de desconectar', async () => {
      const client = new GatewayClient(); const router = new MessageRouter(client);
      let calls = 0; let generation = 0;
      client.getAuthGeneration = () => generation;
      client.searchBlingProducts = async () => { calls++; generation++; return { ok: true, items: [], page: 1 }; };
      let result: any;
      const message = { type: 'BLING_SEARCH_PRODUCTS', query: '', page: 1, searchBy: 'name' };
      await router.handleMessage(message, { id: runtime.id, url: 'https://www.bling.com.br/' }, value => { result = value; });
      assert.equal(result.ok, false); assert.equal(calls, 0);
      await router.handleMessage(message, { id: runtime.id, url: runtime.getURL('sidepanel.html') }, value => { result = value; });
      assert.equal(result.ok, false); assert.match(result.error, /conexão mudou/); assert.equal(calls, 1);
    });
  } finally { (globalThis as any).chrome = originalChrome; globalThis.fetch = originalFetch; }
}
