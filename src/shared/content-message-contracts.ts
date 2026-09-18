// Contratos de Mensageria e Comunicação entre Content Scripts, Background e Sidepanel

/**
 * Ações de mensagem suportadas ou planejadas entre os componentes da extensão.
 */
export type ContentMessageAction =
  | 'BLING_PAGE_CONTEXT_DETECTED'
  | 'BLING_PRODUCT_DATA_EXTRACTED'
  | 'REQUEST_BLING_PRODUCT_IMPORT'
  | 'RESPONSE_BLING_PRODUCT_IMPORT';

/**
 * Envelope base de mensagens transmitidas por content scripts.
 * 
 * ⚠️ REGRA DE SEGURANÇA E ARQUITETURA:
 * O content script NUNCA deve incluir ou ser tratado como fonte confiável de `tabId`.
 * Qualquer componente receptor no background worker DEVE derivar a aba de origem
 * estritamente através do identificador confiável da plataforma: `sender.tab.id`.
 */
export interface ContentScriptMessageEnvelope<T = unknown> {
  action: ContentMessageAction;
  payload: T;
  timestamp: string;
}

export interface BlingPageContextPayload {
  url: string;
  pageType: 'product_list' | 'product_form' | 'other';
  detectedProductId?: string;
  detectedSku?: string;
}

export interface BlingProductExtractPayload {
  externalId: string;
  rawProductData: unknown;
  extractedAt: string;
}

/**
 * Função utilitária que valida e extrai com segurança o tabId a partir do MessageSender oficial do Chrome.
 * Rejeita qualquer tentativa de spoofing ou injeção de tabId pelo payload do content script.
 */
export function extractVerifiedSenderTabId(
  sender: { tab?: { id?: number } } | undefined
): number | null {
  if (!sender || !sender.tab || typeof sender.tab.id !== 'number' || sender.tab.id < 0) {
    return null;
  }
  return sender.tab.id;
}
