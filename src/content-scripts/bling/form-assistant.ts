import { generateRandomEan13 } from '../../core/engines/identification/ean-generator.ts';
import { generateSkuFromTitle } from '../../core/engines/identification/sku-generator.ts';
type ProductInputName = 'name' | 'sku' | 'ean';
const INPUT_SELECTORS: Record<ProductInputName, string> = {
    name: 'input#nome, input[name="nome"], input[data-product-name]',
    sku: 'input#codigo, input[name="codigo"], input[data-product-sku]',
    ean: 'input#gtin, input[name="gtin"], input#ean, input[name="ean"]'
};
export function findBlingProductInput(kind: ProductInputName, root: Document | HTMLElement = document): HTMLInputElement | null {
    return root.querySelector<HTMLInputElement>(INPUT_SELECTORS[kind]);
}
/** Atualiza o valor e emite os mesmos eventos observados pelos frameworks do formulário. */
export function setNativeInputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set)
        descriptor.set.call(input, value);
    else
        input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}
export class BlingFormAssistant {
    private observer: MutationObserver | null = null;
    private timer: number | undefined;
    private controls = new Map<HTMLInputElement, HTMLElement>();
    start(): void {
        if (this.observer)
            return;
        this.mount();
        this.observer = new MutationObserver(() => {
            window.clearTimeout(this.timer);
            this.timer = window.setTimeout(() => this.mount(), 150);
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }
    destroy(): void {
        window.clearTimeout(this.timer);
        this.observer?.disconnect();
        this.observer = null;
        for (const control of this.controls.values())
            control.remove();
        this.controls.clear();
    }
    private mount(): void {
        for (const [input, control] of this.controls)
            if (!input.isConnected) {
                control.remove();
                this.controls.delete(input);
            }
        for (const kind of ['sku', 'ean'] as const) {
            const input = findBlingProductInput(kind);
            if (!input || this.controls.get(input)?.isConnected)
                continue;
            const host = document.createElement('span');
            host.className = 'paulifest-field-action';
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `<style>
                :host {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    margin-left: auto;
                    font: 400 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    color: #64748b;
                    vertical-align: middle;
                }
                button {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    color: #21845e;
                    background: transparent;
                    border: none;
                    border-radius: 3px;
                    padding: 1px 4px;
                    cursor: pointer;
                    transition: background 0.12s ease, color 0.12s ease;
                    white-space: nowrap;
                }
                button:hover {
                    background: rgba(33, 132, 94, 0.08);
                    color: #166534;
                    text-decoration: underline;
                }
                button:focus-visible {
                    outline: 1.5px solid #21845e;
                    outline-offset: 1px;
                }
                small {
                    font-size: 10.5px;
                    color: #475569;
                    white-space: nowrap;
                }
                small:empty {
                    display: none;
                }
            </style><small role="status" aria-live="polite"></small><button type="button"></button>`;
            const button = shadow.querySelector('button')!, status = shadow.querySelector('small')!;
            let statusTimer: number | undefined;
            const showStatus = (msg: string) => {
                status.textContent = msg;
                window.clearTimeout(statusTimer);
                statusTimer = window.setTimeout(() => { status.textContent = ''; }, 3500);
            };
            button.textContent = kind === 'sku' ? 'Gerar SKU' : 'Gerar EAN';
            button.title = kind === 'sku' ? 'Gerar código SKU automaticamente a partir do nome do produto' : 'Gerar código interno EAN-13';
            button.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!input.isConnected || input.disabled || input.readOnly) {
                    showStatus('Indisponível');
                    return;
                }
                if (input.value.trim()) {
                    showStatus('Limpe o campo antes');
                    return;
                }
                const name = findBlingProductInput('name');
                const value = kind === 'sku' ? generateSkuFromTitle(name?.value || '') : generateRandomEan13();
                if (!value) {
                    showStatus('Preencha o nome primeiro');
                    name?.focus();
                    return;
                }
                setNativeInputValue(input, value);
                showStatus('Preenchido ✓');
            };
            const fieldWrapper = input.closest('.form-group, .group-item-form, .field, .mdc-layout-grid__cell, div[class*="col-"]');
            const fieldLabel = (input.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(input.id)}"]`) : null)
                || fieldWrapper?.querySelector<HTMLElement>('label');
            if (fieldLabel) {
                fieldLabel.style.display = 'flex';
                fieldLabel.style.alignItems = 'center';
                fieldLabel.style.justifyContent = 'space-between';
                fieldLabel.style.width = '100%';
                fieldLabel.appendChild(host);
            } else {
                host.style.display = 'flex';
                host.style.justifyContent = 'flex-end';
                host.style.marginTop = '2px';
                (input.closest('.input-group') || input).insertAdjacentElement('afterend', host);
            }
            this.controls.set(input, host);
        }
    }
}
