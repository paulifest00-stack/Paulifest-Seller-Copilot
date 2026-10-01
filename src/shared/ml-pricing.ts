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
  categoryName?: string;
  thumbnail?: string;
  price?: number;
  listingType?: 'gold_special' | 'gold_pro';
  shippingMode?: string;
  logisticType?: string;
  condition?: 'new' | 'used';
  freeShipping?: boolean;
  dimensions?: string;
  owned?: boolean;
}

export interface MlPlanCalculation {
  listingType: 'gold_special' | 'gold_pro';
  label: string;
  salePrice: number;
  commissionPercent: number;
  commissionAmount: number;
  fixedFee: number;
  shippingCost: number;
  isFreeShippingMandatory: boolean;
  sellerPaysShipping: boolean;
  taxAmount: number;
  productCost: number;
  packagingCost: number;
  otherCosts: number;
  totalCosts: number;
  netProfit: number;
  marginPercent: number;
  roiPercent: number;
  breakEvenPrice: number;
}

export interface MlSideBySideComparison {
  classic: MlPlanCalculation;
  premium: MlPlanCalculation;
}

export interface MlCalculatorParams {
  salePrice: number;
  productCost: number;
  taxPercent: number;
  packagingCost: number;
  otherCosts: number;
  classicCommissionPercent?: number; // default ~12%
  premiumCommissionPercent?: number; // default ~16.5%
  customShippingCost?: number | null; // if seller specifies or quote returned
  forceFreeShipping?: boolean;
}

export const ML_FIXED_FEE_THRESHOLD = 79.0;
export const ML_DEFAULT_FIXED_FEE = 6.0;
export const ML_DEFAULT_CLASSIC_COMMISSION = 12.0;
export const ML_DEFAULT_PREMIUM_COMMISSION = 16.5;
export const ML_DEFAULT_FREE_SHIPPING_ESTIMATE = 18.90;

export function calculateMlPlan(
  listingType: 'gold_special' | 'gold_pro',
  params: MlCalculatorParams
): MlPlanCalculation {
  const salePrice = Math.max(0, params.salePrice);
  const productCost = Math.max(0, params.productCost);
  const taxPercent = Math.max(0, Math.min(100, params.taxPercent));
  const packagingCost = Math.max(0, params.packagingCost);
  const otherCosts = Math.max(0, params.otherCosts);

  const commissionPercent = listingType === 'gold_special'
    ? (params.classicCommissionPercent ?? ML_DEFAULT_CLASSIC_COMMISSION)
    : (params.premiumCommissionPercent ?? ML_DEFAULT_PREMIUM_COMMISSION);

  // Tarifa fixa: Cobrada somente para produtos abaixo de R$ 79,00
  const fixedFee = salePrice > 0 && salePrice < ML_FIXED_FEE_THRESHOLD ? ML_DEFAULT_FIXED_FEE : 0;

  // Frete: Acima de R$ 79,00 é obrigatório frete grátis custeado pelo vendedor (com subsídio ML)
  const isFreeShippingMandatory = salePrice >= ML_FIXED_FEE_THRESHOLD;
  const sellerPaysShipping = isFreeShippingMandatory || Boolean(params.forceFreeShipping);

  const shippingCost = sellerPaysShipping
    ? (params.customShippingCost != null && params.customShippingCost >= 0
        ? params.customShippingCost
        : ML_DEFAULT_FREE_SHIPPING_ESTIMATE)
    : (params.customShippingCost ?? 0);

  const commissionAmount = Number(((salePrice * commissionPercent) / 100).toFixed(2));
  const taxAmount = Number(((salePrice * taxPercent) / 100).toFixed(2));

  const totalCosts = Number((
    commissionAmount +
    fixedFee +
    shippingCost +
    taxAmount +
    productCost +
    packagingCost +
    otherCosts
  ).toFixed(2));

  const netProfit = Number((salePrice - totalCosts).toFixed(2));
  const marginPercent = salePrice > 0 ? Number(((netProfit / salePrice) * 100).toFixed(1)) : 0;
  const roiPercent = productCost > 0 ? Number(((netProfit / productCost) * 100).toFixed(1)) : 0;

  // Break-even
  const netRate = 1 - (commissionPercent / 100) - (taxPercent / 100);
  const fixedSum = productCost + packagingCost + otherCosts + fixedFee + shippingCost;
  const breakEvenPrice = netRate > 0 ? Number((fixedSum / netRate).toFixed(2)) : 0;

  return {
    listingType,
    label: listingType === 'gold_special' ? 'Clássico' : 'Premium',
    salePrice,
    commissionPercent,
    commissionAmount,
    fixedFee,
    shippingCost,
    isFreeShippingMandatory,
    sellerPaysShipping,
    taxAmount,
    productCost,
    packagingCost,
    otherCosts,
    totalCosts,
    netProfit,
    marginPercent,
    roiPercent,
    breakEvenPrice
  };
}

