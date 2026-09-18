// Testes Unitários: Fase 4A - Migração Segura de Schema (v1 -> v2) e Resiliência de Storage
import assert from 'node:assert';
import { createInitialSheet, createAuditedField } from '../src/core/schema/product.ts';
import { migrateSheetToV2, validateSheetV2 } from '../src/core/schema/migrations.ts';
import { saveActiveSheet, loadActiveSheet, clearActiveSheet } from '../src/core/storage/storage.ts';

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

export async function runSchemaMigrationTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: MIGRAÇÃO DE SCHEMA & STORAGE (FASE 4A)');
  console.log('================================================================\n');

  await clearActiveSheet();

  // 1. Ficha v1 sem schemaVersion
  await runTest('1. Ficha v1 sem schemaVersion: detectada e migrada para v2 com sucesso', () => {
    const v1Sheet: any = {
      id: 'prod_legacy_100',
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
      ean: createAuditedField('7891000111222', 'user_manual', 1.0, 'approved'),
      sku: createAuditedField('SKU-LEGACY', 'user_manual', 1.0, 'approved'),
      title: createAuditedField('Produto Legado v1', 'user_manual', 1.0, 'approved'),
      brand: createAuditedField('Marca v1', 'user_manual', 1.0, 'approved'),
      model: createAuditedField('Modelo v1', 'user_manual', 1.0, 'approved'),
      categoryIdML: createAuditedField('MLB123', 'rule_engine', 1.0, 'approved'),
      categoryPathML: createAuditedField('Ferramentas', 'rule_engine', 1.0, 'approved'),
      ncm: createAuditedField('84672100', 'user_manual', 1.0, 'approved'),
      packageWeightKg: createAuditedField(1.5, 'rule_engine', 1.0, 'approved'),
      packageHeightCm: createAuditedField(10, 'rule_engine', 1.0, 'approved'),
      packageWidthCm: createAuditedField(20, 'rule_engine', 1.0, 'approved'),
      packageLengthCm: createAuditedField(30, 'rule_engine', 1.0, 'approved'),
      costPrice: createAuditedField(50.0, 'user_manual', 1.0, 'approved'),
      suggestedSalePrice: createAuditedField(99.90, 'rule_engine', 1.0, 'approved'),
      descriptionPlain: createAuditedField('Desc v1', 'user_manual', 1.0, 'approved'),
      bulletPoints: createAuditedField(['Destaque 1'], 'user_manual', 1.0, 'approved'),
      warrantyDays: createAuditedField(90, 'rule_engine', 1.0, 'approved'),
      images: [],
      attributes: [],
      overallConfidenceScore: 0.95,
      hasUnresolvedConflicts: false
      // Nota: sem schemaVersion, sem externalReferences, sem currentSalePrice
    };

    const migrated = migrateSheetToV2(v1Sheet);
    assert.strictEqual(migrated.schemaVersion, 2);
    assert.strictEqual(migrated.id, 'prod_legacy_100');
  });

  // 2. Transição v1 -> v2
  await runTest('2. v1 -> v2: adiciona os campos obrigatórios do Schema v2', () => {
    const v1Sheet: any = {
      schemaVersion: 1,
      id: 'prod_v1_explicit',
      createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
      ean: createAuditedField('7891000111222', 'user_manual', 1.0, 'approved'),
      sku: createAuditedField('SKU-V1', 'user_manual', 1.0, 'approved'),
      title: createAuditedField('Item V1', 'user_manual', 1.0, 'approved'),
      brand: createAuditedField('Marca', 'user_manual', 1.0, 'approved'),
      model: createAuditedField('Modelo', 'user_manual', 1.0, 'approved'),
      categoryIdML: createAuditedField('', 'rule_engine', 0, 'missing'),
      categoryPathML: createAuditedField('', 'rule_engine', 0, 'missing'),
      ncm: createAuditedField('', 'user_manual', 0, 'missing'),
      packageWeightKg: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageHeightCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageWidthCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageLengthCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      costPrice: createAuditedField(0, 'user_manual', 0, 'missing'),
      suggestedSalePrice: createAuditedField(0, 'rule_engine', 0, 'missing'),
      descriptionPlain: createAuditedField('', 'user_manual', 0, 'missing'),
      bulletPoints: createAuditedField([], 'user_manual', 0, 'missing'),
      warrantyDays: createAuditedField(0, 'rule_engine', 0, 'missing'),
      images: [],
      attributes: [],
      overallConfidenceScore: 0,
      hasUnresolvedConflicts: false
    };

    const migrated = migrateSheetToV2(v1Sheet);
    assert.strictEqual(migrated.schemaVersion, 2);
    assert.ok(Array.isArray(migrated.externalReferences));
    assert.ok(migrated.currentSalePrice);
  });

  // 3. Defaults seguros
  await runTest('3. Defaults seguros: novos campos são inicializados com segurança sem inventar fatos', () => {
    const v1Sheet: any = {
      id: 'prod_defaults',
      createdAt: '2026-09-03T10:00:00.000Z',
      updatedAt: '2026-09-03T10:00:00.000Z',
      ean: createAuditedField('', 'user_manual', 0, 'missing'),
      sku: createAuditedField('', 'user_manual', 0, 'missing'),
      title: createAuditedField('Item', 'user_manual', 1, 'approved'),
      brand: createAuditedField('', 'user_manual', 0, 'missing'),
      model: createAuditedField('', 'user_manual', 0, 'missing'),
      categoryIdML: createAuditedField('', 'rule_engine', 0, 'missing'),
      categoryPathML: createAuditedField('', 'rule_engine', 0, 'missing'),
      ncm: createAuditedField('', 'user_manual', 0, 'missing'),
      packageWeightKg: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageHeightCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageWidthCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageLengthCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      costPrice: createAuditedField(0, 'user_manual', 0, 'missing'),
      suggestedSalePrice: createAuditedField(0, 'rule_engine', 0, 'missing'),
      descriptionPlain: createAuditedField('', 'user_manual', 0, 'missing'),
      bulletPoints: createAuditedField([], 'user_manual', 0, 'missing'),
      warrantyDays: createAuditedField(0, 'rule_engine', 0, 'missing'),
      images: [],
      attributes: [],
      overallConfidenceScore: 0,
      hasUnresolvedConflicts: false
    };

    const migrated = migrateSheetToV2(v1Sheet);
    assert.strictEqual(migrated.currentSalePrice.value, 0);
    assert.strictEqual(migrated.currentSalePrice.status, 'missing');
    assert.strictEqual(migrated.externalReferences.length, 0);
  });

  // 4. Valores antigos preservados
  await runTest('4. Valores antigos preservados: id, createdAt, updatedAt, CMV e suggestedSalePrice intocados', () => {
    const v1Sheet: any = {
      id: 'prod_preserve_test',
      createdAt: '2026-08-15T09:30:00.000Z',
      updatedAt: '2026-08-20T14:45:00.000Z',
      ean: createAuditedField('7890001112223', 'user_manual', 1.0, 'approved'),
      sku: createAuditedField('SKU-PRESERVE', 'user_manual', 1.0, 'approved'),
      title: createAuditedField('Produto Preservado', 'user_manual', 1.0, 'approved'),
      brand: createAuditedField('Marca Original', 'user_manual', 1.0, 'approved'),
      model: createAuditedField('Modelo Original', 'user_manual', 1.0, 'approved'),
      categoryIdML: createAuditedField('MLB999', 'rule_engine', 1.0, 'approved'),
      categoryPathML: createAuditedField('Cat', 'rule_engine', 1.0, 'approved'),
      ncm: createAuditedField('84672100', 'user_manual', 1.0, 'approved'),
      packageWeightKg: createAuditedField(2.4, 'rule_engine', 1.0, 'approved'),
      packageHeightCm: createAuditedField(15, 'rule_engine', 1.0, 'approved'),
      packageWidthCm: createAuditedField(25, 'rule_engine', 1.0, 'approved'),
      packageLengthCm: createAuditedField(35, 'rule_engine', 1.0, 'approved'),
      costPrice: createAuditedField(75.50, 'user_manual', 1.0, 'approved'),
      suggestedSalePrice: createAuditedField(189.90, 'rule_engine', 1.0, 'approved'),
      descriptionPlain: createAuditedField('Desc original', 'user_manual', 1.0, 'approved'),
      bulletPoints: createAuditedField(['Ponto 1'], 'user_manual', 1.0, 'approved'),
      warrantyDays: createAuditedField(180, 'rule_engine', 1.0, 'approved'),
      images: [],
      attributes: [],
      overallConfidenceScore: 0.98,
      hasUnresolvedConflicts: false
    };

    const migrated = migrateSheetToV2(v1Sheet);
    assert.strictEqual(migrated.id, 'prod_preserve_test');
    assert.strictEqual(migrated.createdAt, '2026-08-15T09:30:00.000Z');
    assert.strictEqual(migrated.updatedAt, '2026-08-20T14:45:00.000Z');
    assert.strictEqual(migrated.costPrice.value, 75.50);
    assert.strictEqual(migrated.suggestedSalePrice.value, 189.90);
    assert.strictEqual(migrated.brand.value, 'Marca Original');
  });

  // 5. Conflitos e evidências preservados
  await runTest('5. Conflitos e evidências preservados: histórico de auditoria permanece íntegro', () => {
    const v1Sheet: any = {
      id: 'prod_conflict_preserve',
      createdAt: '2026-09-10T10:00:00.000Z',
      updatedAt: '2026-09-10T10:00:00.000Z',
      ean: createAuditedField('', 'user_manual', 0, 'missing'),
      sku: createAuditedField('', 'user_manual', 0, 'missing'),
      title: {
        value: 'Título Principal Vendedor',
        source: 'user_manual',
        confidence: 1.0,
        status: 'conflict',
        evidence: {
          sourceType: 'user_input',
          sourceName: 'Seller Direct',
          capturedAt: '2026-09-10T10:00:00.000Z'
        },
        conflictingValues: [
          {
            value: 'Título Conflitante da IA',
            source: 'ai_generated',
            confidence: 0.85
          }
        ]
      },
      brand: createAuditedField('', 'user_manual', 0, 'missing'),
      model: createAuditedField('', 'user_manual', 0, 'missing'),
      categoryIdML: createAuditedField('', 'rule_engine', 0, 'missing'),
      categoryPathML: createAuditedField('', 'rule_engine', 0, 'missing'),
      ncm: createAuditedField('', 'user_manual', 0, 'missing'),
      packageWeightKg: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageHeightCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageWidthCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      packageLengthCm: createAuditedField(0, 'rule_engine', 0, 'missing'),
      costPrice: createAuditedField(0, 'user_manual', 0, 'missing'),
      suggestedSalePrice: createAuditedField(0, 'rule_engine', 0, 'missing'),
      descriptionPlain: createAuditedField('', 'user_manual', 0, 'missing'),
      bulletPoints: createAuditedField([], 'user_manual', 0, 'missing'),
      warrantyDays: createAuditedField(0, 'rule_engine', 0, 'missing'),
      images: [],
      attributes: [],
      overallConfidenceScore: 0.5,
      hasUnresolvedConflicts: true
    };

    const migrated = migrateSheetToV2(v1Sheet);
    assert.strictEqual(migrated.title.status, 'conflict');
    assert.strictEqual(migrated.title.conflictingValues?.length, 1);
    assert.strictEqual(migrated.title.conflictingValues?.[0].value, 'Título Conflitante da IA');
    assert.strictEqual(migrated.title.evidence?.sourceType, 'user_input');
    assert.strictEqual(migrated.hasUnresolvedConflicts, true);
  });

  // 6. Serialização
  await runTest('6. Serialização: ficha v2 é serializável em JSON sem perda de dados', () => {
    const sheet = createInitialSheet();
    sheet.title = createAuditedField('Serra Tico-Tico', 'user_manual', 1.0, 'approved');
    sheet.currentSalePrice = createAuditedField(299.90, 'bling_erp', 0.95, 'approved');

    const jsonStr = JSON.stringify(sheet);
    const parsed = JSON.parse(jsonStr);

    const validation = validateSheetV2(parsed);
    assert.strictEqual(validation.isValid, true);
    assert.strictEqual(parsed.title.value, 'Serra Tico-Tico');
    assert.strictEqual(parsed.currentSalePrice.value, 299.90);
  });

  // 7. Persistência e recarga transparente no storage
  await runTest('7. Persistência e recarga: salva ficha v2 no storage e recarrega validada', async () => {
    await clearActiveSheet();
    const sheet = createInitialSheet();
    sheet.title = createAuditedField('Furadeira Bosch GSB 13 RE', 'user_manual', 1.0, 'approved');
    sheet.currentSalePrice = createAuditedField(319.90, 'bling_erp', 0.95, 'approved');

    await saveActiveSheet(sheet);
    const reloaded = await loadActiveSheet();

    assert.ok(reloaded);
    assert.strictEqual(reloaded?.schemaVersion, 2);
    assert.strictEqual(reloaded?.title.value, 'Furadeira Bosch GSB 13 RE');
    assert.strictEqual(reloaded?.currentSalePrice.value, 319.90);
  });

  // 8. Ficha v2 íntegra é validada e retornada (idempotência)
  await runTest('8. Idempotência: ficha v2 válida não sofre mutação ao passar por migrateSheetToV2', () => {
    const sheetV2 = createInitialSheet();
    sheetV2.title = createAuditedField('Produto V2 Já Estabilizado', 'user_manual', 1.0, 'approved');

    const result = migrateSheetToV2(sheetV2);
    assert.strictEqual(result, sheetV2, 'Deveria retornar a mesma instância validada');
  });

  // 9. Inválida não sobrescreve storage legado
  await runTest('9. Proteção do storage legado: ficha inválida tem persistência rejeitada sem corromper storage', async () => {
    await clearActiveSheet();

    const validSheet = createInitialSheet();
    validSheet.title = createAuditedField('Ficha Válida Salva', 'user_manual', 1.0, 'approved');
    await saveActiveSheet(validSheet);

    const invalidSheet: any = {
      schemaVersion: 2,
      id: 'bad_sheet'
    };

    let threwError = false;
    try {
      await saveActiveSheet(invalidSheet);
    } catch (err) {
      threwError = true;
    }
    assert.strictEqual(threwError, true, 'Deveria ter lançado erro ao tentar salvar ficha inválida');

    const active = await loadActiveSheet();
    assert.ok(active);
    assert.strictEqual(active?.title.value, 'Ficha Válida Salva');
  });

  // 10. Ficha v2 existente estruturalmente inválida é rejeitada (Ajuste 1)
  await runTest('10. Ficha v2 inválida: migrateSheetToV2 rejeita ficha com schemaVersion: 2 se for estruturalmente inválida', () => {
    const corruptedV2Sheet: any = {
      schemaVersion: 2,
      id: 'prod_v2_corrupted',
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:00:00.000Z',
      // campos auditados essenciais faltando
      title: createAuditedField('Título', 'user_manual', 1.0, 'approved')
    };

    assert.throws(
      () => migrateSheetToV2(corruptedV2Sheet),
      /Ficha Schema v2 existente é inválida/
    );
  });

  // 11. Validações estritas adicionais do Schema v2 (Ajuste 5)
  await runTest('11. Validação estrita v2: rejeita confidence fora de [0,1], datas não-ISO e externalReferences malformadas', () => {
    const sheet = createInitialSheet();

    // 11.1 Confidence > 1
    const invalidConfidence = { ...sheet, title: { ...sheet.title, confidence: 1.5 } };
    const res1 = validateSheetV2(invalidConfidence);
    assert.strictEqual(res1.isValid, false);
    assert.ok(res1.errors.some(e => e.includes('confidence')));

    // 11.2 Data createdAt não-ISO
    const invalidDate = { ...sheet, createdAt: 'não-é-uma-data' };
    const res2 = validateSheetV2(invalidDate);
    assert.strictEqual(res2.isValid, false);
    assert.ok(res2.errors.some(e => e.includes('createdAt')));

    // 11.3 overallConfidenceScore fora do intervalo [0, 1]
    const invalidScore = { ...sheet, overallConfidenceScore: -0.1 };
    const res3 = validateSheetV2(invalidScore);
    assert.strictEqual(res3.isValid, false);
    assert.ok(res3.errors.some(e => e.includes('overallConfidenceScore')));

    // 11.4 hasUnresolvedConflicts não-booleano
    const invalidConflicts = { ...sheet, hasUnresolvedConflicts: 'sim' as any };
    const res4 = validateSheetV2(invalidConflicts);
    assert.strictEqual(res4.isValid, false);
    assert.ok(res4.errors.some(e => e.includes('hasUnresolvedConflicts')));

    // 11.5 externalReferences malformadas
    const invalidRef = { ...sheet, externalReferences: [{ system: '', externalId: '' }] as any };
    const res5 = validateSheetV2(invalidRef);
    assert.strictEqual(res5.isValid, false);
    assert.ok(res5.errors.some(e => e.includes('externalReferences')));
  });
}
