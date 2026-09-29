import { createCostEditor, createStockEditor, saveInlineCost, saveInlineStock } from './cost-editor.ts';
import { findBlingProductInput, setNativeInputValue } from './form-assistant.ts';
import type { TabContextUiState } from '../../shared/tab-context-contracts.ts';

const PENDING_NEW_COST_KEY = 'paulifest_pending_new_product_cost';
const PENDING_NEW_STOCK_KEY = 'paulifest_pending_new_product_stock';

export class BlingCostField {
    private id: string | undefined;
    private host: HTMLElement | null = null;
    private editor: (HTMLElement & { refreshDisplay?: () => void; openEditor?: () => void }) | null = null;
    private stockEditor: (HTMLElement & { refreshDisplay?: () => void; openEditor?: () => void }) | null = null;
    private cost: number | null = null;
    private stock: number | null = null;
    private observer: MutationObserver | null = null;
    private timer: number | undefined;

    constructor(private pageInstanceId: string) { }

    setTarget(id?: string): void {
        if (id !== this.id) {
            const previousId = this.id;
            this.host?.remove();
            this.host = null;
            this.editor = null;
            this.stockEditor = null;
            this.id = id;

            if (id === '__new__') {
                this.cost = this.readPendingNewCost();
                this.stock = this.readPendingNewStock();
            } else if (id && previousId === '__new__') {
                // O usuário acabou de salvar o produto novo e o Bling atribuiu um ID real:
                // aplica automaticamente o custo e o estoque definidos durante a criação!
                const pending = this.readPendingNewCost();
                this.cost = pending;
                if (pending !== null) {
                    this.clearPendingNewCost();
                    void saveInlineCost(this.pageInstanceId, id, pending, null).then(res => {
                        if (res?.ok && typeof res.cost === 'number') {
                            this.cost = res.cost;
                            this.editor?.refreshDisplay?.();
                        }
                    }).catch(() => {});
                }
                const pendingStock = this.readPendingNewStock();
                this.stock = pendingStock;
                if (pendingStock !== null) {
                    this.clearPendingNewStock();
                    void saveInlineStock(this.pageInstanceId, id, pendingStock, null).then(res => {
                        if (res?.ok && typeof res.stock === 'number') {
                            this.stock = res.stock;
                            this.stockEditor?.refreshDisplay?.();
                        }
                    }).catch(() => {});
                }
            } else {
                this.cost = null;
                this.stock = null;
            }
        }
        if (this.id) {
            this.startObserver();
            this.mountOrRefresh();
        } else {
            this.stopObserver();
        }
    }

    getCost(): number | null {
        return this.cost;
    }

    getStock(): number | null {
        return this.stock;
    }

    async applyCostFromPopup(value: number): Promise<{ ok: boolean; error?: string }> {
        if (!this.id) this.setTarget('__new__');
        const costInput = findBlingProductInput('cost');
        if (costInput?.isConnected) {
            setNativeInputValue(costInput, value.toFixed(2).replace('.', ','));
        }
        if (this.id === '__new__' || !this.id) {
            this.cost = value;
            this.writePendingNewCost(value);
            this.mountOrRefresh();
            return { ok: true };
        }
        const res = await saveInlineCost(this.pageInstanceId, this.id, value, this.cost);
        if (res?.ok) {
            this.cost = value;
            this.editor?.refreshDisplay?.();
            return { ok: true };
        }
        return { ok: false, error: res?.error || 'Não foi possível salvar o custo.' };
    }

    async applyStockFromPopup(value: number): Promise<{ ok: boolean; error?: string }> {
        if (!this.id) this.setTarget('__new__');
        const stockInput = findBlingProductInput('stock');
        if (stockInput?.isConnected) {
            const formatted = Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
            setNativeInputValue(stockInput, formatted);
        }
        if (this.id === '__new__' || !this.id) {
            this.stock = value;
            this.writePendingNewStock(value);
            this.mountOrRefresh();
            return { ok: true };
        }
        const res = await saveInlineStock(this.pageInstanceId, this.id, value, this.stock);
        if (res?.ok) {
            this.stock = typeof res.stock === 'number' ? res.stock : value;
            this.stockEditor?.refreshDisplay?.();
            return { ok: true };
        }
        return { ok: false, error: res?.error || 'Não foi possível salvar o estoque.' };
    }

