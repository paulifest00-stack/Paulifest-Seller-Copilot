export type MarketplacePlatform = 'mercadolivre' | 'bling' | 'neutral';

export type PageContextType = 
  | 'ml_search'          // Busca no Mercado Livre (/lista/, /search/)
  | 'ml_pdp'             // Página de Produto / Concorrente (MLB-...)
  | 'ml_catalog'         // Catálogo (/p/MLB...)
  | 'ml_publish'         // Tela de Publicar Anúncio (/publicar)
  | 'ml_seller_panel'    // Painel do Seller (/anuncios/lista)
  | 'bling_product_list' // Lista de Produtos Bling (/produtos)
  | 'bling_product_form' // Cadastro ou Edição (/produtos/novo, /produtos/editar)
  | 'bling_general'      // Telas gerais do Bling
  | 'neutral_standby';   // Outros sites ou nova guia

export interface PageContextState {
  platform: MarketplacePlatform;
  contextType: PageContextType;
  title: string;
  url: string;
  tabId?: number;
  detectedAt: string;
  summaryLabel: string;
}

export type ExtensionMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'CONTEXT_UPDATED'; payload: PageContextState }
  | { type: 'START_NEW_PRODUCT' };
