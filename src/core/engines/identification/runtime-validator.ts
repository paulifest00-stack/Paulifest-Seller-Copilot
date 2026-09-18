// Validador em Tempo de Execução para Respostas de IA e Fatos de Pesquisa (Runtime Validator)
import type { 
  CandidateFact 
} from '../../schema/product.ts';
import type { 
  AIIdentificationResponse, 
  RawIdentifiedAttribute 
} from '../../services/ai-provider.service.ts';

export interface ValidationIssue {
  field: string;
  reason: string;
  rawValue?: any;
}

export interface ValidationResult<T> {
  isValid: boolean;
  sanitized?: T;
  droppedFields: string[];
  issues: ValidationIssue[];
}

/**
 * Valida rigorosamente que um atributo extraído possui evidência explícita não vazia
 * (Regra Fact-or-Omit).
 */
export function validateRawAttribute(
  key: string,
  raw: any
): { valid: boolean; attribute?: RawIdentifiedAttribute; issue?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, issue: `Atributo "${key}" nulo ou não é um objeto` };
  }

  const val = raw.value;
  if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
    return { valid: false, issue: `Atributo "${key}": valor ausente ou vazio` };
  }

  // Regra Inegociável Fact-or-Omit: Evidência textual ou visual é OBRIGATÓRIA
  const evidence = typeof raw.evidence === 'string' ? raw.evidence.trim() : '';
  if (!evidence) {
    return { valid: false, issue: `Atributo "${key}": ausência de evidência comprovável (Fact-or-Omit violado)` };
  }

  const confidence = typeof raw.confidence === 'number' && !isNaN(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.8;

  return {
    valid: true,
    attribute: {
      value: val,
      evidence,
      confidence,
      source: raw.source || 'ai_generated'
    }
  };
}

/**
 * Valida e sanitiza a resposta completa do AIProvider antes de qualquer processamento.
 */
export function validateAIResponse(rawJson: any): ValidationResult<AIIdentificationResponse> {
  const issues: ValidationIssue[] = [];
  const droppedFields: string[] = [];

  if (!rawJson || typeof rawJson !== 'object') {
    return {
      isValid: false,
      droppedFields: [],
      issues: [{ field: 'root', reason: 'Resposta de IA não é um JSON válido' }]
    };
  }

  const sanitizedAttributes: Record<string, RawIdentifiedAttribute> = {};

  // Validação de atributos dinâmicos
  if (rawJson.attributes && typeof rawJson.attributes === 'object') {
    for (const [attrKey, attrVal] of Object.entries(rawJson.attributes)) {
      const check = validateRawAttribute(attrKey, attrVal);
      if (check.valid && check.attribute) {
        sanitizedAttributes[attrKey] = check.attribute;
      } else {
        droppedFields.push(attrKey);
        issues.push({ field: attrKey, reason: check.issue || 'Inválido', rawValue: attrVal });
      }
    }
  }

  // Validação de campos específicos
  const validateNamedField = (key: string) => {
    if (!rawJson[key]) return undefined;
    const check = validateRawAttribute(key, rawJson[key]);
    if (check.valid && check.attribute) {
      return check.attribute;
    } else {
      droppedFields.push(key);
      issues.push({ field: key, reason: check.issue || 'Inválido', rawValue: rawJson[key] });
      return undefined;
    }
  };

  const detectedEan = validateNamedField('detectedEan');
  const brand = validateNamedField('brand');
  const model = validateNamedField('model');
  const title = validateNamedField('title');
  const categoryML = validateNamedField('categoryML');
  const categoryPath = validateNamedField('categoryPath');
  const packageWeightKg = validateNamedField('packageWeightKg');
  const warrantyDays = validateNamedField('warrantyDays');
  const ncmSuggested = validateNamedField('ncmSuggested');

  // Dimensões
  let dimensionsCm: AIIdentificationResponse['dimensionsCm'];
  if (rawJson.dimensionsCm && typeof rawJson.dimensionsCm === 'object') {
    const h = validateRawAttribute('height', rawJson.dimensionsCm.height);
    const w = validateRawAttribute('width', rawJson.dimensionsCm.width);
    const l = validateRawAttribute('length', rawJson.dimensionsCm.length);
    dimensionsCm = {
      height: h.valid ? h.attribute : undefined,
      width: w.valid ? w.attribute : undefined,
      length: l.valid ? l.attribute : undefined
    };
  }

  const existingUnsupported = Array.isArray(rawJson.unsupportedFields) ? rawJson.unsupportedFields : [];
  const allUnsupported = Array.from(new Set([...existingUnsupported, ...droppedFields]));

  const sanitized: AIIdentificationResponse = {
    identified: Boolean(brand || model || title || detectedEan),
    productSummary: String(rawJson.productSummary || title?.value || 'Produto identificado'),
    detectedEan,
    brand,
    model,
    title,
    categoryML,
    categoryPath,
    packageWeightKg,
    dimensionsCm,
    attributes: sanitizedAttributes,
    warrantyDays,
    ncmSuggested,
    unsupportedFields: allUnsupported,
    isSimulated: Boolean(rawJson.isSimulated),
    providerName: String(rawJson.providerName || 'AI Provider')
  };

  return {
    isValid: true,
    sanitized,
    droppedFields,
    issues
  };
}

/**
 * Valida um CandidateFact individual antes de entrar no motor de verdade.
 */
export function validateCandidateFact<T>(fact: CandidateFact<T>): boolean {
  if (!fact.fieldName || fact.value === undefined || fact.value === null) {
    return false;
  }
  if (!fact.extractedSnippet || fact.extractedSnippet.trim() === '') {
    return false;
  }
  if (!fact.sourceTier || fact.sourceTier < 1 || fact.sourceTier > 6) {
    return false;
  }
  return true;
}
