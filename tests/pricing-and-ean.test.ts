// Testes Unitários: Validação de EAN-13 e Motor de Precificação Determinístico
import assert from 'node:assert';
import { validateEan, generateTestEan13Checksum } from '../src/core/engines/identification/ean-validator.ts';
import { 
  calculateDirectPricing, 
  calculateReversePricing, 
  calculateBreakEvenPrice 
} from '../src/core/engines/pricing-calculator/pricing-calculator.ts';
import type { 
  IMarketplaceFeeProvider, 
  MarketplaceFeeRequest 
} from '../src/core/engines/pricing-calculator/fee-provider.ts';
import type { 
  DynamicFeeBreakdown, 
  MarketplaceFeeRule 
} from '../src/core/schema/pricing.ts';

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

  console.log('\n======================================================');
  console.log(process.exitCode ? '❌ ALGUNS TESTES FALHARAM' : '✅ TODOS OS TESTES PASSARAM COM SUCESSO!');
  console.log('======================================================\n');
}

export { runAll as runPricingTests };

if (process.argv[1]?.includes('pricing-and-ean.test')) {
  runAll();
}

