import { createCostEditor, saveInlineCost } from './cost-editor.ts';
// Injetor Dinâmico de Coluna de Preço de Custo na Listagem de Produtos do Bling ERP (produtos.php)
import { isValidProductId } from '../../shared/tab-context-contracts.ts';
import type { ContentToBackgroundEnvelope, BlingGetProductsCostListPayload, BlingGetProductsCostListResponse } from '../../shared/tab-context-contracts.ts';

const HEADER_ID = 'paulifest-cost-header';
const CELL_CLASS = 'paulifest-cost-td';
const INLINE_PILL_CLASS = 'paulifest-cost-inline-pill';

/**
 * Extrai o ID do produto de uma linha <tr> da tabela do Bling usando múltiplas estratégias.
 */
export function extractProductIdFromRow(row: HTMLElement): string | null {
  if (!row || typeof row.getAttribute !== 'function') return null;

  // 1. Atributos diretos no <tr> (ex: data-id="123", data-id-produto="123")
  const directId = row.getAttribute('data-id') || 
                   row.getAttribute('data-id-produto') || 
                   row.getAttribute('data-product-id');
  if (directId && isValidProductId(directId)) {
    return directId.trim();
  }

  // 2. ID do elemento <tr> (ex: id="item-16709078436" ou id="produto_16709078436")
  if (row.id) {
    const idMatch = row.id.match(/(?:item|produto|row|prod|linha)[-_](\d+)/i) || 
                    row.id.match(/^(\d{5,20})$/);
    if (idMatch?.[1] && isValidProductId(idMatch[1])) {
      return idMatch[1].trim();
    }
  }

  // 3. Checkbox de seleção na primeira coluna (padrão clássico do Bling: name="idProduto[]" ou name="ids[]")
  const checkbox = row.querySelector<HTMLInputElement>(
    'input[type="checkbox"][name*="id" i], input[type="checkbox"][name*="prod" i], input[type="checkbox"][value]'
  );
  if (checkbox?.value && isValidProductId(checkbox.value) && checkbox.value !== 'on' && checkbox.value !== '1') {
    return checkbox.value.trim();
  }

  // 4. Links de navegação ou edição dentro da linha (ex: produtos.php#edit/16709078436 ou /produtos/editar/123)
  const editLink = row.querySelector<HTMLAnchorElement>(
    'a[href*="#edit/"], a[href*="#editar/"], a[href*="/editar/"], a[href*="/produtos/"], a[href*="id="], a[href*="idProduto="]'
  );
  if (editLink?.href) {
    const hashMatch = editLink.href.match(/#(?:edit|editar|alterar|view)\/([a-zA-Z0-9_-]{1,64})/i);
    if (hashMatch?.[1] && isValidProductId(hashMatch[1])) {
      return hashMatch[1].trim();
    }

    const pathMatch = editLink.href.match(/\/produtos?\/(?:editar|alterar)\/([a-zA-Z0-9_-]{1,64})/i);
    if (pathMatch?.[1] && isValidProductId(pathMatch[1])) {
      return pathMatch[1].trim();
    }

    const queryMatch = editLink.href.match(/[?&](?:id|idProduto)=(\d+)/i);
    if (queryMatch?.[1] && isValidProductId(queryMatch[1])) {
      return queryMatch[1].trim();
    }
  }

  // 5. Elementos filhos com data-id (botões de ação, menus de contexto)
  const childWithId = row.querySelector('[data-id], [data-id-produto], [data-product-id], [data-row-id], [data-item-id]');
  if (childWithId) {
    const childId = childWithId.getAttribute('data-id') || 
                    childWithId.getAttribute('data-id-produto') || 
                    childWithId.getAttribute('data-product-id') ||
                    childWithId.getAttribute('data-row-id') ||
                    childWithId.getAttribute('data-item-id');
    if (childId && isValidProductId(childId)) {
      return childId.trim();
    }
  }

  // 6. Propriedades internas de frameworks (Vue / React / jQuery data) na linha <tr>
  try {
    const anyRow = row as any;
    const candidates = [
      anyRow.__vue__?.item?.id,
      anyRow.__vue__?.produto?.id,
      anyRow.__vue__?.row?.id,
      anyRow.__vnode?.props?.['data-id'],
      anyRow.__vnode?.key,
      anyRow._vnode?.key
    ];
    for (const key of Object.keys(anyRow)) {
      if (key.startsWith('__reactProps$') || key.startsWith('__reactFiber$')) {
        const fiber = anyRow[key];
        candidates.push(fiber?.return?.memoizedProps?.row?.id, fiber?.return?.key, fiber?.memoizedProps?.['data-id']);
      }
    }
    for (const cand of candidates) {
      if (cand != null && isValidProductId(String(cand)) && /^\d{5,20}$/.test(String(cand).trim())) {
        return String(cand).trim();
      }
    }
  } catch {}

  return null;
}

function parseCellBrlNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[R$\s]/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.includes('⏳')) return null;
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const num = Number(normalized);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) / 100 : null;
}

