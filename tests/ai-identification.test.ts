// Testes Unitários: Fase 3 - Identificação Automática, Pesquisa Confiável e Proveniência Auditável (18 Cenários Auditados)
import assert from 'node:assert';
import { 
  createInitialSheet, 
  resolveFieldConflict, 
  createAuditedField 
} from '../src/core/schema/product.ts';
import { 
  MockAIProvider, 
  GeminiAIProvider, 
  AIProviderConfigError 
} from '../src/core/services/ai-provider.service.ts';
import { 
  MockResearchProvider 
} from '../src/core/services/research-provider.service.ts';
import { 
  runProductIdentification 
} from '../src/core/engines/identification/product-identifier.ts';
import { 
  TruthAndConflictEngine 
} from '../src/core/engines/identification/truth-engine.ts';
import { 
  validateRawAttribute, 
  validateAIResponse 
} from '../src/core/engines/identification/runtime-validator.ts';
import { 
  saveActiveSheet, 
  loadActiveSheet, 
  clearActiveSheet 
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

export async function runIdentificationTests() {
  console.log('\n================================================================');
  console.log('   AUDITORIA DE TESTES: FASE 3 (18 CENÁRIOS OFICIAIS)');
  console.log('================================================================\n');

  const aiProvider = new MockAIProvider();
  const researchProvider = new MockResearchProvider();

  // ---------------------------------------------------------------------------
  // 1. JSON inválido/truncado
  // ---------------------------------------------------------------------------
  await runTest('1. JSON inválido/truncado: Runtime Validator rejeita payload malformado', () => {
    const checkNull = validateAIResponse(null);
    assert.strictEqual(checkNull.isValid, false);
    assert.strictEqual(checkNull.issues[0].field, 'root');

    const checkString = validateAIResponse("não é um objeto json");
    assert.strictEqual(checkString.isValid, false);

    const checkTruncatedAttrs = validateAIResponse({
      productSummary: 'Teste',
      attributes: "string em vez de record" // tipo corrompido
    });
    assert.strictEqual(checkTruncatedAttrs.isValid, true);
    assert.deepStrictEqual(checkTruncatedAttrs.sanitized?.attributes, {});
  });

  // ---------------------------------------------------------------------------
  // 2. Campo sem evidência
  // ---------------------------------------------------------------------------
  await runTest('2. Campo sem evidência: descartado em conformidade com Fact-or-Omit', () => {
    const res = validateRawAttribute('potencia', {
      value: '750W',
      evidence: '' // Evidência vazia
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.issue?.includes('Fact-or-Omit violado'));
  });

  // ---------------------------------------------------------------------------
  // 3. Confidence alta sem evidência
  // ---------------------------------------------------------------------------
  await runTest('3. Confidence alta sem evidência: rejeitado mesmo com confidence 0.99 ou 1.0', () => {
    const res = validateRawAttribute('voltagem', {
      value: '220V',
      confidence: 0.99, // Alta confiança declarada
      evidence: '   '   // Porém sem nenhuma evidência factual comprovável
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.issue?.includes('Fact-or-Omit'));
  });

  // ---------------------------------------------------------------------------
  // 4. Somente foto
  // ---------------------------------------------------------------------------
  await runTest('4. Somente foto: extrai atributos visíveis via OCR com evidência comprovável', async () => {
    const sheet = createInitialSheet();
    const res = await runProductIdentification(
      {
        imageBase64: 'data:image/jpeg;base64,mock_bosch_drill_image_payload'
      },
      sheet,
      aiProvider,
      {
        providerId: 'no-research',
        searchProductFacts: async () => ({
          query: {},
          found: false,
          items: [],
          rejectedItemsCount: 0,
          providerId: 'no-research',
          searchedAt: new Date().toISOString()
        })
      }
    );

    assert.strictEqual(res.sheet.brand.value, 'Bosch');
    assert.strictEqual(res.sheet.model.value, 'GSB 13 RE');
    assert.ok(res.sheet.brand.evidence?.extractedSnippet?.includes('BOSCH'));
    assert.strictEqual(res.sheet.brand.evidence?.sourceType, 'image_ocr');
    assert.strictEqual(res.sheet.packageWeightKg.value, 1.8);
    assert.strictEqual(res.summary.readFromImageCount >= 1, true);
  });

  // ---------------------------------------------------------------------------
  // 5. Somente EAN
  // ---------------------------------------------------------------------------
  await runTest('5. Somente EAN: valida checksum e enriquece dados cadastrais', async () => {
    const sheet = createInitialSheet();
    const res = await runProductIdentification(
      {
        ean: '7894900011517'
      },
      sheet,
      aiProvider,
      researchProvider
    );

    assert.strictEqual(res.sheet.ean.value, '7894900011517');
    assert.strictEqual(res.sheet.brand.value, 'Coca-Cola');
    assert.strictEqual(res.sheet.packageWeightKg.value, 2.1);
    assert.strictEqual(res.sheet.ncm.value, '2202.10.00');
  });

  // ---------------------------------------------------------------------------
  // 6. Somente nome sem research
  // ---------------------------------------------------------------------------
  await runTest('6. Somente nome sem research: extrai apenas marca/modelo e omite campos técnicos (missing)', async () => {
    const sheet = createInitialSheet();
    // Provedor de pesquisa vazio (inativo)
    const emptyResearch = {
      providerId: 'empty-research',
      searchProductFacts: async () => ({
        query: {},
        found: false,
        items: [],
        rejectedItemsCount: 0,
        providerId: 'empty-research',
        searchedAt: new Date().toISOString()
      })
    };

    const res = await runProductIdentification(
      {
        rawName: 'Furadeira Bosch GSB 13 RE'
      },
      sheet,
      aiProvider,
      emptyResearch
    );

    // Marca e modelo identificados no texto preliminar
    assert.strictEqual(res.sheet.brand.value, 'Bosch');
    assert.strictEqual(res.sheet.model.value, 'GSB 13 RE');

    // Regra Fact-or-Omit: Sem imagem e sem research, campos técnicos NÃO podem ser inventados
    assert.strictEqual(res.sheet.packageWeightKg.status, 'missing');
    assert.strictEqual(res.sheet.warrantyDays.status, 'missing');
    assert.strictEqual(res.sheet.ncm.status, 'missing');
    assert.strictEqual(res.sheet.attributes.length, 0);
  });

  // ---------------------------------------------------------------------------
  // 7. Somente nome + research ativo
  // ---------------------------------------------------------------------------
  await runTest('7. Somente nome + research ativo: pesquisa técnica é acionada e enriquece campos comprovados', async () => {
    const sheet = createInitialSheet();
    const res = await runProductIdentification(
      {
        rawName: 'Furadeira Bosch GSB 13 RE'
      },
      sheet,
      aiProvider,
      researchProvider
    );

    assert.strictEqual(res.sheet.brand.value, 'Bosch');
    assert.strictEqual(res.sheet.model.value, 'GSB 13 RE');
    // Enriquecido pelo ResearchProvider (Tier 1)
    assert.strictEqual(res.sheet.packageWeightKg.value, 1.8);
    assert.strictEqual(res.sheet.packageWeightKg.evidence?.sourceTier, 1);
    assert.strictEqual(res.sheet.packageWeightKg.evidence?.sourceId, 'BOSCH-SKU-06012171D0');
    assert.strictEqual(res.sheet.warrantyDays.value, 365);
    assert.strictEqual(res.sheet.ncm.value, '8467.21.00');

    // Campos não contemplados no documento continuam missing
    assert.strictEqual(res.sheet.descriptionPlain.status, 'missing');
  });

  // ---------------------------------------------------------------------------
  // 8. Foto + nome conflitantes
  // ---------------------------------------------------------------------------
  await runTest('8. Foto + nome conflitantes: gera status conflict com opções auditáveis', async () => {
    const sheet = createInitialSheet();
    sheet.brand = createAuditedField('Makita', 'user_manual', 1.0, 'edited');

    const res = await runProductIdentification(
      {
        rawName: 'Furadeira Makita',
        imageBase64: 'data:image/jpeg;base64,mock_bosch_image_payload'
      },
      sheet,
      aiProvider
    );

    assert.strictEqual(res.sheet.brand.status, 'conflict');
    assert.strictEqual(res.sheet.hasUnresolvedConflicts, true);
    assert.strictEqual(res.sheet.brand.value, 'Makita'); // Preserva escolha do usuário
    assert.strictEqual(res.sheet.brand.conflictingValues?.[0].value, 'Bosch');
  });

  // ---------------------------------------------------------------------------
  // 9. Preservação de valor manual
  // ---------------------------------------------------------------------------
  await runTest('9. Preservação de valor manual: seller edit não é sobrescrito cegamente', () => {
    const sheet = createInitialSheet();
    sheet.packageWeightKg = createAuditedField(2.5, 'user_manual', 1.0, 'edited');

    const resolution = TruthAndConflictEngine.resolveProduct(sheet, [
      {
        fieldName: 'packageWeightKg',
        value: 1.8,
        source: 'ean_catalog',
        sourceTier: 1,
        sourceType: 'manufacturer_website',
        sourceName: 'Fabricante Oficial',
        extractedSnippet: '1,8 kg',
        confidence: 1.0,
        capturedAt: new Date().toISOString()
      }
    ]);

    // O valor do usuário é mantido em primeiro plano
    assert.strictEqual(resolution.sheet.packageWeightKg.value, 2.5);
    assert.strictEqual(resolution.sheet.packageWeightKg.status, 'conflict');
    assert.strictEqual(resolution.sheet.packageWeightKg.conflictingValues?.[0].value, 1.8);
  });

  // ---------------------------------------------------------------------------
  // 10. Múltiplas fontes concordantes
  // ---------------------------------------------------------------------------
  await runTest('10. Múltiplas fontes concordantes: confirmação mútua eleva confiança e registra corroboração', () => {
    const sheet = createInitialSheet();
    const resolution = TruthAndConflictEngine.resolveProduct(sheet, [
      {
        fieldName: 'packageWeightKg',
        value: 1.8,
        source: 'ean_catalog',
        sourceTier: 1,
        sourceType: 'manufacturer_website',
        sourceName: 'Fabricante',
        extractedSnippet: '1,8 kg no manual',
        confidence: 0.9,
        capturedAt: new Date().toISOString()
      },
      {
        fieldName: 'packageWeightKg',
        value: 1.8,
        source: 'bling_erp',
        sourceTier: 4,
        sourceType: 'authorized_distributor',
        sourceName: 'Distribuidor Autorizado',
        extractedSnippet: '1.80 kg na nota fiscal',
        confidence: 0.85,
        capturedAt: new Date().toISOString()
      }
    ]);

    assert.strictEqual(resolution.sheet.packageWeightKg.value, 1.8);
    assert.strictEqual(resolution.sheet.packageWeightKg.confidence, 1.0);
    assert.strictEqual(resolution.sheet.packageWeightKg.status, 'pending_review');
    assert.ok(resolution.report.corroboratedFields.includes('packageWeightKg'));
  });

  // ---------------------------------------------------------------------------
  // 11. Múltiplas fontes divergentes
  // ---------------------------------------------------------------------------
  await runTest('11. Múltiplas fontes divergentes: hierarquia de Tier escolhe melhor opção e arquiva conflito', () => {
    const sheet = createInitialSheet();
    const resolution = TruthAndConflictEngine.resolveProduct(sheet, [
      {
        fieldName: 'packageWeightKg',
        value: 1.5,
        source: 'mercadolivre_pdp',
        sourceTier: 6, // Tier baixo
        sourceType: 'marketplace_pdp',
        sourceName: 'Anúncio ML Concorrente',
        extractedSnippet: '1.5 kg',
        confidence: 0.9,
        capturedAt: new Date().toISOString()
      },
      {
        fieldName: 'packageWeightKg',
        value: 1.8,
        source: 'ean_catalog',
        sourceTier: 1, // Tier alto
        sourceType: 'manufacturer_website',
        sourceName: 'Manual Bosch',
        extractedSnippet: '1,8 kg',
        confidence: 0.8,
        capturedAt: new Date().toISOString()
      }
    ]);

    // Tier 1 vence Tier 6
    assert.strictEqual(resolution.sheet.packageWeightKg.value, 1.8);
    assert.strictEqual(resolution.sheet.packageWeightKg.status, 'conflict');
    assert.strictEqual(resolution.sheet.packageWeightKg.conflictingValues?.[0].value, 1.5);
  });

  // ---------------------------------------------------------------------------
  // 12. Variante/produto diferente
  // ---------------------------------------------------------------------------
  await runTest('12. Variante/produto diferente: atributos externos são bloqueados contra contaminação', async () => {
    const sheet = createInitialSheet();
    const divergentResearch = new MockResearchProvider();

    const res = await runProductIdentification(
      { rawName: 'furadeira bosch gsb 16 re' },
      sheet,
      {
        providerId: 'test-ai',
        identifyProduct: async () => ({
          identified: true,
          productSummary: 'Bosch GSB 13 RE',
          brand: { value: 'Bosch', evidence: 'Texto', confidence: 0.9, source: 'ai_generated' },
          model: { value: 'GSB 13 RE', evidence: 'Texto', confidence: 0.9, source: 'ai_generated' },
          attributes: {},
          unsupportedFields: [],
          isSimulated: true,
          providerName: 'Test AI'
        })
      },
      divergentResearch
    );

    // Potência de 850W e peso 2.1kg da GSB 16 RE NÃO foram aplicados na ficha
    assert.notStrictEqual(res.sheet.packageWeightKg.value, 2.1);
    assert.ok(res.summary.rejectedVariantCount >= 1);
    assert.ok(res.summary.rejectedVariantNotices.some(n => n.reason.includes('GSB 16 RE')));
  });

  // ---------------------------------------------------------------------------
  // 13. GTIN exato com títulos diferentes
  // ---------------------------------------------------------------------------
  await runTest('13. GTIN exato com títulos diferentes: GTIN é evidência forte primária de correspondência', async () => {
    const sheet = createInitialSheet();
    const res = await runProductIdentification(
      {
        ean: '7894900011517',
        rawName: 'Refrigerante Coca-Cola 2L Garrafa' // Título diferente do cadastro GS1 ("Refrig Coca Cola Pet 2000ml")
      },
      sheet,
      aiProvider,
      researchProvider
    );

    assert.strictEqual(res.sheet.ean.value, '7894900011517');
    assert.strictEqual(res.sheet.brand.value, 'Coca-Cola');
    assert.strictEqual(res.sheet.packageWeightKg.value, 2.1);
    assert.strictEqual(res.sheet.ncm.value, '2202.10.00');
  });

  // ---------------------------------------------------------------------------
  // 14. Persistência de conflitos/evidências
  // ---------------------------------------------------------------------------
  await runTest('14. Persistência de conflitos/evidências: salva e recupera estrutura auditável completa', async () => {
    await clearActiveSheet();

    const sheet = createInitialSheet();
    sheet.brand = {
      value: 'Makita',
      source: 'user_manual',
      confidence: 1.0,
      status: 'conflict',
      conflictingValues: [
        {
          value: 'Bosch',
          source: 'ai_generated',
          confidence: 0.95,
          evidence: {
            sourceTier: 1,
            sourceName: 'Bosch Oficial',
            sourceId: 'BOSCH-123',
            documentTitle: 'Manual Técnico',
            extractedSnippet: 'Logotipo gravado',
            capturedAt: new Date().toISOString()
          }
        }
      ]
    };

    await saveActiveSheet(sheet);
    const loaded = await loadActiveSheet();

    assert.ok(loaded !== null);
    assert.strictEqual(loaded?.brand.status, 'conflict');
    assert.strictEqual(loaded?.brand.conflictingValues?.[0].value, 'Bosch');
    assert.strictEqual(loaded?.brand.conflictingValues?.[0].evidence?.sourceId, 'BOSCH-123');
    assert.strictEqual(loaded?.brand.conflictingValues?.[0].evidence?.documentTitle, 'Manual Técnico');
  });

  // ---------------------------------------------------------------------------
  // 15. Timeout/erro HTTP
  // ---------------------------------------------------------------------------
  await runTest('15. Timeout/erro HTTP: GeminiAIProvider lança erro explícito sem fallback silencioso', async () => {
    // Simula GeminiProvider apontando para chave que causará erro HTTP controlado
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        } as any;
      };

      const provider = new GeminiAIProvider('fake-valid-looking-key');
      await assert.rejects(
        async () => {
          await provider.identifyProduct({ rawName: 'Furadeira' });
        },
        (err: any) => {
          assert.ok(err.message.includes('HTTP 500'));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // 16. Ausência de API key
  // ---------------------------------------------------------------------------
  await runTest('16. Ausência de API key: GeminiAIProvider lança AIProviderConfigError', async () => {
    const provider = new GeminiAIProvider('');
    await assert.rejects(
      async () => {
        await provider.identifyProduct({ rawName: 'Teste' });
      },
      (err: any) => {
        assert.ok(err instanceof AIProviderConfigError || err.name === 'AIProviderConfigError');
        return true;
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 17. MockAIProvider nunca utilizado silenciosamente
  // ---------------------------------------------------------------------------
  await runTest('17. MockAIProvider nunca utilizado silenciosamente em falhas do GeminiAIProvider', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden'
        } as any;
      };

      const provider = new GeminiAIProvider('chave-invalida');
      let usedMockSilently = false;
      try {
        await provider.identifyProduct({ rawName: 'Furadeira Bosch' });
        usedMockSilently = true;
      } catch (err: any) {
        assert.ok(err.message.includes('403'));
      }

      assert.strictEqual(usedMockSilently, false, 'GeminiAIProvider jamais deve retornar mock em falhas!');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // 18. Reidentificação sem perda da trilha de auditoria
  // ---------------------------------------------------------------------------
  await runTest('18. Reidentificação sem perda da trilha de auditoria: preserva edições manuais e conflitos', async () => {
    const sheet = createInitialSheet();
    // Vendedor previamente editou o modelo para "Custom Mod"
    sheet.model = createAuditedField('Custom Mod', 'user_manual', 1.0, 'edited');

    // Executa reidentificação
    const res = await runProductIdentification(
      {
        rawName: 'Furadeira Bosch GSB 13 RE'
      },
      sheet,
      aiProvider,
      researchProvider
    );

    // O valor do usuário é mantido e a divergência com o catálogo é registrada em conflito
    assert.strictEqual(res.sheet.model.value, 'Custom Mod');
    assert.strictEqual(res.sheet.model.status, 'conflict');
    assert.strictEqual(res.sheet.model.conflictingValues?.[0].value, 'GSB 13 RE');
    assert.ok(res.sheet.model.conflictingValues?.[0].evidence?.sourceName?.includes('Bosch'));

    // Resolução do conflito pelo usuário
    const resolved = resolveFieldConflict(
      res.sheet.model,
      'GSB 13 RE',
      res.sheet.model.conflictingValues[0].evidence
    );
    assert.strictEqual(resolved.value, 'GSB 13 RE');
    assert.strictEqual(resolved.status, 'approved');
  });

  // ---------------------------------------------------------------------------
  // 19. Regressão Fact-or-Omit: Ficha inicial sem defaults inventados
  // ---------------------------------------------------------------------------
  await runTest('19. Regressão Fact-or-Omit: Ficha inicial não possui categoria, peso, dimensões ou garantia inventados', () => {
    const sheet = createInitialSheet();

    // 1. Nenhuma categoria ML pré-definida sem evidência
    assert.strictEqual(sheet.categoryIdML.status, 'missing');
    assert.strictEqual(sheet.categoryIdML.value, '');
    assert.strictEqual(sheet.categoryIdML.confidence, 0.0);
    assert.strictEqual(sheet.categoryPathML.status, 'missing');
    assert.strictEqual(sheet.categoryPathML.value, '');
    assert.strictEqual(sheet.categoryPathML.confidence, 0.0);

    // 2. Nenhum peso ou dimensão inventados
    assert.strictEqual(sheet.packageWeightKg.status, 'missing');
    assert.strictEqual(sheet.packageWeightKg.value, 0);
    assert.strictEqual(sheet.packageWeightKg.confidence, 0.0);
    assert.strictEqual(sheet.packageHeightCm.status, 'missing');
    assert.strictEqual(sheet.packageHeightCm.value, 0);
    assert.strictEqual(sheet.packageHeightCm.confidence, 0.0);
    assert.strictEqual(sheet.packageWidthCm.status, 'missing');
    assert.strictEqual(sheet.packageWidthCm.value, 0);
    assert.strictEqual(sheet.packageWidthCm.confidence, 0.0);
    assert.strictEqual(sheet.packageLengthCm.status, 'missing');
    assert.strictEqual(sheet.packageLengthCm.value, 0);
    assert.strictEqual(sheet.packageLengthCm.confidence, 0.0);

    // 3. Nenhuma garantia inventada
    assert.strictEqual(sheet.warrantyDays.status, 'missing');
    assert.strictEqual(sheet.warrantyDays.value, 0);
    assert.strictEqual(sheet.warrantyDays.confidence, 0.0);

    // 4. Nenhum campo da ficha inicial sem evidência possui confiança positiva
    const fields = [
      sheet.ean, sheet.sku, sheet.title, sheet.brand, sheet.model,
      sheet.categoryIdML, sheet.categoryPathML, sheet.ncm,
      sheet.packageWeightKg, sheet.packageHeightCm, sheet.packageWidthCm, sheet.packageLengthCm,
      sheet.costPrice, sheet.suggestedSalePrice, sheet.descriptionPlain,
      sheet.warrantyDays
    ];
    for (const f of fields) {
      if (!f.evidence) {
        assert.strictEqual(f.confidence, 0.0, `Campo possui confidence ${f.confidence} > 0 sem evidência`);
        assert.strictEqual(f.status, 'missing', `Campo possui status "${f.status}" sem evidência`);
      }
    }
  });

  console.log('\n================================================================');
  console.log(process.exitCode ? '❌ ALGUNS TESTES DA FASE 3 FALHARAM' : '🎉 TODOS OS TESTES DA FASE 3 PASSARAM COM ÊXITO!');
  console.log('================================================================\n');
}

if (process.argv[1]?.includes('ai-identification.test')) {
  runIdentificationTests();
}
