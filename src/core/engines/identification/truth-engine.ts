// Motor de Resolução da Verdade, Hierarquia de Fontes e Prevenção de Contaminação (Truth & Conflict Engine)
import type { 
  CentralProductSheet, 
  AuditedField, 
  TechnicalAttribute, 
  CandidateFact, 
  FieldEvidence
} from '../../schema/product.ts';
import { createAuditedField } from '../../schema/product.ts';
import type { 
  ProductResearchResult 
} from '../../services/research-provider.service.ts';
import { validateCandidateFact } from './runtime-validator.ts';

export interface RejectedVariantNotice {
  sourceName: string;
  sourceId?: string;
  documentTitle?: string;
  reason: string;
  divergentModel?: string;
}

export interface TruthEngineReport {
  confirmedCount: number;
  readFromImageCount: number;
  researchedCount: number;
  conflictCount: number;
  missingCount: number;
  rejectedVariantItems: RejectedVariantNotice[];
  corroboratedFields: string[];
  unsupportedFields: string[];
}

export interface TruthResolutionResult {
  sheet: CentralProductSheet;
  report: TruthEngineReport;
}

/**
 * Normaliza valores para comparação estrita (case insensitive, trim, remoção de pontuação leve)
 */
function normalizeVal(v: any): string {
  if (v === undefined || v === null) return '';
  return String(v).toLowerCase().trim().replace(/[\s\-_]/g, '');
}

/**
 * Compara se dois valores são substancialmente concordantes.
 */
