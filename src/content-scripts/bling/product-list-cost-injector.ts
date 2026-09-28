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
  const childWithId = row.querySelector('[data-id], [data-id-produto], [data-product-id]');
  if (childWithId) {
    const childId = childWithId.getAttribute('data-id') || 
                    childWithId.getAttribute('data-id-produto') || 
                    childWithId.getAttribute('data-product-id');
    if (childId && isValidProductId(childId)) {
      return childId.trim();
    }
  }

  return null;
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
  private costRevisions = new Map<string,number>();
  private pendingIds = new Set<string>();
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
   * Realiza a varredura da tabela, inserção de colunas e solicitação de custos faltantes.
   */
  scanAndInject(): InjectionResult {
    const table = findProductTable();
    if (!table) {
      return { injectedCount: 0, productIds: [] };
    }

    // 1. Identifica ou injeta o cabeçalho <th>
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) {
      return { injectedCount: 0, productIds: [] };
    }

    let targetColIndex = -1;
    let existingHeader = headerRow.querySelector(`#${HEADER_ID}`);

    if (existingHeader) {
      targetColIndex = Array.from(headerRow.children).indexOf(existingHeader);
    } else {
      // Procura a coluna de "Preço" ou "Estoque" para inserir ao lado
      const ths = Array.from(headerRow.children) as HTMLElement[];
      let insertBeforeCol = ths.length > 1 ? ths.length - 1 : ths.length; // Padrão: antes da última coluna (Ações)

      let refTh: HTMLElement | null = null;
      for (let i = 0; i < ths.length; i++) {
        const text = (ths[i].textContent || '').toLowerCase();
        if (text.includes('preço') || text.includes('preco') || text.includes('valor')) {
          insertBeforeCol = i + 1; // Insere logo após o Preço de Venda
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
      th.textContent = 'Preço de custo';

      if (insertBeforeCol < ths.length) {
        headerRow.insertBefore(th, ths[insertBeforeCol]);
        targetColIndex = insertBeforeCol;
      } else {
        headerRow.appendChild(th);
        targetColIndex = ths.length;
      }
    }

    // 2. Itera sobre as linhas de produtos no <tbody>
    const bodyRows = table.querySelectorAll('tbody tr');
    const rowsToProcess = bodyRows.length > 0 ? Array.from(bodyRows) : Array.from(table.querySelectorAll('tr')).slice(1);

    const idsNeedingCost: string[] = [];
    let injectedCount = 0;

    for (const row of rowsToProcess) {
      const htmlRow = row as HTMLElement;
      const productId = extractProductIdFromRow(htmlRow);

      if (!productId) {
        // Linha sem produto (ex: separador ou agrupador). Se já temos a coluna, insere td vazio para não quebrar a contagem
        if (targetColIndex >= 0 && !htmlRow.querySelector(`.${CELL_CLASS}`)) {
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

      // Injeta célula na coluna dedicada
      let td = htmlRow.querySelector<HTMLTableCellElement>(`.${CELL_CLASS}`);
      if (!td) {
        td = document.createElement('td');
        td.className = CELL_CLASS;
        td.setAttribute('data-product-id', productId);
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

        if (this.knownCosts.has(productId)) {
          const cost = this.knownCosts.get(productId);
          this.applyCostToElement(span, cost);
        } else {
          span.textContent = '⏳ ...';
          span.style.color = '#94a3b8';
          idsNeedingCost.push(productId);
        }

        td.appendChild(span);

        if (targetColIndex >= 0 && targetColIndex < htmlRow.children.length) {
          htmlRow.insertBefore(td, htmlRow.children[targetColIndex]);
        } else {
          htmlRow.appendChild(td);
        }
        injectedCount++;
      } else {
        // Se a célula já existe mas estava carregando e temos o custo agora
        if (this.knownCosts.has(productId)) {
          const span = td.querySelector<HTMLElement>('.paulifest-cost-text');
          if (span && span.textContent === '⏳ ...') {
            this.applyCostToElement(span, this.knownCosts.get(productId));
          }
          const editor = td.querySelector('.paulifest-cost-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
          editor?.refreshDisplay?.();
        } else if (!this.pendingIds.has(productId)) {
          idsNeedingCost.push(productId);
        }
      }


      if (td) {
        this.mountCostEditor(td, htmlRow, productId);
      }

    }

    // Se temos IDs novos a buscar, despacha para o Background
    if (idsNeedingCost.length > 0) {
      this.fetchCostsForProducts(idsNeedingCost);
    }

    return {
      injectedCount,
      productIds: Array.from(new Set(idsNeedingCost))
    };
  }

  private mountCostEditor(td: HTMLElement, htmlRow: HTMLElement, productId: string): void {
    const existing = td.querySelector('.paulifest-cost-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
    if (existing) {
      existing.refreshDisplay?.();
      return;
    }
    const textSpan = td.querySelector<HTMLElement>('.paulifest-cost-text');
    if (textSpan) textSpan.style.display = 'none';
    td.append(createCostEditor({
      getCost: () => this.knownCosts.get(productId) ?? null,
      isCurrent: () => !this.isDestroyed && htmlRow.isConnected && extractProductIdFromRow(htmlRow) === productId,
      save: (value, expected) => saveInlineCost(this.pageInstanceId, productId, value, expected),
      onSaved: value => {
        this.costRevisions.set(productId, (this.costRevisions.get(productId) || 0) + 1);
        this.knownCosts.set(productId, value);
        const text = td.querySelector<HTMLElement>('.paulifest-cost-text');
        if (text) this.applyCostToElement(text, value);
        const ed = td.querySelector('.paulifest-cost-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
        ed?.refreshDisplay?.();
      }
    }));
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
        const row = td.closest('tr') as HTMLElement | null;
        if (row) this.mountCostEditor(td, row, id);
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
