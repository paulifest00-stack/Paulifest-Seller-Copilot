// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import type { CentralProductSheet } from '../../core/schema/product.ts';
import { createAuditedField } from '../../core/schema/product.ts';
import {
  calculateMlSideBySide,
  calculatePriceForTarget,
  type MlPricingContext,
  type MlPlanCalculation
} from '../../shared/ml-pricing.ts';
import { isMlHost } from '../../integrations/mercadolivre/market.ts';
import { mlItemIdFromUrl } from '../../integrations/mercadolivre/pricing-context.ts';
import {
  Sparkles,
  Zap,
  TrendingUp,
  DollarSign,
  CheckCircle2,
  ShieldCheck,
  Loader2
} from 'lucide-react';

interface Props {
  sheet: CentralProductSheet;
  onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void;
  onFinish?: () => void;
  onPrev?: () => void;
}

export const MlPricingCalculator: React.FC<Props> = ({
  sheet,
  onUpdateSheet,
  onFinish,
  onPrev
}) => {
  // ── 1. Detecção Automática da Página / Contexto ──────────────────────────────
  const [detectedPage, setDetectedPage] = useState<MlPricingContext | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [mlConnection, setMlConnection] = useState<{ connected: boolean; sellerId?: string; nickname?: string } | null>(null);

  // ── 2. Modo de Cálculo ──────────────────────────────────────────────────────
  // 'price_to_profit' = Usuário informa Preço de Venda -> Calcula Lucro/Margem
  // 'target_to_price' = Usuário informa Margem (%) ou Lucro (R$) desejado -> Calcula Preço de Venda
  const [calcMode, setCalcMode] = useState<'price_to_profit' | 'target_to_price'>('price_to_profit');
  const [targetType, setTargetType] = useState<'margin_percent' | 'profit_amount'>('margin_percent');
  const [targetValue, setTargetValue] = useState<number>(20); // 20% ou R$ 20,00

  // ── 3. Custos e Entradas ───────────────────────────────────────────────────
  const initialCost = useMemo(() => {
    if (typeof sheet.costPrice?.value === 'number' && Number.isFinite(sheet.costPrice.value) && sheet.costPrice.value > 0) {
      return sheet.costPrice.value;
    }
    if (sheet.mlCalculator?.cost != null) return sheet.mlCalculator.cost;
    return 25.0; // fallback amigável
  }, [sheet.costPrice, sheet.mlCalculator?.cost]);

  const initialSalePrice = useMemo(() => {
    if (sheet.suggestedSalePrice?.value && sheet.suggestedSalePrice.value > 0) {
      return sheet.suggestedSalePrice.value;
    }
    if (sheet.currentSalePrice?.value && sheet.currentSalePrice.value > 0) {
      return sheet.currentSalePrice.value;
    }
    if (sheet.mlCalculator?.price && sheet.mlCalculator.price > 0) {
      return sheet.mlCalculator.price;
    }
    return 59.90; // fallback padrão
  }, [sheet.suggestedSalePrice, sheet.currentSalePrice, sheet.mlCalculator?.price]);

  const [salePrice, setSalePrice] = useState<number>(initialSalePrice);
  const [productCost, setProductCost] = useState<number>(initialCost);
  const [taxPercent, setTaxPercent] = useState<number>(sheet.mlCalculator?.taxPercent ?? 4.0); // Simples Nacional default 4%
  const [packagingCost, setPackagingCost] = useState<number>(sheet.mlCalculator?.packaging ?? 1.50);
  const [otherCosts, setOtherCosts] = useState<number>(sheet.mlCalculator?.otherCosts ?? 0.0);
  const [forceFreeShipping, setForceFreeShipping] = useState<boolean>(sheet.mlCalculator?.freeShipping ?? false);
  const customShippingCost = sheet.mlCalculator?.manualShipping ?? null;
  const [appliedPlan, setAppliedPlan] = useState<'gold_special' | 'gold_pro' | null>(null);

  // ── 4. Carrega status de conexão do ML e detecta aba ativa ──────────────────
  useEffect(() => {
    let active = true;

    // Consulta conexão ML
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'ML_GET_CONNECTION_STATUS' }, (res) => {
        if (active && res && res.ok) {
          setMlConnection({
            connected: res.connected,
            sellerId: res.sellerId,
            nickname: res.nickname
          });
        }
      });
    }

    // Leitura automática da página do Mercado Livre
    const detectMlTab = async () => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
      try {
        setIsDetecting(true);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url) return;
        const urlObj = new URL(tab.url);
        if (!isMlHost(urlObj.hostname)) return;

        let detected: MlPricingContext = { itemId: mlItemIdFromUrl(tab.url) };
        try {
          const resp = await chrome.tabs.sendMessage(tab.id, {
            type: 'ML_READ_PRICING',
            expectedUrl: tab.url
          });
          if (resp?.ok && resp.context) {
            detected = resp.context;
          }
        } catch {}

        if (active && (detected.title || detected.price || detected.itemId)) {
          setDetectedPage(detected);
        }
      } catch {}
      finally {
        if (active) setIsDetecting(false);
      }
    };

    void detectMlTab();

    return () => {
      active = false;
    };
  }, []);

  // ── 5. Aplica dados detectados da página ─────────────────────────────────────
  const applyDetectedProduct = (data: MlPricingContext) => {
    if (data.price && data.price > 0) {
      setSalePrice(data.price);
    }
    if (data.freeShipping != null) {
      setForceFreeShipping(data.freeShipping);
    }
  };

  // ── 6. Cálculos em Tempo Real ───────────────────────────────────────────────
  // Se estiver no modo reverso (target_to_price), calcula os preços de venda necessários primeiro
  const calculatedPricesFromTarget = useMemo(() => {
    if (calcMode !== 'target_to_price') return null;
    return calculatePriceForTarget(targetType, targetValue, {
      productCost,
      taxPercent,
      packagingCost,
      otherCosts,
      customShippingCost,
      forceFreeShipping
    });
  }, [calcMode, targetType, targetValue, productCost, taxPercent, packagingCost, otherCosts, customShippingCost, forceFreeShipping]);

  // Efetua o cálculo side-by-side de Clássico e Premium
  const comparison = useMemo(() => {
    const classicPrice = calcMode === 'target_to_price' && calculatedPricesFromTarget
      ? calculatedPricesFromTarget.classicPrice
      : salePrice;

    const premiumPrice = calcMode === 'target_to_price' && calculatedPricesFromTarget
      ? calculatedPricesFromTarget.premiumPrice
      : salePrice;

    const classicSide = calculateMlSideBySide({
      salePrice: classicPrice,
      productCost,
      taxPercent,
      packagingCost,
      otherCosts,
      customShippingCost,
      forceFreeShipping
    }).classic;

    const premiumSide = calculateMlSideBySide({
      salePrice: premiumPrice,
      productCost,
      taxPercent,
      packagingCost,
      otherCosts,
      customShippingCost,
      forceFreeShipping
    }).premium;

    return {
      classic: classicSide,
      premium: premiumSide
    };
  }, [calcMode, calculatedPricesFromTarget, salePrice, productCost, taxPercent, packagingCost, otherCosts, customShippingCost, forceFreeShipping]);

  // ── 7. Aplicação do Preço Escolhido na Ficha ────────────────────────────────
  const handleApplyPrice = (plan: MlPlanCalculation) => {
    setAppliedPlan(plan.listingType);
    onUpdateSheet((prev) => {
      const updatedCalculator = {
        categoryId: detectedPage?.categoryId || prev.categoryIdML?.value || 'MLB31454',
        price: plan.salePrice,
        listingType: plan.listingType,
        shippingMode: 'me2',
        logisticType: 'drop_off',
        condition: 'new' as const,
        freeShipping: plan.sellerPaysShipping,
        cost: productCost,
        baseCost: productCost,
        taxPercent,
        packaging: packagingCost,
        otherCosts,
        manualShipping: customShippingCost
      };

      return {
        ...prev,
        mlCalculator: updatedCalculator,
        suggestedSalePrice: createAuditedField(
          plan.salePrice,
          'rule_engine',
          1,
          'approved',
          {
            capturedAt: new Date().toISOString(),
            sourceName: `Calculadora ML (${plan.label})`,
            extractedSnippet: `Margem: ${plan.marginPercent}%, Lucro: R$ ${plan.netProfit.toFixed(2)}, Taxa ML: R$ ${plan.commissionAmount.toFixed(2)}, Taxa Fixa: R$ ${plan.fixedFee.toFixed(2)}`
          }
        )
      };
    });

    if (onFinish) {
      setTimeout(() => onFinish(), 250);
    }
  };

  const formatBrl = (val: number) =>
    val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-3.5 pb-6 text-slate-800 antialiased font-sans">
      {/* ── Banner de Contexto e Detecção Automática ── */}
      {detectedPage && (detectedPage.title || detectedPage.price) && (
        <div className="bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-amber-500/5 border border-amber-300/60 rounded-xl p-3 flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-xs">
              ML
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded">
                  Anúncio Detectado na Página
                </span>
                {detectedPage.itemId && (
                  <span className="text-[10px] font-mono text-amber-700">
                    {detectedPage.itemId}
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold text-slate-900 truncate mt-0.5">
                {detectedPage.title || 'Produto Mercado Livre'}
              </p>
              {detectedPage.price != null && (
                <p className="text-[11px] text-amber-900 font-bold">
                  Preço no anúncio: {formatBrl(detectedPage.price)}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => applyDetectedProduct(detectedPage)}
            className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg shadow-xs transition-colors flex-shrink-0 flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            Usar Preço
          </button>
        </div>
      )}

      {/* ── Header da Calculadora ── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm shadow-2xs">
              <Zap className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 leading-tight">
                Calculadora Mercado Livre
              </h2>
              <p className="text-[11px] text-slate-500">
                Compare Clássico vs. Premium com taxas e margem em tempo real.
              </p>
            </div>
          </div>

          {/* Status chip da conexão */}
          <div className="flex items-center gap-1.5 text-[10px] font-medium">
            {isDetecting && (
              <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Loader2 className="w-3 h-3 text-amber-600 animate-spin" />
                Lendo aba...
              </span>
            )}
            {mlConnection?.connected ? (
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                {mlConnection.nickname || 'ML Conectado'}
              </span>
            ) : (
              <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-slate-400" />
                Regras Padrão ML
              </span>
            )}
          </div>
        </div>

        {/* ── Tabs de Modo de Cálculo ── */}
        <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setCalcMode('price_to_profit')}
            className={`py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              calcMode === 'price_to_profit'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            Simular por Preço
          </button>

          <button
            type="button"
            onClick={() => setCalcMode('target_to_price')}
            className={`py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              calcMode === 'target_to_price'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Definir Margem Alvo
          </button>
        </div>

        {/* ── Inputs Principais ── */}
        {calcMode === 'price_to_profit' ? (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Preço de Venda pretendido (R$):
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">
                R$
              </span>
              <input
                type="number"
                step="0.01"
                min="1"
                value={salePrice || ''}
                onChange={(e) => setSalePrice(Number(e.target.value))}
                placeholder="0,00"
                className="w-full pl-9 pr-3 py-2 text-base font-extrabold text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 px-0.5">
              <span>Abaixo de R$ 79,00: + R$ 6,00 tarifa fixa</span>
              <span>A partir de R$ 79,00: Frete grátis</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2 bg-blue-50/50 border border-blue-100 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-blue-900">
                Quanto você quer lucrar na venda?
              </label>
              <div className="flex bg-white rounded-lg border border-blue-200 p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setTargetType('margin_percent')}
                  className={`px-2 py-0.5 rounded ${
                    targetType === 'margin_percent' ? 'bg-blue-600 text-white' : 'text-slate-600'
                  }`}
                >
                  % Margem
                </button>
                <button
                  type="button"
                  onClick={() => setTargetType('profit_amount')}
                  className={`px-2 py-0.5 rounded ${
                    targetType === 'profit_amount' ? 'bg-blue-600 text-white' : 'text-slate-600'
                  }`}
                >
                  R$ Lucro
                </button>
              </div>
            </div>

            <div className="relative">
              <span className="absolute left-3 top-2 text-xs font-bold text-slate-400">
                {targetType === 'margin_percent' ? '%' : 'R$'}
              </span>
              <input
                type="number"
                step={targetType === 'margin_percent' ? '1' : '0.50'}
                min="1"
                value={targetValue || ''}
                onChange={(e) => setTargetValue(Number(e.target.value))}
                className="w-full pl-9 pr-3 py-1.5 text-base font-extrabold text-blue-900 bg-white border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <p className="text-[10px] text-blue-700">
              O Copilot calcula o preço exato que você deve anunciar para atingir este retorno.
            </p>
          </div>
        )}

        {/* ── Grade de Custos do Vendedor ── */}
        <div className="border-t border-slate-100 pt-3 space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Custos do seu produto
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                Custo do Produto (CMV)
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-[11px] text-slate-400">R$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={productCost || ''}
                  onChange={(e) => setProductCost(Number(e.target.value))}
                  placeholder="0,00"
                  className="w-full pl-7 pr-2 py-1 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                Imposto sobre Venda (%)
              </label>
              <div className="relative">
                <span className="absolute right-2.5 top-1.5 text-[11px] text-slate-400">%</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={taxPercent || ''}
                  onChange={(e) => setTaxPercent(Number(e.target.value))}
                  placeholder="4.0"
                  className="w-full pl-2 pr-6 py-1 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                Embalagem
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-[11px] text-slate-400">R$</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={packagingCost || ''}
                  onChange={(e) => setPackagingCost(Number(e.target.value))}
                  placeholder="1,50"
                  className="w-full pl-7 pr-2 py-1 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                Outros Custos / Ads
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-[11px] text-slate-400">R$</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={otherCosts || ''}
                  onChange={(e) => setOtherCosts(Number(e.target.value))}
                  placeholder="0,00"
                  className="w-full pl-7 pr-2 py-1 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Comparação Lado a Lado: Clássico vs. Premium ── */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* CARD CLÁSSICO */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs flex flex-col justify-between space-y-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-blue-700 uppercase tracking-wider">
                Clássico
              </span>
              <span className="text-[10px] text-slate-400 font-semibold">
                ~12% taxa
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Preço de Venda
              </span>
              <span className="text-lg font-black text-slate-900">
                {formatBrl(comparison.classic.salePrice)}
              </span>
            </div>

            {/* Linhas de Dedução */}
            <div className="text-[11px] space-y-1 text-slate-600 pt-1 border-t border-slate-100">
              <div className="flex justify-between">
                <span>Comissão ML ({comparison.classic.commissionPercent}%)</span>
                <span className="font-semibold text-slate-900">− {formatBrl(comparison.classic.commissionAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Taxa Fixa ML</span>
                <span className="font-semibold text-slate-900">
                  {comparison.classic.fixedFee > 0 ? `− ${formatBrl(comparison.classic.fixedFee)}` : 'R$ 0,00'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Frete Vendedor</span>
                <span className="font-semibold text-slate-900">
                  {comparison.classic.shippingCost > 0 ? `− ${formatBrl(comparison.classic.shippingCost)}` : 'R$ 0,00'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Imposto ({taxPercent}%)</span>
                <span className="font-semibold text-slate-900">− {formatBrl(comparison.classic.taxAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Custo + Extras</span>
                <span className="font-semibold text-slate-900">− {formatBrl(productCost + packagingCost + otherCosts)}</span>
              </div>
            </div>
          </div>

          {/* Resultado Líquido Clássico */}
          <div className="pt-2 border-t border-slate-100">
            <div className={`p-2.5 rounded-xl ${comparison.classic.netProfit >= 0 ? 'bg-emerald-50 text-emerald-950 border border-emerald-200/60' : 'bg-rose-50 text-rose-950 border border-rose-200/60'}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider block opacity-75">
                {comparison.classic.netProfit >= 0 ? 'Lucro Líquido' : 'Prejuízo'}
              </span>
              <span className="text-xl font-black block mt-0.5">
                {formatBrl(comparison.classic.netProfit)}
              </span>
              <div className="flex justify-between items-center text-[10px] font-bold mt-1 pt-1 border-t border-black/5">
                <span>Margem: {comparison.classic.marginPercent}%</span>
                <span>ROI: {comparison.classic.roiPercent}%</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleApplyPrice(comparison.classic)}
              className="mt-2.5 w-full py-2 px-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1"
            >
              {appliedPlan === 'gold_special' ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Aplicado!
                </>
              ) : (
                <>Usar Clássico</>
              )}
            </button>
          </div>
        </div>

        {/* CARD PREMIUM */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs flex flex-col justify-between space-y-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-amber-700 uppercase tracking-wider">
                Premium
              </span>
              <span className="text-[10px] text-slate-400 font-semibold">
                Sem juros (16.5%)
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Preço de Venda
              </span>
              <span className="text-lg font-black text-slate-900">
                {formatBrl(comparison.premium.salePrice)}
              </span>
            </div>

            {/* Linhas de Dedução */}
            <div className="text-[11px] space-y-1 text-slate-600 pt-1 border-t border-slate-100">
              <div className="flex justify-between">
                <span>Comissão ML ({comparison.premium.commissionPercent}%)</span>
                <span className="font-semibold text-slate-900">− {formatBrl(comparison.premium.commissionAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Taxa Fixa ML</span>
                <span className="font-semibold text-slate-900">
                  {comparison.premium.fixedFee > 0 ? `− ${formatBrl(comparison.premium.fixedFee)}` : 'R$ 0,00'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Frete Vendedor</span>
                <span className="font-semibold text-slate-900">
                  {comparison.premium.shippingCost > 0 ? `− ${formatBrl(comparison.premium.shippingCost)}` : 'R$ 0,00'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Imposto ({taxPercent}%)</span>
                <span className="font-semibold text-slate-900">− {formatBrl(comparison.premium.taxAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Custo + Extras</span>
                <span className="font-semibold text-slate-900">− {formatBrl(productCost + packagingCost + otherCosts)}</span>
              </div>
            </div>
          </div>

          {/* Resultado Líquido Premium */}
          <div className="pt-2 border-t border-slate-100">
            <div className={`p-2.5 rounded-xl ${comparison.premium.netProfit >= 0 ? 'bg-emerald-50 text-emerald-950 border border-emerald-200/60' : 'bg-rose-50 text-rose-950 border border-rose-200/60'}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider block opacity-75">
                {comparison.premium.netProfit >= 0 ? 'Lucro Líquido' : 'Prejuízo'}
              </span>
              <span className="text-xl font-black block mt-0.5">
                {formatBrl(comparison.premium.netProfit)}
              </span>
              <div className="flex justify-between items-center text-[10px] font-bold mt-1 pt-1 border-t border-black/5">
                <span>Margem: {comparison.premium.marginPercent}%</span>
                <span>ROI: {comparison.premium.roiPercent}%</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleApplyPrice(comparison.premium)}
              className="mt-2.5 w-full py-2 px-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1"
            >
              {appliedPlan === 'gold_pro' ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Aplicado!
                </>
              ) : (
                <>Usar Premium</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Informações Rápidas e Ponto de Equilíbrio (Break-Even) ── */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700">Ponto de Equilíbrio (Clássico):</span>
          <span className="font-mono font-bold text-slate-900">{formatBrl(comparison.classic.breakEvenPrice)}</span>
        </div>
        <p className="text-[10px] text-slate-400">
          Preço mínimo para cobrir custo, imposto e taxas sem ter prejuízo.
        </p>
      </div>

      {/* Botão de Voltar */}
      {onPrev && (
        <button
          type="button"
          onClick={onPrev}
          className="text-xs text-slate-500 hover:text-slate-800 transition-colors py-1 block"
        >
          ← Voltar para etapa anterior
        </button>
      )}
    </div>
  );
};