function areValuesConcordant(a: any, b: any): boolean {
  const normA = normalizeVal(a);
  const normB = normalizeVal(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  // Comparação numérica tolerante (ex: "1.8" vs "1.80" ou "750w" vs "750")
  const numA = parseFloat(normA.replace(/[^\d.]/g, ''));
  const numB = parseFloat(normB.replace(/[^\d.]/g, ''));
  if (!isNaN(numA) && !isNaN(numB) && numA === numB) return true;
  return false;
}

export class TruthAndConflictEngine {
  /**
   * Resolve e aplica fatos candidatos sobre a Ficha Central, respeitando:
   * 1. Validação de identidade do produto e rejeição estrita de variantes divergentes.
   * 2. Hierarquia determinística por Tier de fonte (Tier 1 a 6) sem pesos probabilísticos.
   * 3. Regra Fact-or-Omit (campos sem evidência permanecem missing).
   * 4. Registro auditável de evidências e divergências.
   */
  static resolveProduct(
    baseSheet: CentralProductSheet,
    candidates: CandidateFact<any>[],
    researchResult?: ProductResearchResult
  ): TruthResolutionResult {
    const now = new Date().toISOString();
    const rejectedVariants: RejectedVariantNotice[] = [];
    const corroboratedFields: string[] = [];
    const validCandidates: CandidateFact<any>[] = [];

    // 1. Filtragem e Validação de Identidade do Produto antes do Enriquecimento
    // Qualquer fonte de pesquisa externa DEVE comprovar identidade (EAN exato ou marca+modelo exatos)
    if (researchResult && researchResult.items) {
      for (const item of researchResult.items) {
        if (!item.identityMatch.isMatch || item.identityMatch.matchMethod === 'divergent_variant') {
          // Rejeita terminantemente a importação de atributos de variantes diferentes
          rejectedVariants.push({
            sourceName: item.sourceName,
            sourceId: item.sourceId,
            documentTitle: item.documentTitle,
            reason: item.identityMatch.divergenceNotes || 
              `Produto ou variante divergente (${item.brand || ''} ${item.model || ''}) não corresponde ao item pesquisado. Atributos bloqueados contra contaminação.`,
            divergentModel: item.model
          });
          continue;
        }

        // Marca e modelo comprovados na documentação oficial
        if (item.brand) {
          validCandidates.push({
            fieldName: 'brand',
            value: item.brand,
            source: item.sourceTier <= 3 ? 'ean_catalog' : 'bling_erp',
            sourceTier: item.sourceTier,
            sourceType: item.sourceType,
            sourceName: item.sourceName,
            sourceUrl: item.sourceUrl,
            sourceId: item.sourceId,
            documentTitle: item.documentTitle,
            extractedSnippet: `Marca homologada no documento oficial: ${item.brand}`,
            confidence: 1.0,
            capturedAt: item.retrievedAt || now,
            targetProductMatch: {
              matchedBy: item.identityMatch.matchMethod as any,
              identifierValue: item.identityMatch.matchedIdentifier,
              isSameVariant: true
            }
          });
        }

        if (item.model) {
          validCandidates.push({
            fieldName: 'model',
            value: item.model,
            source: item.sourceTier <= 3 ? 'ean_catalog' : 'bling_erp',
            sourceTier: item.sourceTier,
            sourceType: item.sourceType,
            sourceName: item.sourceName,
            sourceUrl: item.sourceUrl,
            sourceId: item.sourceId,
            documentTitle: item.documentTitle,
            extractedSnippet: `Modelo homologado no documento oficial: ${item.model}`,
            confidence: 1.0,
            capturedAt: item.retrievedAt || now,
            targetProductMatch: {
              matchedBy: item.identityMatch.matchMethod as any,
              identifierValue: item.identityMatch.matchedIdentifier,
              isSameVariant: true
            }
          });
        }

        // Para itens com identidade estritamente correspondente (EAN exato ou Marca+Modelo exatos)
        for (const [factKey, rawFact] of Object.entries(item.extractedFacts)) {
          validCandidates.push({
            fieldName: factKey,
            value: rawFact.value,
            source: item.sourceTier <= 3 ? 'ean_catalog' : 'bling_erp',
            sourceTier: item.sourceTier,
            sourceType: item.sourceType,
            sourceName: item.sourceName,
            sourceUrl: item.sourceUrl,
            sourceId: item.sourceId,
            documentTitle: item.documentTitle,
            extractedSnippet: rawFact.snippet,
            confidence: 1.0,
            capturedAt: item.retrievedAt || now,
            targetProductMatch: {
              matchedBy: item.identityMatch.matchMethod as any,
              identifierValue: item.identityMatch.matchedIdentifier,
              isSameVariant: true
            }
          });
        }
      }
    }

    // Inclui candidatos vindos da visão/OCR/input que passaram na validação
    for (const c of candidates) {
      if (validateCandidateFact(c)) {
        validCandidates.push(c);
      }
    }

    // 2. Agrupamento de candidatos por campo
    const candidatesByField = new Map<string, CandidateFact<any>[]>();
    for (const c of validCandidates) {
      const list = candidatesByField.get(c.fieldName) || [];
      list.push(c);
      candidatesByField.set(c.fieldName, list);
    }

    // 3. Aplicação determinística campo a campo usando Tiers de Decisão
    const resolveFieldCandidates = <T>(
      currentField: AuditedField<T>,
      fieldKey: string
    ): AuditedField<T> => {
      const fieldCandidates = candidatesByField.get(fieldKey) || [];

      // Se o usuário editou manualmente ou aprovou explicitamente
      const isUserLocked = currentField.status === 'edited' || 
        (currentField.status === 'approved' && currentField.source === 'user_manual');

      if (fieldCandidates.length === 0) {
        if (isUserLocked) return currentField;
        return {
          ...currentField,
          status: 'missing',
          confidence: 0.0
        };
      }

      // Ordenação estrita por nível de fonte (Tier menor = maior autoridade de catálogo)
      // Tier 1 (Fabricante) < Tier 2 (Marca) < Tier 3 (Ficha Técnica) < Tier 4 (Distribuidor) < Tier 5 (GS1) < Tier 6 (Marketplace)
      fieldCandidates.sort((a, b) => a.sourceTier - b.sourceTier);

      const topCandidate = fieldCandidates[0];

      // Se o seller já digitou/editou e o melhor candidato discorda com evidência oficial
      if (isUserLocked) {
        if (!areValuesConcordant(currentField.value, topCandidate.value)) {
          return {
            ...currentField,
            status: 'conflict',
            conflictingValues: [
              {
                value: topCandidate.value as T,
                source: topCandidate.source,
                confidence: 1.0,
                evidence: {
                  sourceType: topCandidate.sourceType,
                  sourceTier: topCandidate.sourceTier,
                  sourceName: topCandidate.sourceName,
                  sourceUrl: topCandidate.sourceUrl,
                  sourceId: topCandidate.sourceId,
                  documentTitle: topCandidate.documentTitle,
                  extractedSnippet: topCandidate.extractedSnippet,
                  capturedAt: topCandidate.capturedAt,
                  retrievedAt: topCandidate.capturedAt,
                  rawFieldKey: fieldKey
                }
              }
            ]
          };
        }
        return currentField;
      }

      // Verificação de concordância / conflito entre múltiplos candidatos
      const primaryEvidence: FieldEvidence = {
        sourceType: topCandidate.sourceType,
        sourceTier: topCandidate.sourceTier,
        sourceName: topCandidate.sourceName,
        sourceUrl: topCandidate.sourceUrl,
        sourceId: topCandidate.sourceId,
        documentTitle: topCandidate.documentTitle,
        extractedSnippet: topCandidate.extractedSnippet,
        capturedAt: topCandidate.capturedAt,
        retrievedAt: topCandidate.capturedAt,
        rawFieldKey: fieldKey,
        evidenceStrength: 'high'
      };

      if (fieldCandidates.length > 1) {
        const secondary = fieldCandidates[1];
        if (areValuesConcordant(topCandidate.value, secondary.value)) {
          // Concordância comprovada entre fontes!
          corroboratedFields.push(fieldKey);
          return createAuditedField(
            topCandidate.value as T,
            topCandidate.source,
            1.0, // Alta confiança por corroboração
            'pending_review',
            primaryEvidence
          );
        } else {
          // Conflito entre fontes de níveis próximos ou divergentes
          return {
            value: topCandidate.value as T,
            source: topCandidate.source,
            confidence: 0.7,
            status: 'conflict',
            evidence: primaryEvidence,
            conflictingValues: [
              {
                value: secondary.value as T,
                source: secondary.source,
                confidence: 0.6,
                evidence: {
                  sourceType: secondary.sourceType,
                  sourceTier: secondary.sourceTier,
                  sourceName: secondary.sourceName,
                  sourceUrl: secondary.sourceUrl,
                  sourceId: secondary.sourceId,
                  documentTitle: secondary.documentTitle,
                  extractedSnippet: secondary.extractedSnippet,
                  capturedAt: secondary.capturedAt,
                  retrievedAt: secondary.capturedAt,
                  rawFieldKey: fieldKey
                }
              }
            ]
          };
        }
      }

      // Candidato único com evidência válida
      return createAuditedField(
        topCandidate.value as T,
        topCandidate.source,
        0.9,
        'pending_review',
        primaryEvidence
      );
    };

    // Atualiza campos canônicos da Ficha Central
    const updatedBrand = resolveFieldCandidates(baseSheet.brand, 'brand');
    const updatedModel = resolveFieldCandidates(baseSheet.model, 'model');
    const updatedTitle = resolveFieldCandidates(baseSheet.title, 'title');
    const updatedWeight = resolveFieldCandidates(baseSheet.packageWeightKg, 'packageWeightKg');
    const updatedHeight = resolveFieldCandidates(baseSheet.packageHeightCm, 'packageHeightCm');
    const updatedWidth = resolveFieldCandidates(baseSheet.packageWidthCm, 'packageWidthCm');
    const updatedLength = resolveFieldCandidates(baseSheet.packageLengthCm, 'packageLengthCm');
    const updatedNcm = resolveFieldCandidates(baseSheet.ncm, 'ncmSuggested');
    const updatedWarranty = resolveFieldCandidates(baseSheet.warrantyDays, 'warrantyDays');

    // Se houver EAN validado ou em conflito
    const updatedEan = resolveFieldCandidates(baseSheet.ean, 'detectedEan');

    // Atributos técnicos adicionais (dinâmicos)
    const newAttributes: TechnicalAttribute[] = [...baseSheet.attributes];
    const standardKeys = new Set([
      'brand', 'model', 'title', 'packageWeightKg', 'packageHeightCm', 
      'packageWidthCm', 'packageLengthCm', 'ncmSuggested', 'warrantyDays', 
      'detectedEan', 'categoryML', 'categoryPath'
    ]);

    for (const [fieldKey, fCandidates] of candidatesByField.entries()) {
      if (!standardKeys.has(fieldKey) && fCandidates.length > 0) {
        const top = fCandidates[0];
        const existingIdx = newAttributes.findIndex(a => a.id === fieldKey);
        const field = createAuditedField(
          String(top.value),
          top.source,
          0.9,
          'pending_review',
          {
            sourceType: top.sourceType,
            sourceTier: top.sourceTier,
            sourceName: top.sourceName,
            sourceUrl: top.sourceUrl,
            sourceId: top.sourceId,
            documentTitle: top.documentTitle,
            extractedSnippet: top.extractedSnippet,
            capturedAt: top.capturedAt,
            retrievedAt: top.capturedAt,
            rawFieldKey: fieldKey
          }
        );

        if (existingIdx >= 0) {
          newAttributes[existingIdx].field = field;
        } else {
          newAttributes.push({
            id: fieldKey,
            name: fieldKey.replace(/_/g, ' '),
            field
          });
        }
      }
    }

    const allFields = [
      updatedEan,
      updatedBrand,
      updatedModel,
      updatedTitle,
      updatedWeight,
      updatedHeight,
      updatedWidth,
      updatedLength,
      updatedNcm,
      updatedWarranty
    ];

    const conflictCount = allFields.filter(f => f.status === 'conflict').length + 
      (rejectedVariants.length > 0 ? 1 : 0);
    const confirmedCount = allFields.filter(f => f.status === 'approved').length;
    const readFromImageCount = allFields.filter(f => f.evidence?.sourceType === 'image_ocr').length;
    const researchedCount = allFields.filter(f => f.evidence?.sourceTier && f.evidence.sourceTier <= 5).length;
    const missingCount = allFields.filter(f => f.status === 'missing' || !f.value).length;

    const groundedFields = allFields.filter(f => f.status !== 'missing' && f.confidence > 0);
    const avgConfidence = groundedFields.length > 0
      ? groundedFields.reduce((acc, curr) => acc + curr.confidence, 0) / groundedFields.length
      : 0;

    const enrichedSheet: CentralProductSheet = {
      ...baseSheet,
      updatedAt: now,
      ean: updatedEan.value ? updatedEan : baseSheet.ean,
      brand: updatedBrand,
      model: updatedModel,
      title: updatedTitle,
      packageWeightKg: updatedWeight,
      packageHeightCm: updatedHeight,
      packageWidthCm: updatedWidth,
      packageLengthCm: updatedLength,
      ncm: updatedNcm,
      warrantyDays: updatedWarranty,
      attributes: newAttributes,
      overallConfidenceScore: Number(avgConfidence.toFixed(2)),
      hasUnresolvedConflicts: conflictCount > 0
    };

    const report: TruthEngineReport = {
      confirmedCount,
      readFromImageCount,
      researchedCount,
      conflictCount,
      missingCount,
      rejectedVariantItems: rejectedVariants,
      corroboratedFields,
      unsupportedFields: baseSheet.descriptionPlain.status === 'missing' 
        ? ['descriptionPlain', 'bulletPoints'] 
        : []
    };

    return {
      sheet: enrichedSheet,
      report
    };
  }
}
