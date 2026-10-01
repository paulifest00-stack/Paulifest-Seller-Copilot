import { MarketTab } from '../sidepanel/components/MarketTab.tsx';
import { OverviewTab } from '../sidepanel/components/OverviewTab.tsx';
import { ImagesTab } from '../sidepanel/components/ImagesTab.tsx';
import { ReferencesTab } from '../sidepanel/components/ReferencesTab.tsx';
import { VariationEditor } from '../sidepanel/components/VariationEditor.tsx';
import { SidepanelContextSync, readPanelContext } from '../sidepanel/context-sync.ts';
import React, { useEffect, useState, useRef } from 'react';
import {
  RefreshCw,
  ExternalLink,
  RotateCcw,
  Tag,
  AlertCircle,
  Trash2,
  Home,
  Package,
  BookOpen,
  Link2,
  Settings,
  Zap,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import type { PageContextState } from '../shared/types';
import type { CentralProductSheet } from '../core/schema/product.ts';
import { createInitialSheet } from '../core/schema/product.ts';
import {
  deleteSheet,
  listSavedSheets,
  loadActiveSheet,
  loadWorkspace,
  saveWorkspace,
  loadSheet,
  saveSheet
} from '../core/storage/storage.ts';
import { mapBlingProductToSheetPatch } from '../integrations/bling/bling-to-sheet.mapper.ts';
import { reconcileBlingPatch } from '../integrations/bling/reconciliation.ts';
import { prepareBlingSheetForMlExport } from '../core/engines/identification/sheet-adapter.ts';
import { ProductLibrary } from '../sidepanel/components/ProductLibrary.tsx';
import { ListingWorkspace } from '../sidepanel/components/ListingWorkspace.tsx';
import { StepInput } from '../sidepanel/components/steps/StepInput.tsx';
import { StepSheet } from '../sidepanel/components/steps/StepSheet.tsx';
import { StepPricing } from '../sidepanel/components/steps/StepPricing.tsx';
import { BlingConnectionCard } from '../sidepanel/components/BlingConnectionCard.tsx';
import { MlConnectionCard } from '../sidepanel/components/MlConnectionCard.tsx';
import type { BlingConnectionStatus, BlingUpdateProductMessageResponse } from '../shared/gateway-contracts.ts';
import type { MlConnectionInfo } from '../shared/mercadolivre-contracts.ts';
import { mlAction } from '../integrations/mercadolivre/client.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

type PopupScreen = 'home' | 'product' | 'library' | 'connections' | 'config';

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Shared card wrapper with AvantPro styling */
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div
    className={`bg-white border border-[#e2e8f0] rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-3.5 mb-3 ${className}`}
  >
    {children}
  </div>
);

const CardTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="font-bold text-sm flex items-center gap-2 text-[#0f172a] mb-2">{children}</h3>
);

const PrimaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}> = ({ children, onClick, disabled, className = '' }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`bg-[#1278f9] hover:bg-[#0b63d3] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-md w-full text-sm transition-colors ${className}`}
  >
    {children}
  </button>
);

const SecondaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}> = ({ children, onClick, disabled, className = '' }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`bg-white hover:bg-[#f8fafc] disabled:opacity-50 disabled:cursor-not-allowed text-[#1278f9] font-semibold py-2 px-4 rounded-md w-full text-sm border border-[#e2e8f0] transition-colors ${className}`}
  >
    {children}
  </button>
);

// ─── Config Tab ──────────────────────────────────────────────────────────────

