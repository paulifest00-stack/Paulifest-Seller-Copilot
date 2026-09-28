import { useState, useRef } from 'react';
import { Sparkles, Copy, Check, FileText } from 'lucide-react';
import { createAuditedField, type CentralProductSheet } from '../../core/schema/product.ts';
import { loadSellerPreferences } from '../../core/storage/storage.ts';
import {
  applyListingContent,
  generateListingContent,
  type ContentKind
} from '../../core/services/listing-content.ts';

type Props = {
  sheet: CentralProductSheet;
  onUpdateSheet: (fn: (sheet: CentralProductSheet) => CentralProductSheet) => void;
};

export function ListingContent({ sheet, onUpdateSheet }: Props) {
  const [busy, setBusy] = useState<ContentKind | null>(null);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const live = useRef(sheet);
  live.current = sheet;

  const generate = async (kind: ContentKind) => {
    const snapshot = structuredClone(sheet);
    setBusy(kind);
    setMessage('');
    try {
      const prefs = await loadSellerPreferences();
      if (!prefs.geminiApiKey?.trim()) throw new Error('Configure sua chave Gemini na etapa Produto, em Configurar, para gerar conteúdo com IA.');
      const value = await generateListingContent(snapshot, prefs.geminiApiKey, kind);
      if (JSON.stringify(live.current) !== JSON.stringify(snapshot)) {
        throw new Error('A ficha mudou durante a geração. Gere novamente para usar os dados atuais.');
      }
      onUpdateSheet(current => applyListingContent(current, snapshot, kind, value));
      setMessage(kind === 'title' ? 'Título preenchido. Revise a sugestão na ficha.' : 'Descrição preenchida. Revise antes de usar.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao gerar conteúdo.');
    } finally {
      setBusy(null);
    }
  };

  const handleCopyDescription = () => {
    if (!sheet.descriptionPlain.value) return;
    void navigator.clipboard.writeText(sheet.descriptionPlain.value).then(
      () => {
        setCopied(true);
        setMessage('Descrição copiada para a área de transferência.');
        setTimeout(() => setCopied(false), 1500);
      },
      () => setMessage('Não foi possível copiar. Selecione o texto manualmente.')
    );
  };

  return (
    <section className="apple-glass-card rounded-2xl p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]" htmlFor="listing-description">
          <FileText className="w-3.5 h-3.5 text-[#0071e3]" />
          <span>Descrição Completa do Produto</span>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!sheet.descriptionPlain.value}
            onClick={handleCopyDescription}
            className="text-[10px] text-[#86868b] hover:text-[#0071e3] disabled:opacity-40 flex items-center gap-1 font-medium"
          >
            {copied ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : <Copy className="w-2.5 h-2.5" />}
            <span>{copied ? 'Copiado!' : 'Copiar descrição'}</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void generate('descriptionPlain')}
          className="px-3 py-1.5 rounded-lg bg-[#0071e3] hover:bg-[#0077ed] text-white text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50 transition-all shadow-sm"
        >
          <Sparkles className={`w-3 h-3 ${busy === 'descriptionPlain' ? 'animate-spin' : ''}`} />
          <span>{busy === 'descriptionPlain' ? 'Gerando descrição completa...' : 'Gerar descrição com IA'}</span>
        </button>

        <button
          type="button"
          disabled={!!busy}
          onClick={() => void generate('title')}
          className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#0071e3] border border-blue-200/60 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50 transition-all"
        >
          <Sparkles className={`w-3 h-3 ${busy === 'title' ? 'animate-spin' : ''}`} />
          <span>{busy === 'title' ? 'Otimizando...' : 'Otimizar título ML com IA'}</span>
        </button>
      </div>

      {sheet.descriptionPlain.status === 'pending_review' && <button className="text-xs text-blue-700 font-semibold" onClick={() => onUpdateSheet(current => ({ ...current, descriptionPlain: { ...current.descriptionPlain, status: 'approved' } }))}>Aprovar descrição revisada</button>}
      <textarea
        id="listing-description"
        rows={8}
        value={sheet.descriptionPlain.value}
        onChange={e => {
          const value = e.target.value;
          onUpdateSheet(current => ({
            ...current,
            descriptionPlain: createAuditedField(value, 'user_manual', 1, value.trim() ? 'approved' : 'missing')
          }));
        }}
        className="w-full p-2.5 bg-white border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 rounded-xl text-xs leading-relaxed outline-none"
        placeholder="Clique em 'Gerar descrição com IA' para montar uma descrição comercial e técnica completa, ou digite/edite livremente aqui."
      />

      {message && <p role="status" className="text-[11px] text-[#0071e3] font-medium whitespace-pre-wrap">{message}</p>}
    </section>
  );
}
