// Componente de UI Contextual Injetada no Bling ERP via Shadow DOM (Fase 4B)
import type { 
  BlingPageType, 
  TabContextUiState, 
  ContextualActionType 
} from '../../shared/tab-context-contracts.ts';

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

  private render(): void {
    if (!this.shadow) return;

    if (!this.currentUiState.dockVisible || this.currentPageType === 'other') {
      this.shadow.innerHTML = '';
      return;
    }

    const hasId = Boolean(this.currentDetectedProduct?.id);
    const isNew = this.currentPageType === 'product_form_new';
    const canImport = this.currentUiState.canImport && hasId;

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
              <div id="dock-badge" class="dock-badge">${this.currentUiState.isSimulatedMock ? 'SIMULAÇÃO 4B' : 'REAL 4C.3'}</div>
            </div>

            <div id="product-info-container" class="product-info"></div>

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
      dockBadge.textContent = this.currentUiState.isSimulatedMock ? 'SIMULAÇÃO 4B' : 'REAL 4C.3';
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

    // 3. Atualiza estado do botão Preparar para ML
    const btnPrepare = this.shadow.getElementById('btn-prepare-ml') as HTMLButtonElement | null;
    if (btnPrepare) {
      btnPrepare.disabled = !canImport;
    }

    // 4. Renderiza tooltip com textContent
    const tooltipContainer = this.shadow.getElementById('tooltip-container');
    if (tooltipContainer) {
      tooltipContainer.replaceChildren();
      if (isNew) {
        const notice = document.createElement('div');
        notice.className = 'tooltip-notice';
        notice.textContent = '⚠️ Importação bloqueada: produto novo ainda não possui ID no Bling.';
        tooltipContainer.appendChild(notice);
      }
    }
  }
}
