import { useEffect, useState } from 'react';
import { Tag, ChevronDown, ChevronUp, Sparkles, Copy, Check } from 'lucide-react';
import { generateParentSku, generateChildSku, inferSkuBlocks, sanitizeSkuBlock, type SkuBlocks } from '../../core/engines/identification/sku-generator.ts';
import { createAuditedField, type CentralProductSheet } from '../../core/schema/product.ts';

export function SkuEditor({
  sheet,
  onUpdateSheet
}: {
  sheet: CentralProductSheet;
  onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void;
}) {
  const name = sheet.titleBling?.value || sheet.title.value;
  const [blocks, setBlocks] = useState(() => inferSkuBlocks(name, sheet.brand.value));
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setBlocks(inferSkuBlocks(name, sheet.brand.value));
    setMessage('');
  }, [name, sheet.brand.value]);

  let parent = '', candidate = '', error = '';
  try {
    parent = generateParentSku(blocks);
    candidate = blocks.variation ? generateChildSku(parent, blocks.variation) : parent;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Ajuste os blocos.';
  }

  const labels: Record<keyof SkuBlocks, string> = {
    brand: 'Marca (2-3 letras)',
    product: 'Produto (3-6 letras)',
    fixed: 'Atrib. Fixo (opcional)',
    quantity: 'Medida Base (opcional)',
    variation: 'Variação (Cor / Sabor / Tam)'
  };

  const handleCopy = () => {
    if (sheet.sku.value && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(sheet.sku.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <section className="apple-glass-card rounded-2xl p-3.5 space-y-2">
      <div className="flex justify-between items-center text-xs">
        <label className="font-semibold text-[#1d1d1f] flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-[#0071e3]" />
          <span>SKU</span>
        </label>
        <div className="flex items-center gap-2">
          {sheet.sku.value && (
            <button
              type="button"
              onClick={handleCopy}
              className="text-[10px] text-[#86868b] hover:text-[#0071e3] flex items-center gap-1 font-medium"
              title="Copiar SKU"
            >
              {copied ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          )}
          <button
            type="button"
            className="text-[11px] font-semibold text-[#0071e3] hover:underline flex items-center gap-1"
            onClick={() => {
              if (error) {
                setExpanded(true);
                setMessage(error);
                return;
              }
              onUpdateSheet(s => ({ ...s, sku: createAuditedField(candidate, 'user_manual', 1, 'approved') }));
              setMessage('');
            }}
          >
            <Sparkles className="w-3 h-3" />
            <span>Gerar SKU</span>
          </button>
        </div>
      </div>

      <input
        aria-label="SKU"
        placeholder={candidate ? `Sugestão: ${candidate}` : 'Ex: POPBALA-MOR'}
        className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-xs font-mono font-semibold text-[#1d1d1f] outline-none"
        value={sheet.sku.value}
        onChange={e => {
          const value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
          onUpdateSheet(s => ({ ...s, sku: createAuditedField(value, 'user_manual', 1, value ? 'approved' : 'missing') }));
        }}
      />

      <div className="flex items-center justify-between gap-1.5 flex-wrap pt-0.5">
        <button
          type="button"
          className="text-[10px] text-[#86868b] hover:text-[#1d1d1f] flex items-center gap-1 font-medium"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <span>{expanded ? 'Fechar blocos do SKU' : 'Personalizar blocos (Pai / Variação)'}</span>
        </button>
        <div className="flex items-center gap-1 flex-wrap">
          {candidate && sheet.sku.value !== candidate && (
            <button
              type="button"
              onClick={() => onUpdateSheet(s => ({ ...s, sku: createAuditedField(candidate, 'user_manual', 1, 'approved') }))}
              className="text-[10px] font-mono text-[#0071e3] bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded border border-blue-200/60"
              title="Clique para aplicar o SKU com variação"
            >
              Usar {candidate}
            </button>
          )}
          {parent && parent !== candidate && sheet.sku.value !== parent && (
            <button
              type="button"
              onClick={() => onUpdateSheet(s => ({ ...s, sku: createAuditedField(parent, 'user_manual', 1, 'approved') }))}
              className="text-[10px] font-mono text-[#6e6e73] bg-black/[0.04] hover:bg-black/[0.08] px-1.5 py-0.5 rounded border border-black/[0.08]"
              title="Clique para usar apenas o SKU base (sem sufixo de variação)"
            >
              Base {parent}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 pt-1.5 border-t border-black/[0.06] animate-fade-in">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(labels) as (keyof SkuBlocks)[]).map(key => (
              <label key={key} className={`text-[10px] text-[#6e6e73] font-medium ${key === 'variation' ? 'col-span-2' : ''}`}>
                <span className="block mb-0.5">{labels[key]}</span>
                <input
                  className="w-full border border-black/[0.1] bg-white rounded-lg px-2 py-1 text-xs font-mono text-[#1d1d1f] outline-none focus:border-[#0071e3]"
                  placeholder={key === 'quantity' ? 'Ex: 100, 150 (vazio se 1un)' : key === 'variation' ? 'Ex: AZ, MOR, P, 500' : ''}
                  value={blocks[key]}
                  onChange={e => setBlocks(b => ({ ...b, [key]: sanitizeSkuBlock(e.target.value) }))}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between text-[10px] bg-black/[0.03] px-2.5 py-1.5 rounded-lg">
            {parent ? (
              <span>Pai: <code className="font-mono font-bold text-[#1d1d1f]">{parent}</code></span>
            ) : (
              <span className="text-[#86868b]">Preencha Marca e Produto</span>
            )}
            {blocks.variation && candidate && (
              <span>Variação: <code className="font-mono font-bold text-[#0071e3]">{candidate}</code></span>
            )}
          </div>
        </div>
      )}

      {message && <p role="status" className="text-[11px] text-amber-700">{message}</p>}
    </section>
  );
}
