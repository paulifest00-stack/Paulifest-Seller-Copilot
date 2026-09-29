import type { MlCalculatorDraft, MlPricingRequest } from '../../shared/ml-pricing.ts';
export function pricingRequest(draft: MlCalculatorDraft): MlPricingRequest {
  const { categoryId, price, listingType, shippingMode, logisticType, condition, freeShipping, itemId, dimensions } = draft;
  return { categoryId, price, listingType, shippingMode, logisticType, condition, freeShipping, ...(itemId ? { itemId } : {}), ...(dimensions ? { dimensions } : {}) };
}
export function pricingRequestKey(draft: MlCalculatorDraft): string { return JSON.stringify(pricingRequest(draft)); }
