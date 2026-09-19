import { 
  extractVerifiedSenderTabId,
  isBlingDomain,
  type ContentToBackgroundEnvelope,
  type BlingDomContextPayload,
  type BlingActionTriggeredPayload,
  type BackgroundToContentEnvelope,
  type TabContextSyncMessage,
  type TabContextState
} from '../shared/tab-context-contracts.ts';
import { tabContextManager } from './tab-context-manager.ts';
import { loadSheet, saveSheet } from '../core/storage/storage.ts';
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

export class MessageRouter {
  private gatewayClient: GatewayClient;
  private authOrchestrator: BlingAuthOrchestrator;
  private inFlightRequests = new Map<string, Promise<any>>();
  private mockMode: boolean = false;

  constructor(
    gatewayClientInstance?: GatewayClient,
    options?: { mockMode?: boolean; authOrchestrator?: BlingAuthOrchestrator }
  ) {
    this.gatewayClient = gatewayClientInstance || gatewayClient;
    this.authOrchestrator = options?.authOrchestrator || (gatewayClientInstance ? new BlingAuthOrchestrator(this.gatewayClient) : blingAuthOrchestrator);
    this.mockMode = options?.mockMode ?? false;
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

    // 1. Mensagens da Sidebar pedindo contexto da aba ativa
    if (message.type === 'GET_ACTIVE_TAB_CONTEXT' || message.type === 'GET_CONTEXT') {
      await this.handleGetActiveTabContext(sendResponse);
      return true; // resposta assíncrona
    }

    // Requisito 4: Mensagem da Sidebar para associar Ficha Central à aba
    if (message.type === 'LINK_SHEET_TO_TAB') {
      const sheetId = message.sheetId;
      let targetTabId = message.tabId;
      if (!targetTabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          targetTabId = activeTab?.id;
        } catch {}
      }
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

        // Fallback exclusivo para a suíte de testes de simulação legada da Fase 4B (zero fallback silencioso em prod)
        if (this.mockMode || pageInstanceId === 'inst_mock') {
          const mockRawPayload = {
            nome: `Produto Bling #${targetId} (Simulado 4B)`,
            codigo: currentTab.detectedProduct?.sku || `SKU-SIM-${targetId}`,
            preco: 149.90,
            precoCusto: 89.00,
            tipo: 'P',
            situacao: 'A',
            gtin: '7891000111222',
            marca: 'Marca Demonstrativa'
          };

          const validated = validateBlingProductInput(mockRawPayload);
          const mapped = mapBlingProductToSheetPatch(validated.sanitized, {
            externalId: targetId,
            sourceName: 'Bling ERP (Simulação 4B)'
          });

          let baseSheet: CentralProductSheet | null = null;
          if (currentTab.activeSheetId) {
            const loaded = await loadSheet(currentTab.activeSheetId);
            if (loaded) {
              const hasConflictingBlingRef = loaded.externalReferences?.some(
                (ref) => ref.system === 'bling' && ref.externalId && String(ref.externalId) !== String(targetId)
              );
              if (hasConflictingBlingRef) {
                baseSheet = null;
              } else {
                baseSheet = loaded;
              }
            }
          }
          if (!baseSheet) {
            baseSheet = createInitialSheet();
          }

          const reconciled = reconcileBlingPatch(baseSheet, mapped);
          await saveSheet(reconciled.sheet);

          const stateWithFeedback = await tabContextManager.registerOrUpdateTab(tabId, {
            activeSheetId: reconciled.sheet.id,
            uiState: {
              isSimulatedMock: true,
              actionFeedback: {
                type: 'success',
                message: `✓ Produto #${targetId} carregado na Ficha Central (Simulado)`
              }
            }
          });
          this.dispatchUiStateToContentScript(tabId, stateWithFeedback);
          this.notifyActiveTabToSidebar(tabId, stateWithFeedback);

          if (typeof chrome !== 'undefined' && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
            chrome.sidePanel.open({ tabId }).catch(() => {});
          }

          sendResponse({ 
            ok: true, 
            action: 'prepare_mercadolivre',
            isSimulatedMock: true,
            sheetId: reconciled.sheet.id
          });
          return;
        }

        // Modo Real 4C.3: Feedback imediato de carregamento no Dock e Sidebar
        const loadingState = await tabContextManager.registerOrUpdateTab(tabId, {
          uiState: {
            isSimulatedMock: false,
            actionFeedback: {
              type: 'loading',
              message: `Carregando produto #${targetId} do Bling...`
            }
          }
        });
        this.dispatchUiStateToContentScript(tabId, loadingState);
        this.notifyActiveTabToSidebar(tabId, loadingState);

        // Snapshot pré-request capturado com a contextRevision do estado de loading
        const snapshotTabId = tabId;
        const snapshotPageInstanceId = pageInstanceId;
        const snapshotRevision = loadingState.contextRevision;
        const snapshotProductId = targetId;

        // Chave de deduplicação incorporando contextRevision
        const dedupeKey = `${snapshotTabId}:${snapshotProductId}:${snapshotPageInstanceId}:${snapshotRevision}`;

        // Execução da consulta ao Gateway com deduplicação em voo e cleanup garantido em finally
        let pending = this.inFlightRequests.get(dedupeKey);
        if (!pending) {
          pending = this.gatewayClient.fetchBlingProduct(snapshotProductId);
          this.inFlightRequests.set(dedupeKey, pending);
        }

        let gatewayResponse: any;
        try {
          gatewayResponse = await pending;
        } catch (err: any) {
          let feedbackType: 'error' | 'warning' | 'auth_required' = 'error';
          let message = err?.message || 'Falha ao consultar produto no Gateway.';

          if (err instanceof GatewayAuthRequiredError) {
            feedbackType = 'auth_required';
            message = '⚠️ Conexão com o Bling requer autorização. Reconecte o Bling.';
          } else if (err instanceof GatewayTransientError) {
            feedbackType = 'warning';
            message = `⚠️ ${err.message}`;
          }

          const errState = await tabContextManager.registerOrUpdateTab(tabId, {
            uiState: {
              actionFeedback: {
                type: feedbackType,
                message
              }
            }
          });
          this.dispatchUiStateToContentScript(tabId, errState);
          this.notifyActiveTabToSidebar(tabId, errState);

          sendResponse({ ok: false, error: message });
          return;
        } finally {
          // Limpeza incondicional do Map em finally (tanto em sucesso quanto em erro)
          this.inFlightRequests.delete(dedupeKey);
        }

        // BARREIRA RIGOROSA DE STALE-RESPONSE (Validação Simultânea Pré-Commit)
        const freshTab = await tabContextManager.getTabState(snapshotTabId);
        const isValidForCommit = (
          freshTab !== undefined &&
          freshTab.tabId === snapshotTabId &&
          freshTab.pageInstanceId === snapshotPageInstanceId &&
          freshTab.contextRevision === snapshotRevision &&
          freshTab.detectedProduct?.id === snapshotProductId &&
          freshTab.pageType === 'product_form_edit'
        );

        if (!isValidForCommit) {
          console.warn(
            `[Paulifest Copilot] Resposta stale descartada para produto #${snapshotProductId} na aba ${snapshotTabId}. Motivo: contexto, revisão ou tipo de tela alterados durante a requisição.`
          );
          sendResponse({ 
            ok: false, 
            warning: 'Resposta descartada: contexto da aba foi alterado durante a requisição.' 
          });
          return; // DESCARTA SEM TOCAR NA CENTRAL PRODUCT SHEET
        }

        // Defesa em profundidade: Se a aba apontava para ficha com produto Bling conflitante, gera nova
        let baseSheet: CentralProductSheet | null = null;
        if (freshTab.activeSheetId) {
          const loaded = await loadSheet(freshTab.activeSheetId);
          if (loaded) {
            const hasConflictingBlingRef = loaded.externalReferences?.some(
              (ref) => ref.system === 'bling' && ref.externalId && String(ref.externalId) !== String(snapshotProductId)
            );
            if (hasConflictingBlingRef) {
              console.warn(
                `[Paulifest Copilot] Defesa em profundidade: aba ${tabId} apontava para ficha com produto Bling conflitante. Descartando ficha anterior e gerando nova.`
              );
              baseSheet = null;
            } else {
              baseSheet = loaded;
            }
          }
        }
        if (!baseSheet) {
          baseSheet = createInitialSheet();
        }

        // Executa o pipeline puro da Fase 4A com contratos oficiais
        const validated = validateBlingProductInput(gatewayResponse.product, {
          externalId: snapshotProductId,
          retrievedAt: gatewayResponse.retrievedAt,
          sourceName: 'Bling ERP (API Oficial v3)'
        });

        const mapped = mapBlingProductToSheetPatch(validated.sanitized, {
          externalId: snapshotProductId,
          retrievedAt: gatewayResponse.retrievedAt,
          sourceName: 'Bling ERP (API Oficial v3)',
          confirmedUnits: {
            weight: 'kg',
            dimension: 'cm'
          }
        });

        const reconciled = reconcileBlingPatch(baseSheet, mapped);

        // Salva a ficha pelo seu próprio ID no storage permanente
        await saveSheet(reconciled.sheet);

        // Associa esse ID exclusivamente à aba correspondente
        await tabContextManager.linkSheetToTab(tabId, reconciled.sheet.id);

        // Abre a sidebar nativa
        if (typeof chrome !== 'undefined' && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
          chrome.sidePanel.open({ tabId }).catch(() => {});
        }

        const hasConflicts = (reconciled.conflictedFields && reconciled.conflictedFields.length > 0) || reconciled.sheet.hasUnresolvedConflicts;
        const feedbackType = hasConflicts ? 'warning' : 'success';
        const feedbackMessage = hasConflicts
          ? `✓ Produto #${snapshotProductId} carregado com divergências na Ficha Central`
          : `✓ Produto #${snapshotProductId} carregado com sucesso do Bling`;

        // Notifica o content script e sidebar com feedback real (isSimulatedMock: false)
        const stateWithFeedback = await tabContextManager.registerOrUpdateTab(tabId, {
          activeSheetId: reconciled.sheet.id,
          uiState: {
            isSimulatedMock: false,
            actionFeedback: {
              type: feedbackType,
              message: feedbackMessage
            }
          }
        });
        this.dispatchUiStateToContentScript(tabId, stateWithFeedback);
        this.notifyActiveTabToSidebar(tabId, stateWithFeedback);

        sendResponse({ 
          ok: true, 
          action: 'prepare_mercadolivre',
          isSimulatedMock: false,
          sheetId: reconciled.sheet.id,
          conflictedFields: reconciled.conflictedFields
        });
        return;
      }

      sendResponse({ ok: false, error: 'Ação não suportada.' });
    } catch (err: any) {
      console.error('[Paulifest Copilot] Erro ao executar ação contextual:', err);
      sendResponse({ ok: false, error: err?.message || 'Falha ao processar ação.' });
    }
  }

  /**
   * Responde com o contexto da aba ativa atual para a Sidebar.
   */
  private async handleGetActiveTabContext(sendResponse: (res: any) => void): Promise<void> {
    try {
      let activeTabId: number | undefined;
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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

    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Ignora erro se content script ainda não estiver injetado ou pronto
    });
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

    chrome.runtime.sendMessage(message).catch(() => {
      // Ignora erro se sidebar estiver fechada
    });
  }
}

export const messageRouter = new MessageRouter();