const ConfigTab: React.FC = () => {
  const [gatewayStatus, setGatewayStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [gatewayMessage, setGatewayMessage] = useState('');
  const [compactMode, setCompactMode] = useState(false);

  const testGateway = async () => {
    setGatewayStatus('testing');
    setGatewayMessage('');
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const res = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type: 'GATEWAY_PING' }, (response) => {
            resolve(response || { ok: false, error: chrome.runtime.lastError?.message || 'Sem resposta' });
          });
        });
        if (res?.ok) {
          setGatewayStatus('ok');
          setGatewayMessage('Gateway respondeu com sucesso.');
        } else {
          setGatewayStatus('error');
          setGatewayMessage(res?.error || 'Gateway inacessível.');
        }
      } else {
        setGatewayStatus('error');
        setGatewayMessage('Ambiente sem chrome.runtime. Abra no Chrome.');
      }
    } catch (err) {
      setGatewayStatus('error');
      setGatewayMessage(err instanceof Error ? err.message : 'Erro desconhecido.');
    }
  };

  const shortcuts = [
    { keys: 'Alt + P', desc: 'Abrir painel lateral' },
    { keys: 'Alt + N', desc: 'Novo produto' },
    { keys: 'Alt + B', desc: 'Abrir biblioteca' },
    { keys: 'Alt + C', desc: 'Ir para Conexões' },
  ];

  return (
    <div>
      {/* Aparência */}
      <Card>
        <CardTitle>🎨 Aparência</CardTitle>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[#475569] text-xs">Modo compacto</span>
            <button
              onClick={() => setCompactMode(!compactMode)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                compactMode ? 'bg-[#1278f9]' : 'bg-[#e2e8f0]'
              }`}
              role="switch"
              aria-checked={compactMode}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  compactMode ? 'translate-x-4.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between opacity-40 cursor-not-allowed">
            <span className="text-[#475569] text-xs">Dark mode</span>
            <span className="text-[10px] bg-[#f1f5f9] text-[#94a3b8] px-1.5 py-0.5 rounded font-semibold">Em breve</span>
          </div>
        </div>
      </Card>

      {/* Atalhos */}
      <Card>
        <CardTitle>⌨️ Atalhos de teclado</CardTitle>
        <div className="space-y-1.5">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex items-center justify-between">
              <span className="text-[#475569] text-xs">{s.desc}</span>
              <kbd className="text-[10px] bg-[#f1f5f9] border border-[#e2e8f0] text-[#475569] px-1.5 py-0.5 rounded font-mono">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </Card>

      {/* Diagnóstico */}
      <Card>
        <CardTitle>🔧 Diagnóstico</CardTitle>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[#475569]">Status Gateway</span>
            <span className="flex items-center gap-1">
              {gatewayStatus === 'idle' && <span className="text-[#94a3b8]">—</span>}
              {gatewayStatus === 'testing' && (
                <span className="text-[#1278f9] flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Testando…
                </span>
              )}
              {gatewayStatus === 'ok' && (
                <span className="text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Online
                </span>
              )}
              {gatewayStatus === 'error' && (
                <span className="text-red-600 flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> Erro
                </span>
              )}
            </span>
          </div>
          {gatewayMessage && (
            <p
              className={`text-[11px] rounded p-1.5 ${
                gatewayStatus === 'ok'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {gatewayMessage}
            </p>
          )}
          <SecondaryButton onClick={testGateway} disabled={gatewayStatus === 'testing'}>
            {gatewayStatus === 'testing' ? 'Testando…' : 'Testar conexão Gateway'}
          </SecondaryButton>
        </div>
      </Card>

      {/* Sobre */}
      <Card>
        <CardTitle>ℹ️ Sobre</CardTitle>
        <div className="space-y-1.5 text-xs text-[#475569]">
          <div className="flex justify-between">
            <span>Versão</span>
            <span className="font-semibold text-[#0f172a]">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span>Build</span>
            <span className="font-mono text-[10px]">popup+sidepanel</span>
          </div>
          <div className="pt-1 border-t border-[#e2e8f0]">
            <a
              href="https://paulifest.com.br/changelog"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1278f9] hover:underline flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" /> Ver changelog
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ─── Main PopupApp ────────────────────────────────────────────────────────────

