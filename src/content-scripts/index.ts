import { BlingSpaObserver } from './bling/spa-observer.ts';
import { BlingShadowUi } from './bling/shadow-ui.ts';
import { isBlingDomain } from '../shared/tab-context-contracts.ts';
import type { 
  ContentToBackgroundEnvelope, 
  BlingDomContextPayload,
  BlingActionTriggeredPayload,
  BackgroundToContentEnvelope,
  ContextualActionType
} from '../shared/tab-context-contracts.ts';

(() => {
  const host = window.location.hostname.toLowerCase();
  console.info(`[Paulifest Copilot] Content script ativo em ${host}`);

  // Gera identificador único para o ciclo de vida deste documento DOM
  const pageInstanceId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `inst_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  let lastAcceptedRevision = 0;

  // 1. Ativação no Bling ERP com validação estrita de domínio (Requisito 6)
  if (isBlingDomain(host)) {
    // Inicializa a UI contextual isolada no Shadow DOM (mode: 'open')
    const shadowUi = new BlingShadowUi({
      onAction: (action: ContextualActionType) => {
        const actionPayload: ContentToBackgroundEnvelope<BlingActionTriggeredPayload> = {
          type: 'BLING_ACTION_TRIGGERED',
          pageInstanceId,
          payload: { action },
          clientTimestamp: new Date().toISOString()
        };

        chrome.runtime.sendMessage(actionPayload).catch((err) => {
          console.debug('[Paulifest Copilot] Erro ao enviar ação contextual:', err);
        });
      }
    });

    shadowUi.mount();

    // Inicializa o observador de rotas e DOM SPA
    const spaObserver = new BlingSpaObserver({
      debounceMs: 300,
      onContextDetected: (context) => {
        const domPayload: ContentToBackgroundEnvelope<BlingDomContextPayload> = {
          type: 'BLING_DOM_CONTEXT_DETECTED',
          pageInstanceId,
          payload: {
            url: window.location.href,
            pageType: context.pageType,
            detectedProduct: context.detectedProduct
          },
          clientTimestamp: new Date().toISOString()
        };

        chrome.runtime.sendMessage(domPayload).catch((err) => {
          console.debug('[Paulifest Copilot] Erro ao emitir contexto detectado:', err);
        });
      }
    });

    spaObserver.start();

    // Escuta comandos de atualização de UI vindos do Background
    chrome.runtime.onMessage.addListener((message: BackgroundToContentEnvelope) => {
      if (message && message.type === 'APPLY_UI_STATE') {
        // Regra de Ouro: Descarte se a revisão for menor que a última aceita
        if (message.contextRevision >= lastAcceptedRevision) {
          lastAcceptedRevision = message.contextRevision;
          shadowUi.update(message.uiState, message.pageType, message.detectedProduct);
        }
      }
    });
  }

  // 2. Resposta a Ping para inspeções legadas
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === 'PING_CONTENT_SCRIPT') {
      sendResponse({
        ok: true,
        host,
        title: document.title,
        url: window.location.href,
        pageInstanceId
      });
    }
  });
})();
