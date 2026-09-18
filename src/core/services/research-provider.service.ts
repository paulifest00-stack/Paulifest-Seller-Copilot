// Abstração e Provedores de Pesquisa Técnica Confiável Externa (IResearchProvider)
import type { 
  EvidenceSourceType, 
  SourceTier 
} from '../schema/product.ts';

export interface ProductIdentityQuery {
  ean?: string;
  brand?: string;
  model?: string;
  rawName?: string;
}

export type IdentityMatchMethod = 
  | 'exact_gtin' 
  | 'exact_brand_model' 
  | 'strong_identifier' 
  | 'divergent_variant' 
  | 'unmatched';

export interface ProductIdentityMatchResult {
  isMatch: boolean;
  matchMethod: IdentityMatchMethod;
  matchedIdentifier: string;
  sourceVariantDescription?: string;
  divergenceNotes?: string;
}

export interface ResearchExtractedFact {
  value: string | number;
  snippet: string;
  evidenceStrength: 'high' | 'medium' | 'low';
  rawFieldKey?: string;
}

export interface ResearchCandidateItem {
  id: string;
  title: string;
  brand?: string;
  model?: string;
  ean?: string;
  sourceType: EvidenceSourceType;
  sourceTier: SourceTier;
  sourceName: string;
  sourceUrl: string;
  sourceId: string;
  documentTitle: string;
  retrievedAt: string;
  identityMatch: ProductIdentityMatchResult;
  extractedFacts: Record<string, ResearchExtractedFact>;
}

export interface ProductResearchResult {
  query: ProductIdentityQuery;
  found: boolean;
  items: ResearchCandidateItem[];
  rejectedItemsCount: number;
  providerId: string;
  searchedAt: string;
}

export interface IResearchProvider {
  readonly providerId: string;
  searchProductFacts(query: ProductIdentityQuery): Promise<ProductResearchResult>;
}

// ---------------------------------------------------------------------------
// PROVEDOR DE PESQUISA DE TESTE / MOCK (MockResearchProvider)
// ---------------------------------------------------------------------------

/**
 * Base de conhecimento canônica simulada para testes determinísticos.
 * Produz fontes auditáveis com URL, título do documento, trecho e timestamp.
 */
export class MockResearchProvider implements IResearchProvider {
  readonly providerId = 'mock-research-provider';