export const PopupApp: React.FC = () => {
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

  // 2. Navegação por telas
  const [screen, setScreen] = useState<PopupScreen>('home');
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

  // 4. Estado da Aba Conectada
  const [tabContext, setTabContext] = useState<any>(null);

  // 5. Estado de Conexão Bling
  const [blingStatus, setBlingStatus] = useState<BlingConnectionStatus>('disconnected');
  const [blingLastRefreshAt, setBlingLastRefreshAt] = useState<string | null>(null);
  const [blingStatusLoaded, setBlingStatusLoaded] = useState<boolean>(false);
  const [blingDisconnecting, setBlingDisconnecting] = useState<boolean>(false);

  // 6. Estado de Conexão Mercado Livre
  const [mlInfo, setMlInfo] = useState<MlConnectionInfo>({ status: 'disconnected', connected: false });
  const [mlStatusLoaded, setMlStatusLoaded] = useState<boolean>(false);

  // Carrega a ficha persistida e escuta o contexto do Service Worker
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const workspace = await loadWorkspace();
        const saved = workspace ? await loadSheet(workspace.sheetId) : await loadActiveSheet();
        if (disposed) return;
        if (saved) {
          sheetRef.current = saved;
          setSheet(saved);
          setActiveFlow(true);
          setCurrentStep(workspace?.step || 2);
        }
      } catch {
        setStartError('Não foi possível recuperar sua ficha. Tente abrir pela biblioteca.');
      } finally {
        if (!disposed) setIsLoaded(true);
      }
    })();

    const contextSync = new SidepanelContextSync(
      readPanelContext,
      (res) => {
        setTabContext(res);
        if (res) {
          setContext((prev) => ({
            ...prev,
            platform: res.platform,
            url: res.url,
            title: res.url,
            summaryLabel:
              res.platform === 'bling' ? 'Bling ERP • ' + res.pageType : 'Contexto ativo'
          }));
        } else {
          setContext((prev) => ({
            ...prev,
            platform: 'neutral',
            url: '',
            title: '',
            summaryLabel: 'Aguardando contexto...'
          }));
        }
      },
      () => setTabContext(null)
    );
    contextSyncRef.current = contextSync;

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      void contextSync.refresh();
      chrome.runtime.sendMessage({ type: 'BLING_GET_CONNECTION_STATUS' }, (res) => {
        if (res && res.status) {
          setBlingStatus(res.status);
          setBlingLastRefreshAt(res.lastRefreshAt ?? null);
        }
        setBlingStatusLoaded(true);
      });
      chrome.runtime.sendMessage({ type: 'ML_GET_CONNECTION_STATUS' }, (res) => {
        if (res && res.ok) {
          setMlInfo({
            connected: res.connected || false,
            status: res.status || (res.connected ? 'connected' : 'disconnected'),
            sellerId: res.sellerId,
            nickname: res.nickname,
            authType: res.authType,
            lastValidatedAt: res.lastValidatedAt
          });
        }
        setMlStatusLoaded(true);
      });
    } else {
      setContext((prev) => ({
        ...prev,
        title: 'Prévia local',
        summaryLabel: 'Abra a extensão no Chrome para acompanhar a página'
      }));
      setBlingStatusLoaded(true);
      setMlStatusLoaded(true);
    }

    const listener = (message: any) => {
      if (message.type === 'CONTEXT_UPDATED' && message.payload) {
        void contextSync.refresh();
      }
      if (message.type === 'ACTIVE_TAB_CONTEXT_UPDATED') {
        void contextSync.refresh();
      }
      if (message.type === 'BLING_CONNECTION_STATUS_CHANGED') {
        setBlingStatus(message.status);
        setBlingLastRefreshAt(message.lastRefreshAt ?? null);
        setBlingStatusLoaded(true);
      }
      if (message.type === 'ML_CONNECTION_STATUS_CHANGED') {
        setMlInfo({
          connected: message.connected || false,
          status: message.status || (message.connected ? 'connected' : 'disconnected'),
          sellerId: message.sellerId,
          nickname: message.nickname,
          authType: message.authType
        });
        setMlStatusLoaded(true);
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
            setCurrentStep(
              typeof data.targetStep === 'number' ? data.targetStep : workspace?.step || 2
            );
            setScreen(data.targetScreen || 'product');
          } else if (data.targetScreen) {
            setScreen(data.targetScreen);
          }
        } catch {}
      })();
    };

    const onTabChanged = () => {
      void contextSync.refresh();
    };

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

  // Save state
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
      void saveSheet(updated).then(
        () => {
          if (revision === saveRevision.current) setSaveState('Salvo neste navegador');
        },
        () => {
          if (revision === saveRevision.current)
            setSaveState('Não foi possível salvar. Tente novamente.');
        }
      );
    }
  };

  useEffect(() => {
    if (isLoaded && activeFlow)
      void saveWorkspace({ sheetId: sheet.id, step: currentStep }).catch(() =>
        setSaveState('Falha ao salvar a posição de trabalho.')
      );
  }, [isLoaded, activeFlow, sheet.id, currentStep]);

  const openSavedProduct = async (product: CentralProductSheet, targetStep = 2) => {
    if (activeFlow && sheetRef.current.id !== product.id) await saveSheet(sheetRef.current);
    await saveWorkspace({ sheetId: product.id, step: targetStep });
    sheetRef.current = product;
    setSheet(product);
    setActiveFlow(true);
    setCurrentStep(targetStep);
    setScreen('product');
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
    const activeId =
      tabContext?.platform === 'bling' ? tabContext?.detectedProduct?.id : undefined;
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
      const existing = savedList.find((s) =>
        s.externalReferences.some(
          (r) => r.system === 'bling' && String(r.externalId) === String(activeId)
        )
      );
      const result = await chrome.runtime.sendMessage({
        type: 'BLING_CATALOG_PRODUCT',
        productId: String(activeId)
      });
      if (!result?.ok)
        throw new Error(result?.error || 'Não foi possível puxar os dados do produto no Bling.');
      const mapped = mapBlingProductToSheetPatch(result.product, {
        externalId: String(activeId),
        retrievedAt: result.retrievedAt,
        sourceName: 'Bling ERP (API Oficial v3)',
        confirmedUnits: { weight: 'kg', dimension: 'cm' },
        stockInfo:
          tabContext?.uiState?.quickView?.productId === String(activeId)
            ? tabContext.uiState.quickView.stockInfo
            : null
      });
      const reconciled = reconcileBlingPatch(existing || createInitialSheet(), mapped).sheet;
      const readyForMl = prepareBlingSheetForMlExport(reconciled);
      await saveSheet(readyForMl);
      await openSavedProduct(readyForMl, 4);
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : 'Falha ao puxar o produto do Bling.'
      );
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
    setStartingProduct(true);
    setStartError('');
    const target = tabContext;
    try {
      if (activeFlow) await saveSheet(sheetRef.current);
      const initial = createInitialSheet();
      await saveSheet(initial);
      if (
        target?.platform === 'bling' &&
        target.pageType === 'product_form_new' &&
        typeof target.tabId === 'number'
      ) {
        const result = await chrome.runtime.sendMessage({
          type: 'LINK_SHEET_TO_TAB',
          windowId: (await chrome.windows.getCurrent()).id,
          tabId: target.tabId,
          sheetId: initial.id,
          expectedPageInstanceId: target.pageInstanceId,
          expectedUrl: target.url
        });
        if (!result?.ok || !result.state)
          throw new Error(
            result?.error || 'Não foi possível vincular a ficha. Tente novamente.'
          );
        setTabContext(result.state);
      }
      sheetRef.current = initial;
      setSheet(initial);
      setActiveFlow(true);
      setCurrentStep(1);
      setScreen('product');
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : 'Não foi possível iniciar o produto.'
      );
    } finally {
      setStartingProduct(false);
    }
  };

  const handleReset = () => {
    void handleStartNewProduct();
  };

  const handleUpdateProductInBling = async (
    confirmedPatch: string
  ): Promise<BlingUpdateProductMessageResponse> => {
    if (!tabContext?.tabId || !tabContext?.detectedProduct?.id || !tabContext?.activeSheetId) {
      return { ok: false, stale: true, error: 'O produto aberto ou a ficha vinculada mudou.' };
    }
    await saveSheet(sheet);
    const windowId = (await chrome.windows.getCurrent()).id;
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'BLING_UPDATE_PRODUCT',
          tabId: tabContext.tabId,
          windowId,
          pageInstanceId: tabContext.pageInstanceId,
          contextRevision: tabContext.contextRevision,
          productId: tabContext.detectedProduct.id,
          sheetId: tabContext.activeSheetId,
          confirmed: true,
          confirmedPatch
        },
        (response: BlingUpdateProductMessageResponse | undefined) => {
          const runtimeError = chrome.runtime.lastError;
          resolve(
            response || {
              ok: false,
              error: runtimeError?.message || 'O Background não respondeu.'
            }
          );
        }
      );
    });
  };

  // ── Bling Connection Handlers ──────────────────────────────────────────────

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
          setBlingStatus((prev) => (prev === 'connected' ? 'gateway_unreachable' : prev));
        }
      });
    }
  };

  const handleBlingFocusOAuthTab = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'BLING_FOCUS_OAUTH_TAB' });
    }
  };

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

  // ── Mercado Livre Connection Handlers ──────────────────────────────────────

  const handleSaveMlApiKey = async (apiKey: string): Promise<{ ok: boolean; error?: string }> => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return { ok: false, error: 'Extensão não disponível no momento.' };
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'ML_SAVE_API_KEY', apiKey }, (res) => {
        const err = chrome.runtime.lastError?.message;
        if (err) {
          resolve({ ok: false, error: err });
          return;
        }
        if (res?.ok) {
          setMlInfo({
            connected: true,
            status: 'connected',
            sellerId: res.sellerId,
            nickname: res.nickname,
            authType: 'direct_token',
            lastValidatedAt: res.lastValidatedAt
          });
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: res?.error || 'Erro ao validar Token de Acesso.' });
        }
      });
    });
  };

  const handleDisconnectMl = async (): Promise<void> => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'ML_DISCONNECT' }, () => {
        setMlInfo({ connected: false, status: 'disconnected' });
        resolve();
      });
    });
  };

  const handleStartMlOAuth = async () => {
    try {
      const result = await mlAction('start');
      const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://auth.mercadolivre.com.br' || url.pathname !== '/authorization') {
        throw new Error('Endereço de autorização inválido.');
      }
      await chrome.tabs.create({ url: url.href });
    } catch (err: any) {
      console.error('Falha ao iniciar OAuth do Mercado Livre:', err);
    }
  };

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (importAfterConnect && blingStatus === 'connected') {
      setLibrarySource('bling');
      setScreen('library');
      setImportAfterConnect(false);
    }
  }, [importAfterConnect, blingStatus]);

  useEffect(() => {
    window.scrollTo?.({ top: 0, behavior: 'instant' });
  }, [screen, currentStep]);

  // ── Step map ───────────────────────────────────────────────────────────────

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

  const activeBlingProductId =
    tabContext?.platform === 'bling' ? tabContext?.detectedProduct?.id : undefined;

  // ── Tab bar config ─────────────────────────────────────────────────────────

  const tabs: Array<{ id: PopupScreen; icon: React.ReactNode; label: string }> = [
    { id: 'home', icon: <Home className="w-4 h-4" />, label: 'Início' },
    { id: 'product', icon: <Package className="w-4 h-4" />, label: 'Produto' },
    { id: 'library', icon: <BookOpen className="w-4 h-4" />, label: 'Biblioteca' },
    { id: 'connections', icon: <Link2 className="w-4 h-4" />, label: 'Conexões' },
    { id: 'config', icon: <Settings className="w-4 h-4" />, label: 'Config' }
  ];

  const navigateTo = (s: PopupScreen) => {
    if (s === 'library') setLibrarySource('saved');
    setImportAfterConnect(false);
    setScreen(s);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        width: '380px',
        minHeight: '400px',
        maxHeight: '600px',
        overflowY: 'auto',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '13px',
        color: '#1e293b',
        backgroundColor: '#f8fafc'
      }}
    >
      {/* ── Header AvantPro style ── */}
      <header
        style={{ background: 'linear-gradient(135deg, #1278f9, #094eb0)' }}
        className="sticky top-0 z-30 px-3.5 py-2.5 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center p-0.5">
            <img
              src="/icons/logo.png"
              alt="Paulifest"
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
          <h1 className="text-white font-extrabold text-sm tracking-tight">
            Paulifest Copilot
          </h1>
        </div>
        <span
          className="text-white font-bold uppercase flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
          style={{ backgroundColor: '#10b981', borderRadius: '20px' }}
        >
          <Zap className="w-2.5 h-2.5" /> Pro
        </span>
      </header>

      {/* ── Tab bar ── */}
      <div className="bg-white border-b border-[#e2e8f0] flex">
        {tabs.map((tab) => {
          const isActive = screen === tab.id;
          const isDisabled = tab.id === 'product' && !activeFlow;
          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && navigateTo(tab.id)}
              disabled={isDisabled}
              title={isDisabled ? 'Inicie um produto primeiro' : tab.label}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[9px] font-semibold transition-colors
                ${isActive
                  ? 'text-[#1278f9] border-b-2 border-[#1278f9]'
                  : isDisabled
                    ? 'text-[#cbd5e1] cursor-not-allowed'
                    : 'text-[#64748b] hover:text-[#1278f9]'
                }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      <main className="p-3">
        {startError && (
          <p role="alert" className="text-xs text-red-700 mb-2 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {startError}
          </p>
        )}

        {/* ═══ HOME ═══ */}
        {screen === 'home' && (
          <div>
            {/* Context Card */}
            <Card>
              <CardTitle>
                <span
                  className={`w-2 h-2 rounded-full animate-pulse ${
                    tabContext ? 'bg-emerald-500' : 'bg-[#94a3b8]'
                  }`}
                />
                Contexto Ativo
              </CardTitle>
              <div className="text-xs text-[#475569] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold uppercase text-[10px] tracking-wide text-[#94a3b8]">
                    Plataforma
                  </span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      context.platform === 'bling'
                        ? 'bg-emerald-100 text-emerald-700'
                        : context.platform === 'mercadolivre'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-[#f1f5f9] text-[#64748b]'
                    }`}
                  >
                    {context.platform === 'bling'
                      ? 'Bling ERP'
                      : context.platform === 'mercadolivre'
                        ? 'Mercado Livre'
                        : 'Neutro'}
                  </span>
                </div>
                {context.url && (
                  <p className="font-mono text-[10px] truncate text-[#94a3b8]">
                    {context.url.replace(/^https?:\/\/(www\.)?/, '')}
                  </p>
                )}
                <p className="text-[11px]">{context.summaryLabel}</p>
              </div>
            </Card>

            {/* Banner: produto Bling ativo */}
            {activeBlingProductId && (
              <button
                onClick={() => void handlePullActiveBlingToMl()}
                disabled={startingProduct}
                className="w-full mb-3 flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-left hover:bg-emerald-100 transition-colors"
              >
                <div>
                  <p className="text-xs font-bold text-emerald-800">
                    Bling #{activeBlingProductId} aberto
                  </p>
                  <p className="text-[10px] text-emerald-600">Exportar para ML →</p>
                </div>
                <ExternalLink className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              </button>
            )}

            {/* Draft card */}
            {activeFlow && (
              <Card>
                <CardTitle>📋 Rascunho atual</CardTitle>
                <p className="text-xs text-[#475569] truncate mb-2">
                  {sheet.titleBling?.value?.toUpperCase() ||
                    sheet.title.value ||
                    sheet.sku.value ||
                    'Novo produto'}
                </p>
                <div className="flex gap-2">
                  <SecondaryButton onClick={() => setScreen('product')} className="text-xs py-1.5">
                    Continuar
                  </SecondaryButton>
                  <SecondaryButton
                    onClick={() => {
                      setCurrentStep(4);
                      setScreen('product');
                    }}
                    className="text-xs py-1.5"
                  >
                    Anúncio ML
                  </SecondaryButton>
                </div>
              </Card>
            )}

            {/* Quick actions */}
            <div className="space-y-2">
              <PrimaryButton
                onClick={() => void handleStartNewProduct()}
                disabled={startingProduct || !isLoaded}
              >
                {startingProduct ? 'Iniciando…' : '+ Novo produto (Bling → ML)'}
              </PrimaryButton>
              <SecondaryButton
                onClick={() => {
                  if (blingStatus === 'connected') {
                    setLibrarySource('bling');
                    setScreen('library');
                  } else {
                    setImportAfterConnect(true);
                    setScreen('connections');
                  }
                }}
              >
                📥 Importar do Bling para ML
              </SecondaryButton>
            </div>

            {/* Bling Quick View */}
            {tabContext?.platform === 'bling' &&
              (tabContext?.uiState?.quickView ||
                tabContext?.uiState?.quickViewLoading ||
                tabContext?.uiState?.quickViewError) && (
                <Card className="mt-3 border-[#1278f9]/20 bg-gradient-to-br from-white to-blue-50/30">
                  <CardTitle>
                    <Tag className="w-3.5 h-3.5 text-[#1278f9]" /> Quick View · Bling ERP
                    <span className="ml-auto text-[9px] font-semibold text-[#94a3b8] bg-[#f1f5f9] px-1.5 py-0.5 rounded">
                      Somente Leitura
                    </span>
                  </CardTitle>
                  {tabContext.uiState.quickViewLoading && (
                    <div className="text-[11px] text-[#94a3b8] flex items-center gap-2">
                      <RefreshCw className="w-3 h-3 animate-spin text-[#1278f9]" />
                      Carregando estoque e custo...
                    </div>
                  )}
                  {tabContext.uiState.quickViewError && (
                    <div className="text-[11px] text-red-600 bg-red-50 border border-red-200/60 rounded p-2 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {tabContext.uiState.quickViewError}
                    </div>
                  )}
                  {tabContext.uiState.quickView && (
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#f8fafc] rounded-lg p-2 border border-[#e2e8f0]">
                        <span className="text-[9.5px] text-[#94a3b8] block font-medium mb-0.5">
                          Estoque Disponível
                        </span>
                        <span className="text-xs font-bold text-[#0f172a]">
                          {tabContext.uiState.quickView.stockInfo != null
                            ? `${tabContext.uiState.quickView.stockInfo.virtualTotal} un.`
                            : 'Não informado'}
                        </span>
                      </div>
                      <div className="bg-[#f8fafc] rounded-lg p-2 border border-[#e2e8f0]">
                        <span className="text-[9.5px] text-[#94a3b8] block font-medium mb-0.5">
                          Preço de Custo (CMV)
                        </span>
                        <span className="text-xs font-bold text-[#0f172a]">
                          {tabContext.uiState.quickView.costPrice != null
                            ? `R$ ${tabContext.uiState.quickView.costPrice
                                .toFixed(2)
                                .replace('.', ',')}`
                            : 'Não informado'}
                        </span>
                      </div>
                    </div>
                  )}
                </Card>
              )}

            <button
              onClick={() => {
                setLibrarySource('saved');
                setScreen('library');
              }}
              className="mt-2 text-xs text-[#1278f9] hover:underline w-full text-right"
            >
              Gerenciar rascunhos →
            </button>
          </div>
        )}

        {/* ═══ PRODUCT ═══ */}
        {screen === 'product' && activeFlow && (
          <section className="space-y-2.5">
            {/* Product header */}
            <Card className="mb-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Tag className="w-3 h-3 text-[#1278f9] flex-shrink-0" />
                  <span className="text-xs font-semibold text-[#0f172a] truncate max-w-[180px]">
                    {sheet.titleBling?.value?.toUpperCase() ||
                      sheet.title.value ||
                      sheet.sku.value ||
                      'Novo produto'}
                  </span>
                  {sheet.hasUnresolvedConflicts && (
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-300 px-1 py-0.5 rounded">
                      Divergência
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span role="status" className="text-[9.5px] text-[#94a3b8]">
                    {saveState === 'Salvo neste navegador' ? 'Salvo' : saveState}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteDraft(sheet.id)}
                    className="text-[10px] text-[#94a3b8] hover:text-red-600 font-medium flex items-center gap-0.5 transition-colors"
                    title="Apagar este rascunho"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>Apagar</span>
                  </button>
                  <button
                    onClick={handleReset}
                    className="text-[10px] text-[#94a3b8] hover:text-[#1278f9] font-medium flex items-center gap-0.5 transition-colors"
                    title="Novo produto"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Novo</span>
                  </button>
                </div>
              </div>

              {saveState.startsWith('Não foi') && (
                <button
                  className="text-[11px] text-red-700 mb-1"
                  onClick={() => handleUpdateSheet((prev) => ({ ...prev }))}
                >
                  Tentar salvar novamente
                </button>
              )}

              {/* 4 main step tabs */}
              <div
                role="tablist"
                aria-label="Etapas do produto"
                className="grid grid-cols-4 gap-0.5 rounded-lg bg-[#f1f5f9] p-0.5 text-[10px]"
              >
                {(
                  [
                    [1, '1. Produto'],
                    [2, '2. Ficha'],
                    [3, '3. Preço'],
                    [4, '4. ML']
                  ] as [number, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={currentStep === id}
                    onClick={() => setCurrentStep(id)}
                    className={`py-1.5 rounded-md transition-all font-semibold ${
                      currentStep === id
                        ? 'bg-white text-[#1278f9] shadow-sm'
                        : 'text-[#64748b]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* More options */}
              <details className="text-[11px] mt-1">
                <summary className="cursor-pointer py-0.5 text-[#94a3b8] hover:text-[#0f172a]">
                  Mais opções{currentStep > 4 ? ' · ' + steps[currentStep][0] : ''}
                </summary>
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {(
                    [
                      [5, 'Resumo e kits'],
                      [6, 'Fotos'],
                      [7, 'Referências'],
                      [8, 'Mercado']
                    ] as [number, string][]
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setCurrentStep(id)}
                      className={`border rounded-md px-2 py-1 text-[10px] transition-colors ${
                        currentStep === id
                          ? 'border-[#1278f9] text-[#1278f9] bg-blue-50'
                          : 'border-[#e2e8f0] text-[#1278f9]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </details>
            </Card>

            {/* Step content */}
            <div id="product-panel" role="tabpanel" className="space-y-2.5">
              {currentStep > 4 && (
                <div className="px-0.5">
                  <h2 className="text-sm font-bold text-[#0f172a]">{steps[currentStep][0]}</h2>
                </div>
              )}
              {currentStep === 8 && (
                <MarketTab key={sheet.id} sheet={sheet} onUpdateSheet={handleUpdateSheet} />
              )}
              {currentStep === 5 && (
                <OverviewTab
                  key={sheet.id}
                  sheet={sheet}
                  onCreate={async (product) => {
                    await saveSheet(product);
                    await openSavedProduct(product);
                    setCurrentStep(5);
                  }}
                />
              )}
              {currentStep === 6 && (
                <ImagesTab key={sheet.id} sheet={sheet} onUpdateSheet={handleUpdateSheet} />
              )}
              {currentStep === 7 && (
                <ReferencesTab key={sheet.id} sheet={sheet} onUpdateSheet={handleUpdateSheet} />
              )}
              {currentStep === 2 && (
                <details className="text-xs border border-[#e2e8f0] bg-white rounded-lg p-2.5">
                  <summary className="cursor-pointer text-[11px] font-medium text-[#64748b]">
                    Variações de cor ou tamanho
                  </summary>
                  <VariationEditor
                    key={sheet.id}
                    sheet={sheet}
                    onUpdateSheet={handleUpdateSheet}
                  />
                </details>
              )}
              {currentStep === 4 && (
                <ListingWorkspace
                  key={sheet.id}
                  sheet={sheet}
                  onBack={() => setCurrentStep(2)}
                  onUpdateSheet={handleUpdateSheet}
                />
              )}
              {currentStep === 1 && (
                <StepInput
                  key={sheet.id}
                  sheet={sheet}
                  onUpdateSheet={handleUpdateSheet}
                  onNext={() => setCurrentStep(2)}
                />
              )}
              {currentStep === 2 && (
                <StepSheet
                  key={sheet.id}
                  sheet={sheet}
                  onUpdateSheet={handleUpdateSheet}
                  onNext={() => setCurrentStep(3)}
                  onPrev={() => setCurrentStep(1)}
                  onExportMl={() => setCurrentStep(4)}
                  blingTarget={
                    tabContext?.platform === 'bling' &&
                    tabContext?.pageType === 'product_form_edit' &&
                    tabContext?.detectedProduct?.id &&
                    tabContext?.activeSheetId === sheet.id
                      ? {
                          productId: tabContext.detectedProduct.id,
                          connected: blingStatus === 'connected',
                          contextKey: JSON.stringify([
                            tabContext.tabId,
                            tabContext.pageInstanceId,
                            tabContext.contextRevision
                          ])
                        }
                      : undefined
                  }
                  newBlingTarget={
                    tabContext?.platform === 'bling' &&
                    tabContext?.pageType === 'product_form_new' &&
                    typeof tabContext?.tabId === 'number'
                      ? {
                          tabId: tabContext.tabId,
                          pageInstanceId: tabContext.pageInstanceId,
                          url: tabContext.url
                        }
                      : undefined
                  }
                  onUpdateBling={handleUpdateProductInBling}
                />
              )}
              {currentStep === 3 && (
                <StepPricing
                  key={sheet.id}
                  sheet={sheet}
                  onUpdateSheet={handleUpdateSheet}
                  onPrev={() => setCurrentStep(2)}
                  onFinish={() => setCurrentStep(4)}
                />
              )}
            </div>
          </section>
        )}

        {/* ═══ PRODUCT (no flow) ═══ */}
        {screen === 'product' && !activeFlow && (
          <Card>
            <CardTitle>📦 Nenhum produto ativo</CardTitle>
            <p className="text-xs text-[#475569] mb-3">
              Inicie um novo produto ou abra um da biblioteca para trabalhar aqui.
            </p>
            <PrimaryButton onClick={() => void handleStartNewProduct()} disabled={startingProduct}>
              {startingProduct ? 'Iniciando…' : '+ Novo produto'}
            </PrimaryButton>
          </Card>
        )}

        {/* ═══ LIBRARY ═══ */}
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
            onDeleteDraft={(deletedId, deletedAll) =>
              void handleDeleteDraft(deletedId, deletedAll)
            }
            onConnectBling={() => {
              setImportAfterConnect(true);
              setScreen('connections');
            }}
          />
        )}

        {/* ═══ CONNECTIONS ═══ */}
        {screen === 'connections' && (
          <div className="space-y-3">
            <Card className="mb-0">
              <CardTitle>🔗 Bling ERP</CardTitle>
              <p className="text-xs text-[#475569] mb-3">
                {importAfterConnect
                  ? 'Conecte o Bling para buscar seus produtos.'
                  : 'Conecte sua conta do Bling ERP ao Copilot.'}
              </p>
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
            </Card>

            <MlConnectionCard
              info={mlInfo}
              isHydrating={!mlStatusLoaded}
              onSaveApiKey={handleSaveMlApiKey}
              onDisconnect={handleDisconnectMl}
              onStartOAuth={handleStartMlOAuth}
            />

            {/* Open linked sheet */}
            {tabContext?.activeSheetId && tabContext.activeSheetId !== sheet.id && (
              <SecondaryButton
                className="mb-3"
                onClick={() => {
                  void loadSheet(tabContext.activeSheetId)
                    .then((value) => value && openSavedProduct(value))
                    .catch(() => setStartError('Não foi possível abrir a ficha da página.'));
                }}
              >
                Abrir ficha vinculada à página atual
              </SecondaryButton>
            )}

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              className="text-xs text-[#1278f9] flex items-center gap-1 mb-3"
            >
              <RefreshCw className={`w-3 h-3 ${refreshSpin ? 'animate-spin' : ''}`} />
              {refreshSpin ? 'Atualizando…' : 'Atualizar página conectada'}
            </button>

            {/* Context card */}
            <Card>
              <CardTitle>
                <span
                  className={`w-2 h-2 rounded-full ${
                    tabContext ? 'bg-emerald-500 animate-pulse' : 'bg-[#cbd5e1]'
                  }`}
                />
                Contexto Ativo
                <span className="ml-auto text-[9px] text-[#1278f9] font-medium flex items-center gap-1">
                  Tempo Real <span className="w-1 h-1 bg-[#1278f9] rounded-full animate-ping inline-block" />
                </span>
              </CardTitle>
              <div className="text-xs text-[#475569] space-y-0.5">
                <p className="font-semibold text-[#0f172a]">{context.summaryLabel}</p>
                <p className="text-[11px]">{context.title || 'Aguardando navegação...'}</p>
                {context.url && (
                  <p className="font-mono text-[10px] truncate text-[#94a3b8]">
                    {context.url.replace(/^https?:\/\/(www\.)?/, '')}
                  </p>
                )}
              </div>
            </Card>

            {/* Bling Quick View on connections tab */}
            {tabContext?.platform === 'bling' &&
              (tabContext?.uiState?.quickView ||
                tabContext?.uiState?.quickViewLoading ||
                tabContext?.uiState?.quickViewError) && (
                <Card className="border-[#1278f9]/20 bg-gradient-to-br from-white to-blue-50/30">
                  <CardTitle>
                    <Tag className="w-3.5 h-3.5 text-[#1278f9]" /> Quick View · Bling ERP
                    <span className="ml-auto text-[9px] font-semibold text-[#94a3b8] bg-[#f1f5f9] px-1.5 py-0.5 rounded">
                      Somente Leitura
                    </span>
                  </CardTitle>
                  {tabContext.uiState.quickViewLoading && (
                    <div className="text-[11px] text-[#94a3b8] flex items-center gap-2">
                      <RefreshCw className="w-3 h-3 animate-spin text-[#1278f9]" />
                      Carregando estoque e custo...
                    </div>
                  )}
                  {tabContext.uiState.quickViewError && (
                    <div className="text-[11px] text-red-600 bg-red-50 border border-red-200/60 rounded p-2 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {tabContext.uiState.quickViewError}
                    </div>
                  )}
                  {tabContext.uiState.quickView && (
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#f8fafc] rounded-lg p-2 border border-[#e2e8f0]">
                        <span className="text-[9.5px] text-[#94a3b8] block font-medium mb-0.5">
                          Estoque Disponível
                        </span>
                        <span className="text-xs font-bold text-[#0f172a]">
                          {tabContext.uiState.quickView.stockInfo != null
                            ? `${tabContext.uiState.quickView.stockInfo.virtualTotal} un.`
                            : 'Não informado'}
                        </span>
                      </div>
                      <div className="bg-[#f8fafc] rounded-lg p-2 border border-[#e2e8f0]">
                        <span className="text-[9.5px] text-[#94a3b8] block font-medium mb-0.5">
                          Preço de Custo (CMV)
                        </span>
                        <span className="text-xs font-bold text-[#0f172a]">
                          {tabContext.uiState.quickView.costPrice != null
                            ? `R$ ${tabContext.uiState.quickView.costPrice
                                .toFixed(2)
                                .replace('.', ',')}`
                            : 'Não informado'}
                        </span>
                      </div>
                    </div>
                  )}
                </Card>
              )}

            {/* Bling banner */}
            {screen === 'connections' && tabContext?.platform === 'bling' && (
              <div className="bg-emerald-50 border border-emerald-200/60 rounded-lg px-3 py-2 flex items-center justify-between text-xs text-emerald-900 mt-2">
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
          </div>
        )}

        {/* ═══ CONFIG ═══ */}
        {screen === 'config' && <ConfigTab />}
      </main>
    </div>
  );
};

export default PopupApp;
