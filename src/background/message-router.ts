import { importCommitGate } from './import-commit-gate.ts';
import { 
  extractVerifiedSenderTabId,
  isBlingDomain,
  isValidProductId,
  type ContentToBackgroundEnvelope,
  type BlingDomContextPayload,
  type BlingActionTriggeredPayload,
  type BackgroundToContentEnvelope,
  type TabContextSyncMessage,
  type TabContextState
} from '../shared/tab-context-contracts.ts';
import type { BlingProductQuickView } from '../shared/gateway-contracts.ts';
import { tabContextManager } from './tab-context-manager.ts';
import { loadSheet, commitImportedSheet } from '../core/storage/storage.ts';
import { createInitialSheet, type CentralProductSheet } from '../core/schema/product.ts';
import { validateBlingProductInput } from '../integrations/bling/runtime-validator.ts';
import { mapBlingProductToSheetPatch } from '../integrations/bling/bling-to-sheet.mapper.ts';
import { reconcileBlingPatch } from '../integrations/bling/reconciliation.ts';
import { classifyBlingUrl } from '../content-scripts/bling/dom-identifier.ts';
import {
  GatewayClient,
  gatewayClient,
  GatewayAuthRequiredError,
  GatewayTransientError
} from './gateway-client.ts';
import {
  BlingAuthOrchestrator,
  blingAuthOrchestrator
} from './bling-auth-orchestrator.ts';

export interface RouteMessageResult {
  handled: boolean;
  response?: any;
  error?: string;
}

class StaleImportError extends Error {}

export class MessageRouter {
  private gatewayClient: GatewayClient;
  private authOrchestrator: BlingAuthOrchestrator;
  private inFlightRequests = new Map<string, Promise<any>>();
  private mockMode: boolean = false;
  private importResponders = new Map<string, Set<(response: any) => void>>();

  constructor(
    gatewayClientInstance?: GatewayClient,
    options?: { mockMode?: boolean; authOrchestrator?: BlingAuthOrchestrator }
  ) {
    this.gatewayClient = gatewayClientInstance || gatewayClient;
    this.authOrchestrator = options?.authOrchestrator || (gatewayClientInstance ? new BlingAuthOrchestrator(this.gatewayClient) : blingAuthOrchestrator);
    this.mockMode = options?.mockMode ?? false;
    this.gatewayClient.onAuthInvalidated(async () => {
      this.inFlightRequests.clear();
      for (const state of await tabContextManager.invalidateQuickViews()) {
        this.dispatchUiStateToContentScript(state.tabId, state);
        this.notifyActiveTabToSidebar(state.tabId, state);
      }
    });
  }

  getAuthOrchestrator(): BlingAuthOrchestrator {
    return this.authOrchestrator;
  }

  setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }
  /**
   * Ponto central de despacho para mensagens recebidas via chrome.runtime.onMessage.
   */
  async handleMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): Promise<boolean> {
    if (!message || typeof message !== 'object') {
      return false;
    }

    // 0. Mensagens de Autenticação / Conexão Bling (Fase 4C.4A)
    if (message.type === 'BLING_START_CONNECT') {
      try {
        const res = await this.authOrchestrator.startConnect();
        sendResponse(res);
      } catch (err: any) {
        sendResponse({ ok: false, status: 'disconnected', error: err?.message || 'Falha ao iniciar conexão.' });
      }
      return true;
    }

    if (message.type === 'BLING_GET_CONNECTION_STATUS') {
      try {
        const res = await this.authOrchestrator.getConnectionStatus();
        sendResponse(res);
      } catch (err: any) {
        sendResponse({ ok: false, status: 'disconnected', error: err?.message || 'Falha ao obter status.' });
      }
      return true;
    }

    if (message.type === 'BLING_DISCONNECT') {
      try {
        const res = await this.authOrchestrator.disconnect();
        sendResponse(res);
      } catch (err: any) {
        sendResponse({ ok: false, error: err?.message || 'Falha ao desconectar.' });
      }
      return true;
    }

    // BLING_FOCUS_OAUTH_TAB: foca aba OAuth em andamento sem expor dados de pareamento (Fase 4C.4B)
    if (message.type === 'BLING_FOCUS_OAUTH_TAB') {
      const flow = this.authOrchestrator.getActiveFlow();
      if (flow && !flow.resolved && flow.oauthTabId && typeof chrome !== 'undefined' && chrome.tabs?.update) {
        chrome.tabs.update(flow.oauthTabId, { active: true }).catch(() => {});
        sendResponse({ ok: true, focused: true });
      } else {
        // Sem aba OAuth ativa: resposta segura sem expor detalhes internos
        sendResponse({ ok: true, focused: false });
      }
      return true;
    }

    // BLING_RETRY_CONNECTION: reavalia estado de sessão sem iniciar novo OAuth (Fase 4C.4B)
    // Semântica: getConnectionStatus() já tenta refresh via GRT se GST inválido.
    // NUNCA abre nova aba de autorização automaticamente.
    if (message.type === 'BLING_RETRY_CONNECTION') {
      try {
        const res = await this.authOrchestrator.getConnectionStatus();
        // getConnectionStatus() já atualiza cachedStatus internamente.
        // Broadcast para manter todos os listeners (Sidebar + Dock) sincronizados.
        this.authOrchestrator.broadcastStatus(res.status, res.lastRefreshAt);
        sendResponse({ ok: res.ok, status: res.status, lastRefreshAt: res.lastRefreshAt, error: res.error, message: res.message });
      } catch (err: any) {
        sendResponse({ ok: false, status: 'gateway_unreachable' as const, error: err?.message || 'Falha ao reavaliar status.' });
      }
      return true;
    }

    // 1. Mensagens da Sidebar pedindo contexto da aba ativa
    if (message.type === 'GET_ACTIVE_TAB_CONTEXT' || message.type === 'GET_CONTEXT') {
      await this.handleGetActiveTabContext(sendResponse, message.windowId, sender);
      return true; // resposta assíncrona
    }

    // Requisito 4: Mensagem da Sidebar para associar Ficha Central à aba
    if (message.type === 'LINK_SHEET_TO_TAB') {
      const sheetId = message.sheetId;
      const targetTabId = await this.resolveTargetTab(sender, message.tabId, message.windowId);
      if (targetTabId && sheetId) {
        const updated = await tabContextManager.linkSheetToTab(targetTabId, sheetId);
        if (updated) {
          this.notifyActiveTabToSidebar(targetTabId, updated);
          this.dispatchUiStateToContentScript(targetTabId, updated);
        }
        sendResponse({ ok: true, state: updated });
      } else {
        sendResponse({ ok: false, error: 'tabId ou sheetId ausente.' });
      }
      return true;
    }

    // Operação de Quick View (leitura de custo e estoque)
    if (message.type === 'BLING_GET_QUICK_VIEW') {
      const targetTabId = await this.resolveTargetTab(sender);

      if (!targetTabId) {
        sendResponse({ ok: false, error: 'Remetente sem tabId confiável da plataforma.' });
        return true;
      }

      const envelope = message as ContentToBackgroundEnvelope<any>;
      const payload = envelope.payload || message;
      await this.handleBlingGetQuickView(targetTabId, envelope.pageInstanceId, payload, sendResponse);
      return true;
    }

    // 2. Mensagens provenientes de Content Scripts
    const verifiedTabId = extractVerifiedSenderTabId(sender);
    if (!verifiedTabId) {
      console.warn('[Paulifest Copilot] Mensagem descartada: remetente sem tabId verificado.');
      sendResponse({ ok: false, error: 'Remetente sem tabId confiável da plataforma.' });
      return false;
    }

    const envelope = message as ContentToBackgroundEnvelope<any>;

    if (envelope.type === 'BLING_DOM_CONTEXT_DETECTED') {
      await this.handleBlingDomContextDetected(verifiedTabId, envelope.pageInstanceId, envelope.payload, sendResponse);
      return true;
    }

    if (envelope.type === 'BLING_ACTION_TRIGGERED') {
      await this.handleBlingActionTriggered(verifiedTabId, envelope.pageInstanceId, envelope.payload, sendResponse);
      return true;
    }

    return false;
  }

  private async resolveTargetTab(sender: chrome.runtime.MessageSender, requestedTabId?: number, windowId?: number): Promise<number | null> {
    const contentTab = extractVerifiedSenderTabId(sender);
    if (contentTab !== null) return contentTab;
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL ||
        sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html')) return null;
    const [active] = await chrome.tabs.query(Number.isInteger(windowId) ? { active: true, windowId } : { active: true, currentWindow: true });
    if (!active?.id || (requestedTabId !== undefined && requestedTabId !== active.id)) return null;
    return active.id;
  }

  /**
   * Processa detecção de contexto de rota/DOM enviada pelo Content Script.
   * 
   * Requisitos estritos:
   * - Valida domínio estrito com isBlingDomain (Requisito 6).
   * - Background recalcula e decide o pageType aceito usando classifyBlingUrl (Requisito 4).
   * - Não aceita product_form_edit apenas porque o payload declarou isso.
   * - pageInstanceId é associado ao contexto da aba.
   */
  private async handleBlingDomContextDetected(
    tabId: number,
    pageInstanceId: string,
    payload: BlingDomContextPayload,
    sendResponse: (res: any) => void
  ): Promise<void> {
    try {
      if (!isBlingDomain(payload.url)) {
        sendResponse({ ok: false, error: 'URL não pertence a um domínio autorizado do Bling ERP.' });
        return;
      }

      // Requisito 4: Recalcula o contexto a partir da URL no Background
      const urlClassification = classifyBlingUrl(payload.url);
      const acceptedPageType = urlClassification.pageType;

      let acceptedDetectedProduct = payload.detectedProduct;
      if (urlClassification.detectedId) {
        // ID comprovado na URL prevalece estritamente
        acceptedDetectedProduct = {
          ...acceptedDetectedProduct,
          id: urlClassification.detectedId
        };
      } else if (acceptedPageType === 'product_form_new') {
        // Em novo produto, nunca aceita ID vindo do DOM
        acceptedDetectedProduct = acceptedDetectedProduct?.sku ? { sku: acceptedDetectedProduct.sku } : undefined;
      }

      const updatedState = await tabContextManager.registerOrUpdateTab(tabId, {
        pageInstanceId,
        platform: 'bling',
        pageType: acceptedPageType,
        url: payload.url,
        detectedProduct: acceptedDetectedProduct
      });

      // Emite o estado atualizado para a UI contextual da aba
      this.dispatchUiStateToContentScript(tabId, updatedState);

      // Notifica a Sidebar sobre a mudança de contexto
      this.notifyActiveTabToSidebar(tabId, updatedState);

      if (acceptedPageType === 'product_form_edit' && acceptedDetectedProduct?.id) {
        // Dispara busca assíncrona de Quick View para o produto detectado
        this.handleBlingGetQuickView(tabId, pageInstanceId, { productId: acceptedDetectedProduct.id }, () => {}).catch(() => {});
      }

      sendResponse({ ok: true, contextRevision: updatedState.contextRevision });
    } catch (err: any) {
      console.error('[Paulifest Copilot] Erro ao registrar contexto da aba:', err);
      sendResponse({ ok: false, error: err?.message || 'Erro ao registrar contexto.' });
    }
  }

  /**
   * Processa o clique em botões do dock contextual ("Abrir no Copilot" ou "Preparar para ML").
   * 
   * Requisitos estritos:
   * - Valida integridade de pageInstanceId: rejeita mensagens de instâncias antigas (Requisito 3).
   * - Carrega e salva a ficha pelo próprio ID, eliminando contaminação entre abas (Requisito 2).
   */
  private async handleBlingActionTriggered(
    tabId: number,
    pageInstanceId: string,
    payload: BlingActionTriggeredPayload,
    sendResponse: (res: any) => void
  ): Promise<void> {
    try {
      const snapshotAuth = this.gatewayClient.getAuthGeneration();
      const currentTab = await tabContextManager.getTabState(tabId);
      if (!currentTab) {
        sendResponse({ ok: false, error: 'Aba não encontrada no gerenciador de contexto.' });
        return;
      }

      // Requisito 3: Validação de integridade de pageInstanceId
      if (currentTab.pageInstanceId && pageInstanceId && currentTab.pageInstanceId !== pageInstanceId) {
        console.warn(`[Paulifest Copilot] Ação descartada: pageInstanceId obsoleto (${pageInstanceId} vs atual ${currentTab.pageInstanceId})`);
        sendResponse({ 
          ok: false, 
          error: 'Ação rejeitada: documento expirado ou navegação concorrente detectada (pageInstanceId desatualizado).' 
        });
        return;
      }

      if (payload.action === 'open_in_copilot') {
        if (typeof chrome !== 'undefined' && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
          chrome.sidePanel.open({ tabId }).catch((err) => {
            console.debug('[Paulifest Copilot] sidePanel.open:', err);
          });
        }
        sendResponse({ ok: true, action: 'open_in_copilot' });
        return;
      }

      if (payload.action === 'prepare_mercadolivre') {
        const operationKey = JSON.stringify([snapshotAuth, tabId, pageInstanceId, currentTab.contextRevision]);
        const existing = this.importResponders.get(operationKey);
        if (existing) { existing.add(sendResponse); return; }
        const responders = new Set([sendResponse]);
        const operationKeys = [operationKey];
        this.importResponders.set(operationKey, responders);
        sendResponse = response => {
          for (const key of operationKeys) if (this.importResponders.get(key) === responders) this.importResponders.delete(key);
          for (const respond of responders) { try { respond(response); } catch { /* Closed message port must not fail the commit or other responders. */ } }
        };
        if (currentTab.pageType === 'product_form_new') {
          sendResponse({ 
            ok: false, 
            warning: 'Importação bloqueada: produto novo ou sem ID confirmado na tela.' 
          });
          return;
        }

        // Requisito Escopo 4C.3: Importação real restrita exclusivamente a product_form_edit
        if (currentTab.pageType !== 'product_form_edit') {
          sendResponse({ 
            ok: false, 
            warning: 'Importação bloqueada: disponível exclusivamente na tela de edição do produto (product_form_edit).' 
          });
          return;
        }

        const targetId = currentTab.detectedProduct?.id;
        if (!targetId || targetId.trim().length === 0) {
          sendResponse({ 
            ok: false, 
            warning: 'Importação bloqueada: nenhum ID de produto confirmado nesta tela.' 
          });
          return;
        }

        // Capture immutable identity before any upstream/storage await. Read the
        // manager synchronously at every barrier: awaiting a check creates another gap.
        let expectedState = currentTab;
        let expectedRevision = currentTab.contextRevision;
        const expectedInstance = currentTab.pageInstanceId;
        const assertCurrent = (): TabContextState => {
          const live = tabContextManager.peekTabState(tabId);
          this.gatewayClient.assertAuthGeneration(snapshotAuth);
          if (!live || live !== expectedState || live.tabId !== tabId || live.pageInstanceId !== expectedInstance ||
              live.contextRevision !== expectedRevision || live.detectedProduct?.id !== targetId ||
              live.platform !== currentTab.platform || live.pageType !== 'product_form_edit') {
            throw new StaleImportError('Resposta descartada: contexto alterado durante a importação.');
          }
          return live;
        };
        assertCurrent();

        // Publish loading only while the original context is still authoritative.
        const loadingPromise = tabContextManager.registerOrUpdateTab(tabId, {
          uiState: { isSimulatedMock: this.mockMode, actionFeedback: {
            type: 'loading', message: `Carregando produto #${targetId} do Bling...`
          } }
        });
        expectedState = tabContextManager.peekTabState(tabId)!;
        expectedRevision = expectedState.contextRevision;
        const loadingOperationKey = JSON.stringify([snapshotAuth, tabId, pageInstanceId, expectedRevision]);
        operationKeys.push(loadingOperationKey);
        this.importResponders.set(loadingOperationKey, responders);
        const loadingState = await loadingPromise;
        assertCurrent();
        this.dispatchUiStateToContentScript(tabId, loadingState);
        this.notifyActiveTabToSidebar(tabId, loadingState);

        const dedupeKey = `import:${snapshotAuth}:${tabId}:${targetId}:${expectedInstance}:${expectedRevision}`;
        let pending = this.inFlightRequests.get(dedupeKey);
        if (!pending) {
          pending = this.mockMode ? Promise.resolve({
            product: { nome: `Produto Bling #${targetId} (Simulado 4B)`,
              codigo: currentTab.detectedProduct?.sku || `SKU-SIM-${targetId}`,
              preco: 149.90, precoCusto: 89.00, tipo: 'P', situacao: 'A',
              gtin: '7891000111222', marca: 'Marca Demonstrativa' },
            retrievedAt: new Date().toISOString()
          }) : this.gatewayClient.fetchBlingProduct(targetId);
          this.inFlightRequests.set(dedupeKey, pending);
        }
        let gatewayResponse: any;
        try { gatewayResponse = await pending; }
        catch (err: any) {
          assertCurrent(); // Never publish an old request's error on a new context.
          const type = err instanceof GatewayAuthRequiredError ? 'auth_required'
            : err instanceof GatewayTransientError ? 'warning' : 'error';
          const message = err?.message || 'Falha ao consultar produto no Gateway.';
          const errorPromise = tabContextManager.registerOrUpdateTab(tabId, {
            uiState: { actionFeedback: {type, message} }
          });
          expectedState = tabContextManager.peekTabState(tabId)!;
          expectedRevision = expectedState.contextRevision;
          const errorState = await errorPromise;
          assertCurrent();
          this.dispatchUiStateToContentScript(tabId, errorState);
          this.notifyActiveTabToSidebar(tabId, errorState);
          sendResponse({ok: false, error: message});
          return;
        } finally {
          if (this.inFlightRequests.get(dedupeKey) === pending) this.inFlightRequests.delete(dedupeKey);
        }
        const freshTab = assertCurrent();
        let baseSheet: CentralProductSheet | null = null;
        if (freshTab.activeSheetId) {
          const loaded = await loadSheet(freshTab.activeSheetId);
          assertCurrent();
          if (loaded && !loaded.externalReferences?.some(ref => ref.system === 'bling' &&
              ref.externalId && String(ref.externalId) !== String(targetId))) baseSheet = loaded;
        }
        const persistedBase = baseSheet;
        if (!baseSheet) baseSheet = createInitialSheet();
        const sourceName = this.mockMode ? 'Bling ERP (Simulação 4B)' : 'Bling ERP (API Oficial v3)';
        const validated = validateBlingProductInput(gatewayResponse.product, {
          externalId: targetId, retrievedAt: gatewayResponse.retrievedAt, sourceName
        });
        const mapped = mapBlingProductToSheetPatch(validated.sanitized, {
          externalId: targetId, retrievedAt: gatewayResponse.retrievedAt, sourceName,
          confirmedUnits: { weight: 'kg', dimension: 'cm' },
          stockInfo: freshTab.uiState.quickView?.productId === targetId
            ? freshTab.uiState.quickView.stockInfo : null
        });
        const reconciled = reconcileBlingPatch(baseSheet, mapped);

        // Serialize imports only. Navigation and auth invalidate immediately.
        await importCommitGate.commit(async () => {
          assertCurrent();
          await commitImportedSheet(reconciled.sheet, assertCurrent, async () => {
            assertCurrent();
            const hasConflicts = reconciled.conflictedFields.length > 0 || reconciled.sheet.hasUnresolvedConflicts;
            await tabContextManager.linkSheetToTab(tabId, reconciled.sheet.id, {
              assertCurrent,
              uiState: { isSimulatedMock: this.mockMode, actionFeedback: {
                type: hasConflicts ? 'warning' : 'success',
                message: `✓ Produto #${targetId} carregado${hasConflicts ? ' com divergências' : ''} na Ficha Central${this.mockMode ? ' (Simulado)' : ''}`
              } },
              publish: state => {
                this.dispatchUiStateToContentScript(tabId, state);
                this.notifyActiveTabToSidebar(tabId, state);
                if (typeof chrome !== 'undefined' && chrome.sidePanel?.open) {
                  try { void chrome.sidePanel.open({tabId}).catch(() => {}); } catch { /* UI is best effort. */ }
                }
                sendResponse({ok: true, action: 'prepare_mercadolivre', isSimulatedMock: this.mockMode,
                  sheetId: reconciled.sheet.id, conflictedFields: reconciled.conflictedFields});
              }
            });
          }, persistedBase ?? undefined);
        });
        return;
      }

      sendResponse({ ok: false, error: 'Ação não suportada.' });
    } catch (err: any) {
      if (err instanceof StaleImportError) { sendResponse({ok: false, warning: err.message}); return; }
      console.error('[Paulifest Copilot] Erro ao executar ação contextual:', err);
      sendResponse({ ok: false, error: err?.message || 'Falha ao processar ação.' });
    }
  }

  /**
   * Responde com o contexto da aba ativa atual para a Sidebar.
   */
  private async handleGetActiveTabContext(sendResponse: (res: any) => void, windowId?: number, sender?: chrome.runtime.MessageSender): Promise<void> {
    try {
      let activeTabId: number | undefined;
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const trustedPanel = sender?.id === chrome.runtime.id && sender?.url === chrome.runtime.getURL?.('sidepanel.html');
        const tabs = await chrome.tabs.query(trustedPanel && Number.isInteger(windowId)
          ? { active: true, windowId } : { active: true, currentWindow: true });
        activeTabId = tabs[0]?.id;
      }

      if (activeTabId) {
        const tabState = await tabContextManager.getTabState(activeTabId);
        sendResponse(tabState || null);
      } else {
        sendResponse(null);
      }
    } catch (err) {
      sendResponse(null);
    }
  }

  /**
   * Processa a consulta de Quick View (custo e estoque) com proteção contra resposta stale.
   * Regra de autoridade:
   * - O Content Script/Sidebar fornece apenas productId;
   * - tabId é extraído exclusivamente de sender.tab.id no handleMessage (ou activeTab no fallback);
   * - Snapshot valida pageInstanceId, contextRevision e produto atual antes de commitar na aba.
   */
  private async handleBlingGetQuickView(
    tabId: number,
    pageInstanceId: string | undefined,
    payload: any,
    sendResponse: (res: any) => void
  ): Promise<void> {
    try {
      const snapshotAuth = this.gatewayClient.getAuthGeneration();
      const rawProductId = payload?.productId;
      if (!isValidProductId(rawProductId)) {
        sendResponse({ ok: false, error: 'ID do produto inválido ou não informado.' });
        return;
      }
      const productId = rawProductId.trim();

      const currentTab = await tabContextManager.getTabState(tabId);
      if (!currentTab) {
        sendResponse({ ok: false, error: 'Aba não encontrada no gerenciador de contexto.' });
        return;
      }

      if (pageInstanceId && currentTab.pageInstanceId && currentTab.pageInstanceId !== pageInstanceId) {
        console.warn(`[Paulifest Copilot] Quick View descartado: pageInstanceId obsoleto (${pageInstanceId} vs atual ${currentTab.pageInstanceId})`);
        sendResponse({ ok: false, error: 'Ação rejeitada: documento expirado ou navegação concorrente detectada.' });
        return;
      }

      if (currentTab.platform !== 'bling' || currentTab.pageType !== 'product_form_edit' || currentTab.detectedProduct?.id !== productId) {
        sendResponse({ ok: false, error: 'Produto não corresponde ao contexto atual.' });
        return;
      }
      this.gatewayClient.assertAuthGeneration(snapshotAuth);
      // Sinaliza carregamento do Quick View no Dock e Sidebar
      const loadingState = await tabContextManager.updateQuickView(tabId, currentTab.contextRevision, {
          ...currentTab.uiState,
          quickView: null,
          isSimulatedMock: this.mockMode,
          quickViewLoading: true,
          quickViewError: null
      }, () => this.gatewayClient.getAuthGeneration() === snapshotAuth);
      if (!loadingState || tabContextManager.peekTabState(tabId) !== loadingState) { sendResponse({ok: false, warning: 'Contexto alterado antes da consulta.'}); return; }
      this.gatewayClient.assertAuthGeneration(snapshotAuth);
      this.dispatchUiStateToContentScript(tabId, loadingState);
      this.notifyActiveTabToSidebar(tabId, loadingState);

      const snapshotTabId = tabId;
      const snapshotPageInstanceId = currentTab.pageInstanceId;
      const snapshotRevision = loadingState.contextRevision;
      const snapshotProductId = productId;

      const dedupeKey = `quickview:${snapshotAuth}:${snapshotTabId}:${snapshotProductId}:${snapshotPageInstanceId}:${snapshotRevision}`;

      let pending = this.inFlightRequests.get(dedupeKey);
      if (!pending) {
        if (this.mockMode) {
          pending = Promise.resolve({
            productId: snapshotProductId,
            sku: currentTab.detectedProduct?.sku || `SKU-SIM-${snapshotProductId}`,
            name: `Produto Bling #${snapshotProductId} (Simulado)`,
            costPrice: 89.00,
            stockInfo: {
              physicalTotal: 37,
              virtualTotal: 35,
              deposits: [
                { depositId: '1', depositName: 'Geral', physicalBalance: 37, virtualBalance: 35 }
              ],
              retrievedAt: new Date().toISOString(),
              source: 'bling_erp' as const
            },
            unit: 'UN',
            retrievedAt: new Date().toISOString()
          });
        } else {
          pending = this.gatewayClient.fetchBlingProductQuickView(snapshotProductId);
        }
        this.inFlightRequests.set(dedupeKey, pending);
      }

      let quickViewResult: BlingProductQuickView;
      try {
        quickViewResult = await pending;
      } catch (err: any) {
        const freshTab = await tabContextManager.getTabState(snapshotTabId);
        const isStale = (
          this.gatewayClient.getAuthGeneration() !== snapshotAuth ||
          !freshTab ||
          freshTab.tabId !== snapshotTabId ||
          freshTab.pageInstanceId !== snapshotPageInstanceId ||
          freshTab.contextRevision !== snapshotRevision ||
          freshTab.detectedProduct?.id !== snapshotProductId
        );

        if (isStale) {
          console.warn(`[Paulifest Copilot] Erro de Quick View descartado por contexto stale na aba ${snapshotTabId}`);
          sendResponse({ ok: false, warning: 'Resposta descartada por contexto stale.' });
          return;
        }

        const errState = await tabContextManager.updateQuickView(snapshotTabId, snapshotRevision, {
            ...freshTab.uiState,
            quickViewLoading: false,
            quickViewError: err?.message || 'Falha ao consultar Quick View do produto.'
        }, () => this.gatewayClient.getAuthGeneration() === snapshotAuth);
        if (!errState || tabContextManager.peekTabState(snapshotTabId) !== errState) { sendResponse({ok: false, warning: 'Erro descartado: contexto alterado.'}); return; }
        this.gatewayClient.assertAuthGeneration(snapshotAuth);
        this.dispatchUiStateToContentScript(snapshotTabId, errState);
        this.notifyActiveTabToSidebar(snapshotTabId, errState);

        sendResponse({ ok: false, error: err?.message || 'Falha ao consultar Quick View.' });
        return;
      } finally {
        if (this.inFlightRequests.get(dedupeKey) === pending) this.inFlightRequests.delete(dedupeKey);
      }

      // BARREIRA RIGOROSA DE STALE-RESPONSE
      const freshTab = await tabContextManager.getTabState(snapshotTabId);
      const isValidForCommit = (
        this.gatewayClient.getAuthGeneration() === snapshotAuth &&
        freshTab !== undefined &&
        freshTab.tabId === snapshotTabId &&
        freshTab.pageInstanceId === snapshotPageInstanceId &&
        freshTab.contextRevision === snapshotRevision &&
        freshTab.detectedProduct?.id === snapshotProductId &&
        freshTab.pageType === 'product_form_edit' &&
        quickViewResult.productId === snapshotProductId
      );

      if (!isValidForCommit) {
        console.warn(
          `[Paulifest Copilot] Resposta de Quick View descartada para produto #${snapshotProductId} na aba ${snapshotTabId}. Motivo: contexto, revisão ou produto alterados.`
        );
        sendResponse({
          ok: false,
          warning: 'Resposta de Quick View descartada: contexto da aba foi alterado durante a requisição.'
        });
        return;
      }

      const updatedState = await tabContextManager.updateQuickView(snapshotTabId, snapshotRevision, {
          ...freshTab.uiState,
          quickView: quickViewResult,
          quickViewLoading: false,
          quickViewError: null
      }, () => this.gatewayClient.getAuthGeneration() === snapshotAuth);
      if (!updatedState || tabContextManager.peekTabState(snapshotTabId) !== updatedState) { sendResponse({ok: false, warning: 'Resposta descartada: contexto alterado.'}); return; }
      this.gatewayClient.assertAuthGeneration(snapshotAuth);
      this.dispatchUiStateToContentScript(snapshotTabId, updatedState);
      this.notifyActiveTabToSidebar(snapshotTabId, updatedState);

      sendResponse({
        ok: true,
        quickView: quickViewResult
      });
    } catch (err: any) {
      console.error('[Paulifest Copilot] Erro em handleBlingGetQuickView:', err);
      sendResponse({ ok: false, error: err?.message || 'Erro ao processar Quick View.' });
    }
  }

  /**
   * Despacha o estado visual atualizado para o Shadow DOM do Content Script na aba correspondente.
   */
  dispatchUiStateToContentScript(tabId: number, state: TabContextState): void {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.sendMessage) return;

    const message: BackgroundToContentEnvelope = {
      type: 'APPLY_UI_STATE',
      contextRevision: state.contextRevision,
      pageType: state.pageType,
      uiState: state.uiState,
      detectedProduct: state.detectedProduct
    };

    try {
      const p = chrome.tabs.sendMessage(tabId, message);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch {
      // Ignora erro se content script ainda não estiver injetado ou pronto
    }
  }

  /**
   * Notifica a Sidebar sobre o contexto da aba ativa.
   */
  notifyActiveTabToSidebar(tabId: number, state: TabContextState): void {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;

    const message: TabContextSyncMessage = {
      type: 'ACTIVE_TAB_CONTEXT_UPDATED',
      tabId,
      state
    };

    try {
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch {
      // Ignora erro se sidebar estiver fechada
    }
  }
}

export const messageRouter = new MessageRouter();
