import React, { useEffect, useState } from 'react';
import { 
  ShoppingBag, 
  Layers, 
  Compass, 
  Plus, 
  Sparkles, 
  RefreshCw,
  ExternalLink,
  RotateCcw,
  Tag
} from 'lucide-react';
import type { ExtensionMessage, PageContextState } from '../shared/types';
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

export const App: React.FC = () => {
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

  // Carrega a ficha persistida e escuta o contexto do Service Worker
  useEffect(() => {
    // Requisito 3: Se a aba é Bling, carregar loadSheet(activeSheetId); se não possui activeSheetId, NÃO carregar loadActiveSheet()
    const reloadSheet = (targetSheetId?: string, platform?: string) => {
      if (platform === 'bling') {
        if (targetSheetId) {
          loadSheet(targetSheetId).then((savedSheet) => {
            if (savedSheet) {
              setSheet(savedSheet);
              if (savedSheet.costPrice?.value > 0 || savedSheet.ean?.value || savedSheet.title?.value || savedSheet.currentSalePrice?.value > 0) {
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
        if (savedSheet) {
          setSheet(savedSheet);
          if (savedSheet.costPrice?.value > 0 || savedSheet.ean?.value || savedSheet.title?.value || savedSheet.currentSalePrice?.value > 0) {
            setActiveFlow(true);
          }
        } else {
          setSheet(createInitialSheet());
        }
        setIsLoaded(true);
      });
    };

    // Busca inicial do contexto da aba ativa
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTEXT' }, (res) => {
        if (res && res.platform) {
          setTabContext(res);
          setContext((prev) => ({
            ...prev,
            platform: res.platform,
            url: res.url,
            title: res.url,
            summaryLabel: res.platform === 'bling' ? `Bling ERP • ${res.pageType}` : prev.summaryLabel
          }));
          reloadSheet(res.activeSheetId, res.platform);
        } else {
          reloadSheet();
        }
      });
    } else {
      reloadSheet();
    }

    // Listener para eventos em tempo real
    const listener = (message: any) => {
      if (message.type === 'CONTEXT_UPDATED' && message.payload) {
        setContext(message.payload);
      }
      if (message.type === 'ACTIVE_TAB_CONTEXT_UPDATED' && message.state) {
        setTabContext(message.state);
        setContext((prev) => ({
          ...prev,
          platform: message.state.platform,
          url: message.state.url,
          summaryLabel: message.state.platform === 'bling' ? `Bling ERP • ${message.state.pageType}` : prev.summaryLabel
        }));
        reloadSheet(message.state.activeSheetId, message.state.platform);
      }
    };

    chrome.runtime?.onMessage.addListener(listener);
    return () => {
      chrome.runtime?.onMessage.removeListener(listener);
    };
  }, []);

  // Salva automaticamente no storage quando a ficha sofrer alterações
  useEffect(() => {
    if (isLoaded && activeFlow) {
      saveSheet(sheet);
    }
  }, [sheet, isLoaded, activeFlow]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    chrome.runtime?.sendMessage<ExtensionMessage>({ type: 'GET_CONTEXT' }, (res) => {
      if (res && res.platform) {
        setContext(res);
      }
      setTimeout(() => setRefreshSpin(false), 400);
    });
  };

  const handleStartNewProduct = () => {
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
              Fase 2 • SSOT & Precificação
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
                  className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all apple-press-spring ${
                    currentStep === 1
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
                  className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all apple-press-spring ${
                    currentStep === 2
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
                  className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all apple-press-spring ${
                    currentStep === 3
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
                onUpdateSheet={setSheet}
                onNext={() => setCurrentStep(2)}
              />
            )}

            {currentStep === 2 && (
              <StepSheet
                sheet={sheet}
                onUpdateSheet={setSheet}
                onNext={() => setCurrentStep(3)}
                onPrev={() => setCurrentStep(1)}
              />
            )}

            {currentStep === 3 && (
              <StepPricing
                sheet={sheet}
                onUpdateSheet={setSheet}
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
