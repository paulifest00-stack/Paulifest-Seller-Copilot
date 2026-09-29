import { BlingCostField } from './bling/cost-field.ts';
import { classifyBlingUrl } from './bling/dom-identifier.ts';
import { extractProductIdFromRow } from './bling/product-list-cost-injector.ts';
import { installMarketCompanion } from './mercadolivre/companion.ts';
import { installMarketReader } from './mercadolivre/page-reader.ts';
import { isMlHost } from '../integrations/mercadolivre/market.ts';
import { fillNewBlingProduct } from './bling/fill-new-product.ts';
import { BlingSpaObserver } from './bling/spa-observer.ts';
import { BlingShadowUi } from './bling/shadow-ui.ts';
import { ProductListCostInjector } from './bling/product-list-cost-injector.ts';
import { BlingFormAssistant, findBlingProductInput, setNativeInputValue } from './bling/form-assistant.ts';
import { generateRandomEan13 } from '../core/engines/identification/ean-generator.ts';
import { generateSkuFromTitle } from '../core/engines/identification/sku-generator.ts';
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
  if (isMlHost(host)) { installMarketReader(); installMarketCompanion(); }

  // 1. Ativação no Bling ERP com validação estrita de domínio (Requisito 6)
  if (isBlingDomain(host)) {
    const listCostInjector = new ProductListCostInjector(pageInstanceId);
    const formAssistant = new BlingFormAssistant();
    const costField = new BlingCostField(pageInstanceId);

    // Mantém o assistente de formulário sempre ativo no Bling para injetar Gerar SKU e Gerar EAN
    // assim que os campos aparecerem no DOM (tanto em Produto Novo quanto em Edição)
    try {
      formAssistant.start();
    } catch (err) {
      console.error('[Paulifest Copilot] Erro inicial em formAssistant:', err);
    }

    // Inicializa a UI contextual isolada no Shadow DOM (mode: 'open')
    const onContextAction = (action: ContextualActionType, options?: { openSidePanel?: boolean }) => {
        const actionPayload: ContentToBackgroundEnvelope<BlingActionTriggeredPayload & { openSidePanel?: boolean }> = {
          type: 'BLING_ACTION_TRIGGERED',
          pageInstanceId,
          payload: { action, openSidePanel: options?.openSidePanel ?? false },
          clientTimestamp: new Date().toISOString()
        };

        return chrome.runtime.sendMessage(actionPayload).catch((err) => {
          console.debug('[Paulifest Copilot] Erro ao enviar ação contextual:', err);
        });
    };

    const shadowUi = new BlingShadowUi({
      onAction: onContextAction,
      onQuickGenerateSku: () => {
        const skuInput = findBlingProductInput('sku');
        const nameInput = findBlingProductInput('name');
        if (!skuInput || skuInput.disabled || skuInput.readOnly) {
          return { ok: false, message: 'Campo de SKU não encontrado ou bloqueado nesta tela.' };
        }
        const generated = generateSkuFromTitle(nameInput?.value || '');
        if (!generated) {
          nameInput?.focus();
          return { ok: false, message: 'Preencha o nome do produto primeiro para gerar o SKU.' };
        }
        setNativeInputValue(skuInput, generated);
        return { ok: true, value: generated, message: `SKU gerado e preenchido: ${generated} ✓` };
      },
      onQuickGenerateEan: () => {
        const eanInput = findBlingProductInput('ean');
        if (!eanInput || eanInput.disabled || eanInput.readOnly) {
          return { ok: false, message: 'Campo EAN/GTIN não encontrado ou bloqueado nesta tela.' };
        }
        const generated = generateRandomEan13();
        setNativeInputValue(eanInput, generated);
        return { ok: true, value: generated, message: `EAN-13 gerado e preenchido: ${generated} ✓` };
      },
      onQuickApplyCost: async (costValue: number) => {
        const res = await costField.applyCostFromPopup(costValue);
        if (res.ok) {
          return { ok: true, message: `Custo R$ ${costValue.toFixed(2).replace('.', ',')} aplicado ✓` };
        }
        return { ok: false, message: res.error || 'Não foi possível aplicar o custo.' };
      },
      onQuickApplyStock: async (stockValue: number) => {
        const res = await costField.applyStockFromPopup(stockValue);
        if (res.ok) {
          const formatted = Number.isInteger(stockValue) ? String(stockValue) : String(stockValue).replace('.', ',');
          return { ok: true, message: `Estoque ${formatted} un aplicado ✓` };
        }
        return { ok: false, message: res.error || 'Não foi possível aplicar o estoque.' };
      },
      onQuickConnectBling: () => {
        chrome.runtime?.sendMessage?.({ type: 'BLING_START_CONNECT' }, (res) => {
          if (res?.status) shadowUi.updateConnectionStatus(res.status);
        });
      },
      onQuickRetryBling: () => {
        chrome.runtime?.sendMessage?.({ type: 'BLING_RETRY_CONNECTION' }, (res) => {
          if (res?.status) shadowUi.updateConnectionStatus(res.status);
        });
      }
    });

    shadowUi.mount();

    // AJUSTE OBRIGATÓRIO 2: Hidratação do Dock com status inicial de conexão Bling.
    let lastConnectionRevision = 0;

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const queryRevision = ++lastConnectionRevision;
      chrome.runtime.sendMessage({ type: 'BLING_GET_CONNECTION_STATUS' }, (res) => {
        if (queryRevision < lastConnectionRevision) {
          return;
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

        try {
          costField.setTarget(
            context.pageType === 'product_form_edit'
              ? context.detectedProduct?.id
              : context.pageType === 'product_form_new'
                ? '__new__'
                : undefined
          );
        } catch (err) {
          console.error('[Paulifest Copilot] Erro em costField:', err);
        }

        try {
          // Ativação da coluna de Preço de Custo na Listagem de Produtos
          if (context.pageType !== 'product_form_edit' && context.pageType !== 'product_form_new') {
            listCostInjector.start();
          } else {
            listCostInjector.destroy();
          }
        } catch (err) {
          console.error('[Paulifest Copilot] Erro em listCostInjector:', err);
        }

        try {
          formAssistant.start();
        } catch (err) {
          console.error('[Paulifest Copilot] Erro em formAssistant:', err);
        }


        // Solicitação explícita de Quick View (Fase 4D.2)
        if (context.pageType === 'product_form_edit' && context.detectedProduct?.id) {
          const qvPayload: ContentToBackgroundEnvelope<{ productId: string }> = {
            type: 'BLING_GET_QUICK_VIEW',
            pageInstanceId,
            payload: { productId: context.detectedProduct.id },
            clientTimestamp: new Date().toISOString()
          };
          chrome.runtime.sendMessage(qvPayload).catch((err) => {
            console.debug('[Paulifest Copilot] Erro ao solicitar Quick View:', err);
          });
        }
      }
    });

    spaObserver.start();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== 'BLING_FILL_NEW_PRODUCT') return;
      const panelUrl = chrome.runtime.getURL('sidepanel.html');
      if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(panelUrl) ||
          message.pageInstanceId !== pageInstanceId || message.url !== window.location.href) {
        sendResponse({ ok: false, error: 'Documento alterado ou remetente inválido. Abra a ficha novamente.' }); return;
      }
      const res = fillNewBlingProduct(message.values, message.url);
      if (res.ok && typeof message.costPrice === 'number' && Number.isFinite(message.costPrice) && message.costPrice >= 0) {
        void costField.applyCostFromPopup(message.costPrice);
      }
      sendResponse(res);
    });

    chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
      if(message?.type!=='BLING_VERIFY_COST_TARGET')return;
      if(sender.id!==chrome.runtime.id || message.pageInstanceId!==pageInstanceId || message.expectedUrl!==location.href){sendResponse({ok:false});return;}
      const context=classifyBlingUrl(location.href);
      const pid = String(message.productId || '');
      const hasProductInDoc = (doc: Document): boolean => (
        Boolean(doc.querySelector('#paulifest-cost-header, .paulifest-cost-td, #paulifest-stock-header, .paulifest-stock-td')) && (
          Boolean(pid && doc.querySelector(`[data-product-id="${CSS.escape(pid)}"]`)) ||
          Array.from(doc.querySelectorAll<HTMLElement>('tbody tr, tr')).some(row=>extractProductIdFromRow(row)===pid)
        )
      );
      let foundInDocs = hasProductInDoc(document);
      if (!foundInDocs && typeof document.querySelectorAll === 'function') {
        const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
        for (let i = 0; i < iframes.length; i++) {
          try {
            if (iframes[i].contentDocument && hasProductInDoc(iframes[i].contentDocument!)) {
              foundInDocs = true;
              break;
            }
          } catch {}
        }
      }
      const ok=context.pageType==='product_form_edit'?context.detectedId===pid:
        (context.pageType==='product_list' || foundInDocs);
      sendResponse({ok});
    });

    // Escuta comandos de atualização de UI vindos do Background
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message && message.type === 'APPLY_UI_STATE') {
        // Regra de Ouro: Descarte se a revisão for menor que a última aceita
        if (message.contextRevision >= lastAcceptedRevision) {
          lastAcceptedRevision = message.contextRevision;
          shadowUi.update(message.uiState, message.pageType, message.detectedProduct);
          costField.update(message.uiState);
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
