import { buildNewProductFormValues } from '../src/integrations/bling/new-product-form.ts';
import assert from 'node:assert/strict';
import { generateSkuFromTitle, inferSkuBlocks, generateParentSku, generateChildSku } from '../src/core/engines/identification/sku-generator.ts';
import { createInitialSheet, createAuditedField } from '../src/core/schema/product.ts';
import { listingFacts, generateListingContent } from '../src/core/services/listing-content.ts';
import { parseNcmTable, searchNcm, suggestNcm, NCM_TABLE_URL } from '../src/core/services/ncm-service.ts';
export async function runCatalogWorkflowTests() {
  const originalFetch = globalThis.fetch;
  async function test(name: string, fn: () => unknown | Promise<unknown>) {
    try { await fn(); console.log('  ✓ PASS: Catálogo: ' + name); }
    catch (error) { console.error('  ✗ FAIL: Catálogo: ' + name, error); process.exitCode = 1; }
    finally { globalThis.fetch = originalFetch; }
  }
  const rows = [
    { Codigo: '39', Descricao: 'Plásticos e suas obras' },
    { Codigo: '39.24', Descricao: 'Artigos de uso doméstico' },
    { Codigo: '3924.10.00', Descricao: 'Serviços de mesa e outros utensílios de mesa ou cozinha' },
    { Codigo: '3924.90.00', Descricao: 'Outros' }
  ].map(row => ({ ...row, Data_Inicio: '01/04/2022', Data_Fim: '31/12/9999' }));
  await test('exemplos oficiais da loja geram os pais e filhos esperados', () => {
    const cases: [string, string][] = [
      ['Spray Pinta Cabelo Popper 150ml', 'POPTPC150'],
      ['Spray Pinta Cabelo Popper 150ml Azul', 'POPTPC150-AZ'],
      ['Spray Pinta Cabelo Popper 150ml Rosa', 'POPTPC150-RS'],
      ['Luva Nitrílica Bompack Preta 100un', 'BPLUVNITPR100'],
      ['Luva Nitrílica Bompack Preta 100un Tam P', 'BPLUVNITPR100-P'],
      ['Luva Nitrílica Bompack Preta 100un M', 'BPLUVNITPR100-M'],
      ['Luva Nitrílica Bompack Preta 100un G', 'BPLUVNITPR100-G'],
      ['Pote Retangular Gour Max c/ 24un', 'GMPOTRET24'],
      ['Pote Retangular Gour Max c/ 24un 250ml', 'GMPOTRET24-250'],
      ['Pote Retangular Gour Max c/ 24un 500ml', 'GMPOTRET24-500'],
      ['Pote Retangular Gour Max c/ 24un 1000ml', 'GMPOTRET24-1000']
    ];
    for (const [name, sku] of cases) assert.equal(generateSkuFromTitle(name), sku, name);
  });
  await test('blocos manuais respeitam alfabeto e comprimentos sem truncar silenciosamente', () => {
    assert.equal(generateParentSku({ brand: 'pop', product: 'tpc', fixed: '', quantity: '150' }), 'POPTPC150');
    assert.equal(generateChildSku('POPTPC150', 'ÁZ!'), 'POPTPC150-AZ');
    assert.equal(generateParentSku({ brand: '', product: 'TPC', fixed: '', quantity: '150' }), 'TPC150');
    assert.throws(() => generateChildSku('ABCDEFGHIJKLMNOP', '1000'));
    assert.throws(() => generateChildSku('SKU-COM-HIFEN', 'AZ'));
    assert.ok(generateSkuFromTitle('Copo sem marca').length >= 5);
  });
  await test('variações de tamanho e polegadas são sufixos separados da família', () => {
    assert.equal(inferSkuBlocks('Balão Pic Pic 24un 12pol').variation, '12POL');
    const blocks = inferSkuBlocks('Luva Nitrílica Bompack Preta 100un GG');
    assert.equal(generateChildSku(generateParentSku(blocks), blocks.variation), 'BPLUVNITPR100-GG');
  });
  await test('descrição aceita nome pendente da IA sem aprovação e com título ML vazio', async () => {
    const sheet = createInitialSheet(); sheet.titleBling = createAuditedField('LUVA NITRILICA BOMPACK', 'ai_generated', .8, 'pending_review');
    assert.equal(listingFacts(sheet).nome, 'LUVA NITRILICA BOMPACK');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"text":"Luva nitrílica Bompack."}' }] } }] }) }) as Response;
    assert.equal(await generateListingContent(sheet, 'test-key', 'descriptionPlain'), 'Luva nitrílica Bompack.');
  });
  await test('nome Bling em conflito usa título disponível; nome vazio pede preenchimento', () => {
    const sheet = createInitialSheet(); sheet.titleBling = createAuditedField('Outro', 'ai_generated', .5, 'conflict');
    sheet.title = createAuditedField('Nome digitado', 'user_manual', .8, 'pending_review');
    assert.equal(listingFacts(sheet).nome, 'Nome digitado');
    sheet.title.value = ''; assert.equal(listingFacts(sheet).nome, undefined);
  });
  await test('tabela oficial conserva hierarquia de Outros e só aceita folhas vigentes', () => {
    const entries = parseNcmTable({ Nomenclaturas: [...rows,
      { Codigo: '1111.11.11', Descricao: 'Expirado', Data_Inicio: '01/01/2000', Data_Fim: '01/01/2020' },
      { Codigo: '2222.22.22', Descricao: 'Futuro', Data_Inicio: '01/01/2099', Data_Fim: '31/12/9999' }
    ] }, '2026-09-24');
    assert.equal(entries.length, 2); assert.match(entries[1].path, /Plásticos.*doméstico.*Outros/);
    assert.equal(searchNcm(entries, '3924.10.00')[0].code, '39241000');
    assert.throws(() => parseNcmTable({ data: [] }));
  });
  await test('NCM só entra no Bling depois da revisão e código incompleto é omitido', () => {
    const sheet = createInitialSheet(); sheet.ncm = createAuditedField('39241000', 'ai_generated', .6, 'pending_review');
    assert.equal(buildNewProductFormValues(sheet).ncm, undefined);
    sheet.ncm.status = 'approved';
    assert.equal(buildNewProductFormValues(sheet).ncm, '39241000');
    sheet.ncm.value = '39'; assert.equal(buildNewProductFormValues(sheet).ncm, undefined);
  });
  await test('NCM sugerido pela IA só aparece se existir na tabela oficial vigente', async () => {
    const sheet = createInitialSheet(); sheet.titleBling = createAuditedField('POTE PLASTICO');
    globalThis.fetch = async url => String(url) === NCM_TABLE_URL
      ? ({ ok: true, json: async () => ({ Nomenclaturas: rows }) }) as Response
      : ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ suggestions: [
        { code: '99999999', reason: 'Código inventado' }, { code: '3924.10.00', reason: 'Conferir finalidade de cozinha e material plástico.' }, { code: '39', reason: 'Capítulo incompleto' }
      ] }) }] } }] }) }) as Response;
    const results = await suggestNcm(sheet, 'test-key');
    assert.equal(results.length, 1); assert.equal(results[0].code, '39241000'); assert.match(results[0].path, /Plásticos/);
  });
}
