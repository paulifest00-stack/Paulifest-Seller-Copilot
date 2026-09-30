import { useEffect, useRef, useState } from 'react';
import { Trash2, RefreshCw, ArrowRight, Search } from 'lucide-react';
import type { CentralProductSheet } from '../../core/schema/product.ts';
import { createInitialSheet } from '../../core/schema/product.ts';
import { clearAllSavedSheets, deleteSheet, listSavedSheets, saveSheet } from '../../core/storage/storage.ts';
import { mapBlingProductToSheetPatch } from '../../integrations/bling/bling-to-sheet.mapper.ts';
import { reconcileBlingPatch } from '../../integrations/bling/reconciliation.ts';
import { prepareBlingSheetForMlExport } from '../../core/engines/identification/sheet-adapter.ts';

type Item = { id: string; name: string; sku: string; price: number | null };

export function ProductLibrary({
  currentId,
  connected,
  activeBlingProductId,
  onOpen,
  onNew,
  onDeleteDraft,
  onConnectBling,
  initiallyExpanded = false,
  initialSource = 'saved'
}: {
  currentId: string;
  connected: boolean;
  activeBlingProductId?: string;
  initiallyExpanded?: boolean;
  initialSource?: 'saved' | 'bling';
  onOpen: (sheet: CentralProductSheet, targetStep?: number) => Promise<void>;
  onNew: () => Promise<void>;
  onDeleteDraft?: (deletedId: string, deletedAll?: boolean) => void;
  onConnectBling?: () => void;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [source, setSource] = useState<'saved' | 'bling'>(initialSource);
  const [query, setQuery] = useState('');
  const [searchBy, setSearchBy] = useState('name');
  const [saved, setSaved] = useState<CentralProductSheet[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const autoLoadedBling = useRef(false);

  const refreshSaved = () => {
    void listSavedSheets().then(
      value => setSaved(value),
      () => setError('Não foi possível carregar suas fichas.')
    );
  };

  useEffect(() => {
    let live = true;
    void listSavedSheets().then(
      value => { if (live) setSaved(value); },
      () => { if (live) setError('Não foi possível carregar suas fichas.'); }
    );
    const listener = () => {
      if (live) refreshSaved();
    };
    if (typeof chrome !== 'undefined') chrome.storage?.onChanged.addListener(listener);
    return () => {
      live = false;
      if (typeof chrome !== 'undefined') chrome.storage?.onChanged.removeListener(listener);
    };
  }, [expanded, currentId]);

  const search = async (targetPage = 1, customQuery = query, customSearchBy = searchBy) => {
    const request = ++revision.current;
    setBusy(true);
    setError('');
    try {
      const numericIdMatch = customQuery.trim().match(/^#?(\d{5,20})$/);
      if (numericIdMatch) {
        const directRes = await chrome.runtime.sendMessage({ type: 'BLING_CATALOG_PRODUCT', productId: numericIdMatch[1] });
        if (request !== revision.current) return;
        if (directRes?.ok && directRes.product) {
          setItems([{
            id: String(directRes.product.id || numericIdMatch[1]),
            name: String(directRes.product.nome || `Produto #${numericIdMatch[1]}`),
            sku: String(directRes.product.codigo || ''),
            price: typeof directRes.product.preco === 'number' ? directRes.product.preco : null
          }]);
          setPage(1);
          setHasMore(false);
          return;
        }
      }

      const result = await chrome.runtime.sendMessage({
        type: 'BLING_SEARCH_PRODUCTS',
        query: customQuery.trim(),
        searchBy: customSearchBy,
        page: targetPage
      });
      if (request !== revision.current) return;
      if (!result?.ok) throw new Error(result?.error || 'Não foi possível consultar o catálogo do Bling.');
      setItems(Array.isArray(result.items) ? result.items : []);
      setPage(result.page !== undefined ? result.page : targetPage);
      setHasMore(Boolean(result.hasMore));
    } catch (e) {
      if (request === revision.current) setError(e instanceof Error ? e.message : 'Falha na consulta ao Bling.');
    } finally {
      if (request === revision.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (expanded && source === 'bling' && connected && typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function') {
      if (!autoLoadedBling.current || items.length === 0) {
        autoLoadedBling.current = true;
        void search(1, query, searchBy);
      }
    }
  }, [expanded, source, connected]);

  const open = async (product: CentralProductSheet, targetStep = 2) => {
    setBusy(true);
    setError('');
    try {
      await onOpen(product, targetStep);
      setExpanded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao abrir ficha.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteOne = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setError('');
    try {
      await deleteSheet(id);
      setSaved(prev => prev.filter(s => s.id !== id));
      onDeleteDraft?.(id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível apagar o rascunho.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAll = async () => {
    if (saved.length === 0) return;
    setBusy(true);
    setError('');
    try {
      await clearAllSavedSheets();
      setSaved([]);
      onDeleteDraft?.('', true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível apagar os rascunhos.');
    } finally {
      setBusy(false);
    }
  };

  const importProduct = async (id: string, targetStep = 4) => {
    const request = ++revision.current;
    setBusy(true);
    setError('');
    try {
      const existing = saved.find(s => s.externalReferences.some(r => r.system === 'bling' && String(r.externalId) === id));
      const result = await chrome.runtime.sendMessage({ type: 'BLING_CATALOG_PRODUCT', productId: id });
      if (request !== revision.current) return;
      if (!result?.ok) {
        if (existing) {
          await open(prepareBlingSheetForMlExport(existing), targetStep);
          return;
        }
        throw new Error(result?.error || 'Não foi possível importar este produto do Bling.');
      }
      const mapped = mapBlingProductToSheetPatch(result.product, {
        externalId: id,
        retrievedAt: result.retrievedAt,
        sourceName: 'Bling ERP (API Oficial v3)',
        confirmedUnits: { weight: 'kg', dimension: 'cm' }
      });
      const base = existing || createInitialSheet();
      const reconciled = reconcileBlingPatch(base, mapped).sheet;
      const productReadyForMl = prepareBlingSheetForMlExport(reconciled);
      await saveSheet(productReadyForMl);
      await onOpen(productReadyForMl, targetStep);
      setExpanded(false);
    } catch (e) {
      if (request === revision.current) setError(e instanceof Error ? e.message : 'Falha ao importar produto do Bling.');
    } finally {
      if (request === revision.current) setBusy(false);
    }
  };

  const term = query.toLocaleLowerCase();
  const filtered = saved.filter(s =>
    [s.titleBling?.value, s.title.value, s.sku.value, s.ean.value].some(v => v?.toLocaleLowerCase().includes(term))
  );

  return (
    <section className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-2.5 text-xs">
      <div className="flex justify-between items-center gap-2">
        <button className="font-semibold text-[#0071e3]" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Fechar' : 'Rascunhos & Catálogo Bling'}
        </button>
        <button
          disabled={busy}
          onClick={() => void onNew().catch(() => setError('Não foi possível iniciar a ficha.'))}
          className="px-2 py-1 rounded-lg bg-blue-50 text-[#0071e3] text-[11px] font-semibold hover:bg-blue-100"
        >
          + Novo
        </button>
      </div>

      {expanded && (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-0.5 text-[11px]">
            <button
              type="button"
              className={`py-1.5 rounded-md font-semibold transition-all ${
                source === 'saved' ? 'bg-white text-[#1d1d1f] shadow-xs' : 'text-slate-600'
              }`}
              onClick={() => setSource('saved')}
            >
              Rascunhos ({saved.length})
            </button>
            <button
              type="button"
              className={`py-1.5 rounded-md font-semibold transition-all ${
                source === 'bling' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
              }`}
              onClick={() => setSource('bling')}
            >
              Catálogo Bling
            </button>
          </div>

          {source === 'bling' && activeBlingProductId && connected && (
            <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 px-2.5 py-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-emerald-950 truncate">
                Aberto na aba: #{activeBlingProductId}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void importProduct(activeBlingProductId, 4)}
                className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold flex items-center gap-1 flex-shrink-0"
              >
                <span>Exportar p/ ML</span>
                <ArrowRight className="w-2.5 h-2.5" />
              </button>
            </div>
          )}

          <form
            className="flex gap-1.5"
            onSubmit={e => {
              e.preventDefault();
              if (source === 'bling') void search(1);
            }}
          >
            <div className="relative flex-1 min-w-0">
              <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                aria-label="Buscar produto"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={
                  source === 'saved'
                    ? 'Filtrar rascunhos...'
                    : 'Nome, SKU ou #ID (vazio = listar todos)'
                }
                className="w-full pl-7 pr-2 py-1.5 border border-black/[0.1] rounded-lg text-[11px] outline-none focus:border-[#0071e3]"
              />
            </div>
            {source === 'bling' && (
              <>
                <select
                  aria-label="Buscar por"
                  value={searchBy}
                  onChange={e => setSearchBy(e.target.value)}
                  className="border border-black/[0.1] rounded-lg px-1.5 py-1.5 bg-slate-50 text-[11px]"
                >
                  <option value="name">Nome</option>
                  <option value="sku">SKU</option>
                </select>
                <button
                  type="submit"
                  disabled={busy || !connected}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0071e3] text-white text-[11px] font-semibold disabled:opacity-40"
                >
                  Buscar
                </button>
              </>
            )}
          </form>

          {source === 'bling' && !connected && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 flex items-center justify-between gap-2 text-[11px] text-amber-950">
              <span>Bling desconectado.</span>
              {onConnectBling && (
                <button
                  type="button"
                  onClick={onConnectBling}
                  className="px-2.5 py-1 rounded-md bg-amber-600 text-white font-semibold"
                >
                  Conectar →
                </button>
              )}
            </div>
          )}

          {source === 'saved' && saved.length > 0 && (
            <div className="flex items-center justify-between px-0.5 text-[11px] text-slate-500">
              <span>{filtered.length} rascunho(s)</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDeleteAll()}
                className="text-rose-600 hover:underline font-medium flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                <span>Limpar tudo</span>
              </button>
            </div>
          )}

          <div className="max-h-72 overflow-auto space-y-1.5">
            {source === 'saved'
              ? filtered.map(s => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 border border-black/[0.07] rounded-lg p-2 hover:border-[#0071e3]/40 transition-all"
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void open(s, 2)}
                      className="flex-1 text-left min-w-0"
                    >
                      <strong className="block truncate text-[11px] text-[#1d1d1f]">
                        {s.titleBling?.value || s.title.value || 'Sem nome'}
                      </strong>
                      <span className="text-[10px] text-[#86868b] font-mono">
                        {s.sku.value || 'Sem SKU'}
                      </span>
                    </button>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void open(prepareBlingSheetForMlExport(s), 4)}
                        className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-[#1d1d1f] font-semibold text-[10px]"
                        title="Ir direto para Anúncio ML"
                      >
                        ML →
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={e => void handleDeleteOne(s.id, e)}
                        aria-label={`Apagar rascunho ${s.titleBling?.value || s.title.value || s.id}`}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Apagar rascunho"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              : items.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 border border-black/[0.07] rounded-lg p-2 hover:border-emerald-300 transition-all"
                  >
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[11px] text-[#1d1d1f]">{item.name}</strong>
                      <span className="text-[10px] text-[#86868b] font-mono">
                        {item.sku || `#${item.id}`}
                        {item.price !== null ? ` · R$ ${item.price.toFixed(2).replace('.', ',')}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        disabled={busy || !connected}
                        onClick={() => void importProduct(item.id, 2)}
                        className="px-2 py-1 rounded-md border border-black/[0.1] bg-white hover:bg-slate-50 text-[#1d1d1f] font-medium text-[10px]"
                      >
                        Ficha
                      </button>
                      <button
                        type="button"
                        disabled={busy || !connected}
                        onClick={() => void importProduct(item.id, 4)}
                        className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[10px]"
                      >
                        Exportar ML →
                      </button>
                    </div>
                  </div>
                ))}
          </div>

          {source === 'saved' && filtered.length === 0 && (
            <p className="text-[11px] text-slate-400 py-1">Nenhum rascunho salvo.</p>
          )}

          {source === 'bling' && connected && (items.length > 0 || page > 1) && (
            <div className="flex justify-between items-center pt-0.5 text-[11px]">
              <button
                type="button"
                disabled={busy || page <= 1 || !connected}
                onClick={() => void search(page - 1)}
                className="px-2 py-1 rounded border border-black/[0.1] disabled:opacity-40"
              >
                ← Ant.
              </button>
              <span className="text-slate-500">Pág. {page}</span>
              <button
                type="button"
                disabled={busy || !hasMore || !connected}
                onClick={() => void search(page + 1)}
                className="px-2 py-1 rounded border border-black/[0.1] disabled:opacity-40"
              >
                Próx. →
              </button>
            </div>
          )}

          {busy && (
            <p role="status" className="text-[#0071e3] text-[11px] flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Carregando…</span>
            </p>
          )}
          {source === 'bling' && !busy && !items.length && connected && (
            <p className="text-[11px] text-slate-400">
              Nenhum produto encontrado. Clique em Buscar para listar seu catálogo.
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 text-[11px]">
          {error}
        </p>
      )}
    </section>
  );
}