function extractCleanCellText(cell: Element | undefined | null): string {
  if (!cell) return '';
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button, svg, script, style, .paulifest-cost-editor').forEach(el => el.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Encontra a tabela principal de produtos na página.
 */
export function findProductTable(root: Document | HTMLElement = document): HTMLTableElement | null {
  const candidates = root.querySelectorAll<HTMLTableElement>(
    'table#datatable, table.table-list, table[data-table], #list-table, table.table, .datatable table, table'
  );

  for (let i = 0; i < candidates.length; i++) {
    const tbl = candidates[i];
    const rows = tbl.querySelectorAll('tbody tr, tr');
    let hasProductRows = false;
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      if (extractProductIdFromRow(rows[r] as HTMLElement)) {
        hasProductRows = true;
        break;
      }
    }
    if (hasProductRows) {
      return tbl;
    }
  }

  // Fallback para a listagem moderna do Bling (onde as linhas <tr> possuem Descrição/Código/Preço mas não expõem data-id inicialmente)
  for (let i = 0; i < candidates.length; i++) {
    const tbl = candidates[i];
    const headerRow = tbl.querySelector('thead tr') || tbl.querySelector('tr');
    if (!headerRow) continue;
    const headerTexts = Array.from(headerRow.children).map(th => (th.textContent || '').toLowerCase());
    const hasDesc = headerTexts.some(t => t.includes('descri'));
    const hasCodeOrPrice = headerTexts.some(t => t.includes('código') || t.includes('codigo') || t.includes('preço') || t.includes('preco') || t.includes('custo'));
    const bodyRows = tbl.querySelectorAll('tbody tr');
    if (hasDesc && hasCodeOrPrice && bodyRows.length > 0) {
      return tbl;
    }
  }

  return null;
}

/**
 * Formata um valor de custo numérico para moeda brasileira ou hífen.
 */
export function formatCostValue(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return '-';
  if (cost === 0) return 'R$ 0,00';
  return `R$ ${cost.toFixed(2).replace('.', ',')}`;
}

export interface InjectionResult {
  injectedCount: number;
  productIds: string[];
}

export class ProductListCostInjector {
  private pageInstanceId: string;
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private knownCosts = new Map<string, number | null>();
  private costRevisions = new Map<string, number>();
  private pendingIds = new Set<string>();
  private skuToProductId = new Map<string, string>();
  private nameToProductId = new Map<string, string>();
  private catalogPreloadPromise: Promise<void> | null = null;
  private isDestroyed = false;

  constructor(pageInstanceId: string) {
    this.pageInstanceId = pageInstanceId;
  }

