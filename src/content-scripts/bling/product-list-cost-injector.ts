import { createCostEditor, saveInlineCost, createStockEditor, saveInlineStock } from './cost-editor.ts';
// Injetor Dinâmico de Coluna de Preço de Custo e Estoque na Listagem de Produtos do Bling ERP (produtos.php)
import { isValidProductId } from '../../shared/tab-context-contracts.ts';
import type { ContentToBackgroundEnvelope, BlingGetProductsCostListPayload, BlingGetProductsCostListResponse } from '../../shared/tab-context-contracts.ts';

const HEADER_ID = 'paulifest-cost-header';
const CELL_CLASS = 'paulifest-cost-td';
const INLINE_PILL_CLASS = 'paulifest-cost-inline-pill';
const STOCK_HEADER_ID = 'paulifest-stock-header';
const STOCK_CELL_CLASS = 'paulifest-stock-td';

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

  // 6. Qualquer atributo (id, value, onclick, href, data-*) na linha ou em seus elementos filhos contendo um ID numérico de 7 a 16 dígitos do Bling
  try {
    if (typeof row.querySelectorAll === 'function') {
      const elements = [row, ...Array.from(row.querySelectorAll('*'))];
      for (const el of elements) {
        if (!el.attributes) continue;
        for (let a = 0; a < el.attributes.length; a++) {
          const attr = el.attributes[a];
          if (!attr?.value) continue;
          const n = attr.name.toLowerCase();
          if (n === 'class' || n === 'style' || n === 'src' || n === 'viewbox' || n === 'd') continue;
          const m = attr.value.match(/(?:^|[^0-9])([1-9]\d{6,15})(?:$|[^0-9])/);
          if (m?.[1] && isValidProductId(m[1])) {
            return m[1];
          }
        }
      }
    }
  } catch {}

  // 7. Propriedades internas de frameworks (Vue / React / jQuery data) na linha <tr>
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

function parseCellStockNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s*(?:un(?:id(?:ades?)?)?|und)\.?$/i, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.includes('⏳')) return null;
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, '')
      : cleaned;
  const num = Number(normalized);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) / 100 : null;
}

