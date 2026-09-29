import { findPriceForProfit } from '../../../integrations/mercadolivre/profit-price.ts';
import { pricingRequest, pricingRequestKey } from '../../../integrations/mercadolivre/pricing-request.ts';
import { useEffect, useRef, useState } from 'react';
import type { AuditedField, CentralProductSheet } from '../../../core/schema/product.ts';
import { createAuditedField } from '../../../core/schema/product.ts';
import { mlAction } from '../../../integrations/mercadolivre/client.ts';
import { isMlHost } from '../../../integrations/mercadolivre/market.ts';
import { mlItemIdFromUrl } from '../../../integrations/mercadolivre/pricing-context.ts';
import { pricingTotals, type MlCalculatorDraft, type MlPricingContext, type MlPricingQuote } from '../../../shared/ml-pricing.ts';
export function isCostPriceComputable(field?: AuditedField<number | null> | null): boolean {
  return !!field && field.status !== 'missing' && typeof field.value === 'number' && Number.isFinite(field.value) && field.value >= 0;
}
type Props = { sheet: CentralProductSheet; onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void; onPrev: () => void; onFinish?: () => void };
const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fieldClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:outline-blue-600';
const buttonClass = 'rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium disabled:opacity-40';
function initial(sheet: CentralProductSheet): MlCalculatorDraft {
  const currentCost = isCostPriceComputable(sheet.costPrice) ? sheet.costPrice.value : null;
  if (sheet.mlCalculator) return { ...sheet.mlCalculator, ...(sheet.mlCalculator.baseCost !== undefined && sheet.mlCalculator.baseCost !== currentCost ? { cost: currentCost } : {}), baseCost: currentCost };
  const dims = [sheet.packageHeightCm.value, sheet.packageWidthCm.value, sheet.packageLengthCm.value, sheet.packageWeightKg.value];
  return { categoryId: sheet.categoryIdML.value || '', price: sheet.suggestedSalePrice.value ?? sheet.currentSalePrice.value ?? 0,
    listingType: sheet.pricingDraft?.listingType || 'gold_special', shippingMode: 'me2', logisticType: '', condition: 'new', freeShipping: false,
    cost: currentCost, baseCost: currentCost, taxPercent: sheet.pricingDraft?.taxRate ?? null,
    packaging: sheet.pricingDraft?.packagingCost ?? 1.5, otherCosts: 0, manualShipping: null,
    ...(dims.every(n => Number.isFinite(n) && n > 0) ? { dimensions: `${dims[0]}x${dims[1]}x${dims[2]},${Math.round(dims[3] * 1000)}` } : {}) };
}
export const StepPricing = ({ sheet, onUpdateSheet, onPrev, onFinish }: Props) => {
  const [draft, setDraft] = useState(() => initial(sheet));
  const [quote, setQuote] = useState<{ value: MlPricingQuote; signature: string } | null>(null);
  const [targetProfit, setTargetProfit] = useState<number | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<{ connected: boolean; configured: boolean; sellerId?: string } | null>(null);
  const [candidate, setCandidate] = useState<MlPricingContext | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoryName, setCategoryName] = useState('');
  const [categoryQuery, setCategoryQuery] = useState(sheet.title.value || sheet.titleBling?.value || '');
  const [itemInput, setItemInput] = useState('');
  const [contextLabel, setContextLabel] = useState('Dados desta ficha');
  const [clock, setClock] = useState(Date.now());
  const mounted = useRef(true), locked = useRef(false), revision = useRef(0);
  const quoteKey = pricingRequestKey(draft);
  const liveQuoteKey = useRef(quoteKey); liveQuoteKey.current = quoteKey;
  const signature = JSON.stringify(draft), liveSignature = useRef(signature); liveSignature.current = signature;
  useEffect(() => { mounted.current = true; const timer = setInterval(() => setClock(Date.now()), 15000); return () => { mounted.current = false; clearInterval(timer); }; }, []);
  useEffect(() => { onUpdateSheet(s => JSON.stringify(s.mlCalculator) === signature ? s : { ...s, mlCalculator: draft }); }, [signature]);
  const change = <K extends keyof MlCalculatorDraft>(key: K, value: MlCalculatorDraft[K]) => {
    revision.current++; setDraft(d => ({ ...d, [key]: value })); setMessage('');
  };
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage('');
    try { await fn(); } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const status = async () => {
    const result = await mlAction('status');
    if (mounted.current) { setConnection(result); setQuote(null); }
    return result;
  };
  const capture = async () => {
    const serial = ++revision.current;
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || !isMlHost(new URL(tab.url).hostname)) { if (mounted.current && revision.current === serial) setCandidate(null); return; }
      let data: MlPricingContext = { itemId: mlItemIdFromUrl(tab.url) };
      try { const response = await chrome.tabs.sendMessage(tab.id, { type: 'ML_READ_PRICING', expectedUrl: tab.url }); if (response?.ok) data = response.context; } catch { /* URL still identifies ordinary listing pages after extension reload. */ }
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (mounted.current && revision.current === serial && current?.id === tab.id && current.url === tab.url) setCandidate(data?.itemId || data?.categoryId || data?.title ? data : null);
    } catch { if (mounted.current && revision.current === serial) setCandidate(null); }
  };
  useEffect(() => {
    void status().catch(e => { if (mounted.current) setMessage(e.message); }); void capture();
    if (typeof chrome === 'undefined' || !chrome.tabs?.onActivated) return;
    const active = () => { void capture(); };
    const updated = (_id: number, info: chrome.tabs.TabChangeInfo) => { if (info.status === 'complete' || info.url) void capture(); };
    chrome.tabs.onActivated.addListener(active); chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(active); chrome.tabs.onUpdated.removeListener(updated); };
  }, []);
  const useContext = async (data: MlPricingContext) => {
    const expected = liveSignature.current;
    const context: MlPricingContext = data.itemId ? await mlAction('pricing-context', { itemId: data.itemId }) : data;
    if (!mounted.current || liveSignature.current !== expected) return;
    setDraft(d => ({ ...d, ...(context.categoryId ? { categoryId: context.categoryId } : {}), ...(context.price ? { price: context.price } : {}),
      ...(context.listingType ? { listingType: context.listingType } : {}),
      ...(context.owned ? { itemId: context.itemId, shippingMode: context.shippingMode || '', logisticType: context.logisticType || '', freeShipping: context.freeShipping ?? false, condition: context.condition || 'new', dimensions: context.dimensions || d.dimensions } : { itemId: undefined,
        ...(context.shippingMode ? { shippingMode: context.shippingMode } : {}), ...(context.logisticType ? { logisticType: context.logisticType } : {}) }), manualShipping: null }));
    setContextLabel(context.title || context.itemId || 'Cadastro em andamento'); setCategoryQuery(context.title || categoryQuery); setCategoryName(''); setQuote(null);
    setMessage(context.owned === false ? 'Categoria e preço lidos. Confira a logística da SUA loja; os custos do concorrente não foram importados.' : 'Dados carregados. Confira se esta ficha e seus custos correspondem ao produto detectado.');
  };
  const validQuote = quote?.signature === quoteKey && clock - Date.parse(quote.value.queriedAt) < 300000 ? quote.value : null;
  const totals = validQuote ? pricingTotals(validQuote, draft) : null;
  const ready = /^MLB\d+$/.test(draft.categoryId) && draft.price > 0 && !!draft.logisticType;
  const numberField = (label: string, key: 'price' | 'cost' | 'taxPercent' | 'packaging' | 'otherCosts' | 'manualShipping', suffix = 'R$') => <label className="block text-xs font-medium text-slate-600">{label} <span className="font-normal">({suffix})</span><input aria-label={label} className={fieldClass} type="number" min="0" step="0.01" placeholder="Informe" value={draft[key] ?? ''} onChange={e => change(key, e.target.value === '' && ['cost','taxPercent','manualShipping'].includes(key) ? null : Number(e.target.value))} /></label>;
  return <section className="space-y-4 pb-5">
    <header><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Preço · Mercado Livre</p><h2 className="mt-1 text-2xl font-semibold text-slate-900">Quanto sobra na venda?</h2><p className="mt-2 text-sm text-slate-500">O Mercado Livre informa comissão e cotação de frete. Você informa os custos do seu negócio.</p></header>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2"><strong className="text-sm">1. Produto e conta</strong><span className="text-xs text-slate-500">{connection?.connected ? `Conta ${connection.sellerId}` : 'Conexão pendente'}</span></div>
      {!connection?.connected && <><p className="text-xs text-slate-600">{connection?.configured === false ? 'A integração ML precisa ser configurada no servidor.' : 'Conecte o Gateway/Bling nas conexões e autorize sua conta Mercado Livre.'}</p><button className={buttonClass} disabled={busy} onClick={() => void run(async () => { const result = await mlAction('start'); const url = new URL(result.authorizationUrl); if (url.origin !== 'https://auth.mercadolivre.com.br' || url.pathname !== '/authorization') throw new Error('Endereço de autorização inválido.'); await chrome.tabs.create({ url: url.href }); setMessage('Conclua a autorização e clique em Verificar conexão.'); })}>Conectar Mercado Livre</button></>}
      <button className={buttonClass} disabled={busy} onClick={() => void run(status)}>Verificar conexão</button>
      <p className="text-sm font-medium break-words">{contextLabel === 'Dados desta ficha' ? sheet.title.value || sheet.titleBling?.value || contextLabel : contextLabel}</p>
      {candidate && <div className="rounded-xl bg-blue-50 p-3 text-xs space-y-2"><p className="font-medium">Detectado na aba: {candidate.title || candidate.itemId || 'cadastro de anúncio'}</p><button disabled={busy} className={buttonClass} onClick={() => void run(() => useContext(candidate))}>Usar dados deste produto</button></div>}
      <details><summary className="cursor-pointer text-xs text-blue-700">Ler outro anúncio por link ou código MLB</summary><input aria-label="Link ou código do anúncio" className={fieldClass} value={itemInput} onChange={e => setItemInput(e.target.value)} placeholder="https://produto.mercadolivre.com.br/…" /><button disabled={busy} className={`${buttonClass} mt-2`} onClick={() => void run(() => useContext({ itemId: /^MLB\d{6,}$/.test(itemInput.trim().toUpperCase()) ? itemInput.trim().toUpperCase() : mlItemIdFromUrl(itemInput) || 'invalid' }))}>Ler anúncio</button></details>
      <div className="space-y-2"><p className="text-xs font-medium text-slate-600">Categoria: {categoryName || draft.categoryId || 'Ainda não identificada'}</p>
        <details open={!draft.categoryId}><summary className="cursor-pointer text-xs text-blue-700">Buscar categoria pelo nome do produto</summary>
          <input aria-label="Nome para buscar categoria" className={fieldClass} value={categoryQuery} onChange={e => setCategoryQuery(e.target.value)} placeholder="Ex.: copo de plástico 300 ml" />
          <button className={`${buttonClass} mt-2`} disabled={busy || !connection?.connected} onClick={() => void run(async () => { const result = await mlAction('pricing-categories', { title: categoryQuery }); if (mounted.current) { setCategories(result.categories); if (!result.categories.length) setMessage('Nenhuma categoria encontrada. Tente um nome mais específico.'); } })}>Buscar no Mercado Livre</button>
          {categories.map(category => <button key={category.id} className={`${buttonClass} mt-2 block w-full text-left`} onClick={() => { change('categoryId',category.id); change('itemId',undefined); setCategoryName(category.name); setCategories([]); }}>{category.name} · {category.id}</button>)}
          <p className="mt-2 text-xs text-slate-500">As sugestões vêm do Mercado Livre. Selecione a que corresponde ao produto.</p>
        </details>
        <details><summary className="cursor-pointer text-xs text-slate-500">Informar código da categoria</summary><input aria-label="Categoria do produto" className={fieldClass} value={draft.categoryId} placeholder="MLB…" onChange={e => { change('categoryId', e.target.value.toUpperCase()); change('itemId',undefined); setCategoryName(''); }} /></details>
      </div>
      <div className="grid grid-cols-2 gap-2">{(['gold_special','gold_pro'] as const).map(type => <button key={type} aria-pressed={draft.listingType === type} className={`rounded-xl border p-3 text-sm ${draft.listingType === type ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200'}`} onClick={() => change('listingType', type)}>{type === 'gold_special' ? 'Clássico' : 'Premium'}</button>)}</div>
      <details open={!draft.logisticType}><summary className="cursor-pointer text-xs text-blue-700">Entrega e embalagem {draft.logisticType ? '· conferir' : '· falta preencher'}</summary><div className="mt-3 space-y-3">
        <label className="block text-xs text-slate-600">Como você envia?<select aria-label="Como você envia?" className={fieldClass} value={draft.logisticType} onChange={e => { const value = e.target.value; change('logisticType', value); change('shippingMode', value === 'custom' ? 'custom' : value === 'default' ? 'me1' : value === 'not_specified' ? 'not_specified' : 'me2'); }}><option value="">Selecione a logística da sua loja</option>{[['drop_off','Mercado Envios · Correios'],['xd_drop_off','Mercado Envios · Agência'],['cross_docking','Mercado Envios · Coleta'],['fulfillment','Full'],['self_service','Flex'],['turbo','Turbo'],['default','Mercado Envios 1'],['custom','Envio por conta própria'],['not_specified','Sem envio definido']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-xs text-slate-600">Condição<select className={fieldClass} value={draft.condition} onChange={e => change('condition', e.target.value as 'new' | 'used')}><option value="new">Novo</option><option value="used">Usado</option></select></label>
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={draft.freeShipping} onChange={e => change('freeShipping', e.target.checked)} />Frete grátis para o comprador</label>
        <div className="grid grid-cols-2 gap-3">{['Altura (cm)','Largura (cm)','Comprimento (cm)','Peso (g)'].map((label,index) => <label key={label} className="text-xs text-slate-600">{label}<input aria-label={label} className={fieldClass} type="number" min="0" step={index === 3 ? '1' : '0.1'} value={(draft.dimensions || '').split(/[x,]/)[index] || ''} onChange={e => { const parts = (draft.dimensions || 'xx,').split(/[x,]/); parts[index] = e.target.value; change('dimensions',`${parts[0]}x${parts[1]}x${parts[2]},${parts[3]}`); }} /></label>)}</div>
        <p className="text-xs text-slate-500">Usamos as medidas da ficha quando disponíveis. O peso faturável retornado pelo ML participa da consulta de taxas.</p>
      </div></details>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4"><strong className="text-sm">2. Preço e seus custos</strong>{numberField('Preço de venda', 'price')}<div className="grid grid-cols-2 gap-3">{numberField('Custo do produto','cost')}{numberField('Imposto sobre a venda','taxPercent','%')}{numberField('Embalagem','packaging')}{numberField('Outros custos por venda','otherCosts')}</div><p className="text-xs text-slate-500">Custo preenchido a partir da ficha, quando disponível. Informe seu imposto; use 0 somente se não houver. Inclua anúncios pagos e outros gastos em “Outros custos”.</p>
    <button disabled={busy || !connection?.connected || !ready} className="w-full rounded-xl bg-blue-600 p-3 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void run(async () => { const expected = quoteKey; const result: MlPricingQuote = await mlAction('pricing-quote', { ...pricingRequest(draft) }); if (mounted.current && liveQuoteKey.current === expected) { setClock(Date.now()); setQuote({ value: result, signature: expected }); } })}>{busy ? 'Consultando Mercado Livre…' : 'Consultar taxas e calcular'}</button>
    <details><summary className="cursor-pointer text-xs text-blue-700">Quero escolher quanto lucrar por unidade</summary><label className="block mt-3 text-xs text-slate-600">Lucro desejado (R$)<input className={fieldClass} type="number" min="0" step="0.01" disabled={busy} value={targetProfit ?? ''} onChange={e => setTargetProfit(e.target.value === '' ? null : Number(e.target.value))} /></label><p className="mt-2 text-xs text-slate-500">Após custo do produto, imposto, embalagem, outros gastos e taxas. Cada preço é conferido novamente no ML.</p><button disabled={busy || !connection?.connected || !draft.categoryId || !draft.logisticType || targetProfit === null} className={`${buttonClass} mt-2`} onClick={() => void run(async () => {
      const expected = signature;
      const result = await findPriceForProfit(draft,targetProfit!, candidate => mlAction('pricing-quote',{...pricingRequest(candidate)}), () => mounted.current && liveSignature.current === expected);
      if (mounted.current && liveSignature.current === expected) { setDraft(result.draft); setClock(Date.now()); setQuote({value:result.quote,signature:pricingRequestKey(result.draft)}); }
    })}>Encontrar preço com taxas do ML</button></details>
    {!ready && <p className="text-xs text-amber-700">Informe categoria, preço e logística para consultar. Nenhuma taxa será inventada.</p>}</div>
    {message && <p role="status" className="rounded-xl bg-blue-50 p-3 text-xs text-blue-900">{message}</p>}
    {quote && !validQuote && <p role="status" className="text-xs text-amber-700">Os dados mudaram ou a cotação expirou. Consulte novamente antes de aplicar o preço.</p>}
    {validQuote && <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"><strong className="text-sm">3. Resultado por unidade</strong>
      <p className="text-xs text-slate-500">API Mercado Livre · {new Date(validQuote.queriedAt).toLocaleTimeString('pt-BR')} · conta {validQuote.sellerId}</p>
      {validQuote.shippingCost === null && <div className="rounded-xl bg-amber-50 p-3 space-y-2"><p className="text-xs text-amber-900">Frete não confirmado: {validQuote.shippingError}</p>{numberField('Frete pago por você (manual)','manualShipping')}<p className="text-xs">Este custo será identificado como manual. Não consideramos frete ausente como zero.</p></div>}
      <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt>Venda</dt><dd>{money(draft.price)}</dd></div><div className="flex justify-between"><dt>Tarifa total ML</dt><dd>− {money(validQuote.saleFee)}</dd></div>{validQuote.fixedFee !== null && <p className="text-xs text-slate-500">Já inclui {money(validQuote.fixedFee)} de tarifa fixa. Não é somada duas vezes.</p>}<div className="flex justify-between"><dt>Frete do vendedor {totals?.manualShipping ? '(manual)' : '(cotação ML)'}</dt><dd>{validQuote.shippingCost !== null ? '− ' + money(validQuote.shippingCost) : totals ? '− ' + money(totals.shipping) : 'Pendente'}</dd></div></dl>
      {totals ? <><div className="border-t pt-3 space-y-2 text-sm">{[['Custo do produto',draft.cost!],['Imposto',totals.tax],['Embalagem',draft.packaging],['Outros custos',draft.otherCosts]].map(([label,value]) => <div className="flex justify-between" key={label}><span>{label}</span><span>− {money(value as number)}</span></div>)}</div><div className={`rounded-xl p-4 ${totals.profit >= 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}><p className="text-xs">{totals.profit >= 0 ? 'Sobra após os custos informados' : 'Prejuízo após os custos informados'}</p><strong className="block text-3xl mt-1">{money(totals.profit)}</strong><p className="mt-1 text-xs">Margem: {totals.margin.toFixed(1)}% do preço de venda</p></div><button className="w-full rounded-xl bg-slate-900 p-3 text-sm font-semibold text-white" onClick={() => {
        if (!quote || liveQuoteKey.current !== quote.signature || Date.now() - Date.parse(quote.value.queriedAt) >= 300000) { setMessage('Consulte as taxas novamente.'); return; }
        onUpdateSheet(s => ({ ...s, mlCalculator: draft, mlAppliedPricing: { quote: quote.value, costs: draft, appliedAt: new Date().toISOString() }, suggestedSalePrice: createAuditedField(draft.price, 'rule_engine', 1, 'approved', { capturedAt: quote.value.queriedAt, sourceName: 'Cotação API Mercado Livre', extractedSnippet: `Tarifa total: ${quote.value.saleFee}; frete: ${totals.shipping}; frete manual: ${totals.manualShipping}` }), categoryIdML: createAuditedField(draft.categoryId, 'user_manual', 1, 'edited') })); onFinish?.();
      }}>Usar este preço no anúncio</button></> : <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Para mostrar quanto sobra, preencha custo, imposto e frete. Valores ausentes não são considerados zero.</p>}
      <p className="text-xs text-slate-500">Cotação para este preço e estas condições. Frete e cobranças finais podem mudar na venda. Não inclui despesas que você não informou.</p>
    </div>}
    <button className={buttonClass} onClick={onPrev}>← Voltar ao produto</button>
  </section>;
};
