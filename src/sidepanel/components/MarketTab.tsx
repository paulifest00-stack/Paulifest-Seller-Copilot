import { useEffect, useState } from 'react';
import { isMlHost, marketSummary, marketCsv, type MarketSnapshot } from '../../integrations/mercadolivre/market.ts';
import { loadMarketHistory, saveMarketSnapshot, priceHistory, type MarketHistory } from '../../core/storage/market-history.ts';
import type { CentralProductSheet } from '../../core/schema/product.ts';
const money = (value: number | null) => value === null ? 'Não exibido' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function MarketTab({ sheet, onUpdateSheet }: { sheet: CentralProductSheet; onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void }) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [history, setHistory] = useState<MarketHistory>({ snapshots: [] });
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [selected, setSelected] = useState('');
  const [titleB, setTitleB] = useState(sheet.workbench?.titleComparison?.titleB || '');
  const [sample, setSample] = useState(sheet.workbench?.titleComparison || { viewsA: 0, clicksA: 0, viewsB: 0, clicksB: 0 });
  useEffect(() => { let active = true; void loadMarketHistory().then(h => { if (active) { setHistory(h); setSnapshot(h.snapshots.at(-1) || null); } }).catch(() => { if (active) setMessage('Não foi possível carregar o histórico.'); }); return () => { active = false; }; }, []);
  const capture = async () => {
    if (busy) return; setBusy(true); setMessage('');
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) throw new Error('Abra a extensão no Chrome e visite uma busca ou anúncio do Mercado Livre.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || !isMlHost(new URL(tab.url).hostname)) throw new Error('Abra uma busca ou anúncio do Mercado Livre na aba ativa.');
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'ML_READ_PAGE', expectedUrl: tab.url });
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (current?.id !== tab.id || current.url !== tab.url) throw new Error('A aba mudou durante a captura. Tente novamente.');
      if (!response?.ok) throw new Error(response?.error || 'A página não respondeu. Recarregue a página após atualizar a extensão.');
      const value = response.snapshot as MarketSnapshot;
      if (!value || !Array.isArray(value.items) || value.items.length > 100 || !['search', 'product', 'unknown'].includes(value.kind)) throw new Error('A página retornou uma captura inválida.');
      if (!value.items.length) throw new Error('Nenhum produto legível nesta página. Abra uma busca ou anúncio e aguarde carregar.');
      await saveMarketSnapshot(value); setSnapshot(value); setHistory(await loadMarketHistory());
      setMessage(`${value.items.length} produtos capturados. Histórico salvo neste navegador.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Falha ao capturar página.'); }
    finally { setBusy(false); }
  };
  const stats = marketSummary(snapshot?.items || []);
  const points = selected ? priceHistory(history, selected) : [];
  const exportCsv = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([marketCsv(snapshot.items)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'mercado-livre-captura.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const validSample = sample.clicksA <= sample.viewsA && sample.clicksB <= sample.viewsB;
  return <section className="space-y-4 text-xs">
    <div className="rounded-2xl border bg-white p-4 space-y-3"><h2 className="font-bold text-base">Mercado e concorrentes</h2><p>Capture os produtos carregados na página atual. Posição, preço e texto de vendas são observações da página, não ranking global nem faturamento estimado.</p><div className="flex gap-2"><button disabled={busy} onClick={() => void capture()} className="rounded-lg bg-blue-700 text-white p-3 disabled:opacity-40">{busy ? 'Lendo página…' : 'Capturar página atual'}</button><button disabled={!snapshot} onClick={exportCsv} className="rounded-lg border p-3 disabled:opacity-40">Exportar CSV</button></div>{message && <p role="status">{message}</p>}</div>
    {snapshot && <>
      <p>Captura: {new Date(snapshot.capturedAt).toLocaleString('pt-BR')} · {stats.count} itens · {stats.sponsored} patrocinados</p>
      <div className="grid grid-cols-3 gap-2">{[['Menor', stats.min], ['Mediana', stats.median], ['Maior', stats.max]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3"><span className="block text-slate-500">{label}</span><strong>{money(value as number | null)}</strong></div>)}</div>
      <p>Comparação bruta dos {stats.priced} preços exibidos; kits, variações e frete podem diferir.</p>
      <div className="space-y-2">{snapshot.items.map(item => <article key={item.id} className="rounded-xl border bg-white p-3 space-y-2"><div className="flex justify-between text-slate-500"><span>Posição observada {item.position}</span><span>{item.sponsored ? 'Patrocinado' : 'Sem selo de anúncio patrocinado detectado'}</span></div><a className="text-blue-700 font-semibold" href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a><strong className="block text-lg">{money(item.price)}</strong><p>{item.seller || 'Vendedor não exibido'}</p><p>{item.soldLabel || 'Vendas não exibidas'} · {item.shippingLabel || 'Frete não exibido'}</p><button className="text-blue-700" onClick={() => setSelected(item.id)}>Ver histórico de preço</button></article>)}</div>
    </>}
    {selected && <div className="rounded-2xl border bg-white p-4 space-y-2"><h3 className="font-bold">Histórico observado · {selected}</h3>{points.map((p, i) => <p key={i}>{new Date(p.capturedAt).toLocaleString('pt-BR')} — {money(p.price)}</p>)}<p className="text-slate-500">Somente capturas realizadas por você. Períodos entre capturas não são inferidos.</p></div>}
    <div className="rounded-2xl border bg-white p-4 space-y-3"><h3 className="font-bold text-sm">Comparar títulos A/B</h3><p>Avaliação manual de textos e contagens informadas. Não altera anúncios nem distribui tráfego automaticamente.</p><label className="block">A · título atual<textarea readOnly className="w-full rounded-lg border p-2 mt-1" value={sheet.title.value} /></label><label className="block">B · alternativa<textarea className="w-full rounded-lg border p-2 mt-1" value={titleB} onChange={e => setTitleB(e.target.value)} /></label><p>A: {Array.from(sheet.title.value).length}/60 caracteres · B: {Array.from(titleB).length}/60 caracteres</p>
      <div className="grid grid-cols-2 gap-2">{([['viewsA', 'Impressões A'], ['clicksA', 'Cliques A'], ['viewsB', 'Impressões B'], ['clicksB', 'Cliques B']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={0} step={1} value={sample[key]} className="w-full border rounded-lg p-2 mt-1" onChange={e => { const n = Number(e.target.value); setSample(s => ({ ...s, [key]: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0 })); }} /></label>)}</div>
      {!validSample ? <p className="text-red-700">Cliques não podem superar impressões.</p> : <p>CTR A: {sample.viewsA ? (sample.clicksA / sample.viewsA * 100).toFixed(2) + '%' : 'sem amostra'} · CTR B: {sample.viewsB ? (sample.clicksB / sample.viewsB * 100).toFixed(2) + '%' : 'sem amostra'}</p>}<p className="text-slate-500">CTR isolada não demonstra que a mudança do título causou a diferença.</p>
      <button className="border rounded-lg p-2 disabled:opacity-40" disabled={!validSample} onClick={() => { onUpdateSheet(s => ({ ...s, workbench: { ...s.workbench, titleComparison: { ...sample, titleB } } })); setMessage('Comparação de títulos salva nesta ficha.'); }}>Salvar comparação nesta ficha</button>
    </div>
  </section>;
}
