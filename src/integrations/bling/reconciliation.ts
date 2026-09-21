import type { 
  CentralProductSheet, 
  AuditedField 
} from '../../core/schema/product.ts';
import type { BlingMappingOutput, BlingSheetPatch } from './bling-to-sheet.mapper.ts';

export interface BlingReconciliationResult {
  sheet: CentralProductSheet;
  appliedFields: string[];
  corroboratedFields: string[];
  conflictedFields: string[];
  unalteredFields: string[];
  warnings: string[];
  unknownFields: string[];
}

function normalizeComparisonString(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).toLowerCase().trim().replace(/[\s\-_]/g, '');
}

/**
 * Compara se dois valores são substancialmente idênticos / concordantes.
 */
function areValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.0001;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  const normA = normalizeComparisonString(a);
  const normB = normalizeComparisonString(b);
  if (!normA && !normB) return true;
  if (normA === normB) return true;

  // Comparação numérica tolerante (ex: 149.9 vs 149.90 ou "789123" vs 789123)
  const numA = parseFloat(normA);
  const numB = parseFloat(normB);
  if (!isNaN(numA) && !isNaN(numB) && Math.abs(numA - numB) < 0.0001) {
    return true;
  }

  return false;
}

/**
 * Reconcilia um campo auditado individual de forma puramente não-destrutiva.
 */
function reconcileSingleField<T>(
  existingField: AuditedField<T>,
  incomingField: AuditedField<T> | undefined,
  fieldName: string,
  appliedFields: string[],
  corroboratedFields: string[],
  conflictedFields: string[],
  unalteredFields: string[]
): AuditedField<T> {
  // 1. Campo ausente no patch do Bling: preserva sem nenhuma modificação
  if (!incomingField) {
    unalteredFields.push(fieldName);
    return { ...existingField };
  }

  // 2. Campo existente está ausente ('missing') ou com valor padrão vazio: aplica valor do Bling
  const isExistingEmpty = 
    existingField.status === 'missing' ||
    existingField.value === '' || 
    (typeof existingField.value === 'number' && existingField.value === 0 && existingField.confidence === 0);

  if (isExistingEmpty) {
    appliedFields.push(fieldName);
    return {
      value: incomingField.value,
      source: 'bling_erp',
      status: 'pending_review',
      confidence: incomingField.confidence,
      evidence: incomingField.evidence,
      conflictingValues: existingField.conflictingValues ? [...existingField.conflictingValues] : undefined
    };
  }

  // 3. Mesmo valor: corroboração (não gera conflito, reforça confiança)
  if (areValuesEqual(existingField.value, incomingField.value)) {
    corroboratedFields.push(fieldName);
    return {
      ...existingField,
      confidence: Math.min(1.0, Math.max(existingField.confidence, incomingField.confidence) + 0.05)
    };
  }

  // 4. Divergência com valor manual do vendedor ('user_manual' ou 'edited'):
  // REGRA DE OURO: NUNCA sobrescrever dado manual. Cria conflito auditável mantendo o valor do seller!
  const isManual = existingField.source === 'user_manual' || existingField.status === 'edited';
  if (isManual) {
    conflictedFields.push(fieldName);
    const existingConflicts = existingField.conflictingValues ? [...existingField.conflictingValues] : [];
    
    // Adiciona proposta do Bling como divergência se ainda não estiver na lista
    const alreadyListed = existingConflicts.some(c => areValuesEqual(c.value, incomingField.value));
    if (!alreadyListed) {
      existingConflicts.push({
        value: incomingField.value,
        source: 'bling_erp',
        confidence: incomingField.confidence,
        evidence: incomingField.evidence
      });
    }

    return {
      ...existingField,
      status: 'conflict',
      conflictingValues: existingConflicts
    };
  }

  // 5. Divergência com valor existente de outra fonte (ex: IA, catálogo):
  // Registra conflito sem sobrescrita cega
  conflictedFields.push(fieldName);
  const conflicts = existingField.conflictingValues ? [...existingField.conflictingValues] : [];
  const alreadyListed = conflicts.some(c => areValuesEqual(c.value, incomingField.value));
  if (!alreadyListed) {
    conflicts.push({
      value: incomingField.value,
      source: 'bling_erp',
      confidence: incomingField.confidence,
      evidence: incomingField.evidence
    });
  }

  return {
    ...existingField,
    status: 'conflict',
    conflictingValues: conflicts
  };
}

/**
 * Função Pura: Reconcilia um patch de produto do Bling com a CentralProductSheet canônica.
 * 
 * Regras:
 * - Não muta o objeto CentralProductSheet de entrada (imutabilidade absoluta).
 * - Campo missing + valor Bling -> pending_review.
 * - Mesmo valor -> corroboração.
 * - Divergência com valor manual -> gera conflito, NUNCA sobrescreve.
 * - Divergência com valor existente -> gera proposta/conflito.
 * - Campo ausente -> não alterar.
 * - Resposta parcial -> só afeta campos presentes.
 * - Avisos e campos desconhecidos registrados para transparência total.
 */