  /**
   * Inicia o monitoramento da tabela e injeção de custos.
   */
  start(): void {
    if (this.observer) return;
    this.isDestroyed = false;
    this.scanAndInject();

    // Observa mudanças de paginação AJAX ou filtros no DOM do Bling
    this.observer = new MutationObserver(() => {
      if (this.isDestroyed) return;
      if (this.debounceTimer !== null) {
        window.clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => {
        this.scanAndInject();
      }, 250);
    });

    const targetNode = document.getElementById('content') || 
                       document.getElementById('main') || 
                       document.body;

    if (targetNode) {
      this.observer.observe(targetNode, {
        childList: true,
        subtree: true
      });
    }
  }

  /**
   * Encerra observadores.
   */
  destroy(): void {
    this.isDestroyed = true;
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.pendingIds.clear();
    this.knownCosts.clear();
  }

  /**
   * Realiza a varredura da tabela, inserção/reuso da coluna Preço de Custo e ativação da edição inline.
   */
  scanAndInject(): InjectionResult {
    const table = findProductTable();
    if (!table) {
      return { injectedCount: 0, productIds: [] };
    }

    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) {
      return { injectedCount: 0, productIds: [] };
    }

    const ths = Array.from(headerRow.children) as HTMLElement[];
    let descColIndex = -1;
    let skuColIndex = -1;
    let nativeCostColIndex = -1;

    for (let i = 0; i < ths.length; i++) {
      const text = (ths[i].textContent || '').trim().toLowerCase();
      if (descColIndex === -1 && text.includes('descri')) descColIndex = i;
      if (skuColIndex === -1 && (text.includes('código') || text.includes('codigo') || text === 'sku')) skuColIndex = i;
      if (ths[i].id === HEADER_ID || text.includes('custo')) {
        nativeCostColIndex = i;
      }
    }

    let targetColIndex = -1;
    let reusedNativeColumn = false;

    if (nativeCostColIndex >= 0) {
      targetColIndex = nativeCostColIndex;
      reusedNativeColumn = !ths[nativeCostColIndex].classList.contains('paulifest-cost-th');
      ths[nativeCostColIndex].id = HEADER_ID;
    } else {
      let insertBeforeCol = ths.length > 1 ? ths.length - 1 : ths.length;
      let refTh: HTMLElement | null = null;
      for (let i = 0; i < ths.length; i++) {
        const text = (ths[i].textContent || '').toLowerCase();
        if (text.includes('preço') || text.includes('preco') || text.includes('valor')) {
          insertBeforeCol = i + 1;
          refTh = ths[i];
          break;
        } else if (text.includes('estoque') || text.includes('saldo')) {
          insertBeforeCol = i + 1;
          if (!refTh) refTh = ths[i];
        }
      }

      const th = document.createElement('th');
      th.id = HEADER_ID;
      th.className = refTh?.className ? `${refTh.className} paulifest-cost-th` : 'paulifest-cost-th';
      th.style.textAlign = 'right';
      th.style.whiteSpace = 'nowrap';
      th.style.userSelect = 'none';
      if (refTh && typeof window.getComputedStyle === 'function') {
        const cs = window.getComputedStyle(refTh);
        th.style.padding = cs.padding || '8px 12px';
        th.style.fontFamily = cs.fontFamily || 'inherit';
        th.style.fontSize = cs.fontSize || '12px';
        th.style.fontWeight = cs.fontWeight || '600';
        th.style.color = cs.color || 'inherit';
      } else {
        th.style.padding = '8px 12px';
        th.style.fontWeight = '600';
        th.style.fontSize = '12px';
      }
      th.textContent = 'Preço de Custo';

      if (insertBeforeCol < ths.length) {
        headerRow.insertBefore(th, ths[insertBeforeCol]);
        targetColIndex = insertBeforeCol;
      } else {
        headerRow.appendChild(th);
        targetColIndex = ths.length;
      }
    }

    const bodyRows = table.querySelectorAll('tbody tr');
    const rowsToProcess = bodyRows.length > 0 ? Array.from(bodyRows) : Array.from(table.querySelectorAll('tr')).slice(1);

    const idsNeedingCost: string[] = [];
    let injectedCount = 0;
    let needsCatalogPreload = false;

