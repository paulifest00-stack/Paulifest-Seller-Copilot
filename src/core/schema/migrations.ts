import type { CentralProductSheet, ProductPreparationStatus } from './product.ts';
import { createAuditedField, evaluatePreparationStatus } from './product.ts';

export const CURRENT_SCHEMA_VERSION = 3;

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

/**
 * Valida AuditedField para Schema v2 (compatibilidade legada).
 */
export function isValidAuditedField(field: unknown): boolean {
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
 * Validador de AuditedField para Schema v3 aplicando o invariante estrito de ausência real:
 * - status === 'missing' -> value pode ser null
 * - status !== 'missing' -> value NÃO pode ser null (e não pode ser undefined)
 * - conflictingValues continuam representando valores reais e NÃO podem conter null
 */
export function isValidAuditedFieldV3(field: unknown): boolean {
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

  // Invariante Estrito de Ausência Real:
  if (field.status === 'missing') {
    // value pode ser null, string vazia, ou número
  } else {
    // Se status !== 'missing', value não pode ser null nem undefined
    if (field.value === null || field.value === undefined) {
      return false;
    }
  }

  // conflictingValues: sempre valores concorrentes reais, nunca null
  if (field.conflictingValues !== undefined) {
    if (!Array.isArray(field.conflictingValues)) return false;
    for (const cv of field.conflictingValues) {
      if (
        !isObject(cv) ||
        !('value' in cv) ||
        cv.value === null ||
        cv.value === undefined ||
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

  if (sheet.schemaVersion !== 2) {
    errors.push(`schemaVersion inválido ou incompatível: esperado 2, recebido ${sheet.schemaVersion}`);
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

  const auditedFieldKeys = [
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
 * Valida se um objeto atende a todos os requisitos estruturais e de integridade da CentralProductSheet no Schema v3 (Fase 4D.1).
 */
export function validateSheetV3(sheet: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(sheet)) {
    return { isValid: false, errors: ['O payload não é um objeto JSON válido.'] };
  }

  if (sheet.schemaVersion !== 3) {
    errors.push(`schemaVersion inválido ou incompatível: esperado 3, recebido ${sheet.schemaVersion}`);
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

  if (sheet.migratedAt !== undefined && !isValidIsoDateString(sheet.migratedAt)) {
    errors.push(`migratedAt deve ser uma string ISO-8601 válida quando fornecido. Recebido: "${sheet.migratedAt}"`);
  }

  if (sheet.migrationNotes !== undefined) {
    if (!Array.isArray(sheet.migrationNotes) || sheet.migrationNotes.some((n: any) => typeof n !== 'string')) {
      errors.push('migrationNotes deve ser um array de strings quando fornecido.');
    }
  }

  // Validação dos campos auditados com regras v3 (invariante estrito de null)
  const auditedFieldKeys = [
    'ean', 'sku', 'title', 'brand', 'model',
    'categoryIdML', 'categoryPathML', 'ncm',
    'packageWeightKg', 'packageHeightCm', 'packageWidthCm', 'packageLengthCm',
    'costPrice', 'currentSalePrice', 'suggestedSalePrice',
    'descriptionPlain', 'bulletPoints', 'warrantyDays'
  ];

  for (const key of auditedFieldKeys) {
    if (!isValidAuditedFieldV3(sheet[key])) {
      errors.push(`Campo auditado inválido, ausente ou violando invariante de null: "${String(key)}"`);
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

  // Validação de stockInfo quando presente
  if (sheet.stockInfo !== undefined && sheet.stockInfo !== null) {
    if (!isValidAuditedFieldV3(sheet.stockInfo)) {
      errors.push('stockInfo deve ser um AuditedField válido.');
    } else if (sheet.stockInfo.value !== null) {
      const val = sheet.stockInfo.value;
      if (!isObject(val) || typeof val.physicalTotal !== 'number' || typeof val.virtualTotal !== 'number' || val.source !== 'bling_erp') {
        errors.push('stockInfo.value deve ser um ProductStockInfo válido.');
      }
    }
  }

  // Validação de preparationStatus
  const validPrepStatuses: ProductPreparationStatus[] = ['ready_for_review', 'pending_review', 'incomplete', 'has_conflicts'];
  if (typeof sheet.preparationStatus !== 'string' || !validPrepStatuses.includes(sheet.preparationStatus as any)) {
    errors.push(`preparationStatus inválido ou ausente: recebido "${sheet.preparationStatus}".`);
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
 * para a especificação intermediária Schema v2.
 */
export function migrateSheetToV2(raw: unknown): any {
  if (!isObject(raw)) {
    throw new Error('Migração abortada: entrada inválida (esperava objeto).');
  }

  if (raw.schemaVersion === 2) {
    const validation = validateSheetV2(raw);
    if (!validation.isValid) {
      throw new Error(`Ficha Schema v2 existente é inválida: ${validation.errors.join('; ')}`);
    }
    return raw;
  }

  const version = raw.schemaVersion;
  if (version !== undefined && version !== 1) {
    throw new Error(`Migração incompatível: versão desconhecida ${version}.`);
  }

  const migrated: any = {
    ...raw,
    schemaVersion: 2,
    externalReferences: Array.isArray(raw.externalReferences) ? [...raw.externalReferences] : [],
    overallConfidenceScore: typeof raw.overallConfidenceScore === 'number' && !isNaN(raw.overallConfidenceScore)
      ? Math.max(0, Math.min(1, raw.overallConfidenceScore))
      : 0,
    hasUnresolvedConflicts: typeof raw.hasUnresolvedConflicts === 'boolean' ? raw.hasUnresolvedConflicts : false
  };

  if (!isValidAuditedField(raw.currentSalePrice)) {
    migrated.currentSalePrice = createAuditedField(0, 'rule_engine', 0.0, 'missing');
  } else {
    migrated.currentSalePrice = { ...raw.currentSalePrice };
  }

  const validation = validateSheetV2(migrated);
  if (!validation.isValid) {
    throw new Error(`Falha na validação pós-migração v2: ${validation.errors.join('; ')}`);
  }

  return migrated;
}

/**
 * Migra de forma pura, determinística, idempotente e não-destrutiva qualquer ficha
 * (v1/legada ou v2) para a especificação canônica Schema v3 (Fase 4D.1).
 *
 * Regras:
 * 1. Fichas v1/legadas passam por v1 -> v2 e em seguida para v3.
 * 2. Fichas que já são v3 (schemaVersion === 3) são validadas estritamente via validateSheetV3 e retornam inalteradas.
 * 3. Se schemaVersion for desconhecido (ex: 4, -1, 99), falha fechado (fail-closed).
 * 4. Fichas v2:
 *    - Preservam 100% de evidências, fontes, status, valores manuais, referências e timestamps;
 *    - costPrice com status === 'missing' && value === 0 é migrado para value === null (eliminação de zero sintético);
 *    - costPrice com status !== 'missing' && value === 0 permanece rigorosamente 0 (zero explícito preservado);
 *    - currentSalePrice e suggestedSalePrice com status === 'missing' e value === 0 migram para value === null;
 *    - preparationStatus é computado deterministicamente via evaluatePreparationStatus;
 *    - stockInfo é inicializado como undefined (sem fabricação de dados de estoque);
 *    - migratedAt e migrationNotes registram a trilha auditável da migração.
 */
export function migrateSheetToV3(raw: unknown): CentralProductSheet {
  if (!isObject(raw)) {
    throw new Error('Migração abortada: entrada inválida (esperava objeto JSON).');
  }

  // 1. Se já for v3, valida estritamente e retorna sem mutação (idempotência)
  if (raw.schemaVersion === CURRENT_SCHEMA_VERSION) {
    const validation = validateSheetV3(raw);
    if (!validation.isValid) {
      throw new Error(`Ficha Schema v3 existente é inválida: ${validation.errors.join('; ')}`);
    }
    return raw as CentralProductSheet;
  }

  // 2. Ficha legada v1 ou sem versão: executa primeiro a transição v1 -> v2
  let v2Base: any = raw;
  if (raw.schemaVersion === undefined || raw.schemaVersion === 1) {
    v2Base = migrateSheetToV2(raw);
  } else if (raw.schemaVersion !== 2) {
    // Versão desconhecida: fail-closed
    throw new Error(`Migração incompatível: versão desconhecida ${raw.schemaVersion}.`);
  }

  // Valida integridade da base v2 antes de prosseguir
  const v2Validation = validateSheetV2(v2Base);
  if (!v2Validation.isValid) {
    throw new Error(`Base Schema v2 inválida para migração v3: ${v2Validation.errors.join('; ')}`);
  }

  // 3. Aplica migração determinística v2 -> v3
  const migrated: any = {
    ...v2Base,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    migratedAt: new Date().toISOString(),
    migrationNotes: [
      'Migrado de Schema v2 para v3: suporte a value nulo para campos missing, stockInfo e preparationStatus'
    ],
    stockInfo: v2Base.stockInfo !== undefined ? v2Base.stockInfo : undefined
  };

  // Correção de Zeros Sintéticos em Campos Numéricos de Preço:
  // Se status === 'missing' && value === 0 -> value: null
  // Se status !== 'missing' && value === 0 -> permanece 0 (zero explícito)
  if (v2Base.costPrice) {
    migrated.costPrice = {
      ...v2Base.costPrice,
      value: v2Base.costPrice.status === 'missing' && v2Base.costPrice.value === 0
        ? null
        : v2Base.costPrice.value
    };
  }

  if (v2Base.currentSalePrice) {
    migrated.currentSalePrice = {
      ...v2Base.currentSalePrice,
      value: v2Base.currentSalePrice.status === 'missing' && v2Base.currentSalePrice.value === 0
        ? null
        : v2Base.currentSalePrice.value
    };
  }

  if (v2Base.suggestedSalePrice) {
    migrated.suggestedSalePrice = {
      ...v2Base.suggestedSalePrice,
      value: v2Base.suggestedSalePrice.status === 'missing' && v2Base.suggestedSalePrice.value === 0
        ? null
        : v2Base.suggestedSalePrice.value
    };
  }

  // Computa o preparationStatus estrutural local
  migrated.preparationStatus = evaluatePreparationStatus(migrated).status;

  // 4. Validação final pós-migração
  const v3Validation = validateSheetV3(migrated);
  if (!v3Validation.isValid) {
    throw new Error(`Falha na validação pós-migração v3: ${v3Validation.errors.join('; ')}`);
  }

  return migrated as CentralProductSheet;
}
