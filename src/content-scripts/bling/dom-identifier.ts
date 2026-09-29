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
    const rawHash = parsed.hash;
    const hash = rawHash.toLowerCase();

    // 1. Novo Produto (sem ID de produto existente)
    const rawQueryId = parsed.searchParams.get('id') || parsed.searchParams.get('idProduto');
    if (
      pathname.includes('/produtos/novo') || 
      pathname.endsWith('/produto/novo') || 
      /\/produtos?\/(?:editar|alterar|view)\/0(?:\/|$)/i.test(rawPathname) ||
      ((pathname.includes('/produto') || pathname.includes('/cadastros')) && (
        /^#(?:add|new|novo|incluir|cadastro)(?:\/|$)/i.test(rawHash) ||
        /^#(?:edit|editar|alterar|view)\/0(?:\/|$)/i.test(rawHash) ||
        rawQueryId?.trim() === '0'
      )) ||
      parsed.searchParams.get('action') === 'novo'
    ) {
      return { pageType: 'product_form_new' };
    }

    // 2. Edição de Produto via rota moderna ou hash legado atual do Bling:
    //    /produtos/editar/123456 ou /produtos.php#edit/123456
    const editPathMatch = rawPathname.match(/\/produtos?\/(?:editar|alterar|view)\/([a-zA-Z0-9_-]{1,64})/i);
    if (editPathMatch && editPathMatch[1] && editPathMatch[1] !== '0' && isValidProductId(editPathMatch[1])) {
      return {
        pageType: 'product_form_edit',
        detectedId: editPathMatch[1]
      };
    }

    const editHashMatch = rawHash.match(/^#(?:edit|editar|alterar|view)\/([a-zA-Z0-9_-]{1,64})(?:\/|$)/i);
    if ((pathname.includes('/produto') || pathname.includes('/cadastros')) && editHashMatch?.[1] && editHashMatch[1] !== '0' && isValidProductId(editHashMatch[1])) {
      return {
        pageType: 'product_form_edit',
        detectedId: editHashMatch[1]
      };
    }

    // 3. Edição de Produto via Query String: ?id=123456 ou ?idProduto=123456
    if (rawQueryId && rawQueryId.trim() !== '0' && isValidProductId(rawQueryId) && (pathname.includes('/produto') || pathname.includes('/cadastros'))) {
      return {
        pageType: 'product_form_edit',
        detectedId: rawQueryId.trim()
      };
    }

    // Se houver hash de edição ou query id/idProduto mas o ID for inválido (ex: tentativa de XSS), rejeita como 'other'
    if (
      /^#(?:edit|editar|alterar|view)\//i.test(rawHash) ||
      parsed.searchParams.has('id') ||
      parsed.searchParams.has('idProduto')
    ) {
      return { pageType: 'other' };
    }

    // 4. Listagem de Produtos (qualquer hash de listagem/filtro/paginação em produtos.php ou /produtos)
    if (
      pathname === '/produtos' || 
      pathname === '/produtos/' || 
      pathname.startsWith('/produtos/lista') ||
      pathname.includes('/produtos.php') ||
      pathname.includes('/cadastros.produtos.php') ||
      ((pathname.includes('/produto') || pathname.includes('/cadastros')) && (!hash || hash.startsWith('#list') || hash === '#' || hash === '#todos'))
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

  let effectivePageType: BlingPageType = urlClassification.pageType;
  let finalId = urlClassification.detectedId;
  let visualSku: string | undefined;

  // Se doc estiver disponível e não houver ID na URL, verifica se existe input hidden/data-id de contexto
  if (doc && typeof doc.querySelector === 'function') {
    try {
      const idInput = doc.querySelector('input[name="id"], input#id, [data-product-id]');
      const domIdVal = idInput ? (idInput.value || idInput.getAttribute?.('data-product-id')) : undefined;
      const validDomId = (domIdVal && isValidProductId(String(domIdVal)) && String(domIdVal).trim() !== '0')
        ? String(domIdVal).trim()
        : undefined;

      if (!finalId && effectivePageType === 'product_form_edit' && validDomId) {
        finalId = validDomId;
      }

      // Se a URL for de listagem (ex: produtos.php sem hash #add), mas o formulário de cadastro
      // estiver visível no DOM, promove o contexto para formulário (novo ou edição)
      if (effectivePageType === 'product_list') {
        const formInput = doc.querySelector('input#nome, input[name="nome"], input#gtin, input[name="gtin"], input#ean, input[name="ean"]');
        const isFormVisible = Boolean(
          formInput && (
            typeof formInput.getClientRects !== 'function'
              ? false
              : formInput.getClientRects().length > 0
          )
        );
        if (isFormVisible) {
          if (validDomId) {
            effectivePageType = 'product_form_edit';
            finalId = validDomId;
          } else {
            effectivePageType = 'product_form_new';
          }
        }
      }

      // SKU visual apenas como contexto de navegação (nunca fato canônico)
      const skuInput = doc.querySelector('input[name="codigo"], input#codigo, [data-product-sku]');
      if (skuInput) {
        const skuVal = skuInput.value || skuInput.getAttribute?.('data-product-sku');
        if (skuVal && String(skuVal).trim().length > 0 && String(skuVal).trim().length <= 100) {
          visualSku = String(skuVal).trim();
        }
      }
    } catch {
      // Ignora falhas de inspeção em DOM restrito
    }
  }

  // Se o tipo for product_form_new, garante que nenhum ID seja forjado
  if (effectivePageType === 'product_form_new') {
    return {
      pageType: 'product_form_new',
      detectedProduct: visualSku ? { sku: visualSku } : undefined
    };
  }

  const detectedProduct = (finalId || visualSku)
    ? { id: finalId, sku: visualSku }
    : undefined;

  return {
    pageType: effectivePageType,
    detectedProduct
  };
}
