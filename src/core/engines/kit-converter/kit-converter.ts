import { createAuditedField, type CentralProductSheet } from '../../schema/product.ts';
import { assignGeneratedEan } from '../identification/ean-generator.ts';
import { limitMlTitle } from '../../services/gemini-client.ts';

export function skuForKit(sku: string, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('Use uma quantidade inteira entre 1 e 999.');
  const [parent, ...variation] = sku.toUpperCase().split('-');
  if (!parent) return '';
  const base = parent.replace(/K\d{2,3}$/, '');
  return base + (quantity > 1 ? `K${String(quantity).padStart(2, '0')}` : '') + (variation.length ? '-' + variation.join('-') : '');
}

/** A new listing identity. Never mutates or inherits external write targets. */
export function convertToKit(source: CentralProductSheet, quantity: number): CentralProductSheet {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('Use uma quantidade inteira entre 1 e 999.');
  const baseName = source.workbench?.kit?.baseName || source.titleBling?.value || source.title.value;
  if (!baseName.trim()) throw new Error('Preencha o nome do produto antes de criar um kit.');
  const baseSku = source.workbench?.kit?.baseSku || source.sku.value;
  const oldQuantity = source.workbench?.kit?.quantity || 1;
  const now = new Date().toISOString();
  const result = structuredClone(source);
  result.id = `prod_${crypto.randomUUID()}`;
  result.createdAt = result.updatedAt = now;
  result.externalReferences = [];
  result.stockInfo = undefined;
  result.pricingDraft = undefined;
  result.title = createAuditedField(limitMlTitle((quantity > 1 ? `Kit ${quantity} ` : '') + baseName), 'rule_engine', 1, 'pending_review');
  result.titleBling = createAuditedField(((quantity > 1 ? `KIT ${quantity} ` : '') + baseName).toUpperCase(), 'rule_engine', 1, 'pending_review');
  result.sku = createAuditedField(skuForKit(baseSku, quantity), 'rule_engine', 1, baseSku ? 'pending_review' : 'missing');
  result.ean = createAuditedField('', 'rule_engine', 0, 'missing');
  result.descriptionPlain = createAuditedField(`Conteúdo: ${quantity} ${quantity === 1 ? 'unidade' : 'unidades'} de ${baseName}.`, 'rule_engine', 1, 'pending_review');
  result.bulletPoints = createAuditedField([], 'rule_engine', 0, 'missing');
  for (const key of ['packageWeightKg', 'packageHeightCm', 'packageWidthCm', 'packageLengthCm'] as const) result[key] = createAuditedField(0, 'rule_engine', 0, 'missing');
  for (const key of ['currentSalePrice', 'suggestedSalePrice'] as const) result[key] = createAuditedField<number | null>(null, 'rule_engine', 0, 'missing');
  if (source.costPrice.value !== null && ['approved', 'edited'].includes(source.costPrice.status)) {
    result.costPrice = createAuditedField(Math.round(source.costPrice.value / oldQuantity * quantity * 100) / 100, 'rule_engine', 1, 'pending_review', {
      capturedAt: now, sourceName: 'Custo das unidades', extractedSnippet: `Custo proporcional de ${quantity} unidades, sem embalagem adicional.`
    });
  } else result.costPrice = createAuditedField<number | null>(null, 'rule_engine', 0, 'missing');
  // Photos and attributes may describe the original pack; they require explicit review.
  result.images = result.images.map(image => ({ ...image, isMain: false, status: createAuditedField('warning', 'rule_engine', 1, 'pending_review') }));
  result.attributes = result.attributes.map(attribute => ({ ...attribute, field: { ...attribute.field, status: attribute.field.status === 'missing' ? 'missing' : 'pending_review' } }));
  result.workbench = { kit: { quantity, baseSheetId: source.workbench?.kit?.baseSheetId || source.id, baseName, baseSku } };
  result.hasUnresolvedConflicts = false;
  result.overallConfidenceScore = 0;
  result.preparationStatus = 'pending_review';
  return assignGeneratedEan(result);
}
