// Motor de Precificação Determinístico (Desacoplado de regras tarifárias chumbadas)
import type {
  ConsideredDeductions,
  DynamicFeeBreakdown,
  PricingInputs,
  PricingOutputs
} from '../../schema/pricing.ts';
import { defaultMlFeeProvider, type IMarketplaceFeeProvider } from './fee-provider.ts';

export interface SolverOptions {
  minPrice?: number;
  maxPrice?: number;
  maxEvaluations?: number;
  toleranceCents?: number;
}

/**
 * Resolve algebricamente o preço de venda ideal para atingir uma margem líquida percentual (m).
 * Fórmula: Lucro = Pv * m
 * Pv * (1 - m - t - r - ad) = CustoBase + DeduçõesFixasOuFrete
 *
 * NENHUMA taxa, corte ou valor monetário de canal está chumbado aqui.
 * Todas as variáveis tarifárias são obtidas dinamicamente do IMarketplaceFeeProvider.
 */
export async function solvePriceForMargin(
  inputs: PricingInputs,
  targetMarginPercent: number,
  feeProvider: IMarketplaceFeeProvider = defaultMlFeeProvider
): Promise<number> {
  if (inputs.costPrice === null || inputs.costPrice === undefined || isNaN(inputs.costPrice)) {
    throw new Error('Custo de aquisição (CMV) ausente ou não informado. O cálculo de margem requer custo definido.');
  }
  if (inputs.costPrice < 0) {
    throw new Error('Custo de aquisição não pode ser negativo.');
  }

  const costPrice = inputs.costPrice;
  const taxRatePercent = Number(inputs.taxRatePercent || 0);
  const packagingCost = Number(inputs.packagingCost || 0);
  const otherCost = Number(inputs.otherOperationalCost || 0);

  const m = targetMarginPercent / 100;
  const t = taxRatePercent / 100;
  const adRate = (inputs.advertisingRatePercent !== undefined && inputs.advertisingRatePercent !== null)
    ? Number(inputs.advertisingRatePercent) / 100
    : 0;

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
  const denominator = 1 - m - t - r - adRate;
  if (denominator <= 0) {
    throw new Error(
      `Margem de ${targetMarginPercent}% inviável com impostos (${taxRatePercent}%), publicidade (${(adRate * 100).toFixed(1)}%) e comissão do canal (${(r * 100).toFixed(0)}%).`
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
  if (inputs.costPrice === null || inputs.costPrice === undefined || isNaN(inputs.costPrice)) {
    throw new Error('Custo de aquisição (CMV) ausente ou não informado. O cálculo de precificação requer custo definido.');
  }
  if (inputs.costPrice < 0) {
    throw new Error('Custo de aquisição não pode ser negativo.');
  }

  const costPrice = inputs.costPrice;
  const salePrice = Number(inputs.freeSalePrice ?? 0);
  const taxRatePercent = Number(inputs.taxRatePercent || 0);
  const packagingCost = Number(inputs.packagingCost || 0);
  const otherCost = Number(inputs.otherOperationalCost || 0);

  const hasAdvertising = inputs.advertisingRatePercent !== undefined && inputs.advertisingRatePercent !== null;
  const advertisingRatePercent = hasAdvertising ? Number(inputs.advertisingRatePercent) : undefined;
  const advertisingAmount = hasAdvertising
    ? Number(((salePrice * inputs.advertisingRatePercent!) / 100).toFixed(2))
    : undefined;

  const consideredDeductions: ConsideredDeductions = {
    costPrice: true,
    tax: inputs.taxRatePercent !== undefined && inputs.taxRatePercent !== null,
    packaging: inputs.packagingCost !== undefined && inputs.packagingCost !== null,
    otherOperational: inputs.otherOperationalCost !== undefined && inputs.otherOperationalCost !== null,
    advertising: hasAdvertising
  };

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

  if (
    typeof fees.totalMarketplaceRetention !== 'number' ||
    isNaN(fees.totalMarketplaceRetention) ||
    !isFinite(fees.totalMarketplaceRetention)
  ) {
    throw new Error(`FeeProvider retornou retenção tarifária inválida (NaN ou infinita): ${fees.totalMarketplaceRetention}`);
  }

  // 2. Impostos em R$
  const taxAmount = Number(((salePrice * taxRatePercent) / 100).toFixed(2));

  // 3. Lucro líquido = Preço de Venda - Todas as deduções
  const totalDeductions = costPrice + packagingCost + otherCost + fees.totalMarketplaceRetention + taxAmount + (advertisingAmount ?? 0);
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
    otherOperationalCost: otherCost,
    advertisingAmount,
    advertisingRatePercent,
    consideredDeductions,
    marketplaceFees: fees,
    netProfit,
    netMarginPercent,
    breakEvenPrice,
    listingType: inputs.listingType,
    providerId: feeProvider.providerId,
    isSimulated: feeProvider.isSimulated,
    targetProfitAmount: inputs.targetProfitAmount,
    mode: inputs.mode
  };
}

/**
 * Solver Desacoplado para Lucro Alvo Absoluto (target_profit - Fase 4D.1):
 * Encontra deterministicamente o MENOR preço monetário válido em centavos que satisfaça:
 * netProfit >= targetProfitAmount.
 *
 * Regras e Garantias:
 * - Totalmente desacoplado de regras internas do canal (não fixa tarifas, cortes, frete ou comissões);
 * - Toda a autoridade tarifária reside em feeProvider.getDynamicFees({ price });
 * - Opera estritamente em centavos inteiros;
 * - Valida entradas: custo ausente bloqueia cálculo, custo 0 explícito é permitido;
 * - Considera deduções de publicidade apenas se explicitamente configuradas;
 * - Detecta limites de avaliação, teto inexequível e valores NaN/Infinity com fail-closed;
 * - Avalia a vizinhança em centavos para confirmar que é o menor preço válido;
 * - Detecta não-monotonicidade incompatível ou oscilações erráticas e falha fechado.
 */
export async function solvePriceForTargetProfit(
  inputs: PricingInputs,
  feeProvider: IMarketplaceFeeProvider = defaultMlFeeProvider,
  options?: SolverOptions
): Promise<PricingOutputs> {
  // 1. Validação estrita de entradas
  if (inputs.costPrice === null || inputs.costPrice === undefined || isNaN(inputs.costPrice)) {
    throw new Error('Custo de aquisição (CMV) ausente ou não informado. O cálculo de target_profit requer custo definido.');
  }
  if (inputs.costPrice < 0) {
    throw new Error('Custo de aquisição não pode ser negativo.');
  }

  const costPrice = inputs.costPrice;
  const packagingCost = Number(inputs.packagingCost || 0);
  const otherCost = Number(inputs.otherOperationalCost || 0);
  const taxRatePercent = Number(inputs.taxRatePercent || 0);

  if (inputs.targetProfitAmount === null || inputs.targetProfitAmount === undefined || isNaN(inputs.targetProfitAmount)) {
    throw new Error('Modo target_profit exige targetProfitAmount definido.');
  }
  if (inputs.targetProfitAmount < 0) {
    throw new Error('targetProfitAmount deve ser maior ou igual a zero.');
  }
  const targetProfitAmount = Number(inputs.targetProfitAmount);

  const hasAdvertising = inputs.advertisingRatePercent !== undefined && inputs.advertisingRatePercent !== null;
  if (hasAdvertising && (isNaN(inputs.advertisingRatePercent!) || inputs.advertisingRatePercent! < 0 || inputs.advertisingRatePercent! >= 100)) {
    throw new Error('advertisingRatePercent deve ser um percentual válido entre 0 e 100.');
  }
  const advertisingRatePercent = hasAdvertising ? Number(inputs.advertisingRatePercent) : undefined;
  const adRate = hasAdvertising ? advertisingRatePercent! / 100 : 0;
  const taxRate = taxRatePercent / 100;

  if (1 - taxRate - adRate <= 0) {
    throw new Error(`Alíquotas de imposto (${taxRatePercent}%) e publicidade (${advertisingRatePercent}%) somadas excedem ou igualam 100%.`);
  }

  const consideredDeductions: ConsideredDeductions = {
    costPrice: true,
    tax: inputs.taxRatePercent !== undefined && inputs.taxRatePercent !== null,
    packaging: inputs.packagingCost !== undefined && inputs.packagingCost !== null,
    otherOperational: inputs.otherOperationalCost !== undefined && inputs.otherOperationalCost !== null,
    advertising: hasAdvertising
  };

  const maxEvaluations = options?.maxEvaluations ?? 60;
  const maxPrice = options?.maxPrice ?? 50_000.00;
  const minPrice = options?.minPrice ?? 1.00;

  // Limite inferior explícito baseado nos custos diretos conhecidos e lucro alvo
  const floorPrice = (costPrice + packagingCost + otherCost + targetProfitAmount) / (1 - taxRate - adRate);
  const minCents = Math.max(Math.round(minPrice * 100), Math.max(100, Math.floor(floorPrice * 100)));
  const maxCents = Math.round(maxPrice * 100);

  if (minCents > maxCents) {
    throw new Error(`Meta de lucro inviável: limite inferior calculado (R$ ${(minCents / 100).toFixed(2)}) excede o preço teto máximo permitido (R$ ${maxPrice.toFixed(2)}).`);
  }

  let evaluationCount = 0;
  const evalCache = new Map<number, { netProfit: number; fees: DynamicFeeBreakdown }>();
  const evaluatedPoints: { cents: number; netProfit: number }[] = [];

  function findProfitDrops(): { p1: { cents: number; netProfit: number }; p2: { cents: number; netProfit: number } }[] {
    const drops = [];
    for (let i = 0; i < evaluatedPoints.length - 1; i++) {
      if (evaluatedPoints[i].netProfit > evaluatedPoints[i + 1].netProfit) {
        drops.push({ p1: evaluatedPoints[i], p2: evaluatedPoints[i + 1] });
      }
    }
    return drops;
  }

  async function evalCents(cents: number): Promise<{ netProfit: number; fees: DynamicFeeBreakdown }> {
    if (evalCache.has(cents)) {
      return evalCache.get(cents)!;
    }
    if (evaluationCount >= maxEvaluations) {
      if (findProfitDrops().length > 0) {
        throw new Error('Comportamento não monotônico do feeProvider detectado: limite de avaliações excedido devido a oscilações tarifárias na curva.');
      }
      throw new Error(`Limite máximo de avaliações (${maxEvaluations}) excedido sem convergência.`);
    }
    evaluationCount++;
    const price = Number((cents / 100).toFixed(2));

    const fees = await feeProvider.getDynamicFees({
      marketplace: 'mercadolivre',
      categoryId: inputs.categoryId || 'MLB1051',
      listingType: inputs.listingType,
      price,
      packageWeightKg: inputs.packageWeightKg,
      shippingMode: inputs.shippingMode,
      logisticType: inputs.logisticType
    });

    if (
      typeof fees.totalMarketplaceRetention !== 'number' ||
      isNaN(fees.totalMarketplaceRetention) ||
      !isFinite(fees.totalMarketplaceRetention) ||
      fees.totalMarketplaceRetention < 0
    ) {
      throw new Error(`FeeProvider retornou retenção tarifária inválida (NaN ou não finita): ${fees.totalMarketplaceRetention}`);
    }

    const taxAmount = Number(((price * taxRatePercent) / 100).toFixed(2));
    const advertisingAmount = hasAdvertising ? Number(((price * advertisingRatePercent!) / 100).toFixed(2)) : 0;
    const totalDeductions = costPrice + packagingCost + otherCost + fees.totalMarketplaceRetention + taxAmount + advertisingAmount;
    const netProfit = Number((price - totalDeductions).toFixed(2));

    if (isNaN(netProfit) || !isFinite(netProfit)) {
      throw new Error(`Cálculo de lucro líquido resultou em valor inválido para preço R$ ${price.toFixed(2)}`);
    }

    const res = { netProfit, fees };
    evalCache.set(cents, res);

    const insertIdx = evaluatedPoints.findIndex(p => p.cents > cents);
    if (insertIdx === -1) {
      evaluatedPoints.push({ cents, netProfit });
    } else {
      evaluatedPoints.splice(insertIdx, 0, { cents, netProfit });
    }

    return res;
  }

  // 1. Testa teto máximo
  const maxEval = await evalCents(maxCents);
  if (maxEval.netProfit < targetProfitAmount) {
    throw new Error(
      `Meta de lucro de R$ ${targetProfitAmount.toFixed(2)} inviável: no preço teto (R$ ${(maxCents / 100).toFixed(2)}), o lucro líquido é de apenas R$ ${maxEval.netProfit.toFixed(2)}.`
    );
  }

  // 2. Testa piso mínimo
  const minEval = await evalCents(minCents);
  if (minEval.netProfit >= targetProfitAmount) {
    return buildOutput(minCents, minEval);
  }

  // 3. Algoritmo de busca adaptativo com tratamento de descontinuidades e fail-closed para não-monotônico
  let low = minCents;
  let high = maxCents;
  let isolatedDropResolved = false;
  let boundaryRefineCount = 0;

  while (low < high) {
    const drops = findProfitDrops();

    // Mais de 1 queda de lucro observada -> provider artificial / oscilante -> fail-closed
    if (drops.length > 1) {
      throw new Error('Comportamento não monotônico do feeProvider detectado: impossível garantir menor preço de forma segura.');
    }

    // Exatamente 1 queda observada ainda não resolvida (típica do salto tarifário de frete do threshold)
    if (!isolatedDropResolved && drops.length === 1) {
      const { p1, p2 } = drops[0];

      // Se a distância entre os pontos da queda for grande (> 2 centavos), refina o limiar
      if (p2.cents - p1.cents > 2) {
        boundaryRefineCount++;
        if (boundaryRefineCount > 12) {
          throw new Error('Comportamento não monotônico do feeProvider detectado: oscilações excessivas no refinamento da curva.');
        }
        const boundaryMid = Math.floor((p1.cents + p2.cents) / 2);
        await evalCents(boundaryMid);
        continue;
      }

      // Limiar refinado: p1 é o pico do regime inferior, p2 é a base do regime superior
      isolatedDropResolved = true;
      if (p1.netProfit >= targetProfitAmount) {
        // O regime inferior alcança a meta! O menor preço garantidamente reside no regime inferior
        high = p1.cents;
      } else {
        // Mesmo no ápice do regime inferior a meta não é atingida.
        // O regime inferior está matematicamente eliminado. Desloca a busca para o regime superior.
        if (low < p2.cents) {
          low = p2.cents;
        }
      }
    }

    if (low >= high) break;

    const mid = Math.floor((low + high) / 2);
    if (mid === low) {
      const evalLow = await evalCents(low);
      if (evalLow.netProfit >= targetProfitAmount) {
        high = low;
      } else {
        low = high;
      }
      break;
    }

    const midEval = await evalCents(mid);
    if (midEval.netProfit >= targetProfitAmount) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  // 4. Verificação final do candidato e vizinhança em centavos
  let candidateCents = high;
  let candidateEval = await evalCents(candidateCents);

  if (candidateEval.netProfit < targetProfitAmount && candidateCents < maxCents) {
    candidateCents++;
    candidateEval = await evalCents(candidateCents);
  }

  if (candidateEval.netProfit < targetProfitAmount) {
    throw new Error(`Não foi possível encontrar preço válido que satisfaça a meta de R$ ${targetProfitAmount.toFixed(2)}.`);
  }

  // Avaliação da vizinhança inferior em centavos: confirma o menor preço
  let neighborhoodSteps = 0;
  while (candidateCents > minCents) {
    neighborhoodSteps++;
    if (neighborhoodSteps > 3) {
      throw new Error('Comportamento não monotônico do feeProvider detectado: desvios na vizinhança de centavos indicam oscilação tarifária.');
    }
    const prevCents = candidateCents - 1;
    const prevEval = await evalCents(prevCents);
    if (prevEval.netProfit >= targetProfitAmount) {
      candidateCents = prevCents;
      candidateEval = prevEval;
    } else {
      break;
    }
  }

  // Verificação de consistência contra pontos já avaliados
  for (const pt of evaluatedPoints) {
    if (pt.cents < candidateCents && pt.netProfit >= targetProfitAmount) {
      throw new Error('Comportamento não monotônico do feeProvider detectado: inconsistência no menor preço.');
    }
  }

  return buildOutput(candidateCents, candidateEval);

  function buildOutput(cents: number, evaluation: { netProfit: number; fees: DynamicFeeBreakdown }): PricingOutputs {
    const salePrice = Number((cents / 100).toFixed(2));
    const taxAmount = Number(((salePrice * taxRatePercent) / 100).toFixed(2));
    const advertisingAmount = hasAdvertising ? Number(((salePrice * advertisingRatePercent!) / 100).toFixed(2)) : undefined;
    const netMarginPercent = salePrice > 0 ? Number(((evaluation.netProfit / salePrice) * 100).toFixed(2)) : 0;

    return {
      salePrice,
      costPrice,
      taxAmount,
      taxRatePercent,
      packagingCost,
      otherOperationalCost: otherCost,
      advertisingAmount,
      advertisingRatePercent,
      consideredDeductions,
      marketplaceFees: evaluation.fees,
      netProfit: evaluation.netProfit,
      netMarginPercent,
      breakEvenPrice: 0,
      listingType: inputs.listingType,
      providerId: feeProvider.providerId,
      isSimulated: feeProvider.isSimulated,
      targetProfitAmount,
      mode: 'target_profit',
      evaluationCount
    };
  }
}

/**
 * Modo Reverso: Dado a margem líquida alvo desejada (mode: target_margin)
 * ou lucro alvo absoluto (mode: target_profit), resolve para encontrar o Preço de Venda ideal.
 */
export async function calculateReversePricing(
  inputs: PricingInputs,
  feeProvider: IMarketplaceFeeProvider = defaultMlFeeProvider,
  options?: SolverOptions
): Promise<PricingOutputs> {
  if (inputs.mode === 'target_profit') {
    return solvePriceForTargetProfit(inputs, feeProvider, options);
  }

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
