// Testes Unitários: Validação de EAN-13 e Motor de Precificação Determinístico
import assert from 'node:assert';
import { validateEan, generateTestEan13Checksum } from '../src/core/engines/identification/ean-validator.ts';
import {
  calculateDirectPricing,
  calculateReversePricing,
  calculateBreakEvenPrice,
  solvePriceForTargetProfit
} from '../src/core/engines/pricing-calculator/pricing-calculator.ts';
import {
  MockMercadoLivreFeeProvider,
  defaultMlFeeProvider,
  type IMarketplaceFeeProvider,
  type MarketplaceFeeRequest
} from '../src/core/engines/pricing-calculator/fee-provider.ts';
import type {
  DynamicFeeBreakdown,
  MarketplaceFeeRule
} from '../src/core/schema/pricing.ts';
import { createAuditedField } from '../src/core/schema/product.ts';
import { isCostPriceComputable } from '../src/sidepanel/components/steps/StepPricing.tsx';

/**
 * Provedor Fake Controlado para Testes Unitários:
 * Permite injetar regras tarifárias arbitrárias sem qualquer dependência de valores reais ou regras fixas.
 */
class FakeControlledFeeProvider implements IMarketplaceFeeProvider {
  readonly providerId = 'fake-test-provider';
  readonly isSimulated = true;

  constructor(
    public rate: number = 0.12,
    public fixedFee: number = 5.00,
    public threshold: number = 80.00,
    public shippingCost: number = 18.00
  ) {}

  async getFeeRule(_request: MarketplaceFeeRequest): Promise<MarketplaceFeeRule> {
    return {
      percentageRate: this.rate,
      fixedFeeAmount: this.fixedFee,
      fixedFeeThreshold: this.threshold,
      shippingCostToSeller: this.shippingCost,
      mandatoryFreeShipping: true
    };
  }

