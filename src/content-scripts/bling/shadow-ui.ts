// Componente de UI Contextual Injetada no Bling ERP via Shadow DOM (Fase 4B)
// Atualizado na Fase 4C.4B: auth-awareness mínima no Dock (feedback de estado de conexão).
import type {
  BlingPageType,
  TabContextUiState,
  ContextualActionType
} from '../../shared/tab-context-contracts.ts';
import type { BlingConnectionStatus, BlingProductQuickView } from '../../shared/gateway-contracts.ts';

export interface FormattedQuickViewDisplay {
  stockText: string;
  costText: string;
  hasStock: boolean;
  hasCost: boolean;
}

export function formatQuickViewDisplay(quickView: BlingProductQuickView | null | undefined): FormattedQuickViewDisplay {
  if (!quickView) {
    return {
      stockText: 'Estoque: Não informado',
      costText: 'Custo: Não informado',
      hasStock: false,
      hasCost: false
    };
  }

  const stock = quickView.stockInfo;
  let stockText = 'Estoque: Não informado';
  let hasStock = false;

  if (stock !== null && stock !== undefined) {
    hasStock = true;
    stockText = `Estoque: ${stock.virtualTotal} disp. (${stock.physicalTotal} físico)`;
  }

  let costText = 'Custo: Não informado';
  let hasCost = false;

  if (quickView.costPrice !== null && quickView.costPrice !== undefined) {
    hasCost = true;
    costText = `Custo: R$ ${quickView.costPrice.toFixed(2).replace('.', ',')}`;
  }

  return { stockText, costText, hasStock, hasCost };
}

const HOST_ID = 'paulifest-seller-copilot-host';

export interface ShadowUiOptions {
  onAction: (action: ContextualActionType, options?: { openSidePanel?: boolean }) => Promise<any> | void;
  onQuickGenerateSku?: () => { ok: boolean; value?: string; message: string };
  onQuickGenerateEan?: () => { ok: boolean; value?: string; message: string };
  onQuickApplyCost?: (costValue: number) => Promise<{ ok: boolean; message: string }>;
  onQuickApplyStock?: (stockValue: number) => Promise<{ ok: boolean; message: string }>;
  onQuickConnectBling?: () => void;
  onQuickRetryBling?: () => void;
}

export class BlingShadowUi {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private onAction: (action: ContextualActionType, options?: { openSidePanel?: boolean }) => Promise<any> | void;
  private onQuickGenerateSku?: () => { ok: boolean; value?: string; message: string };
  private onQuickGenerateEan?: () => { ok: boolean; value?: string; message: string };
  private onQuickApplyCost?: (costValue: number) => Promise<{ ok: boolean; message: string }>;
  private onQuickConnectBling?: () => void;
  private onQuickRetryBling?: () => void;
  private currentUiState: TabContextUiState = {
    dockVisible: false,
    canImport: false,
    isSimulatedMock: true
  };
  private currentPageType: BlingPageType = 'other';
  private currentDetectedProduct?: { id?: string; sku?: string };
  // Fase 4C.4B: Estado de conexão Bling — não persistido, hidratado via query/broadcast
  private blingConnectionStatus: BlingConnectionStatus = 'disconnected';

  private isMinimized = false;
  private isAppExpanded = false;
  private embeddedIframe: HTMLIFrameElement | null = null;
  private readonly onViewportResize = () => this.applyPosition();
  private dragOffset: { x: number; y: number } | null = null;
  private customPos: { x: number; y: number } | null = null;

  constructor(options: ShadowUiOptions) {
    this.onAction = options.onAction;
    this.onQuickGenerateSku = options.onQuickGenerateSku;
    this.onQuickGenerateEan = options.onQuickGenerateEan;
    this.onQuickApplyCost = options.onQuickApplyCost;
    this.onQuickConnectBling = options.onQuickConnectBling;
    this.onQuickRetryBling = options.onQuickRetryBling;
    this.loadSavedUiPrefs();
  }

