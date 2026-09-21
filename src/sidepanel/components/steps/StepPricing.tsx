import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  Percent,
  ShieldAlert,
  Truck,
  Receipt,
  ArrowLeft,
  Save,
  Check,
  Sliders,
  ChevronDown,
  ChevronUp,
  Package
} from 'lucide-react';
import type { CentralProductSheet, AuditedField } from '../../../core/schema/product.ts';
import { createAuditedField } from '../../../core/schema/product.ts';
import type { ListingType, PricingInputs, PricingOutputs } from '../../../core/schema/pricing.ts';
import {
  calculateDirectPricing,
  calculateReversePricing
} from '../../../core/engines/pricing-calculator/pricing-calculator.ts';
import {
  loadSellerPreferences,
  saveSellerPreferences
} from '../../../core/storage/storage.ts';

interface StepPricingProps {
  sheet: CentralProductSheet;
  onUpdateSheet: (updater: (prev: CentralProductSheet) => CentralProductSheet) => void;
  onPrev: () => void;
  onFinish?: () => void;
}

/**
 * Validador estrito de computabilidade de preço de custo para a UI:
 * - Ausente (missing ou value === null) -> bloqueia cálculo (retorna false)
 * - Zero explícito (status approved ou pending_review com value === 0) -> cálculo permitido (retorna true)
 * - Custo positivo numérico -> cálculo permitido (retorna true)
 * - Não faz coerção sintética de null para 0
 */
export function isCostPriceComputable(
  costPrice?: AuditedField<number | null> | null
): boolean {
  if (!costPrice) return false;
  if (costPrice.status === 'missing') return false;
  if (costPrice.value === null || costPrice.value === undefined) return false;
  if (typeof costPrice.value !== 'number' || isNaN(costPrice.value)) return false;
  return costPrice.value >= 0;
}

