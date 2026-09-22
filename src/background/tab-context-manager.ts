// Gerenciador de Estado por Aba (TabContextManager) - Background Service Worker
import type { TabContextState, BlingPageType, TabContextUiState } from '../shared/tab-context-contracts.ts';

const SESSION_KEY_PREFIX = 'paulifest_tab_context_';

// Armazenamento em memória para ambientes de teste onde chrome.storage.session não está instanciado
const memorySessionStore = new Map<string, string>();

async function getSessionItem(key: string): Promise<any | null> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    const res = await chrome.storage.session.get(key);
    return res[key] || null;
  }
  const serialized = memorySessionStore.get(key);
  return serialized ? JSON.parse(serialized) : null;
}

async function setSessionItem(key: string, val: any): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.set({ [key]: val });
    return;
  }
  memorySessionStore.set(key, JSON.stringify(val));
}

async function removeSessionItem(key: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    await chrome.storage.session.remove(key);
    return;
  }
  memorySessionStore.delete(key);
}

async function getAllSessionKeys(): Promise<string[]> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    const all = await chrome.storage.session.get(null);
    return Object.keys(all).filter(k => k.startsWith(SESSION_KEY_PREFIX));
  }
  return Array.from(memorySessionStore.keys()).filter(k => k.startsWith(SESSION_KEY_PREFIX));
}

