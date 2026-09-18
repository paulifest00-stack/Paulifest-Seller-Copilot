// Content script não-intrusivo para monitoramento de contexto e auxílio futuro
(() => {
  const host = window.location.hostname;
  console.info(`[Paulifest Copilot] Content script ativo em ${host}`);

  // Escuta requisições de inspeção de contexto da Sidebar
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === 'PING_CONTENT_SCRIPT') {
      sendResponse({
        ok: true,
        host,
        title: document.title,
        url: window.location.href
      });
    }
  });
})();
