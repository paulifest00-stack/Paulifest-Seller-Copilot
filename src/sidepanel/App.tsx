import { SidepanelContextSync, readPanelContext } from './context-sync.ts';
import React, { useEffect, useState, useRef } from 'react';
import {
  ShoppingBag,
  Layers,
  Compass,
  Plus,
  Sparkles,
  RefreshCw,
  ExternalLink,
  RotateCcw,
  Tag,
  AlertCircle
} from 'lucide-react';
import type { PageContextState } from '../shared/types';
import type { CentralProductSheet } from '../core/schema/product.ts';
import { createInitialSheet } from '../core/schema/product.ts';
import {
  loadActiveSheet,
  saveActiveSheet,
  clearActiveSheet,
  loadSheet,
  saveSheet
} from '../core/storage/storage.ts';
import { StepInput } from './components/steps/StepInput.tsx';
import { StepSheet } from './components/steps/StepSheet.tsx';
import { StepPricing } from './components/steps/StepPricing.tsx';
import { BlingConnectionCard } from './components/BlingConnectionCard.tsx';
import type { BlingConnectionStatus } from '../shared/gateway-contracts.ts';

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
  const [activeFlow, setActiveFlow] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(1);
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
    let sheetLoadRevision = 0;
    let lastSheetContext = '';
    // Requisito 3: Se a aba é Bling, carregar loadSheet(activeSheetId); se não possui activeSheetId, NÃO carregar loadActiveSheet()
    const reloadSheet = (targetSheetId?: string, platform?: string) => {
      const revision = ++sheetLoadRevision;
      if (platform === 'bling') {
        if (targetSheetId) {
          loadSheet(targetSheetId).then((savedSheet) => {
            if (revision !== sheetLoadRevision) return;
            if (savedSheet) {
              setSheet(savedSheet);
              if ((savedSheet.costPrice?.value ?? 0) > 0 || savedSheet.ean?.value || savedSheet.title?.value || (savedSheet.currentSalePrice?.value ?? 0) > 0) {
                setActiveFlow(true);
              } else {
                setActiveFlow(false);
              }
            } else {
              setSheet(createInitialSheet());
              setActiveFlow(false);
            }
            setIsLoaded(true);
          });
        } else {
          // Aba Bling sem ficha vinculada: NUNCA herdar/cair para loadActiveSheet() global
          setSheet(createInitialSheet());
          setActiveFlow(false);
          setIsLoaded(true);
        }
        return;
      }

      // Fluxo legado/neutro: fallback para loadSheet(targetSheetId) ou loadActiveSheet()
      const loadPromise = targetSheetId
        ? loadSheet(targetSheetId)
        : loadActiveSheet();

      loadPromise.then((savedSheet) => {
        if (revision !== sheetLoadRevision) return;
        if (savedSheet) {
          setSheet(savedSheet);
          if ((savedSheet.costPrice?.value ?? 0) > 0 || savedSheet.ean?.value || savedSheet.title?.value || (savedSheet.currentSalePrice?.value ?? 0) > 0) {
            setActiveFlow(true);
          }
        } else {
          setSheet(createInitialSheet());
        }
        setIsLoaded(true);
      });
    };

    const contextSync = new SidepanelContextSync(readPanelContext, (res) => {
      setTabContext(res);
      if (res) {
        setContext(prev => ({ ...prev, platform: res.platform, url: res.url, title: res.url,
          summaryLabel: res.platform === 'bling' ? 'Bling ERP • ' + res.pageType : 'Contexto ativo' }));
        const key = JSON.stringify([res.tabId, res.pageInstanceId, res.activeSheetId, res.uiState.actionFeedback]);
        if (key !== lastSheetContext) { lastSheetContext = key; reloadSheet(res.activeSheetId, res.platform); }
      } else {
        setContext(prev => ({ ...prev, platform: 'neutral', url: '', title: '', summaryLabel: 'Aguardando contexto...' }));
        ++sheetLoadRevision; lastSheetContext = '';
        setSheet(createInitialSheet()); setActiveFlow(false);
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
      reloadSheet();
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

    const onTabChanged = () => { void contextSync.refresh(); };
    chrome.tabs?.onActivated.addListener(onTabChanged);
    chrome.runtime?.onMessage.addListener(listener);
    return () => {
      contextSync.dispose();
      contextSyncRef.current = null;
      ++sheetLoadRevision;
      chrome.tabs?.onActivated.removeListener(onTabChanged);
      chrome.runtime?.onMessage.removeListener(listener);
    };
  }, []);

  // Only explicit editor changes persist; context/Quick View hydration never writes a sheet.
  const handleUpdateSheet = (updater: (prev: CentralProductSheet) => CentralProductSheet) => {
    const updated = updater(sheet);
    setSheet(updated);
    if (isLoaded && activeFlow) void saveSheet(updated);
  };

  const handleRefresh = () => {
    setRefreshSpin(true);
    void contextSyncRef.current?.refresh().finally(() => setRefreshSpin(false));
  };

  const handleStartNewProduct = async () => {
    const initial = createInitialSheet();
    setSheet(initial);
    saveActiveSheet(initial);
    saveSheet(initial);
    setActiveFlow(true);
    setCurrentStep(1);

    // Requisito 4: Se o usuário iniciar nova ficha com TabContextState ativo, vincular à aba
    if (tabContext && typeof tabContext.tabId === 'number') {
      chrome.runtime?.sendMessage({
        type: 'LINK_SHEET_TO_TAB',
        windowId: (await chrome.windows.getCurrent()).id,
        tabId: tabContext.tabId,
        sheetId: initial.id
      }, (res) => {
        if (res?.state) {
          setTabContext(res.state);
        }
      });
    }
  };

  const handleReset = () => {
    if (confirm('Deseja realmente limpar a ficha e começar um novo produto?')) {
      clearActiveSheet();
      setSheet(createInitialSheet());
      setActiveFlow(false);
      setCurrentStep(1);
    }
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
  const getContextTheme = () => {
    switch (context.platform) {
      case 'mercadolivre':
        return {
          badgeBg: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
          dotBg: 'bg-amber-500',
          icon: <ShoppingBag className="w-3.5 h-3.5" />,
          accentText: 'text-amber-600',
          ringColor: 'focus:ring-amber-500/30'
        };
      case 'bling':
        return {
          badgeBg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
          dotBg: 'bg-emerald-500',
          icon: <Layers className="w-3.5 h-3.5" />,
          accentText: 'text-emerald-600',
          ringColor: 'focus:ring-emerald-500/30'
        };
      default:
        return {
          badgeBg: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
          dotBg: 'bg-slate-400',
          icon: <Compass className="w-3.5 h-3.5" />,
          accentText: 'text-slate-600',
          ringColor: 'focus:ring-slate-500/30'
        };
    }
  };

  const theme = getContextTheme();

  return (
    <div className="flex flex-col min-h-screen bg-[#f5f5f7] text-[#1d1d1f] font-sans antialiased select-none">
      {/* 1. Header Fixo e Translúcido com padrão Apple */}
      <header className="sticky top-0 z-30 px-4 py-2.5 bg-white/80 backdrop-blur-xl border-b border-black/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#0071e3] flex items-center justify-center text-white shadow-sm font-semibold text-xs tracking-wider">
            P
          </div>
          <div>
            <h1 className="text-xs font-semibold text-[#1d1d1f] tracking-tight leading-tight">
              Paulifest Copilot
            </h1>
            <p className="text-[10px] text-[#86868b] font-medium tracking-normal">
              Fase 4C.4B • Conexão Bling
            </p>
          </div>
        </div>

        {/* Badge Dinâmico de Contexto */}
        <div className="flex items-center gap-1.5">
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${theme.badgeBg} transition-all duration-300`}
            title={`Aba detectada: ${context.url || 'Nenhuma'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${theme.dotBg} animate-pulse`} />
            {theme.icon}
            <span className="capitalize">{context.platform === 'mercadolivre' ? 'Mercado Livre' : context.platform === 'bling' ? 'Bling ERP' : 'Neutro'}</span>
          </div>

          <button
            onClick={handleRefresh}
            className="p-1 rounded-full text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/5 transition-colors"
            title="Atualizar contexto da aba"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshSpin ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Banner Contextual da Aba Bling (Fase 4B) */}
      {tabContext?.platform === 'bling' && (
        <div className="bg-emerald-50 border-b border-emerald-200/60 px-4 py-2 flex items-center justify-between text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded tracking-wide">
              BLING
            </span>
            <span className="font-medium text-[11px]">
              {tabContext.pageType === 'product_form_new'
                ? 'Novo Produto • Cadastro em andamento'
                : tabContext.detectedProduct?.id
                  ? `Produto Detectado: #${tabContext.detectedProduct.id}`
                  : 'Lista de Produtos'}
            </span>
          </div>
          <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wider bg-emerald-200/60 px-2 py-0.5 rounded border border-emerald-300/60">
            {tabContext?.uiState?.isSimulatedMock ? 'Simulação 4B' : 'Real 4C.3'}
          </span>
        </div>
      )}

      {/* 2. Conteúdo Principal */}
      <main className="flex-1 p-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Card de Conexão Bling — sempre visível em todos os estados (AJUSTE OBRIGATÓRIO 2) */}
        {/* Ordem: 1. BlingConnectionCard | 2. contexto da aba | 3. fluxo de produto */}
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

        {/* Card Principal: Botão "Novo Produto" ou Fluxo Ativo */}
        {!activeFlow ? (
          <section className="apple-glass-card rounded-2xl p-5 text-center space-y-4 animate-scale-in">
            <div className="w-12 h-12 rounded-2xl bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center mx-auto shadow-inner">
              <Sparkles className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-semibold text-[#1d1d1f] tracking-tight">
                Cadastrar Novo Produto
              </h3>
              <p className="text-xs text-[#86868b] leading-relaxed max-w-[260px] mx-auto">
                Identifique por foto, EAN-13 ou custo CMV, preencha a Ficha Central e calcule o preço de venda ideal com margem líquida limpa.
              </p>
            </div>

            {tabContext?.platform === 'bling' && !tabContext?.activeSheetId && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-lg px-2.5 py-1.5 text-center font-medium">
                Nenhuma ficha vinculada a esta aba do Bling. Inicie uma nova ficha abaixo ou importe via dock na página.
              </div>
            )}

            {/* Pipeline de Passos Visual */}
            <div className="grid grid-cols-3 gap-1 py-2 text-[10px] font-medium text-[#86868b]">
              <div className="flex flex-col items-center gap-1">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-[#0071e3] flex items-center justify-center font-semibold">1</div>
                <span>Entrada</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center font-semibold text-black/70">2</div>
                <span>Ficha Central</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center font-semibold text-black/70">3</div>
                <span>Precificação</span>
              </div>
            </div>

            {/* Botão de Ação Primária no Estilo Apple */}
            <button
              onClick={handleStartNewProduct}
              className="w-full py-3 px-4 bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-semibold rounded-xl apple-press-spring shadow-sm flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Iniciar Novo Produto</span>
            </button>
          </section>
        ) : (
          <section className="space-y-3">
            {/* Cabeçalho do Fluxo com Stepper em Abas */}
            <div className="apple-glass-card rounded-2xl p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-[#0071e3]" />
                  <span className="text-xs font-semibold text-[#1d1d1f] truncate max-w-[180px]">
                    {sheet.title.value || sheet.sku.value || 'Produto em Andamento'}
                  </span>
                  {sheet.hasUnresolvedConflicts && (
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded">
                      Divergência
                    </span>
                  )}
                </div>
                <button
                  onClick={handleReset}
                  className="text-[11px] text-[#86868b] hover:text-rose-600 font-medium flex items-center gap-1 transition-colors"
                  title="Reiniciar ficha do produto"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Limpar</span>
                </button>
              </div>

              {/* Barra de Passos (Stepper) */}
              <div className="grid grid-cols-3 gap-1 p-1 bg-black/[0.04] rounded-xl text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all apple-press-spring ${currentStep === 1
                      ? 'bg-white text-[#0071e3] font-bold shadow-sm'
                      : 'text-[#86868b] hover:text-[#1d1d1f]'
                    }`}
                >
                  <span className="text-[10px] w-4 h-4 rounded-full bg-black/5 flex items-center justify-center font-mono">1</span>
                  <span>Entrada</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all apple-press-spring ${currentStep === 2
                      ? 'bg-white text-[#0071e3] font-bold shadow-sm'
                      : 'text-[#86868b] hover:text-[#1d1d1f]'
                    }`}
                >
                  <span className="text-[10px] w-4 h-4 rounded-full bg-black/5 flex items-center justify-center font-mono">2</span>
                  <span>Ficha</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all apple-press-spring ${currentStep === 3
                      ? 'bg-white text-[#0071e3] font-bold shadow-sm'
                      : 'text-[#86868b] hover:text-[#1d1d1f]'
                    }`}
                >
                  <span className="text-[10px] w-4 h-4 rounded-full bg-black/5 flex items-center justify-center font-mono">3</span>
                  <span>Preço</span>
                </button>
              </div>
            </div>

            {/* Conteúdo Dinâmico do Passo Selecionado */}
            {currentStep === 1 && (
              <StepInput
                sheet={sheet}
                onUpdateSheet={handleUpdateSheet}
                onNext={() => setCurrentStep(2)}
              />
            )}

            {currentStep === 2 && (
              <StepSheet
                sheet={sheet}
                onUpdateSheet={handleUpdateSheet}
                onNext={() => setCurrentStep(3)}
                onPrev={() => setCurrentStep(1)}
              />
            )}

            {currentStep === 3 && (
              <StepPricing
                sheet={sheet}
                onUpdateSheet={handleUpdateSheet}
                onPrev={() => setCurrentStep(2)}
                onFinish={() => {
                  alert('Preço e Ficha Central salvos com sucesso no armazenamento local do Copilot!');
                }}
              />
            )}
          </section>
        )}

        {/* 3. Dica Contextual Proativa */}
        <section className="p-3 rounded-xl bg-black/[0.03] border border-black/[0.04] text-[11px] text-[#6e6e73] leading-relaxed">
          <span className="font-semibold text-[#1d1d1f]">Dica do Copilot: </span>
          {context.platform === 'mercadolivre'
            ? 'Ao navegar no Mercado Livre, use a aba "Ficha" para comparar atributos com os anúncios de topo e alinhar com a categoria oficial.'
            : context.platform === 'bling'
              ? 'No Bling, os dados da Ficha Central serão sincronizados de ponta a ponta sem redigitação de campos fiscais ou dimensões.'
              : 'O motor de precificação calcula impostos, comissões e custos logísticos de forma determinística via MarketplaceFeeProvider.'}
        </section>
      </main>

      {/* 4. Rodapé Fixo com Status Operacional */}
      <footer className="px-4 py-2 bg-white/60 backdrop-blur border-t border-black/[0.04] text-[10px] text-[#86868b] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Fase 2 • Motor Ativo</span>
        </div>
        <span>Paulifest Copilot</span>
      </footer>
    </div>
  );
};

export default App;