  async getDynamicFees(request: MarketplaceFeeRequest & { price: number }): Promise<DynamicFeeBreakdown> {
    const { price } = request;
    const isBelow = price < this.threshold;
    const fixedFee = isBelow ? this.fixedFee : 0;
    const shipping = isBelow ? 0 : this.shippingCost;
    const percentageAmount = Number((price * this.rate).toFixed(2));
    const totalRetention = Number((percentageAmount + fixedFee + shipping).toFixed(2));

    return {
      providerName: 'Fake Test Provider',
      ruleVersion: 'fake-v1',
      fetchedAt: new Date().toISOString(),
      isSimulated: true,
      isCached: false,
      percentageRate: this.rate,
      percentageAmount,
      fixedFeeAmount: fixedFee,
      fixedFeeThreshold: this.threshold,
      shippingCostToSeller: shipping,
      mandatoryFreeShipping: !isBelow,
      totalMarketplaceRetention: totalRetention
    };
  }
}

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err?.message || err}`);
    process.exitCode = 1;
  }
}

async function runAll() {
  console.log('\n======================================================');
  console.log('   SUITE DE TESTES UNITÁRIOS - FASE 2 REVISADA');
  console.log('======================================================\n');

  console.log('📦 1. Testes de Validação EAN/GTIN e Tratamento de Produto sem GTIN:');

  await runTest('Valida EAN-13 autêntico com dígito correto (Coca-Cola 7894900011517)', () => {
    const r = validateEan('7894900011517');
    assert.strictEqual(r.valid, true);
    assert.strictEqual(r.format, 'EAN-13');
    assert.strictEqual(r.actualCheckDigit, 7);
  });

  await runTest('Valida EAN-13 autêntico com dígito correto (Havaianas 7891224000012)', () => {
    const r = validateEan('7891224000012');
    assert.strictEqual(r.valid, true);
    assert.strictEqual(r.actualCheckDigit, 2);
  });

  await runTest('Rejeita EAN-13 com dígito verificador adulterado (7894900011518)', () => {
    const r = validateEan('7894900011518');
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.actualCheckDigit, 8);
    assert.strictEqual(r.expectedCheckDigit, 7);
  });

  await runTest('Permite campo vazio como "Produto sem GTIN informado" (missing legítimo)', () => {
    const rEmpty = validateEan('');
    assert.strictEqual(rEmpty.valid, true);
    assert.strictEqual(rEmpty.isMissing, true);
    assert.strictEqual(rEmpty.message, 'Produto sem GTIN informado.');

    const rSpaces = validateEan('   ');
    assert.strictEqual(rSpaces.valid, true);
    assert.strictEqual(rSpaces.isMissing, true);
  });

  await runTest('Rejeita EAN com comprimento inválido ou caracteres alfabéticos', () => {
    const rShort = validateEan('12345');
    assert.strictEqual(rShort.valid, false);
    assert.strictEqual(rShort.format, 'INVALID');

    const rLetters = validateEan('789ABC0011517');
    assert.strictEqual(rLetters.valid, false);
  });

  await runTest('Utilitário de Teste: gera checksum de 13 dígitos para mocks internos', () => {
    const generated = generateTestEan13Checksum('789123456789');
    assert.strictEqual(generated.length, 13);
    const check = validateEan(generated);
    assert.strictEqual(check.valid, true);
  });

  console.log('\n💰 2. Testes de Precificação Determinística com Provider Fake Controlado:');

  // Criamos um provider fake com taxas totalmente controladas:
  // Alíquota = 10%, Taxa Fixa = R$ 4,00 para preços < R$ 60,00, Frete = R$ 15,00 para preços >= R$ 60,00
  const fakeProvider = new FakeControlledFeeProvider(0.10, 4.00, 60.00, 15.00);

  await runTest('Precificação Direta em faixa abaixo do limiar (com taxa fixa fake)', async () => {
    // Preço Venda: R$ 40,00
    // Custo CMV: R$ 10,00
    // Embalagem: R$ 2,00
    // Imposto (5%): R$ 2,00
    // Comissão (10%): R$ 4,00
    // Taxa Fixa (< 60): R$ 4,00
    // Frete (< 60): R$ 0,00
    // Total Deduções = 10 + 2 + 2 + 4 + 4 = R$ 22,00
    // Lucro Líquido = 40 - 22 = R$ 18,00
    // Margem = (18 / 40) * 100 = 45.00%
    const res = await calculateDirectPricing(
      {
        costPrice: 10.00,
        freeSalePrice: 40.00,
        taxRatePercent: 5.0,
        packagingCost: 2.00,
        otherOperationalCost: 0,
        listingType: 'gold_special',
        categoryId: 'FAKE_CAT',
        packageWeightKg: 0.5,
        mode: 'free_price'
      },
      fakeProvider
    );

    assert.strictEqual(res.salePrice, 40.00);
    assert.strictEqual(res.marketplaceFees.fixedFeeAmount, 4.00);
    assert.strictEqual(res.marketplaceFees.percentageAmount, 4.00);
    assert.strictEqual(res.marketplaceFees.shippingCostToSeller, 0.00);
    assert.strictEqual(res.taxAmount, 2.00);
    assert.strictEqual(res.netProfit, 18.00);
    assert.strictEqual(res.netMarginPercent, 45.00);
  });

  await runTest('Precificação Direta em faixa acima do limiar (sem taxa fixa, com frete fake)', async () => {
    // Preço Venda: R$ 100,00
    // Custo CMV: R$ 30,00
    // Embalagem: R$ 2,00
    // Imposto (5%): R$ 5,00
    // Comissão (10%): R$ 10,00
    // Taxa Fixa (>= 60): R$ 0,00
    // Frete (>= 60): R$ 15,00
    // Total Deduções = 30 + 2 + 5 + 10 + 15 = R$ 62,00
    // Lucro Líquido = 100 - 62 = R$ 38,00
    // Margem = (38 / 100) * 100 = 38.00%
    const res = await calculateDirectPricing(
      {
        costPrice: 30.00,
        freeSalePrice: 100.00,
        taxRatePercent: 5.0,
        packagingCost: 2.00,
        otherOperationalCost: 0,
        listingType: 'gold_special',
        categoryId: 'FAKE_CAT',
        packageWeightKg: 0.5,
        mode: 'free_price'
      },
      fakeProvider
    );

    assert.strictEqual(res.salePrice, 100.00);
    assert.strictEqual(res.marketplaceFees.fixedFeeAmount, 0.00);
    assert.strictEqual(res.marketplaceFees.percentageAmount, 10.00);
    assert.strictEqual(res.marketplaceFees.shippingCostToSeller, 15.00);
    assert.strictEqual(res.taxAmount, 5.00);
    assert.strictEqual(res.netProfit, 38.00);
    assert.strictEqual(res.netMarginPercent, 38.00);
  });

  console.log('\n🎯 3. Testes de Precificação Reversa (Margem Alvo com Provider Fake):');

  await runTest('Modo Reverso: Encontra Preço ideal para Margem Líquida de 25% exatamente', async () => {
    // Alvo: m = 25% (0.25)
    // Imposto: t = 5% (0.05)
    // Comissão: r = 10% (0.10)
    // Custo Base: 20 + 2 = 22.00
    // Denominador = 1 - 0.25 - 0.05 - 0.10 = 0.60
    // Se abaixo de 60: (22 + 4) / 0.60 = 26 / 0.60 = 43.33 (< 60.00, estabiliza aqui!)
    const rev = await calculateReversePricing(
      {
        costPrice: 20.00,
        targetMarginPercent: 25.0,
        taxRatePercent: 5.0,
        packagingCost: 2.00,
        otherOperationalCost: 0,
        listingType: 'gold_special',
        categoryId: 'FAKE_CAT',
        packageWeightKg: 0.5,
        mode: 'target_margin'
      },
      fakeProvider
    );

    assert.strictEqual(rev.salePrice, 43.33);
    assert.ok(Math.abs(rev.netMarginPercent - 25.0) < 0.1, `Margem calculada ${rev.netMarginPercent}% deve ser ~25%`);
    assert.ok(rev.netProfit > 0, 'Lucro líquido deve ser positivo');
  });

  console.log('\n⚖️ 4. Testes de Ponto de Equilíbrio (Break-Even com Provider Fake):');

  await runTest('Break-Even: Lucro Líquido é zero no preço de equilíbrio calculado', async () => {
    const breakEven = await calculateBreakEvenPrice(
      {
        costPrice: 20.00,
        taxRatePercent: 5.0,
        packagingCost: 2.00,
        otherOperationalCost: 0,
        listingType: 'gold_special',
        categoryId: 'FAKE_CAT',
        packageWeightKg: 0.5,
        mode: 'free_price'
      },
      fakeProvider
    );

    assert.ok(breakEven > 20.00, 'Preço de equilíbrio deve ser maior que o CMV');

    const verify = await calculateDirectPricing(
      {
        costPrice: 20.00,
        freeSalePrice: breakEven,
        taxRatePercent: 5.0,
        packagingCost: 2.00,
        otherOperationalCost: 0,
        listingType: 'gold_special',
        categoryId: 'FAKE_CAT',
        packageWeightKg: 0.5,
        mode: 'free_price'
      },
      fakeProvider
    );

    assert.ok(Math.abs(verify.netProfit) <= 0.10, `Lucro no break-even (${verify.netProfit}) deve ser ~0.00`);
  });

  console.log('\n🎯 5. Testes do Solver Reverso target_profit (Fase 4D.1):');

  // Helper para inputs base de target_profit
  const baseProfitInputs = {
    costPrice: 20.00,
    targetProfitAmount: 15.00,
    taxRatePercent: 5.0,
    packagingCost: 2.00,
    otherOperationalCost: 0,
    listingType: 'gold_special' as const,
    categoryId: 'FAKE_CAT',
    packageWeightKg: 0.5,
    mode: 'target_profit' as const
  };

  // 5.1 target_profit simples
  await runTest('5.1 target_profit simples: encontra preço que atinge lucro alvo desejado', async () => {
    const res = await solvePriceForTargetProfit(baseProfitInputs, fakeProvider);
    assert.strictEqual(res.costPrice, 20.00);
    assert.ok(res.netProfit >= 15.00, `Lucro ${res.netProfit} deve ser >= 15.00`);
    assert.ok(Math.abs(res.salePrice - 48.24) <= 0.05, `Preço ${res.salePrice} deve ser ~48.24`);
  });

  // 5.2 custo ausente bloqueia cálculo
  await runTest('5.2 custo ausente bloqueia cálculo: rejeita costPrice null ou undefined', async () => {
    const nullCost = { ...baseProfitInputs, costPrice: null };
    await assert.rejects(
      () => solvePriceForTargetProfit(nullCost as any, fakeProvider),
      /Custo de aquisição.*ausente/
    );

    const undefCost = { ...baseProfitInputs, costPrice: undefined };
    await assert.rejects(
      () => solvePriceForTargetProfit(undefCost as any, fakeProvider),
      /Custo de aquisição.*ausente/
    );
  });

  // 5.3 custo zero explícito é permitido
  await runTest('5.3 custo zero explícito é permitido: costPrice = 0 é válido e calcula preço correto', async () => {
    const zeroCost = { ...baseProfitInputs, costPrice: 0, targetProfitAmount: 10.00 };
    const res = await solvePriceForTargetProfit(zeroCost, fakeProvider);
    assert.strictEqual(res.costPrice, 0);
    assert.ok(res.netProfit >= 10.00);
    assert.ok(res.salePrice > 0);
    assert.strictEqual(res.consideredDeductions.costPrice, true);
  });

  // 5.4 impostos considerados
  await runTest('5.4 impostos: alíquota maior eleva o preço de venda para manter mesmo lucro líquido', async () => {
    const resTax5 = await solvePriceForTargetProfit({ ...baseProfitInputs, taxRatePercent: 5.0 }, fakeProvider);
    const resTax15 = await solvePriceForTargetProfit({ ...baseProfitInputs, taxRatePercent: 15.0 }, fakeProvider);

    assert.ok(resTax15.salePrice > resTax5.salePrice, 'Preço com imposto 15% deve ser maior que com 5%');
    assert.strictEqual(resTax15.consideredDeductions.tax, true);
    assert.ok(resTax15.taxAmount > resTax5.taxAmount);
  });

  // 5.5 embalagem considerada
  await runTest('5.5 embalagem: custo de embalagem aumenta o preço final e é registrado nas deduções', async () => {
    const resPkg0 = await solvePriceForTargetProfit({ ...baseProfitInputs, packagingCost: 0 }, fakeProvider);
    const resPkg6 = await solvePriceForTargetProfit({ ...baseProfitInputs, packagingCost: 6.00 }, fakeProvider);

    assert.ok(resPkg6.salePrice > resPkg0.salePrice);
    assert.strictEqual(resPkg6.packagingCost, 6.00);
    assert.strictEqual(resPkg6.consideredDeductions.packaging, true);
  });

  // 5.6 otherOperationalCost
  await runTest('5.6 otherOperationalCost: custos operacionais adicionais são considerados e auditados', async () => {
    const res = await solvePriceForTargetProfit({ ...baseProfitInputs, otherOperationalCost: 4.50 }, fakeProvider);
    assert.strictEqual(res.otherOperationalCost, 4.50);
    assert.strictEqual(res.consideredDeductions.otherOperational, true);
    assert.ok(res.netProfit >= 15.00);
  });

  // 5.7 publicidade configurada
  await runTest('5.7 publicidade configurada: deduz taxa de publicidade e registra no output', async () => {
    const resWithAd = await solvePriceForTargetProfit(
      { ...baseProfitInputs, advertisingRatePercent: 10.0 },
      fakeProvider
    );

    assert.strictEqual(resWithAd.advertisingRatePercent, 10.0);
    assert.strictEqual(resWithAd.consideredDeductions.advertising, true);
    assert.ok(resWithAd.advertisingAmount! > 0);
    assert.ok(resWithAd.netProfit >= 15.00);
  });

  // 5.8 publicidade não configurada não é inventada
  await runTest('5.8 publicidade não configurada: não inventa deduções e marca como não considerada', async () => {
    const resNoAd = await solvePriceForTargetProfit(
      { ...baseProfitInputs, advertisingRatePercent: undefined },
      fakeProvider
    );

    assert.strictEqual(resNoAd.advertisingRatePercent, undefined);
    assert.strictEqual(resNoAd.advertisingAmount, undefined);
    assert.strictEqual(resNoAd.consideredDeductions.advertising, false);
  });

  // 5.9 provider simulado preserva isSimulated
  await runTest('5.9 provider simulado: solver preserva isSimulated e metadados do provedor na saída', async () => {
    const res = await solvePriceForTargetProfit(baseProfitInputs, defaultMlFeeProvider);
    assert.strictEqual(res.isSimulated, true);
    assert.strictEqual(res.marketplaceFees.isSimulated, true);
    assert.ok(res.providerId);
    assert.ok(res.marketplaceFees.providerName);
  });

  // 5.10 descontinuidade do mock provider
  await runTest('5.10 descontinuidade: mock provider com limiar de R$ 79 e salto de frete é resolvido com precisão', async () => {
    const mockProvider = new MockMercadoLivreFeeProvider(79.00, 6.50);

    // Meta alcançável abaixo de R$ 79: deve encontrar o menor preço no regime inferior (< 79)
    const resBelow = await solvePriceForTargetProfit(
      { ...baseProfitInputs, costPrice: 15.00, targetProfitAmount: 10.00 },
      mockProvider
    );
    assert.ok(resBelow.salePrice < 79.00, `Preço ${resBelow.salePrice} deveria estar abaixo de 79.00`);
    assert.ok(resBelow.netProfit >= 10.00);

    // Meta alta inalcançável abaixo de R$ 79: solver deve transicionar e resolver no regime superior (>= 79)
    const resAbove = await solvePriceForTargetProfit(
      { ...baseProfitInputs, costPrice: 30.00, targetProfitAmount: 35.00 },
      mockProvider
    );
    assert.ok(resAbove.salePrice >= 79.00, `Preço ${resAbove.salePrice} deveria estar acima de 79.00`);
    assert.ok(resAbove.netProfit >= 35.00);
  });

  // 5.11 menor preço válido em centavos
  await runTest('5.11 menor preço válido em centavos: 1 centavo abaixo da solução não atinge a meta', async () => {
    const res = await solvePriceForTargetProfit(baseProfitInputs, fakeProvider);
    const candidateCents = Math.round(res.salePrice * 100);

    // Avalia o preço 1 centavo abaixo
    const oneCentBelow = (candidateCents - 1) / 100;
    const directBelow = await calculateDirectPricing(
      { ...baseProfitInputs, freeSalePrice: oneCentBelow, mode: 'free_price' },
      fakeProvider
    );

    assert.ok(
      directBelow.netProfit < baseProfitInputs.targetProfitAmount,
      `1 centavo abaixo (${oneCentBelow}) deveria ter lucro (${directBelow.netProfit}) < meta (15.00)`
    );
    assert.ok(res.netProfit >= baseProfitInputs.targetProfitAmount);
  });

  // 5.12 meta inviável
  await runTest('5.12 meta inviável: meta excessiva que ultrapassa o teto resulta em erro semântico', async () => {
    const impossible = { ...baseProfitInputs, targetProfitAmount: 999_999.00 };
    await assert.rejects(
      () => solvePriceForTargetProfit(impossible, fakeProvider, { maxPrice: 1000.00 }),
      /Meta de lucro.*inviável/
    );
  });

  // 5.13 teto excedido
  await runTest('5.13 teto excedido: piso mínimo calculado excede maxPrice configurado', async () => {
    await assert.rejects(
      () => solvePriceForTargetProfit(baseProfitInputs, fakeProvider, { maxPrice: 30.00 }),
      /inviável.*preço teto/
    );
  });

  // 5.14 limite de avaliações
  await runTest('5.14 limite de avaliações: estouro do orçamento de iterações lança erro controlado', async () => {
    await assert.rejects(
      () => solvePriceForTargetProfit(baseProfitInputs, fakeProvider, { maxEvaluations: 2 }),
      /Limite máximo de avaliações.*excedido/
    );
  });

  // 5.15 provider devolvendo NaN/Infinity
  await runTest('5.15 feeProvider inválido: retenção NaN ou Infinity falha fechado (fail-closed)', async () => {
    const nanFeeProvider: IMarketplaceFeeProvider = {
      providerId: 'nan-provider',
      isSimulated: true,
      async getFeeRule(_req) {
        return { percentageRate: 0.1, fixedFeeAmount: 0, fixedFeeThreshold: 0, shippingCostToSeller: 0, mandatoryFreeShipping: false };
      },
      async getDynamicFees(_req) {
        return {
          providerName: 'NaN Provider',
          ruleVersion: 'nan',
          fetchedAt: new Date().toISOString(),
          isSimulated: true,
          isCached: false,
          percentageRate: 0.1,
          percentageAmount: 1,
          fixedFeeAmount: 0,
          fixedFeeThreshold: 0,
          shippingCostToSeller: 0,
          mandatoryFreeShipping: false,
          totalMarketplaceRetention: NaN // ERRO INDUZIDO
        };
      }
    };

    await assert.rejects(
      () => solvePriceForTargetProfit(baseProfitInputs, nanFeeProvider),
      /FeeProvider retornou retenção tarifária inválida/
    );
  });

  // 5.16 provider artificial não monotônico -> fail-closed
  await runTest('5.16 provider não-monotônico: comportamento oscilante/incompatível resulta em fail-closed semântico', async () => {
    // Provedor com múltiplas quedas erráticas de lucro
    const erraticProvider: IMarketplaceFeeProvider = {
      providerId: 'erratic-provider',
      isSimulated: true,
      async getFeeRule(_req) {
        return { percentageRate: 0.1, fixedFeeAmount: 0, fixedFeeThreshold: 0, shippingCostToSeller: 0, mandatoryFreeShipping: false };
      },
      async getDynamicFees(req) {
        const p = req.price;
        // Oscilação arbitrária e não monotônica: tarifa oscila a cada preço inteiro
        const retention = (Math.round(p) % 2 === 0) ? 50.0 : 0.0;

        return {
          providerName: 'Erratic Provider',
          ruleVersion: 'erratic',
          fetchedAt: new Date().toISOString(),
          isSimulated: true,
          isCached: false,
          percentageRate: 0.1,
          percentageAmount: 0,
          fixedFeeAmount: 0,
          fixedFeeThreshold: 0,
          shippingCostToSeller: 0,
          mandatoryFreeShipping: false,
          totalMarketplaceRetention: retention
        };
      }
    };

    await assert.rejects(
      () => solvePriceForTargetProfit(baseProfitInputs, erraticProvider),
      /Comportamento não monotônico do feeProvider detectado/
    );
  });

  console.log('\n🛡️ 6. Testes de Guard de Custo na UI / StepPricing (Fase 4D.1 - Compatibilidade Schema v3):');

  // 6.1 costPrice missing + null -> cálculo bloqueado
  await runTest('6.1 costPrice missing + null: cálculo bloqueado (isCostPriceComputable = false)', () => {
    const missingNullField = createAuditedField<number | null>(null, 'user_manual', 0.0, 'missing');
    assert.strictEqual(isCostPriceComputable(missingNullField), false);
  });

  // 6.2 costPrice approved + 0 -> cálculo permitido
  await runTest('6.2 costPrice approved + 0: cálculo permitido para zero explícito (isCostPriceComputable = true)', () => {
    const approvedZeroField = createAuditedField<number | null>(0, 'bling_erp', 1.0, 'approved');
    assert.strictEqual(isCostPriceComputable(approvedZeroField), true);
  });

  // 6.3 costPrice pending_review + 0 -> cálculo permitido
  await runTest('6.3 costPrice pending_review + 0: cálculo permitido para zero em revisão (isCostPriceComputable = true)', () => {
    const pendingZeroField = createAuditedField<number | null>(0, 'bling_erp', 0.8, 'pending_review');
    assert.strictEqual(isCostPriceComputable(pendingZeroField), true);
  });

  // 6.4 custo positivo -> comportamento atual preservado
  await runTest('6.4 custo positivo: cálculo permitido para valores normais (isCostPriceComputable = true)', () => {
    const positiveField = createAuditedField<number | null>(45.90, 'user_manual', 1.0, 'approved');
    assert.strictEqual(isCostPriceComputable(positiveField), true);
  });

  // 6.5 nenhuma coerção null -> 0
  await runTest('6.5 nenhuma coerção null -> 0: ausência de custo bloqueia e não é transformada em 0', () => {
    const missingZeroField = createAuditedField<number | null>(0, 'user_manual', 0.0, 'missing');
    // Mesmo se o valor legado for 0 com status missing, a semântica de missing bloqueia
    assert.strictEqual(isCostPriceComputable(missingZeroField), false);

    // null direto ou undefined bloqueia
    assert.strictEqual(isCostPriceComputable(null), false);
    assert.strictEqual(isCostPriceComputable(undefined), false);

    // Objeto malformado com NaN ou negativo bloqueia
    const nanField = createAuditedField<number | null>(NaN, 'user_manual', 1.0, 'approved');
    assert.strictEqual(isCostPriceComputable(nanField), false);

    const negativeField = createAuditedField<number | null>(-15, 'user_manual', 1.0, 'approved');
    assert.strictEqual(isCostPriceComputable(negativeField), false);
  });

  console.log('\n======================================================');
  console.log(process.exitCode ? '❌ ALGUNS TESTES FALHARAM' : '✅ TODOS OS TESTES PASSARAM COM SUCESSO!');
  console.log('======================================================\n');
}

export { runAll as runPricingTests };

if (process.argv[1]?.includes('pricing-and-ean.test')) {
  runAll();
}
