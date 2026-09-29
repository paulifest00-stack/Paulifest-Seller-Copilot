import type { MlPricingContext, MlPricingQuote, MlPricingRequest } from '../../../shared/ml-pricing.ts';
import type { MlApiClient } from './api-client.ts';

const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const logistics: Record<string, string[]> = { me2: ['drop_off', 'xd_drop_off', 'cross_docking', 'fulfillment', 'self_service', 'turbo'], me1: ['default'], custom: ['custom'], not_specified: ['not_specified'] };
export function validatePricingRequest(raw: any): MlPricingRequest {
  if (!raw || !/^MLB\d+$/.test(raw.categoryId) || !nonnegative(raw.price) || raw.price <= 0 || raw.price > 1e8 || !['gold_special', 'gold_pro'].includes(raw.listingType)) throw new Error('Informe categoria, preço e tipo de anúncio válidos.');
  if (!logistics[raw.shippingMode]?.includes(raw.logisticType)) throw new Error('Confira o modo de envio e a logística do anúncio.');
  if (!['new', 'used'].includes(raw.condition) || typeof raw.freeShipping !== 'boolean') throw new Error('Confira a condição do produto e o frete grátis.');
  if (raw.itemId && (typeof raw.itemId !== 'string' || !/^MLB\d{6,}$/.test(raw.itemId))) throw new Error('ID do anúncio inválido.');
  if (raw.dimensions && (typeof raw.dimensions !== 'string' || !/^\d+(?:\.\d+)?x\d+(?:\.\d+)?x\d+(?:\.\d+)?,\d+$/.test(raw.dimensions) || raw.dimensions.split(/[x,]/).some((v: string) => Number(v) <= 0 || Number(v) > 1e6))) throw new Error('Dimensões inválidas. Use altura x largura x comprimento em cm, peso em gramas.');
  return { categoryId: raw.categoryId, price: raw.price, listingType: raw.listingType, shippingMode: raw.shippingMode, logisticType: raw.logisticType, condition: raw.condition, freeShipping: raw.freeShipping, ...(raw.itemId ? { itemId: raw.itemId } : {}), ...(raw.dimensions ? { dimensions: raw.dimensions } : {}) };
}
export async function readPricingContext(api: MlApiClient, token: string, sellerId: string, id: unknown): Promise<MlPricingContext> {
  if (typeof id !== 'string' || !/^MLB\d{6,}$/.test(id)) throw new Error('Abra um anúncio ou informe seu código MLB.');
  const item = await api.request('/items/' + id, token);
  if (item?.id !== id || item.site_id !== 'MLB' || item.currency_id !== 'BRL' || !/^MLB\d+$/.test(item.category_id)) throw new Error('O ML não retornou um anúncio brasileiro válido.');
  const owned = String(item.seller_id) === sellerId;
  // Competitor identity is useful; their logistics and negotiated costs are not ours.
  return { itemId: id, title: String(item.title || ''), categoryId: item.category_id, ...(nonnegative(item.price) ? { price: item.price } : {}), owned,
    ...(['gold_special', 'gold_pro'].includes(item.listing_type_id) ? { listingType: item.listing_type_id } : {}),
    ...(owned ? { shippingMode: item.shipping?.mode, logisticType: item.shipping?.logistic_type, freeShipping: item.shipping?.free_shipping, dimensions: item.shipping?.dimensions || undefined, condition: item.condition } : {}) };
}
export async function quotePricing(api: MlApiClient, token: string, sellerId: string, raw: unknown): Promise<MlPricingQuote> {
  const request = validatePricingRequest(raw);
  if (request.itemId) {
    const item = await readPricingContext(api, token, sellerId, request.itemId);
    if (!item.owned) throw new Error('O anúncio é de outro vendedor. Use a categoria como referência e informe a logística da sua loja.');
    if (item.categoryId !== request.categoryId) throw new Error('A categoria não corresponde ao anúncio. Leia o anúncio novamente.');
  }
  let shippingCost: number | null = null, shippingError: string | undefined, billableWeight: number | undefined;
  if (request.shippingMode !== 'me2') shippingError = 'Frete desta modalidade deve ser informado por você.';
  else if (!request.itemId && !request.dimensions) shippingError = 'Informe as medidas e o peso da embalagem para consultar o frete.';
  else {
    const params = new URLSearchParams({ item_price: String(request.price), listing_type_id: request.listingType, mode: request.shippingMode, logistic_type: request.logisticType, condition: request.condition, free_shipping: String(request.freeShipping), verbose: 'true' });
    if (request.dimensions) params.set('dimensions', request.dimensions);
    else if (request.itemId) params.set('item_id', request.itemId);
    try {
      const shipping = await api.request(`/users/${sellerId}/shipping_options/free?` + params, token);
      const coverage = shipping?.coverage?.all_country;
      if (coverage?.currency_id !== 'BRL' || !nonnegative(coverage?.list_cost)) throw new Error('O ML não retornou um custo de frete válido em reais.');
      shippingCost = coverage.list_cost;
      if (nonnegative(coverage.billable_weight) && coverage.billable_weight > 0) billableWeight = coverage.billable_weight;
    } catch (e) { shippingError = e instanceof Error ? e.message : 'Não foi possível consultar o frete.'; }
  }
  const params = new URLSearchParams({ category_id: request.categoryId, price: String(request.price), listing_type_id: request.listingType, currency_id: 'BRL', shipping_mode: request.shippingMode, logistic_type: request.logisticType });
  if (billableWeight !== undefined) params.set('billable_weight', String(billableWeight));
  const result = await api.request('/sites/MLB/listing_prices?' + params, token);
  const rows = (Array.isArray(result) ? result.flat() : [result]).filter((r: any) => r?.listing_type_id === request.listingType && r?.currency_id === 'BRL');
  if (rows.length !== 1 || !nonnegative(rows[0].sale_fee_amount)) throw new Error('O ML não retornou uma comissão única e válida em reais para este anúncio.');
  const fee = rows[0];
  return { request, sellerId, queriedAt: new Date().toISOString(), source: 'mercadolivre_api', saleFee: fee.sale_fee_amount,
    fixedFee: nonnegative(fee.sale_fee_details?.fixed_fee) ? fee.sale_fee_details.fixed_fee : null,
    percentageFee: nonnegative(fee.sale_fee_details?.percentage_fee) ? fee.sale_fee_details.percentage_fee : null,
    shippingCost, ...(shippingError ? { shippingError } : {}) };
}
