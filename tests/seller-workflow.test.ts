import assert from 'node:assert/strict';
import { GeminiAIProvider } from '../src/core/services/ai-provider.service.ts';
import { GEMINI_MODEL, limitMlTitle, requestGeminiJson } from '../src/core/services/gemini-client.ts';
import { generateListingContent, applyListingContent, listingFacts } from '../src/core/services/listing-content.ts';
import { createInitialSheet, createAuditedField } from '../src/core/schema/product.ts';
import { buildNewProductFormValues } from '../src/integrations/bling/new-product-form.ts';
import { tabContextManager } from '../src/background/tab-context-manager.ts';
import { messageRouter } from '../src/background/message-router.ts';
import { loadSheet } from '../src/core/storage/storage.ts';
import { fillNewBlingProduct } from '../src/content-scripts/bling/fill-new-product.ts';

export async function runSellerWorkflowTests() {
  const ok = (value: unknown) => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }) }) as Response;
  async function test(name: string, fn: () => unknown | Promise<unknown>) {
    const fetch = globalThis.fetch;
    try { await fn(); console.log('  ✓ PASS: Fluxo seller: ' + name); }
    catch (error) { console.error('  ✗ FAIL: Fluxo seller: ' + name, error); process.exitCode = 1; }
    finally { globalThis.fetch = fetch; }
  }
  await test('HTTP 400 mostra motivo do Google e não expõe chave', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid: secret-key' } }) }) as Response;
    await assert.rejects(requestGeminiJson('secret-key', 'test', []), error => {
      assert.match(String(error), /HTTP 400.*API key not valid/);
      assert.ok(!String(error).includes('secret-key')); return true;
    });
  });
  await test('imagem PNG usa seu MIME e modelo atual com chave somente no cabeçalho', async () => {
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).includes(GEMINI_MODEL)); assert.ok(!String(url).includes('secret'));
      assert.equal((init?.headers as any)['x-goog-api-key'], 'secret');
      const body = JSON.parse(init!.body as string);
      assert.deepEqual(body.contents[0].parts[0].inlineData, { data: 'cGljdHVyZQ==', mimeType: 'image/png' });
      return ok({ title: { value: 'Produto azul', evidence: 'Nome informado', confidence: .8 }, attributes: {} });
    };
    const result = await new GeminiAIProvider('secret').identifyProduct({ imageBase64: 'data:image/png;base64,cGljdHVyZQ==' });
    assert.equal(result.title?.value, 'Produto azul'); assert.equal(result.packageWeightKg, undefined);
    assert.equal(result.warrantyDays, undefined); assert.equal(result.categoryML, undefined);
  });
  await test('cota 429 tem orientação sem fallback simulado', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) }) as Response;
    await assert.rejects(new GeminiAIProvider('test').identifyProduct({ rawName: 'Copo' }), /Limite de uso/);
  });
  await test('resposta bloqueada ou truncada não vira ficha', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }) }) as Response;
    await assert.rejects(requestGeminiJson('test', '', []), /MAX_TOKENS/);
  });
  await test('partes de pensamento não contaminam JSON final', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ thought: true, text: 'pensamento' }, { text: '{"text":' }, { text: '"Copo"}' }] } }] }) }) as Response;
    assert.deepEqual(await requestGeminiJson('test', '', []), { text: 'Copo' });
  });
  await test('título respeita 60 caracteres sem quebrar palavras', () => {
    const text = 'Jogo de Copos de Vidro Transparente para Água Suco e Refrigerante';
    assert.equal(limitMlTitle(text), 'Jogo de Copos de Vidro Transparente para Água Suco e');
    assert.ok(Array.from(limitMlTitle('😀'.repeat(65))).length <= 60);
  });
  await test('descrição usa fatos da ficha e ignora campos em conflito', async () => {
    const sheet = createInitialSheet();
    sheet.titleBling = createAuditedField('Copo de Vidro 300 ml', 'bling_erp', .9, 'pending_review');
    sheet.brand = createAuditedField('Marca Identificada', 'ai_generated', .8, 'pending_review');
    sheet.model = createAuditedField('Modelo em conflito', 'bling_erp', .5, 'conflict');
    assert.equal(listingFacts(sheet).marca, undefined); assert.equal(listingFacts(sheet).modelo, undefined);
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.ok(body.contents[0].parts[0].text.includes('Copo de Vidro 300 ml'));
      assert.ok(!body.contents[0].parts[0].text.includes('Marca Identificada')); 
      return ok({ text: 'Copo de vidro com capacidade de 300 ml.' });
    };
    const text = await generateListingContent(sheet, 'test', 'descriptionPlain');
    const updated = applyListingContent(sheet, structuredClone(sheet), 'descriptionPlain', text);
    assert.equal(updated.descriptionPlain.status, 'pending_review'); assert.equal(updated.descriptionPlain.value, text);
    assert.equal(updated.titleBling, sheet.titleBling);
  });
  await test('edição durante IA e troca de produto não são sobrescritas', () => {
    const snapshot = createInitialSheet(); const edited = structuredClone(snapshot);
    edited.descriptionPlain = createAuditedField('Texto digitado');
    assert.equal(applyListingContent(edited, snapshot, 'descriptionPlain', 'Texto IA'), edited);
    const other = createInitialSheet(); assert.equal(applyListingContent(other, snapshot, 'title', 'Texto IA'), other);
  });
  await test('novo cadastro não exige ID e exclui sugestões não revisadas', () => {
    const sheet = createInitialSheet(); sheet.titleBling = createAuditedField('Copo'); sheet.sku = createAuditedField('COPO-01');
    sheet.descriptionPlain = createAuditedField('Rascunho IA', 'ai_generated', .8, 'pending_review');
    assert.deepEqual(buildNewProductFormValues(sheet), { nome: 'COPO', codigo: 'COPO-01' });
  });
  await test('novo formulário mantém rascunho em eventos repetidos e limpa ao trocar documento', async () => {
    const tab = 921;
    await tabContextManager.registerOrUpdateTab(tab, { platform: 'bling', pageType: 'product_form_new', pageInstanceId: 'new-A', url: 'https://www.bling.com.br/produtos.php#add' });
    await tabContextManager.linkSheetToTab(tab, 'draft-1');
    const repeated = await tabContextManager.registerOrUpdateTab(tab, { pageType: 'product_form_new', pageInstanceId: 'new-A', detectedProduct: { id: 'fake-id' } });
    assert.equal(repeated.activeSheetId, 'draft-1'); assert.equal(repeated.detectedProduct?.id, undefined);
    const next = await tabContextManager.registerOrUpdateTab(tab, { pageType: 'product_form_new', pageInstanceId: 'new-B' });
    assert.equal(next.activeSheetId, undefined);
    await tabContextManager.removeTab(tab);
  });
  await test('dock cria e persiste ficha vazia sem autenticação nem ID do Bling', async () => {
    const tab = 922;
    await tabContextManager.registerOrUpdateTab(tab, { platform: 'bling', pageType: 'product_form_new', pageInstanceId: 'new-C', url: 'https://www.bling.com.br/produtos.php#add' });
    let response: any;
    await messageRouter.handleMessage({ type: 'BLING_ACTION_TRIGGERED', pageInstanceId: 'new-C', payload: { action: 'open_in_copilot' } }, { tab: { id: tab } } as any, value => { response = value; });
    assert.equal(response.ok, true);
    const state = await tabContextManager.getTabState(tab); assert.ok(state?.activeSheetId);
    const sheet = await loadSheet(state!.activeSheetId!); assert.ok(sheet); assert.equal(sheet.title.value, ''); assert.equal(sheet.externalReferences.length, 0);
    await tabContextManager.removeTab(tab);
  });
  await test('preenche vazios, preserva digitação e rejeita navegação para produto existente', () => {
    const original = { window: (globalThis as any).window, input: (globalThis as any).HTMLInputElement, textarea: (globalThis as any).HTMLTextAreaElement };
    class Input { value = ''; disabled = false; readOnly = false; events: string[] = []; dispatchEvent(e: Event) { this.events.push(e.type); return true; } }
    class Textarea extends Input {}
    try {
      (globalThis as any).HTMLInputElement = Input; (globalThis as any).HTMLTextAreaElement = Textarea;
      const url = 'https://www.bling.com.br/produtos.php#add'; (globalThis as any).window = { location: { href: url } };
      const name = new Input(), sku = new Input(), description = new Textarea(); sku.value = 'DIGITADO';
      const root = { querySelector: (selector: string) => selector.includes('#nome') ? name : selector.includes('#codigo') ? sku : selector.includes('textarea') ? description : null } as unknown as Document;
      const result = fillNewBlingProduct({ nome: 'Copo', codigo: 'NOVO', descricaoComplementar: 'Vidro 300 ml' }, url, root);
      assert.deepEqual(result.filled, ['nome', 'descricaoComplementar']); assert.equal(sku.value, 'DIGITADO');
      assert.deepEqual(name.events, ['input', 'change']); assert.equal(description.value, 'Vidro 300 ml');
      (globalThis as any).window.location.href = 'https://www.bling.com.br/produtos.php#edit/123';
      assert.equal(fillNewBlingProduct({ nome: 'ERRADO' }, url, root).ok, false); assert.equal(name.value, 'Copo');
    } finally { (globalThis as any).window = original.window; (globalThis as any).HTMLInputElement = original.input; (globalThis as any).HTMLTextAreaElement = original.textarea; }
  });
}
