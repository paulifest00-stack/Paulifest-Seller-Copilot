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
  onAction: (action: ContextualActionType) => void;
}

export class BlingShadowUi {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private onAction: (action: ContextualActionType) => void;
  private currentUiState: TabContextUiState = {
    dockVisible: false,
    canImport: false,
    isSimulatedMock: true
  };
  private currentPageType: BlingPageType = 'other';
  private currentDetectedProduct?: { id?: string; sku?: string };
  // Fase 4C.4B: Estado de conexão Bling — não persistido, hidratado via query/broadcast
  private blingConnectionStatus: BlingConnectionStatus = 'disconnected';

  private isMinimized = true;
  private readonly onViewportResize = () => this.applyPosition();
  private dragOffset: { x: number; y: number } | null = null;
  private customPos: { x: number; y: number } | null = null;

  constructor(options: ShadowUiOptions) {
    this.onAction = options.onAction;
    this.loadSavedUiPrefs();
  }

  private loadSavedUiPrefs(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('paulifest_dock_ui_state');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.minimized === 'boolean') this.isMinimized = parsed.minimized;
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
      const maxX = Math.max(8, (window.innerWidth || 1200) - (this.host.getBoundingClientRect?.().width || 340) - 16);
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

  /**
   * Fase 4C.4B: Atualiza o estado de conexão Bling no Dock.
   * Chamado pelo Content Script ao receber BLING_CONNECTION_STATUS_CHANGED do Background
   * ou ao hidratar com BLING_GET_CONNECTION_STATUS na inicialização.
   * Não persiste nada — estado é exclusivamente em memória do Content Script.
   */
  updateConnectionStatus(status: BlingConnectionStatus): void {
    this.blingConnectionStatus = status;
    if (this.shadow) {
      this.render();
    }
  }

