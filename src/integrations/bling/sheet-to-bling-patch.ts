import type { AuditedField, CentralProductSheet } from '../../core/schema/product.ts';
import { validateEan } from '../../core/engines/identification/ean-validator.ts';
import type { BlingProductUpdatePatch } from '../../shared/gateway-contracts.ts';

export class BlingSheetPatchError extends Error {}

const usable = <T>(field: AuditedField<T> | undefined): field is AuditedField<T> =>
  Boolean(field && (field.status === 'approved' || field.status === 'edited'));

const positive = (field: AuditedField<number> | undefined): number | undefined =>
  usable(field) && Number.isFinite(field.value) && field.value > 0 ? field.value : undefined;

/** Fact-or-Omit: nunca envia vazio, conflito, valor inválido ou campo fora da whitelist. */
export function buildBlingProductUpdatePatch(sheet: CentralProductSheet): BlingProductUpdatePatch {
  if (sheet.hasUnresolvedConflicts) {
    throw new BlingSheetPatchError('Resolva as divergências da Ficha Central antes de atualizar o Bling.');
  }

  const patch: BlingProductUpdatePatch = {};
  const titleField = usable(sheet.titleBling) && sheet.titleBling.value.trim()
    ? sheet.titleBling
    : sheet.title;
  if (usable(titleField) && titleField.value.trim()) patch.nome = titleField.value.trim().toUpperCase().slice(0, 120);
  if (usable(sheet.sku) && sheet.sku.value.trim()) patch.codigo = sheet.sku.value.trim().slice(0, 100);

  if (usable(sheet.ean) && sheet.ean.value.trim()) {
    const ean = sheet.ean.value.replace(/\D/g, '');
    if (!validateEan(ean).valid) {
      throw new BlingSheetPatchError('O EAN/GTIN da ficha é inválido e não pode ser enviado ao Bling.');
    }
    patch.gtin = ean;
  }

  if (usable(sheet.brand) && sheet.brand.value.trim()) patch.marca = sheet.brand.value.trim().slice(0, 100);
  if (usable(sheet.descriptionPlain) && sheet.descriptionPlain.value.trim()) {
    patch.descricaoComplementar = sheet.descriptionPlain.value.trim();
  }
  if (usable(sheet.ncm) && sheet.ncm.value.trim()) {
    const ncm = sheet.ncm.value.replace(/\D/g, '');
    if (ncm.length !== 8) throw new BlingSheetPatchError('O NCM da ficha é inválido e não pode ser enviado ao Bling.');
    patch.tributacao = { ncm };
  }

  const weight = positive(sheet.packageWeightKg);
  if (weight !== undefined) patch.pesoBruto = weight;
  const altura = positive(sheet.packageHeightCm);
  const largura = positive(sheet.packageWidthCm);
  const profundidade = positive(sheet.packageLengthCm);
  if (altura !== undefined || largura !== undefined || profundidade !== undefined) {
    patch.dimensoes = { unidadeMedida: 1 };
    if (altura !== undefined) patch.dimensoes.altura = altura;
    if (largura !== undefined) patch.dimensoes.largura = largura;
    if (profundidade !== undefined) patch.dimensoes.profundidade = profundidade;
  }

  if (usable(sheet.suggestedSalePrice) && sheet.suggestedSalePrice.value !== null &&
      Number.isFinite(sheet.suggestedSalePrice.value) && sheet.suggestedSalePrice.value >= 0) {
    patch.preco = sheet.suggestedSalePrice.value;
  }

  if (Object.keys(patch).length === 0) {
    throw new BlingSheetPatchError('A Ficha Central não possui campos válidos para atualizar no Bling.');
  }
  return patch;
}