    for (let rowIndex = 0; rowIndex < rowsToProcess.length; rowIndex++) {
      const htmlRow = rowsToProcess[rowIndex] as HTMLElement;
      const rowSku = skuColIndex >= 0 ? extractCleanCellText(htmlRow.children[skuColIndex]) : '';
      const rowName = descColIndex >= 0 ? extractCleanCellText(htmlRow.children[descColIndex]) : '';

      let productId = extractProductIdFromRow(htmlRow);
      if (!productId && rowSku && this.skuToProductId.has(rowSku.toUpperCase())) {
        productId = this.skuToProductId.get(rowSku.toUpperCase()) || null;
        if (productId) htmlRow.setAttribute('data-product-id', productId);
      }
      if (!productId && rowName && this.nameToProductId.has(rowName.toUpperCase())) {
        productId = this.nameToProductId.get(rowName.toUpperCase()) || null;
        if (productId) htmlRow.setAttribute('data-product-id', productId);
      }

      if (!productId && !rowSku && !rowName) {
        if (!reusedNativeColumn && targetColIndex >= 0 && !htmlRow.querySelector(`.${CELL_CLASS}`)) {
          const emptyTd = document.createElement('td');
          emptyTd.className = CELL_CLASS;
          if (targetColIndex < htmlRow.children.length) {
            htmlRow.insertBefore(emptyTd, htmlRow.children[targetColIndex]);
          } else {
            htmlRow.appendChild(emptyTd);
          }
        }
        continue;
      }

      if (!productId) {
        needsCatalogPreload = true;
      }

      const rowKey = productId || (rowSku ? `sku:${rowSku.toUpperCase()}` : `name:${rowName.toUpperCase()}`);

      let td = htmlRow.querySelector<HTMLTableCellElement>(`.${CELL_CLASS}`);
      if (!td && reusedNativeColumn && targetColIndex >= 0 && targetColIndex < htmlRow.children.length) {
        td = htmlRow.children[targetColIndex] as HTMLTableCellElement;
        td.classList.add(CELL_CLASS);
        const initialCellCost = parseCellBrlNumber(extractCleanCellText(td));
        if (initialCellCost !== null && !this.knownCosts.has(rowKey)) {
          this.knownCosts.set(rowKey, initialCellCost);
          if (productId) this.knownCosts.set(productId, initialCellCost);
        }
        // Limpa o texto estático original para substituir pelo editor inline idêntico ao Preço de venda
        td.textContent = '';
        const span = document.createElement('span');
        span.className = 'paulifest-cost-text';
        span.style.display = 'none';
        this.applyCostToElement(span, this.knownCosts.get(productId || rowKey) ?? initialCellCost);
        td.appendChild(span);
        injectedCount++;
      } else if (!td) {
        td = document.createElement('td');
        td.className = CELL_CLASS;
        td.style.textAlign = 'right';
        td.style.whiteSpace = 'nowrap';
        td.style.verticalAlign = 'middle';

        const refCell = (targetColIndex > 0 ? htmlRow.children[targetColIndex - 1] : htmlRow.children[0]) as HTMLElement | undefined;
        if (refCell && typeof window.getComputedStyle === 'function') {
          const cs = window.getComputedStyle(refCell);
          td.style.padding = cs.padding || '8px 12px';
          td.style.fontFamily = cs.fontFamily || 'inherit';
          td.style.fontSize = cs.fontSize || '12px';
        } else {
          td.style.padding = '8px 12px';
          td.style.fontSize = '12px';
        }

        const span = document.createElement('span');
        span.className = 'paulifest-cost-text';
        span.style.display = 'none';

        if (productId && this.knownCosts.has(productId)) {
          this.applyCostToElement(span, this.knownCosts.get(productId));
        } else if (this.knownCosts.has(rowKey)) {
          this.applyCostToElement(span, this.knownCosts.get(rowKey));
        } else {
          span.textContent = '⏳ ...';
          span.style.color = '#94a3b8';
          if (productId) idsNeedingCost.push(productId);
        }

        td.appendChild(span);

        if (targetColIndex >= 0 && targetColIndex < htmlRow.children.length) {
          htmlRow.insertBefore(td, htmlRow.children[targetColIndex]);
        } else {
          htmlRow.appendChild(td);
        }
        injectedCount++;
      } else {
        if (productId && this.knownCosts.has(productId)) {
          const span = td.querySelector<HTMLElement>('.paulifest-cost-text');
          if (span) this.applyCostToElement(span, this.knownCosts.get(productId));
          const editor = td.querySelector('.paulifest-cost-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
          editor?.refreshDisplay?.();
        } else if (productId && !this.pendingIds.has(productId) && !this.knownCosts.has(rowKey)) {
          idsNeedingCost.push(productId);
        }
      }

      if (td) {
        if (productId) td.setAttribute('data-product-id', productId);
        this.mountCostEditor(td, htmlRow, rowKey, rowSku, rowName);
      }
    }

    if (needsCatalogPreload) {
      void this.preloadCatalogIds();
    }

    if (idsNeedingCost.length > 0) {
      this.fetchCostsForProducts(idsNeedingCost);
    }

    return {
      injectedCount,
      productIds: Array.from(new Set(idsNeedingCost))
    };
  }

