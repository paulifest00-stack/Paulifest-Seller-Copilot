// Provedor Dinâmico de Taxas do Marketplace (MarketplaceFeeProvider)
import type { 
  DynamicFeeBreakdown, 
  ListingType, 
  MarketplaceFeeRule 
} from '../../schema/pricing.ts';

export interface MarketplaceFeeRequest {
  marketplace: 'mercadolivre' | 'shopee' | 'amazon';
  categoryId: string;
  listingType: ListingType;
  price?: number;
  packageWeightKg?: number;
  shippingMode?: string;
  logisticType?: string;
}

export interface IMarketplaceFeeProvider {
  readonly providerId: string;
  readonly isSimulated: boolean;

  /**
   * Obtém o detalhamento de taxas para um preço de venda específico.
   */
  getDynamicFees(request: MarketplaceFeeRequest & { price: number }): Promise<DynamicFeeBreakdown>;

  /**
   * Obtém a estrutura tarifária (alíquota, taxa fixa, limiares, frete) para a categoria/logística.
   * Usado pelo motor para resolver algebricamente o preço reverso e break-even sem regras chumbadas.
   */
  getFeeRule(request: MarketplaceFeeRequest): Promise<MarketplaceFeeRule>;
}

// ---------------------------------------------------------------------------
// FIXTURES / MOCKS PARA TESTES E DESENVOLVIMENTO LOCAL OFFLINE
// ---------------------------------------------------------------------------

/**
 * Fixture de frete simulado por faixas de peso (apenas para testes / mock).
 * NÃO constitui tabela oficial nem estática de produção.
 */
export function getMockShippingCost(weightKg: number = 0.5): number {
  if (weightKg <= 0.5) return 20.90;
  if (weightKg <= 1.0) return 23.90;
  if (weightKg <= 2.0) return 25.90;
  if (weightKg <= 5.0) return 33.90;
  if (weightKg <= 9.0) return 49.90;
  return 69.90;
}

/**
 * Fixture de alíquotas simuladas por categoria (apenas para testes / mock).
 */
export const MOCK_CATEGORY_RATES: Record<string, { classic: number; premium: number }> = {
  'MLB1051': { classic: 0.12, premium: 0.17 }, // Ferramentas
  'MLB1000': { classic: 0.13, premium: 0.18 }, // Eletrônicos
  'MLB1430': { classic: 0.14, premium: 0.19 }, // Roupas e Calçados
  'DEFAULT': { classic: 0.13, premium: 0.18 }
};

/**
 * Provedor Simulado (MockMercadoLivreFeeProvider)
 * Usado exclusivamente em testes e como fallback de simulação visual offline.
 * NENHUM valor aqui deve ser tratado como taxa oficial fixa de produção.
 */
export class MockMercadoLivreFeeProvider implements IMarketplaceFeeProvider {
  readonly providerId = 'mock-mercadolivre';
  readonly isSimulated = true;
  private cache: Map<string, DynamicFeeBreakdown> = new Map();

  // Permite configurar parâmetros customizados para testes
  constructor(
    private customThreshold: number = 79.0,
    private customFixedFee: number = 6.50
  ) {}

  async getFeeRule(request: MarketplaceFeeRequest): Promise<MarketplaceFeeRule> {
    const { categoryId, listingType, packageWeightKg = 0.5 } = request;
    const rates = MOCK_CATEGORY_RATES[categoryId] || MOCK_CATEGORY_RATES['DEFAULT'];
    const rate = listingType === 'gold_pro' ? rates.premium : rates.classic;
    const shippingCost = getMockShippingCost(packageWeightKg);

    return {
      percentageRate: rate,
      fixedFeeAmount: this.customFixedFee,
      fixedFeeThreshold: this.customThreshold,
      shippingCostToSeller: shippingCost,
      mandatoryFreeShipping: true
    };
  }

  async getDynamicFees(request: MarketplaceFeeRequest & { price: number }): Promise<DynamicFeeBreakdown> {
    const { categoryId, listingType, price, packageWeightKg = 0.5 } = request;
    const cacheKey = `${categoryId}_${listingType}_${price}_${packageWeightKg}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, isCached: true };
    }

    const rule = await this.getFeeRule(request);
    const isBelowThreshold = rule.fixedFeeThreshold > 0 && price < rule.fixedFeeThreshold;

    const fixedFee = isBelowThreshold && price > 0 ? rule.fixedFeeAmount : 0.0;
    const mandatoryFreeShipping = !isBelowThreshold && price > 0;
    const shippingCost = mandatoryFreeShipping ? rule.shippingCostToSeller : 0.0;
    const percentageAmount = Number((price * rule.percentageRate).toFixed(2));
    const totalRetention = Number((percentageAmount + fixedFee + shippingCost).toFixed(2));

    const result: DynamicFeeBreakdown = {
      providerName: 'Simulação Local ML (Mock / Fixture)',
      ruleVersion: 'mock-simulation-v1',
      fetchedAt: new Date().toISOString(),
      isSimulated: true,
      isCached: false,
      percentageRate: rule.percentageRate,
      percentageAmount,
      fixedFeeAmount: fixedFee,
      fixedFeeThreshold: rule.fixedFeeThreshold,
      shippingCostToSeller: shippingCost,
      mandatoryFreeShipping,
      totalMarketplaceRetention: totalRetention
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}

// ---------------------------------------------------------------------------
// PROVEDOR REAL DE PRODUÇÃO (MercadoLivreFeeProvider)
// ---------------------------------------------------------------------------

/**
 * Provedor Oficial para a API do Mercado Livre.
 * Na Fase 2 (antes da autenticação OAuth2 do usuário), delega para o simulador local
 * identificando explicitamente os dados como simulação (isSimulated = true).
 * Na Fase 3+, consumirá diretamente os endpoints oficiais de listing_prices e shipping_options.
 */
export class MercadoLivreFeeProvider implements IMarketplaceFeeProvider {
  readonly providerId = 'mercadolivre-live';
  private mockFallback: MockMercadoLivreFeeProvider;
  private accessToken?: string;

  constructor(accessToken?: string) {
    this.accessToken = accessToken;
    this.mockFallback = new MockMercadoLivreFeeProvider();
  }

  get isSimulated(): boolean {
    return !this.accessToken;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  async getFeeRule(request: MarketplaceFeeRequest): Promise<MarketplaceFeeRule> {
    if (!this.accessToken) {
      // Sem credencial OAuth2 conectada: utiliza estimativa simulada
      return this.mockFallback.getFeeRule(request);
    }

    // TODO: Na Fase 3 / Integrações, efetuar chamada real a /sites/MLB/listing_prices
    return this.mockFallback.getFeeRule(request);
  }

  async getDynamicFees(request: MarketplaceFeeRequest & { price: number }): Promise<DynamicFeeBreakdown> {
    if (!this.accessToken) {
      // Sem credencial conectada: retorna estimativa simulada identificada
      const sim = await this.mockFallback.getDynamicFees(request);
      return {
        ...sim,
        providerName: 'Mercado Livre (Estimativa Simulação)'
      };
    }

    // TODO: Na Fase 3, chamar API oficial do ML para precificação com shipping_mode e billable_weight reais
    const live = await this.mockFallback.getDynamicFees(request);
    return {
      ...live,
      providerName: 'Mercado Livre API Oficial'
    };
  }
}

export const defaultMlFeeProvider = new MercadoLivreFeeProvider();
