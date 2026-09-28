import { useEffect, useRef, useState } from 'react';
import type { CentralProductSheet } from '../../core/schema/product.ts';
import { loadSellerPreferences } from '../../core/storage/storage.ts';
import { researchProduct, safeWebUrl } from '../../core/services/product-research.ts';
export function ReferencesTab({ sheet, onUpdateSheet }: { sheet: CentralProductSheet; onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const live = useRef(sheet); live.current = sheet;
  const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const name = sheet.titleBling?.value || sheet.title.value;
  const evidence = [sheet.ean, sheet.ncm, sheet.brand, sheet.model, ...sheet.attributes.map(a => a.field)].map(f => f.evidence).filter(e => e?.sourceUrl && safeWebUrl(e.sourceUrl));
  return <section className="space-y-4 text-xs">
    <div className="rounded-2xl border bg-white p-4 space-y-3"><h2 className="font-bold text-base">Pesquisa e referências</h2><p>Busca com fontes consultadas pelo Gemini. Os resultados ficam separados da ficha até você conferir e editar os campos.</p>
      <button disabled={busy || !name} className="rounded-lg bg-blue-700 text-white px-3 py-2 disabled:opacity-40" onClick={async () => {
        if (lock.current) return; lock.current = true; setBusy(true); setMessage(''); const snapshot = structuredClone(sheet);
        try {
          const prefs = await loadSellerPreferences(); const references = await researchProduct(snapshot, prefs.geminiApiKey || '');
          if (!mounted.current) return;
          if (JSON.stringify(live.current) !== JSON.stringify(snapshot)) throw new Error('A ficha mudou durante a pesquisa. Pesquise novamente.');
          onUpdateSheet(s => JSON.stringify(s) === JSON.stringify(snapshot) ? { ...s, workbench: { ...s.workbench, references } } : s);
          setMessage(`${references.length} fontes retornadas. Confira identidade e variação do produto.`);
        } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : 'Falha ao pesquisar.'); }
        finally { lock.current = false; if (mounted.current) setBusy(false); }
      }}>{busy ? 'Pesquisando fontes…' : 'Pesquisar produto na web'}</button>
      {message && <p role="status">{message}</p>}
    </div>
    {(sheet.workbench?.references || []).filter(r => safeWebUrl(r.url)).map(ref => <article key={ref.url} className="rounded-xl border bg-white p-4 space-y-2"><a href={ref.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 break-words">{ref.title} ↗</a><p className="whitespace-pre-wrap select-text">{ref.snippet || 'Abra a fonte para conferir o conteúdo.'}</p><p className="text-slate-500">Consultada em {new Date(ref.retrievedAt).toLocaleString('pt-BR')}</p></article>)}
    <div className="rounded-2xl border bg-white p-4 space-y-3"><h3 className="font-bold">Fontes registradas nos campos</h3>{evidence.length ? evidence.map((ref, i) => <div key={i}><a className="text-blue-700" href={ref!.sourceUrl} target="_blank" rel="noreferrer">{ref!.sourceName || 'Fonte'} ↗</a><p>{ref!.extractedSnippet}</p></div>) : <p>Ainda não há fontes com URL nos campos.</p>}</div>
    {name && <div className="rounded-2xl border bg-white p-4 space-y-2"><h3 className="font-bold">Abrir busca manual</h3><p>Estes atalhos não são fontes consultadas.</p><a className="text-blue-700 block" href={`https://www.google.com/search?q=${encodeURIComponent(name + ' fabricante ficha técnica')}`} target="_blank" rel="noreferrer">Fabricante e ficha técnica ↗</a><a className="text-blue-700 block" href={`https://lista.mercadolivre.com.br/${encodeURIComponent(name)}`} target="_blank" rel="noreferrer">Buscar no Mercado Livre ↗</a></div>}
  </section>;
}
