// Validador em Tempo de Execução e Sanitizador de Payloads do Bling ERP
import { 
  BLING_DOCUMENTED_PRODUCT_FIELDS, 
  type BlingDocumentedField,
  type BlingMappingContext,
  type ConfirmedDimensionUnit,
  type ConfirmedWeightUnit
} from './contracts.ts';
import type { BlingProductDTO } from './dto.ts';

export interface BlingValidationResult {
  isValid: boolean;
  sanitized: BlingProductDTO | null;
  warnings: string[];
  unknownFields: string[];
}

export interface ParsedNumberResult {
  value: number | null;
  isValid: boolean;
  warning?: string;
}

/**
 * Converte de forma determinística e segura uma entrada (number ou string numérica inequívoca)
 * aceitando notação com ponto ou vírgula decimal (padrão brasileiro).
 */
export function parseBlingNumber(raw: unknown, fieldName: string): ParsedNumberResult {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, isValid: false };
  }

  if (typeof raw === 'number') {
    if (isNaN(raw) || !isFinite(raw) || raw < 0) {
      return { 
        value: null, 
        isValid: false, 
        warning: `Campo "${fieldName}" possui número inválido ou negativo: ${raw}` 
      };
    }
    return { value: raw, isValid: true };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { value: null, isValid: false };

    // Padrão com separador de milhar e vírgula decimal (ex: "1.299,50")
    if (/^\d{1,3}(\.\d{3})*,\d+$/.test(trimmed)) {
      const normalized = trimmed.replace(/\./g, '').replace(',', '.');
      const num = parseFloat(normalized);
      return !isNaN(num) && isFinite(num) && num >= 0
        ? { value: num, isValid: true }
        : { value: null, isValid: false, warning: `Valor numérico inválido em "${fieldName}": "${trimmed}"` };
    }

    // Padrão apenas com vírgula decimal (ex: "149,90")
    if (/^\d+,\d+$/.test(trimmed)) {
      const normalized = trimmed.replace(',', '.');
      const num = parseFloat(normalized);
      return !isNaN(num) && isFinite(num) && num >= 0
        ? { value: num, isValid: true }
        : { value: null, isValid: false, warning: `Valor numérico inválido em "${fieldName}": "${trimmed}"` };
    }

    // Padrão com ponto decimal (ex: "149.90" ou "1299")
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const num = parseFloat(trimmed);
      return !isNaN(num) && isFinite(num) && num >= 0
        ? { value: num, isValid: true }
        : { value: null, isValid: false, warning: `Valor numérico inválido em "${fieldName}": "${trimmed}"` };
    }

    return {
      value: null,
      isValid: false,
      warning: `String numérica ambígua ou não numérica descartada para "${fieldName}": "${trimmed}"`
    };
  }

  return {
    value: null,
    isValid: false,
    warning: `Tipo de dado inesperado para "${fieldName}": esperado number ou string, recebido ${typeof raw}`
  };
}

/**
 * Valida o GTIN/EAN como string estrita de dígitos.
 */
export function parseBlingGtin(raw: unknown): { value: string | null; warning?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };

  const str = String(raw).trim();
  if (!str) return { value: null };

  if (/^\d{8,14}$/.test(str)) {
    return { value: str };
  }

  return {
    value: null,
    warning: `Código GTIN/EAN com formato ou dígitos inválidos ignorado: "${str}"`
  };
}

/**
 * Avalia se a unidade de dimensão está oficialmente confirmada.
 * Nenhuma unidade é assumida tacitamente ou extraída de campos não confirmados no contrato.
 * A conversão só ocorre mediante confirmação formal no contexto (context.confirmedUnits.dimension).
 */
export function resolveConfirmedDimensionUnit(
  context?: BlingMappingContext
): { unit: ConfirmedDimensionUnit | null; warning?: string } {
  if (context?.confirmedUnits?.dimension) {
    return { unit: context.confirmedUnits.dimension };
  }

  return {
    unit: null,
    warning: 'Unidade de medida das dimensões não confirmada no contexto oficial. Dimensões omitidas em conformidade com Fact-or-Omit.'
  };
}

/**
 * Avalia se a unidade de peso está oficialmente confirmada.
 * Nenhuma unidade é assumida tacitamente.
 */
export function resolveConfirmedWeightUnit(
  context?: BlingMappingContext
): { unit: ConfirmedWeightUnit | null; warning?: string } {
  if (context?.confirmedUnits?.weight) {
    return { unit: context.confirmedUnits.weight };
  }

  return {
    unit: null,
    warning: 'Unidade de medida de peso não confirmada no contexto oficial. Peso omitido em conformidade com Fact-or-Omit.'
  };
}

/**
 * Valida e sanitiza o payload de entrada (unknown) contra a documentação da API do Bling.
 * Copia estritamente propriedades da whitelist oficial e impede que campos desconhecidos
 * ou tipos adulterados poluam o DTO sanitizado.
 */
