// Motor de Precificação Determinístico (Desacoplado de regras tarifárias chumbadas)
import type { DynamicFeeBreakdown, PricingInputs, PricingOutputs } from '../../schema/pricing.ts';
import { defaultMlFeeProvider, type IMarketplaceFeeProvider } from './fee-provider.ts';

/**
 * Resolve algebricamente o preço de venda ideal para atingir uma margem líquida percentual (m).
 * Fórmula: Lucro = Pv * m
 * Pv * (1 - m - t - r) = CustoBase + DeduçõesFixasOuFrete
 * 
 * NENHUMA taxa, corte ou valor monetário de canal está chumbado aqui.
 * Todas as variáveis tarifárias são obtidas dinamicamente do IMarketplaceFeeProvider.
 */
export async function solvePriceForMargin(
  inputs: PricingInputs,
  targetMarginPercent: number,
  feeProvider: IMarketplaceFeeProvider = defaultMlFeeProvider
): Promise<number> {
  const costPrice = Number(inputs.costPrice || 0);
  const taxRatePercent = Number(inputs.taxRatePercent || 0);
  const packagingCost = Number(inputs.packagingCost || 0);
  const otherCost = Number(inputs.otherOperationalCost || 0);

  const m = targetMarginPercent / 100;
  const t = taxRatePercent / 100;
  const baseCost = costPrice + packagingCost + otherCost;

  // Consulta a regra tarifária dinâmica fornecida pelo canal
  const rule = await feeProvider.getFeeRule({
    marketplace: 'mercadolivre',
    categoryId: inputs.categoryId || 'MLB1051',
    listingType: inputs.listingType,
    packageWeightKg: inputs.packageWeightKg,
    shippingMode: inputs.shippingMode,
    logisticType: inputs.logisticType
  });

  const r = rule.percentageRate;
  const denominator = 1 - m - t - r;
  if (denominator <= 0) {
    throw new Error(
      `Margem de ${targetMarginPercent}% inviável com impostos (${taxRatePercent}%) e comissão do canal (${(r * 100).toFixed(0)}%).`
    );
  }

  // Se o canal estipula limiar com taxa fixa (ex: produtos abaixo de certo valor):
  if (rule.fixedFeeThreshold > 0 && rule.fixedFeeAmount > 0) {
    const priceWithFixedFee = (baseCost + rule.fixedFeeAmount) / denominator;
    if (priceWithFixedFee < rule.fixedFeeThreshold && priceWithFixedFee > 0) {
      return Number(priceWithFixedFee.toFixed(2));
    }
  }

  // Regime acima do limiar ou sem taxa fixa (com frete atribuído ao vendedor, se houver):
  const priceWithShipping = (baseCost + rule.shippingCostToSeller) / denominator;
  const finalPrice = rule.fixedFeeThreshold > 0
    ? Math.max(rule.fixedFeeThreshold, priceWithShipping)
    : priceWithShipping;

  return Number(finalPrice.toFixed(2));
}

/**
 * Calcula o Ponto de Equilíbrio (Break-Even): Preço mínimo onde Lucro Líquido = R$ 0,00.
 */
export async function calculateBreakEvenPrice(
  inputs: PricingInputs,
  feeProvider: IMarketplaceFeeProvider = defaultMlFeeProvider
): Promise<number> {
  return solvePriceForMargin(inputs, 0, feeProvider);
}

/**
 * Calcula a precificação direta a partir de um preço de venda conhecido.
 */
export async function calculateDirectPricing(
  inputs: PricingInputs,
  feeProvider: IMarketplaceFeeProvider = defaultMlFeeProvider
): Promise<PricingOutputs> {
  const salePrice = Number(inputs.freeSalePrice ?? 0);
  const costPrice = Number(inputs.costPrice || 0);
  const taxRatePercent = Number(inputs.taxRatePercent || 0);
  const packagingCost = Number(inputs.packagingCost || 0);
  const otherCost = Number(inputs.otherOperationalCost || 0);

  // 1. Consulta taxas dinâmicas fornecidas pelo FeeProvider
  const fees: DynamicFeeBreakdown = await feeProvider.getDynamicFees({
    marketplace: 'mercadolivre',
    categoryId: inputs.categoryId || 'MLB1051',
    listingType: inputs.listingType,
    price: salePrice,
    packageWeightKg: inputs.packageWeightKg,
    shippingMode: inputs.shippingMode,
    logisticType: inputs.logisticType
  });

  // 2. Impostos em R$
  const taxAmount = Number(((salePrice * taxRatePercent) / 100).toFixed(2));

  // 3. Lucro líquido = Preço de Venda - Todas as deduções
  const totalDeductions = costPrice + packagingCost + otherCost + fees.totalMarketplaceRetention + taxAmount;
  const netProfit = Number((salePrice - totalDeductions).toFixed(2));

  // 4. Margem líquida percentual real
  const netMarginPercent = salePrice > 0 ? Number(((netProfit / salePrice) * 100).toFixed(2)) : 0;

  // 5. Ponto de Equilíbrio (Break-Even) calculado deterministicamente
  const breakEvenPrice = await solvePriceForMargin(inputs, 0, feeProvider);

  return {
    salePrice,
    costPrice,
    taxAmount,
    taxRatePercent,
    packagingCost,
    marketplaceFees: fees,
    netProfit,
    netMarginPercent,
    breakEvenPrice,
    listingType: inputs.listingType
  };
}

/**
 * Modo Reverso: Dado a margem líquida alvo desejada (ex: 20%),
 * resolve algebricamente para encontrar o Preço de Venda (Pv) ideal.
 */
export async function calculateReversePricing(
  inputs: PricingInputs,
  feeProvider: IMarketplaceFeeProvider = defaultMlFeeProvider
): Promise<PricingOutputs> {
  const targetMarginPercent = Number(inputs.targetMarginPercent || 0);
  const solvedPrice = await solvePriceForMargin(inputs, targetMarginPercent, feeProvider);

  return calculateDirectPricing(
    {
      ...inputs,
      freeSalePrice: solvedPrice
    },
    feeProvider
  );
}