export function calculateMlSideBySide(params: MlCalculatorParams): MlSideBySideComparison {
  return {
    classic: calculateMlPlan('gold_special', params),
    premium: calculateMlPlan('gold_pro', params)
  };
}

/**
 * Cálculo Reverso: Encontra o preço de venda ideal para atingir uma margem percentual ou lucro em R$ desejado.
 */
export function calculatePriceForTarget(
  targetType: 'margin_percent' | 'profit_amount',
  targetValue: number,
  params: Omit<MlCalculatorParams, 'salePrice'>
): { classicPrice: number; premiumPrice: number } {
  const solveForPlan = (listingType: 'gold_special' | 'gold_pro'): number => {
    const commissionPercent = listingType === 'gold_special'
      ? (params.classicCommissionPercent ?? ML_DEFAULT_CLASSIC_COMMISSION)
      : (params.premiumCommissionPercent ?? ML_DEFAULT_PREMIUM_COMMISSION);
    const commRate = commissionPercent / 100;
    const taxRate = Math.max(0, Math.min(100, params.taxPercent)) / 100;
    const baseCosts = Math.max(0, params.productCost) + Math.max(0, params.packagingCost) + Math.max(0, params.otherCosts);

    // 1. Tenta supor que o preço fica abaixo de R$ 79 (com taxa fixa de R$ 6 e frete grátis somente se forçado)
    const shippingUnder79 = params.forceFreeShipping
      ? (params.customShippingCost ?? ML_DEFAULT_FREE_SHIPPING_ESTIMATE)
      : (params.customShippingCost ?? 0);
    const fixedFeeUnder79 = ML_DEFAULT_FIXED_FEE;

    if (targetType === 'margin_percent') {
      const marginRate = targetValue / 100;
      const denomUnder = 1 - commRate - taxRate - marginRate;
      if (denomUnder > 0) {
        const candidateUnder = (baseCosts + fixedFeeUnder79 + shippingUnder79) / denomUnder;
        if (candidateUnder > 0 && candidateUnder < ML_FIXED_FEE_THRESHOLD) {
          return Number(candidateUnder.toFixed(2));
        }
      }

      // 2. Se passar de R$ 79 ou denomUnder for inviável, calcula para >= R$ 79 (sem taxa fixa de R$ 6 e com frete obrigatório)
      const shippingOver79 = params.customShippingCost ?? ML_DEFAULT_FREE_SHIPPING_ESTIMATE;
      const denomOver = 1 - commRate - taxRate - marginRate;
      if (denomOver > 0) {
        const candidateOver = (baseCosts + shippingOver79) / denomOver;
        return Number(Math.max(ML_FIXED_FEE_THRESHOLD, candidateOver).toFixed(2));
      }
    } else {
      // profit_amount (R$)
      const profitDesired = Math.max(0, targetValue);
      const denomUnder = 1 - commRate - taxRate;
      if (denomUnder > 0) {
        const candidateUnder = (baseCosts + fixedFeeUnder79 + shippingUnder79 + profitDesired) / denomUnder;
        if (candidateUnder > 0 && candidateUnder < ML_FIXED_FEE_THRESHOLD) {
          return Number(candidateUnder.toFixed(2));
        }
      }

      const shippingOver79 = params.customShippingCost ?? ML_DEFAULT_FREE_SHIPPING_ESTIMATE;
      const denomOver = 1 - commRate - taxRate;
      if (denomOver > 0) {
        const candidateOver = (baseCosts + shippingOver79 + profitDesired) / denomOver;
        return Number(Math.max(ML_FIXED_FEE_THRESHOLD, candidateOver).toFixed(2));
      }
    }

    return 0;
  };

  return {
    classicPrice: solveForPlan('gold_special'),
    premiumPrice: solveForPlan('gold_pro')
  };
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

