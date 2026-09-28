import { Trash2, ArrowRight } from 'lucide-react';
import type { CentralProductSheet } from '../../core/schema/product.ts';

type Props = {
  draft?: CentralProductSheet;
  ready: boolean;
  starting: boolean;
  connected: boolean;
  activeBlingProductId?: string;
  onCreate: () => void;
  onImport: () => void;
  onPullActiveBlingToMl?: () => void;
  onResume: () => void;
  onResumeExportMl?: () => void;
  onDeleteDraft?: () => void;
  onLibrary: () => void;
};

export function StartScreen({
  draft,
  ready,
  starting,
  connected,
  activeBlingProductId,
  onCreate,
  onImport,
  onPullActiveBlingToMl,
  onResume,
  onResumeExportMl,
  onDeleteDraft,
  onLibrary
}: Props) {
  return (
    <section className="space-y-2.5">
      {activeBlingProductId && onPullActiveBlingToMl && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-emerald-950 truncate">
            Bling #{activeBlingProductId} aberto
          </span>
          <button
            type="button"
            disabled={!ready || starting}
            onClick={onPullActiveBlingToMl}
            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold flex items-center gap-1 flex-shrink-0"
          >
            <span>Exportar p/ ML</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        <button
          disabled={!ready || starting}
          onClick={onCreate}
          className="w-full text-left rounded-xl bg-[#0071e3] hover:bg-[#0077ed] disabled:opacity-50 text-white p-3 transition-all"
        >
          <strong className="block text-xs font-semibold">
            {starting ? 'Preparando…' : 'Novo produto (Bling → ML)'}
          </strong>
          <span className="block mt-0.5 text-[11px] text-blue-100">
            Criar ficha técnica para o Bling e exportar ao Mercado Livre
          </span>
        </button>

        <button
          disabled={!ready || starting}
          onClick={onImport}
          className="w-full text-left rounded-xl border border-black/[0.08] bg-white hover:border-[#0071e3]/40 disabled:opacity-50 p-3 transition-all"
        >
          <strong className="block text-xs font-semibold text-[#1d1d1f]">
            Importar do Bling p/ Mercado Livre
          </strong>
          <span className="block mt-0.5 text-[11px] text-[#6e6e73]">
            {connected
              ? 'Buscar produto já cadastrado no Bling e puxar todos os dados'
              : 'Conectar Bling para buscar produtos cadastrados'}
          </span>
        </button>
      </div>

      {draft && (
        <div className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">
              Rascunho atual
            </span>
            {onDeleteDraft && (
              <button
                type="button"
                onClick={onDeleteDraft}
                className="text-[11px] text-[#86868b] hover:text-rose-600 flex items-center gap-1 transition-colors"
                title="Apagar rascunho"
              >
                <Trash2 className="w-3 h-3" />
                <span>Apagar</span>
              </button>
            )}
          </div>
          <p className="font-semibold text-xs text-[#1d1d1f] truncate">
            {draft.titleBling?.value || draft.title.value || 'Produto sem nome'}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onResume}
              className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-[11px] font-semibold text-[#0071e3]"
            >
              Continuar
            </button>
            {onResumeExportMl && (
              <button
                type="button"
                onClick={onResumeExportMl}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-medium text-[#1d1d1f] flex items-center gap-1"
              >
                <span>Anúncio ML</span>
                <ArrowRight className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="pt-0.5">
        <button
          disabled={!ready}
          onClick={onLibrary}
          className="text-xs font-medium text-[#0071e3] hover:underline disabled:opacity-50"
        >
          Gerenciar rascunhos salvos →
        </button>
      </div>
    </section>
  );
}