    private readPendingNewCost(): number | null {
        try {
            const raw = sessionStorage.getItem(PENDING_NEW_COST_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (typeof parsed?.cost === 'number' && Number.isFinite(parsed.cost) && parsed.cost >= 0) {
                if (Date.now() - (parsed.ts || 0) < 30 * 60 * 1000) {
                    return parsed.cost;
                }
            }
        } catch {}
        return null;
    }

    private writePendingNewCost(value: number): void {
        try {
            sessionStorage.setItem(PENDING_NEW_COST_KEY, JSON.stringify({
                cost: value,
                sku: findBlingProductInput('sku')?.value?.trim() || '',
                name: findBlingProductInput('name')?.value?.trim() || '',
                ts: Date.now()
            }));
        } catch {}
    }

    private clearPendingNewCost(): void {
        try { sessionStorage.removeItem(PENDING_NEW_COST_KEY); } catch {}
    }

    private readPendingNewStock(): number | null {
        try {
            const raw = sessionStorage.getItem(PENDING_NEW_STOCK_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (typeof parsed?.stock === 'number' && Number.isFinite(parsed.stock) && parsed.stock >= 0) {
                if (Date.now() - (parsed.ts || 0) < 30 * 60 * 1000) {
                    return parsed.stock;
                }
            }
        } catch {}
        return null;
    }

    private writePendingNewStock(value: number): void {
        try {
            sessionStorage.setItem(PENDING_NEW_STOCK_KEY, JSON.stringify({
                stock: value,
                sku: findBlingProductInput('sku')?.value?.trim() || '',
                name: findBlingProductInput('name')?.value?.trim() || '',
                ts: Date.now()
            }));
        } catch {}
    }

    private clearPendingNewStock(): void {
        try { sessionStorage.removeItem(PENDING_NEW_STOCK_KEY); } catch {}
    }

    private startObserver(): void {
        if (this.observer || typeof MutationObserver === 'undefined' || !document.body) return;
        this.observer = new MutationObserver(() => {
            window.clearTimeout(this.timer);
            this.timer = window.setTimeout(() => {
                if (this.id) this.mountOrRefresh();
            }, 150);
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    private stopObserver(): void {
        window.clearTimeout(this.timer);
        this.observer?.disconnect();
        this.observer = null;
    }

    update(ui: TabContextUiState): void {
        const qv = ui.quickView;
        if (this.id && this.id !== '__new__' && qv?.productId === this.id) {
            this.cost = qv.costPrice ?? null;
            if (qv.stockInfo) {
                this.stock = qv.stockInfo.virtualTotal ?? qv.stockInfo.physicalTotal ?? null;
            }
        }
        if (this.id) this.mountOrRefresh();
    }

    private mountOrRefresh(): void {
        if (!this.id) return;
        const costField = findBlingProductInput('cost');
        const anchor = costField || findBlingProductInput('price') || findBlingProductInput('sku') || findBlingProductInput('name');
        if (!anchor) return;
        if (!this.host?.isConnected) {
            const id = this.id;
            const isNew = id === '__new__';
            this.host = document.createElement('span');
            this.host.className = 'paulifest-inline-cost';
            this.host.style.cssText = 'display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;vertical-align:middle;';
            this.editor = createCostEditor({
                getCost: () => this.cost,
                isCurrent: () => this.id === id && anchor.isConnected,
                save: async (value, expected) => {
                    const currentCostField = findBlingProductInput('cost');
                    if (currentCostField?.isConnected) {
                        setNativeInputValue(currentCostField, value.toFixed(2).replace('.', ','));
                    }
                    if (isNew) {
                        this.writePendingNewCost(value);
                        return { ok: true, cost: value };
                    }
                    return saveInlineCost(this.pageInstanceId, id, value, expected);
                },
                onSaved: value => {
                    this.cost = value;
                    this.editor?.refreshDisplay?.();
                    const currentCostField = findBlingProductInput('cost');
                    if (currentCostField?.isConnected) {
                        setNativeInputValue(currentCostField, value.toFixed(2).replace('.', ','));
                    }
                },
                successMessage: isNew ? 'Definido ✓' : 'Salvo ✓',
                prefixLabel: 'Custo:'
            });

            this.stockEditor = createStockEditor({
                getStock: () => this.stock,
                isCurrent: () => this.id === id && anchor.isConnected,
                save: async (value, expected) => {
                    const currentStockField = findBlingProductInput('stock');
                    if (currentStockField?.isConnected) {
                        const formatted = Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
                        setNativeInputValue(currentStockField, formatted);
                    }
                    if (isNew) {
                        this.writePendingNewStock(value);
                        return { ok: true, stock: value };
                    }
                    return saveInlineStock(this.pageInstanceId, id, value, expected);
                },
                onSaved: value => {
                    this.stock = value;
                    this.stockEditor?.refreshDisplay?.();
                    const currentStockField = findBlingProductInput('stock');
                    if (currentStockField?.isConnected) {
                        const formatted = Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
                        setNativeInputValue(currentStockField, formatted);
                    }
                },
                successMessage: isNew ? 'Definido ✓' : 'Salvo ✓',
                prefixLabel: 'Estoque:'
            });

            this.host.append(this.editor, this.stockEditor);

            const fieldWrapper = anchor.closest('.form-group, .group-item-form, .field, .mdc-layout-grid__cell, div[class*="col-"]');
            const fieldLabel = (anchor.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(anchor.id)}"]`) : null)
                || fieldWrapper?.querySelector<HTMLElement>('label');
            if (fieldLabel) {
                fieldLabel.style.display = 'flex';
                fieldLabel.style.alignItems = 'center';
                fieldLabel.style.justifyContent = 'space-between';
                fieldLabel.style.width = '100%';
                fieldLabel.appendChild(this.host);
            } else {
                this.host.style.display = 'flex';
                this.host.style.justifyContent = 'flex-end';
                this.host.style.marginTop = '2px';
                (anchor.closest('.input-group, .form-group, .field') || anchor).insertAdjacentElement('afterend', this.host);
            }
        }
        this.editor?.refreshDisplay?.();
        this.stockEditor?.refreshDisplay?.();
    }
}
