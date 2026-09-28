import { priceComparisonLabel } from '../src/content-scripts/mercadolivre/inline-insights.ts';
import assert from 'node:assert/strict';
import { createInitialSheet, createAuditedField } from '../src/core/schema/product.ts';
import { validateSheetV3 } from '../src/core/schema/migrations.ts';
import { sanitizeName, deduplicateWords } from '../src/core/engines/identification/sanitizer.ts';
import { parseApiKeys } from '../src/core/services/key-manager.ts';
import { requestGeminiJson } from '../src/core/services/gemini-client.ts';
import { normalizeKeywords, applyKeywords, generateProductContent } from '../src/core/services/product-content.ts';
import { convertToKit, skuForKit } from '../src/core/engines/kit-converter/kit-converter.ts';
import { createVariationMatrix, fillVariationEans } from '../src/core/engines/identification/sku-variation-matrix.ts';
import { validateEan } from '../src/core/engines/identification/ean-validator.ts';
import { isGeneratedEan, assignGeneratedEan } from '../src/core/engines/identification/ean-generator.ts';
import { planProductImages } from '../src/core/engines/image-generation/objection-planner.ts';
import { buildImageBriefs } from '../src/core/engines/image-generation/image-brief-generator.ts';
import { parseResearchReferences } from '../src/core/services/product-research.ts';
import { marketSummary, parseBrlPrice, normalizeMarketUrl, marketCsv } from '../src/integrations/mercadolivre/market.ts';
import { readMarketPage } from '../src/content-scripts/mercadolivre/page-reader.ts';
import { buildMlPayload, validateMlDraft } from '../src/integrations/mercadolivre/listing.ts';
import { sheetToMlDraft, sheetMlAttributes } from '../src/integrations/mercadolivre/sheet-to-listing.ts';
import type { MlListingDraft } from '../src/shared/mercadolivre-contracts.ts';
import { saveSheet, loadSheet, saveWorkspace, loadWorkspace, deleteSheet, clearAllSavedSheets, listSavedSheets } from '../src/core/storage/storage.ts';
import { adaptSheetToTechnicalChanges, prepareBlingSheetForMlExport } from '../src/core/engines/identification/sheet-adapter.ts';

