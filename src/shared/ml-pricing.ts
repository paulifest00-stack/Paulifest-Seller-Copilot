export interface MlPricingRequest {
  categoryId: string;
  price: number;
  listingType: 'gold_special' | 'gold_pro';
  shippingMode: string;
  logisticType: string;
  condition: 'new' | 'used';
  freeShipping: boolean;
  itemId?: string;
  dimensions?: string;
}
export interface MlPricingQuote {
  request: MlPricingRequest;
  sellerId: string;
  queriedAt: string;
  saleFee: number;
  fixedFee: number | null;
  percentageFee: number | null;
  shippingCost: number | null;
  shippingError?: string;
  source: 'mercadolivre_api';
}
export interface MlPricingContext {
  itemId?: string;
  title?: string;
  categoryId?: string;
  price?: number;
  listingType?: 'gold_special' | 'gold_pro';
  shippingMode?: string;
  logisticType?: string;
  condition?: 'new' | 'used';
  freeShipping?: boolean;
  dimensions?: string;
  owned?: boolean;
}
export interface MlCalculatorDraft extends MlPricingRequest {
  cost: number | null;
  baseCost?: number | null;
  taxPercent: number | null;
  packaging: number;
  otherCosts: number;
  manualShipping: number | null;
}
export function pricingTotals(quote: MlPricingQuote, costs: Pick<MlCalculatorDraft, 'cost' | 'taxPercent' | 'packaging' | 'otherCosts' | 'manualShipping'>) {
  const shipping = quote.shippingCost ?? costs.manualShipping;
  const all = [quote.request.price, quote.saleFee, shipping, costs.cost, costs.taxPercent, costs.packaging, costs.otherCosts];
  if (all.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0) || quote.request.price <= 0 || costs.taxPercent! > 100) return null;
  const tax = quote.request.price * costs.taxPercent! / 100;
  const net = quote.request.price - quote.saleFee - shipping!;
  const profit = net - costs.cost! - tax - costs.packaging - costs.otherCosts;
  return { shipping: shipping!, tax, net, profit, margin: profit / quote.request.price * 100, manualShipping: quote.shippingCost === null };
}
