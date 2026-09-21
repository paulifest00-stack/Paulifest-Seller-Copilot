// Tipos e Modelos do Motor de Precificação Determinístico

export type ListingType = 'gold_special' | 'gold_pro'; // Clássico vs Premium

export type PricingMode = 'free_price' | 'target_margin' | 'target_profit';

export interface ConsideredDeductions {
  costPrice: boolean;
  tax: boolean;
  packaging: boolean;
  otherOperational: boolean;
  advertising: boolean;
}

export interface PricingInputs {
  costPrice: number | null;            // Custo de Aquisição (CMV) em R$ (null se missing)
  taxRatePercent: number;              // Alíquota fiscal do vendedor em % (ex: 6 para 6%)
  packagingCost: number;               // Custo de embalagem e insumos em R$
  otherOperationalCost: number;        // Outros custos operacionais em R$
  listingType: ListingType;            // Clássico ou Premium
  categoryId: string;                  // Categoria do ML
  packageWeightKg: number;             // Peso para cálculo de frete
  shippingMode?: string;               // Modo de envio (ex: me2, custom)
  logisticType?: string;               // Tipo de logística (ex: fulfillment, cross_docking, drop_off)

  // Modo de Cálculo
  mode: PricingMode;
  freeSalePrice?: number;              // Utilizado quando mode === 'free_price'
  targetMarginPercent?: number;        // Utilizado quando mode === 'target_margin' (ex: 20 para 20%)
  targetProfitAmount?: number;         // Utilizado quando mode === 'target_profit' em R$
  advertisingRatePercent?: number;     // Utilizado quando publicidade/ACOS estiver configurada em % (opcional)
}

/**
 * Regra tarifária fornecida dinamicamente pelo FeeProvider para uma categoria/logística.
 * Não fixa regras no motor de cálculo.
 */
export interface MarketplaceFeeRule {
  percentageRate: number;        // Alíquota percentual do canal (ex: 0.12 para 12%)
  fixedFeeAmount: number;        // Taxa fixa por unidade (se houver, ex: 6.50 ou 0)
  fixedFeeThreshold: number;     // Limiar até onde incide taxa fixa (se houver, ex: 79.0 ou 0)
  shippingCostToSeller: number;  // Custo de frete do vendedor (se houver)
  mandatoryFreeShipping: boolean;// Se frete grátis obrigatório
}

export interface DynamicFeeBreakdown {
  providerName: string;
  ruleVersion: string;
  fetchedAt: string;
  isSimulated: boolean;          // Indica se é simulação/mock ou cotação de API real conectada
  isCached: boolean;
  percentageRate: number;        // Alíquota da categoria (ex: 0.12 para 12%)
  percentageAmount: number;      // Retenção percentual em R$
  fixedFeeAmount: number;        // Taxa fixa em R$ (se aplicável ao preço)
  fixedFeeThreshold: number;     // Limiar de corte para taxa fixa (se houver)
  shippingCostToSeller: number;  // Frete atribuído ao vendedor (se aplicável ao preço)
  mandatoryFreeShipping: boolean;// Frete grátis obrigatório
  totalMarketplaceRetention: number; // Total retido pelo canal
}

export interface PricingOutputs {
  salePrice: number;             // Preço de venda calculado ou digitado
  costPrice: number;             // CMV (valor numérico efetivo utilizado)
  taxAmount: number;             // Imposto a pagar em R$
  taxRatePercent: number;        // Alíquota em %
  packagingCost: number;         // Embalagem em R$
  otherOperationalCost: number;  // Outros custos operacionais em R$
  advertisingAmount?: number;    // Valor de publicidade deduzido em R$ (se configurado)
  advertisingRatePercent?: number;// Alíquota de publicidade considerada em % (se configurado)
  consideredDeductions: ConsideredDeductions; // Trilha auditável dos componentes financeiros considerados
  marketplaceFees: DynamicFeeBreakdown; // Detalhamento de taxas do canal
  netProfit: number;             // Lucro líquido em R$
  netMarginPercent: number;      // Margem líquida real em %
  breakEvenPrice: number;        // Preço mínimo onde lucro líquido = R$ 0,00
  listingType: ListingType;      // Modalidade
  providerId: string;            // Identificador do fee provider
  isSimulated: boolean;          // Preserva identificação de simulação
  targetProfitAmount?: number;   // Meta de lucro em R$ quando mode === 'target_profit'
  mode?: PricingMode;            // Modo utilizado
  evaluationCount?: number;      // Quantidade de avaliações do solver (se aplicável)
}
