import type { 
  AuditedField, 
  FieldEvidence, 
  ProductImage, 
  ExternalProductReference,
  ProductStockInfo
} from '../../core/schema/product.ts';
import { createAuditedField } from '../../core/schema/product.ts';
import type { BlingMappingContext } from './contracts.ts';
import { 
  validateBlingProductInput, 
  parseBlingNumber, 
  parseBlingGtin, 
  resolveConfirmedDimensionUnit, 
  resolveConfirmedWeightUnit 
} from './runtime-validator.ts';

export interface BlingSheetPatch {
  ean?: AuditedField<string>;
  sku?: AuditedField<string>;
  title?: AuditedField<string>;
  brand?: AuditedField<string>;
  model?: AuditedField<string>;
  ncm?: AuditedField<string>;
  packageWeightKg?: AuditedField<number>;
  packageHeightCm?: AuditedField<number>;
  packageWidthCm?: AuditedField<number>;
  packageLengthCm?: AuditedField<number>;
  costPrice?: AuditedField<number>;
  currentSalePrice?: AuditedField<number>;
  descriptionPlain?: AuditedField<string>;
  stockInfo?: AuditedField<ProductStockInfo>;
  images?: ProductImage[];
  externalReference?: ExternalProductReference;
}

export interface BlingMappingOutput {
  patch: BlingSheetPatch;
  warnings: string[];
  unknownFields: string[];
  externalReference?: ExternalProductReference;
}

/**
 * Cria evidência auditável garantindo que sourceId NUNCA seja gerado como string vazia.
 */
function createBlingEvidence(
  externalId: string | undefined,
  rawKey: string,
  timestamp: string,
  sourceName?: string,
  rawSnippet?: string
): FieldEvidence {
  const ev: FieldEvidence = {
    sourceType: 'erp_api_record',
    sourceTier: 4,
    sourceName: sourceName || 'Bling ERP v3',
    rawFieldKey: rawKey,
    capturedAt: timestamp,
    retrievedAt: timestamp,
    extractedSnippet: rawSnippet || (externalId ? `Campo "${rawKey}" do registro Bling #${externalId}` : `Campo "${rawKey}"`),
    evidenceStrength: 'high'
  };

  // REGRA: Não gerar evidência com sourceId: ''
  if (externalId && externalId.trim().length > 0) {
    ev.sourceId = externalId.trim();
  }

  return ev;
}

/**
 * Função Pura: Mapeia um payload bruto de produto do Bling ERP em um patch auditado para a CentralProductSheet.
 * 
 * Regras estritas:
 * 1. Somente campos presentes e válidos entram no patch.
 * 2. source = 'bling_erp', status = 'pending_review'.
 * 3. Identidade mínima: externalId deve vir de dto.id ou context.externalId. Se ausente, não cria ExternalProductReference e emite warning.
 * 4. NUNCA gera evidência com sourceId: ''.
 * 5. Preço de venda vai para currentSalePrice (suggestedSalePrice NUNCA é preenchido).
 * 6. Custo vai para costPrice.
 * 7. Estoque é expressamente ignorado (não vira atributo técnico permanente).
 * 8. Dimensões e peso só entram se a unidade estiver confirmada no contexto (Fact-or-Omit).
 * 9. Campos desconhecidos não entram na ficha e são reportados em unknownFields.
 */
