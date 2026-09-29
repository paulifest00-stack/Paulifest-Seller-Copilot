import { detectBlingScreenContext } from './dom-identifier.ts';
import { setNativeInputValue } from './form-assistant.ts';
import type { NewProductFormValues } from '../../integrations/bling/new-product-form.ts';

const selectors: Record<keyof NewProductFormValues, string> = {
  nome: 'input#nome, input[name="nome"], input[data-product-name]',
  codigo: 'input#codigo, input[name="codigo"], input[data-product-sku]',
  gtin: 'input#gtin, input[name="gtin"], input#ean, input[name="ean"]',
  marca: 'input#marca, input[name="marca"]',
  ncm: 'input#ncm, input[name="ncm"]',
  descricaoComplementar: 'textarea#descricaoComplementar, textarea[name="descricaoComplementar"]'
};
export function fillNewBlingProduct(values: NewProductFormValues, expectedUrl: string, root: Document = document) {
  const filled: string[] = [], skipped: string[] = [];
  if (window.location.href !== expectedUrl || detectBlingScreenContext(window.location.href, root).pageType !== 'product_form_new') {
    return { ok: false, error: 'O formulário mudou. Abra o cadastro novo novamente.', filled, skipped };
  }
  for (const key of Object.keys(selectors) as (keyof NewProductFormValues)[]) {
    const value = values?.[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (window.location.href !== expectedUrl) { skipped.push(key); continue; }
    const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selectors[key]);
    // Keep user-entered values. Never submit the Bling form automatically.
    if (!field || field.disabled || field.readOnly || field.value.trim() || (field.getClientRects && field.getClientRects().length === 0)) { skipped.push(key); continue; }
    if (field instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(field, value); else field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else { setNativeInputValue(field, value); }
    if (field.value === value) filled.push(key); else skipped.push(key);
  }
  return { ok: true, filled, skipped };
}
