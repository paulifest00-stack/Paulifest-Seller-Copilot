import { useState } from 'react';
import { Layers, CheckCircle2 } from 'lucide-react';
import type { CentralProductSheet } from '../../core/schema/product.ts';
import { buildNewProductFormValues } from '../../integrations/bling/new-product-form.ts';

type Target = { tabId: number; pageInstanceId: string; url: string };

export function NewBlingProduct({ sheet, target }: { sheet: CentralProductSheet; target: Target }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const values = buildNewProductFormValues(sheet);
  const labels: Record<string, string> = {
    nome: 'Nome',
    codigo: 'SKU',
    gtin: 'EAN',
    marca: 'Marca',
    ncm: 'NCM',
    descricaoComplementar: 'Descrição'
  };

  const fill = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await chrome.tabs.sendMessage(
        target.tabId,
        { type: 'BLING_FILL_NEW_PRODUCT', pageInstanceId: target.pageInstanceId, url: target.url, values },
        { frameId: 0 }
      );
      if (!result?.ok) throw new Error(result?.error || 'O Bling não confirmou o preenchimento.');
      setMessage(
        `Preenchidos: ${result.filled.map((k: string) => labels[k] || k).join(', ') || 'nenhum'}. ${
          result.skipped.length
            ? 'Campos já preenchidos ou ocultos: ' + result.skipped.map((k: string) => labels[k] || k).join(', ') + '.'
            : ''
        } Confira o formulário e clique em Salvar no Bling.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recarregue a página do Bling e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="apple-glass-card rounded-2xl p-4 border border-emerald-200 bg-emerald-50/50 space-y-2.5 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-[#1d1d1f] flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-emerald-600" />
            <span>Preencher Cadastro Novo no Bling</span>
          </h3>
          <p className="text-[10px] text-[#6e6e73]">
            Todos os campos abaixo já estão prontos para preencher o formulário aberto no Bling.
          </p>
        </div>
      </div>

      {Object.keys(values).length > 0 ? (
        <dl className="bg-white/90 rounded-xl border border-emerald-200/70 p-2.5 space-y-1.5 text-[11px]">
          {Object.entries(values).map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-2 border-b border-black/[0.04] last:border-0 pb-1 last:pb-0">
              <dt className="font-semibold text-[#6e6e73] shrink-0">{labels[key]}</dt>
              <dd className="text-right font-medium text-[#1d1d1f] break-words max-h-20 overflow-auto">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[11px] text-[#6e6e73]">Preencha os campos da ficha acima para enviar ao formulário do Bling.</p>
      )}

      <button
        type="button"
        disabled={busy || !Object.keys(values).length}
        onClick={() => void fill()}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl px-3 py-2.5 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-sm"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>{busy ? 'Preenchendo...' : 'Preencher cadastro no Bling'}</span>
      </button>

      {message && <p role="status" className="text-[11px] text-emerald-800 font-medium">{message}</p>}
    </section>
  );
}
