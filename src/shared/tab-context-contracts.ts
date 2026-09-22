// Contratos de Mensageria e Tipagem para Contexto por Aba (Fase 4B)

export type BlingPageType = 
  | 'product_list'        // /produtos
  | 'product_form_edit'   // /produtos/editar/:id ou com query id
  | 'product_form_new'    // /produtos/novo (sem ID de produto existente)
  | 'other';              // outras telas (pedidos, painel, etc.)

export type ContextualActionType = 'open_in_copilot' | 'prepare_mercadolivre';

import type { BlingProductQuickView } from './gateway-contracts.ts';

export interface TabContextUiState {
  dockVisible: boolean;
  canImport: boolean;           // false se for product_form_new sem ID
  isSimulatedMock: boolean;     // flag obrigatória de transparência (false quando conectado ao Gateway real)
  quickView?: BlingProductQuickView | null;
  quickViewLoading?: boolean;
  quickViewError?: string | null;
  actionFeedback?: {
    type: 'info' | 'success' | 'warning' | 'error' | 'loading' | 'auth_required';
    message: string;
  };
}


export interface TabContextState {
  tabId: number;
  pageInstanceId: string;
  contextRevision: number;           // Gerenciado exclusivamente pelo Background Worker
  platform: 'bling' | 'mercadolivre' | 'neutral';
  pageType: BlingPageType;
  url: string;
  detectedProduct?: {
    id?: string;                     // ID real comprovado na tela/URL
    sku?: string;                    // SKU obtido apenas como contexto de navegação
  };
  activeSheetId?: string;            // Referência leve à Ficha no storage.local (NUNCA armazena a CentralProductSheet diretamente)
  lastSyncedAt: string;
  uiState: TabContextUiState;
}

// ---------------------------------------------------------------------------
// Envelopes de Mensageria
// ---------------------------------------------------------------------------

export interface ContentToBackgroundEnvelope<T = unknown> {
  type: 
    | 'BLING_DOM_CONTEXT_DETECTED'
    | 'BLING_ACTION_TRIGGERED'
    | 'BLING_GET_QUICK_VIEW'
    | 'CONTENT_SCRIPT_PING';
  pageInstanceId: string;
  payload: T;
  clientTimestamp: string;
}

export interface BlingDomContextPayload {
  url: string;
  pageType: BlingPageType;
  detectedProduct?: {
    id?: string;
    sku?: string;
  };
}

export interface BlingActionTriggeredPayload {
  action: ContextualActionType;
  detectedProduct?: {
    id?: string;
    sku?: string;
  };
}

export interface BackgroundToContentEnvelope {
  type: 'APPLY_UI_STATE';
  contextRevision: number;           // Content Script descarta se contextRevision for menor que a mais recente
  pageType: BlingPageType;
  uiState: TabContextUiState;
  detectedProduct?: {
    id?: string;
    sku?: string;
  };
}

export interface TabContextSyncMessage {
  type: 'ACTIVE_TAB_CONTEXT_UPDATED';
  tabId: number;
  state: TabContextState;
}

export interface GetActiveTabContextRequest {
  type: 'GET_ACTIVE_TAB_CONTEXT';
  windowId?: number;
}

export interface LinkSheetToTabRequest {
  type: 'LINK_SHEET_TO_TAB';
  windowId?: number;
  tabId?: number;
  sheetId: string;
}

/**
 * Validador seguro para extrair o tabId confiável do MessageSender da plataforma.
 * Rejeita qualquer tentativa de injeção ou spoofing.
 */
export function extractVerifiedSenderTabId(
  sender: { tab?: { id?: number } } | undefined
): number | null {
  if (!sender || !sender.tab || typeof sender.tab.id !== 'number' || sender.tab.id < 0) {
    return null;
  }
  return sender.tab.id;
}

/**
 * Validador estrito de domínio para Bling ERP.
 * Evita que domínios arbitrários como 'evil-bling.com.br' sejam aceitos.
 */
export function isBlingDomain(urlOrHost: string): boolean {
  if (!urlOrHost || typeof urlOrHost !== 'string') return false;
  let hostname = urlOrHost.trim().toLowerCase();
  if (hostname.includes('://') || hostname.includes('/')) {
    try {
      const parsed = new URL(urlOrHost.includes('://') ? urlOrHost : `https://${urlOrHost}`);
      hostname = parsed.hostname.toLowerCase();
    } catch {
      return false;
    }
  }
  return hostname === 'bling.com.br' || hostname.endsWith('.bling.com.br');
}

/**
 * Validador restritivo de formato de identificador de produto Bling.
 * Permite apenas alfanuméricos, sublinhados e hífens, rejeitando HTML, scripts e caracteres especiais.
 */
export function isValidProductId(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(trimmed);
}
