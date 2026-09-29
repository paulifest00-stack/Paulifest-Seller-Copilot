import { StartScreen } from './components/StartScreen.tsx';
import { MarketTab } from './components/MarketTab.tsx';
import { OverviewTab } from './components/OverviewTab.tsx';
import { ImagesTab } from './components/ImagesTab.tsx';
import { ReferencesTab } from './components/ReferencesTab.tsx';
import { VariationEditor } from './components/VariationEditor.tsx';
import { SidepanelContextSync, readPanelContext } from './context-sync.ts';
import React, { useEffect, useState, useRef } from 'react';
import {
  RefreshCw,
  ExternalLink,
  RotateCcw,
  Tag,
  AlertCircle,
  Trash2
} from 'lucide-react';
import type { PageContextState } from '../shared/types';
import type { CentralProductSheet } from '../core/schema/product.ts';
import { createInitialSheet } from '../core/schema/product.ts';
import {
  deleteSheet,
  listSavedSheets,
  loadActiveSheet,
  loadWorkspace, saveWorkspace,
  loadSheet,
  saveSheet
} from '../core/storage/storage.ts';
import { mapBlingProductToSheetPatch } from '../integrations/bling/bling-to-sheet.mapper.ts';
import { reconcileBlingPatch } from '../integrations/bling/reconciliation.ts';
import { prepareBlingSheetForMlExport } from '../core/engines/identification/sheet-adapter.ts';
import { ProductLibrary } from './components/ProductLibrary.tsx';
import { ListingWorkspace } from './components/ListingWorkspace.tsx';
import { StepInput } from './components/steps/StepInput.tsx';
import { StepSheet } from './components/steps/StepSheet.tsx';
import { StepPricing } from './components/steps/StepPricing.tsx';
import { BlingConnectionCard } from './components/BlingConnectionCard.tsx';
import type { BlingConnectionStatus, BlingUpdateProductMessageResponse } from '../shared/gateway-contracts.ts';

