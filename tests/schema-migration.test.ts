import assert from 'node:assert';
import {
  createInitialSheet,
  createAuditedField,
  evaluatePreparationStatus
} from '../src/core/schema/product.ts';
import {
  migrateSheetToV2,
  validateSheetV2,
  migrateSheetToV3,
  validateSheetV3,
  isValidAuditedFieldV3,
  CURRENT_SCHEMA_VERSION
} from '../src/core/schema/migrations.ts';
import {
  saveActiveSheet,
  loadActiveSheet,
  clearActiveSheet,
  saveSheet,
  loadSheet,
  _setRawStorageForTesting,
  _getRawStorageForTesting
} from '../src/core/storage/storage.ts';

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

  // Helper para criar uma ficha Schema v2 válida e isolada
  function createValidV2Sheet(): any {
    return {
      schemaVersion: 2,
      id: `prod_v2_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      createdAt: '2026-09-15T10:00:00.000Z',
      updatedAt: '2026-09-15T10:00:00.000Z',
      ean: createAuditedField('7891000111222', 'user_manual', 1.0, 'approved'),
      sku: createAuditedField('SKU-V2', 'user_manual', 1.0, 'approved'),
      title: createAuditedField('Produto V2 Teste', 'user_manual', 1.0, 'approved'),
      brand: createAuditedField('Marca V2', 'user_manual', 1.0, 'approved'),
      model: createAuditedField('Modelo V2', 'user_manual', 1.0, 'approved'),
      categoryIdML: createAuditedField('MLB1051', 'rule_engine', 1.0, 'approved'),
      categoryPathML: createAuditedField('Ferramentas', 'rule_engine', 1.0, 'approved'),
      ncm: createAuditedField('84672100', 'user_manual', 1.0, 'approved'),
      packageWeightKg: createAuditedField(1.2, 'rule_engine', 1.0, 'approved'),
      packageHeightCm: createAuditedField(12, 'rule_engine', 1.0, 'approved'),
      packageWidthCm: createAuditedField(18, 'rule_engine', 1.0, 'approved'),
      packageLengthCm: createAuditedField(24, 'rule_engine', 1.0, 'approved'),
      costPrice: createAuditedField(45.0, 'user_manual', 1.0, 'approved'),
      currentSalePrice: createAuditedField(89.90, 'bling_erp', 0.95, 'approved'),
      suggestedSalePrice: createAuditedField(119.90, 'rule_engine', 1.0, 'approved'),
      descriptionPlain: createAuditedField('Descrição v2', 'user_manual', 1.0, 'approved'),
      bulletPoints: createAuditedField(['Destaque A'], 'user_manual', 1.0, 'approved'),
      warrantyDays: createAuditedField(90, 'rule_engine', 1.0, 'approved'),
      images: [],
      attributes: [],
      externalReferences: [],
      overallConfidenceScore: 0.95,
      hasUnresolvedConflicts: false
    };
  }

  // 6. Serialização
  await runTest('6. Serialização: ficha v2 é serializável em JSON sem perda de dados', () => {
    const sheet = createValidV2Sheet();
    sheet.title = createAuditedField('Serra Tico-Tico', 'user_manual', 1.0, 'approved');
    sheet.currentSalePrice = createAuditedField(299.90, 'bling_erp', 0.95, 'approved');

    const jsonStr = JSON.stringify(sheet);
    const parsed = JSON.parse(jsonStr);

    const validation = validateSheetV2(parsed);
    assert.strictEqual(validation.isValid, true);
    assert.strictEqual(parsed.title.value, 'Serra Tico-Tico');
    assert.strictEqual(parsed.currentSalePrice.value, 299.90);
  });

  // 7. Persistência e recarga transparente no storage com evolução v3
  await runTest('7. Persistência e recarga: salva ficha v3 no storage e recarrega validada', async () => {
    await clearActiveSheet();
    const sheet = createInitialSheet();
    sheet.title = createAuditedField('Furadeira Bosch GSB 13 RE', 'user_manual', 1.0, 'approved');
    sheet.currentSalePrice = createAuditedField(319.90, 'bling_erp', 0.95, 'approved');

    await saveActiveSheet(sheet);
    const reloaded = await loadActiveSheet();

    assert.ok(reloaded);
    assert.strictEqual(reloaded?.schemaVersion, 3);
    assert.strictEqual(reloaded?.title.value, 'Furadeira Bosch GSB 13 RE');
    assert.strictEqual(reloaded?.currentSalePrice.value, 319.90);
  });

  // 8. Ficha v2 íntegra é validada e retornada (idempotência v2)
  await runTest('8. Idempotência: ficha v2 válida não sofre mutação ao passar por migrateSheetToV2', () => {
    const sheetV2 = createValidV2Sheet();
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
      schemaVersion: 3,
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

  // 10. Ficha v2 existente estruturalmente inválida é rejeitada
  await runTest('10. Ficha v2 inválida: migrateSheetToV2 rejeita ficha com schemaVersion: 2 se for estruturalmente inválida', () => {
    const corruptedV2Sheet: any = {
      schemaVersion: 2,
      id: 'prod_v2_corrupted',
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:00:00.000Z',
      title: createAuditedField('Título', 'user_manual', 1.0, 'approved')
    };

    assert.throws(
      () => migrateSheetToV2(corruptedV2Sheet),
      /Ficha Schema v2 existente é inválida/
    );
  });

  // 11. Validações estritas adicionais do Schema v2
  await runTest('11. Validação estrita v2: rejeita confidence fora de [0,1], datas não-ISO e externalReferences malformadas', () => {
    const sheet = createValidV2Sheet();

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

  // =========================================================================
  // FASE 4D.1: SCHEMA V3, INVARIANTES DE NULL, MIGRAÇÃO V2 -> V3 & PREPARATION
  // =========================================================================

  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: SCHEMA V3, MIGRAÇÃO & PREPARAÇÃO (FASE 4D.1)');
  console.log('================================================================\n');

  // 12. Invariante Estrito de AuditedFieldV3: status === 'missing' aceita null
  await runTest('12. Invariante V3: status === "missing" permite value: null', () => {
    const missingField = createAuditedField(null, 'user_manual', 0.0, 'missing');
    assert.strictEqual(isValidAuditedFieldV3(missingField), true);
  });

  // 13. Invariante Estrito de AuditedFieldV3: status !== 'missing' rejeita null
  await runTest('13. Invariante V3: status !== "missing" REJEITA expressamente value: null ou undefined', () => {
    const approvedNull = createAuditedField(null, 'user_manual', 1.0, 'approved');
    assert.strictEqual(isValidAuditedFieldV3(approvedNull), false);

    const pendingUndefined: any = {
      value: undefined,
      source: 'bling_erp',
      confidence: 0.8,
      status: 'pending_review'
    };
    assert.strictEqual(isValidAuditedFieldV3(pendingUndefined), false);
  });

  // 14. Invariante Estrito: conflictingValues não pode conter null como ausência
  await runTest('14. Invariante V3: conflictingValues contendo null é rejeitado', () => {
    const fieldWithNullConflict: any = {
      value: 100.0,
      source: 'user_manual',
      confidence: 1.0,
      status: 'conflict',
      conflictingValues: [
        {
          value: null,
          source: 'bling_erp',
          confidence: 0.8
        }
      ]
    };
    assert.strictEqual(isValidAuditedFieldV3(fieldWithNullConflict), false);
  });

  // 15. Migração v2 válida -> v3
  await runTest('15. Migração: v2 válida migra com sucesso para Schema v3', () => {
    const v2Sheet = createValidV2Sheet();
    v2Sheet.costPrice = createAuditedField(55.0, 'user_manual', 1.0, 'approved');

    const v3 = migrateSheetToV3(v2Sheet);
    assert.strictEqual(v3.schemaVersion, 3);
    assert.ok(v3.migratedAt);
    assert.ok(Array.isArray(v3.migrationNotes) && v3.migrationNotes.length > 0);
    assert.strictEqual(v3.costPrice.value, 55.0);
    assert.strictEqual(v3.costPrice.status, 'approved');
  });

  // 16. Migração legado v1 -> v2 -> v3
  await runTest('16. Migração em cascata: v1 legada sem schemaVersion passa por v1 -> v2 -> v3', () => {
    const v1Sheet: any = {
      id: 'prod_legacy_chain',
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
      ean: createAuditedField('7891000111222', 'user_manual', 1.0, 'approved'),
      sku: createAuditedField('SKU-CHAIN', 'user_manual', 1.0, 'approved'),
      title: createAuditedField('Produto Legado Cadeia', 'user_manual', 1.0, 'approved'),
      brand: createAuditedField('Marca', 'user_manual', 1.0, 'approved'),
      model: createAuditedField('Modelo', 'user_manual', 1.0, 'approved'),
      categoryIdML: createAuditedField('MLB1051', 'rule_engine', 1.0, 'approved'),
      categoryPathML: createAuditedField('Ferramentas', 'rule_engine', 1.0, 'approved'),
      ncm: createAuditedField('84672100', 'user_manual', 1.0, 'approved'),
      packageWeightKg: createAuditedField(1.0, 'rule_engine', 1.0, 'approved'),
      packageHeightCm: createAuditedField(10, 'rule_engine', 1.0, 'approved'),
      packageWidthCm: createAuditedField(15, 'rule_engine', 1.0, 'approved'),
      packageLengthCm: createAuditedField(20, 'rule_engine', 1.0, 'approved'),
      costPrice: createAuditedField(0, 'user_manual', 0.0, 'missing'), // zero sintético legado
      suggestedSalePrice: createAuditedField(0, 'rule_engine', 0.0, 'missing'),
      descriptionPlain: createAuditedField('Desc', 'user_manual', 1.0, 'approved'),
      bulletPoints: createAuditedField([], 'user_manual', 1.0, 'approved'),
      warrantyDays: createAuditedField(90, 'rule_engine', 1.0, 'approved'),
      images: [],
      attributes: [],
      overallConfidenceScore: 0.9,
      hasUnresolvedConflicts: false
    };

    const v3 = migrateSheetToV3(v1Sheet);
    assert.strictEqual(v3.schemaVersion, 3);
    assert.strictEqual(v3.id, 'prod_legacy_chain');
    // Zero sintético migra para null
    assert.strictEqual(v3.costPrice.value, null);
    assert.strictEqual(v3.costPrice.status, 'missing');
  });

  // 17. Idempotência v3: v3 válida retorna sem mutação
  await runTest('17. Idempotência v3: ficha Schema v3 válida não sofre mutação ao passar por migrateSheetToV3', () => {
    const sheetV3 = createInitialSheet();
    sheetV3.title = createAuditedField('Item V3 Já Estabilizado', 'user_manual', 1.0, 'approved');

    const result = migrateSheetToV3(sheetV3);
    assert.strictEqual(result, sheetV3, 'Deve retornar a mesma instância validada');
  });

  // 18. Versão desconhecida rejeitada (fail-closed)
  await runTest('18. Versão desconhecida: migrateSheetToV3 rejeita versões 4, 99 ou negativas com erro controlado', () => {
    const futureSheet: any = {
      schemaVersion: 4,
      id: 'prod_future'
    };
    assert.throws(
      () => migrateSheetToV3(futureSheet),
      /versão desconhecida 4/
    );

    const negativeVersion: any = {
      schemaVersion: -1,
      id: 'prod_negative'
    };
    assert.throws(
      () => migrateSheetToV3(negativeVersion),
      /versão desconhecida -1/
    );
  });

  // 19. Payload corrompido / não-objeto rejeitado (fail-closed)
  await runTest('19. Payload corrompido: migrateSheetToV3 rejeita null, strings e tipos não-objeto', () => {
    assert.throws(() => migrateSheetToV3(null), /esperava objeto/);
    assert.throws(() => migrateSheetToV3('string_invalida'), /esperava objeto/);
    assert.throws(() => migrateSheetToV3(12345), /esperava objeto/);
  });

  // 20. Preservação integral de metadados de auditoria (evidence, provenance, user_manual, conflictingValues, externalReferences)
  await runTest('20. Preservação integral: histórico de auditoria e vínculos são mantidos intactos', () => {
    const v2Sheet = createValidV2Sheet();
    v2Sheet.title = {
      value: 'Serra Circular Vendedor',
      source: 'user_manual',
      confidence: 1.0,
      status: 'conflict',
      evidence: {
        sourceType: 'user_input',
        sourceName: 'Seller Input Form',
        capturedAt: '2026-09-12T14:00:00.000Z'
      },
      conflictingValues: [
        {
          value: 'Serra Elétrica Circular ERP',
          source: 'bling_erp',
          confidence: 0.9
        }
      ]
    };
    v2Sheet.externalReferences = [
      {
        system: 'bling',
        externalId: '123456789',
        importedAt: '2026-09-12T14:00:00.000Z',
        metadata: { codigo: 'SERRA-01' }
      }
    ];

    const v3 = migrateSheetToV3(v2Sheet);
    assert.strictEqual(v3.title.status, 'conflict');
    assert.strictEqual(v3.title.source, 'user_manual');
    assert.strictEqual(v3.title.evidence?.sourceType, 'user_input');
    assert.strictEqual(v3.title.evidence?.sourceName, 'Seller Input Form');
    assert.strictEqual(v3.title.conflictingValues?.length, 1);
    assert.strictEqual(v3.title.conflictingValues?.[0].value, 'Serra Elétrica Circular ERP');
    assert.strictEqual(v3.externalReferences.length, 1);
    assert.strictEqual(v3.externalReferences[0].externalId, '123456789');
  });

  // 21. costPrice: missing 0 vira null
  await runTest('21. Semântica costPrice: missing com valor 0 migra para value: null', () => {
    const v2Sheet = createValidV2Sheet();
    v2Sheet.costPrice = createAuditedField(0, 'user_manual', 0.0, 'missing');

    const v3 = migrateSheetToV3(v2Sheet);
    assert.strictEqual(v3.costPrice.status, 'missing');
    assert.strictEqual(v3.costPrice.value, null);
  });

  // 22. costPrice: zero explícito com status aprovado/pending permanece 0
  await runTest('22. Semântica costPrice: zero explícito (status approved ou pending_review) permanece número 0', () => {
    const v2Sheet = createValidV2Sheet();
    v2Sheet.costPrice = createAuditedField(0, 'bling_erp', 0.9, 'approved');

    const v3 = migrateSheetToV3(v2Sheet);
    assert.strictEqual(v3.costPrice.status, 'approved');
    assert.strictEqual(v3.costPrice.value, 0);

    // Também para pending_review
    const v2Pending = createValidV2Sheet();
    v2Pending.costPrice = createAuditedField(0, 'bling_erp', 0.85, 'pending_review');
    const v3Pending = migrateSheetToV3(v2Pending);
    assert.strictEqual(v3Pending.costPrice.status, 'pending_review');
    assert.strictEqual(v3Pending.costPrice.value, 0);
  });

  // 23. Storage não destrói dado legado se migração falhar
  await runTest('23. Storage resiliência: falha de migração preserva storage e propaga erro controlado', async () => {
    await clearActiveSheet();

    // Grava diretamente no storage um payload corrompido com versão desconhecida
    const corruptedPayload = {
      schemaVersion: 999,
      id: 'prod_alien'
    };

    await _setRawStorageForTesting('paulifest_sheet_prod_alien', corruptedPayload);

    let threw = false;
    try {
      await loadSheet('prod_alien');
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes('Falha ao validar/migrar ficha prod_alien'));
    }
    assert.strictEqual(threw, true, 'Deve ter lançado erro controlado');

    // Confirma que o dado persistido NÃO foi apagado nem sobrescrito
    const rawInStore = await _getRawStorageForTesting('paulifest_sheet_prod_alien');
    assert.deepStrictEqual(rawInStore, corruptedPayload, 'O storage persistido original deve permanecer intacto');
  });

  // 24. Preparation Status: incomplete
  await runTest('24. evaluatePreparationStatus: incomplete quando falta título ou SKU/EAN', () => {
    const sheet = createInitialSheet();
    // Título e identificadores vazios
    const evalResult = evaluatePreparationStatus(sheet);
    assert.strictEqual(evalResult.status, 'incomplete');
    assert.ok(evalResult.missingFields.includes('title'));
  });

  // 25. Preparation Status: pending_review
  await runTest('25. evaluatePreparationStatus: pending_review quando campos importados aguardam validação', () => {
    const sheet = createInitialSheet();
    sheet.title = createAuditedField('Produto Importado', 'bling_erp', 0.9, 'pending_review');
    sheet.sku = createAuditedField('SKU-123', 'bling_erp', 0.9, 'approved');

    const evalResult = evaluatePreparationStatus(sheet);
    assert.strictEqual(evalResult.status, 'pending_review');
    assert.ok(evalResult.pendingFields.includes('title'));
  });

  // 26. Preparation Status: has_conflicts
  await runTest('26. evaluatePreparationStatus: has_conflicts tem precedência absoluta se houver conflito', () => {
    const sheet = createInitialSheet();
    sheet.title = createAuditedField('Produto A', 'user_manual', 1.0, 'conflict');
    sheet.sku = createAuditedField('SKU-123', 'bling_erp', 0.9, 'approved');

    const evalResult = evaluatePreparationStatus(sheet);
    assert.strictEqual(evalResult.status, 'has_conflicts');
    assert.ok(evalResult.conflictFields.includes('title'));
  });

  // 27. Preparation Status: ready_for_review
  await runTest('27. evaluatePreparationStatus: ready_for_review quando estrutura mínima está preenchida sem pendências', () => {
    const sheet = createInitialSheet();
    sheet.title = createAuditedField('Produto Completo e Aprovado', 'user_manual', 1.0, 'approved');
    sheet.sku = createAuditedField('SKU-PRONTO', 'user_manual', 1.0, 'approved');

    const evalResult = evaluatePreparationStatus(sheet);
    assert.strictEqual(evalResult.status, 'ready_for_review');
    assert.strictEqual(evalResult.conflictFields.length, 0);
    assert.strictEqual(evalResult.pendingFields.length, 0);
  });
}
