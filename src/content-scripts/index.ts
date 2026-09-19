import { BlingSpaObserver } from './bling/spa-observer.ts';
import { BlingShadowUi } from './bling/shadow-ui.ts';
import { isBlingDomain } from '../shared/tab-context-contracts.ts';
import type { 
  ContentToBackgroundEnvelope, 
  BlingDomContextPayload,
  BlingActionTriggeredPayload,
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

    // AJUSTE OBRIGATÓRIO 2: Hidratação do Dock com status inicial de conexão Bling.
    // Broadcast (BLING_CONNECTION_STATUS_CHANGED) serve para mudanças futuras.
    // Query inicial serve para hidratação do estado já estabelecido.
    // Proteção de race: revision local garante que query antiga não sobrescreva broadcast mais novo.
    let lastConnectionRevision = 0;

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const queryRevision = ++lastConnectionRevision;
      chrome.runtime.sendMessage({ type: 'BLING_GET_CONNECTION_STATUS' }, (res) => {
        // AJUSTE OBRIGATÓRIO 2 — Race protection:
        // Se um broadcast chegou após esta query ser iniciada, queryRevision < lastConnectionRevision,
        // e descartamos a resposta da query (o broadcast já aplicou estado mais recente).
        if (queryRevision < lastConnectionRevision) {
          return; // broadcast mais recente chegou — ignorar resposta da query antiga
        }
        if (res && res.status) {
          shadowUi.updateConnectionStatus(res.status);
        }
      });
    }

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
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message && message.type === 'APPLY_UI_STATE') {
        // Regra de Ouro: Descarte se a revisão for menor que a última aceita
        if (message.contextRevision >= lastAcceptedRevision) {
          lastAcceptedRevision = message.contextRevision;
          shadowUi.update(message.uiState, message.pageType, message.detectedProduct);
        }
      }

      // AJUSTE OBRIGATÓRIO 2: Broadcast de status de conexão — incrementa revision para proteção de race
      if (message && message.type === 'BLING_CONNECTION_STATUS_CHANGED') {
        lastConnectionRevision++; // broadcast sempre ganha sobre query com revision menor
        shadowUi.updateConnectionStatus(message.status);
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
