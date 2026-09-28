import type { MlListingDraft } from '../../shared/mercadolivre-contracts.ts';
import { validateEan } from '../../core/engines/identification/ean-validator.ts';

export function validateMlDraft(raw: unknown): MlListingDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Rascunho inválido.');
  const value = raw as MlListingDraft;
  const text = (key: keyof MlListingDraft, max: number, required = true) => {
    const item = value[key];
    if (typeof item !== 'string' || item.length > max || (required && !item.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item)) throw new Error(`Campo inválido: ${key}.`);
  };
  text('sheetId', 128); text('title', 120); text('familyName', 120); text('sku', 50); text('description', 20000, false);
  if (!/^MLB\d+$/.test(value.categoryId)) throw new Error('Informe uma categoria MLB válida.');
  if (!Number.isFinite(value.price) || value.price <= 0 || value.price > 1e8) throw new Error('Preço inválido.');
  if (!Number.isSafeInteger(value.quantity) || value.quantity < 1 || value.quantity > 1e6) throw new Error('Estoque para publicação deve ser inteiro positivo.');
  if (!['gold_special', 'gold_pro'].includes(value.listingType) || !['new', 'used'].includes(value.condition)) throw new Error('Tipo ou condição de anúncio inválido.');
  if (!['me2', 'custom'].includes(value.shippingMode) || typeof value.freeShipping !== 'boolean' || typeof value.localPickup !== 'boolean') throw new Error('Condições de entrega inválidas.');
  if (!Array.isArray(value.pictureIds) || !value.pictureIds.length || value.pictureIds.length > 12 || value.pictureIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{5,128}$/.test(id))) throw new Error('Envie entre 1 e 12 fotos revisadas.');
  if (!Array.isArray(value.attributes) || value.attributes.length > 100) throw new Error('Atributos inválidos.');
  const ids = new Set<string>();
  for (const attribute of value.attributes) {
    if (!attribute || typeof attribute.id !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(attribute.id) || ids.has(attribute.id)) throw new Error('Atributo duplicado ou inválido.');
    ids.add(attribute.id);
    if (!attribute.value_name && !attribute.value_id) throw new Error(`Preencha ${attribute.id}.`);
    if (attribute.value_name !== undefined && (typeof attribute.value_name !== 'string' || attribute.value_name.length > 500)) throw new Error('Valor de atributo inválido.');
    if (attribute.value_id !== undefined && (typeof attribute.value_id !== 'string' || !/^-?\d{1,24}$/.test(attribute.value_id))) throw new Error('ID de valor de atributo inválido.');
    if (attribute.id === 'GTIN' && (!attribute.value_name || !validateEan(attribute.value_name).valid)) throw new Error('GTIN inválido.');
  }
  return { sheetId: value.sheetId, title: value.title.trim(), familyName: value.familyName.trim(), categoryId: value.categoryId, price: value.price, quantity: value.quantity,
    listingType: value.listingType, condition: value.condition, sku: value.sku.trim(), description: value.description.trim(),
    attributes: value.attributes.map(a => ({ id: a.id, ...(a.value_id ? { value_id: a.value_id } : { value_name: a.value_name!.trim() }) })), pictureIds: [...new Set(value.pictureIds)],
    shippingMode: value.shippingMode, freeShipping: value.freeShipping, localPickup: value.localPickup };
}

export function buildMlPayload(draft: MlListingDraft, tags: string[]): Record<string, unknown> {
  if (tags.includes('warehouse_management')) throw new Error('Esta conta exige estoque por depósito. Configure o anúncio pelo fluxo de estoque multiorigem do Mercado Livre; envio por quantidade simples foi bloqueado.');
  const up = tags.includes('user_product_seller');
  return { ...(up ? { family_name: draft.familyName } : { title: draft.title }), category_id: draft.categoryId,
    price: draft.price, currency_id: 'BRL', available_quantity: draft.quantity, buying_mode: 'buy_it_now', listing_type_id: draft.listingType,
    condition: draft.condition, channels: ['marketplace'], pictures: draft.pictureIds.map(id => ({ id })),
    attributes: [...draft.attributes.filter(a => a.id !== 'SELLER_SKU'), { id: 'SELLER_SKU', value_name: draft.sku }],
    shipping: { mode: draft.shippingMode, free_shipping: draft.freeShipping, local_pick_up: draft.localPickup } };
}
