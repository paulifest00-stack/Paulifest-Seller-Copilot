import { createAuditedField, type AuditedField, type CentralProductSheet } from '../../schema/product.ts';
import { generateSkuFromTitle } from './sku-generator.ts';
import { limitMlTitle } from '../../services/gemini-client.ts';

export interface SheetChangeContext {
  kind: 'brand' | 'model' | 'attribute' | 'titleBling' | 'dimensions' | 'warranty';
  oldValue?: string;
  newValue?: string;
  attributeName?: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toTitleCasePt(text: string): string {
  const lowerStopwords = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'em', 'por', 'e', 'ou', 'a', 'o', 'c/']);
  return text
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && lowerStopwords.has(lower)) return lower;
      if (/^\d+(ml|g|kg|un|cm|mm|m|l|pol|w|v)$/i.test(word)) return word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function replaceTokenCaseAware(text: string, oldToken: string, newToken: string, forceUppercase = false): string {
  const cleanOld = (oldToken || '').trim();
  const cleanNew = (newToken || '').trim();
  if (!cleanOld || cleanOld.length < 2 || ! text) return text;
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(cleanOld)})(?=[^\\p{L}\\p{N}]|$)`, 'giu');
  return text.replace(regex, (_match, prefix) => {
    if (!cleanNew) return prefix;
    return `${prefix}${forceUppercase ? cleanNew.toUpperCase() : cleanNew}`;
  }).replace(/\s{2,}/g, ' ').trim();
}

function reviewed(field: AuditedField<unknown> | undefined): boolean {
  return field?.status === 'approved' || field?.status === 'edited';
}

export function buildTechnicalSpecsBlock(sheet: CentralProductSheet): string {
  const lines: string[] = [];
  const name = (reviewed(sheet.titleBling) ? sheet.titleBling!.value : reviewed(sheet.title) ? sheet.title.value : '').trim();
  if (name) lines.push(`• Produto: ${toTitleCasePt(name)}`);
  if (reviewed(sheet.brand) && sheet.brand.value?.trim()) lines.push(`• Marca: ${sheet.brand.value.trim()}`);
  if (reviewed(sheet.model) && sheet.model.value?.trim()) lines.push(`• Modelo / Linha: ${sheet.model.value.trim()}`);
  if (reviewed(sheet.sku) && sheet.sku.value?.trim()) lines.push(`• Código / Referência (SKU): ${sheet.sku.value.trim()}`);

  for (const attr of sheet.attributes) {
    const attrName = (attr.name || '').trim();
    const attrVal = (attr.field?.value || '').trim();
    if (attrName && attrVal && reviewed(attr.field)) {
      lines.push(`• ${attrName}: ${attrVal}`);
    }
  }

  const h = sheet.packageHeightCm.value;
  const w = sheet.packageWidthCm.value;
  const l = sheet.packageLengthCm.value;
  if ([sheet.packageHeightCm, sheet.packageWidthCm, sheet.packageLengthCm].every(field => reviewed(field) && Number.isFinite(field.value) && field.value > 0)) {
    lines.push(`• Dimensões da embalagem (A x L x C): ${h} cm x ${w} cm x ${l} cm`);
  }
  if (reviewed(sheet.packageWeightKg) && sheet.packageWeightKg.value && sheet.packageWeightKg.value > 0) {
    lines.push(`• Peso aproximado: ${sheet.packageWeightKg.value} kg`);
  }
  if (reviewed(sheet.warrantyDays) && sheet.warrantyDays.value && sheet.warrantyDays.value > 0) {
    lines.push(`• Garantia do vendedor: ${sheet.warrantyDays.value} dias`);
  }

  if (lines.length === 0) return '';
  return `ESPECIFICAÇÕES TÉCNICAS:\n${lines.join('\n')}`;
}

export function syncDescriptionWithSpecs(currentDesc: string, sheet: CentralProductSheet, oldVal?: string, newVal?: string): string {
  const specsBlock = buildTechnicalSpecsBlock(sheet);
  let base = (currentDesc || '').trim();

  if (oldVal && oldVal.trim().length >= 2 && newVal !== undefined) {
    base = replaceTokenCaseAware(base, oldVal, newVal, false);
  }

  const markerRegex = /\n*ESPECIFICAÇÕES TÉCNICAS:\n(?:•[^\n]*(?:\n|$))*/i;
  if (markerRegex.test(base)) {
    return specsBlock ? base.replace(markerRegex, `\n\n${specsBlock}\n\n`).trim() : base.replace(markerRegex, '').trim();
  }

  if (!base) {
    const title = toTitleCasePt(sheet.titleBling?.value || sheet.title.value || '');
    if (!title) return '';
    return specsBlock ? `${title}\n\n${specsBlock}` : title;
  }

  return specsBlock ? `${base}\n\n${specsBlock}` : base;
}

/**
 * Adapts all dependent fields in the CentralProductSheet when the user edits
 * Brand, Model, Technical Attributes, Name (Bling), or Dimensions/Weight.
 */
export function adaptSheetToTechnicalChanges(
  prevSheet: CentralProductSheet,
  nextSheet: CentralProductSheet,
  change: SheetChangeContext
): CentralProductSheet {
  const updated = { ...nextSheet };
  const oldVal = (change.oldValue || '').trim();
  const newVal = (change.newValue || '').trim();

  // 1. Adapt Nome no Bling (titleBling)
  let currentBlingTitle = (updated.titleBling?.value || updated.title.value || '').trim().toUpperCase();
  if (change.kind !== 'titleBling' && currentBlingTitle) {
    if (oldVal && oldVal.length >= 2 && currentBlingTitle.toLowerCase().includes(oldVal.toLowerCase())) {
      currentBlingTitle = replaceTokenCaseAware(currentBlingTitle, oldVal, newVal, true);
    } else if ((change.kind === 'brand' || change.kind === 'model') && newVal && !currentBlingTitle.toLowerCase().includes(newVal.toLowerCase())) {
      currentBlingTitle = `${currentBlingTitle} ${newVal.toUpperCase()}`.replace(/\s{2,}/g, ' ').trim();
    } else if (
      change.kind === 'attribute' &&
      newVal &&
      change.attributeName &&
      /^(cor|tamanho|capacidade|volume|quantidade|medida|voltagem|tensão|potência|material)$/i.test(change.attributeName.trim()) &&
      !currentBlingTitle.toLowerCase().includes(newVal.toLowerCase())
    ) {
      currentBlingTitle = `${currentBlingTitle} ${newVal.toUpperCase()}`.replace(/\s{2,}/g, ' ').trim();
    }
    if (currentBlingTitle !== (updated.titleBling?.value || '')) {
      updated.titleBling = createAuditedField(
        currentBlingTitle,
        'user_manual',
        1.0,
        currentBlingTitle ? 'approved' : 'missing',
        updated.titleBling?.evidence
      );
    }
  }

  // 2. Adapt Título do Mercado Livre (title - max 60 chars)
  let currentMlTitle = (updated.title.value || '').trim();
  const prevBlingTitle = (prevSheet.titleBling?.value || '').trim();
  const mlWasDerivedFromBling =
    !currentMlTitle ||
    currentMlTitle.toLowerCase() === prevBlingTitle.toLowerCase() ||
    currentMlTitle.toLowerCase() === limitMlTitle(prevBlingTitle).toLowerCase() ||
    updated.title.source === 'ai_generated' ||
    updated.title.source === 'bling_erp' ||
    updated.title.source === 'rule_engine';

  if (updated.title.source !== 'user_manual' && oldVal && oldVal.length >= 2 && currentMlTitle.toLowerCase().includes(oldVal.toLowerCase())) {
    currentMlTitle = limitMlTitle(replaceTokenCaseAware(currentMlTitle, oldVal, toTitleCasePt(newVal), false));
  } else if (updated.title.source !== 'user_manual' && mlWasDerivedFromBling && currentBlingTitle) {
    currentMlTitle = limitMlTitle(toTitleCasePt(currentBlingTitle));
  } else if (updated.title.source !== 'user_manual' && (change.kind === 'brand' || change.kind === 'model' || change.kind === 'attribute') && newVal && currentMlTitle && !currentMlTitle.toLowerCase().includes(newVal.toLowerCase())) {
    const candidate = `${currentMlTitle} ${toTitleCasePt(newVal)}`.replace(/\s{2,}/g, ' ').trim();
    if (candidate.length <= 60) currentMlTitle = candidate;
  }

  if (currentMlTitle && currentMlTitle !== updated.title.value) {
    updated.title = createAuditedField(
      currentMlTitle,
      'rule_engine',
      0.95,
      'pending_review',
      updated.title.evidence
    );
  }

  // 3. Adapt SKU automatically if SKU is empty or was auto-generated
  if (currentBlingTitle) {
    try {
      const prevAutoSku = prevBlingTitle ? generateSkuFromTitle(prevBlingTitle) : '';
      const newAutoSku = generateSkuFromTitle(currentBlingTitle);
      const currentSku = (updated.sku.value || '').trim();
      const shouldUpdateSku =
        !currentSku ||
        currentSku === prevAutoSku ||
        updated.sku.source === 'rule_engine' ||
        updated.sku.source === 'ai_generated';

      if (!updated.externalReferences.length && shouldUpdateSku && newAutoSku && newAutoSku !== currentSku) {
        const oldParentPrefix = currentSku.split('-')[0];
        const newParentPrefix = newAutoSku.split('-')[0];
        updated.sku = createAuditedField(newAutoSku, 'rule_engine', 1.0, 'approved', updated.sku.evidence);

        if (updated.workbench?.variations?.length && oldParentPrefix && newParentPrefix) {
          updated.workbench = {
            ...updated.workbench,
            variations: updated.workbench.variations.map(v => ({
              ...v,
              sku: v.sku.startsWith(`${oldParentPrefix}-`)
                ? `${newParentPrefix}-${v.sku.slice(oldParentPrefix.length + 1)}`
                : v.sku.includes('-')
                ? `${newParentPrefix}-${v.sku.split('-').slice(1).join('-')}`
                : newParentPrefix
            }))
          };
        }
      }
    } catch {
      // Preserve existing SKU if title doesn't have enough letters yet
    }
  }

  // 4. Adapt Description (descriptionPlain) with live technical specs
  const nextDesc = updated.descriptionPlain.source === 'user_manual' && updated.descriptionPlain.value.trim()
    ? updated.descriptionPlain.value
    : syncDescriptionWithSpecs(updated.descriptionPlain.value, updated, oldVal, newVal);
  if (nextDesc && nextDesc !== updated.descriptionPlain.value) {
    updated.descriptionPlain = createAuditedField(
      nextDesc,
      updated.descriptionPlain.status === 'missing' ? 'rule_engine' : updated.descriptionPlain.source,
      updated.descriptionPlain.confidence,
      updated.descriptionPlain.status === 'conflict' ? 'conflict' : 'pending_review',
      updated.descriptionPlain.evidence
    );
  }

  // 5. Adapt SEO Keywords if present
  if (updated.workbench?.keywords?.value && oldVal && oldVal.length >= 2 && newVal) {
    const kw = updated.workbench.keywords.value;
    const replaceList = (list: string[]) =>
      list.map(item => replaceTokenCaseAware(item, oldVal, newVal.toLowerCase(), false));
    updated.workbench = {
      ...updated.workbench,
      keywords: {
        ...updated.workbench.keywords,
        value: {
          principais: replaceList(kw.principais || []),
          relacionadas: replaceList(kw.relacionadas || []),
          variacoes: replaceList(kw.variacoes || [])
        }
      }
    };
  }

  return updated;
}

/** Prepare missing suggestions without approving or replacing reviewed data. */
export function prepareBlingSheetForMlExport(sheet: CentralProductSheet): CentralProductSheet {
  const next = structuredClone(sheet);
  const rawName = (next.titleBling?.value || '').trim();
  if (!next.title.value.trim() && next.title.status !== 'conflict' && rawName) {
    next.title = createAuditedField(limitMlTitle(toTitleCasePt(rawName)), 'rule_engine', 0.95, 'pending_review', next.titleBling?.evidence);
  }
  if ((next.suggestedSalePrice.value === null || next.suggestedSalePrice.value <= 0)
      && next.suggestedSalePrice.status !== 'conflict'
      && reviewed(next.currentSalePrice) && next.currentSalePrice.value! > 0) {
    next.suggestedSalePrice = createAuditedField(next.currentSalePrice.value, 'rule_engine', 0.95, 'pending_review', next.currentSalePrice.evidence);
  }
  if (!next.descriptionPlain.value.trim() && next.descriptionPlain.status !== 'conflict') {
    const specs = buildTechnicalSpecsBlock(next);
    if (specs) next.descriptionPlain = createAuditedField(specs, 'rule_engine', 0.95, 'pending_review');
  }
  return next;
}