function extractCleanCellText(cell: Element | undefined | null): string {
  if (!cell) return '';
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button, svg, script, style, .paulifest-cost-editor, .paulifest-stock-editor').forEach(el => el.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Localiza o cabeçalho e as linhas da listagem de produtos no Bling,
 * suportando tanto <table> única quanto <table> separadas (scrollHead/scrollBody) ou grids baseados em <div>.
 */
interface DetectedProductGrid {
  headerRow: HTMLElement;
  bodyRows: HTMLElement[];
  tableElement: HTMLTableElement | null;
}

function findHeaderRow(root: Document | HTMLElement): HTMLElement | null {
  if (typeof root.querySelectorAll !== 'function') return null;
  const allRows = root.querySelectorAll<HTMLElement>('thead tr, tr, [role="row"], .datatable-header, .table-header');
  for (let i = 0; i < allRows.length; i++) {
    const tr = allRows[i];
    if (tr.querySelector(`#${HEADER_ID}`)) return tr;
    const texts = Array.from(tr.children).map(c => (c.textContent || '').trim().toLowerCase());
    const hasDesc = texts.some(t => t.includes('descri'));
    const hasPriceOrCode = texts.some(t => t.includes('código') || t.includes('codigo') || t.includes('preço') || t.includes('preco') || t.includes('custo'));
    if (hasDesc && hasPriceOrCode) {
      return tr;
    }
  }

  // Busca direta pelo elemento de texto "Preço de Custo" ou "Descrição" visível na página
  const leafCandidates = root.querySelectorAll<HTMLElement>('th, td, div, span');
  for (let i = 0; i < leafCandidates.length; i++) {
    const el = leafCandidates[i];
    if (el.children.length > 2) continue;
    const txt = (el.textContent || '').trim().toLowerCase();
    if (txt === 'preço de custo' || txt === 'preco de custo') {
      let parent = el.parentElement;
      for (let depth = 0; depth < 4 && parent; depth++) {
        const childTexts = Array.from(parent.children).map(c => (c.textContent || '').trim().toLowerCase());
        if (childTexts.some(t => t.includes('descri')) && childTexts.some(t => t.includes('custo'))) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }
  }

  return allRows[0] || null;
}

function detectProductGrid(root: Document | HTMLElement = document): DetectedProductGrid | null {
  const tbl = findProductTable(root);
  if (tbl) {
    const headerRow = findHeaderRow(tbl) || findHeaderRow(root);
    if (headerRow) {
      const tbodyRows = Array.from(tbl.querySelectorAll<HTMLElement>('tbody tr'));
      const rows = tbodyRows.length > 0
        ? tbodyRows
        : Array.from(tbl.querySelectorAll<HTMLElement>('tr')).filter(r => r !== headerRow);
      if (rows.length > 0) {
        return { headerRow, bodyRows: rows, tableElement: tbl };
      }
    }
  }

  // Fallback Universal: encontra a linha de cabeçalho ("Descrição" + "Preço" / "Preço de Custo") em qualquer estrutura DOM
  const headerRow = findHeaderRow(root);
  if (!headerRow) return null;
  const headerTexts = Array.from(headerRow.children).map(c => (c.textContent || '').trim().toLowerCase());
  const hasDesc = headerTexts.some(t => t.includes('descri'));
  const hasPriceOrCost = headerTexts.some(t => t.includes('preço') || t.includes('preco') || t.includes('custo') || t.includes('código') || t.includes('codigo'));
  if (!hasDesc || !hasPriceOrCost) return null;

  // 1. Procura linhas <tr> em qualquer <tbody> da página que tenham células suficientes
  const allTbodyTrs = Array.from(root.querySelectorAll<HTMLElement>('tbody tr')).filter(
    tr => tr !== headerRow && tr.children.length >= 4
  );
  if (allTbodyTrs.length > 0) {
    return { headerRow, bodyRows: allTbodyTrs, tableElement: allTbodyTrs[0].closest('table') };
  }

  // 2. Procura linhas baseadas em <div> ou <tr> que contenham checkbox de seleção de linha
  const checkboxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const detectedRows: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const cb of checkboxes) {
    if (headerRow.contains(cb)) continue;
    const rowCandidate = cb.closest<HTMLElement>('tr, [role="row"]') || (() => {
      let p = cb.parentElement;
      for (let d = 0; d < 4 && p; d++) {
        if (p.children.length >= 5 && p !== document.body) return p;
        p = p.parentElement;
      }
      return null;
    })();
    if (rowCandidate && !seen.has(rowCandidate) && !rowCandidate.contains(headerRow)) {
      seen.add(rowCandidate);
      detectedRows.push(rowCandidate);
    }
  }
  if (detectedRows.length > 0) {
    return { headerRow, bodyRows: detectedRows, tableElement: detectedRows[0].closest('table') };
  }

  return null;
}

function bindCostCellIsolation(td: HTMLElement): void {
  if (td.getAttribute('data-paulifest-isolated') === 'true') return;
  td.setAttribute('data-paulifest-isolated', 'true');
  td.removeAttribute('onclick');
  td.style.cursor = 'pointer';

  for (const evtName of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'touchstart', 'touchend']) {
    td.addEventListener(evtName, (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest('.paulifest-cost-editor')) {
        e.stopImmediatePropagation();
        e.stopPropagation();
        if (evtName === 'click') {
          e.preventDefault();
          const editor = td.querySelector('.paulifest-cost-editor') as (HTMLElement & { openEditor?: () => void }) | null;
          editor?.openEditor?.();
        }
      }
    }, true);

    td.addEventListener(evtName, (e) => {
      e.stopImmediatePropagation();
      e.stopPropagation();
    }, false);
  }
}