export function validateBlingProductInput(
  input: unknown,
  _context?: BlingMappingContext
): BlingValidationResult {
  const warnings: string[] = [];
  const unknownFields: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      isValid: false,
      sanitized: null,
      warnings: ['Payload Bling inválido: esperado objeto JSON.'],
      unknownFields: []
    };
  }

  const rawObj = input as Record<string, unknown>;

  // Identifica campos desconhecidos
  for (const key of Object.keys(rawObj)) {
    if (!BLING_DOCUMENTED_PRODUCT_FIELDS.includes(key as BlingDocumentedField)) {
      unknownFields.push(key);
    }
  }

  // Validação do identificador mínimo do produto
  const hasNome = typeof rawObj.nome === 'string' && rawObj.nome.trim().length > 0;
  const hasId = rawObj.id !== undefined && rawObj.id !== null && String(rawObj.id).trim().length > 0;

  if (!hasNome && !hasId) {
    return {
      isValid: false,
      sanitized: null,
      warnings: ['Produto Bling sem identificador mínimo obrigatório (nome ou id ausente).'],
      unknownFields
    };
  }

  // Construção estrita do DTO sanitizado apenas com propriedades da whitelist oficial
  const sanitized: BlingProductDTO = {};

  if (rawObj.id !== undefined && rawObj.id !== null) {
    if (typeof rawObj.id === 'number' || typeof rawObj.id === 'string') {
      const idStr = String(rawObj.id).trim();
      if (idStr) sanitized.id = typeof rawObj.id === 'number' ? rawObj.id : idStr;
    }
  }

  if (typeof rawObj.nome === 'string' && rawObj.nome.trim()) {
    sanitized.nome = rawObj.nome.trim();
  }

  if (rawObj.codigo !== undefined && rawObj.codigo !== null) {
    sanitized.codigo = String(rawObj.codigo).trim();
  }

  if (rawObj.preco !== undefined) sanitized.preco = rawObj.preco as any;
  if (rawObj.precoCusto !== undefined) sanitized.precoCusto = rawObj.precoCusto as any;
  if (typeof rawObj.tipo === 'string') sanitized.tipo = rawObj.tipo;
  if (typeof rawObj.situacao === 'string') sanitized.situacao = rawObj.situacao;
  if (typeof rawObj.formato === 'string') sanitized.formato = rawObj.formato;
  if (typeof rawObj.descricaoCurta === 'string') sanitized.descricaoCurta = rawObj.descricaoCurta;
  if (typeof rawObj.descricaoComplementar === 'string') sanitized.descricaoComplementar = rawObj.descricaoComplementar;
  if (typeof rawObj.unidade === 'string') sanitized.unidade = rawObj.unidade;
  if (rawObj.pesoLiquido !== undefined) sanitized.pesoLiquido = rawObj.pesoLiquido as any;
  if (rawObj.pesoBruto !== undefined) sanitized.pesoBruto = rawObj.pesoBruto as any;
  if (rawObj.gtin !== undefined) sanitized.gtin = rawObj.gtin as any;
  if (rawObj.gtinEmbalagem !== undefined) sanitized.gtinEmbalagem = rawObj.gtinEmbalagem as any;
  if (typeof rawObj.marca === 'string') sanitized.marca = rawObj.marca;

  if (typeof rawObj.dimensoes === 'object' && rawObj.dimensoes !== null && !Array.isArray(rawObj.dimensoes)) {
    const rawDim = rawObj.dimensoes as Record<string, unknown>;
    sanitized.dimensoes = {
      largura: rawDim.largura as any,
      altura: rawDim.altura as any,
      profundidade: rawDim.profundidade as any
    };
  }

  if (typeof rawObj.tributacao === 'object' && rawObj.tributacao !== null && !Array.isArray(rawObj.tributacao)) {
    const rawTrib = rawObj.tributacao as Record<string, unknown>;
    sanitized.tributacao = {
      ncm: typeof rawTrib.ncm === 'string' ? rawTrib.ncm : undefined,
      origem: typeof rawTrib.origem === 'number' ? rawTrib.origem : undefined,
      cest: typeof rawTrib.cest === 'string' ? rawTrib.cest : undefined
    };
  }

  if (typeof rawObj.midia === 'object' && rawObj.midia !== null && !Array.isArray(rawObj.midia)) {
    sanitized.midia = rawObj.midia as any;
  }

  if (Array.isArray(rawObj.imagensUrl)) {
    sanitized.imagensUrl = rawObj.imagensUrl.filter(u => typeof u === 'string');
  }

  if (typeof rawObj.estoque === 'object' && rawObj.estoque !== null) {
    sanitized.estoque = rawObj.estoque as Record<string, unknown>;
  }

  return {
    isValid: true,
    sanitized,
    warnings,
    unknownFields
  };
}
