import { pricingTotals, type MlCalculatorDraft, type MlPricingQuote } from '../../shared/ml-pricing.ts';
/** Every candidate is priced by the API; no local fee table or linear extrapolation is accepted as the answer. */
export async function findPriceForProfit(draft: MlCalculatorDraft, target: number, quote: (draft: MlCalculatorDraft) => Promise<MlPricingQuote>, isCurrent: () => boolean = () => true) {
  if (!Number.isFinite(target) || target < 0 || draft.cost === null || draft.taxPercent === null) throw new Error('Informe lucro desejado, custo e imposto.');
  let price = Math.max(0.01, draft.price || draft.cost + target + draft.packaging + draft.otherCosts);
  const seen = new Set<number>(), started = Date.now();
  for (let i = 0; i < 8; i++) {
    if (!isCurrent() || Date.now() - started > 90000) throw new Error('Cálculo interrompido. Confira os dados e tente novamente.');
    price = Math.round(price * 100) / 100;
    if (!Number.isFinite(price) || price <= 0 || price > 1e8 || seen.has(price)) break;
    seen.add(price);
    const candidate = { ...draft, price };
    const result = await quote(candidate);
    if (!isCurrent()) throw new Error('Os dados mudaram durante o cálculo.');
    const totals = pricingTotals(result, candidate);
    if (!totals) throw new Error('Faltam custos ou frete para calcular o lucro desejado. Complete os dados e consulte primeiro.');
    if (Math.abs(totals.profit - target) <= 0.05 && totals.profit >= target - 0.005) return { draft: candidate, quote: result };
    const remaining = 1 - draft.taxPercent / 100 - (result.percentageFee ?? 50) / 100;
    if (remaining <= 0) break;
    price = Math.ceil((price + (target - totals.profit) / remaining) * 100) / 100;
  }
  throw new Error('Não foi possível confirmar um preço para esse lucro com as cotações recebidas. Ajuste o preço de venda e consulte novamente.');
}
