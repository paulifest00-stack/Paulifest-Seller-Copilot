import { generateRandomEan13 } from '../../core/engines/identification/ean-generator.ts';
import { generateSkuFromTitle } from '../../core/engines/identification/sku-generator.ts';
export type ProductInputName = 'name' | 'sku' | 'ean' | 'cost' | 'price' | 'ncm' | 'brand';
const INPUT_SELECTORS: Record<ProductInputName, string> = {
    name: 'input#nome, input[name="nome"], input[data-product-name], input[placeholder*="Nome do produto" i], input[placeholder*="Descrição do produto" i]',
    sku: 'input#codigo, input[name="codigo"], input[data-product-sku], input[placeholder*="Código (SKU)" i]',
    ean: 'input#gtin, input[name="gtin"], input#ean, input[name="ean"], input#gtinEmbalagem, input[name="gtinEmbalagem"], input[placeholder*="GTIN" i], input[placeholder*="EAN" i]',
    cost: 'input#precoCusto, input[name="precoCusto"], input[name="fornecedor.precoCusto"], input#preco_custo, input[id*="precoCusto" i], input[name*="precoCusto" i]',
    price: 'input#preco, input[name="preco"], input[id*="precoVenda" i], input[name*="precoVenda" i]',
    ncm: 'input#ncm, input[name="ncm"], input#classificacaoFiscal, input[name="classificacaoFiscal"]',
    brand: 'input#marca, input[name="marca"]'
};
export function findBlingProductInput(kind: ProductInputName, root: Document | HTMLElement = document): HTMLInputElement | null {
    const selector = INPUT_SELECTORS[kind];
    if (typeof (root as any).querySelectorAll === 'function') {
        const list = Array.from(root.querySelectorAll<HTMLInputElement>(selector));
        if (list.length > 0) {
            const visible = list.find(el => !el.disabled && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
            if (visible) return visible;
            const anyVisible = list.find(el => typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
            if (anyVisible) return anyVisible;
            return list[0];
        }
    }
    return typeof root.querySelector === 'function' ? root.querySelector<HTMLInputElement>(selector) : null;
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
        this.mount();
        if (this.observer)
            return;
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
                    background: rgba(33, 132, 94, 0.06);
                    border: 1px solid rgba(33, 132, 94, 0.22);
                    border-radius: 4px;
                    padding: 2px 6px;
                    cursor: pointer;
                    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
                    white-space: nowrap;
                }
                button:hover {
                    background: rgba(33, 132, 94, 0.14);
                    color: #166534;
                    border-color: rgba(33, 132, 94, 0.4);
                }
                button:focus-visible {
                    outline: 1.5px solid #21845e;
                    outline-offset: 1px;
                }
                small {
                    font-size: 10.5px;
                    color: #15803d;
                    font-weight: 500;
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
            button.textContent = kind === 'sku' ? '⚡ Gerar SKU' : '⚡ Gerar EAN';
            button.title = kind === 'sku' ? 'Gerar código SKU automaticamente a partir do nome do produto' : 'Gerar código interno EAN-13 válido';
            button.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!input.isConnected || input.disabled || input.readOnly) {
                    showStatus('Indisponível');
                    return;
                }
                const name = findBlingProductInput('name');
                const value = kind === 'sku' ? generateSkuFromTitle(name?.value || '') : generateRandomEan13();
                if (!value) {
                    showStatus('Preencha o nome primeiro');
                    name?.focus();
                    return;
                }
                const hadPrevious = Boolean(input.value.trim());
                setNativeInputValue(input, value);
                showStatus(hadPrevious ? 'Novo código gerado ✓' : 'Preenchido ✓');
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