function normalizeUrl(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${u.protocol}//${u.host}${pathname}${u.search}${u.hash}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Cria o estado padrão inicial para uma aba.
 */
export function createDefaultTabState(tabId: number, url: string = ''): TabContextState {
  return {
    tabId,
    pageInstanceId: '',
    contextRevision: 0,
    platform: 'neutral',
    pageType: 'other',
    url,
    lastSyncedAt: new Date().toISOString(),
    uiState: {
      dockVisible: false,
      canImport: false,
      isSimulatedMock: false
    }
  };
}

/**
 * Gerenciador responsável pelo estado independente de cada aba ativa no Chrome.
 * 
 * Regras estritas:
 * 1. O Background é a autoridade exclusiva do contador monotônico contextRevision.
 * 2. chrome.storage.session é persistência efêmera para resistir à suspensão do Service Worker.
 * 3. CentralProductSheet NUNCA é armazenada aqui; apenas activeSheetId referenciando o storage.local.
 * 4. Ao fechar a aba, o contexto é removido da memória e do storage.session.
 */
export class TabContextManager {
  private tabStates = new Map<number, TabContextState>();
  private isRehydrated = false;
  private persistence = new Map<number, Promise<void>>();
  private persistInOrder<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const result = (this.persistence.get(tabId) ?? Promise.resolve()).then(operation);
    const settled = result.then(() => {}, () => {});
    this.persistence.set(tabId, settled);
    void settled.then(() => { if (this.persistence.get(tabId) === settled) this.persistence.delete(tabId); });
    return result;
  }

  /**
   * Reconstitui o cache em memória a partir de chrome.storage.session após o Service Worker acordar.
   */
  async rehydrate(): Promise<void> {
    const keys = await getAllSessionKeys();
    for (const key of keys) {
      const state = await getSessionItem(key);
      if (state && typeof state.tabId === 'number') {
        this.tabStates.set(state.tabId, state);
      }
    }
    this.isRehydrated = true;
  }

  /**
   * Obtém o estado atual de uma aba. Se a memória não foi reidratada, consulta o storage.session.
   */
  async getTabState(tabId: number): Promise<TabContextState | undefined> {
    if (!this.isRehydrated) {
      await this.rehydrate();
    }
    return this.tabStates.get(tabId);
  }

  /**
   * Atualiza ou cria o estado de uma aba, incrementando contextRevision como autoridade
   * APENAS quando há alteração semântica real (Requisito 1: Deduplicação e Idempotência).
   */
  async registerOrUpdateTab(
    tabId: number,
    update: {
      pageInstanceId?: string;
      platform?: 'bling' | 'mercadolivre' | 'neutral';
      pageType?: BlingPageType;
      url?: string;
      detectedProduct?: { id?: string; sku?: string };
      activeSheetId?: string;
      uiState?: Partial<TabContextUiState>;
    }
  ): Promise<TabContextState> {
    if (!this.isRehydrated) {
      await this.rehydrate();
    }

    const current = this.tabStates.get(tabId);

    // Se a aba ainda não estava registrada, inicializa na revisão 1
    if (!current) {
      const initial = createDefaultTabState(tabId, update.url || '');
      initial.contextRevision = 1;
      initial.platform = update.platform || initial.platform;
      initial.pageType = update.pageType || initial.pageType;
      initial.pageInstanceId = update.pageInstanceId || initial.pageInstanceId;
      initial.detectedProduct = update.detectedProduct;
      initial.activeSheetId = update.activeSheetId;
      initial.lastSyncedAt = new Date().toISOString();

      const pageType = initial.pageType;
      const detectedId = initial.detectedProduct?.id;
      if (pageType === 'product_form_edit') {
        initial.uiState.dockVisible = true;
        initial.uiState.canImport = Boolean(detectedId && detectedId.trim().length > 0);
      } else if (pageType === 'product_form_new') {
        initial.uiState.dockVisible = true;
        initial.uiState.canImport = false;
      } else if (pageType === 'product_list') {
        initial.uiState.dockVisible = true;
        initial.uiState.canImport = Boolean(detectedId && detectedId.trim().length > 0);
      } else {
        initial.uiState.dockVisible = false;
        initial.uiState.canImport = false;
      }

      if (update.uiState) {
        initial.uiState = { 
          ...initial.uiState, 
          ...update.uiState, 
          isSimulatedMock: update.uiState.isSimulatedMock !== undefined 
            ? update.uiState.isSimulatedMock 
            : initial.uiState.isSimulatedMock 
        };
      }

      this.tabStates.set(tabId, initial);
      await this.persistInOrder(tabId, () => setSessionItem(`${SESSION_KEY_PREFIX}${tabId}`, initial));
      return initial;
    }

    // Calcula os novos valores pretendidos
    const currentId = current.detectedProduct?.id || '';
    const targetPlatform = update.platform ?? current.platform;
    const targetPageType = update.pageType ?? current.pageType;
    const targetUrl = update.url ?? current.url;

    // Determina o produto detectado pretendido
    let targetDetectedProduct = update.detectedProduct !== undefined 
      ? update.detectedProduct 
      : current.detectedProduct;

    if (targetPageType === 'product_form_new') {
      targetDetectedProduct = update.detectedProduct?.sku ? { sku: update.detectedProduct.sku } : undefined;
    } else if (targetPageType === 'other' && (targetPlatform === 'bling' || current.platform === 'bling')) {
      targetDetectedProduct = undefined;
    }

    const targetDetectedId = targetDetectedProduct?.id || '';
    const targetDetectedSku = targetDetectedProduct?.sku || '';

    // Requisito 1: Limpeza automática de vínculo da ficha quando o produto ou contexto muda
    let targetActiveSheetId = update.activeSheetId !== undefined ? update.activeSheetId : current.activeSheetId;

    if (update.activeSheetId === undefined) {
      // 1. Se detectedProduct.id mudar de um ID válido para outro ID válido diferente
      const isProductSwitch = Boolean(currentId && targetDetectedId && currentId !== targetDetectedId);
      // 2. Ao entrar em product_form_new
      const isEnteringNewProduct = targetPageType === 'product_form_new';
      // 3. Ao sair de contexto de produto para other
      const isLeavingToOther = targetPageType === 'other' && (targetPlatform === 'bling' || current.platform === 'bling');

      if (isProductSwitch || isEnteringNewProduct || isLeavingToOther) {
        targetActiveSheetId = undefined;
      }
    }

    // Calcula estado pretendido da UI
    let targetDockVisible = false;
    let targetCanImport = false;

    if (targetPageType === 'product_form_edit') {
      targetDockVisible = true;
      targetCanImport = Boolean(targetDetectedId && targetDetectedId.trim().length > 0);
    } else if (targetPageType === 'product_form_new') {
      targetDockVisible = true;
      targetCanImport = false;
    } else if (targetPageType === 'product_list') {
      targetDockVisible = true;
      targetCanImport = Boolean(targetDetectedId && targetDetectedId.trim().length > 0);
    } else {
      targetDockVisible = false;
      targetCanImport = false;
    }

    if (update.uiState?.dockVisible !== undefined) {
      targetDockVisible = update.uiState.dockVisible;
    }
    if (update.uiState?.canImport !== undefined) {
      targetCanImport = update.uiState.canImport;
    }

    const targetFeedback = update.uiState?.actionFeedback !== undefined
      ? update.uiState.actionFeedback
      : current.uiState.actionFeedback;

    // Comparação semântica estrita (Requisito 1)
    const platformChanged = update.platform !== undefined && targetPlatform !== current.platform;
    const pageTypeChanged = update.pageType !== undefined && targetPageType !== current.pageType;
    const urlChanged = update.url !== undefined && normalizeUrl(targetUrl) !== normalizeUrl(current.url);

    // pageInstanceId: mudança real ocorre se ambos estão preenchidos e são diferentes
    const instanceChanged = Boolean(
      update.pageInstanceId &&
      current.pageInstanceId &&
      update.pageInstanceId !== current.pageInstanceId
    );

    const detectedIdChanged = targetDetectedId !== currentId;
    const detectedSkuChanged = targetDetectedSku !== (current.detectedProduct?.sku || '');
    const activeSheetChanged = targetActiveSheetId !== current.activeSheetId;

    const dockChanged = targetDockVisible !== current.uiState.dockVisible;
    const canImportChanged = targetCanImport !== current.uiState.canImport;
    const feedbackChanged = Boolean(update.uiState?.actionFeedback) && (
      !current.uiState.actionFeedback ||
      current.uiState.actionFeedback.type !== targetFeedback?.type ||
      current.uiState.actionFeedback.message !== targetFeedback?.message
    );

    const identityChanged = platformChanged || pageTypeChanged || urlChanged || instanceChanged || detectedIdChanged;
    const quickViewUpdate = identityChanged
      ? { quickView: null, quickViewLoading: false, quickViewError: null }
      : {
          quickView: update.uiState?.quickView !== undefined ? update.uiState.quickView : current.uiState.quickView,
          quickViewLoading: update.uiState?.quickViewLoading ?? current.uiState.quickViewLoading,
          quickViewError: update.uiState?.quickViewError !== undefined ? update.uiState.quickViewError : current.uiState.quickViewError
        };
    const quickViewChanged = JSON.stringify(quickViewUpdate) !== JSON.stringify({
      quickView: current.uiState.quickView, quickViewLoading: current.uiState.quickViewLoading,
      quickViewError: current.uiState.quickViewError
    });
    const hasSemanticChange = (
      platformChanged ||
      pageTypeChanged ||
      urlChanged ||
      instanceChanged ||
      detectedIdChanged ||
      detectedSkuChanged ||
      activeSheetChanged ||
      dockChanged ||
      canImportChanged ||
      feedbackChanged || quickViewChanged ||
      (update.uiState?.isSimulatedMock !== undefined && update.uiState.isSimulatedMock !== current.uiState.isSimulatedMock)
    );

    if (!hasSemanticChange) {
      // Evento idêntico: se apenas vinculou pageInstanceId a uma aba que não tinha, registra sem incrementar revisão
      if (update.pageInstanceId && !current.pageInstanceId) {
        current.pageInstanceId = update.pageInstanceId;
        this.tabStates.set(tabId, current);
        await this.persistInOrder(tabId, () => setSessionItem(`${SESSION_KEY_PREFIX}${tabId}`, current));
      }
      return current;
    }

    // Mudança semântica confirmada: incrementa contextRevision como autoridade
    const nextRevision = current.contextRevision + 1;
    const mergedUiState: TabContextUiState = {
      ...current.uiState,
      ...(update.uiState || {}),
      ...quickViewUpdate,
      dockVisible: targetDockVisible,
      canImport: targetCanImport,
      actionFeedback: targetFeedback,
      isSimulatedMock: update.uiState?.isSimulatedMock !== undefined 
        ? update.uiState.isSimulatedMock 
        : current.uiState.isSimulatedMock
    };

    const updatedState: TabContextState = {
      ...current,
      ...update,
      tabId,
      contextRevision: nextRevision,
      pageInstanceId: update.pageInstanceId || current.pageInstanceId,
      platform: targetPlatform,
      pageType: targetPageType,
      url: targetUrl,
      detectedProduct: targetDetectedProduct,
      activeSheetId: targetActiveSheetId,
      uiState: mergedUiState,
      lastSyncedAt: new Date().toISOString()
    };

    if (targetActiveSheetId === undefined) {
      delete updatedState.activeSheetId;
    }

    this.tabStates.set(tabId, updatedState);
    await this.persistInOrder(tabId, () => setSessionItem(`${SESSION_KEY_PREFIX}${tabId}`, updatedState));

    return updatedState;
  }

  /** Synchronous authoritative snapshot; callers must hydrate before capturing it. */
  peekTabState(tabId: number): TabContextState | undefined { return this.tabStates.get(tabId); }

  /** Compare-and-set after hydration, before the synchronous in-memory update. */
  async updateQuickView(
    tabId: number, expectedRevision: number, uiState: Partial<TabContextUiState>,
    authIsCurrent: () => boolean
  ): Promise<TabContextState | undefined> {
    if (!this.isRehydrated) await this.rehydrate();
    const current = this.tabStates.get(tabId);
    if (!authIsCurrent() || !current || current.contextRevision !== expectedRevision) return undefined;
    return this.registerOrUpdateTab(tabId, { uiState });
  }

  async invalidateQuickViews(): Promise<TabContextState[]> {
    if (!this.isRehydrated) await this.rehydrate();
    return Promise.all([...this.tabStates.keys()].map(tabId => this.registerOrUpdateTab(tabId, {
      uiState: { quickView: null, quickViewLoading: false, quickViewError: null }
    })));
  }

  /**
   * Incrementa e retorna a contextRevision atual como autoridade.
   */
  async bumpRevision(tabId: number): Promise<number> {
    const current = await this.getTabState(tabId);
    if (!current) return 1;
    current.contextRevision += 1;
    current.lastSyncedAt = new Date().toISOString();
    this.tabStates.set(tabId, current);
    await this.persistInOrder(tabId, () => setSessionItem(`${SESSION_KEY_PREFIX}${tabId}`, current));
    return current.contextRevision;
  }

  /**
   * Associa uma Ficha Central (por ID) à aba ativa sem armazenar o objeto da ficha no session storage.
   */
  async linkSheetToTab(tabId: number, sheetId: string, importCommit?: {
    assertCurrent: () => TabContextState;
    uiState: Partial<TabContextUiState>;
    publish: (state: TabContextState) => void;
  }): Promise<TabContextState | undefined> {
    if (!importCommit) return this.registerOrUpdateTab(tabId, { activeSheetId: sheetId });
    return this.persistInOrder(tabId, async () => {
      const current = importCommit.assertCurrent();
      const next: TabContextState = { ...current, activeSheetId: sheetId,
        contextRevision: current.contextRevision + 1, lastSyncedAt: new Date().toISOString(),
        uiState: {...current.uiState, ...importCommit.uiState} };
      try {
        await setSessionItem(SESSION_KEY_PREFIX + tabId, next);
        importCommit.assertCurrent();
      } catch (error) {
        // A navigation/logout may have happened while storage was pending.
        // Repair disk without reverting the current in-memory context.
        const live = this.tabStates.get(tabId);
        if (live) await setSessionItem(SESSION_KEY_PREFIX + tabId, live);
        else await removeSessionItem(SESSION_KEY_PREFIX + tabId);
        throw error;
      }
      // No await between the last barrier, visibility of the link, and response.
      this.tabStates.set(tabId, next);
      importCommit.publish(next);
      return next;
    });
  }

  /**
   * Remove o estado da aba quando ela é fechada (chrome.tabs.onRemoved).
   */
  async removeTab(tabId: number): Promise<void> {
    this.tabStates.delete(tabId);
    await this.persistInOrder(tabId, () => removeSessionItem(`${SESSION_KEY_PREFIX}${tabId}`));
  }

  /**
   * Limpa todo o repositório (útil para testes unitários).
   */
  async clearAll(): Promise<void> {
    this.tabStates.clear();
    const keys = await getAllSessionKeys();
    for (const k of keys) {
      await removeSessionItem(k);
    }
    this.isRehydrated = true;
  }
}

export const tabContextManager = new TabContextManager();
