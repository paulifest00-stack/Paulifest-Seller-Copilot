import { createCostEditor, saveInlineCost } from './cost-editor.ts';
import { setNativeInputValue } from './form-assistant.ts';
import type { TabContextUiState } from '../../shared/tab-context-contracts.ts';
export class BlingCostField {
    private id: string | undefined;
    private host: HTMLElement | null = null;
    private editor: (HTMLElement & { refreshDisplay?: () => void }) | null = null;
    private cost: number | null = null;
    constructor(private pageInstanceId: string) { }
    setTarget(id?: string): void {
        if (id !== this.id) {
            this.host?.remove();
            this.host = null;
            this.editor = null;
            this.id = id;
            this.cost = null;
        }
        if (this.id) this.mountOrRefresh();
    }
    update(ui: TabContextUiState): void {
        const qv = ui.quickView;
        if (this.id && qv?.productId === this.id) {
            this.cost = qv.costPrice ?? null;
        }
        if (this.id) this.mountOrRefresh();
    }
    private mountOrRefresh(): void {
        if (!this.id) return;
        const costField = document.querySelector<HTMLInputElement>('input#precoCusto,input[name="precoCusto"],input[name="fornecedor.precoCusto"],input#preco_custo');
        const anchor = costField || document.querySelector<HTMLInputElement>('input#preco,input[name="preco"],input#codigo,input[name="codigo"],input#nome,input[name="nome"]');
        if (!anchor) return;
        if (!this.host?.isConnected) {
            const id = this.id;
            this.host = document.createElement('span');
            this.host.className = 'paulifest-inline-cost';
            this.host.style.cssText = 'display:inline-flex;align-items:center;margin-left:auto;vertical-align:middle;';
            this.editor = createCostEditor({
                getCost: () => this.cost,
                isCurrent: () => this.id === id && anchor.isConnected,
                save: (value, expected) => saveInlineCost(this.pageInstanceId, id, value, expected),
                onSaved: value => {
                    this.cost = value;
                    this.editor?.refreshDisplay?.();
                    if (costField?.isConnected) setNativeInputValue(costField, value.toFixed(2).replace('.', ','));
                },
                prefixLabel: 'Custo:'
            });
            this.host.append(this.editor);

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
    }
}
