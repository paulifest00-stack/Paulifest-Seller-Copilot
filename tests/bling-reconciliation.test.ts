// Testes Unitários: Fase 4A - Reconciliação Determinística e Não-Destrutiva de Patches Bling
import assert from 'node:assert';
import { createInitialSheet, createAuditedField } from '../src/core/schema/product.ts';
import { mapBlingProductToSheetPatch } from '../src/integrations/bling/bling-to-sheet.mapper.ts';
import { reconcileBlingPatch } from '../src/integrations/bling/reconciliation.ts';
import completeProductFixture from './fixtures/bling/complete-product.json';
import partialProductFixture from './fixtures/bling/partial-product.json';
import invalidFieldsProductFixture from './fixtures/bling/invalid-fields-product.json';

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

export async function runBlingReconciliationTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: RECONCILIAÇÃO BLING (FASE 4A)');
  console.log('================================================================\n');

  // 1. Ficha Vazia / Inicial
  await runTest('1. Ficha vazia: campos missing recebem dados do Bling com status pending_review', () => {
    const sheet = createInitialSheet();
    const mapping = mapBlingProductToSheetPatch(completeProductFixture, {
      confirmedUnits: { weight: 'kg', dimension: 'cm' }
    });

    const result = reconcileBlingPatch(sheet, mapping);

    assert.strictEqual(result.sheet.title.value, completeProductFixture.nome);
    assert.strictEqual(result.sheet.title.status, 'pending_review');
    assert.strictEqual(result.sheet.title.source, 'bling_erp');

    assert.strictEqual(result.sheet.sku.value, completeProductFixture.codigo);
    assert.strictEqual(result.sheet.ean.value, completeProductFixture.gtin);
    assert.strictEqual(result.sheet.currentSalePrice.value, 649.90);
    assert.strictEqual(result.sheet.costPrice.value, 420.00);

    // suggestedSalePrice inicial permanece intacto (null, missing)
    assert.strictEqual(result.sheet.suggestedSalePrice.value, null);
    assert.strictEqual(result.sheet.suggestedSalePrice.status, 'missing');

    assert.strictEqual(result.sheet.externalReferences.length, 1);
    assert.strictEqual(result.sheet.externalReferences[0].externalId, '123456789');
    assert.ok(result.appliedFields.includes('title'));
    assert.ok(result.appliedFields.includes('sku'));
    assert.ok(result.appliedFields.includes('currentSalePrice'));
  });

  // 2. Mesmo Valor e Corroboração
  await runTest('2. Mesmo valor: corrobora dado existente sem gerar conflito e reforça confiança', () => {
    const sheet = createInitialSheet();
    sheet.title = createAuditedField(completeProductFixture.nome, 'ai_generated', 0.85, 'approved');
    sheet.brand = createAuditedField('Bosch', 'ai_generated', 0.80, 'approved');

    const mapping = mapBlingProductToSheetPatch(completeProductFixture);
    const result = reconcileBlingPatch(sheet, mapping);

    assert.strictEqual(result.sheet.title.value, completeProductFixture.nome);
    assert.strictEqual(result.sheet.title.status, 'approved');
    assert.ok(result.corroboratedFields.includes('title'));
    assert.ok(result.corroboratedFields.includes('brand'));
    assert.strictEqual(result.sheet.title.conflictingValues, undefined);
  });

  // 3. Conflito com Edição Manual do Vendedor
  await runTest('3. Conflito com manual: valor do seller NUNCA é sobrescrito; proposta Bling vira conflito', () => {
    const sheet = createInitialSheet();
    const manualTitle = 'Título Customizado Manualmente pelo Seller';
    sheet.title = createAuditedField(manualTitle, 'user_manual', 1.0, 'edited');

    const mapping = mapBlingProductToSheetPatch(completeProductFixture);
    const result = reconcileBlingPatch(sheet, mapping);

    // REGRA DE OURO: o valor do vendedor continua sendo o valor principal do campo!
    assert.strictEqual(result.sheet.title.value, manualTitle);
    assert.strictEqual(result.sheet.title.status, 'conflict');
    assert.strictEqual(result.sheet.hasUnresolvedConflicts, true);
    assert.ok(result.conflictedFields.includes('title'));

    // A proposta do Bling é arquivada em conflictingValues
    assert.ok(result.sheet.title.conflictingValues);
    assert.strictEqual(result.sheet.title.conflictingValues?.length, 1);
    assert.strictEqual(result.sheet.title.conflictingValues?.[0].value, completeProductFixture.nome);
    assert.strictEqual(result.sheet.title.conflictingValues?.[0].source, 'bling_erp');
  });

  // 4. Divergência com Valor Existente Não-Manual
  await runTest('4. Divergência com outra fonte: gera conflito auditável sem sobrescrita cega', () => {
    const sheet = createInitialSheet();
    sheet.brand = createAuditedField('Marca Concorrente Fake', 'ai_generated', 0.70, 'pending_review');

    const mapping = mapBlingProductToSheetPatch(completeProductFixture);
    const result = reconcileBlingPatch(sheet, mapping);

    assert.strictEqual(result.sheet.brand.status, 'conflict');
    assert.ok(result.conflictedFields.includes('brand'));
    assert.ok(result.sheet.brand.conflictingValues?.some(c => c.value === 'Bosch'));
  });

  // 5. Ausente Não Apaga
  await runTest('5. Ausente não apaga: campo existente não informado pelo Bling permanece 100% intacto', () => {
    const sheet = createInitialSheet();
    sheet.ncm = createAuditedField('84672100', 'user_manual', 1.0, 'approved');
    sheet.warrantyDays = createAuditedField(365, 'rule_engine', 1.0, 'approved');

    // Mapeia produto parcial (não contém NCM nem garantia)
    const mapping = mapBlingProductToSheetPatch(partialProductFixture);
    const result = reconcileBlingPatch(sheet, mapping);

    assert.strictEqual(result.sheet.ncm.value, '84672100');
    assert.strictEqual(result.sheet.ncm.status, 'approved');
    assert.strictEqual(result.sheet.warrantyDays.value, 365);
    assert.ok(result.unalteredFields.includes('ncm'));
    assert.ok(result.unalteredFields.includes('warrantyDays'));
  });

  // 6. Resposta Parcial
  await runTest('6. Resposta parcial: afeta somente os campos presentes no payload', () => {
    const sheet = createInitialSheet();
    sheet.brand = createAuditedField('DeWalt', 'user_manual', 1.0, 'approved');

    const mapping = mapBlingProductToSheetPatch(partialProductFixture);
    const result = reconcileBlingPatch(sheet, mapping);

    assert.strictEqual(result.sheet.title.value, 'Chave de Fenda Simples 6mm');
    assert.strictEqual(result.sheet.currentSalePrice.value, 19.90);
    // Brand não foi alterado
    assert.strictEqual(result.sheet.brand.value, 'DeWalt');
    assert.ok(result.unalteredFields.includes('brand'));
  });

  // 7. Warning Não Modifica Campo
  await runTest('7. Warning não modifica: campos com erros de validação mantêm ficha inalterada', () => {
    const sheet = createInitialSheet();
    sheet.currentSalePrice = createAuditedField(150.00, 'user_manual', 1.0, 'approved');

    // invalidFieldsFixture tem preco = "não-e-numero"
    const mapping = mapBlingProductToSheetPatch(invalidFieldsProductFixture);
    const result = reconcileBlingPatch(sheet, mapping);

    assert.strictEqual(result.sheet.currentSalePrice.value, 150.00);
    assert.strictEqual(result.sheet.currentSalePrice.status, 'approved');
    assert.ok(result.warnings.length > 0);
  });

  // 8. Função Pura: Nenhuma Mutação no Objeto de Entrada
  await runTest('8. Imutabilidade: a função reconcileBlingPatch não muta o objeto de entrada', () => {
    const originalSheet = createInitialSheet();
    originalSheet.title = createAuditedField('Original Title', 'user_manual', 1.0, 'approved');
    const snapshotBefore = JSON.stringify(originalSheet);

    const mapping = mapBlingProductToSheetPatch(completeProductFixture);
    const result = reconcileBlingPatch(originalSheet, mapping);

    const snapshotAfter = JSON.stringify(originalSheet);
    assert.strictEqual(snapshotBefore, snapshotAfter, 'O objeto originalSheet foi mutado!');
    assert.notStrictEqual(result.sheet, originalSheet, 'Retornou a mesma referência de memória!');
  });
}