  private mountCostEditor(td: HTMLElement, htmlRow: HTMLElement, rowKey: string, rowSku: string, rowName: string): void {
    const existing = td.querySelector('.paulifest-cost-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
    if (existing) {
      existing.refreshDisplay?.();
      return;
    }
    const textSpan = td.querySelector<HTMLElement>('.paulifest-cost-text');
    if (textSpan) textSpan.style.display = 'none';
    td.append(createCostEditor({
      getCost: () => {
        const pid = extractProductIdFromRow(htmlRow);
        if (pid && this.knownCosts.has(pid)) return this.knownCosts.get(pid) ?? null;
        return this.knownCosts.get(rowKey) ?? null;
      },
      isCurrent: () => !this.isDestroyed && htmlRow.isConnected,
      save: async (value, expected) => {
        const pid = await this.resolveProductIdForRow(htmlRow, rowSku, rowName);
        if (!pid) {
          return { ok: false, error: 'Não foi possível identificar o ID deste produto no Bling.' };
        }
        htmlRow.setAttribute('data-product-id', pid);
        td.setAttribute('data-product-id', pid);
        return saveInlineCost(this.pageInstanceId, pid, value, expected);
      },
      onSaved: value => {
        const pid = extractProductIdFromRow(htmlRow);
        if (pid) {
          this.costRevisions.set(pid, (this.costRevisions.get(pid) || 0) + 1);
          this.knownCosts.set(pid, value);
        }
        this.knownCosts.set(rowKey, value);
        const text = td.querySelector<HTMLElement>('.paulifest-cost-text');
        if (text) this.applyCostToElement(text, value);
        const ed = td.querySelector('.paulifest-cost-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
        ed?.refreshDisplay?.();
      }
    }));
  }

  private async preloadCatalogIds(): Promise<void> {
    if (this.catalogPreloadPromise) return this.catalogPreloadPromise;
    this.catalogPreloadPromise = (async () => {
      try {
        if (typeof location !== 'undefined' && /(?:^|\.)bling\.com\.br$/i.test(location.hostname)) {
          for (const url of ['/Api/v3/produtos?limite=100&criterio=5', '/Api/v3/produtos?limite=100']) {
            try {
              const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
              if (r.ok) {
                const j = await r.json();
                for (const item of (j?.data || [])) {
                  if (item?.id != null) {
                    const idStr = String(item.id).trim();
                    const sku = String(item.codigo || '').trim().toUpperCase();
                    const name = String(item.nome || '').trim().toUpperCase();
                    if (sku) this.skuToProductId.set(sku, idStr);
                    if (name) this.nameToProductId.set(name, idStr);
                    const rawCost = item?.fornecedor?.precoCusto ?? item?.precoCusto;
                    if (typeof rawCost === 'number' && Number.isFinite(rawCost) && rawCost >= 0 && !this.knownCosts.has(idStr)) {
                      this.knownCosts.set(idStr, Math.round(rawCost * 100) / 100);
                    }
                  }
                }
              }
            } catch {}
          }
        }
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          const res: any = await chrome.runtime.sendMessage({
            type: 'BLING_SEARCH_PRODUCTS',
            query: '',
            searchBy: 'name',
            page: 1
          });
          if (res?.ok && Array.isArray(res.items)) {
            for (const item of res.items) {
              if (item?.id) {
                const idStr = String(item.id).trim();
                const sku = String(item.sku || '').trim().toUpperCase();
                const name = String(item.name || '').trim().toUpperCase();
                if (sku) this.skuToProductId.set(sku, idStr);
                if (name) this.nameToProductId.set(name, idStr);
              }
            }
          }
        }
        if (!this.isDestroyed) {
          this.scanAndInject();
        }
      } finally {
        this.catalogPreloadPromise = null;
      }
    })();
    return this.catalogPreloadPromise;
  }

  private async resolveProductIdForRow(htmlRow: HTMLElement, rowSku: string, rowName: string): Promise<string | null> {
    const direct = extractProductIdFromRow(htmlRow);
    if (direct) return direct;

    const upperSku = rowSku.trim().toUpperCase();
    const upperName = rowName.trim().toUpperCase();
    if (upperSku && this.skuToProductId.has(upperSku)) return this.skuToProductId.get(upperSku)!;
    if (upperName && this.nameToProductId.has(upperName)) return this.nameToProductId.get(upperName)!;

    await this.preloadCatalogIds();
    if (upperSku && this.skuToProductId.has(upperSku)) return this.skuToProductId.get(upperSku)!;
    if (upperName && this.nameToProductId.has(upperName)) return this.nameToProductId.get(upperName)!;

    // Busca específica por SKU ou Nome via API da mesma origem ou Gateway
    if (typeof location !== 'undefined' && /(?:^|\.)bling\.com\.br$/i.test(location.hostname)) {
      try {
        const qs = upperSku ? `codigo=${encodeURIComponent(rowSku.trim())}` : `pesquisa=${encodeURIComponent(rowName.trim())}`;
        const r = await fetch(`/Api/v3/produtos?limite=20&${qs}`, { credentials: 'include', headers: { Accept: 'application/json' } });
        if (r.ok) {
          const j = await r.json();
          for (const item of (j?.data || [])) {
            const itemSku = String(item?.codigo || '').trim().toUpperCase();
            const itemName = String(item?.nome || '').trim().toUpperCase();
            if ((upperSku && itemSku === upperSku) || (upperName && itemName === upperName)) {
              const idStr = String(item.id).trim();
              if (upperSku) this.skuToProductId.set(upperSku, idStr);
              if (upperName) this.nameToProductId.set(upperName, idStr);
              return idStr;
            }
          }
          if (j?.data?.length === 1 && j.data[0]?.id) {
            return String(j.data[0].id).trim();
          }
        }
      } catch {}
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && (rowSku || rowName)) {
      try {
        const res: any = await chrome.runtime.sendMessage({
          type: 'BLING_SEARCH_PRODUCTS',
          query: rowSku || rowName,
          searchBy: rowSku ? 'sku' : 'name',
          page: 1
        });
        if (res?.ok && Array.isArray(res.items)) {
          const exact = res.items.find((it: any) =>
            (upperSku && String(it.sku || '').trim().toUpperCase() === upperSku) ||
            (upperName && String(it.name || '').trim().toUpperCase() === upperName)
          ) || (res.items.length === 1 ? res.items[0] : null);
          if (exact?.id) {
            const idStr = String(exact.id).trim();
            if (upperSku) this.skuToProductId.set(upperSku, idStr);
            if (upperName) this.nameToProductId.set(upperName, idStr);
            return idStr;
          }
        }
      } catch {}
    }

    return null;
  }

  private applyCostToElement(span: HTMLElement, cost: number | null | undefined): void {
    span.textContent = formatCostValue(cost);
    if (cost !== null && cost !== undefined && cost > 0) {
      span.style.color = '#047857'; // Verde esmeralda profissional
    } else {
      span.style.color = '#94a3b8'; // Cinza suave
    }
  }

  private applyCostToPill(pill: HTMLElement, cost: number | null | undefined): void {
    pill.textContent = `Custo: ${formatCostValue(cost)}`;
    if (cost !== null && cost !== undefined && cost > 0) {
      pill.style.color = '#047857';
    } else {
      pill.style.color = '#94a3b8';
    }
  }

  private applyBatchCosts(uniqueIds: string[], costsMap: Record<string, number | null>, revisions: Map<string, number>): void {
    for (const id of uniqueIds) {
      if ((this.costRevisions.get(id) || 0) !== revisions.get(id)) continue;
      const cost = id in costsMap ? costsMap[id] : null;
      this.knownCosts.set(id, cost);
      const cells = document.querySelectorAll<HTMLElement>(`.${CELL_CLASS}[data-product-id="${id}"]`);
      cells.forEach(td => {
        const span = td.querySelector<HTMLElement>('.paulifest-cost-text');
        if (span) this.applyCostToElement(span, cost);
        const editor = td.querySelector('.paulifest-cost-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
        editor?.refreshDisplay?.();
      });
      const pills = document.querySelectorAll<HTMLElement>(`.${INLINE_PILL_CLASS}[data-product-id="${id}"]`);
      pills.forEach(p => this.applyCostToPill(p, cost));
    }
  }

  /**
   * Solicita ao background o lote de custos dos produtos.
   */
  private fetchCostsForProducts(productIds: string[]): void {
    const uniqueIds = Array.from(new Set(productIds)).filter(id => !this.pendingIds.has(id));
    if (uniqueIds.length === 0) return;

    const revisions = new Map(uniqueIds.map(id => [id, this.costRevisions.get(id) || 0]));
    for (const id of uniqueIds) {
      this.pendingIds.add(id);
    }

    const payload: ContentToBackgroundEnvelope<BlingGetProductsCostListPayload> = {
      type: 'BLING_GET_PRODUCTS_COST_LIST',
      pageInstanceId: this.pageInstanceId,
      payload: { productIds: uniqueIds },
      clientTimestamp: new Date().toISOString()
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(payload, async (res: BlingGetProductsCostListResponse) => {
        for (const id of uniqueIds) {
          this.pendingIds.delete(id);
        }

        if (this.isDestroyed || res?.stale) return;
        if (res && res.ok && res.costs && Object.keys(res.costs).length > 0) {
          this.applyBatchCosts(uniqueIds, res.costs, revisions);
          return;
        }
        // Fallback na mesma origem do Bling caso o Gateway retorne erro/429
        const fallbackCosts: Record<string, number | null> = {};
        if (typeof location !== 'undefined' && /(?:^|\.)bling\.com\.br$/i.test(location.hostname)) {
          try {
            const params = new URLSearchParams();
            params.set('limite', '100');
            for (const id of uniqueIds) params.append('idsProdutos[]', id);
            const r = await fetch(`/Api/v3/produtos?${params.toString()}`, { credentials: 'include', headers: { Accept: 'application/json' } });
            if (r.ok) {
              const j = await r.json();
              for (const item of (j?.data || [])) {
                if (item?.id != null) {
                  const rawCost = item?.fornecedor?.precoCusto ?? item?.precoCusto;
                  fallbackCosts[String(item.id)] = typeof rawCost === 'number' && Number.isFinite(rawCost) && rawCost >= 0 ? Math.round(rawCost * 100) / 100 : null;
                }
              }
            }
          } catch {}
        }
        this.applyBatchCosts(uniqueIds, fallbackCosts, revisions);
      });
    }
  }
}
