// Testes Unitários: Fase 4A - Mapper Puro Bling API v3 -> CentralProductSheet Patch
import assert from 'node:assert';
import { mapBlingProductToSheetPatch } from '../src/integrations/bling/bling-to-sheet.mapper.ts';
import { validateBlingProductInput } from '../src/integrations/bling/runtime-validator.ts';
import completeProductFixture from './fixtures/bling/complete-product.json';
import partialProductFixture from './fixtures/bling/partial-product.json';
import noEanProductFixture from './fixtures/bling/no-ean-product.json';
import noImageProductFixture from './fixtures/bling/no-image-product.json';
import commaDecimalProductFixture from './fixtures/bling/comma-decimal-product.json';
import unconfirmedUnitsProductFixture from './fixtures/bling/unconfirmed-units-product.json';
import invalidFieldsProductFixture from './fixtures/bling/invalid-fields-product.json';
import unknownFieldsProductFixture from './fixtures/bling/unknown-fields-product.json';

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

export async function runBlingMapperTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: MAPPER BLING (FASE 4A)');
  console.log('================================================================\n');

  // 1. Produto Completo Documentado
  await runTest('1. Produto completo documentado: mapeia todos os campos canônicos com sucesso', () => {
    const result = mapBlingProductToSheetPatch(completeProductFixture, {
      confirmedUnits: { weight: 'kg', dimension: 'cm' }
    });

    assert.strictEqual(result.warnings.length, 0);
    assert.strictEqual(result.patch.title?.value, completeProductFixture.nome);
    assert.strictEqual(result.patch.sku?.value, completeProductFixture.codigo);
    assert.strictEqual(result.patch.ean?.value, completeProductFixture.gtin);
    assert.strictEqual(result.patch.brand?.value, completeProductFixture.marca);
    assert.strictEqual(result.patch.ncm?.value, '84672100');
    assert.strictEqual(result.patch.currentSalePrice?.value, 649.90);
    assert.strictEqual(result.patch.costPrice?.value, 420.00);
    assert.strictEqual(result.patch.packageWidthCm?.value, 22.5);
    assert.strictEqual(result.patch.packageHeightCm?.value, 10.0);
    assert.strictEqual(result.patch.packageLengthCm?.value, 30.0);
    assert.strictEqual(result.patch.packageWeightKg?.value, 2.15);
    assert.strictEqual(result.patch.images?.length, 2);
    assert.strictEqual(result.patch.externalReference?.externalId, '123456789');
  });

  // 2. Produto Parcial
  await runTest('2. Produto parcial: mapeia apenas campos presentes sem inventar dados faltantes', () => {
    const result = mapBlingProductToSheetPatch(partialProductFixture);

    assert.strictEqual(result.patch.title?.value, 'Chave de Fenda Simples 6mm');
    assert.strictEqual(result.patch.currentSalePrice?.value, 19.90);
    assert.strictEqual(result.patch.ean, undefined);
    assert.strictEqual(result.patch.sku, undefined);
    assert.strictEqual(result.patch.costPrice, undefined);
    assert.strictEqual(result.patch.packageWeightKg, undefined);
    assert.strictEqual(result.patch.packageHeightCm, undefined);
  });

  // 3. Sem EAN
  await runTest('3. Sem EAN: produto sem GTIN informado não gera campo ean no patch', () => {
    const result = mapBlingProductToSheetPatch(noEanProductFixture);
    assert.strictEqual(result.patch.ean, undefined);
    assert.strictEqual(result.patch.title?.value, 'Parafuso Sextavado Aço Inox 100un');
  });

  // 4. Sem Imagem
  await runTest('4. Sem imagem: produto sem mídias/imagens omite images do patch', () => {
    const result = mapBlingProductToSheetPatch(noImageProductFixture);
    assert.strictEqual(result.patch.images, undefined);
    assert.strictEqual(result.patch.costPrice?.value, 8.00);
  });

  // 5. Custo mapeado para costPrice
  await runTest('5. Custo Bling: precoCusto é mapeado para costPrice com status pending_review', () => {
    const result = mapBlingProductToSheetPatch(completeProductFixture);
    assert.strictEqual(result.patch.costPrice?.value, 420.00);
    assert.strictEqual(result.patch.costPrice?.source, 'bling_erp');
    assert.strictEqual(result.patch.costPrice?.status, 'pending_review');
  });

  // 6. Peso e dimensões com conversão de unidades confirmadas no contexto
  await runTest('6. Dimensões e peso: realiza conversão precisa quando unidades estão confirmadas', () => {
    const customPayload = {
      id: 777,
      nome: "Mini Parafuso",
      dimensoes: {
        largura: 50,
        altura: 20,
        profundidade: 100
      },
      pesoBruto: 500
    };

    const result = mapBlingProductToSheetPatch(customPayload, {
      confirmedUnits: { weight: 'g', dimension: 'mm' }
    });

    assert.strictEqual(result.patch.packageWidthCm?.value, 5.0);
    assert.strictEqual(result.patch.packageHeightCm?.value, 2.0);
    assert.strictEqual(result.patch.packageLengthCm?.value, 10.0);
    assert.strictEqual(result.patch.packageWeightKg?.value, 0.5);
  });

  // 7. String numérica inequívoca
  await runTest('7. String numérica: aceita string puramente numérica com ponto decimal', () => {
    const customPayload = {
      id: "888",
      nome: "Alicate Universal",
      preco: "59.90",
      precoCusto: "35.50"
    };
    const result = mapBlingProductToSheetPatch(customPayload);
    assert.strictEqual(result.patch.currentSalePrice?.value, 59.90);
    assert.strictEqual(result.patch.costPrice?.value, 35.50);
  });

  // 8. Decimal com vírgula (padrão brasileiro)
  await runTest('8. Decimal com vírgula: normaliza "1.299,50" e "25,5" para float determinístico', () => {
    const result = mapBlingProductToSheetPatch(commaDecimalProductFixture, {
      confirmedUnits: { weight: 'kg', dimension: 'cm' }
    });
    assert.strictEqual(result.patch.currentSalePrice?.value, 1299.50);
    assert.strictEqual(result.patch.costPrice?.value, 849.90);
    assert.strictEqual(result.patch.packageWeightKg?.value, 3.45);
    assert.strictEqual(result.patch.packageWidthCm?.value, 25.5);
  });

  // 9. Campo inválido
  await runTest('9. Campo inválido: dados corrompidos geram warnings e são descartados com segurança', () => {
    const result = mapBlingProductToSheetPatch(invalidFieldsProductFixture);
    assert.strictEqual(result.patch.currentSalePrice, undefined);
    assert.strictEqual(result.patch.costPrice, undefined);
    assert.strictEqual(result.patch.ean, undefined);
    assert.ok(result.warnings.some(w => w.includes('preco')));
    assert.ok(result.warnings.some(w => w.includes('precoCusto')));
    assert.ok(result.warnings.some(w => w.includes('GTIN')));
  });

  // 10. Campo desconhecido
  await runTest('10. Campo desconhecido: propriedades não documentadas e estoque não entram no patch', () => {
    const result = mapBlingProductToSheetPatch(unknownFieldsProductFixture);
    assert.ok(result.unknownFields.includes('campo_inventado_xyz'));
    assert.ok(result.unknownFields.includes('custom_meta_property'));
    assert.ok(result.unknownFields.includes('flag_externa_qualquer'));
    assert.strictEqual((result.patch as any).campo_inventado_xyz, undefined);
    assert.strictEqual((result.patch as any).estoque, undefined);
  });

  // 11. currentSalePrice rigorosamente separado de suggestedSalePrice
  await runTest('11. Isolamento de preço: preço do Bling vai para currentSalePrice; suggestedSalePrice fica intocado', () => {
    const result = mapBlingProductToSheetPatch(completeProductFixture);
    assert.strictEqual(result.patch.currentSalePrice?.value, 649.90);
    assert.strictEqual((result.patch as any).suggestedSalePrice, undefined);
  });

  // 12. Origem bling_erp e status pending_review
  await runTest('12. Proveniência: todos os campos mapeados recebem source="bling_erp" e status="pending_review"', () => {
    const result = mapBlingProductToSheetPatch(completeProductFixture);
    assert.strictEqual(result.patch.title?.source, 'bling_erp');
    assert.strictEqual(result.patch.title?.status, 'pending_review');
    assert.strictEqual(result.patch.sku?.source, 'bling_erp');
    assert.strictEqual(result.patch.sku?.status, 'pending_review');
    assert.strictEqual(result.patch.currentSalePrice?.source, 'bling_erp');
    assert.strictEqual(result.patch.currentSalePrice?.status, 'pending_review');
  });

  // 13. Evidência com externalId
  await runTest('13. Evidência: cria erp_api_record com external ID, rawFieldKey e timestamp', () => {
    const testTime = '2026-09-18T10:00:00.000Z';
    const result = mapBlingProductToSheetPatch(completeProductFixture, {
      retrievedAt: testTime,
      sourceName: 'Bling ERP Teste'
    });

    const titleEv = result.patch.title?.evidence;
    assert.ok(titleEv);
    assert.strictEqual(titleEv?.sourceType, 'erp_api_record');
    assert.strictEqual(titleEv?.sourceId, '123456789');
    assert.strictEqual(titleEv?.rawFieldKey, 'nome');
    assert.strictEqual(titleEv?.capturedAt, testTime);
    assert.strictEqual(titleEv?.sourceName, 'Bling ERP Teste');
  });

  // 14. Nenhuma unidade presumida (Fact-or-Omit)
  await runTest('14. Nenhuma unidade presumida: sem unidade confirmada no contexto, dimensões e peso são omitidos com warning', () => {
    const result = mapBlingProductToSheetPatch(unconfirmedUnitsProductFixture);
    assert.strictEqual(result.patch.packageWidthCm, undefined);
    assert.strictEqual(result.patch.packageHeightCm, undefined);
    assert.strictEqual(result.patch.packageLengthCm, undefined);
    assert.strictEqual(result.patch.packageWeightKg, undefined);
    assert.ok(result.warnings.some(w => w.includes('Unidade de medida das dimensões não confirmada')));
    assert.ok(result.warnings.some(w => w.includes('Unidade de medida de peso não confirmada')));
  });

  // 15. Sanitização rigorosa do DTO Bling (Ajuste 2)
  await runTest('15. Sanitização DTO: tipos inválidos não reaparecem, campos desconhecidos não entram e raw input não sobrescreve', () => {
    const dirtyInput = {
      id: 999111,
      nome: 12345, // tipo inválido (deveria ser string)
      codigo: "SKU-DIRTY",
      preco: 99.00,
      campo_desconhecido_hacker: "malicioso",
      outro_campo_fantasma: true
    };

    const valResult = validateBlingProductInput(dirtyInput);
    assert.strictEqual(valResult.isValid, true);
    assert.ok(valResult.sanitized);

    // nome com tipo inválido (number) não é copiado para o DTO sanitizado
    assert.strictEqual(valResult.sanitized?.nome, undefined);

    // Campos desconhecidos NÃO existem em sanitized
    assert.strictEqual((valResult.sanitized as any)?.campo_desconhecido_hacker, undefined);
    assert.strictEqual((valResult.sanitized as any)?.outro_campo_fantasma, undefined);
    assert.ok(valResult.unknownFields.includes('campo_desconhecido_hacker'));
    assert.ok(valResult.unknownFields.includes('outro_campo_fantasma'));
  });

  // 16. Identidade mínima e ausência de externalId (Ajuste 3)
  await runTest('16. Identidade mínima: produto sem externalId confiável não gera ExternalProductReference, não gera sourceId vazio e emite warning', () => {
    const noIdInput = {
      nome: "Produto Sem ID Cadastrado no Bling",
      preco: 45.00
    };

    const result = mapBlingProductToSheetPatch(noIdInput);

    // ExternalProductReference NÃO deve ser criada
    assert.strictEqual(result.patch.externalReference, undefined);

    // Evidência não deve ter sourceId: ''
    const titleEv = result.patch.title?.evidence;
    assert.ok(titleEv);
    assert.strictEqual(titleEv?.sourceId, undefined);
    assert.notStrictEqual(titleEv?.sourceId, '');

    // Alerta explícito emitido
    assert.ok(result.warnings.some(w => w.includes('Identificador externo ausente')));
  });
}
