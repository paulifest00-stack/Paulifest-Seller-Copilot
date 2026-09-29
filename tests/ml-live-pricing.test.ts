import { findPriceForProfit } from '../src/integrations/mercadolivre/profit-price.ts';
import assert from 'node:assert/strict';
import { MlApiClient } from '../src/gateway/integrations/mercadolivre/api-client.ts';
import { quotePricing, readPricingContext, validatePricingRequest } from '../src/gateway/integrations/mercadolivre/pricing.ts';
import { pricingTotals, type MlCalculatorDraft } from '../src/shared/ml-pricing.ts';
import { pricingRequestKey } from '../src/integrations/mercadolivre/pricing-request.ts';
import { mlItemIdFromUrl, readPricingPage } from '../src/integrations/mercadolivre/pricing-context.ts';
import { createInitialSheet, createAuditedField } from '../src/core/schema/product.ts';
import { saveSheet, loadSheet } from '../src/core/storage/storage.ts';
import { convertToKit } from '../src/core/engines/kit-converter/kit-converter.ts';
const draft = (): MlCalculatorDraft => ({ categoryId: 'MLB1234', price: 100, listingType: 'gold_pro', shippingMode: 'me2', logisticType: 'xd_drop_off', condition: 'new', freeShipping: false, dimensions: '10x15x20,500', cost: 20, taxPercent: 6, packaging: 2, otherCosts: 3, manualShipping: null });
class PricingApi extends MlApiClient {
  paths: string[] = []; fee: any = { currency_id: 'BRL', listing_type_id: 'gold_pro', sale_fee_amount: 19, sale_fee_details: { fixed_fee: 3, percentage_fee: 16 } };
  shipping: any = { coverage: { all_country: { currency_id: 'BRL', list_cost: 8, billable_weight: 900 } } };
  item: any = { id: 'MLB123456789', site_id: 'MLB', currency_id: 'BRL', category_id: 'MLB1234', price: 100, title: 'Copo', seller_id: 123, listing_type_id: 'gold_pro', condition: 'new', shipping: { mode: 'me2', logistic_type: 'xd_drop_off', free_shipping: false, dimensions: '10x15x20,500' } };
  override async request(path: string, token: string) {
    assert.equal(token, 'private-token'); this.paths.push(path);
    if (path.startsWith('/items/')) return this.item;
    if (path.startsWith('/users/')) { if (this.shipping instanceof Error) throw this.shipping; return this.shipping; }
    if (path.startsWith('/sites/')) return this.fee;
    throw new Error('Unexpected request');
  }
}
export async function runLivePricingTests() {
  const test = async (name: string, fn: () => unknown | Promise<unknown>) => { try { await fn(); console.log('  ✓ PASS: Precificação conectada: ' + name); } catch (e) { console.error('  ✗ FAIL: Precificação conectada: ' + name, e); process.exitCode = 1; } };
  await test('preço por lucro confirma cada candidato na API inclusive mudança de tarifa', async () => {
    const prices: number[]=[];
    const result = await findPriceForProfit(draft(),50,async candidate => {
      prices.push(candidate.price); const api=new PricingApi(); api.fee={...api.fee,sale_fee_amount:Math.round((candidate.price*.16+3)*100)/100};
      return quotePricing(api,'private-token','123',candidate);
    });
    assert.ok(prices.length >= 2); assert.equal(prices.at(-1),result.draft.price); assert.ok(Math.abs(pricingTotals(result.quote,result.draft)!.profit-50)<.05);
  });
  await test('preço por lucro interrompe ao mudar a ficha e não aceita custo ausente', async () => {
    let calls=0;
    await assert.rejects(findPriceForProfit(draft(),50,async candidate=>{calls++;return quotePricing(new PricingApi(),'private-token','123',candidate);},()=>false),/interrompido/); assert.equal(calls,0);
    await assert.rejects(findPriceForProfit({...draft(),cost:null},50,async()=>{throw new Error('não deve consultar');}),/custo/);
  });
  await test('envia logística, modo, preço e peso faturável; consulta frete mesmo quando comprador paga', async () => {
    const api = new PricingApi(); const result = await quotePricing(api,'private-token','123',draft());
    const shipping = new URL('https://test' + api.paths[0]), fees = new URL('https://test' + api.paths[1]);
    assert.equal(shipping.pathname,'/users/123/shipping_options/free'); assert.equal(shipping.searchParams.get('free_shipping'),'false');
    assert.equal(fees.searchParams.get('billable_weight'),'900'); assert.equal(fees.searchParams.get('logistic_type'),'xd_drop_off'); assert.equal(fees.searchParams.get('shipping_mode'),'me2'); assert.equal(fees.searchParams.get('price'),'100');
    assert.equal(result.saleFee,19); assert.equal(result.shippingCost,8); assert.ok(!JSON.stringify(result).includes('private-token'));
  });
  await test('deduz tarifa total apenas uma vez e todos os custos informados', async () => {
    const quote = await quotePricing(new PricingApi(),'private-token','123',draft()); const totals = pricingTotals(quote,draft());
    assert.equal(totals?.profit,42); assert.equal(totals?.margin,42); assert.equal(totals?.net,73);
  });
  await test('ausências não viram zero; zero explícito é aceito', async () => {
    const api = new PricingApi(); api.shipping = new Error('Frete indisponível'); const quote = await quotePricing(api,'private-token','123',draft());
    assert.equal(quote.shippingCost,null); assert.equal(pricingTotals(quote,draft()),null);
    assert.equal(pricingTotals(quote,{...draft(),manualShipping:0})?.manualShipping,true);
    assert.equal(pricingTotals(quote,{...draft(),manualShipping:8,cost:null}),null);
    assert.equal(pricingTotals(quote,{...draft(),manualShipping:8,taxPercent:null}),null);
    assert.equal(pricingTotals(quote,{...draft(),manualShipping:8,taxPercent:Infinity}),null);
  });
  await test('não inventa frete sem medidas ou anúncio', async () => {
    const api = new PricingApi(); const quote = await quotePricing(api,'private-token','123',{...draft(),dimensions:undefined});
    assert.equal(quote.shippingCost,null); assert.equal(api.paths.length,1); assert.match(quote.shippingError!,/medidas/);
  });
  await test('não aceita tarifas ausentes, moeda errada ou múltiplas opções ambíguas', async () => {
    for (const fee of [{currency_id:'BRL',listing_type_id:'gold_pro'}, {currency_id:'USD',listing_type_id:'gold_pro',sale_fee_amount:5}, {currency_id:'BRL',listing_type_id:'gold_special',sale_fee_amount:5}]) {
      const api = new PricingApi(); api.fee = fee; await assert.rejects(quotePricing(api,'private-token','123',draft()),/comissão/);
    }
    const api = new PricingApi(); api.fee = [api.fee,api.fee]; await assert.rejects(quotePricing(api,'private-token','123',draft()),/comissão/);
  });
  await test('aceita tarifa zero e arrays de resposta, preservando frete zero confirmado', async () => {
    const api = new PricingApi(); api.fee = [{...api.fee,sale_fee_amount:0}]; api.shipping.coverage.all_country.list_cost = 0;
    const quote = await quotePricing(api,'private-token','123',draft()); assert.equal(quote.saleFee,0); assert.equal(quote.shippingCost,0);
  });
  await test('frete em outra moeda fica pendente', async () => {
    const api = new PricingApi(); api.shipping.coverage.all_country.currency_id='ARS'; assert.equal((await quotePricing(api,'private-token','123',draft())).shippingCost,null);
  });
  await test('concorrente fornece categoria, nunca logística nem frete da loja', async () => {
    const api = new PricingApi(); api.item.seller_id=999;
    const context = await readPricingContext(api,'private-token','123','MLB123456789'); assert.equal(context.owned,false); assert.equal(context.categoryId,'MLB1234'); assert.equal(context.logisticType,undefined);
    await assert.rejects(quotePricing(api,'private-token','123',{...draft(),itemId:'MLB123456789'}),/outro vendedor/);
  });
  await test('anúncio próprio usa ID quando não há dimensões e recusa categoria divergente', async () => {
    const api = new PricingApi(); await quotePricing(api,'private-token','123',{...draft(),itemId:'MLB123456789',dimensions:undefined}); assert.ok(api.paths.some(p=>p.includes('item_id=MLB123456789')));
    await assert.rejects(quotePricing(api,'private-token','123',{...draft(),itemId:'MLB123456789',categoryId:'MLB9999'}),/categoria/);
  });
  await test('valida logística, dimensões e valores antes de acessar a API', () => {
    for (const bad of [{price:NaN},{price:0},{price:-1},{categoryId:'../../items'},{logisticType:'inventada'},{shippingMode:'custom'},{dimensions:'0x2x3,500'},{dimensions:'10x20x30,0'},{freeShipping:'false'},{itemId:'MLB123/other'}]) assert.throws(()=>validatePricingRequest({...draft(),...bad}));
  });
  await test('link de catálogo não vira anúncio e domínio parecido é rejeitado', () => {
    assert.equal(mlItemIdFromUrl('https://produto.mercadolivre.com.br/MLB-123456789-copo'),'MLB123456789');
    assert.equal(mlItemIdFromUrl('https://www.mercadolivre.com.br/p/MLB123456789'),undefined);
    assert.equal(mlItemIdFromUrl('https://www.mercadolivre.com.br/p/MLB987654321?item_id=MLB123456789'),'MLB123456789');
    assert.equal(mlItemIdFromUrl('https://mercadolivre.com.br.evil.test/MLB-123456789'),undefined);
  });
  await test('cadastro em andamento lê somente campos reconhecidos e preserva ausência', () => {
    const values: Record<string,string> = { title:'Copo azul',category_id:'MLB1234',price:'45,90',listing_type_id:'gold_pro' };
    const doc = { querySelector(selector: string) { const key=selector.match(/name="([^"]+)"/)?.[1]; return key && values[key] ? {value:values[key]} : null; } } as unknown as Document;
    const context = readPricingPage(doc,'https://www.mercadolivre.com.br/anuncios/novo'); assert.equal(context.price,45.9); assert.equal(context.categoryId,'MLB1234'); assert.equal(context.logisticType,undefined);
  });
  await test('custos locais não invalidam tarifa; preço, categoria e logística invalidam', () => {
    assert.equal(pricingRequestKey(draft()),pricingRequestKey({...draft(),cost:50,manualShipping:10,taxPercent:8}));
    for (const patch of [{price:101},{listingType:'gold_special' as const},{categoryId:'MLB5678'},{freeShipping:true},{logisticType:'fulfillment'}]) assert.notEqual(pricingRequestKey(draft()),pricingRequestKey({...draft(),...patch}));
  });
  await test('rascunho persiste mas kit novo não herda contexto ou preço do anúncio original', async () => {
    const sheet = createInitialSheet(); sheet.title=createAuditedField('Copo'); sheet.mlCalculator={...draft(),itemId:'MLB123456789'};
    await saveSheet(sheet); assert.deepEqual((await loadSheet(sheet.id))?.mlCalculator,sheet.mlCalculator); assert.equal(convertToKit(sheet,2).mlCalculator,undefined);
  });
}