export function mapBlingProductToSheetPatch(
  input: unknown,
  context?: BlingMappingContext
): BlingMappingOutput {
  const timestamp = context?.retrievedAt || new Date().toISOString();
  const validation = validateBlingProductInput(input, context);

  const warnings = [...validation.warnings];
  const unknownFields = [...validation.unknownFields];
  const patch: BlingSheetPatch = {};

  if (!validation.isValid || !validation.sanitized) {
    return {
      patch,
      warnings,
      unknownFields
    };
  }

  const dto = validation.sanitized;
  
  // Resolução rigorosa do External ID
  const rawId = dto.id !== undefined && dto.id !== null ? String(dto.id).trim() : '';
  const contextId = context?.externalId ? String(context.externalId).trim() : '';
  const externalId = rawId || contextId || undefined;

  if (!externalId) {
    warnings.push('Identificador externo ausente (nem dto.id nem context.externalId fornecidos). ExternalProductReference não gerada e evidências sem sourceId.');
  }

  // 1. Título / Nome
  if (dto.nome && typeof dto.nome === 'string' && dto.nome.trim()) {
    patch.title = createAuditedField(
      dto.nome.trim(),
      'bling_erp',
      0.95,
      'pending_review',
      createBlingEvidence(externalId, 'nome', timestamp, context?.sourceName, dto.nome)
    );
  }

  // 2. SKU / Código
  if (dto.codigo !== undefined && dto.codigo !== null && String(dto.codigo).trim()) {
    const skuVal = String(dto.codigo).trim();
    patch.sku = createAuditedField(
      skuVal,
      'bling_erp',
      0.95,
      'pending_review',
      createBlingEvidence(externalId, 'codigo', timestamp, context?.sourceName, skuVal)
    );
  }

  // 3. EAN / GTIN
  if (dto.gtin !== undefined && dto.gtin !== null && String(dto.gtin).trim()) {
    const parsedGtin = parseBlingGtin(dto.gtin);
    if (parsedGtin.value) {
      patch.ean = createAuditedField(
        parsedGtin.value,
        'bling_erp',
        0.95,
        'pending_review',
        createBlingEvidence(externalId, 'gtin', timestamp, context?.sourceName, parsedGtin.value)
      );
    } else if (parsedGtin.warning) {
      warnings.push(parsedGtin.warning);
    }
  }

  // 4. Marca
  if (dto.marca && typeof dto.marca === 'string' && dto.marca.trim()) {
    patch.brand = createAuditedField(
      dto.marca.trim(),
      'bling_erp',
      0.90,
      'pending_review',
      createBlingEvidence(externalId, 'marca', timestamp, context?.sourceName, dto.marca)
    );
  }

  // 5. NCM (tributacao.ncm)
  if (dto.tributacao?.ncm && typeof dto.tributacao.ncm === 'string' && dto.tributacao.ncm.trim()) {
    const ncmStr = dto.tributacao.ncm.trim().replace(/[^\d]/g, '');
    if (ncmStr.length >= 2) {
      patch.ncm = createAuditedField(
        ncmStr,
        'bling_erp',
        0.90,
        'pending_review',
        createBlingEvidence(externalId, 'tributacao.ncm', timestamp, context?.sourceName, ncmStr)
      );
    } else {
      warnings.push(`NCM inválido descartado: "${dto.tributacao.ncm}"`);
    }
  }

  // 6. Preço de Venda Praticado (currentSalePrice - JAMAIS suggestedSalePrice)
  if (dto.preco !== undefined && dto.preco !== null && dto.preco !== '') {
    const parsedPrice = parseBlingNumber(dto.preco, 'preco');
    if (parsedPrice.isValid && parsedPrice.value !== null) {
      patch.currentSalePrice = createAuditedField(
        parsedPrice.value,
        'bling_erp',
        0.95,
        'pending_review',
        createBlingEvidence(externalId, 'preco', timestamp, context?.sourceName, String(dto.preco))
      );
    } else if (parsedPrice.warning) {
      warnings.push(parsedPrice.warning);
    }
  }

  // 7. Preço de Custo (costPrice)
  if (dto.precoCusto !== undefined && dto.precoCusto !== null && dto.precoCusto !== '') {
    const parsedCost = parseBlingNumber(dto.precoCusto, 'precoCusto');
    if (parsedCost.isValid && parsedCost.value !== null) {
      patch.costPrice = createAuditedField(
        parsedCost.value,
        'bling_erp',
        0.95,
        'pending_review',
        createBlingEvidence(externalId, 'fornecedor.precoCusto', timestamp, context?.sourceName, String(dto.precoCusto))
      );
    } else if (parsedCost.warning) {
      warnings.push(parsedCost.warning);
    }
  }

  // 8. Dimensões do Pacote (apenas quando unidade for confirmada via context)
  if (dto.dimensoes && typeof dto.dimensoes === 'object') {
    const dimUnitResult = resolveConfirmedDimensionUnit(context);
    if (dimUnitResult.unit) {
      const unit = dimUnitResult.unit;
      const factorToCm = unit === 'cm' ? 1 : unit === 'mm' ? 0.1 : 100; // m -> cm

      const pLargura = parseBlingNumber(dto.dimensoes.largura, 'dimensoes.largura');
      const pAltura = parseBlingNumber(dto.dimensoes.altura, 'dimensoes.altura');
      const pComprimento = parseBlingNumber(dto.dimensoes.profundidade, 'dimensoes.profundidade');

      if (pLargura.isValid && pLargura.value !== null) {
        patch.packageWidthCm = createAuditedField(
          Number((pLargura.value * factorToCm).toFixed(2)),
          'bling_erp',
          0.90,
          'pending_review',
          createBlingEvidence(externalId, 'dimensoes.largura', timestamp, context?.sourceName, `${dto.dimensoes.largura} ${unit}`)
        );
      } else if (pLargura.warning) {
        warnings.push(pLargura.warning);
      }

      if (pAltura.isValid && pAltura.value !== null) {
        patch.packageHeightCm = createAuditedField(
          Number((pAltura.value * factorToCm).toFixed(2)),
          'bling_erp',
          0.90,
          'pending_review',
          createBlingEvidence(externalId, 'dimensoes.altura', timestamp, context?.sourceName, `${dto.dimensoes.altura} ${unit}`)
        );
      } else if (pAltura.warning) {
        warnings.push(pAltura.warning);
      }

      if (pComprimento.isValid && pComprimento.value !== null) {
        patch.packageLengthCm = createAuditedField(
          Number((pComprimento.value * factorToCm).toFixed(2)),
          'bling_erp',
          0.90,
          'pending_review',
          createBlingEvidence(externalId, 'dimensoes.profundidade', timestamp, context?.sourceName, `${dto.dimensoes.profundidade} ${unit}`)
        );
      } else if (pComprimento.warning) {
        warnings.push(pComprimento.warning);
      }
    } else if (dimUnitResult.warning) {
      warnings.push(dimUnitResult.warning);
    }
  }

  // 9. Peso Bruto do Pacote (apenas se unidade confirmada via context)
  const rawWeight = dto.pesoBruto ?? dto.pesoLiquido;
  if (rawWeight !== undefined && rawWeight !== null && rawWeight !== '') {
    const weightUnitResult = resolveConfirmedWeightUnit(context);
    if (weightUnitResult.unit) {
      const parsedWeight = parseBlingNumber(rawWeight, 'pesoBruto');
      if (parsedWeight.isValid && parsedWeight.value !== null) {
        const factorToKg = weightUnitResult.unit === 'kg' ? 1 : 0.001;
        patch.packageWeightKg = createAuditedField(
          Number((parsedWeight.value * factorToKg).toFixed(3)),
          'bling_erp',
          0.90,
          'pending_review',
          createBlingEvidence(externalId, 'pesoBruto', timestamp, context?.sourceName, `${rawWeight} ${weightUnitResult.unit}`)
        );
      } else if (parsedWeight.warning) {
        warnings.push(parsedWeight.warning);
      }
    } else if (weightUnitResult.warning) {
      warnings.push(weightUnitResult.warning);
    }
  }

  // 10. Descrição
  const rawDesc = dto.descricaoCurta || dto.descricaoComplementar;
  if (rawDesc && typeof rawDesc === 'string' && rawDesc.trim()) {
    patch.descriptionPlain = createAuditedField(
      rawDesc.trim(),
      'bling_erp',
      0.85,
      'pending_review',
      createBlingEvidence(externalId, 'descricaoCurta', timestamp, context?.sourceName, rawDesc.trim().substring(0, 100))
    );
  }

  // 10b. Estoque estruturado (se fornecido no contexto de importação)
  if (context?.stockInfo) {
    patch.stockInfo = createAuditedField(
      context.stockInfo,
      'bling_erp',
      0.95,
      'pending_review',
      createBlingEvidence(
        externalId,
        'estoques/saldos',
        timestamp,
        context?.sourceName,
        `Saldos Bling: ${context.stockInfo.virtualTotal} disp / ${context.stockInfo.physicalTotal} físico`
      )
    );
  }

  // 11. Imagens
  const imageUrls: string[] = [];
  if (Array.isArray(dto.imagensUrl)) {
    for (const u of dto.imagensUrl) {
      if (typeof u === 'string' && u.trim().startsWith('http')) imageUrls.push(u.trim());
    }
  }
  if (dto.midia?.imagens?.externas && Array.isArray(dto.midia.imagens.externas)) {
    for (const item of dto.midia.imagens.externas) {
      const u = item.link || item.url;
      if (typeof u === 'string' && u.trim().startsWith('http')) imageUrls.push(u.trim());
    }
  }
  if (dto.midia?.imagens?.internas && Array.isArray(dto.midia.imagens.internas)) {
    for (const item of dto.midia.imagens.internas) {
      const u = item.link || item.url;
      if (typeof u === 'string' && u.trim().startsWith('http')) imageUrls.push(u.trim());
    }
  }

  if (imageUrls.length > 0) {
    patch.images = imageUrls.map((url, idx) => ({
      id: `img_bling_${idx}_${Math.random().toString(36).substring(2, 6)}`,
      url,
      isMain: idx === 0,
      status: createAuditedField(
        'approved' as const,
        'bling_erp',
        0.90,
        'pending_review',
        createBlingEvidence(externalId, 'midia.imagens', timestamp, context?.sourceName, url)
      )
    }));
  }

  // 12. External Product Reference (somente com externalId confiável)
  if (externalId) {
    const extRef: ExternalProductReference = {
      system: 'bling',
      externalId,
      sku: patch.sku?.value || (dto.codigo ? String(dto.codigo).trim() : undefined),
      context: 'api_v3',
      importedAt: timestamp,
      lastSyncedAt: timestamp
    };
    patch.externalReference = extRef;
  }

  return {
    patch,
    warnings,
    unknownFields,
    externalReference: patch.externalReference
  };
}