export const App: React.FC = () => {
  const contextSyncRef = useRef<SidepanelContextSync | null>(null);
  // 1. Contexto da Aba do Chrome
  const [context, setContext] = useState<PageContextState>({
    platform: 'neutral',
    contextType: 'neutral_standby',
    title: 'Carregando contexto...',
    url: '',
    detectedAt: new Date().toISOString(),
    summaryLabel: 'Verificando aba ativa...'
  });

  // 2. Estado do Fluxo de Cadastro
  const [screen, setScreen] = useState<'home' | 'product' | 'library' | 'connections'>('home');
  const [librarySource, setLibrarySource] = useState<'saved' | 'bling'>('saved');
  const [importAfterConnect, setImportAfterConnect] = useState(false);
  const [activeFlow, setActiveFlow] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [startingProduct, setStartingProduct] = useState(false);
  const [startError, setStartError] = useState('');
  const [refreshSpin, setRefreshSpin] = useState<boolean>(false);

  // 3. Ficha Central do Produto (SSOT)
  const [sheet, setSheet] = useState<CentralProductSheet>(createInitialSheet());
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // 4. Estado da Aba Conectada (Fase 4B)
  const [tabContext, setTabContext] = useState<any>(null);

  // 5. Estado de Conexão Bling (Fase 4C.4B)
  // AJUSTE OBRIGATÓRIO 5: blingStatusLoaded=false evita flash enganoso antes da hidratação
  const [blingStatus, setBlingStatus] = useState<BlingConnectionStatus>('disconnected');
  const [blingLastRefreshAt, setBlingLastRefreshAt] = useState<string | null>(null);
  const [blingStatusLoaded, setBlingStatusLoaded] = useState<boolean>(false);
  const [blingDisconnecting, setBlingDisconnecting] = useState<boolean>(false);

  // Carrega a ficha persistida e escuta o contexto do Service Worker
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const workspace = await loadWorkspace();
        const saved = workspace ? await loadSheet(workspace.sheetId) : await loadActiveSheet();
        if (disposed) return;
        if (saved) { sheetRef.current = saved; setSheet(saved); setActiveFlow(true); setCurrentStep(workspace?.step || 2); }
      } catch { setStartError('Não foi possível recuperar sua ficha. Tente abrir pela biblioteca.'); }
      finally { if (!disposed) setIsLoaded(true); }
    })();

    const contextSync = new SidepanelContextSync(readPanelContext, (res) => {
      setTabContext(res);
      if (res) {
        setContext(prev => ({ ...prev, platform: res.platform, url: res.url, title: res.url,
          summaryLabel: res.platform === 'bling' ? 'Bling ERP • ' + res.pageType : 'Contexto ativo' }));

      } else {
        setContext(prev => ({ ...prev, platform: 'neutral', url: '', title: '', summaryLabel: 'Aguardando contexto...' }));

      }
    }, () => setTabContext(null));
    contextSyncRef.current = contextSync;
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      void contextSync.refresh();

      // AJUSTE OBRIGATÓRIO 5: Consulta estado de conexão Bling na abertura/reabertura da Sidebar.
      // Não depende exclusivamente de evento passado — sempre busca estado atual do Background.
      chrome.runtime.sendMessage({ type: 'BLING_GET_CONNECTION_STATUS' }, (res) => {
        if (res && res.status) {
          setBlingStatus(res.status);
          setBlingLastRefreshAt(res.lastRefreshAt ?? null);
        }
        // Marca hidratação concluída independente de sucesso/erro
        setBlingStatusLoaded(true);
      });
    } else {

      setContext(prev => ({ ...prev, title: 'Prévia local', summaryLabel: 'Abra a extensão no Chrome para acompanhar a página' }));
      setBlingStatusLoaded(true); // Ambiente sem chrome.runtime — marca como carregado
    }

    // Listener para eventos em tempo real
    const listener = (message: any) => {
      if (message.type === 'CONTEXT_UPDATED' && message.payload) {
        void contextSync.refresh();
      }
      if (message.type === 'ACTIVE_TAB_CONTEXT_UPDATED') {
        void contextSync.refresh();
      }
      // Atualiza estado de conexão Bling em tempo real via broadcast do Background
      if (message.type === 'BLING_CONNECTION_STATUS_CHANGED') {
        setBlingStatus(message.status);
        setBlingLastRefreshAt(message.lastRefreshAt ?? null);
        // Garante que hidratação seja marcada mesmo se evento chegar antes da query inicial
        setBlingStatusLoaded(true);
      }
    };

    const onWindowMessage = (event: MessageEvent) => {
      const data = event?.data;
      if (!data || typeof data !== 'object' || data.type !== 'PAULIFEST_SYNC_WORKSPACE') return;
      void contextSync.refresh();
      void (async () => {
        try {
          const workspace = await loadWorkspace();
          const saved = workspace ? await loadSheet(workspace.sheetId) : await loadActiveSheet();
          if (disposed) return;
          if (saved) {
            sheetRef.current = saved;
            setSheet(saved);
            setActiveFlow(true);
            setCurrentStep(typeof data.targetStep === 'number' ? data.targetStep : (workspace?.step || 2));
            setScreen(data.targetScreen || 'product');
          } else if (data.targetScreen) {
            setScreen(data.targetScreen);
          }
        } catch {}
      })();
    };

    const onTabChanged = () => { void contextSync.refresh(); };
    if (typeof window !== 'undefined') window.addEventListener?.('message', onWindowMessage);
    if (typeof chrome !== 'undefined') chrome.tabs?.onActivated.addListener(onTabChanged);
    if (typeof chrome !== 'undefined') chrome.runtime?.onMessage.addListener(listener);
    return () => {
      contextSync.dispose();
      contextSyncRef.current = null;
      disposed = true;
      if (typeof window !== 'undefined') window.removeEventListener?.('message', onWindowMessage);
      if (typeof chrome !== 'undefined') chrome.tabs?.onActivated.removeListener(onTabChanged);
      if (typeof chrome !== 'undefined') chrome.runtime?.onMessage.removeListener(listener);
    };
  }, []);

  // Only explicit editor changes persist; context/Quick View hydration never writes a sheet.
  const [saveState, setSaveState] = useState('Salvo neste navegador');
  const saveRevision = useRef(0);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const handleUpdateSheet = (updater: (prev: CentralProductSheet) => CentralProductSheet) => {
    const updated = updater(sheetRef.current);
    if (updated === sheetRef.current) return;
    sheetRef.current = updated;
    setSheet(updated);
    if (isLoaded && activeFlow) {
      const revision = ++saveRevision.current;
      setSaveState('Salvando…');
      void saveSheet(updated).then(() => { if (revision === saveRevision.current) setSaveState('Salvo neste navegador'); },
        () => { if (revision === saveRevision.current) setSaveState('Não foi possível salvar. Tente novamente.'); });
    }
  };

  useEffect(() => {
    if (isLoaded && activeFlow) void saveWorkspace({ sheetId: sheet.id, step: currentStep }).catch(() => setSaveState('Falha ao salvar a posição de trabalho.'));
  }, [isLoaded, activeFlow, sheet.id, currentStep]);

  const openSavedProduct = async (product: CentralProductSheet, targetStep = 2) => {
    if (activeFlow && sheetRef.current.id !== product.id) await saveSheet(sheetRef.current);
    await saveWorkspace({ sheetId: product.id, step: targetStep });
    sheetRef.current = product; setSheet(product); setActiveFlow(true); setCurrentStep(targetStep); setScreen('product');
  };

  const handleDeleteDraft = async (targetId?: string, deletedAll = false) => {
    const idToRemove = targetId || sheetRef.current.id;
    try {
      if (!deletedAll && idToRemove) {
        await deleteSheet(idToRemove);
      }
      if (deletedAll || idToRemove === sheetRef.current.id) {
        const remaining = deletedAll ? [] : await listSavedSheets();
        if (remaining.length > 0) {
          const next = remaining[0];
          await saveWorkspace({ sheetId: next.id, step: 2 });
          sheetRef.current = next;
          setSheet(next);
          setActiveFlow(true);
          setCurrentStep(2);
        } else {
          const empty = createInitialSheet();
          sheetRef.current = empty;
          setSheet(empty);
          setActiveFlow(false);
          setCurrentStep(1);
          setScreen('home');
        }
      }
    } catch {
      setStartError('Não foi possível apagar o rascunho.');
    }
  };

  const handlePullActiveBlingToMl = async () => {
    const activeId = tabContext?.platform === 'bling' ? tabContext?.detectedProduct?.id : undefined;
    if (!activeId) return;
    if (blingStatus !== 'connected') {
      setImportAfterConnect(true);
      setScreen('connections');
      return;
    }
    setStartingProduct(true);
    setStartError('');
    try {
      if (activeFlow) await saveSheet(sheetRef.current);
      const savedList = await listSavedSheets();
      const existing = savedList.find(s => s.externalReferences.some(r => r.system === 'bling' && String(r.externalId) === String(activeId)));
      const result = await chrome.runtime.sendMessage({ type: 'BLING_CATALOG_PRODUCT', productId: String(activeId) });
      if (!result?.ok) throw new Error(result?.error || 'Não foi possível puxar os dados do produto no Bling.');
      const mapped = mapBlingProductToSheetPatch(result.product, {
        externalId: String(activeId),
        retrievedAt: result.retrievedAt,
        sourceName: 'Bling ERP (API Oficial v3)',
        confirmedUnits: { weight: 'kg', dimension: 'cm' },
        stockInfo: tabContext?.uiState?.quickView?.productId === String(activeId) ? tabContext.uiState.quickView.stockInfo : null
      });
      const reconciled = reconcileBlingPatch(existing || createInitialSheet(), mapped).sheet;
      const readyForMl = prepareBlingSheetForMlExport(reconciled);
      await saveSheet(readyForMl);
      await openSavedProduct(readyForMl, 4);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Falha ao puxar o produto do Bling.');
    } finally {
      setStartingProduct(false);
    }
  };

  const handleRefresh = () => {
    setRefreshSpin(true);
    void contextSyncRef.current?.refresh().finally(() => setRefreshSpin(false));
  };

  const handleStartNewProduct = async () => {
    if (startingProduct || !isLoaded) return;
    setStartingProduct(true); setStartError('');
    const target = tabContext;
    try {
      if (activeFlow) await saveSheet(sheetRef.current);
      const initial = createInitialSheet();
      await saveSheet(initial);
      if (target?.platform === 'bling' && target.pageType === 'product_form_new' && typeof target.tabId === 'number') {
        const result = await chrome.runtime.sendMessage({
          type: 'LINK_SHEET_TO_TAB', windowId: (await chrome.windows.getCurrent()).id,
          tabId: target.tabId, sheetId: initial.id,
          expectedPageInstanceId: target.pageInstanceId, expectedUrl: target.url
        });
        if (!result?.ok || !result.state) throw new Error(result?.error || 'Não foi possível vincular a ficha. Tente novamente.');
        setTabContext(result.state);
      }
      sheetRef.current = initial; setSheet(initial);
      setActiveFlow(true); setCurrentStep(1); setScreen('product');
    } catch (error) { setStartError(error instanceof Error ? error.message : 'Não foi possível iniciar o produto.'); }
    finally { setStartingProduct(false); }
  };

  const handleReset = () => { void handleStartNewProduct(); };

  const handleUpdateProductInBling = async (confirmedPatch: string): Promise<BlingUpdateProductMessageResponse> => {
    if (!tabContext?.tabId || !tabContext?.detectedProduct?.id || !tabContext?.activeSheetId) {
      return { ok: false, stale: true, error: 'O produto aberto ou a ficha vinculada mudou.' };
    }
    // Garante que a versão confirmada pelo usuário esteja persistida antes do Background relê-la.
    await saveSheet(sheet);
    const windowId = (await chrome.windows.getCurrent()).id;
    return await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'BLING_UPDATE_PRODUCT',
        tabId: tabContext.tabId,
        windowId,
        pageInstanceId: tabContext.pageInstanceId,
        contextRevision: tabContext.contextRevision,
        productId: tabContext.detectedProduct.id,
        sheetId: tabContext.activeSheetId,
        confirmed: true,
        confirmedPatch
      }, (response: BlingUpdateProductMessageResponse | undefined) => {
        const runtimeError = chrome.runtime.lastError;
        resolve(response || { ok: false, error: runtimeError?.message || 'O Background não respondeu.' });
      });
    });
  };

  // ---------------------------------------------------------------------------
  // Handlers de Conexão Bling (Fase 4C.4B)
  // Background é autoridade — UI apenas envia mensagens e reflete estado.
  // ---------------------------------------------------------------------------

  const handleBlingConnect = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'BLING_START_CONNECT' }, (res) => {
        if (res?.status) {
          setBlingStatus(res.status);
          setBlingLastRefreshAt(res.lastRefreshAt ?? null);
        }
      });
    }
  };

  const handleBlingDisconnect = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      setBlingDisconnecting(true);
      chrome.runtime.sendMessage({ type: 'BLING_DISCONNECT' }, (res) => {
        setBlingDisconnecting(false);
        if (res?.ok && res?.status === 'disconnected') {
          setBlingStatus('disconnected');
          setBlingLastRefreshAt(null);
        } else {
          // Falha transitória: preserva estado coerente de erro, não declara falsamente desconectado.
          // Background broadcast deve ter emitido BLING_CONNECTION_STATUS_CHANGED com estado correto.
          setBlingStatus((prev) =>
            prev === 'connected' ? 'gateway_unreachable' : prev
          );
        }
      });
    }
  };

  const handleBlingFocusOAuthTab = () => {
    // Background foca aba OAuth sem expor oauthTabId, pairingId ou pairingSecret
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'BLING_FOCUS_OAUTH_TAB' });
    }
  };

  // AJUSTE OBRIGATÓRIO 1: Retry de gateway_unreachable usa BLING_RETRY_CONNECTION
  // Background reavalia sessão (refresh se necessário) — NUNCA inicia novo OAuth.
  const handleBlingRetry = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'BLING_RETRY_CONNECTION' }, (res) => {
        if (res?.status) {
          setBlingStatus(res.status);
          setBlingLastRefreshAt(res.lastRefreshAt ?? null);
        }
      });
    }
  };

  // Cores e Ícones dinâmicos de Contexto

  useEffect(() => {
    if (importAfterConnect && blingStatus === 'connected') {
      setLibrarySource('bling'); setScreen('library'); setImportAfterConnect(false);
    }
  }, [importAfterConnect, blingStatus]);
  useEffect(() => { window.scrollTo?.({ top: 0, behavior: 'instant' }); }, [screen, currentStep]);
  const steps: Record<number, [string, string]> = {
    1: ['Produto', 'Foto ou nome do item'],
    2: ['Ficha Bling', 'SKU, EAN, NCM, marca e detalhes'],
    3: ['Preço', 'Custos e margem'],
    4: ['Anúncio ML', 'Título ML, descrição e SEO'],
    5: ['Resumo e kits', 'Visão geral e kits'],
    6: ['Fotos', 'Imagens do anúncio'],
    7: ['Referências', 'Fontes auditadas'],
    8: ['Mercado', 'Comparativo de preços']
  };

  const activeBlingProductId = tabContext?.platform === 'bling' ? tabContext?.detectedProduct?.id : undefined;

  return (
    <div className="flex flex-col min-h-screen text-[#0f172a] font-sans antialiased select-none">
      {/* 1. Header Fixo e Translúcido com Identidade Visual Paulifest Copilot */}
      <header className="sticky top-0 z-30 px-3.5 py-2 bg-white/90 backdrop-blur-xl border-b border-[#0052d4]/10 shadow-[0_2px_12px_-4px_rgba(10,31,68,0.06)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white border border-[#0066ff]/20 flex items-center justify-center p-0.5 shadow-xs">
            <img
              src="/icons/logo.png"
              alt="Paulifest Seller Copilot"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-xs font-extrabold bg-gradient-to-r from-[#0a1f44] via-[#0052d4] to-[#0099e6] bg-clip-text text-transparent tracking-tight">
            Paulifest Copilot
          </h1>
        </div>

        <nav aria-label="Navegação principal" className="flex gap-2.5 text-xs font-semibold">
          <button onClick={() => { setScreen('home'); setImportAfterConnect(false); }} className="text-[#0071e3] py-1">Início</button>
          <button onClick={() => { setLibrarySource('saved'); setScreen('library'); setImportAfterConnect(false); }} className="text-slate-600 hover:text-slate-900 py-1">Rascunhos</button>
          <button onClick={() => { setScreen('connections'); setImportAfterConnect(false); }} className="text-slate-600 hover:text-slate-900 py-1">Conexões</button>
        </nav>
      </header>

      {/* Banner Contextual da Aba Bling (Fase 4B) */}
      {screen === 'connections' && tabContext?.platform === 'bling' && (
        <div className="bg-emerald-50 border-b border-emerald-200/60 px-3.5 py-1.5 flex items-center justify-between text-xs text-emerald-900">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded">
              BLING
            </span>
            <span className="font-medium text-[11px]">
              {tabContext.pageType === 'product_form_new'
                ? 'Novo Produto'
                : tabContext.detectedProduct?.id
                  ? `Produto #${tabContext.detectedProduct.id}`
                  : 'Lista de Produtos'}
            </span>
          </div>
          <span className="text-[9px] font-bold text-emerald-800 uppercase bg-emerald-200/60 px-1.5 py-0.5 rounded">
            {tabContext?.uiState?.isSimulatedMock ? 'Demo' : 'Ativo'}
          </span>
        </div>
      )}

      {/* 2. Conteúdo Principal */}
      <main className="flex-1 p-3 space-y-3 max-w-lg mx-auto w-full">
        {startError && <p role="alert" className="text-xs text-red-700">{startError}</p>}
        {screen === 'home' && (
          <StartScreen
            ready={isLoaded}
            starting={startingProduct}
            connected={blingStatus === 'connected'}
            activeBlingProductId={activeBlingProductId}
            draft={activeFlow ? sheet : undefined}
            onCreate={() => void handleStartNewProduct()}
            onPullActiveBlingToMl={() => void handlePullActiveBlingToMl()}
            onResume={() => setScreen('product')}
            onResumeExportMl={() => { setCurrentStep(4); setScreen('product'); }}
            onDeleteDraft={() => void handleDeleteDraft(sheet.id)}
            onLibrary={() => { setLibrarySource('saved'); setScreen('library'); }}
            onImport={() => {
              if (blingStatus === 'connected') {
                setLibrarySource('bling');
                setScreen('library');
              } else {
                setImportAfterConnect(true);
                setScreen('connections');
              }
            }}
          />
        )}
        {screen === 'library' && (
          <ProductLibrary
            key={librarySource}
            initialSource={librarySource}
            initiallyExpanded
            currentId={sheet.id}
            connected={blingStatus === 'connected'}
            activeBlingProductId={activeBlingProductId}
            onOpen={openSavedProduct}
            onNew={handleStartNewProduct}
            onDeleteDraft={(deletedId, deletedAll) => void handleDeleteDraft(deletedId, deletedAll)}
            onConnectBling={() => {
              setImportAfterConnect(true);
              setScreen('connections');
            }}
          />
        )}
        {screen === 'connections' && <>
          <h2 className="text-sm font-bold">Conexões</h2>
          <p className="text-xs text-slate-600">{importAfterConnect ? 'Conecte o Bling para buscar seus produtos.' : 'Conecte sua conta do Bling ERP.'}</p>
        <BlingConnectionCard
          status={blingStatus}
          lastRefreshAt={blingLastRefreshAt}
          isHydrating={!blingStatusLoaded}
          isDisconnecting={blingDisconnecting}
          onConnect={handleBlingConnect}
          onDisconnect={handleBlingDisconnect}
          onFocusOAuthTab={handleBlingFocusOAuthTab}
          onRetry={handleBlingRetry}
        />
          {tabContext?.activeSheetId && tabContext.activeSheetId !== sheet.id && <button className="w-full p-3 rounded-xl border text-xs text-blue-700" onClick={() => {
            void loadSheet(tabContext.activeSheetId).then(value => value && openSavedProduct(value)).catch(() => setStartError('Não foi possível abrir a ficha da página.'));
          }}>Abrir a ficha vinculada à página atual</button>}
          <button onClick={handleRefresh} className="text-xs text-blue-700">{refreshSpin ? 'Atualizando…' : 'Atualizar página conectada'}</button>
        {/* Card de Contexto Atual da Página */}
        <section className="apple-glass-card rounded-2xl p-3 space-y-1.5 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold tracking-wider text-[#86868b] uppercase">
              Contexto Ativo
            </span>
            <span className="text-[9px] font-medium text-[#0071e3] flex items-center gap-1">
              Tempo Real <span className="inline-block w-1 h-1 bg-[#0071e3] rounded-full animate-ping" />
            </span>
          </div>

          <div>
            <h2 className="text-xs font-semibold text-[#1d1d1f] line-clamp-1 leading-snug">
              {context.summaryLabel}
            </h2>
            <p className="text-[11px] text-[#86868b] line-clamp-1">
              {context.title || 'Aguardando navegação...'}
            </p>
          </div>

          {context.url && (
            <div className="pt-1.5 border-t border-black/[0.04] flex items-center justify-between text-[10px] text-[#86868b]">
              <span className="font-mono truncate max-w-[220px]">
                {context.url.replace(/^https?:\/\/(www\.)?/, '')}
              </span>
              <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-60 ml-1" />
            </div>
          )}
        </section>

        {/* Quick View Bling ERP (Fase 4D.2) */}
        {tabContext?.platform === 'bling' && (tabContext?.uiState?.quickView || tabContext?.uiState?.quickViewLoading || tabContext?.uiState?.quickViewError) && (
          <section className="apple-glass-card rounded-2xl p-3.5 space-y-2 animate-fade-in border border-[#0071e3]/20 bg-gradient-to-br from-white/95 to-blue-50/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider text-[#0071e3] uppercase flex items-center gap-1.5">
                <Tag className="w-3 h-3 text-[#0071e3]" /> Quick View • Bling ERP
              </span>
              <span className="text-[9px] font-semibold text-[#86868b] bg-black/[0.04] px-1.5 py-0.5 rounded">
                Somente Leitura
              </span>
            </div>

            {tabContext.uiState.quickViewLoading && (
              <div className="text-[11px] text-[#86868b] py-1 flex items-center gap-2">
                <RefreshCw className="w-3 h-3 animate-spin text-[#0071e3]" />
                <span>Carregando dados de estoque e custo...</span>
              </div>
            )}

            {tabContext.uiState.quickViewError && (
              <div className="text-[11px] text-red-600 bg-red-50 border border-red-200/60 rounded-lg p-2 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{tabContext.uiState.quickViewError}</span>
              </div>
            )}

            {tabContext.uiState.quickView && (
              <div className="space-y-1.5 pt-0.5">
                {tabContext.uiState.quickView.name && (
                  <p className="text-xs font-semibold text-[#1d1d1f] line-clamp-1">
                    {tabContext.uiState.quickView.name}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-white/80 rounded-xl p-2 border border-black/[0.04] space-y-0.5">
                    <span className="text-[9.5px] text-[#86868b] block font-medium">Estoque Disponível</span>
                    <span className="text-xs font-bold text-[#1d1d1f]">
                      {(tabContext.uiState.quickView.stockInfo) !== null &&
                       (tabContext.uiState.quickView.stockInfo) !== undefined
                        ? `${(tabContext.uiState.quickView.stockInfo)!.virtualTotal} un.`
                        : 'Não informado'}
                    </span>
                    {(tabContext.uiState.quickView.stockInfo) && (
                      <span className="text-[9px] text-[#86868b] block">
                        Físico: {(tabContext.uiState.quickView.stockInfo)!.physicalTotal} un.
                      </span>
                    )}
                  </div>

                  <div className="bg-white/80 rounded-xl p-2 border border-black/[0.04] space-y-0.5">
                    <span className="text-[9.5px] text-[#86868b] block font-medium">Preço de Custo (CMV)</span>
                    <span className="text-xs font-bold text-[#1d1d1f]">
                      {tabContext.uiState.quickView.costPrice !== null && tabContext.uiState.quickView.costPrice !== undefined
                        ? `R$ ${tabContext.uiState.quickView.costPrice.toFixed(2).replace('.', ',')}`
                        : 'Não informado'}
                    </span>
                    {tabContext.uiState.quickView.sku && (
                      <span className="text-[9px] text-[#86868b] block font-mono truncate">
                        SKU: {tabContext.uiState.quickView.sku}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        </>}
        {screen === 'product' && activeFlow && (
          <section className="space-y-2.5">
            {/* Cabeçalho compacto do Fluxo */}
            <div className="apple-glass-card rounded-xl p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Tag className="w-3 h-3 text-[#0071e3] flex-shrink-0" />
                  <span className="text-[11px] font-semibold text-[#1d1d1f] truncate max-w-[180px]">
                    {sheet.titleBling?.value?.toUpperCase() || sheet.title.value || sheet.sku.value || 'Novo produto'}
                  </span>
                  {sheet.hasUnresolvedConflicts && (
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-300 px-1 py-0.5 rounded">
                      Divergência
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span role="status" className="text-[9.5px] text-[#86868b]">
                    {saveState === 'Salvo neste navegador' ? 'Salvo' : saveState}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteDraft(sheet.id)}
                    className="text-[10px] text-[#86868b] hover:text-rose-600 font-medium flex items-center gap-0.5 transition-colors"
                    title="Apagar este rascunho"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>Apagar</span>
                  </button>
                  <button
                    onClick={handleReset}
                    className="text-[10px] text-[#86868b] hover:text-[#0071e3] font-medium flex items-center gap-0.5 transition-colors"
                    title="Novo produto"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Novo</span>
                  </button>
                </div>
              </div>

              {saveState.startsWith('Não foi') && <button className="text-[11px] text-red-700" onClick={() => handleUpdateSheet(prev => ({ ...prev }))}>Tentar salvar novamente</button>}
              <div role="tablist" aria-label="Etapas do produto" className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-0.5 text-[11px]">
                {[[1, '1. Produto'], [2, '2. Ficha'], [3, '3. Preço'], [4, '4. ML']].map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={currentStep === id}
                    aria-controls="product-panel"
                    onClick={() => setCurrentStep(Number(id))}
                    className={`min-w-0 py-1.5 rounded-md transition-all ${currentStep === id ? 'bg-white text-[#0071e3] font-semibold shadow-xs' : 'text-slate-600'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <details className="text-[11px]">
                <summary className="cursor-pointer py-0.5 text-[#86868b] hover:text-[#1d1d1f]">
                  Mais opções{currentStep > 4 ? ' · ' + steps[currentStep][0] : ''}
                </summary>
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {[[5,'Resumo e kits'],[6,'Fotos'],[7,'Referências'],[8,'Mercado']].map(([id,label]) => (
                    <button key={id} onClick={() => setCurrentStep(Number(id))} className="border border-black/[0.08] rounded-md px-2 py-1 text-[10px] text-[#0071e3]">
                      {label}
                    </button>
                  ))}
                </div>
              </details>
            </div>
            <div id="product-panel" role="tabpanel" aria-label="Conteúdo do produto" className="space-y-2.5">
            {currentStep > 4 && <div className="px-0.5"><h2 className="text-sm font-bold">{steps[currentStep][0]}</h2></div>}
            {currentStep === 8 && <MarketTab key={sheet.id} sheet={sheet} onUpdateSheet={handleUpdateSheet} />}
            {currentStep === 5 && <OverviewTab key={sheet.id} sheet={sheet} onCreate={async product => { await saveSheet(product); await openSavedProduct(product); setCurrentStep(5); }} />}
            {currentStep === 6 && <ImagesTab key={sheet.id} sheet={sheet} onUpdateSheet={handleUpdateSheet} />}
            {currentStep === 7 && <ReferencesTab key={sheet.id} sheet={sheet} onUpdateSheet={handleUpdateSheet} />}
            {currentStep === 2 && <details className="text-xs border border-black/[0.08] bg-white rounded-xl p-2.5"><summary className="cursor-pointer text-[11px] font-medium text-[#6e6e73]">Variações de cor ou tamanho</summary><VariationEditor key={sheet.id} sheet={sheet} onUpdateSheet={handleUpdateSheet} /></details>}
            {currentStep === 4 && <ListingWorkspace key={sheet.id} sheet={sheet} onBack={() => setCurrentStep(2)} onUpdateSheet={handleUpdateSheet} />}
            {/* Conteúdo Dinâmico do Passo Selecionado */}
            {currentStep === 1 && (
              <StepInput key={sheet.id}
                sheet={sheet}
                onUpdateSheet={handleUpdateSheet}
                onNext={() => setCurrentStep(2)}
              />
            )}

            {currentStep === 2 && (
              <StepSheet key={sheet.id}
                sheet={sheet}
                onUpdateSheet={handleUpdateSheet}
                onNext={() => setCurrentStep(3)}
                onPrev={() => setCurrentStep(1)}
                onExportMl={() => setCurrentStep(4)}
                blingTarget={tabContext?.platform === 'bling' && tabContext?.pageType === 'product_form_edit' &&
                  tabContext?.detectedProduct?.id && tabContext?.activeSheetId === sheet.id
                  ? { productId: tabContext.detectedProduct.id, connected: blingStatus === 'connected', contextKey: JSON.stringify([tabContext.tabId, tabContext.pageInstanceId, tabContext.contextRevision]) }
                  : undefined}
                newBlingTarget={tabContext?.platform === 'bling' && tabContext?.pageType === 'product_form_new' && typeof tabContext?.tabId === 'number'
                  ? { tabId: tabContext.tabId, pageInstanceId: tabContext.pageInstanceId, url: tabContext.url } : undefined}
                onUpdateBling={handleUpdateProductInBling}
              />
            )}

            {currentStep === 3 && (
              <StepPricing key={sheet.id}
                sheet={sheet}
                onUpdateSheet={handleUpdateSheet}
                onPrev={() => setCurrentStep(2)}
                onFinish={() => setCurrentStep(4)}
              />
            )}
            </div>
          </section>
        )}

      </main>


    </div>
  );
};

export default App;