export const StepPricing: React.FC<StepPricingProps> = ({
  sheet,
  onUpdateSheet,
  onPrev,
  onFinish
}) => {
  const isCostComputable = isCostPriceComputable(sheet.costPrice);

  // Configurações do Vendedor
  const [mode, setMode] = useState<'target_margin' | 'free_price'>('target_margin');
  const [listingType, setListingType] = useState<ListingType>('gold_special');
  const [targetMargin, setTargetMargin] = useState<number>(20);
  const initialSuggestedPrice = typeof sheet.suggestedSalePrice?.value === 'number' && sheet.suggestedSalePrice.value > 0
    ? sheet.suggestedSalePrice.value
    : 0;
  const [freePrice, setFreePrice] = useState<number>(initialSuggestedPrice);
  const [taxRate, setTaxRate] = useState<number>(6.0);
  const [packagingCost, setPackagingCost] = useState<number>(2.50);
  const otherCost = 0;

  // Estado dos Cálculos
  const [outputs, setOutputs] = useState<PricingOutputs | null>(null);
  const [showFeeDetails, setShowFeeDetails] = useState<boolean>(true);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  // Carrega preferências do vendedor no mount
  useEffect(() => {
    loadSellerPreferences().then((prefs) => {
      setTaxRate(prefs.defaultTaxRatePercent);
      setPackagingCost(prefs.defaultPackagingCost);
      setTargetMargin(prefs.defaultTargetMarginPercent);
      setListingType(prefs.defaultListingType);
    });
  }, []);

  // Recalcula dinamicamente sempre que qualquer variável mudar
  useEffect(() => {
    if (!isCostComputable) {
      setOutputs(null);
      return;
    }

    let isMounted = true;
    const costPrice = sheet.costPrice.value as number;

    const inputs: PricingInputs = {
      costPrice,
      taxRatePercent: taxRate,
      packagingCost,
      otherOperationalCost: otherCost,
      listingType,
      categoryId: sheet.categoryIdML.value || 'MLB1051',
      packageWeightKg: typeof sheet.packageWeightKg?.value === 'number' && sheet.packageWeightKg.value > 0 ? sheet.packageWeightKg.value : 0.5,
      mode,
      freeSalePrice: freePrice,
      targetMarginPercent: targetMargin
    };

    const runCalc = async () => {
      try {
        let res: PricingOutputs;
        if (mode === 'target_margin') {
          res = await calculateReversePricing(inputs);
        } else {
          res = await calculateDirectPricing(inputs);
        }

        if (isMounted) {
          setOutputs(res);

          // Se estiver em modo reverso, sincroniza o input de preço livre
          if (mode === 'target_margin') {
            setFreePrice(res.salePrice);
          }
        }
      } catch (err) {
        console.error('Erro no cálculo de precificação:', err);
      }
    };

    runCalc();

    return () => {
      isMounted = false;
    };
  }, [
    isCostComputable,
    mode,
    listingType,
    targetMargin,
    freePrice,
    taxRate,
    packagingCost,
    otherCost,
    sheet.costPrice.value,
    sheet.costPrice.status,
    sheet.packageWeightKg.value,
    sheet.categoryIdML.value
  ]);

  // Salva o preço na Ficha Central e as preferências do vendedor
  const handleApplyPrice = () => {
    if (!isCostComputable || !outputs) return;

    onUpdateSheet((prev) => ({
      ...prev,
      suggestedSalePrice: createAuditedField(
        outputs.salePrice,
        'rule_engine',
        1.0,
        'approved'
      )
    }));

    // Salva preferências para próximos produtos
    saveSellerPreferences({
      defaultTaxRatePercent: taxRate,
      defaultPackagingCost: packagingCost,
      defaultTargetMarginPercent: targetMargin,
      defaultListingType: listingType
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);

    if (onFinish) {
      onFinish();
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* 1. Seletor de Modo: Margem Alvo vs. Preço Livre */}
      <div className="apple-glass-card rounded-2xl p-1.5 flex gap-1 bg-black/[0.04]">
        <button
          type="button"
          onClick={() => setMode('target_margin')}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all apple-press-spring ${
            mode === 'target_margin'
              ? 'bg-white text-[#0071e3] shadow-sm'
              : 'text-[#86868b] hover:text-[#1d1d1f]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Margem Alvo (Reverso)</span>
        </button>

        <button
          type="button"
          onClick={() => setMode('free_price')}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all apple-press-spring ${
            mode === 'free_price'
              ? 'bg-white text-[#0071e3] shadow-sm'
              : 'text-[#86868b] hover:text-[#1d1d1f]'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>Preço Livre (Direto)</span>
        </button>
      </div>

      {/* 2. Tipo de Anúncio ML: Clássico vs Premium */}
      <div className="apple-glass-card rounded-2xl p-3 space-y-2">
        <label className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider block">
          Modalidade de Anúncio Mercado Livre
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setListingType('gold_special')}
            className={`p-2.5 rounded-xl border text-left transition-all apple-press-spring ${
              listingType === 'gold_special'
                ? 'bg-blue-50/70 border-[#0071e3] text-[#0071e3] ring-2 ring-[#0071e3]/10'
                : 'bg-white border-black/[0.08] text-[#1d1d1f] hover:border-black/[0.16]'
            }`}
          >
            <div className="text-xs font-bold">Clássico</div>
            <div className="text-[10px] opacity-75">~12% a 14% comissão</div>
          </button>

          <button
            type="button"
            onClick={() => setListingType('gold_pro')}
            className={`p-2.5 rounded-xl border text-left transition-all apple-press-spring ${
              listingType === 'gold_pro'
                ? 'bg-blue-50/70 border-[#0071e3] text-[#0071e3] ring-2 ring-[#0071e3]/10'
                : 'bg-white border-black/[0.08] text-[#1d1d1f] hover:border-black/[0.16]'
            }`}
          >
            <div className="text-xs font-bold">Premium</div>
            <div className="text-[10px] opacity-75">~17% a 19% + 12x s/ juros</div>
          </button>
        </div>
      </div>

      {/* 3. Card de Entrada da Variável Chave (Margem ou Preço) */}
      <div className="apple-glass-card rounded-2xl p-4 space-y-3">
        {mode === 'target_margin' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
                <Percent className="w-3.5 h-3.5 text-[#0071e3]" />
                <span>Margem Líquida Alvo Desejada</span>
              </label>
              <span className="text-xs font-bold text-[#0071e3] font-mono">
                {targetMargin}%
              </span>
            </div>

            <input
              type="range"
              min="5"
              max="50"
              step="1"
              value={targetMargin}
              onChange={(e) => setTargetMargin(Number(e.target.value))}
              className="w-full accent-[#0071e3] cursor-pointer"
            />

            <div className="flex justify-between text-[10px] text-[#86868b] px-0.5">
              <span>5% (Competitivo)</span>
              <span>20% (Padrão)</span>
              <span>35%+ (Alta Margem)</span>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
              <DollarSign className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>Preço de Venda Praticado (R$)</span>
            </label>
            <input
              type="number"
              step="0.10"
              min="1"
              value={freePrice || ''}
              onChange={(e) => setFreePrice(parseFloat(e.target.value) || 0)}
              placeholder="0,00"
              className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-sm font-semibold text-[#1d1d1f] outline-none"
            />
          </div>
        )}
      </div>

      {/* 4. Custos Operacionais e Fiscais */}
      <div className="apple-glass-card rounded-2xl p-3.5 space-y-2.5">
        <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">
          Custos do Vendedor
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-[#86868b] block mb-1">Custo CMV</label>
            <div className="px-2 py-1.5 bg-black/[0.03] rounded-lg text-xs font-mono font-semibold text-[#1d1d1f]">
              {isCostComputable && typeof sheet.costPrice.value === 'number'
                ? `R$ ${sheet.costPrice.value.toFixed(2)}`
                : 'Não informado'}
            </div>
          </div>

          <div>
            <label className="text-[10px] text-[#86868b] block mb-1">Embalagem R$</label>
            <input
              type="number"
              step="0.50"
              min="0"
              value={packagingCost}
              onChange={(e) => setPackagingCost(parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1.5 bg-white rounded-lg border border-black/[0.1] text-xs font-semibold outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] text-[#86868b] block mb-1">Imposto %</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={taxRate}
              onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1.5 bg-white rounded-lg border border-black/[0.1] text-xs font-semibold outline-none"
            />
          </div>
        </div>
      </div>

      {/* 5. Painel de Resultados Principais (Hero Card) ou Bloqueio por Custo Ausente */}
      {!isCostComputable ? (
        <div className="apple-glass-card rounded-2xl p-4 text-center space-y-2 border-l-4 border-l-amber-500 bg-amber-50/30">
          <div className="flex items-center justify-center gap-2 text-amber-800 font-semibold text-xs">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            <span>Cálculo financeiro bloqueado</span>
          </div>
          <p className="text-xs text-[#86868b]">
            Informe o preço de custo para calcular lucro e margem.
          </p>
        </div>
      ) : outputs && (
        <div className="apple-glass-card rounded-2xl p-4 space-y-3 border-l-4 border-l-[#0071e3]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider">
              Resultado Projetado
            </span>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                outputs.marketplaceFees.isSimulated
                  ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
              }`}
            >
              {outputs.marketplaceFees.providerName}
            </span>
          </div>

          {/* Preço de Venda Final */}
          <div className="flex items-baseline justify-between pt-1">
            <span className="text-xs text-[#86868b] font-medium">Preço de Venda Sugerido:</span>
            <span className="text-2xl font-bold font-mono text-[#0071e3] tracking-tight">
              R$ {outputs.salePrice.toFixed(2)}
            </span>
          </div>

          {/* Lucro Líquido e Margem */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-black/[0.04]">
            <div className="p-2.5 bg-emerald-50/60 border border-emerald-200/50 rounded-xl">
              <div className="text-[10px] font-medium text-emerald-800">Lucro Líquido Real</div>
              <div className="text-sm font-bold text-emerald-700 font-mono">
                R$ {outputs.netProfit.toFixed(2)}
              </div>
            </div>

            <div className="p-2.5 bg-blue-50/60 border border-blue-200/50 rounded-xl">
              <div className="text-[10px] font-medium text-blue-800">Margem Líquida Real</div>
              <div className="text-sm font-bold text-[#0071e3] font-mono">
                {outputs.netMarginPercent.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Ponto de Equilíbrio (Break-Even) */}
          <div className="flex items-center justify-between p-2 bg-black/[0.02] rounded-xl text-[11px]">
            <span className="text-[#86868b] flex items-center gap-1 font-medium">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
              Ponto de Equilíbrio (Break-Even):
            </span>
            <span className="font-mono font-bold text-[#1d1d1f]">
              R$ {outputs.breakEvenPrice.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* 6. Detalhamento Itemizado de Taxas (MarketplaceFeeProvider) */}
      {isCostComputable && outputs && (
        <div className="apple-glass-card rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowFeeDetails(!showFeeDetails)}
            className="w-full p-3.5 flex items-center justify-between text-xs font-semibold text-[#1d1d1f] hover:bg-black/[0.02] transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>Detalhamento de Deduções & Taxas</span>
            </div>
            {showFeeDetails ? (
              <ChevronUp className="w-3.5 h-3.5 text-[#86868b]" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-[#86868b]" />
            )}
          </button>

          {showFeeDetails && (
            <div className="px-3.5 pb-3.5 space-y-2 text-xs border-t border-black/[0.04]">
              <div className="flex justify-between text-[#86868b] pt-1">
                <span>Comissão ML ({(outputs.marketplaceFees.percentageRate * 100).toFixed(0)}%):</span>
                <span className="font-mono text-rose-600 font-medium">
                  - R$ {outputs.marketplaceFees.percentageAmount.toFixed(2)}
                </span>
              </div>

              {outputs.marketplaceFees.fixedFeeAmount > 0 && (
                <div className="flex justify-between text-[#86868b]">
                  <span>Taxa Fixa ML (abaixo de R$ {outputs.marketplaceFees.fixedFeeThreshold}):</span>
                  <span className="font-mono text-rose-600 font-medium">
                    - R$ {outputs.marketplaceFees.fixedFeeAmount.toFixed(2)}
                  </span>
                </div>
              )}

              {outputs.marketplaceFees.shippingCostToSeller > 0 && (
                <div className="flex justify-between text-[#86868b]">
                  <span className="flex items-center gap-1">
                    <Truck className="w-3 h-3 text-amber-600" />
                    Frete Estimado ({sheet.packageWeightKg.value}kg):
                  </span>
                  <span className="font-mono text-rose-600 font-medium">
                    - R$ {outputs.marketplaceFees.shippingCostToSeller.toFixed(2)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-[#86868b]">
                <span>Imposto Fiscal Simples ({outputs.taxRatePercent}%):</span>
                <span className="font-mono text-rose-600 font-medium">
                  - R$ {outputs.taxAmount.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between text-[#86868b]">
                <span className="flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  Custo CMV + Embalagem:
                </span>
                <span className="font-mono text-rose-600 font-medium">
                  - R$ {(outputs.costPrice + outputs.packagingCost).toFixed(2)}
                </span>
              </div>

              <div className="pt-2 border-t border-black/[0.06] flex justify-between font-bold text-[#1d1d1f]">
                <span>Total Retido pelo Canal:</span>
                <span className="font-mono text-rose-700">
                  R$ {outputs.marketplaceFees.totalMarketplaceRetention.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. Ações: Voltar e Aplicar Preço à Ficha */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onPrev}
          className="w-1/3 py-3 px-3 rounded-xl text-xs font-semibold bg-black/5 hover:bg-black/10 text-[#1d1d1f] apple-press-spring flex items-center justify-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar</span>
        </button>

        <button
          type="button"
          onClick={handleApplyPrice}
          disabled={!isCostComputable || !outputs || outputs.salePrice <= 0}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-semibold apple-press-spring flex items-center justify-center gap-2 shadow-sm transition-all ${
            isSaved
              ? 'bg-emerald-600 text-white'
              : !isCostComputable || !outputs || outputs.salePrice <= 0
              ? 'bg-black/10 text-[#86868b] cursor-not-allowed'
              : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
          }`}
        >
          {isSaved ? (
            <>
              <Check className="w-4 h-4" />
              <span>Preço Salvo na Ficha!</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Aplicar Preço à Ficha</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