export function reconcileBlingPatch(
  sheet: CentralProductSheet,
  mapping: BlingMappingOutput
): BlingReconciliationResult {
  const patch: BlingSheetPatch = mapping.patch || {};
  const appliedFields: string[] = [];
  const corroboratedFields: string[] = [];
  const conflictedFields: string[] = [];
  const unalteredFields: string[] = [];

  // Cria cópia imutável profunda da ficha de produto
  const updatedSheet: CentralProductSheet = {
    ...sheet,
    ean: reconcileSingleField(sheet.ean, patch.ean, 'ean', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    sku: reconcileSingleField(sheet.sku, patch.sku, 'sku', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    title: reconcileSingleField(sheet.title, patch.title, 'title', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    brand: reconcileSingleField(sheet.brand, patch.brand, 'brand', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    model: reconcileSingleField(sheet.model, patch.model, 'model', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    ncm: reconcileSingleField(sheet.ncm, patch.ncm, 'ncm', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    packageWeightKg: reconcileSingleField(sheet.packageWeightKg, patch.packageWeightKg, 'packageWeightKg', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    packageHeightCm: reconcileSingleField(sheet.packageHeightCm, patch.packageHeightCm, 'packageHeightCm', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    packageWidthCm: reconcileSingleField(sheet.packageWidthCm, patch.packageWidthCm, 'packageWidthCm', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    packageLengthCm: reconcileSingleField(sheet.packageLengthCm, patch.packageLengthCm, 'packageLengthCm', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    costPrice: reconcileSingleField(sheet.costPrice, patch.costPrice, 'costPrice', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    currentSalePrice: reconcileSingleField(sheet.currentSalePrice, patch.currentSalePrice, 'currentSalePrice', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    descriptionPlain: reconcileSingleField(sheet.descriptionPlain, patch.descriptionPlain, 'descriptionPlain', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    stockInfo: patch.stockInfo
      ? (sheet.stockInfo
          ? reconcileSingleField(sheet.stockInfo as any, patch.stockInfo as any, 'stockInfo', appliedFields, corroboratedFields, conflictedFields, unalteredFields)
          : patch.stockInfo)
      : sheet.stockInfo,
    suggestedSalePrice: reconcileSingleField(sheet.suggestedSalePrice, undefined, 'suggestedSalePrice', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    categoryIdML: reconcileSingleField(sheet.categoryIdML, undefined, 'categoryIdML', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    categoryPathML: reconcileSingleField(sheet.categoryPathML, undefined, 'categoryPathML', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    bulletPoints: reconcileSingleField(sheet.bulletPoints, undefined, 'bulletPoints', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    warrantyDays: reconcileSingleField(sheet.warrantyDays, undefined, 'warrantyDays', appliedFields, corroboratedFields, conflictedFields, unalteredFields),
    attributes: [...sheet.attributes],
    images: [...sheet.images],
    externalReferences: sheet.externalReferences ? [...sheet.externalReferences] : []
  };

  // Imagens: se fornecidas e sheet não tem imagens, aplica; caso tenha, mescla URLs não repetidas
  if (patch.images && patch.images.length > 0) {
    if (updatedSheet.images.length === 0) {
      updatedSheet.images = [...patch.images];
      appliedFields.push('images');
    } else {
      const existingUrls = new Set(updatedSheet.images.map(img => img.url));
      const newImages = patch.images.filter(img => !existingUrls.has(img.url));
      if (newImages.length > 0) {
        updatedSheet.images = [...updatedSheet.images, ...newImages];
        appliedFields.push('images');
      } else {
        corroboratedFields.push('images');
      }
    }
  } else {
    unalteredFields.push('images');
  }

  // Atualiza externalReferences se houver referência do Bling
  const extRef = mapping.externalReference || patch.externalReference;
  if (extRef) {
    const existingIndex = updatedSheet.externalReferences.findIndex(
      r => r.system === extRef.system && r.externalId === extRef.externalId
    );
    if (existingIndex >= 0) {
      updatedSheet.externalReferences[existingIndex] = {
        ...updatedSheet.externalReferences[existingIndex],
        lastSyncedAt: extRef.lastSyncedAt || new Date().toISOString()
      };
    } else {
      updatedSheet.externalReferences.push({ ...extRef });
    }
  }

  // Atualiza hasUnresolvedConflicts
  updatedSheet.hasUnresolvedConflicts = 
    sheet.hasUnresolvedConflicts || conflictedFields.length > 0;
  updatedSheet.updatedAt = new Date().toISOString();

  return {
    sheet: updatedSheet,
    appliedFields,
    corroboratedFields,
    conflictedFields,
    unalteredFields,
    warnings: mapping.warnings ? [...mapping.warnings] : [],
    unknownFields: mapping.unknownFields ? [...mapping.unknownFields] : []
  };
}
