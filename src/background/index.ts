import { restrictCredentialStorage } from './storage-access.ts';
const credentialStorageReady = restrictCredentialStorage(chrome.storage);
void credentialStorageReady.catch(() => console.error('[Paulifest] Isolamento de storage indisponível; autenticação bloqueada.'));
import { tabContextManager } from './tab-context-manager.ts';
import { messageRouter } from './message-router.ts';
import { blingAuthOrchestrator } from './bling-auth-orchestrator.ts';
import { classifyBlingUrl } from '../content-scripts/bling/dom-identifier.ts';
import { isBlingDomain } from '../shared/tab-context-contracts.ts';

function isMlDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br') || host === 'mercadolibre.com' || host.endsWith('.mercadolibre.com');
  } catch {
    return false;
  }
}

// 1. Configura a ação do ícone para abrir a SidePanel nativa
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('[Paulifest Copilot] Erro ao configurar sidePanel behavior:', err);
    });
  }
  console.info('[Paulifest Copilot] Extensão instalada com sucesso.');
});

// 2. Reidratação automática de contexto por aba quando o Service Worker acordar
const backgroundReady = credentialStorageReady.then(() => tabContextManager.rehydrate()).then(() => tabContextManager.invalidateQuickViews());
void backgroundReady.catch((err) => {
  console.debug('[Paulifest Copilot] Erro na reidratação do TabContextManager:', err);
});

// 3. Listener nativo de navegação SPA: chrome.webNavigation.onHistoryStateUpdated
if (chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated) {
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    // Filtra apenas frames principais (frameId === 0)
    if (details.frameId === 0 && details.tabId > 0 && details.url) {
      if (isBlingDomain(details.url)) {
        const classified = classifyBlingUrl(details.url);
        tabContextManager.registerOrUpdateTab(details.tabId, {
          platform: 'bling',
          url: details.url,
          pageType: classified.pageType,
          detectedProduct: classified.detectedId ? { id: classified.detectedId } : undefined
        }).then((updatedState) => {
          messageRouter.dispatchUiStateToContentScript(details.tabId, updatedState);
          messageRouter.notifyActiveTabToSidebar(details.tabId, updatedState);
        }).catch(() => {});
      }
    }
  });
}

// 4. Listeners de ciclo de vida das abas
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const tabState = await tabContextManager.getTabState(tabId);
  if (tabState) {
    messageRouter.notifyActiveTabToSidebar(tabId, tabState);
  } else {
    // Busca informações da aba caso ainda não esteja registrada
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url) {
        const isBling = isBlingDomain(tab.url);
        const isML = isMlDomain(tab.url);
        const platform = isBling ? 'bling' : isML ? 'mercadolivre' : 'neutral';
        const classified = isBling ? classifyBlingUrl(tab.url) : { pageType: 'other' as const };

        const registered = await tabContextManager.registerOrUpdateTab(tabId, {
          platform,
          url: tab.url,
          pageType: classified.pageType,
          detectedProduct: (classified as any).detectedId ? { id: (classified as any).detectedId } : undefined
        });
        messageRouter.notifyActiveTabToSidebar(tabId, registered);
      }
    } catch {}
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    const url = tab.url || changeInfo.url || '';
    if (url) {
      const isBling = isBlingDomain(url);
      const isML = isMlDomain(url);
      const platform = isBling ? 'bling' : isML ? 'mercadolivre' : 'neutral';
      const classified = isBling ? classifyBlingUrl(url) : { pageType: 'other' as const };

      const registered = await tabContextManager.registerOrUpdateTab(tabId, {
        platform,
        url,
        pageType: classified.pageType,
        detectedProduct: (classified as any).detectedId ? { id: (classified as any).detectedId } : undefined
      });

      if (isBling) {
        messageRouter.dispatchUiStateToContentScript(tabId, registered);
      }
      if (tab.active) {
        messageRouter.notifyActiveTabToSidebar(tabId, registered);
      }
    }
  }
});

// 5. Limpeza de estado quando uma aba é fechada
chrome.tabs.onRemoved.addListener((tabId) => {
  tabContextManager.removeTab(tabId).catch((err) => {
    console.debug('[Paulifest Copilot] Erro ao remover aba do manager:', err);
  });
  blingAuthOrchestrator.handleTabRemoved(tabId).catch((err) => {
    console.debug('[Paulifest Copilot] Erro ao processar fechamento de aba no auth orchestrator:', err);
  });
});

// 6. Roteamento centralizado de mensagens tipadas
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  backgroundReady.then(() => messageRouter.handleMessage(message, sender, sendResponse)).catch((err) => {
    sendResponse({ ok: false, error: 'Operação bloqueada: inicialização segura indisponível.' });
    console.error('[Paulifest Copilot] Erro no roteador de mensagens:', err);
  });
  return true; // Mantém o canal de mensagens aberto para resposta assíncrona
});
