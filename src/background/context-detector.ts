import { PageContextState } from '../shared/types';

export function detectPageContext(url?: string, title: string = '', tabId?: number): PageContextState {
  const now = new Date().toISOString();

  if (!url) {
    return {
      platform: 'neutral',
      contextType: 'neutral_standby',
      title: 'Pronto para navegar',
      url: '',
      tabId,
      detectedAt: now,
      summaryLabel: 'Standby'
    };
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    // 1. Mercado Livre
    if (host.includes('mercadolivre.com.br') || host.includes('mercadolibre.com')) {
      if (path.includes('/publicar') || path.includes('/anuncios/novo')) {
        return {
          platform: 'mercadolivre',
          contextType: 'ml_publish',
          title: title || 'Publicação de Anúncio',
          url,
          tabId,
          detectedAt: now,
          summaryLabel: 'Mercado Livre • Publicação de Anúncio'
        };
      }

      if (path.includes('/anuncios/lista') || path.includes('/anuncios')) {
        return {
          platform: 'mercadolivre',
          contextType: 'ml_seller_panel',
          title: title || 'Painel de Anúncios',
          url,
          tabId,
          detectedAt: now,
          summaryLabel: 'Mercado Livre • Painel de Anúncios'
        };
      }

      if (path.startsWith('/p/mlb') || path.startsWith('/p/')) {
        return {
          platform: 'mercadolivre',
          contextType: 'ml_catalog',
          title: title || 'Produto de Catálogo',
          url,
          tabId,
          detectedAt: now,
          summaryLabel: 'Mercado Livre • Catálogo'
        };
      }

      if (path.includes('mlb-') || host.startsWith('produto.')) {
        return {
          platform: 'mercadolivre',
          contextType: 'ml_pdp',
          title: title || 'Página de Produto',
          url,
          tabId,
          detectedAt: now,
          summaryLabel: 'Mercado Livre • Anúncio / Produto'
        };
      }

      if (path.includes('/lista') || host.startsWith('lista.') || parsed.searchParams.has('as_word')) {
        return {
          platform: 'mercadolivre',
          contextType: 'ml_search',
          title: title || 'Pesquisa de Mercado',
          url,
          tabId,
          detectedAt: now,
          summaryLabel: 'Mercado Livre • Pesquisa de Produtos'
        };
      }

      return {
        platform: 'mercadolivre',
        contextType: 'ml_pdp',
        title: title || 'Mercado Livre',
        url,
        tabId,
        detectedAt: now,
        summaryLabel: 'Mercado Livre'
      };
    }

    // 2. Bling ERP
    if (host === 'bling.com.br' || host.endsWith('.bling.com.br')) {
      if (path.includes('/produtos/novo') || path.includes('/produtos/editar')) {
        return {
          platform: 'bling',
          contextType: 'bling_product_form',
          title: title || 'Cadastro de Produto',
          url,
          tabId,
          detectedAt: now,
          summaryLabel: 'Bling ERP • Cadastro de Produto'
        };
      }

      if (path.includes('/produtos')) {
        return {
          platform: 'bling',
          contextType: 'bling_product_list',
          title: title || 'Lista de Produtos',
          url,
          tabId,
          detectedAt: now,
          summaryLabel: 'Bling ERP • Lista de Produtos'
        };
      }

      return {
        platform: 'bling',
        contextType: 'bling_general',
        title: title || 'Bling ERP',
        url,
        tabId,
        detectedAt: now,
        summaryLabel: 'Bling ERP'
      };
    }
  } catch (err) {
    // URL inválida ou especial (chrome://, about:blank)
  }

  // 3. Neutro
  return {
    platform: 'neutral',
    contextType: 'neutral_standby',
    title: title || 'Navegação Externa',
    url,
    tabId,
    detectedAt: now,
    summaryLabel: 'Navegação Neutra'
  };
}