  private catalog: Array<{
    ean?: string;
    brand: string;
    model: string;
    aliases: string[];
    sourceType: EvidenceSourceType;
    sourceTier: SourceTier;
    sourceName: string;
    sourceUrl: string;
    sourceId: string;
    documentTitle: string;
    isVariantDivergenceFor?: { brand: string; model: string; reason: string };
    facts: Record<string, ResearchExtractedFact>;
  }> = [
    // 1. Bosch GSB 13 RE Oficial (Tier 1 - Fabricante)
    {
      brand: 'Bosch',
      model: 'GSB 13 RE',
      aliases: ['furadeira bosch gsb 13 re', 'bosch gsb 13re', 'furadeira de impacto bosch 13 re'],
      sourceType: 'manufacturer_website',
      sourceTier: 1,
      sourceName: 'Bosch Ferramentas Profissionais Brasil',
      sourceUrl: 'https://www.bosch-professional.com/br/pt/products/gsb-13-re-06012171D0',
      sourceId: 'BOSCH-SKU-06012171D0',
      documentTitle: 'Especificações Técnicas e Manual: Furadeira GSB 13 RE Bosch',
      facts: {
        packageWeightKg: {
          value: 1.8,
          snippet: 'Peso sem cabo: 1,8 kg de acordo com o padrão industrial EPTA',
          evidenceStrength: 'high'
        },
        packageHeightCm: {
          value: 24,
          snippet: 'Dimensão da embalagem - Altura: 240 mm (24 cm)',
          evidenceStrength: 'high'
        },
        packageWidthCm: {
          value: 8,
          snippet: 'Dimensão da embalagem - Largura: 80 mm (8 cm)',
          evidenceStrength: 'high'
        },
        packageLengthCm: {
          value: 28,
          snippet: 'Dimensão da embalagem - Comprimento: 280 mm (28 cm)',
          evidenceStrength: 'high'
        },
        warrantyDays: {
          value: 365,
          snippet: 'Termo de garantia de fábrica Robert Bosch Ltda: 1 ano (365 dias)',
          evidenceStrength: 'high'
        },
        ncmSuggested: {
          value: '8467.21.00',
          snippet: 'Classificação Fiscal Fiscal Oficial NCM 8467.21.00 - Furadeiras eletromecânicas',
          evidenceStrength: 'high'
        },
        VOLTAGE: {
          value: '127V',
          snippet: 'Versão comercial padrão homologada: 127 Volts ~ 60Hz',
          evidenceStrength: 'high'
        },
        POWER: {
          value: '750 W',
          snippet: 'Potência absorvida nominal: 750 Watts de motor industrial',
          evidenceStrength: 'high'
        },
        CHUCK_SIZE: {
          value: '1/2 pol (13 mm)',
          snippet: 'Mandril com chave de fixação de 1/2" (13 mm)',
          evidenceStrength: 'high'
        }
      }
    },

    // 2. Bosch GSB 16 RE (Variante divergente / Modelo diferente)
    {
      brand: 'Bosch',
      model: 'GSB 16 RE',
      aliases: ['furadeira bosch gsb 16 re', 'gsb 16 re', 'gsb 16re'],
      sourceType: 'manufacturer_website',
      sourceTier: 1,
      sourceName: 'Bosch Ferramentas Profissionais Brasil',
      sourceUrl: 'https://www.bosch-professional.com/br/pt/products/gsb-16-re-06012171D1',
      sourceId: 'BOSCH-SKU-06012171D1',
      documentTitle: 'Especificações Técnicas Furadeira GSB 16 RE 850W',
      isVariantDivergenceFor: {
        brand: 'Bosch',
        model: 'GSB 13 RE',
        reason: 'Variante divergente: modelo encontrado é GSB 16 RE (850W), incompatível com o modelo solicitado GSB 13 RE (750W)'
      },
      facts: {
        packageWeightKg: {
          value: 2.1,
          snippet: 'Peso sem cabo: 2,1 kg',
          evidenceStrength: 'high'
        },
        POWER: {
          value: '850 W',
          snippet: 'Potência absorvida: 850 Watts',
          evidenceStrength: 'high'
        }
      }
    },

    // 3. Coca-Cola Original 2L PET (Tier 5 - GS1 / Tier 2 - Marca Oficial)
    {
      ean: '7894900011517',
      brand: 'Coca-Cola',
      model: 'Original Pet 2L',
      aliases: ['refrig coca cola pet 2000ml', 'coca-cola 2l', 'coca cola 2 litros garrafa'],
      sourceType: 'gs1_database',
      sourceTier: 5,
      sourceName: 'Cadastro Nacional de Produtos - GS1 Brasil',
      sourceUrl: 'https://cnp.gs1br.org/gtin/7894900011517',
      sourceId: 'GS1-GTIN-7894900011517',
      documentTitle: 'Registro Canônico de GTIN: 7894900011517 - Coca-Cola PET 2L',
      facts: {
        packageWeightKg: {
          value: 2.1,
          snippet: 'Peso bruto declarado no cadastro GS1: 2,100 kg com garrafa PET',
          evidenceStrength: 'high'
        },
        ncmSuggested: {
          value: '2202.10.00',
          snippet: 'NCM associado ao GTIN 7894900011517: 2202.10.00',
          evidenceStrength: 'high'
        },
        VOLUME: {
          value: '2 Litros',
          snippet: 'Conteúdo líquido registrado: 2000 ml',
          evidenceStrength: 'high'
        },
        FLAVOR: {
          value: 'Cola',
          snippet: 'Descrição sensorial homologada: Cola Tradicional',
          evidenceStrength: 'high'
        }
      }
    }
  ];

  /**
   * Permite que testes injetem itens dinâmicos no catálogo do mock.
   */
  addCustomCatalogItem(item: (typeof this.catalog)[0]) {
    this.catalog.push(item);
  }