  private loadSavedUiPrefs(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('paulifest_dock_ui_state');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.minimized === 'boolean') this.isMinimized = parsed.minimized;
          if (typeof parsed.appExpanded === 'boolean') this.isAppExpanded = parsed.appExpanded;
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            this.customPos = { x: parsed.x, y: parsed.y };
          }
        }
      }
    } catch {
      // Ignora caso localStorage esteja indisponível
    }
  }

  private saveUiPrefs(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(
          'paulifest_dock_ui_state',
          JSON.stringify({
            minimized: this.isMinimized,
            appExpanded: this.isAppExpanded,
            x: this.customPos?.x,
            y: this.customPos?.y
          })
        );
      }
    } catch {
      // Ignora caso localStorage esteja indisponível
    }
  }

  private applyPosition(): void {
    if (!this.host || typeof window === 'undefined') return;
    if (this.customPos) {
      const maxX = Math.max(8, (window.innerWidth || 1200) - (this.host.getBoundingClientRect?.().width || 380) - 16);
      const maxY = Math.max(16, (window.innerHeight || 800) - (this.host.getBoundingClientRect?.().height || 80));
      const clampedX = Math.min(Math.max(8, this.customPos.x), maxX);
      const clampedY = Math.min(Math.max(8, this.customPos.y), maxY);
      this.host.style.left = `${clampedX}px`;
      this.host.style.top = `${clampedY}px`;
      this.host.style.right = 'auto';
      this.host.style.bottom = 'auto';
    } else {
      this.host.style.left = 'auto';
      this.host.style.top = 'auto';
      this.host.style.right = '20px';
      this.host.style.bottom = '20px';
    }
  }

  mount(): void {
    if (typeof document === 'undefined' || !document.body) return;

    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      document.body.appendChild(host);
    }
    this.host = host;

    // Regra: Usar mode: 'open' para testabilidade e inspeção
    if (!this.host.shadowRoot) {
      this.shadow = this.host.attachShadow({ mode: 'open' });
    } else {
      this.shadow = this.host.shadowRoot;
    }

    this.render();
    if (typeof window !== 'undefined') window.addEventListener?.('resize', this.onViewportResize);
  }

  minimizeForWorkspace(): void {
    this.isMinimized = true;
    this.shadow?.getElementById('dock-card')?.classList.add('is-minimized');
    const button = this.shadow?.getElementById('btn-toggle-minimize');
    if (button) { button.textContent = '+'; button.title = 'Expandir painel'; }
    this.applyPosition();
  }

  unmount(): void {
    if (typeof window !== 'undefined') window.removeEventListener?.('resize', this.onViewportResize);
    if (typeof document !== 'undefined') {
      const badge = document.getElementById('paulifest-inline-cost-badge');
      if (badge) badge.remove();
    }
    if (this.host && this.host.parentElement) {
      this.host.parentElement.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
    this.embeddedIframe = null;
  }

  update(
    uiState: TabContextUiState,
    pageType: BlingPageType,
    detectedProduct?: { id?: string; sku?: string }
  ): void {
    this.currentUiState = uiState;
    this.currentPageType = pageType;
    this.currentDetectedProduct = detectedProduct;

    if (!this.shadow) {
      this.mount();
    } else {
      this.render();
    }
  }

  updateConnectionStatus(status: BlingConnectionStatus): void {
    this.blingConnectionStatus = status;
    if (this.shadow) {
      this.render();
    }
  }

  private openEmbeddedApp(targetScreen?: 'product' | 'connections' | 'library' | 'home', targetStep?: number): void {
    if (!this.shadow) return;
    this.isMinimized = false;
    this.isAppExpanded = true;
    const dockCard = this.shadow.getElementById('dock-card');
    const btnMinimize = this.shadow.getElementById('btn-toggle-minimize');
    if (dockCard) {
      dockCard.classList?.remove?.('is-minimized');
      dockCard.classList?.add?.('is-expanded-app');
    }
    if (btnMinimize) {
      btnMinimize.textContent = '—';
      btnMinimize.title = 'Minimizar painel';
    }
    const appWrap = this.shadow.getElementById('embedded-app-wrap');
    const quickWrap = this.shadow.getElementById('quick-summary-wrap');
    const btnToggleMode = this.shadow.getElementById('btn-toggle-app-mode');
    if (appWrap) appWrap.hidden = false;
    if (quickWrap) quickWrap.hidden = true;
    if (btnToggleMode) btnToggleMode.textContent = '⚡ Modo Rápido';

    if (!this.embeddedIframe && typeof chrome !== 'undefined' && chrome.runtime?.getURL && typeof document !== 'undefined') {
      const iframe = document.createElement('iframe');
      iframe.src = chrome.runtime.getURL('sidepanel.html?embedded=1');
      iframe.className = 'embedded-app-frame';
      iframe.title = 'Paulifest Seller Copilot';
      iframe.onload = () => {
        if (targetScreen || targetStep) {
          iframe.contentWindow?.postMessage({ type: 'PAULIFEST_SYNC_WORKSPACE', targetScreen, targetStep }, '*');
        }
      };
      this.embeddedIframe = iframe;
      appWrap?.appendChild(iframe);
    } else if (this.embeddedIframe?.contentWindow) {
      this.embeddedIframe.contentWindow.postMessage({ type: 'PAULIFEST_SYNC_WORKSPACE', targetScreen, targetStep }, '*');
    }
    this.saveUiPrefs();
    this.applyPosition();
  }

  private setQuickModeView(): void {
    if (!this.shadow) return;
    this.isAppExpanded = false;
    const dockCard = this.shadow.getElementById('dock-card');
    dockCard?.classList?.remove?.('is-expanded-app');
    const appWrap = this.shadow.getElementById('embedded-app-wrap');
    const quickWrap = this.shadow.getElementById('quick-summary-wrap');
    const btnToggleMode = this.shadow.getElementById('btn-toggle-app-mode');
    if (appWrap) appWrap.hidden = true;
    if (quickWrap) quickWrap.hidden = false;
    if (btnToggleMode) btnToggleMode.textContent = '✨ App Completo';
    this.saveUiPrefs();
    this.applyPosition();
  }

  private render(): void {
    if (!this.shadow) return;

    if (!this.currentUiState.dockVisible || this.currentPageType === 'other') {
      this.shadow.innerHTML = '';
      this.embeddedIframe = null;
      return;
    }

    const hasId = Boolean(this.currentDetectedProduct?.id);
    const isNew = this.currentPageType === 'product_form_new';
    const isForm = isNew || this.currentPageType === 'product_form_edit';

    // Fase 4C.4B: Auth-awareness — o Dock bloqueia importação se sessão não estiver ready.
    const isConnected = this.blingConnectionStatus === 'connected';
    const isTransitoryBlocked = this.blingConnectionStatus === 'gateway_unreachable' ||
                                this.blingConnectionStatus === 'refreshing';
    const isPermBlocked = this.blingConnectionStatus === 'disconnected' ||
                          this.blingConnectionStatus === 'requires_reauth' ||
                          this.blingConnectionStatus === 'session_expired' ||
                          this.blingConnectionStatus === 'configuration_error' ||
                          this.blingConnectionStatus === 'connecting' ||
                          this.blingConnectionStatus === 'awaiting_oauth';

    const canImport = isConnected && this.currentUiState.canImport && hasId;

    this.applyPosition();

    let dockRoot = this.shadow.getElementById('dock-root');
    if (!dockRoot) {
      this.shadow.innerHTML = `
        <style>
          :host { all: initial; font: 13px/1.5 system-ui, sans-serif; color: #17243a; position: fixed; right: 20px; bottom: 20px; z-index: 999999; pointer-events: none; }
          * { box-sizing: border-box; }
          [hidden] { display:none!important; }
          .dock-container { pointer-events: auto; display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
          .dock-card { background:#fff; border:1px solid #dbe3ee; border-radius:18px; box-shadow:0 12px 40px #17243a33; width:min(380px,calc(100vw - 24px)); max-height:calc(100dvh - 24px); display:flex; flex-direction:column; overflow:hidden; transition:width .18s ease; }
          .dock-card.is-expanded-app { width:min(460px,calc(100vw - 20px)); height:min(740px,calc(100dvh - 24px)); }
          .dock-header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:11px 14px; border-bottom:1px solid #e9edf3; cursor:grab; touch-action:none; background:#f8fafc; flex-shrink:0; }
          .dock-header:active { cursor:grabbing; }
          .dock-title { display:flex; align-items:center; gap:7px; font-size:13.5px; font-weight:700; white-space:nowrap; }
          .dock-logo { width:22px; height:22px; object-fit:contain; display:none; background:#fff; border-radius:6px; padding:1px; }
          .drag-grip { color:#98a2b3; }
          .header-controls { display:flex; align-items:center; gap:6px; }
          .dock-badge { border-radius:6px; padding:2px 6px; background:#edf4ff; color:#2458d3; font-size:10px; font-weight:600; }
          .mode-btn { border:1px solid #c7d7fe; background:#eef4ff; color:#1d4ed8; border-radius:7px; padding:4px 8px; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap; }
          .mode-btn:hover { background:#dbeafe; }
          .sidepanel-link-btn { border:1px solid #dbe3ee; background:#fff; color:#475467; border-radius:7px; padding:4px 7px; font-size:11px; font-weight:600; cursor:pointer; }
          .sidepanel-link-btn:hover { background:#f1f5f9; color:#1e293b; }
          .icon-btn { width:28px; height:28px; border:1px solid #dbe3ee; background:#fff; color:#475467; border-radius:8px; font-size:16px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
          .icon-btn:hover { background:#edf4ff; }
          button:focus-visible { outline:3px solid #3483fa; outline-offset:2px; }
          .dock-body { display:flex; flex-direction:column; gap:12px; padding:14px 16px; overflow:auto; flex:1; }
          .embedded-app-wrap { flex:1; display:flex; flex-direction:column; min-height:560px; height:100%; background:#f8fafc; }
          .embedded-app-frame { width:100%; height:100%; flex:1; border:0; display:block; background:#fff; }
          .context-label { color:#667085; font-size:10px; text-transform:uppercase; letter-spacing:.08em; margin-bottom:4px; }
          .product-info { font-size:14px; font-weight:650; overflow-wrap:anywhere; }
          .product-id-tag { color:#2458d3; }
          .context-help { margin:0; color:#667085; font-size:12px; }
          .quick-view-info { display:grid; gap:8px; }
          .quick-view-info:empty { display:none; }
          .quick-view-row { background:#f3f6fc; border:1px solid #e9edf3; border-radius:10px; padding:9px 12px; }
          .quick-view-item { color:#17243a; font-size:12.5px; font-weight:600; }
          .quick-tools-box { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; }
          .quick-tools-title { font-size:10.5px; font-weight:700; color:#166534; text-transform:uppercase; letter-spacing:.05em; }
          .quick-tools-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
          .quick-tool-btn { font:600 11.5px/1.3 system-ui,sans-serif; background:#fff; color:#15803d; border:1px solid #86efac; border-radius:8px; padding:7px 8px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px; }
          .quick-tool-btn:hover { background:#dcfce7; border-color:#4ade80; }
          .quick-cost-row { display:flex; align-items:center; gap:6px; }
          .quick-cost-input { flex:1; min-width:0; border:1px solid #86efac; border-radius:8px; padding:6px 9px; font:600 12px system-ui,sans-serif; background:#fff; color:#0f172a; }
          .quick-status-msg { font-size:11px; font-weight:600; color:#15803d; margin:0; }
          .quick-status-msg:empty { display:none; }
          .dock-actions { display:flex; flex-direction:column; gap:8px; }
          .btn { font:600 13px/1.4 system-ui,sans-serif; border:1px solid transparent; border-radius:10px; padding:10px 14px; cursor:pointer; }
          .btn-primary { background:#2458d3; color:white; order:-1; }
          .btn-primary:hover:not(:disabled) { background:#1948b5; }
          .btn-secondary { background:white; border-color:#dbe3ee; color:#344054; }
          .btn-secondary:hover { background:#f3f6fc; }
          .btn:disabled { opacity:.5; cursor:not-allowed; }
          .tooltip-notice { color:#854d0e; background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px; font-size:12px; display:flex; flex-direction:column; gap:6px; }
          .feedback-badge { max-width:380px; background:#edf4ff; color:#2458d3; border:1px solid #dbe3ee; border-radius:10px; padding:10px 14px; font-size:12px; }
          .feedback-success { background:#ecfdf3; color:#067647; }
          .feedback-warning,.feedback-error,.feedback-auth_required { background:#fff3ed; color:#b93815; }
          .dock-card.is-minimized { width:auto; height:auto; border-radius:999px; background:#2458d3; color:white; }
          .is-minimized .dock-body, .is-minimized .embedded-app-wrap, .is-minimized .mode-btn, .is-minimized .sidepanel-link-btn { display:none!important; }
          .is-minimized .dock-header { border:0; padding:8px 12px; background:transparent; }
          .is-minimized .dock-badge { display:none; }
          .is-minimized .icon-btn { border:0; color:#2458d3; }
          .is-minimized .drag-grip { color:#b6ccff; }
        </style>

        <div id="dock-root" class="dock-container">
          <div id="feedback-container"></div>
          <div id="dock-card" class="dock-card">
            <div id="dock-drag-handle" class="dock-header" title="Arraste para mover para qualquer lugar da tela">
              <div class="dock-title">
                <span class="drag-grip" aria-hidden="true">⠿</span>
                <img id="dock-brand-logo" class="dock-logo" alt="" />
                <span>Copilot</span>
              </div>
              <div class="header-controls">
                <div id="dock-badge" class="dock-badge">${this.currentUiState.isSimulatedMock ? 'Prévia' : 'Bling'}</div>
                <button id="btn-toggle-app-mode" class="mode-btn" type="button" title="Alternar entre Resumo Rápido e Aplicativo Completo dentro do Pop-up">
                  ✨ App Completo
                </button>
                <button id="btn-open-sidepanel-aux" class="sidepanel-link-btn" type="button" title="Abrir no painel lateral do navegador (apoio opcional)">
                  ↗ Lateral
                </button>
                <button id="btn-toggle-minimize" class="icon-btn" type="button" aria-label="Expandir ou recolher Copilot" title="Expandir ou recolher painel">
                  —
                </button>
              </div>
            </div>

            <div id="quick-summary-wrap" class="dock-body">
              <div><div class="context-label">Seu espaço de trabalho</div><div id="product-info-container" class="product-info"></div></div>
              <p id="context-help" class="context-help"></p>
              <div id="quick-view-container" class="quick-view-info"></div>
              <div id="quick-tools-container"></div>

              <div class="dock-actions">
                <button id="btn-open-copilot" class="btn btn-secondary">
                  Abrir no pop-up flutuante
                </button>
                <button id="btn-prepare-ml" class="btn btn-primary">
                  Preparar anúncio no Mercado Livre
                </button>
              </div>

              <div id="tooltip-container"></div>
            </div>

            <div id="embedded-app-wrap" class="embedded-app-wrap" hidden></div>
          </div>
        </div>
      `;

      const dockLogo = this.shadow.getElementById('dock-brand-logo') as HTMLImageElement | null;
      if (dockLogo && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        dockLogo.src = chrome.runtime.getURL('icons/logo.png');
        dockLogo.style.display = 'inline-block';
      }

      // Botão principal "Criar ficha / Abrir no Pop-up" -> abre o App Completo DENTRO do pop-up flutuante!
      const btnOpen = this.shadow.getElementById('btn-open-copilot');
      if (btnOpen) {
        btnOpen.addEventListener('click', () => {
          const maybePromise = this.onAction('open_in_copilot', { openSidePanel: false });
          const targetStep = this.currentPageType === 'product_form_new' ? 1 : 2;
          if (maybePromise && typeof (maybePromise as Promise<any>).finally === 'function') {
            void (maybePromise as Promise<any>).finally(() => this.openEmbeddedApp('product', targetStep));
          } else {
            this.openEmbeddedApp('product', targetStep);
          }
        });
      }

      // Botão "Preparar anúncio no Mercado Livre" -> importa e abre a aba 4. ML DENTRO do pop-up flutuante!
      const btnPrepare = this.shadow.getElementById('btn-prepare-ml');
      if (btnPrepare) {
        btnPrepare.addEventListener('click', () => {
          if (this.currentUiState.canImport && Boolean(this.currentDetectedProduct?.id)) {
            const maybePromise = this.onAction('prepare_mercadolivre', { openSidePanel: false });
            if (maybePromise && typeof (maybePromise as Promise<any>).finally === 'function') {
              void (maybePromise as Promise<any>).finally(() => this.openEmbeddedApp('product', 4));
            } else {
              this.openEmbeddedApp('product', 4);
            }
          }
        });
      }

      // Alternador entre Resumo Rápido e App Completo dentro do Pop-up
      const btnToggleMode = this.shadow.getElementById('btn-toggle-app-mode');
      if (btnToggleMode && typeof btnToggleMode.addEventListener === 'function') {
        btnToggleMode.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.isAppExpanded) {
            this.setQuickModeView();
          } else {
            const maybePromise = this.onAction('open_in_copilot', { openSidePanel: false });
            if (maybePromise && typeof (maybePromise as Promise<any>).finally === 'function') {
              void (maybePromise as Promise<any>).finally(() => this.openEmbeddedApp());
            } else {
              this.openEmbeddedApp();
            }
          }
        });
      }

      // Botão de apoio opcional para abrir no painel lateral do navegador
      const btnSidepanelAux = this.shadow.getElementById('btn-open-sidepanel-aux');
      if (btnSidepanelAux && typeof btnSidepanelAux.addEventListener === 'function') {
        btnSidepanelAux.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onAction('open_in_copilot', { openSidePanel: true });
        });
      }

      const btnMinimize = this.shadow.getElementById('btn-toggle-minimize');
      const dockCard = this.shadow.getElementById('dock-card');
      if (btnMinimize && dockCard) {
        if (this.isMinimized) {
          dockCard.classList?.add?.('is-minimized');
          btnMinimize.textContent = '+';
          btnMinimize.title = 'Expandir painel';
        } else if (this.isAppExpanded) {
          this.openEmbeddedApp();
        }
        if (typeof btnMinimize.addEventListener === 'function') {
          btnMinimize.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isMinimized = !this.isMinimized;
            if (this.isMinimized) {
              dockCard.classList?.add?.('is-minimized');
              btnMinimize.textContent = '+';
              btnMinimize.title = 'Expandir painel';
            } else {
              dockCard.classList?.remove?.('is-minimized');
              btnMinimize.textContent = '—';
              btnMinimize.title = 'Minimizar painel';
            }
            this.saveUiPrefs();
            this.applyPosition();
          });
        }
      }

      // Arraste livre (Drag-and-Drop) pelo cabeçalho do Dock
      const dragHandle = this.shadow.getElementById('dock-drag-handle');
      if (dragHandle && typeof dragHandle.addEventListener === 'function' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        dragHandle.addEventListener('pointerdown', (e: any) => {
          const targetId = e.target && (e.target as HTMLElement).id;
          if (targetId === 'btn-toggle-minimize' || targetId === 'btn-toggle-app-mode' || targetId === 'btn-open-sidepanel-aux') return;
          if (!this.host) return;
          const rect = this.host.getBoundingClientRect ? this.host.getBoundingClientRect() : { left: window.innerWidth - 280, top: window.innerHeight - 140 };
          this.dragOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
          };
        });

        window.addEventListener('pointermove', (e: any) => {
          if (!this.dragOffset || !this.host) return;
          this.customPos = {
            x: e.clientX - this.dragOffset.x,
            y: e.clientY - this.dragOffset.y
          };
          this.applyPosition();
        });

        window.addEventListener('pointerup', () => {
          if (this.dragOffset) {
            this.dragOffset = null;
            this.saveUiPrefs();
          }
        });
      }
    }

    // Atualiza badge de modo se a estrutura já foi montada
    const dockBadge = this.shadow.getElementById('dock-badge') || (typeof this.shadow.querySelector === 'function' ? this.shadow.querySelector('.dock-badge') : null);
    if (dockBadge) {
      dockBadge.textContent = this.currentUiState.isSimulatedMock ? 'Prévia' : 'Bling';
    }

    const openButton = this.shadow.getElementById('btn-open-copilot');
    if (openButton) {
      openButton.textContent = isNew
        ? '✨ Criar ficha com IA / Preço aqui no Pop-up'
        : '✨ Abrir Ficha / Preço / IA aqui no Pop-up';
    }

    const contextHelp = this.shadow.getElementById('context-help');
    if (contextHelp) {
      contextHelp.textContent = isNew
        ? 'Use os botões rápidos abaixo (ou nos campos do site) ou abra tudo aqui no pop-up sem precisar do painel lateral.'
        : hasId
          ? 'Edite SKU, EAN e Custo direto aqui ou prepare tudo dentro deste pop-up.'
          : 'Use este pop-up flutuante para gerenciar tudo sem precisar abrir o painel lateral.';
    }

    // Renderiza a Barra de Ações Rápidas (SKU, EAN, Custo direto no Pop-up!)
    const quickToolsContainer = this.shadow.getElementById('quick-tools-container');
    if (quickToolsContainer) {
      quickToolsContainer.replaceChildren();
      if (isForm && typeof document !== 'undefined') {
        const box = document.createElement('div');
        box.className = 'quick-tools-box';

        const title = document.createElement('div');
        title.className = 'quick-tools-title';
        title.textContent = isNew ? 'Ações Diretas no Novo Produto' : 'Ações Diretas no Formulário';

        const grid = document.createElement('div');
        grid.className = 'quick-tools-grid';

        const statusMsg = document.createElement('p');
        statusMsg.className = 'quick-status-msg';

        const btnSku = document.createElement('button');
        btnSku.type = 'button';
        btnSku.className = 'quick-tool-btn';
        btnSku.textContent = '⚡ Gerar SKU';
        btnSku.onclick = () => {
          if (this.onQuickGenerateSku) {
            const res = this.onQuickGenerateSku();
            statusMsg.textContent = res.message;
          }
        };

        const btnEan = document.createElement('button');
        btnEan.type = 'button';
        btnEan.className = 'quick-tool-btn';
        btnEan.textContent = '⚡ Gerar EAN-13';
        btnEan.onclick = () => {
          if (this.onQuickGenerateEan) {
            const res = this.onQuickGenerateEan();
            statusMsg.textContent = res.message;
          }
        };

        grid.appendChild(btnSku);
        grid.appendChild(btnEan);

        const costRow = document.createElement('div');
        costRow.className = 'quick-cost-row';

        const costInput = document.createElement('input');
        costInput.type = 'text';
        costInput.className = 'quick-cost-input';
        costInput.placeholder = 'Custo R$ (ex: 25,90)';
        costInput.inputMode = 'decimal';
        if (this.currentUiState.quickView?.costPrice != null) {
          costInput.value = this.currentUiState.quickView.costPrice.toFixed(2).replace('.', ',');
        }

        const btnSaveCost = document.createElement('button');
        btnSaveCost.type = 'button';
        btnSaveCost.className = 'quick-tool-btn';
        btnSaveCost.textContent = '💰 Aplicar Custo';
        btnSaveCost.onclick = async () => {
          const raw = costInput.value.trim().replace(/\./g, '').replace(',', '.');
          const parsed = Number(raw);
          if (!raw || !Number.isFinite(parsed) || parsed < 0) {
            statusMsg.textContent = 'Informe um valor válido (ex: 25,90)';
            return;
          }
          if (this.onQuickApplyCost) {
            statusMsg.textContent = 'Aplicando custo...';
            const res = await this.onQuickApplyCost(parsed);
            statusMsg.textContent = res.message;
          }
        };

        costRow.appendChild(costInput);
        costRow.appendChild(btnSaveCost);

        box.appendChild(title);
        box.appendChild(grid);
        box.appendChild(costRow);
        box.appendChild(statusMsg);
        quickToolsContainer.appendChild(box);
      }
    }

    // 1. Renderiza Feedback com textContent (anti-XSS)
    const feedbackContainer = this.shadow.getElementById('feedback-container');
    if (feedbackContainer) {
      feedbackContainer.replaceChildren();
      if (this.currentUiState.actionFeedback && this.currentUiState.actionFeedback.message) {
        const badge = document.createElement('div');
        const feedbackType = this.currentUiState.actionFeedback.type || 'info';
        badge.className = `feedback-badge feedback-${feedbackType}`;
        badge.textContent = this.currentUiState.actionFeedback.message; // Sanitização estrita via textContent
        feedbackContainer.appendChild(badge);
      }
    }

    // 2. Renderiza Informações de Produto com textContent e nós seguros
    const infoContainer = this.shadow.getElementById('product-info-container');
    if (infoContainer) {
      infoContainer.replaceChildren();
      if (isNew) {
        const span = document.createElement('span');
        span.textContent = 'Novo Produto • Cadastro em andamento';
        infoContainer.appendChild(span);
      } else if (hasId) {
        const label = document.createElement('span');
        label.textContent = 'Produto Bling: ';
        const tag = document.createElement('span');
        tag.className = 'product-id-tag';
        tag.textContent = `#${this.currentDetectedProduct?.id || ''}`; // Sanitização estrita via textContent
        label.appendChild(tag);
        infoContainer.appendChild(label);
      } else {
        const span = document.createElement('span');
        span.textContent = 'Listagem de Produtos Bling';
        infoContainer.appendChild(span);
      }
    }

    // 2b. Renderiza Quick View (Estoque e Custo) com textContent estrito (anti-XSS)
    const quickViewContainer = this.shadow.getElementById('quick-view-container');
    if (quickViewContainer) {
      quickViewContainer.replaceChildren();

      if (hasId && !isNew) {
        if (this.currentUiState.quickViewLoading) {
          const loadingDiv = document.createElement('div');
          loadingDiv.className = 'quick-view-row';
          const span = document.createElement('span');
          span.style.color = '#a1a1aa';
          span.textContent = '⏳ Carregando estoque e custo...';
          loadingDiv.appendChild(span);
          quickViewContainer.appendChild(loadingDiv);
        } else if (this.currentUiState.quickViewError) {
          const errDiv = document.createElement('div');
          errDiv.className = 'quick-view-row';
          const span = document.createElement('span');
          span.style.color = '#f87171';
          span.textContent = '⚠️ Estoque/Custo indisponível';
          errDiv.appendChild(span);
          quickViewContainer.appendChild(errDiv);
        } else if (this.currentUiState.quickView) {
          const { stockText, costText } = formatQuickViewDisplay(this.currentUiState.quickView);

          // 1. Linha de Estoque
          const stockRow = document.createElement('div');
          stockRow.className = 'quick-view-row';
          const stockSpan = document.createElement('span');
          stockSpan.className = 'quick-view-item';
          stockSpan.textContent = stockText;
          stockRow.appendChild(stockSpan);
          quickViewContainer.appendChild(stockRow);

          // 2. Linha de Custo
          const costRow = document.createElement('div');
          costRow.className = 'quick-view-row';
          const costSpan = document.createElement('span');
          costSpan.className = 'quick-view-item';
          costSpan.textContent = costText;
          costRow.appendChild(costSpan);
          quickViewContainer.appendChild(costRow);
        }
      }
    }

    // 3. Atualiza estado do botão Preparar para ML
    const btnPrepare = this.shadow.getElementById('btn-prepare-ml') as HTMLButtonElement | null;
    if (btnPrepare) {
      btnPrepare.disabled = !canImport;
      btnPrepare.hidden = !hasId || isNew;
    }

    // 4. Renderiza tooltip/notice com textContent (anti-XSS) + botão direto de conectar Bling
    const tooltipContainer = this.shadow.getElementById('tooltip-container');
    if (tooltipContainer) {
      tooltipContainer.replaceChildren();

      if (isTransitoryBlocked) {
        const notice = document.createElement('div');
        notice.className = 'tooltip-notice';
        if (this.blingConnectionStatus === 'gateway_unreachable') {
          notice.textContent = '⚠️ Gateway temporariamente indisponível. Tente novamente em instantes.';
          if (this.onQuickRetryBling) {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'quick-tool-btn';
            retryBtn.textContent = '🔄 Tentar reconectar agora';
            retryBtn.onclick = () => this.onQuickRetryBling?.();
            notice.appendChild(retryBtn);
          }
        } else {
          notice.textContent = '⏳ Renovando sessão com o Bling… aguarde.';
        }
        tooltipContainer.appendChild(notice);
      } else if (isPermBlocked && !isConnected) {
        const notice = document.createElement('div');
        notice.className = 'tooltip-notice';
        if (this.blingConnectionStatus === 'connecting' || this.blingConnectionStatus === 'awaiting_oauth') {
          notice.textContent = '⏳ Aguardando conexão com o Bling…';
        } else {
          notice.textContent = '🔗 Conecte o Bling direto por aqui para liberar todas as funções:';
          if (this.onQuickConnectBling) {
            const connectBtn = document.createElement('button');
            connectBtn.type = 'button';
            connectBtn.className = 'quick-tool-btn';
            connectBtn.textContent = '🔗 Conectar conta Bling agora';
            connectBtn.onclick = () => this.onQuickConnectBling?.();
            notice.appendChild(connectBtn);
          }
        }
        tooltipContainer.appendChild(notice);
      } else if (isNew) {
        const notice = document.createElement('div');
        notice.className = 'tooltip-notice';
        notice.textContent = 'Novo cadastro: gere SKU, EAN e Custo pelos botões acima ou nos campos do site, ou abra o App Completo aqui no pop-up.';
        tooltipContainer.appendChild(notice);
      }
    }
  }
}