export const exampleDraft = (): MlListingDraft => ({ sheetId: 'sheet-test', title: 'Copo azul', familyName: 'Copo', categoryId: 'MLB1234', price: 29.9, quantity: 3, listingType: 'gold_special', condition: 'new', sku: 'COPAZ', description: 'Copo azul.', attributes: [{ id: 'BRAND', value_name: 'Marca' }], pictureIds: ['picture-test'], shippingMode: 'me2', freeShipping: false, localPickup: false });
export async function runUnificationTests() {
  const originalFetch = globalThis.fetch;
  async function test(name: string, fn: () => unknown | Promise<unknown>) {
    try { await fn(); console.log('  ✓ PASS: Unificação: ' + name); }
    catch (e) { console.error('  ✗ FAIL: Unificação: ' + name, e); process.exitCode = 1; }
    finally { globalThis.fetch = originalFetch; }
  }
  await test('comparação de preço omite bases ausentes e não divide por zero', () => {
    assert.equal(priceComparisonLabel(80,100),'20% abaixo da mediana');
    assert.equal(priceComparisonLabel(120,100),'20% acima da mediana');
    assert.equal(priceComparisonLabel(100,100),'Na mediana desta página');
    for (const values of [[null,100],[10,0],[NaN,100],[10,null],[-1,10]] as [number|null,number|null][]) assert.equal(priceComparisonLabel(...values),'Sem base para comparar');
  });
  await test('OCR conserva modelo e medidas, remove tags e controles', () => { assert.equal(sanitizeName('  <b>Copo</b>\u0000 750ml  AB-12 '), 'Copo 750ml AB-12'); assert.equal(deduplicateWords('Copo Copo 750ml'), 'Copo 750ml'); });
  await test('pool deduplica e limita chaves próprias', () => { assert.deepEqual(parseApiKeys('a, b\na; b'), ['a','b']); assert.throws(() => parseApiKeys('a,b,c,d,e,f')); });
  await test('fallback 429 troca chave no cabeçalho e conserva modelo e payload', async () => {
    const calls: any[] = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"text":"ok"}' }] } }] })); };
    assert.deepEqual(await requestGeminiJson('key-a,key-b', 'system', [{ text: 'dados' }]), { text: 'ok' });
    assert.equal(calls.length,2); assert.equal(calls[0].init.headers['x-goog-api-key'], 'key-a'); assert.equal(calls[1].init.headers['x-goog-api-key'], 'key-b'); assert.equal(calls[0].init.body, calls[1].init.body); assert.ok(!String(calls[0].url).includes('key-a'));
  });
  await test('HTTP 400 e JSON truncado não geram cascata', async () => {
    let calls = 0; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { message: 'bad key-a key-b' } }), { status: 400 }); };
    await assert.rejects(requestGeminiJson('key-a,key-b','',[]), e => !String(e).includes('key-a') && !String(e).includes('key-b')); assert.equal(calls,1);
    calls = 0; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{' }] } }] })); };
    await assert.rejects(requestGeminiJson('key-a,key-b','',[])); assert.equal(calls,1);
  });
  await test('SEO tem forma validada e não sobrescreve outra versão da ficha', () => {
    const words = normalizeKeywords({ principais: ['copo','copo', 2], relacionadas: [], variacoes: ['copo azul'] }); assert.deepEqual(words.principais,['copo']);
    assert.throws(() => normalizeKeywords({ principais: [] }));
    const s = createInitialSheet(); const edited = { ...s, sku: createAuditedField('COPO1') };
    assert.equal(applyKeywords(edited, s, words), edited); assert.equal(applyKeywords(s,s,words).workbench?.keywords?.status,'pending_review');
  });
  await test('pipeline completo pesquisa antes de gerar e Bling evita pesquisa e SEO', async () => {
    const sheet = createInitialSheet(); sheet.titleBling=createAuditedField('Copo azul');
    const calls: any[]=[];
    globalThis.fetch=async (_url,init)=>{
      const body=JSON.parse(String(init?.body)); calls.push(body);
      if(body.tools) return new Response(JSON.stringify({candidates:[{groundingMetadata:{groundingChunks:[{web:{uri:'https://example.com/copo',title:'Fabricante'}}]}}]}));
      const seo=body.generationConfig?.responseSchema?.properties?.principais;
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(seo?{principais:['copo'],relacionadas:[],variacoes:[]}:{text:'Copo azul'})}]}}]}));
    };
    const result=await generateProductContent(sheet,'test-key','complete');
    assert.equal(calls.length,4);assert.ok(calls[0].tools);assert.equal(result.workbench?.references?.length,1);
    assert.equal(result.title.status,'pending_review');assert.equal(sheet.workbench,undefined);
    assert.ok(calls[1].contents[0].parts[0].text.includes('referenciasNaoValidadas'));
    calls.length=0;await generateProductContent(sheet,'test-key','bling');assert.equal(calls.length,1);assert.equal(calls[0].tools,undefined);
  });
  await test('pesquisa sem fontes interrompe pipeline sem inventar dados ou alterar a ficha', async () => {
    const sheet=createInitialSheet();sheet.titleBling=createAuditedField('Copo');const before=JSON.stringify(sheet);let calls=0;
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Sem fontes'}]}}]}));};
    await assert.rejects(generateProductContent(sheet,'test-key','complete'),/fontes verificáveis/);assert.equal(calls,1);assert.equal(JSON.stringify(sheet),before);
  });
  await test('kit deriva identidade e invalida logística, preços e vínculos', () => {
    const s = assignGeneratedEan(createInitialSheet()); s.titleBling = createAuditedField('COPO AZUL 200ML'); s.sku = createAuditedField('GMCOP200-AZ'); s.costPrice = createAuditedField(2.5); s.currentSalePrice = createAuditedField(5); s.packageWeightKg = createAuditedField(.2); s.externalReferences = [{ system: 'bling', externalId: '123', importedAt: new Date().toISOString() }];
    const before = structuredClone(s), kit = convertToKit(s,3);
    assert.deepEqual(s,before); assert.notEqual(kit.id,s.id); assert.notEqual(kit.ean.value,s.ean.value); assert.ok(isGeneratedEan(kit.ean)); assert.equal(kit.sku.value,'GMCOP200K03-AZ'); assert.equal(kit.costPrice.value,7.5); assert.equal(kit.costPrice.status,'pending_review'); assert.equal(kit.currentSalePrice.value,null); assert.equal(kit.packageWeightKg.status,'missing'); assert.deepEqual(kit.externalReferences,[]); assert.equal(kit.stockInfo,undefined); assert.equal(validateSheetV3(kit).isValid,true);
  });
  await test('kit não presume custo sem revisão e rejeita quantidades inválidas', () => {
    const s = createInitialSheet(); s.title = createAuditedField('Copo'); s.costPrice = createAuditedField(4,'ai_generated',.8,'pending_review');
    assert.equal(convertToKit(s,2).costPrice.value,null); for (const n of [0,-1,1.5,NaN,1000]) assert.throws(() => convertToKit(s,n)); assert.equal(skuForKit('POPTPC150K03-AZ',12),'POPTPC150K12-AZ');
  });
  await test('matriz preserva EAN existente e gera códigos únicos válidos', () => {
    const variants = createVariationMatrix('POPTPC150',['AZ','VM','PR']); variants[0].ean = createAuditedField('7894900011517');
    const result = fillVariationEans(variants); assert.equal(result[0],variants[0]); assert.equal(new Set(result.map(v => v.ean.value)).size,3); assert.ok(result.every(v => validateEan(v.ean.value).valid)); assert.equal(variants[1].ean.value,''); assert.throws(() => createVariationMatrix('POPTPC150',['A-Z','AZ']));
  });
  await test('sete briefs usam dados revisados sem prometer originalidade ou frete', () => {
    const s = createInitialSheet(); s.titleBling = createAuditedField('Copo'); s.brand = createAuditedField('Marca');
    const briefs = buildImageBriefs(s); assert.equal(briefs.length,7); assert.equal(new Set(briefs.map(b => b.kind)).size,7); assert.ok(briefs.every(b => !b.prompt.includes('100% original'))); assert.ok(briefs.find(b => b.kind === 'escala')?.prompt.includes('not shipping package dimensions'));
  });
  await test('planejamento visual aceita apenas chaves de fatos confirmados', async () => {
    const sheet=createInitialSheet();sheet.titleBling=createAuditedField('Copo');sheet.brand=createAuditedField('Marca real');
    sheet.images=[{id:'ref',url:'data:image/png;base64,aGVsbG8=',isMain:true,status:createAuditedField('approved')}];
    globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({layout:'A',factKeys:['marca','materialInventado','nome']})}]}}]}));
    const result=await planProductImages(sheet,'test-key');assert.ok(result.every(b=>b.layout==='A'));
    const annotations=result.find(b=>b.kind==='objecoes')!.prompt.split('never invent four to seven claims: ')[1];
    assert.deepEqual(JSON.parse(annotations),{marca:'Marca real'});
  });
  await test('comparação manual persiste e rejeita contagens inválidas', async () => {
    const sheet=createInitialSheet();sheet.workbench={titleComparison:{titleB:'Alternativa',viewsA:100,clicksA:2,viewsB:100,clicksB:3}};
    await saveSheet(sheet);assert.equal((await loadSheet(sheet.id))?.workbench?.titleComparison?.clicksB,3);
    sheet.workbench.titleComparison!.viewsA=-1;assert.equal(validateSheetV3(sheet).isValid,false);
  });
  await test('fontes de pesquisa dependem de grounding e rejeitam URLs executáveis', () => {
    assert.deepEqual(parseResearchReferences({ candidates: [{ content: { parts: [{ text: 'Fonte: https://fake.example' }] } }] }),[]);
    const refs = parseResearchReferences({ candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'javascript:alert(1)', title:'bad' } }, { web: { uri:'https://example.com/ficha', title:'Ficha' } }], groundingSupports: [{ groundingChunkIndices:[1],segment:{text:'Dado consultado.'}}] } }] }); assert.equal(refs.length,1); assert.equal(refs[0].snippet,'Dado consultado.');
  });
  await test('preços BRL preservam ausência e valores reais, incluindo zero', () => { assert.equal(parseBrlPrice('R$ 1.234,56'),1234.56); assert.equal(parseBrlPrice('0,00'),0); assert.equal(parseBrlPrice('12x R$ 10'),null); assert.equal(parseBrlPrice(''),null); assert.equal(marketSummary([]).median,null); });
  await test('URLs de concorrentes validam domínio e removem parâmetros', () => { assert.equal(normalizeMarketUrl('https://evilmercadolivre.com.br/MLB-123456','https://mercadolivre.com.br'),null); assert.equal(normalizeMarketUrl('https://produto.mercadolivre.com.br/MLB-123456-copo?token=x#hash','https://mercadolivre.com.br')?.url,'https://produto.mercadolivre.com.br/MLB-123456-copo'); });
  await test('captura evita login e não inventa produtos numa página vazia', () => { const doc = { querySelectorAll: () => [], querySelector: () => null } as unknown as Document; assert.equal(readMarketPage(doc,'https://www.mercadolivre.com.br/').items.length,0); assert.throws(() => readMarketPage(doc,'https://www.mercadolivre.com.br/captcha/wall')); });
  await test('CSV neutraliza fórmulas de títulos observados', () => { const csv = marketCsv([{ id:'MLB123456', title:'=HYPERLINK("bad")',url:'https://mercadolivre.com.br/MLB123456',price:2,currency:'BRL',seller:null,soldLabel:null,shippingLabel:null,sponsored:false,position:1,capturedAt:new Date().toISOString() }]); assert.ok(csv.includes("'=HYPERLINK")); });
  await test('payload ML adapta User Products sem title e bloqueia quantidade simples multiorigem', () => { const d = validateMlDraft(exampleDraft()); assert.equal(buildMlPayload(d,[]).title,'Copo azul'); const up = buildMlPayload(d,['user_product_seller']); assert.equal(up.title,undefined); assert.equal(up.family_name,'Copo'); assert.throws(() => buildMlPayload(d,['warehouse_management'])); });
  await test('validação ML rejeita preços, estoques, atributos duplicados e GTIN inválido', () => { const d = exampleDraft(); assert.throws(() => validateMlDraft({ ...d, price:NaN })); assert.throws(() => validateMlDraft({ ...d, quantity:1.5 })); assert.throws(() => validateMlDraft({ ...d, attributes:[d.attributes[0],d.attributes[0]] })); assert.throws(() => validateMlDraft({ ...d, attributes:[{id:'GTIN',value_name:'123'}] })); });
  await test('ficha não envia EAN gerado como GTIN nem conteúdo não revisado', () => { const s = assignGeneratedEan(createInitialSheet()); s.title = createAuditedField('Copo'); s.sku = createAuditedField('COP01'); s.descriptionPlain = createAuditedField('Copo azul.'); assert.ok(!sheetMlAttributes(s).some(a => a.id === 'GTIN')); assert.throws(() => sheetToMlDraft(s,{ ...exampleDraft(), attributes:[{id:'GTIN',value_name:s.ean.value}] })); s.title.status='pending_review'; assert.throws(() => sheetToMlDraft(s,exampleDraft())); });
  await test('persistência mantém metadados novos e navegação por abas', async () => { const s = createInitialSheet(); s.title = createAuditedField('Copo'); s.workbench = { keywords: createAuditedField({ principais:['copo'],relacionadas:[],variacoes:[] }), briefs:buildImageBriefs(s),variations:createVariationMatrix('POPTPC150',['AZ']) }; await saveSheet(s); assert.deepEqual((await loadSheet(s.id))?.workbench,JSON.parse(JSON.stringify(s.workbench))); await saveWorkspace({sheetId:s.id,step:8}); assert.equal((await loadWorkspace())?.step,8); const invalid = { ...s, workbench: { keywords: {value:{}} } }; assert.equal(validateSheetV3(invalid).isValid,false); });
  await test('apagar rascunho individual e limpar rascunhos removem ficha e workspace correspondente', async () => {
    const a = createInitialSheet(), b = createInitialSheet();
    a.titleBling = createAuditedField('PRODUTO A'); b.titleBling = createAuditedField('PRODUTO B');
    await saveSheet(a); await saveSheet(b); await saveWorkspace({ sheetId: a.id, step: 2 });
    await deleteSheet(a.id);
    assert.equal(await loadSheet(a.id), null);
    assert.equal(await loadWorkspace(), null);
    assert.ok((await loadSheet(b.id)) !== null);
    await clearAllSavedSheets();
    assert.equal((await listSavedSheets()).length, 0);
  });
  await test('preparação preserva revisão e texto manual sem mutar a origem', () => {
    const s = createInitialSheet();
    s.titleBling = createAuditedField('COPO AZUL');
    s.title = createAuditedField('Meu título personalizado', 'user_manual', 1, 'approved');
    s.brand = createAuditedField('Marca sugerida', 'ai_generated', .6, 'pending_review');
    s.descriptionPlain = createAuditedField('Descrição em revisão', 'ai_generated', .7, 'pending_review');
    s.currentSalePrice = createAuditedField(50, 'bling_erp', .9, 'pending_review');
    const before = structuredClone(s), out = prepareBlingSheetForMlExport(s);
    assert.deepEqual(s, before); assert.deepEqual(out.title, s.title);
    assert.deepEqual(out.brand, s.brand); assert.deepEqual(out.descriptionPlain, s.descriptionPlain);
    assert.deepEqual(out.images, s.images); assert.equal(out.suggestedSalePrice.value, null);
  });
  await test('medidas incompletas não viram dimensões confirmadas nem aprovam descrição', () => {
    const s = createInitialSheet();
    s.titleBling = createAuditedField('COPO');
    s.brand = createAuditedField('Sugestão pendente', 'ai_generated', .6, 'pending_review');
    s.descriptionPlain = createAuditedField('Texto em revisão', 'ai_generated', .6, 'pending_review');
    const out = adaptSheetToTechnicalChanges(s, {...s, packageHeightCm: createAuditedField(10)}, {kind:'dimensions'});
    assert.equal(out.descriptionPlain.status, 'pending_review');
    assert.ok(!out.descriptionPlain.value.includes('Dimensões'));
    assert.ok(!out.descriptionPlain.value.includes('Sugestão pendente'));
  });
  await test('edição técnica preserva textos manuais e SKU já vinculado', () => {
    const s = createInitialSheet();
    s.titleBling = createAuditedField('COPO AZUL');
    s.title = createAuditedField('Copo Azul especial', 'user_manual', 1, 'approved');
    s.descriptionPlain = createAuditedField('Minha descrição Azul', 'user_manual', 1, 'approved');
    s.sku = createAuditedField('COPAZ', 'rule_engine', 1, 'approved');
    s.externalReferences = [{system:'bling', externalId:'1', importedAt:new Date().toISOString()}];
    const out = adaptSheetToTechnicalChanges(s, {...s, brand:createAuditedField('Vermelho')}, {kind:'brand', oldValue:'Azul', newValue:'Vermelho'});
    assert.deepEqual(out.title, s.title); assert.deepEqual(out.descriptionPlain, s.descriptionPlain); assert.deepEqual(out.sku,s.sku);
  });
  await test('edição em Marca e Detalhes Técnicos adapta Nome Bling, SKU, Título ML e Descrição automaticamente', async () => {
    const prev = createInitialSheet();
    prev.titleBling = createAuditedField('SPRAY PINTA CABELO POPPER 500ML AZUL', 'ai_generated', 0.9, 'approved');
    prev.title = createAuditedField('Spray Pinta Cabelo Popper 500ml Azul', 'ai_generated', 0.9, 'approved');
    prev.sku = createAuditedField('POPTPC500-AZ', 'rule_engine', 1.0, 'approved');
    prev.brand = createAuditedField('Popper', 'ai_generated', 0.9, 'approved');
    prev.attributes = [{ id: 'a1', name: 'Capacidade', field: createAuditedField('500ml', 'ai_generated', 0.9, 'approved') }];
    const nextWithEditedAttr = {
      ...prev,
      attributes: [{ id: 'a1', name: 'Capacidade', field: createAuditedField('150ml', 'user_manual', 1.0, 'approved') }]
    };
    const adapted = adaptSheetToTechnicalChanges(prev, nextWithEditedAttr, {
      kind: 'attribute',
      attributeName: 'Capacidade',
      oldValue: '500ml',
      newValue: '150ml'
    });
    assert.equal(adapted.titleBling?.value, 'SPRAY PINTA CABELO POPPER 150ML AZUL');
    assert.equal(adapted.sku.value, 'POPTPC150-AZ');
    assert.match(adapted.title.value, /150ml/i);
    assert.match(adapted.descriptionPlain.value, /Capacidade: 150ml/);

    const exported = prepareBlingSheetForMlExport({
      ...adapted,
      currentSalePrice: createAuditedField(39.9, 'bling_erp', 0.95, 'approved')
    });
    assert.equal(exported.suggestedSalePrice.value, 39.9);
    assert.equal(exported.suggestedSalePrice.status, 'pending_review');
    assert.equal(exported.title.status, 'pending_review');
  });
}


