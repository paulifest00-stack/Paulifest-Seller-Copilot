// Schema Canônico da Ficha Central do Produto (SSOT)

export type FieldSource =
  | 'user_manual'        // Digitado ou editado manualmente pelo seller
  | 'ean_catalog'        // Retornado de base canônica de EAN (GS1 / Cosmos)
  | 'bling_erp'          // Extraído da tela ou API do Bling
  | 'mercadolivre_pdp'   // Extraído de anúncio de concorrente ou próprio no ML
  | 'mercadolivre_cat'   // Extraído da página de catálogo do ML
  | 'ai_generated'       // Gerado por modelo de IA
  | 'rule_engine';       // Calculado deterministicamente por regra matemática

export type FieldStatus =
  | 'pending_review'     // Sugerido pelo sistema, aguardando aprovação
  | 'approved'           // Confirmado pelo usuário
  | 'edited'             // Modificado manualmente pelo usuário
  | 'conflict'           // Conflito detectado entre duas fontes
  | 'missing';           // Campo obrigatório ausente

export type SourceTier = 1 | 2 | 3 | 4 | 5 | 6;

export type EvidenceSourceType =
  | 'manufacturer_website'    // Tier 1: Site/manual direto do fabricante
  | 'brand_official'          // Tier 2: Canal oficial da marca
  | 'official_datasheet'      // Tier 3: Ficha técnica / catálogo canônico
  | 'authorized_distributor'  // Tier 4: Distribuidor autorizado oficial
  | 'gs1_database'            // Tier 5: Cadastro nacional GS1 de GTIN
  | 'marketplace_pdp'         // Tier 6: Anúncio de marketplace / concorrente
  | 'image_ocr'               // Evidência visual extraída da foto do item
  | 'user_input'              // Informado diretamente pelo vendedor
  | 'rule_engine'             // Regra matemática determinística
  | 'erp_api_record';         // Tier 4: Registro extraído de ERP / API oficial

export interface FieldEvidence {
  sourceType?: EvidenceSourceType;
  sourceTier?: SourceTier;
  sourceName?: string;             // Nome legível da fonte (ex: "Bosch Ferramentas Brasil")
  sourceUrl?: string;              // URL de onde o dado foi extraído
  sourceId?: string;               // Identificador não-URL (ex: GTIN, SKU fabricante, ID catálogo Bling/ML)
  documentTitle?: string;          // Título do documento ou página oficial
  extractedSnippet?: string;       // Trecho textual ou JSON de comprovação
  capturedAt: string;              // Timestamp ISO-8601
  retrievedAt?: string;            // Alias compatível com capturedAt
  rawFieldKey?: string;            // Nome do campo na fonte original
  evidenceStrength?: 'high' | 'medium' | 'low';
}

export interface CandidateFact<T> {
  fieldName: string;
  value: T;
  source: FieldSource;
  sourceTier: SourceTier;
  sourceType: EvidenceSourceType;
  sourceName: string;
  sourceUrl?: string;
  sourceId?: string;
  documentTitle?: string;
  extractedSnippet: string;
  confidence: number;
  capturedAt: string;
  targetProductMatch?: {
    matchedBy: 'exact_gtin' | 'exact_brand_model' | 'strong_identifier' | 'fuzzy_text';
    identifierValue: string;
    isSameVariant: boolean;
    divergenceReason?: string;
  };
}

export interface AuditedField<T> {
  value: T;
  source: FieldSource;
  confidence: number;           // Escala qualitativa/confiança 0.0 a 1.0
  status: FieldStatus;
  evidence?: FieldEvidence;
  conflictingValues?: Array<{
    value: T;
    source: FieldSource;
    confidence: number;
    evidence?: FieldEvidence;
  }>;
}

export interface TechnicalAttribute {
  id: string;
  name: string;
  field: AuditedField<string>;
}

export interface ProductImage {
  id: string;
  url: string;
  isMain: boolean;
  width?: number;
  height?: number;
  hasWhiteBackground?: boolean;
  status: AuditedField<'approved' | 'warning' | 'rejected'>;
}

