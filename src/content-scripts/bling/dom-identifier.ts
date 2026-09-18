import type { BlingPageType } from '../../shared/tab-context-contracts.ts';
import { isBlingDomain, isValidProductId } from '../../shared/tab-context-contracts.ts';

export { isBlingDomain, isValidProductId };

export interface BlingScreenContextResult {
  pageType: BlingPageType;
  detectedProduct?: {
    id?: string;
    sku?: string;
  };
}

/**
 * Classifica a URL do Bling extraindo com prioridade o ID comprovado na rota/query.
 * 
 * Regra de Ouro:
 * - O domínio DEVE ser bling.com.br ou subdomínio terminado em .bling.com.br.
 * - Sempre preferir ID confiável extraído da URL/rota quando existir.
 * - Identificadores devem atender ao formato restritivo (alfanumérico, sem caracteres especiais).
 * - Em "/produtos/novo", nunca inventar ID (retorna product_form_new sem ID).
 */
export function classifyBlingUrl(urlStr: string): { pageType: BlingPageType; detectedId?: string } {
  if (!urlStr || typeof urlStr !== 'string') {
    return { pageType: 'other' };
  }

  // Validação estrita de domínio (Requisito 6)
  if (!isBlingDomain(urlStr)) {
    return { pageType: 'other' };
  }

  try {
    const parsed = new URL(urlStr);
    const rawPathname = parsed.pathname;
    const pathname = rawPathname.toLowerCase();

    // 1. Novo Produto (sem ID de produto existente)
    if (
      pathname.includes('/produtos/novo') || 
      pathname.endsWith('/produto/novo') || 
      parsed.searchParams.get('action') === 'novo'
    ) {
      return { pageType: 'product_form_new' };
    }

    // 2. Edição de Produto via Rota: /produtos/editar/123456 ou /produtos/123456
    const editPathMatch = rawPathname.match(/\/produtos?\/(?:editar|alterar|view)\/([a-zA-Z0-9_-]{1,64})/i);
    if (editPathMatch && editPathMatch[1] && isValidProductId(editPathMatch[1])) {
      return {
        pageType: 'product_form_edit',
        detectedId: editPathMatch[1]
      };
    }

    // 3. Edição de Produto via Query String: ?id=123456 ou ?idProduto=123456
    const rawQueryId = parsed.searchParams.get('id') || parsed.searchParams.get('idProduto');
    if (rawQueryId && isValidProductId(rawQueryId) && (pathname.includes('/produto') || pathname.includes('/cadastros'))) {
      return {
        pageType: 'product_form_edit',
        detectedId: rawQueryId.trim()
      };
    }

    // 4. Listagem de Produtos
    if (
      pathname === '/produtos' || 
      pathname === '/produtos/' || 
      pathname.startsWith('/produtos/lista') ||
      pathname.includes('/produtos.php')
    ) {
      return { pageType: 'product_list' };
    }

    return { pageType: 'other' };
  } catch {
    return { pageType: 'other' };
  }
}

/**
 * Detecta o contexto de tela do Bling combinando URL e inspeção superficial de DOM.
 * 
 * ⚠️ REGRA DE CONTEXTO DE NAVEGAÇÃO:
 * Identificadores obtidos do DOM são tratados SOMENTE como contexto de navegação.
 * Sempre preferir o ID confiável da URL. Não transformar texto/SKU visual do DOM em fato canônico.
 */
export function detectBlingScreenContext(
  urlStr: string,
  doc?: { querySelector: (selector: string) => any }
): BlingScreenContextResult {
  const urlClassification = classifyBlingUrl(urlStr);

  if (urlClassification.pageType === 'other') {
    return { pageType: 'other' };
  }

  let finalId = urlClassification.detectedId;
  let visualSku: string | undefined;

  // Se doc estiver disponível e não houver ID na URL, verifica se existe input hidden/data-id de contexto
  if (doc && typeof doc.querySelector === 'function') {
    try {
      if (!finalId && urlClassification.pageType === 'product_form_edit') {
        const idInput = doc.querySelector('input[name="id"], input#id, [data-product-id]');
        if (idInput) {
          const domVal = idInput.value || idInput.getAttribute('data-product-id');
          if (domVal && isValidProductId(String(domVal)) && String(domVal) !== '0') {
            finalId = String(domVal).trim();
          }
        }
      }

      // SKU visual apenas como contexto de navegação (nunca fato canônico)
      const skuInput = doc.querySelector('input[name="codigo"], input#codigo, [data-product-sku]');
      if (skuInput) {
        const skuVal = skuInput.value || skuInput.getAttribute('data-product-sku');
        if (skuVal && String(skuVal).trim().length > 0 && String(skuVal).trim().length <= 100) {
          visualSku = String(skuVal).trim();
        }
      }
    } catch {
      // Ignora falhas de inspeção em DOM restrito
    }
  }

  // Se o tipo for product_form_new, garante que nenhum ID seja forjado
  if (urlClassification.pageType === 'product_form_new') {
    return {
      pageType: 'product_form_new',
      detectedProduct: visualSku ? { sku: visualSku } : undefined
    };
  }

  const detectedProduct = (finalId || visualSku)
    ? { id: finalId, sku: visualSku }
    : undefined;

  return {
    pageType: urlClassification.pageType,
    detectedProduct
  };
}