  private render(): void {
    if (!this.shadow) return;

    if (!this.currentUiState.dockVisible || this.currentPageType === 'other') {
      this.shadow.innerHTML = '';
      return;
    }

    const hasId = Boolean(this.currentDetectedProduct?.id);
    const isNew = this.currentPageType === 'product_form_new';

    // Fase 4C.4B: Auth-awareness — o Dock bloqueia importação se sessão não estiver ready.
    // AJUSTE OBRIGATÓRIO 3 e 4: semântica distinta por estado (não unificar gateway_unreachable com disconnected).
    const isConnected = this.blingConnectionStatus === 'connected';
    const isTransitoryBlocked = this.blingConnectionStatus === 'gateway_unreachable' ||
                                this.blingConnectionStatus === 'refreshing';
    const isPermBlocked = this.blingConnectionStatus === 'disconnected' ||
                          this.blingConnectionStatus === 'requires_reauth' ||
                          this.blingConnectionStatus === 'session_expired' ||
                          this.blingConnectionStatus === 'configuration_error' ||
                          this.blingConnectionStatus === 'connecting' ||
                          this.blingConnectionStatus === 'awaiting_oauth';

    // canImport só é true se Bling connected + uiState.canImport + produto com ID
    const canImport = isConnected && this.currentUiState.canImport && hasId;

    this.applyPosition();

    // Se o esqueleto ainda não foi criado no shadow root, inicializa a estrutura estática
    let dockRoot = this.shadow.getElementById('dock-root');
    if (!dockRoot) {
      this.shadow.innerHTML = `
        <style>
          :host { all: initial; font: 13px/1.5 system-ui, sans-serif; color: #17243a; position: fixed; right: 20px; bottom: 20px; z-index: 999999; pointer-events: none; }
          * { box-sizing: border-box; }
          [hidden] { display:none!important; }
          .dock-container { pointer-events: auto; display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
          .dock-card { background:#fff; border:1px solid #dbe3ee; border-radius:18px; box-shadow:0 8px 32px #17243a26; width:min(340px,calc(100vw - 32px)); max-height:calc(100dvh - 32px); overflow:auto; }
          .dock-header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid #e9edf3; cursor:grab; touch-action:none; }
          .dock-header:active { cursor:grabbing; }
          .dock-title { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; }
          .dock-logo { width:22px; height:22px; object-fit:contain; display:none; }
          .drag-grip { color:#98a2b3; }
          .header-controls { display:flex; align-items:center; gap:8px; }
          .dock-badge { border-radius:6px; padding:3px 7px; background:#edf4ff; color:#2458d3; font-size:10px; font-weight:600; }
          .icon-btn { width:30px; height:30px; border:1px solid #dbe3ee; background:#fff; color:#475467; border-radius:8px; font-size:18px; cursor:pointer; }
          .icon-btn:hover { background:#edf4ff; }
          button:focus-visible { outline:3px solid #3483fa; outline-offset:2px; }
          .dock-body { display:flex; flex-direction:column; gap:14px; padding:16px; }
          .context-label { color:#667085; font-size:10px; text-transform:uppercase; letter-spacing:.08em; margin-bottom:5px; }
          .product-info { font-size:15px; font-weight:650; overflow-wrap:anywhere; }
          .product-id-tag { color:#2458d3; }
          .context-help { margin:0; color:#667085; font-size:12px; }
          .quick-view-info { display:grid; gap:8px; }
          .quick-view-info:empty { display:none; }
          .quick-view-row { background:#f3f6fc; border:1px solid #e9edf3; border-radius:10px; padding:11px 12px; }
          .quick-view-item { color:#17243a; font-size:13px; font-weight:600; }
          .dock-actions { display:flex; flex-direction:column; gap:8px; }
          .btn { font:600 13px/1.4 system-ui,sans-serif; border:1px solid transparent; border-radius:10px; padding:11px 14px; cursor:pointer; }
          .btn-primary { background:#2458d3; color:white; order:-1; }
          .btn-primary:hover:not(:disabled) { background:#1948b5; }
          .btn-secondary { background:white; border-color:#dbe3ee; color:#344054; }
          .btn-secondary:hover { background:#f3f6fc; }
          .btn:disabled { opacity:.5; cursor:not-allowed; }
          .tooltip-notice { color:#854d0e; background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px; font-size:12px; }
          .feedback-badge { max-width:340px; background:#edf4ff; color:#2458d3; border:1px solid #dbe3ee; border-radius:10px; padding:10px 14px; font-size:12px; }
          .feedback-success { background:#ecfdf3; color:#067647; }
          .feedback-warning,.feedback-error,.feedback-auth_required { background:#fff3ed; color:#b93815; }
          .dock-card.is-minimized { width:auto; border-radius:999px; background:#2458d3; color:white; }
          .is-minimized .dock-body { display:none; }
          .is-minimized .dock-header { border:0; padding:8px 12px; }
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
                <button id="btn-toggle-minimize" class="icon-btn" type="button" aria-label="Expandir ou recolher Copilot" title="Expandir ou recolher painel">
                  —
                </button>
              </div>
            </div>

            <div class="dock-body">
              <div><div class="context-label">Seu espaço de trabalho</div><div id="product-info-container" class="product-info"></div></div>
              <p id="context-help" class="context-help"></p>
              <div id="quick-view-container" class="quick-view-info"></div>

              <div class="dock-actions">
                <button id="btn-open-copilot" class="btn btn-secondary">
                  Abrir painel lateral
                </button>
                <button id="btn-prepare-ml" class="btn btn-primary">
                  Preparar anúncio no Mercado Livre
                </button>
              </div>

              <div id="tooltip-container"></div>
            </div>
          </div>
        </div>
      `;

      const dockLogo = this.shadow.getElementById('dock-brand-logo') as HTMLImageElement | null;
      if (dockLogo && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        dockLogo.src = chrome.runtime.getURL('icons/icon32.png');
        dockLogo.style.display = 'inline-block';
      }

      // Registra listeners fixos apenas uma vez na criação da árvore
      const btnOpen = this.shadow.getElementById('btn-open-copilot');
      if (btnOpen) {
        btnOpen.addEventListener('click', () => {
          this.onAction('open_in_copilot');
        });
      }

      const btnPrepare = this.shadow.getElementById('btn-prepare-ml');
      if (btnPrepare) {
        btnPrepare.addEventListener('click', () => {
          if (this.currentUiState.canImport && Boolean(this.currentDetectedProduct?.id)) {
            this.onAction('prepare_mercadolivre');
          }
        });
      }

      const btnMinimize = this.shadow.getElementById('btn-toggle-minimize');
      const dockCard = this.shadow.getElementById('dock-card');
      if (btnMinimize && dockCard) {
        if (this.isMinimized) {
          dockCard.classList?.add?.('is-minimized');
          btnMinimize.textContent = '+';
          btnMinimize.title = 'Expandir painel';
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
          if (e.target && (e.target as HTMLElement).id === 'btn-toggle-minimize') return;
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
    if (openButton) openButton.textContent = this.currentPageType === 'product_form_new' ? 'Criar ficha do novo produto' : 'Abrir painel lateral';

    const contextHelp = this.shadow.getElementById('context-help');
    if (contextHelp) contextHelp.textContent = isNew ? 'Monte a ficha no painel lateral e traga os dados para este cadastro.' : hasId ? 'Confira os dados do produto e prepare seu anúncio a partir desta ficha.' : 'Abra um produto para ver seus dados ou use o painel lateral para começar uma ficha.';

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

    // 4. Renderiza tooltip/notice com textContent (anti-XSS)
    const tooltipContainer = this.shadow.getElementById('tooltip-container');
    if (tooltipContainer) {
      tooltipContainer.replaceChildren();

      // AJUSTE OBRIGATÓRIO 3: gateway_unreachable é transitório (não é disconnected).
      // AJUSTE OBRIGATÓRIO 4: refreshing bloqueia temporariamente sem parecer logout.
      if (isTransitoryBlocked) {
        const notice = document.createElement('div');
        notice.className = 'tooltip-notice';
        if (this.blingConnectionStatus === 'gateway_unreachable') {
          notice.textContent = '⚠️ Gateway temporariamente indisponível. Tente novamente em instantes.';
        } else {
          // refreshing
          notice.textContent = '⏳ Renovando sessão com o Bling… aguarde.';
        }
        tooltipContainer.appendChild(notice);
      } else if (isPermBlocked && !isConnected) {
        // Conectar/Reconectar — orienta o usuário sem fornecer detalhes internos
        const notice = document.createElement('div');
        notice.className = 'tooltip-notice';
        if (this.blingConnectionStatus === 'connecting' || this.blingConnectionStatus === 'awaiting_oauth') {
          notice.textContent = '⏳ Aguardando conexão com o Bling…';
        } else {
          notice.textContent = '🔗 Conecte o Bling pelo Copilot para continuar.';
        }
        tooltipContainer.appendChild(notice);
      } else if (isNew) {
        const notice = document.createElement('div');
        notice.className = 'tooltip-notice';
        notice.textContent = 'Novo cadastro: clique em Criar ficha para começar, sem precisar de ID.';
        tooltipContainer.appendChild(notice);
      }
    }
  }
}
