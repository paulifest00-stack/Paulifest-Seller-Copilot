import { isGeneratedEan } from '../../core/engines/identification/ean-generator.ts';
import type { CentralProductSheet, AuditedField } from '../../core/schema/product.ts';
import type { MlAttribute, MlListingDraft } from '../../shared/mercadolivre-contracts.ts';
export const reviewed = (field?: AuditedField<unknown>) => !!field && ['approved', 'edited'].includes(field.status) && field.value !== null && field.value !== '';
export function sheetMlAttributes(sheet: CentralProductSheet): MlAttribute[] {
  const values: MlAttribute[] = [];
  if (reviewed(sheet.brand)) values.push({ id: 'BRAND', value_name: sheet.brand.value });
  if (reviewed(sheet.model)) values.push({ id: 'MODEL', value_name: sheet.model.value });
  if (reviewed(sheet.ean) && !isGeneratedEan(sheet.ean)) values.push({ id: 'GTIN', value_name: sheet.ean.value });
  for (const attr of sheet.attributes) if (/^[A-Z0-9_]{1,80}$/.test(attr.id) && reviewed(attr.field) && !values.some(a => a.id === attr.id)) values.push({ id: attr.id, value_name: attr.field.value });
  return values;
}
export function sheetToMlDraft(sheet: CentralProductSheet, options: Omit<MlListingDraft, 'sheetId' | 'title' | 'sku' | 'description'>): MlListingDraft {
  if (!reviewed(sheet.title) || !reviewed(sheet.sku)) throw new Error('Revise o título e o SKU na ficha antes de preparar a publicação.');
  if (sheet.hasUnresolvedConflicts || [sheet.title, sheet.sku, sheet.brand, sheet.ean].some(f => f.status === 'conflict')) throw new Error('Resolva os conflitos da ficha antes de publicar.');
  if (!reviewed(sheet.descriptionPlain)) throw new Error('Revise a descrição antes de publicar.');
  if (options.attributes.some(a => a.id === 'GTIN' && isGeneratedEan(sheet.ean) && a.value_name === sheet.ean.value)) throw new Error('O EAN interno gerado não pode ser enviado como GTIN registrado. Use o código real ou a condição sem GTIN da categoria.');
  return { ...options, sheetId: sheet.id, title: sheet.title.value, sku: sheet.sku.value, description: sheet.descriptionPlain.value };
}
