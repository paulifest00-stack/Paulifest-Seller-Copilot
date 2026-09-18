// Orquestrador de Identificação, Pesquisa Externa Confiável e Resolução da Verdade
import type { 
  CentralProductSheet, 
  CandidateFact 
} from '../../schema/product.ts';
import { createAuditedField } from '../../schema/product.ts';
import { validateEan } from './ean-validator.ts';
import { 
  defaultAIProvider, 
  type IAIProvider, 
  type AIIdentificationRequest, 
  type AIIdentificationResponse 
} from '../../services/ai-provider.service.ts';
import { 
  defaultResearchProvider, 
  type IResearchProvider, 
  type ProductResearchResult,
  type ProductIdentityQuery 
} from '../../services/research-provider.service.ts';
import { 
  TruthAndConflictEngine, 
  type RejectedVariantNotice 
} from './truth-engine.ts';
import { validateAIResponse } from './runtime-validator.ts';

export interface IdentificationSummary {
  productSummary: string;
  providerName: string;
  researchProviderName?: string;
  isSimulated: boolean;
  confirmedCount: number;
  readFromImageCount: number;
  researchedCount: number;
  conflictCount: number;
  missingCount: number;
  unsupportedFields: string[];
  rejectedVariantCount: number;
  rejectedVariantNotices: RejectedVariantNotice[];
}

export interface IdentificationRunResult {
  sheet: CentralProductSheet;
  summary: IdentificationSummary;
  rawResponse: AIIdentificationResponse;
  researchResult?: ProductResearchResult;
}

export interface ProductIdentificationOptions {
  aiProvider?: IAIProvider;
  researchProvider?: IResearchProvider;
  isDemoMode?: boolean;
}

/**
 * Converte atributos do AIIdentificationResponse em CandidateFacts auditáveis.
 */
function buildAiCandidates(
  aiResult: AIIdentificationResponse,
  hasImage: boolean
): CandidateFact<any>[] {
  const now = new Date().toISOString();
  const candidates: CandidateFact<any>[] = [];

  const addCandidate = (
    fieldKey: string,
    rawAttr: { value: any; evidence: string; confidence: number; source: any } | undefined,
    defaultName: string = 'Visão / OCR do Produto'
  ) => {
    if (!rawAttr || rawAttr.value === undefined || rawAttr.value === '') return;

    candidates.push({
      fieldName: fieldKey,
      value: rawAttr.value,
      source: rawAttr.source,
      sourceTier: hasImage ? 3 : 6, // Se lido direto da foto com OCR, tem prioridade alta; se texto genérico, Tier 6
      sourceType: hasImage ? 'image_ocr' : 'user_input',
      sourceName: defaultName,
      sourceId: hasImage ? 'IMG-VISUAL-INSPECT' : undefined,
      documentTitle: hasImage ? 'Foto da Embalagem / Plaqueta' : 'Entrada Preliminar',
      extractedSnippet: rawAttr.evidence,
      confidence: rawAttr.confidence,
      capturedAt: now
    });
  };

  addCandidate('brand', aiResult.brand);
  addCandidate('model', aiResult.model);
  addCandidate('title', aiResult.title);
  addCandidate('packageWeightKg', aiResult.packageWeightKg);
  addCandidate('warrantyDays', aiResult.warrantyDays);
  addCandidate('ncmSuggested', aiResult.ncmSuggested);

  if (aiResult.dimensionsCm) {
    addCandidate('packageHeightCm', aiResult.dimensionsCm.height);
    addCandidate('packageWidthCm', aiResult.dimensionsCm.width);
    addCandidate('packageLengthCm', aiResult.dimensionsCm.length);
  }

  if (aiResult.attributes) {
    for (const [key, rawAttr] of Object.entries(aiResult.attributes)) {
      addCandidate(key, rawAttr);
    }
  }

  return candidates;
}

/**
 * Orquestra o pipeline completo da Fase 3:
 * 1. Extração preliminar / OCR via AIProvider com Fact-or-Omit.
 * 2. Validação da identidade do produto (GTIN ou Marca+Modelo).
 * 3. Pesquisa externa via IResearchProvider (fabricante, GS1, distribuidor, etc.).
 * 4. Validação e resolução determinística pelo TruthAndConflictEngine (bloqueando contaminação de variantes).
 */