export interface ExternalProductReference {
  system: 'bling' | 'mercadolivre' | string;
  externalId: string;
  parentExternalId?: string;
  sku?: string;
  context?: string;
  importedAt: string;
  lastSyncedAt?: string;
  metadata?: Record<string, unknown>;
}

import type {
  ProductStockInfo,
  ProductPreparationStatus,
  PreparationStatusEvaluation
} from '../../shared/gateway-contracts.ts';
export type { ProductStockInfo, ProductPreparationStatus, PreparationStatusEvaluation };

export interface CentralProductSheet {
  schemaVersion: number;
  id: string;
  createdAt: string;
  updatedAt: string;
  migratedAt?: string;
  migrationNotes?: string[];

  // 1. Identificação Básica
  ean: AuditedField<string>;
  sku: AuditedField<string>;
  title: AuditedField<string>;
  brand: AuditedField<string>;
  model: AuditedField<string>;

  // 2. Classificação
  categoryIdML: AuditedField<string>;
  categoryPathML: AuditedField<string>;
  ncm: AuditedField<string>;

  // 3. Dimensões e Logística
  packageWeightKg: AuditedField<number>;
  packageHeightCm: AuditedField<number>;
  packageWidthCm: AuditedField<number>;
  packageLengthCm: AuditedField<number>;

  // 4. Custos e Financeiro
  costPrice: AuditedField<number | null>;          // CMV em R$ (null se missing)
  currentSalePrice: AuditedField<number | null>;   // Preço de venda praticado no ERP / canal (null se missing)
  suggestedSalePrice: AuditedField<number | null>; // Preço final sugerido pela extensão (null se missing)

  // 5. Conteúdo Comercial
  descriptionPlain: AuditedField<string>;
  bulletPoints: AuditedField<string[]>;
  warrantyDays: AuditedField<number>;

  // 6. Galeria e Atributos Técnicos
  images: ProductImage[];
  attributes: TechnicalAttribute[];

  // 7. Vínculos e Referências Externas
  externalReferences: ExternalProductReference[];

  // 8. Estoque Estruturado (Fase 4D.1)
  stockInfo?: AuditedField<ProductStockInfo>;

  // 9. Metadados Operacionais
  overallConfidenceScore: number;
  hasUnresolvedConflicts: boolean;
  preparationStatus: ProductPreparationStatus;
}

export function createAuditedField<T>(
  value: T,
  source: FieldSource = 'user_manual',
  confidence: number = 1.0,
  status: FieldStatus = 'approved',
  evidence?: FieldEvidence
): AuditedField<T> {
  return {
    value,
    source,
    confidence,
    status,
    evidence
  };
}

