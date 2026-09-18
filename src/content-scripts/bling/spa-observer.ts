// Observador de Rotas e Telas SPA do Bling ERP (Fase 4B)
import { detectBlingScreenContext, type BlingScreenContextResult } from './dom-identifier.ts';

export interface SpaObserverOptions {
  debounceMs?: number;
  onContextDetected: (context: BlingScreenContextResult) => void;
}

export class BlingSpaObserver {
  private debounceMs: number;
  private onContextDetected: (context: BlingScreenContextResult) => void;
  private mutationObserver: MutationObserver | null = null;
  private debounceTimer: any = null;
  private lastKnownUrl: string = '';
  private lastDetectedSignature: string = '';

  constructor(options: SpaObserverOptions) {
    this.debounceMs = options.debounceMs ?? 300;
    this.onContextDetected = options.onContextDetected;
  }

  start(): void {
    if (typeof window === 'undefined') return;

    this.lastKnownUrl = window.location.href;
    this.checkCurrentContext();

    // 1. Listeners de navegação nativos da janela
    window.addEventListener('popstate', this.handleUrlChange);
    window.addEventListener('hashchange', this.handleUrlChange);

    // 2. MutationObserver debounced para capturar rendering assíncrono de formulários/tabelas
    if (typeof MutationObserver !== 'undefined' && document.body) {
      this.mutationObserver = new MutationObserver(() => {
        this.scheduleDebouncedCheck();
      });

      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.handleUrlChange);
      window.removeEventListener('hashchange', this.handleUrlChange);
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private handleUrlChange = (): void => {
    this.scheduleDebouncedCheck(true);
  };

  private scheduleDebouncedCheck(immediate: boolean = false): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (immediate) {
      this.checkCurrentContext();
    } else {
      this.debounceTimer = setTimeout(() => {
        this.checkCurrentContext();
      }, this.debounceMs);
    }
  }

  checkCurrentContext(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const currentUrl = window.location.href;
    const context = detectBlingScreenContext(currentUrl, document);

    // Cria assinatura para evitar despachos duplicados idênticos
    const signature = `${context.pageType}::${context.detectedProduct?.id || ''}::${context.detectedProduct?.sku || ''}::${currentUrl}`;

    if (signature !== this.lastDetectedSignature || currentUrl !== this.lastKnownUrl) {
      this.lastKnownUrl = currentUrl;
      this.lastDetectedSignature = signature;
      this.onContextDetected(context);
    }
  }
}