function bindStockCellIsolation(td: HTMLElement): void {
  if (td.getAttribute('data-paulifest-stock-isolated') === 'true') return;
  td.setAttribute('data-paulifest-stock-isolated', 'true');
  td.removeAttribute('onclick');
  td.style.cursor = 'pointer';

  for (const evtName of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'touchstart', 'touchend']) {
    td.addEventListener(evtName, (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest('.paulifest-stock-editor')) {
        e.stopImmediatePropagation();
        e.stopPropagation();
        if (evtName === 'click') {
          e.preventDefault();
          const editor = td.querySelector('.paulifest-stock-editor') as (HTMLElement & { openEditor?: () => void }) | null;
          editor?.openEditor?.();
        }
      }
    }, true);

    td.addEventListener(evtName, (e) => {
      e.stopImmediatePropagation();
      e.stopPropagation();
    }, false);
  }
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

  for (let i = 0; i < candidates.length; i++) {
    const tbl = candidates[i];
    const headerRow = findHeaderRow(tbl);
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

export function formatStockValue(stock: number | null | undefined): string {
  if (stock === null || stock === undefined) return '-';
  return Number.isInteger(stock) ? String(stock) : stock.toFixed(2).replace('.', ',');
}

export interface InjectionResult {
  injectedCount: number;
  productIds: string[];
}

export class ProductListCostInjector {
  private pageInstanceId: string;
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private pollInterval: number | null = null;
  private knownCosts = new Map<string, number | null>();
  private costRevisions = new Map<string, number>();
  private knownStocks = new Map<string, number | null>();
  private stockRevisions = new Map<string, number>();
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
    try {
      this.scanAndInject();
    } catch (err) {
      console.error('[Paulifest Copilot] Erro ao iniciar injetor de custo:', err);
    }

    this.observer = new MutationObserver(() => {
      if (this.isDestroyed) return;
      if (this.debounceTimer !== null) {
        window.clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => {
        try {
          this.scanAndInject();
        } catch (err) {
          console.error('[Paulifest Copilot] Erro ao atualizar custo na tabela:', err);
        }
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

    // Verificação periódica para capturar tabelas renderizadas em iframes ou após transições assíncronas do Bling
    this.pollInterval = window.setInterval(() => {
      if (this.isDestroyed) return;
      try {
        this.scanAndInject();
      } catch {}
    }, 1200);
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
    if (this.pollInterval !== null) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.pendingIds.clear();
    this.knownCosts.clear();
  }

  private resolveCellByColIndexOrGeometry(
    row: HTMLElement,
    colIndex: number,
    headerCell: HTMLElement | undefined,
    totalHeaderCols: number
  ): HTMLElement | null {
    if (colIndex < 0) return null;
    // Se a linha tiver a mesma contagem de colunas (ou próxima), usa o índice direto
    if (colIndex < row.children.length && Math.abs(row.children.length - totalHeaderCols) <= 1) {
      return row.children[colIndex] as HTMLElement;
    }
    // Fallback geométrico: encontra a célula na linha cujo eixo X está alinhado sob o cabeçalho
    if (headerCell && typeof headerCell.getBoundingClientRect === 'function') {
      const hRect = headerCell.getBoundingClientRect();
      if (hRect.width > 0) {
        const hCenter = (hRect.left + hRect.right) / 2;
        let bestCell: HTMLElement | null = null;
        let bestDist = Infinity;
        for (let i = 0; i < row.children.length; i++) {
          const cell = row.children[i] as HTMLElement;
          const cRect = cell.getBoundingClientRect();
          if (cRect.width === 0) continue;
          const cCenter = (cRect.left + cRect.right) / 2;
          const dist = Math.abs(cCenter - hCenter);
          if (dist < bestDist && dist < Math.max(hRect.width, 90)) {
            bestDist = dist;
            bestCell = cell;
          }
        }
        if (bestCell) return bestCell;
      }
    }
    return (row.children[colIndex] as HTMLElement) || null;
  }

  /**
   * Fallback Geométrico Universal:
   * Localiza os textos visíveis "Preço de Custo" e "Estoque" no cabeçalho pela coordenada X na tela (getBoundingClientRect)
   * e transforma todas as células numéricas ("19,00", "6,00", "5,00"...) alinhadas verticalmente abaixo deles,
   * independentemente de o Bling usar <table>, múltiplas <table>s, CSS Grid ou <div>s aninhadas.
   */
  private scanByVisualColumnCoordinates(root: Document): number {
    if (typeof root.querySelectorAll !== 'function') return 0;
    const allElements = Array.from(root.querySelectorAll<HTMLElement>('th, td, div, span, label, p'));

    let costHeaderEl: HTMLElement | null = null;
    let costHeaderRect: DOMRect | null = null;
    let descAnchorRect: DOMRect | null = null;

    for (const el of allElements) {
      if (el.children.length > 2) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!costHeaderEl && (text === 'preço de custo' || text === 'preco de custo')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 10 && rect.height > 8) {
          costHeaderEl = el;
          costHeaderRect = rect;
        }
      } else if (!descAnchorRect && (text === 'descrição' || text === 'descricao')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 10 && rect.height > 8) {
          descAnchorRect = rect;
        }
      }
    }

    const headerAnchorRect = costHeaderRect || descAnchorRect;
    if (!headerAnchorRect) return 0;

    const headerCenterY = (headerAnchorRect.top + headerAnchorRect.bottom) / 2;

    // Localiza todas as colunas na mesma linha horizontal do cabeçalho da tabela
    let skuHeaderRect: DOMRect | null = null;
    let descHeaderRect: DOMRect | null = descAnchorRect;
    let stockHeaderEl: HTMLElement | null = null;
    let stockHeaderRect: DOMRect | null = null;
    const allHeaderCentersX: number[] = [];

    for (const el of allElements) {
      if (el.children.length > 2) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || Math.abs((rect.top + rect.bottom) / 2 - headerCenterY) > 28) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.length >= 2 && text.length <= 30) {
        allHeaderCentersX.push((rect.left + rect.right) / 2);
      }
      if (!skuHeaderRect && (text.includes('código') || text.includes('codigo') || text === 'sku')) {
        skuHeaderRect = rect;
      } else if (!descHeaderRect && text.includes('descri')) {
        descHeaderRect = rect;
      } else if (!stockHeaderEl && (text.includes('estoque') || text.includes('saldo'))) {
        stockHeaderEl = el;
        stockHeaderRect = rect;
      }
    }

    const isClosestColumnCenter = (elCenterX: number, targetCenterX: number, maxDist: number): boolean => {
      const distToTarget = Math.abs(elCenterX - targetCenterX);
      if (distToTarget > maxDist) return false;
      for (const otherX of allHeaderCentersX) {
        if (Math.abs(otherX - targetCenterX) <= 8) continue;
        if (Math.abs(elCenterX - otherX) < distToTarget) {
          return false;
        }
      }
      return true;
    };

    const isWithinColumn = (el: HTMLElement, elRect: DOMRect, headerRect: DOMRect): boolean => {
      const td = (el.tagName.toLowerCase() === 'td' ? el : el.closest('td')) as HTMLElement | null;
      if (td) {
        const tdRect = td.getBoundingClientRect();
        const tdCenter = (tdRect.left + tdRect.right) / 2;
        if (tdCenter >= headerRect.left - 6 && tdCenter <= headerRect.right + 6) return true;
      }
      const elCenter = (elRect.left + elRect.right) / 2;
      if (elCenter >= headerRect.left - 6 && elCenter <= headerRect.right + 6) return true;
      return isClosestColumnCenter(elCenter, (headerRect.left + headerRect.right) / 2, Math.max(headerRect.width * 0.85, 60));
    };

    const resolveRowMeta = (el: HTMLElement, elCenterY: number) => {
      const rowContainer = el.closest<HTMLElement>('tr, [role="row"]') || (() => {
        let p = el.parentElement;
        for (let d = 0; d < 6 && p; d++) {
          const r = p.getBoundingClientRect();
          if (r.width > 400 && r.height < 110) return p;
          p = p.parentElement;
        }
        return el.parentElement || el;
      })();

      let rowSku = '';
      let rowName = '';

      if (skuHeaderRect || descHeaderRect) {
        const skuCenterX = skuHeaderRect ? (skuHeaderRect.left + skuHeaderRect.right) / 2 : -9999;
        const descCenterX = descHeaderRect ? (descHeaderRect.left + descHeaderRect.right) / 2 : -9999;
        const rowCandidates = Array.from(rowContainer.querySelectorAll<HTMLElement>('td, div, span, a, p'));
        for (const cand of rowCandidates) {
          if (cand === el || cand.contains(el) || cand.children.length > 2) continue;
          const cRect = cand.getBoundingClientRect();
          if (cRect.width < 5 || Math.abs((cRect.top + cRect.bottom) / 2 - elCenterY) > 28) continue;
          const cText = extractCleanCellText(cand);
          if (!cText) continue;
          if (!rowSku && skuHeaderRect && Math.abs(cRect.left - skuHeaderRect.left) < 90 && Math.abs((cRect.left + cRect.right) / 2 - skuCenterX) < 110) {
            rowSku = cText;
          } else if (!rowName && descHeaderRect && Math.abs(cRect.left - descHeaderRect.left) < 120 && Math.abs((cRect.left + cRect.right) / 2 - descCenterX) < 220) {
            rowName = cText;
          }
        }
      }

      let productId = extractProductIdFromRow(rowContainer);
      if (!productId && rowSku && this.skuToProductId.has(rowSku.toUpperCase())) {
        productId = this.skuToProductId.get(rowSku.toUpperCase()) || null;
      }
      if (!productId && rowName && this.nameToProductId.has(rowName.toUpperCase())) {
        productId = this.nameToProductId.get(rowName.toUpperCase()) || null;
      }
      if (productId) {
        rowContainer.setAttribute('data-product-id', productId);
      } else {
        void this.preloadCatalogIds();
      }

      const rowKey = productId || (rowSku ? `sku:${rowSku.toUpperCase()}` : rowName ? `name:${rowName.toUpperCase()}` : `y:${Math.round(elCenterY)}`);
      return { rowContainer, rowSku, rowName, productId, rowKey };
    };

    let transformed = 0;

    // 1. Encontra todas as células de valor de custo alinhadas exclusivamente abaixo de "Preço de Custo"
    if (costHeaderEl && costHeaderRect) {
      for (const el of allElements) {
        if (el === costHeaderEl || el.contains(costHeaderEl)) continue;
        if (el.classList.contains(CELL_CLASS) || el.closest(`.${CELL_CLASS}, .${STOCK_CELL_CLASS}, .paulifest-cost-editor, .paulifest-stock-editor`)) continue;
        if (el.children.length > 0) continue;

        const rawText = (el.textContent || '').trim();
        if (!/^(?:R\$\s*)?\d+(?:\.\d{3})*,\d{2}$/.test(rawText) && rawText !== '-') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8 || rect.top <= costHeaderRect.bottom) continue;

        if (!isWithinColumn(el, rect, costHeaderRect)) continue;

        const elCenterY = (rect.top + rect.bottom) / 2;
        const { rowContainer, rowSku, rowName, productId, rowKey } = resolveRowMeta(el, elCenterY);

        const initialCost = parseCellBrlNumber(rawText);
        if (initialCost !== null && !this.knownCosts.has(rowKey)) {
          this.knownCosts.set(rowKey, initialCost);
          if (productId) this.knownCosts.set(productId, initialCost);
        }

        const targetCell = (el.tagName.toLowerCase() === 'td' ? el : (el.closest('td') || el)) as HTMLElement;
        targetCell.classList.add(CELL_CLASS);
        if (productId) targetCell.setAttribute('data-product-id', productId);
        targetCell.textContent = '';
        bindCostCellIsolation(targetCell);

        const span = document.createElement('span');
        span.className = 'paulifest-cost-text';
        span.style.display = 'none';
        this.applyCostToElement(span, this.knownCosts.get(productId || rowKey) ?? initialCost);
        targetCell.appendChild(span);

        this.mountCostEditor(targetCell, rowContainer, rowKey, rowSku, rowName);
        transformed++;
      }
    }

    // 2. Encontra todas as células de saldo alinhadas exclusivamente abaixo de "Estoque" (sem tocar em "Preço")
    if (stockHeaderEl && stockHeaderRect) {
      for (const el of allElements) {
        if (el === stockHeaderEl || el.contains(stockHeaderEl)) continue;
        if (el.classList.contains(STOCK_CELL_CLASS) || el.classList.contains(CELL_CLASS) || el.closest(`.${STOCK_CELL_CLASS}, .${CELL_CLASS}, .paulifest-stock-editor, .paulifest-cost-editor`)) continue;
        if (el.children.length > 0) continue;

        const rawText = (el.textContent || '').trim();
        if (!/^-?\d+(?:\.\d{3})*(?:,\d{1,4})?(?:\s*un(?:id)?\.?)?$/i.test(rawText) && rawText !== '-') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8 || rect.top <= stockHeaderRect.bottom) continue;

        if (!isWithinColumn(el, rect, stockHeaderRect)) continue;

        const elCenterY = (rect.top + rect.bottom) / 2;
        const { rowContainer, rowSku, rowName, productId, rowKey } = resolveRowMeta(el, elCenterY);

        const initialStock = parseCellStockNumber(rawText);
        if (initialStock !== null && !this.knownStocks.has(rowKey)) {
          this.knownStocks.set(rowKey, initialStock);
          if (productId) this.knownStocks.set(productId, initialStock);
        }

        const targetCell = (el.tagName.toLowerCase() === 'td' ? el : (el.closest('td') || el)) as HTMLElement;
        targetCell.classList.add(STOCK_CELL_CLASS);
        if (productId) targetCell.setAttribute('data-product-id', productId);
        targetCell.textContent = '';
        bindStockCellIsolation(targetCell);

        const span = document.createElement('span');
        span.className = 'paulifest-stock-text';
        span.style.display = 'none';
        this.applyStockToElement(span, this.knownStocks.get(productId || rowKey) ?? initialStock);
        targetCell.appendChild(span);

        this.mountStockEditor(targetCell, rowContainer, rowKey, rowSku, rowName);
        transformed++;
      }
    }

    return transformed;
  }

  /**
   * Realiza a varredura da tabela, inserção/reuso da coluna Preço de Custo e ativação da edição inline.
   */
  scanAndInject(): InjectionResult {
    // 1. Executa primeiro o pareamento geométrico visual das colunas "Preço de Custo" e "Estoque"
    let visualCount = 0;
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      try {
        visualCount += this.scanByVisualColumnCoordinates(document);
        const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
        for (let i = 0; i < iframes.length; i++) {
          try {
            if (iframes[i].contentDocument) {
              visualCount += this.scanByVisualColumnCoordinates(iframes[i].contentDocument!);
            }
          } catch {}
        }
      } catch {}
    }

    let grid = detectProductGrid(document);
    if (!grid && typeof document.querySelectorAll === 'function') {
      const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
      for (let i = 0; i < iframes.length; i++) {
        try {
          const subDoc = iframes[i].contentDocument;
          if (subDoc) {
            grid = detectProductGrid(subDoc);
            if (grid) break;
          }
        } catch {}
      }
    }
    if (!grid) {
      return { injectedCount: visualCount, productIds: [] };
    }

    const { headerRow, bodyRows: rowsToProcess } = grid;
    const ths = Array.from(headerRow.children) as HTMLElement[];
    let descColIndex = -1;
    let skuColIndex = -1;
    let nativeCostColIndex = -1;
    let nativeStockColIndex = -1;

    for (let i = 0; i < ths.length; i++) {
      const text = (ths[i].textContent || '').trim().toLowerCase();
      if (descColIndex === -1 && text.includes('descri')) descColIndex = i;
      if (skuColIndex === -1 && (text.includes('código') || text.includes('codigo') || text === 'sku')) skuColIndex = i;
      if (ths[i].id === HEADER_ID || text.includes('custo')) {
        nativeCostColIndex = i;
      }
      if (ths[i].id === STOCK_HEADER_ID || text.includes('estoque') || text.includes('saldo')) {
        nativeStockColIndex = i;
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

      const headerTag = headerRow.tagName.toLowerCase() === 'tr' ? 'th' : 'div';
      const th = document.createElement(headerTag);
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
        if (nativeStockColIndex >= insertBeforeCol) nativeStockColIndex++;
      } else {
        headerRow.appendChild(th);
        targetColIndex = ths.length;
      }
    }

    const updatedThs = Array.from(headerRow.children) as HTMLElement[];
    let stockColIndex = -1;
    let reusedNativeStockColumn = false;

    if (nativeStockColIndex >= 0 && nativeStockColIndex < updatedThs.length) {
      stockColIndex = nativeStockColIndex;
      reusedNativeStockColumn = true;
      updatedThs[nativeStockColIndex].id = STOCK_HEADER_ID;
    }

    const finalThs = Array.from(headerRow.children) as HTMLElement[];

    const idsNeedingCost: string[] = [];
    let injectedCount = 0;
    let needsCatalogPreload = false;

    for (let rowIndex = 0; rowIndex < rowsToProcess.length; rowIndex++) {
      const htmlRow = rowsToProcess[rowIndex] as HTMLElement;
      const skuCell = this.resolveCellByColIndexOrGeometry(htmlRow, skuColIndex, ths[skuColIndex], ths.length);
      const descCell = this.resolveCellByColIndexOrGeometry(htmlRow, descColIndex, ths[descColIndex], ths.length);
      const rowSku = extractCleanCellText(skuCell);
      const rowName = extractCleanCellText(descCell);

      let productId = extractProductIdFromRow(htmlRow);
      if (!productId && rowSku && this.skuToProductId.has(rowSku.toUpperCase())) {
        productId = this.skuToProductId.get(rowSku.toUpperCase()) || null;
      }
      if (!productId && rowName && this.nameToProductId.has(rowName.toUpperCase())) {
        productId = this.nameToProductId.get(rowName.toUpperCase()) || null;
      }
      if (productId) {
        htmlRow.setAttribute('data-product-id', productId);
      }

      if (!productId && !rowSku && !rowName) {
        if (!reusedNativeColumn && targetColIndex >= 0 && !htmlRow.querySelector(`.${CELL_CLASS}`)) {
          const cellTag = htmlRow.tagName.toLowerCase() === 'tr' ? 'td' : 'div';
          const emptyTd = document.createElement(cellTag);
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

      let td = htmlRow.querySelector<HTMLElement>(`.${CELL_CLASS}`);
      if (!td && reusedNativeColumn) {
        const nativeCell = this.resolveCellByColIndexOrGeometry(htmlRow, targetColIndex, finalThs[targetColIndex], finalThs.length);
        if (nativeCell) {
          td = nativeCell;
          td.classList.add(CELL_CLASS);
          const initialCellCost = parseCellBrlNumber(extractCleanCellText(td));
          if (initialCellCost !== null && !this.knownCosts.has(rowKey)) {
            this.knownCosts.set(rowKey, initialCellCost);
            if (productId) this.knownCosts.set(productId, initialCellCost);
          }
          td.textContent = '';
          bindCostCellIsolation(td);

          const span = document.createElement('span');
          span.className = 'paulifest-cost-text';
          span.style.display = 'none';
          this.applyCostToElement(span, this.knownCosts.get(productId || rowKey) ?? initialCellCost);
          td.appendChild(span);
          injectedCount++;
        }
      }
      if (!td) {
        const cellTag = htmlRow.tagName.toLowerCase() === 'tr' ? 'td' : 'div';
        td = document.createElement(cellTag);
        td.className = CELL_CLASS;
        td.style.textAlign = 'right';
        td.style.whiteSpace = 'nowrap';
        td.style.verticalAlign = 'middle';
        bindCostCellIsolation(td);

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
        bindCostCellIsolation(td);
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

      // Coluna de Estoque (reutiliza exclusivamente a coluna nativa de Estoque/Saldo sem duplicar colunas)
      let stockTd = htmlRow.querySelector<HTMLElement>(`.${STOCK_CELL_CLASS}`);
      if (!stockTd && reusedNativeStockColumn && stockColIndex >= 0) {
        const nativeStockCell = this.resolveCellByColIndexOrGeometry(htmlRow, stockColIndex, finalThs[stockColIndex], finalThs.length);
        if (nativeStockCell && nativeStockCell !== td && !nativeStockCell.classList.contains(CELL_CLASS)) {
          stockTd = nativeStockCell;
          stockTd.classList.add(STOCK_CELL_CLASS);
          const initialCellStock = parseCellStockNumber(extractCleanCellText(stockTd));
          if (initialCellStock !== null && !this.knownStocks.has(rowKey)) {
            this.knownStocks.set(rowKey, initialCellStock);
            if (productId) this.knownStocks.set(productId, initialCellStock);
          }
          stockTd.textContent = '';
          bindStockCellIsolation(stockTd);

          const stockSpan = document.createElement('span');
          stockSpan.className = 'paulifest-stock-text';
          stockSpan.style.display = 'none';
          this.applyStockToElement(stockSpan, this.knownStocks.get(productId || rowKey) ?? initialCellStock);
          stockTd.appendChild(stockSpan);
        }
      } else if (stockTd) {
        bindStockCellIsolation(stockTd);
        if (productId && this.knownStocks.has(productId)) {
          const stockSpan = stockTd.querySelector<HTMLElement>('.paulifest-stock-text');
          if (stockSpan) this.applyStockToElement(stockSpan, this.knownStocks.get(productId));
          const stockEditor = stockTd.querySelector('.paulifest-stock-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
          stockEditor?.refreshDisplay?.();
        }
      }

      if (stockTd) {
        if (productId) stockTd.setAttribute('data-product-id', productId);
        this.mountStockEditor(stockTd, htmlRow, rowKey, rowSku, rowName);
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

  private mountStockEditor(td: HTMLElement, htmlRow: HTMLElement, rowKey: string, rowSku: string, rowName: string): void {
    const existing = td.querySelector('.paulifest-stock-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
    if (existing) {
      existing.refreshDisplay?.();
      return;
    }
    const textSpan = td.querySelector<HTMLElement>('.paulifest-stock-text');
    if (textSpan) textSpan.style.display = 'none';
    td.append(createStockEditor({
      getStock: () => {
        const pid = extractProductIdFromRow(htmlRow);
        if (pid && this.knownStocks.has(pid)) return this.knownStocks.get(pid) ?? null;
        return this.knownStocks.get(rowKey) ?? null;
      },
      isCurrent: () => !this.isDestroyed && htmlRow.isConnected,
      save: async (value, expected) => {
        const pid = await this.resolveProductIdForRow(htmlRow, rowSku, rowName);
        if (!pid) {
          return { ok: false, error: 'Não foi possível identificar o ID deste produto no Bling.' };
        }
        htmlRow.setAttribute('data-product-id', pid);
        td.setAttribute('data-product-id', pid);
        return saveInlineStock(this.pageInstanceId, pid, value, expected);
      },
      onSaved: value => {
        const pid = extractProductIdFromRow(htmlRow);
        if (pid) {
          this.stockRevisions.set(pid, (this.stockRevisions.get(pid) || 0) + 1);
          this.knownStocks.set(pid, value);
        }
        this.knownStocks.set(rowKey, value);
        const text = td.querySelector<HTMLElement>('.paulifest-stock-text');
        if (text) this.applyStockToElement(text, value);
        const ed = td.querySelector('.paulifest-stock-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
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

  private applyStockToElement(span: HTMLElement, stock: number | null | undefined): void {
    span.textContent = formatStockValue(stock);
    if (stock !== null && stock !== undefined && stock > 0) {
      span.style.color = '#047857';
    } else {
      span.style.color = '#94a3b8';
    }
  }

  private applyBatchStocks(uniqueIds: string[], stocksMap: Record<string, number | null>, revisions: Map<string, number>): void {
    for (const id of uniqueIds) {
      if ((this.stockRevisions.get(id) || 0) !== revisions.get(id)) continue;
      if (!(id in stocksMap)) continue;
      const stock = stocksMap[id];
      if (stock !== null && stock !== undefined) {
        this.knownStocks.set(id, stock);
      }
      const cells = document.querySelectorAll<HTMLElement>(`.${STOCK_CELL_CLASS}[data-product-id="${id}"]`);
      cells.forEach(td => {
        const span = td.querySelector<HTMLElement>('.paulifest-stock-text');
        if (span) this.applyStockToElement(span, this.knownStocks.get(id) ?? stock);
        const editor = td.querySelector('.paulifest-stock-editor') as (HTMLElement & { refreshDisplay?: () => void }) | null;
        editor?.refreshDisplay?.();
      });
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
   * Solicita ao background o lote de custos e estoques dos produtos.
   */
  private fetchCostsForProducts(productIds: string[]): void {
    const uniqueIds = Array.from(new Set(productIds)).filter(id => !this.pendingIds.has(id));
    if (uniqueIds.length === 0) return;

    const revisions = new Map(uniqueIds.map(id => [id, this.costRevisions.get(id) || 0]));
    const stockRevisions = new Map(uniqueIds.map(id => [id, this.stockRevisions.get(id) || 0]));
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
          if (res.stocks) {
            this.applyBatchStocks(uniqueIds, res.stocks, stockRevisions);
          }
          return;
        }
        // Fallback na mesma origem do Bling caso o Gateway retorne erro/429
        const fallbackCosts: Record<string, number | null> = {};
        const fallbackStocks: Record<string, number | null> = {};
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
                  const idStr = String(item.id);
                  const rawCost = item?.fornecedor?.precoCusto ?? item?.precoCusto;
                  fallbackCosts[idStr] = typeof rawCost === 'number' && Number.isFinite(rawCost) && rawCost >= 0 ? Math.round(rawCost * 100) / 100 : null;
                  const rawStock = item?.estoque?.saldoVirtualTotal ?? item?.estoque?.saldoFisicoTotal;
                  if (typeof rawStock === 'number' && Number.isFinite(rawStock) && rawStock >= 0) {
                    fallbackStocks[idStr] = Math.round(rawStock * 100) / 100;
                  }
                }
              }
            }
            const sParams = new URLSearchParams();
            for (const id of uniqueIds) sParams.append('idsProdutos[]', id);
            const rs = await fetch(`/Api/v3/estoques/saldos?${sParams.toString()}`, { credentials: 'include', headers: { Accept: 'application/json' } });
            if (rs.ok) {
              const js = await rs.json();
              for (const item of (js?.data || [])) {
                if (item?.produto?.id != null) {
                  const idStr = String(item.produto.id);
                  const rawStock = item?.saldoVirtualTotal ?? item?.saldoFisicoTotal;
                  if (typeof rawStock === 'number' && Number.isFinite(rawStock) && rawStock >= 0) {
                    fallbackStocks[idStr] = Math.round(rawStock * 100) / 100;
                  }
                }
              }
            }
          } catch {}
        }
        this.applyBatchCosts(uniqueIds, fallbackCosts, revisions);
        this.applyBatchStocks(uniqueIds, fallbackStocks, stockRevisions);
      });
    }
  }
}
