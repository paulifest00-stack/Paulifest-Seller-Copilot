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

  constructor(options: ShadowUiOptions) {
    this.onAction = options.onAction;
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
  }

  unmount(): void {
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

    // Se o esqueleto ainda não foi criado no shadow root, inicializa a estrutura estática
    let dockRoot = this.shadow.getElementById('dock-root');
    if (!dockRoot) {
      this.shadow.innerHTML = `
        <style>
          :host {
            all: initial;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            z-index: 999999;
            position: fixed;
            bottom: 24px;
            right: 24px;
            pointer-events: none;
          }

          .dock-container {
            pointer-events: auto;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
            animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          }

          @keyframes slideUp {
            from { opacity: 0; transform: translateY(12px) scale(0.96); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }

          .dock-card {
            background: rgba(23, 23, 23, 0.88);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 14px;
            padding: 10px 14px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 270px;
            color: #ededed;
          }

          .dock-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            padding-bottom: 6px;
          }

          .dock-title {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: #a1a1aa;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .dock-badge {
            background: rgba(59, 130, 246, 0.2);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.3);
            font-size: 9px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 6px;
            letter-spacing: 0.03em;
          }

          .product-info {
            font-size: 11px;
            color: #d4d4d8;
            line-height: 1.4;
          }

          .product-id-tag {
            color: #38bdf8;
            font-weight: 600;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          }

          .quick-view-info {
            font-size: 11px;
            color: #a1a1aa;
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding-top: 4px;
            border-top: 1px dashed rgba(255, 255, 255, 0.12);
          }

          .quick-view-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .quick-view-item {
            color: #e4e4e7;
          }

          .dock-actions {
            display: flex;
            gap: 6px;
            margin-top: 2px;
          }

          .btn {
            flex: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            font-size: 11px;
            font-weight: 500;
            padding: 7px 10px;
            border-radius: 8px;
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.15s ease;
            user-select: none;
          }

          .btn-primary {
            background: #2563eb;
            color: #ffffff;
            border-color: #3b82f6;
          }
          .btn-primary:hover:not(:disabled) {
            background: #1d4ed8;
          }

          .btn-secondary {
            background: rgba(255, 255, 255, 0.08);
            color: #f4f4f5;
            border-color: rgba(255, 255, 255, 0.12);
          }
          .btn-secondary:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.14);
          }

          .btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            filter: grayscale(1);
          }

          .tooltip-notice {
            font-size: 9.5px;
            color: #fbbf24;
            background: rgba(245, 158, 11, 0.12);
            border: 1px solid rgba(245, 158, 11, 0.25);
            border-radius: 6px;
            padding: 4px 6px;
            margin-top: 2px;
          }

          .feedback-badge {
            font-size: 11px;
            padding: 6px 12px;
            border-radius: 8px;
            backdrop-filter: blur(12px);
            animation: slideUp 0.2s ease;
          }
          .feedback-success {
            background: rgba(16, 185, 129, 0.9);
            color: #fff;
          }
          .feedback-info {
            background: rgba(59, 130, 246, 0.9);
            color: #fff;
          }
          .feedback-warning {
            background: rgba(245, 158, 11, 0.9);
            color: #fff;
          }
          .feedback-error {
            background: rgba(239, 68, 68, 0.9);
            color: #fff;
          }
          .feedback-loading {
            background: rgba(79, 70, 229, 0.9);
            color: #fff;
          }
          .feedback-auth_required {
            background: rgba(220, 38, 38, 0.95);
            color: #fff;
          }
        </style>

        <div id="dock-root" class="dock-container">
          <div id="feedback-container"></div>
          <div class="dock-card">
            <div class="dock-header">
              <div class="dock-title">
                <span>✦ Paulifest Copilot</span>
              </div>
              <div id="dock-badge" class="dock-badge">${this.currentUiState.isSimulatedMock ? 'SIMULAÇÃO 4B' : 'REAL 4D.2'}</div>
            </div>

            <div id="product-info-container" class="product-info"></div>
            <div id="quick-view-container" class="quick-view-info"></div>

            <div class="dock-actions">
              <button id="btn-open-copilot" class="btn btn-secondary">
                ✦ Abrir no Copilot
              </button>
              <button id="btn-prepare-ml" class="btn btn-primary">
                🛍️ Preparar para ML
              </button>
            </div>

            <div id="tooltip-container"></div>
          </div>
        </div>
      `;

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
    }

    // Atualiza badge de modo se a estrutura já foi montada
    const dockBadge = this.shadow.getElementById('dock-badge') || (typeof this.shadow.querySelector === 'function' ? this.shadow.querySelector('.dock-badge') : null);
    if (dockBadge) {
      dockBadge.textContent = this.currentUiState.isSimulatedMock ? 'SIMULAÇÃO 4B' : 'REAL 4D.2';
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
        notice.textContent = '⚠️ Importação bloqueada: produto novo ainda não possui ID no Bling.';
        tooltipContainer.appendChild(notice);
      }
    }
  }
}