  async searchProductFacts(query: ProductIdentityQuery): Promise<ProductResearchResult> {
    const now = new Date().toISOString();
    const queryText = `${query.brand || ''} ${query.model || ''} ${query.rawName || ''}`.toLowerCase().trim();
    const queryEan = query.ean?.trim();

    const matchedItems: ResearchCandidateItem[] = [];
    let rejectedCount = 0;

    for (const entry of this.catalog) {
      // 1. Verificação de Correspondência de Identidade do Produto:
      let identityMatch: ProductIdentityMatchResult = {
        isMatch: false,
        matchMethod: 'unmatched',
        matchedIdentifier: ''
      };

      // REGRA A: EAN / GTIN Exato (Evidência Forte Primária)
      if (queryEan && entry.ean && queryEan === entry.ean) {
        identityMatch = {
          isMatch: true,
          matchMethod: 'exact_gtin',
          matchedIdentifier: queryEan,
          sourceVariantDescription: `${entry.brand} ${entry.model}`
        };
      }
      // REGRA B: Marca + Modelo Exatos
      else if (
        query.brand && 
        query.model && 
        entry.brand.toLowerCase() === query.brand.toLowerCase() && 
        entry.model.toLowerCase() === query.model.toLowerCase()
      ) {
        identityMatch = {
          isMatch: true,
          matchMethod: 'exact_brand_model',
          matchedIdentifier: `${entry.brand} ${entry.model}`,
          sourceVariantDescription: `${entry.brand} ${entry.model}`
        };
      }
      // REGRA C: Reconhecimento por Alias / Texto
      else if (queryText.length >= 4) {
        const matchesBrand = entry.brand.toLowerCase().includes(query.brand?.toLowerCase() || '') ||
          queryText.includes(entry.brand.toLowerCase());
        const matchesModel = entry.model.toLowerCase().includes(query.model?.toLowerCase() || '') ||
          queryText.includes(entry.model.toLowerCase());
        const matchesAlias = entry.aliases.some(alias => queryText.includes(alias) || alias.includes(queryText));

        if ((matchesBrand && matchesModel) || matchesAlias) {
          // Verifica se é variante divergente configurada
          if (
            entry.isVariantDivergenceFor &&
            query.brand?.toLowerCase() === entry.isVariantDivergenceFor.brand.toLowerCase() &&
            query.model?.toLowerCase() === entry.isVariantDivergenceFor.model.toLowerCase()
          ) {
            identityMatch = {
              isMatch: false,
              matchMethod: 'divergent_variant',
              matchedIdentifier: `${entry.brand} ${entry.model}`,
              sourceVariantDescription: `${entry.brand} ${entry.model}`,
              divergenceNotes: entry.isVariantDivergenceFor.reason
            };
          } else {
            identityMatch = {
              isMatch: true,
              matchMethod: 'strong_identifier',
              matchedIdentifier: `${entry.brand} ${entry.model}`,
              sourceVariantDescription: `${entry.brand} ${entry.model}`
            };
          }
        }
      }

      // Se encontrou correspondência (ou divergência catalogada)
      if (identityMatch.matchMethod !== 'unmatched') {
        if (!identityMatch.isMatch) {
          rejectedCount++;
        }

        matchedItems.push({
          id: `item_${entry.brand}_${entry.model}_${Date.now()}`,
          title: `${entry.brand} ${entry.model}`,
          brand: entry.brand,
          model: entry.model,
          ean: entry.ean,
          sourceType: entry.sourceType,
          sourceTier: entry.sourceTier,
          sourceName: entry.sourceName,
          sourceUrl: entry.sourceUrl,
          sourceId: entry.sourceId,
          documentTitle: entry.documentTitle,
          retrievedAt: now,
          identityMatch,
          extractedFacts: entry.facts
        });
      }
    }

    return {
      query,
      found: matchedItems.some(i => i.identityMatch.isMatch),
      items: matchedItems,
      rejectedItemsCount: rejectedCount,
      providerId: this.providerId,
      searchedAt: now
    };
  }
}

export const defaultResearchProvider = new MockResearchProvider();