export function createInitialSheet(): CentralProductSheet {
  const now = new Date().toISOString();
  return {
    schemaVersion: 3,
    id: `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: now,
    updatedAt: now,
    ean: createAuditedField('', 'user_manual', 0.0, 'missing'),
    sku: createAuditedField('', 'user_manual', 0.0, 'missing'),
    title: createAuditedField('', 'user_manual', 0.0, 'missing'),
    brand: createAuditedField('', 'user_manual', 0.0, 'missing'),
    model: createAuditedField('', 'user_manual', 0.0, 'missing'),
    categoryIdML: createAuditedField('', 'rule_engine', 0.0, 'missing'),
    categoryPathML: createAuditedField('', 'rule_engine', 0.0, 'missing'),
    ncm: createAuditedField('', 'user_manual', 0.0, 'missing'),
    packageWeightKg: createAuditedField(0, 'rule_engine', 0.0, 'missing'),
    packageHeightCm: createAuditedField(0, 'rule_engine', 0.0, 'missing'),
    packageWidthCm: createAuditedField(0, 'rule_engine', 0.0, 'missing'),
    packageLengthCm: createAuditedField(0, 'rule_engine', 0.0, 'missing'),
    costPrice: createAuditedField<number | null>(null, 'user_manual', 0.0, 'missing'),
    currentSalePrice: createAuditedField<number | null>(null, 'rule_engine', 0.0, 'missing'),
    suggestedSalePrice: createAuditedField<number | null>(null, 'rule_engine', 0.0, 'missing'),
    descriptionPlain: createAuditedField('', 'user_manual', 0.0, 'missing'),
    bulletPoints: createAuditedField([], 'user_manual', 0.0, 'missing'),
    warrantyDays: createAuditedField(0, 'rule_engine', 0.0, 'missing'),
    images: [],
    attributes: [],
    externalReferences: [],
    stockInfo: undefined,
    overallConfidenceScore: 0,
    hasUnresolvedConflicts: false,
    preparationStatus: 'incomplete'
  };
}

/**
 * Avalia de forma pura e determinística o status de preparação estrutural local da ficha (Fase 4D.1).
 * Não assume regras de catálogo/taxonomia específicas de categorias do Mercado Livre.
 */
export function evaluatePreparationStatus(
  sheet: CentralProductSheet
): PreparationStatusEvaluation {
  const missingFields: string[] = [];
  const conflictFields: string[] = [];
  const pendingFields: string[] = [];

  const auditedKeys: (keyof CentralProductSheet)[] = [
    'title', 'sku', 'ean', 'brand', 'model',
    'categoryIdML', 'categoryPathML', 'ncm',
    'packageWeightKg', 'packageHeightCm', 'packageWidthCm', 'packageLengthCm',
    'costPrice', 'currentSalePrice', 'suggestedSalePrice',
    'descriptionPlain', 'bulletPoints', 'warrantyDays'
  ];

  for (const key of auditedKeys) {
    const field = sheet[key] as AuditedField<any> | undefined;
    if (!field) continue;

    if (field.status === 'conflict') {
      conflictFields.push(String(key));
    } else if (field.status === 'pending_review') {
      pendingFields.push(String(key));
    } else if (field.status === 'missing') {
      missingFields.push(String(key));
    }
  }

  if (sheet.stockInfo && sheet.stockInfo.status === 'conflict') {
    conflictFields.push('stockInfo');
  }

  // 1. Conflitos não resolvidos têm precedência absoluta
  if (conflictFields.length > 0 || sheet.hasUnresolvedConflicts) {
    return {
      status: 'has_conflicts',
      missingFields,
      conflictFields,
      pendingFields
    };
  }

  // 2. Incompletude estrutural mínima:
  // Título e ao menos um identificador (SKU ou EAN) presentes e não vazios
  const hasTitle = Boolean(sheet.title?.value && String(sheet.title.value).trim().length > 0 && sheet.title.status !== 'missing');
  const hasIdentifier = Boolean(
    (sheet.sku?.value && String(sheet.sku.value).trim().length > 0 && sheet.sku.status !== 'missing') ||
    (sheet.ean?.value && String(sheet.ean.value).trim().length > 0 && sheet.ean.status !== 'missing')
  );

  if (!hasTitle || !hasIdentifier) {
    return {
      status: 'incomplete',
      missingFields,
      conflictFields,
      pendingFields
    };
  }

  // 3. Campos importados aguardando primeira aprovação humana
  if (pendingFields.length > 0) {
    return {
      status: 'pending_review',
      missingFields,
      conflictFields,
      pendingFields
    };
  }

  // 4. Ficha estruturalmente pronta para revisão de anúncio
  return {
    status: 'ready_for_review',
    missingFields,
    conflictFields,
    pendingFields
  };
}

/**
 * Resolve um conflito em um campo auditado, aprovando o valor selecionado pelo usuário
 * e arquivando a divergência resolvida.
 */
export function resolveFieldConflict<T>(
  field: AuditedField<T>,
  chosenValue: T,
  chosenEvidence?: FieldEvidence
): AuditedField<T> {
  return {
    ...field,
    value: chosenValue,
    status: 'approved',
    confidence: 1.0,
    evidence: chosenEvidence || field.evidence,
    conflictingValues: undefined
  };
}
