import { detectPageContext } from './context-detector';
import { ExtensionMessage, PageContextState } from '../shared/types';

let currentContext: PageContextState = detectPageContext(undefined, 'Inicializando...');

// 1. Configura a ação do ícone para abrir a SidePanel nativa
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('[Paulifest Copilot] Erro ao configurar sidePanel behavior:', err);
    });
  }
  console.info('[Paulifest Copilot] Extensão instalada com sucesso.');
});

// 2. Atualiza o contexto da aba ativa
async function updateActiveTabContext(tabId?: number) {
  try {
    let tab: chrome.tabs.Tab | undefined;
    if (tabId) {
      tab = await chrome.tabs.get(tabId);
    } else {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
    }

    if (tab) {
      currentContext = detectPageContext(tab.url, tab.title, tab.id);
      
      // Notifica a Sidebar sobre a mudança de contexto
      chrome.runtime.sendMessage<ExtensionMessage>({
        type: 'CONTEXT_UPDATED',
        payload: currentContext
      }).catch(() => {
        // Ignora erro caso a sidebar não esteja aberta no momento
      });
    }
  } catch (err) {
    console.debug('[Paulifest Copilot] Aba inacessível:', err);
  }
}

// 3. Listeners de ciclo de vida das abas
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateActiveTabContext(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    if (tab.active) {
      updateActiveTabContext(tabId);
    }
  }
});

// 4. Atendimento a mensagens internas
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'GET_CONTEXT') {
    // Atualiza imediatamente e responde
    updateActiveTabContext().then(() => {
      sendResponse(currentContext);
    });
    return true; // Resposta assíncrona
  }
  return false;
});