export async function runProductIdentification(
  request: AIIdentificationRequest,
  baseSheet: CentralProductSheet,
  aiProvider: IAIProvider = defaultAIProvider,
  researchProvider?: IResearchProvider
): Promise<IdentificationRunResult> {
  const hasImage = Boolean(request.imageBase64 && request.imageBase64.length > 50);

  // 1. ETAPA 1: Execução do Gateway de IA (Visão / OCR / Leitura de Input)
  const rawAiResult = await aiProvider.identifyProduct(request);

  // Validação defensiva em tempo de execução
  const validatedAi = validateAIResponse(rawAiResult);
  const aiResult = validatedAi.sanitized || rawAiResult;

  // 2. ETAPA 2: Validação Preliminar de EAN / GTIN
  let finalEanField = baseSheet.ean;
  const directEan = request.ean?.trim() || (aiResult.detectedEan?.value ? String(aiResult.detectedEan.value) : undefined);

  if (request.ean) {
    const eanCheck = validateEan(request.ean);
    if (eanCheck.valid && !eanCheck.isMissing) {
      finalEanField = createAuditedField(
        request.ean,
        'user_manual',
        1.0,
        'approved',
        {
          sourceType: 'user_input',
          sourceName: 'Vendedor (Entrada Direta)',
          sourceId: request.ean,
          extractedSnippet: `EAN oficial informado pelo seller: ${request.ean}`,
          capturedAt: new Date().toISOString()
        }
      );
    }
  }

  // Cruzamento com EAN detectado na imagem
  if (aiResult.detectedEan?.value) {
    const detectedVal = String(aiResult.detectedEan.value);
    if (finalEanField.value && finalEanField.value !== detectedVal) {
      finalEanField = {
        ...finalEanField,
        status: 'conflict',
        conflictingValues: [
          {
            value: detectedVal,
            source: 'ai_generated',
            confidence: aiResult.detectedEan.confidence,
            evidence: {
              sourceType: 'image_ocr',
              sourceName: 'OCR da Imagem',
              sourceId: detectedVal,
              extractedSnippet: aiResult.detectedEan.evidence,
              capturedAt: new Date().toISOString()
            }
          }
        ]
      };
    } else if (!finalEanField.value) {
      finalEanField = createAuditedField(
        detectedVal,
        aiResult.detectedEan.source,
        aiResult.detectedEan.confidence,
        'pending_review',
        {
          sourceType: 'image_ocr',
          sourceName: 'OCR da Embalagem',
          sourceId: detectedVal,
          extractedSnippet: aiResult.detectedEan.evidence,
          capturedAt: new Date().toISOString()
        }
      );
    }
  }

  // 3. ETAPA 3: Pesquisa Externa Confiável (IResearchProvider) com Identidade do Produto
  const activeResearchProvider = researchProvider || defaultResearchProvider;
  let researchResult: ProductResearchResult | undefined;

  const searchQuery: ProductIdentityQuery = {
    ean: directEan,
    brand: aiResult.brand?.value ? String(aiResult.brand.value) : undefined,
    model: aiResult.model?.value ? String(aiResult.model.value) : undefined,
    rawName: request.rawName || (aiResult.title?.value ? String(aiResult.title.value) : undefined)
  };

  const hasSearchIdentity = Boolean(searchQuery.ean || (searchQuery.brand && searchQuery.model) || searchQuery.rawName);

  if (activeResearchProvider && hasSearchIdentity) {
    try {
      researchResult = await activeResearchProvider.searchProductFacts(searchQuery);
    } catch (err) {
      console.warn('Falha ao consultar IResearchProvider:', err);
    }
  }

  // 4. ETAPA 4: Conversão em CandidateFacts e Resolução no TruthAndConflictEngine
  const aiCandidates = buildAiCandidates(aiResult, hasImage);

  // Inicializa a ficha base com o EAN tratado
  const preResolvedSheet: CentralProductSheet = {
    ...baseSheet,
    ean: finalEanField
  };

  const resolution = TruthAndConflictEngine.resolveProduct(
    preResolvedSheet,
    aiCandidates,
    researchResult
  );

  const finalSummary: IdentificationSummary = {
    productSummary: aiResult.productSummary,
    providerName: aiResult.providerName,
    researchProviderName: researchResult ? activeResearchProvider.providerId : undefined,
    isSimulated: aiResult.isSimulated,
    confirmedCount: resolution.report.confirmedCount,
    readFromImageCount: resolution.report.readFromImageCount,
    researchedCount: resolution.report.researchedCount,
    conflictCount: resolution.report.conflictCount,
    missingCount: resolution.report.missingCount,
    unsupportedFields: Array.from(new Set([
      ...aiResult.unsupportedFields,
      ...resolution.report.unsupportedFields
    ])),
    rejectedVariantCount: resolution.report.rejectedVariantItems.length,
    rejectedVariantNotices: resolution.report.rejectedVariantItems
  };

  return {
    sheet: resolution.sheet,
    summary: finalSummary,
    rawResponse: aiResult,
    researchResult
  };
}
