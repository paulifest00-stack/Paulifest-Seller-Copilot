import type { CentralProductSheet } from './product.ts';
import { createAuditedField } from './product.ts';

export const CURRENT_SCHEMA_VERSION = 2;

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidIsoDateString(str: unknown): boolean {
  if (typeof str !== 'string' || !str.trim()) return false;
  const timestamp = Date.parse(str);
  return !isNaN(timestamp);
}

function isValidAuditedField(field: unknown): boolean {
  if (!isObject(field)) return false;
  const validSources = [
    'user_manual', 'ean_catalog', 'bling_erp', 
    'mercadolivre_pdp', 'mercadolivre_cat', 'ai_generated', 'rule_engine'
  ];
  const validStatuses = ['pending_review', 'approved', 'edited', 'conflict', 'missing'];
  
  if (!('value' in field)) return false;
  if (typeof field.source !== 'string' || !validSources.includes(field.source)) return false;
  if (typeof field.status !== 'string' || !validStatuses.includes(field.status)) return false;
  if (typeof field.confidence !== 'number' || isNaN(field.confidence) || field.confidence < 0 || field.confidence > 1) {
    return false;
  }

  if (field.conflictingValues !== undefined) {
    if (!Array.isArray(field.conflictingValues)) return false;
    for (const cv of field.conflictingValues) {
      if (
        !isObject(cv) || 
        !('value' in cv) || 
        typeof cv.source !== 'string' || 
        typeof cv.confidence !== 'number' || 
        isNaN(cv.confidence) || 
        cv.confidence < 0 || 
        cv.confidence > 1
      ) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Valida se um objeto atende a todos os requisitos estruturais e de integridade da CentralProductSheet no Schema v2.
 */
export function validateSheetV2(sheet: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(sheet)) {
    return { isValid: false, errors: ['O payload não é um objeto JSON válido.'] };
  }

  if (sheet.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(`schemaVersion inválido ou incompatível: esperado ${CURRENT_SCHEMA_VERSION}, recebido ${sheet.schemaVersion}`);
  }

  if (typeof sheet.id !== 'string' || !sheet.id.trim()) {
    errors.push('id é obrigatório e deve ser uma string não vazia.');
  }

  if (!isValidIsoDateString(sheet.createdAt)) {
    errors.push(`createdAt deve ser uma string ISO-8601 válida. Recebido: "${sheet.createdAt}"`);
  }

  if (!isValidIsoDateString(sheet.updatedAt)) {
    errors.push(`updatedAt deve ser uma string ISO-8601 válida. Recebido: "${sheet.updatedAt}"`);
  }

  // Validação dos campos auditados essenciais
  const auditedFieldKeys: (keyof CentralProductSheet)[] = [
    'ean', 'sku', 'title', 'brand', 'model',
    'categoryIdML', 'categoryPathML', 'ncm',
    'packageWeightKg', 'packageHeightCm', 'packageWidthCm', 'packageLengthCm',
    'costPrice', 'currentSalePrice', 'suggestedSalePrice',
    'descriptionPlain', 'bulletPoints', 'warrantyDays'
  ];

  for (const key of auditedFieldKeys) {
    if (!isValidAuditedField(sheet[key])) {
      errors.push(`Campo auditado inválido, ausente ou com confidence fora do intervalo [0, 1]: "${String(key)}"`);
    }
  }

  if (!Array.isArray(sheet.images)) {
    errors.push('images deve ser um array.');
  }

  if (!Array.isArray(sheet.attributes)) {
    errors.push('attributes deve ser um array.');
  }

  if (!Array.isArray(sheet.externalReferences)) {
    errors.push('externalReferences deve ser um array.');
  } else {
    for (let i = 0; i < sheet.externalReferences.length; i++) {
      const ref = sheet.externalReferences[i];
      if (!isObject(ref) || typeof ref.system !== 'string' || !ref.system.trim() || typeof ref.externalId !== 'string' || !ref.externalId.trim()) {
        errors.push(`externalReferences[${i}] inválida: esperado objeto com system e externalId não vazios.`);
      } else if (ref.importedAt !== undefined && !isValidIsoDateString(ref.importedAt)) {
        errors.push(`externalReferences[${i}].importedAt não é uma data ISO-8601 válida.`);
      }
    }
  }

  if (
    typeof sheet.overallConfidenceScore !== 'number' || 
    isNaN(sheet.overallConfidenceScore) || 
    sheet.overallConfidenceScore < 0 || 
    sheet.overallConfidenceScore > 1
  ) {
    errors.push(`overallConfidenceScore deve ser um número entre 0 e 1. Recebido: ${sheet.overallConfidenceScore}`);
  }

  if (typeof sheet.hasUnresolvedConflicts !== 'boolean') {
    errors.push(`hasUnresolvedConflicts deve ser boolean. Recebido: ${typeof sheet.hasUnresolvedConflicts}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Migra de forma pura, não-destrutiva e idempotente qualquer ficha de produto (v1 ou legada sem schemaVersion)
 * para a especificação canônica Schema v2.
 * 
 * Regras:
 * 1. Fichas sem schemaVersion são tratadas como v1.
 * 2. Fichas que já são v2 (schemaVersion === 2) são validadas estritamente. Se válidas, retornam; se inválidas, lançam erro.
 * 3. Todos os dados existentes (valores, status, fontes, evidências, conflitos, timestamps) são rigorosamente preservados.
 * 4. Novos campos v2 (externalReferences, currentSalePrice) recebem defaults seguros sem contaminação.
 */
export function migrateSheetToV2(raw: unknown): CentralProductSheet {
  if (!isObject(raw)) {
    throw new Error('Migração abortada: entrada inválida (esperava objeto).');
  }

  // Se já for v2, valida estritamente a conformidade estrutural
  if (raw.schemaVersion === CURRENT_SCHEMA_VERSION) {
    const validation = validateSheetV2(raw);
    if (!validation.isValid) {
      throw new Error(`Ficha Schema v2 existente é inválida: ${validation.errors.join('; ')}`);
    }
    return raw as CentralProductSheet;
  }

  // Ficha legada (v1): sem schemaVersion ou com schemaVersion: 1
  const version = raw.schemaVersion;
  if (version !== undefined && version !== 1) {
    throw new Error(`Migração incompatível: versão desconhecida ${version}.`);
  }

  // Clona com integridade total de dados
  const migrated: any = {
    ...raw,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    externalReferences: Array.isArray(raw.externalReferences) ? [...raw.externalReferences] : [],
    overallConfidenceScore: typeof raw.overallConfidenceScore === 'number' && !isNaN(raw.overallConfidenceScore)
      ? Math.max(0, Math.min(1, raw.overallConfidenceScore))
      : 0,
    hasUnresolvedConflicts: typeof raw.hasUnresolvedConflicts === 'boolean' ? raw.hasUnresolvedConflicts : false
  };

  // Garante que currentSalePrice exista com status missing e sem contaminação com suggestedSalePrice
  if (!isValidAuditedField(raw.currentSalePrice)) {
    migrated.currentSalePrice = createAuditedField(0, 'rule_engine', 0.0, 'missing');
  } else {
    migrated.currentSalePrice = { ...raw.currentSalePrice };
  }

  // Valida o produto resultante da migração
  const validation = validateSheetV2(migrated);
  if (!validation.isValid) {
    throw new Error(`Falha na validação pós-migração: ${validation.errors.join('; ')}`);
  }

  return migrated as CentralProductSheet;
}
