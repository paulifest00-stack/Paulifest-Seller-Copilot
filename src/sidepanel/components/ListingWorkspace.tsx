import { MlPublishPanel } from './MlPublishPanel.tsx';
import { useEffect, useRef, useState } from 'react';
import { createAuditedField, type CentralProductSheet } from '../../core/schema/product.ts';
import { ListingContent } from './ListingContent.tsx';
import { ProductPhoto } from './ProductPhoto.tsx';
import { PanelDialog } from './PanelDialog.tsx';
import { loadSellerPreferences } from '../../core/storage/storage.ts';
import { generateKeywords, applyKeywords, generateProductContent } from '../../core/services/product-content.ts';
import { prepareBlingSheetForMlExport } from '../../core/engines/identification/sheet-adapter.ts';
import { Copy, Sparkles, Eye } from 'lucide-react';

export function ListingWorkspace({ sheet, onBack, onUpdateSheet }: {
  sheet: CentralProductSheet; onBack: () => void;
  onUpdateSheet: (fn: (sheet: CentralProductSheet) => CentralProductSheet) => void;
}) {
  const [message, setMessage] = useState(''), [preview, setPreview] = useState(false), [busy, setBusy] = useState(false);
  const live = useRef(sheet); live.current = sheet;
  const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const needsTitle = !sheet.title.value.trim() && Boolean(sheet.titleBling?.value.trim());
    const needsPrice = (sheet.suggestedSalePrice.value === null || sheet.suggestedSalePrice.value <= 0) && Boolean(sheet.currentSalePrice.value && sheet.currentSalePrice.value > 0);
    const needsDesc = !sheet.descriptionPlain.value.trim() && Boolean(sheet.titleBling?.value.trim() || sheet.title.value.trim());
    if (needsTitle || needsPrice || needsDesc) {
      onUpdateSheet(current => prepareBlingSheetForMlExport(current));
    }
  }, [sheet.id]);

  const copy = async (text: string, label = 'Copiado para a área de transferência.') => {
    try { await navigator.clipboard.writeText(text); setMessage(label); }
    catch { setMessage('Não foi possível copiar. Selecione o texto na ficha.'); }
  };

  const generate = async (mode: 'keywords' | 'bling' | 'complete') => {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage('');
    const snapshot = structuredClone(sheet);
    try {
      const prefs = await loadSellerPreferences();
      if (!prefs.geminiApiKey) throw new Error('Configure sua chave Gemini na etapa Produto.');
      const result = mode === 'keywords' ? applyKeywords(snapshot, snapshot, await generateKeywords(snapshot, prefs.geminiApiKey)) : await generateProductContent(snapshot, prefs.geminiApiKey, mode, value => { if (mounted.current) setMessage(value); });
      if (!mounted.current) return;
      if (JSON.stringify(live.current) !== JSON.stringify(snapshot)) throw new Error('A ficha mudou durante a geração. Seus dados foram preservados.');
      onUpdateSheet(current => JSON.stringify(current) === JSON.stringify(snapshot) ? result : current);
      setMessage('Conteúdo atualizado.');
    } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : 'Falha ao gerar conteúdo.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };

  const count = Array.from(sheet.title.value).length;
  const photo = sheet.images.find(i => i.isMain) || sheet.images[0];
  const keywords = sheet.workbench?.keywords;
  const labels = { principais: 'Principais', relacionadas: 'Relacionadas', variacoes: 'Alternativas' };
  const effectivePrice = sheet.suggestedSalePrice.value ?? sheet.currentSalePrice.value;

  const buildCompleteExportText = () => {
    const sections: string[] = [];
    if (sheet.title.value) sections.push(`TÍTULO MERCADO LIVRE:\n${sheet.title.value}`);
    if (sheet.titleBling?.value) sections.push(`NOME NO BLING:\n${sheet.titleBling.value}`);
    const meta: string[] = [];
    if (sheet.sku.value) meta.push(`SKU: ${sheet.sku.value}`);
    if (sheet.ean.value) meta.push(`EAN/GTIN: ${sheet.ean.value}`);
    if (sheet.ncm.value) meta.push(`NCM: ${sheet.ncm.value}`);
    if (sheet.brand.value) meta.push(`Marca: ${sheet.brand.value}`);
    if (sheet.model.value) meta.push(`Modelo: ${sheet.model.value}`);
    if (effectivePrice !== null && effectivePrice !== undefined) meta.push(`Preço: R$ ${effectivePrice.toFixed(2).replace('.', ',')}`);
    if (sheet.packageWeightKg.value) meta.push(`Peso: ${sheet.packageWeightKg.value} kg`);
    if (sheet.packageHeightCm.value || sheet.packageWidthCm.value || sheet.packageLengthCm.value) {
      meta.push(`Medidas: ${sheet.packageHeightCm.value}x${sheet.packageWidthCm.value}x${sheet.packageLengthCm.value} cm`);
    }
    for (const attr of sheet.attributes) {
      if (attr.name && attr.field.value) meta.push(`${attr.name}: ${attr.field.value}`);
    }
    if (meta.length) sections.push(`FICHA TÉCNICA:\n${meta.join('\n')}`);
    if (sheet.descriptionPlain.value) sections.push(`DESCRIÇÃO:\n${sheet.descriptionPlain.value}`);
    return sections.join('\n\n');
  };

  return <section className="space-y-2.5 text-xs">
    {/* Barra minimalista de resumo e exportação rápida */}
    <div className="rounded-xl border border-black/[0.08] bg-white px-3 py-2 flex items-center justify-between gap-2">
      <div className="min-w-0 text-[11px] text-[#6e6e73] truncate font-mono">
        {sheet.sku.value || 'Sem SKU'}
        {sheet.ncm.value ? ` · NCM ${sheet.ncm.value}` : ''}
        {effectivePrice != null ? ` · R$ ${effectivePrice.toFixed(2).replace('.', ',')}` : ''}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={() => void copy(buildCompleteExportText(), 'Pacote completo copiado!')}
          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold flex items-center gap-1"
          title="Copiar Título ML, SKU, EAN, NCM, Ficha Técnica e Descrição"
        >
          <Copy className="w-3 h-3" />
          <span>Copiar tudo</span>
        </button>
        <button
          onClick={() => setPreview(true)}
          className="px-2 py-1 rounded-lg border border-black/[0.1] bg-white hover:bg-slate-50 text-[11px] font-medium flex items-center gap-1"
        >
          <Eye className="w-3 h-3 text-[#0071e3]" />
          <span>Prévia</span>
        </button>
      </div>
    </div>

    {/* Título do Mercado Livre (60 caracteres) */}
    <div className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="ml-title-input" className="font-semibold text-xs text-[#1d1d1f]">
          Título no Mercado Livre
        </label>
        <div className="flex items-center gap-2">
          <button
            disabled={sheet.title.status === 'conflict'}
            onClick={() => void copy(sheet.title.value, 'Título ML copiado!')}
            className="text-[10px] text-[#0071e3] hover:underline font-medium"
          >
            Copiar
          </button>
          <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${count > 60 ? 'bg-red-100 text-red-700 font-bold' : 'bg-slate-100 text-slate-600'}`}>
            {count}/60
          </span>
        </div>
      </div>
      <input
        id="ml-title-input"
        aria-label="Título"
        value={sheet.title.value}
        onChange={e => {
          const value = e.target.value;
          onUpdateSheet(s => ({ ...s, title: createAuditedField(value, 'user_manual', 1, value.trim() ? 'approved' : 'missing') }));
        }}
        placeholder="Ex: Luva Nitrílica Bompack Preta 100un Sem Pó"
        className="w-full border border-black/[0.1] rounded-lg px-2.5 py-1.5 text-xs focus:border-[#0071e3] outline-none"
      />
      <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${count > 60 ? 'bg-red-500' : 'bg-[#0071e3]'}`} style={{ width: `${Math.min(count / 60 * 100, 100)}%` }} />
      </div>
      <div className="flex gap-1.5 flex-wrap pt-0.5">
        <button
          disabled={busy}
          onClick={() => void generate('complete')}
          className="rounded-lg bg-[#0071e3] hover:bg-[#0077ed] text-white px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40 flex items-center gap-1"
        >
          <Sparkles className="w-3 h-3" />
          <span>{busy ? 'Gerando…' : 'Gerar com IA'}</span>
        </button>
        <button
          disabled={busy}
          onClick={() => void generate('bling')}
          className="rounded-lg border border-black/[0.1] px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40"
        >
          Modo econômico
        </button>
        <button
          onClick={onBack}
          className="ml-auto text-[11px] text-[#6e6e73] hover:text-[#1d1d1f]"
        >
          ← Ficha
        </button>
      </div>
    </div>

    {/* Descrição Completa */}
    <ListingContent sheet={sheet} onUpdateSheet={onUpdateSheet} />

    {/* Palavras-chave SEO */}
    <div className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-2">
      <div className="flex justify-between items-center gap-2">
        <h3 className="font-semibold text-xs text-[#1d1d1f]">Palavras-chave SEO</h3>
        <button disabled={busy} className="text-[11px] text-[#0071e3] font-semibold disabled:opacity-40" onClick={() => void generate('keywords')}>
          ↻ Gerar
        </button>
      </div>
      {keywords ? (
        (Object.keys(labels) as (keyof typeof labels)[]).map(key => (
          <div key={key} className="space-y-1">
            <h4 className="text-[10px] font-semibold text-[#6e6e73]">{labels[key]}</h4>
            <div className="flex flex-wrap gap-1">
              {keywords.value[key].map(word => (
                <button
                  key={word}
                  onClick={() => void copy(word, `"${word}" copiado!`)}
                  className="rounded-md bg-slate-100 hover:bg-blue-50 text-[#1d1d1f] px-2 py-0.5 text-[11px]"
                >
                  {word}
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="text-[11px] text-[#86868b]">Clique em Gerar para sugerir tags de busca.</p>
      )}
    </div>

    {/* Publicação Direta via API no Mercado Livre (Recolhido por padrão) */}
    <details className="border border-black/[0.08] rounded-xl bg-white p-3 text-xs">
      <summary className="font-semibold text-[#0071e3] cursor-pointer text-xs">
        Publicar direto via API do Mercado Livre
      </summary>
      <div className="pt-2">
        <MlPublishPanel key={sheet.id} sheet={sheet} onUpdateSheet={onUpdateSheet} />
      </div>
    </details>

    {message && (
      <p role="status" className="rounded-lg bg-blue-50 border border-blue-200 text-blue-900 p-2 text-[11px] whitespace-pre-wrap">
        {message}
      </p>
    )}

    {preview && (
      <PanelDialog title="Prévia do anúncio" onClose={() => setPreview(false)}>
        <div className="space-y-2.5">
          <ProductPhoto url={photo?.url} alt="Imagem principal" className="w-full h-52 object-contain rounded-xl border" />
          <h3 className="font-semibold text-base">{sheet.title.value || 'Sem título'}</h3>
          <p className="text-lg font-bold text-emerald-700">
            {effectivePrice === null || effectivePrice === undefined
              ? 'Sem preço'
              : effectivePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
          <p className="whitespace-pre-wrap select-text text-xs">{sheet.descriptionPlain.value}</p>
        </div>
      </PanelDialog>
    )}
  </section>;
}
