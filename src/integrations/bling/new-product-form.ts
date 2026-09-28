import type { CentralProductSheet, AuditedField } from '../../core/schema/product.ts';
import { validateEan } from '../../core/engines/identification/ean-validator.ts';
export type NewProductFormValues = Partial<Record<'nome' | 'codigo' | 'gtin' | 'marca' | 'descricaoComplementar' | 'ncm', string>>;
export function buildNewProductFormValues(sheet: CentralProductSheet): NewProductFormValues {
  const values: NewProductFormValues = {};
  const usable = (field?: AuditedField<string>) =>
    Boolean(field && ['approved', 'edited'].includes(field.status) && field.value.trim());
  const title = usable(sheet.titleBling) ? sheet.titleBling : sheet.title;
  if (usable(title)) values.nome = title!.value.trim().toUpperCase().slice(0, 120);
  if (usable(sheet.sku)) values.codigo = sheet.sku.value.trim();
  if (usable(sheet.ean) && validateEan(sheet.ean.value).valid) values.gtin = sheet.ean.value;
  if (usable(sheet.brand)) values.marca = sheet.brand.value.trim();
  if (usable(sheet.descriptionPlain)) values.descricaoComplementar = sheet.descriptionPlain.value.trim();
  if (usable(sheet.ncm) && /^\d{8}$/.test(sheet.ncm.value.replace(/\D/g, ''))) values.ncm = sheet.ncm.value.replace(/\D/g, '');
  return values;
}
