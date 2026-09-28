import assert from 'node:assert/strict';
import { generateRandomEan13, assignGeneratedEan, isGeneratedEan } from '../src/core/engines/identification/ean-generator.ts';
import { validateEan } from '../src/core/engines/identification/ean-validator.ts';
import { createInitialSheet, createAuditedField } from '../src/core/schema/product.ts';
import { saveSheet, loadSheet } from '../src/core/storage/storage.ts';
import { buildBlingProductUpdatePatch } from '../src/integrations/bling/sheet-to-bling-patch.ts';
import { runProductIdentification } from '../src/core/engines/identification/product-identifier.ts';
import { MockAIProvider } from '../src/core/services/ai-provider.service.ts';

export async function runEanGeneratorTests() {
  async function test(name: string, fn: () => void | Promise<void>) {
    try { await fn(); console.log(`  ✓ PASS: EAN gerado: ${name}`); }
    catch (error) { console.error(`  ✗ FAIL: EAN gerado: ${name}`, error); process.exitCode = 1; }
  }
  await test('13 dígitos de uso interno passam no checksum', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRandomEan13();
      assert.match(code, /^20[0-9]{11}$/);
      assert.equal(validateEan(code).valid, true);
    }
  });
  await test('gera EAN independente do SKU e já fica pré-aprovado para uso', () => {
    const sheet = assignGeneratedEan(createInitialSheet());
    assert.equal(isGeneratedEan(sheet.ean), true);
    assert.equal(sheet.ean.status, 'approved');
    assert.equal(sheet.sku.value, '');
    assert.equal(buildBlingProductUpdatePatch(sheet).gtin, sheet.ean.value);
  });
  await test('preserva EAN real e SKU existente', () => {
    const original = createInitialSheet();
    original.ean = createAuditedField('7894900011517');
    assert.equal(assignGeneratedEan(original), original);
    const withSku = createInitialSheet(); withSku.sku = createAuditedField('SKU-EXISTENTE');
    assert.equal(assignGeneratedEan(withSku).sku.value, 'SKU-EXISTENTE');
  });
  await test('salvar e reabrir conserva o mesmo código e a proveniência', async () => {
    const sheet = assignGeneratedEan(createInitialSheet());
    await saveSheet(sheet);
    const loaded = await loadSheet(sheet.id);
    assert.ok(loaded);
    assert.equal(assignGeneratedEan(loaded).ean.value, sheet.ean.value);
    assert.equal(isGeneratedEan(loaded.ean), true);
  });
  await test('não usa número gerado como identidade de pesquisa ou entrada da IA', async () => {
    const sheet = assignGeneratedEan(createInitialSheet());
    const provider = new MockAIProvider();
    const identify = provider.identifyProduct.bind(provider);
    provider.identifyProduct = async request => {
      assert.equal(request.ean, undefined);
      return identify(request);
    };
    const result = await runProductIdentification({ ean: sheet.ean.value, rawName: 'Produto interno' }, sheet, provider);
    assert.equal(result.sheet.ean.value, sheet.ean.value);
    assert.equal(isGeneratedEan(result.sheet.ean), true);
    assert.notEqual(result.sheet.sku.value, sheet.ean.value);
  });
}
