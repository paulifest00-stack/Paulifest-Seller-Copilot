import { REGRA_OURO } from '../engines/identification/prompts.ts';
import { sanitizeName } from '../engines/identification/sanitizer.ts';
import { GEMINI_MODEL, requestGeminiJson, limitMlTitle } from './gemini-client.ts';
// Gateway de IA Desacoplado (AIProvider) para Identificação de Produtos
import type { FieldSource } from '../schema/product.ts';
import { generateSkuFromTitle } from '../engines/identification/sku-generator.ts';

export interface AIIdentificationRequest {
  imageBase64?: string;       // Imagem em formato data:image/... ou base64 puro
  mimeType?: string;          // image/jpeg, image/png, image/webp
  ean?: string;               // EAN informado pelo usuário ou leitor
  rawName?: string;           // Nome básico ou palavras-chave digitadas
}

export interface RawIdentifiedAttribute {
  value: string | number;
  evidence: string;           // Trecho textual ou evidência visual comprovável
  confidence: number;         // 0.0 a 1.0
  source: FieldSource;
}

export interface AIIdentificationResponse {
  identified: boolean;
  productSummary: string;     // Resumo de 1 linha do produto detectado
  detectedEan?: RawIdentifiedAttribute;
  brand?: RawIdentifiedAttribute;
  model?: RawIdentifiedAttribute;
  title?: RawIdentifiedAttribute;       // Título otimizado para Mercado Livre (máx 60 caracteres)
  titleBling?: RawIdentifiedAttribute;  // Título descritivo completo para o Bling ERP
  generatedSku?: RawIdentifiedAttribute;// SKU padronizado gerado automaticamente
  categoryML?: RawIdentifiedAttribute;
  categoryPath?: RawIdentifiedAttribute;
  packageWeightKg?: RawIdentifiedAttribute;
  dimensionsCm?: {
    height?: RawIdentifiedAttribute;
    width?: RawIdentifiedAttribute;
    length?: RawIdentifiedAttribute;
  };
  attributes: Record<string, RawIdentifiedAttribute>; // ex: voltagem, cor, potencia, material
  warrantyDays?: RawIdentifiedAttribute;
  ncmSuggested?: RawIdentifiedAttribute;
  unsupportedFields: string[]; // Lista de campos omitidos por ausência de evidência (Fact-or-Omit)
  isSimulated: boolean;
  providerName: string;
}

export interface IAIProvider {
  readonly providerId: string;
  identifyProduct(request: AIIdentificationRequest): Promise<AIIdentificationResponse>;
}

// ---------------------------------------------------------------------------
// PROVEDOR SIMULADO / MOCK (MockAIProvider)
// ---------------------------------------------------------------------------

/**
 * Provedor Mock para testes unitários e modo offline/demonstração.
 * Respeita rigorosamente a regra Fact-or-Omit e fornece evidências estruturadas.
 */
export class MockAIProvider implements IAIProvider {
  readonly providerId = 'mock-ai-provider';

  async identifyProduct(request: AIIdentificationRequest): Promise<AIIdentificationResponse> {
    const textContext = `${request.rawName || ''} ${request.ean || ''}`.toLowerCase();
    const hasImage = Boolean(request.imageBase64 && request.imageBase64.length > 50);
    const isBoschImage = hasImage && (request.imageBase64?.toLowerCase().includes('bosch') || textContext.includes('gsb'));

    // Caso 1: Ferramenta / Furadeira Bosch
    if (textContext.includes('bosch') || textContext.includes('furadeira') || isBoschImage) {
      // Se NÃO houver imagem e NÃO houver EAN (apenas nome preliminar fornecido)
      if (!hasImage && !request.ean) {
        return {
          identified: true,
          productSummary: 'Furadeira Bosch GSB 13 RE',
          brand: {
            value: 'Bosch',
            evidence: 'Extraído do termo textual "Bosch"',
            confidence: 0.90,
            source: 'ai_generated'
          },
          model: {
            value: 'GSB 13 RE',
            evidence: 'Extraído do termo textual "GSB 13 RE"',
            confidence: 0.90,
            source: 'ai_generated'
          },
          title: {
            value: 'Furadeira Bosch GSB 13 RE',
            evidence: 'Nome preliminar informado pelo usuário',
            confidence: 0.85,
            source: 'ai_generated'
          },
          titleBling: {
            value: 'Furadeira de Impacto Bosch GSB 13 RE',
            evidence: 'Nome preliminar para cadastro no Bling',
            confidence: 0.85,
            source: 'ai_generated'
          },
          generatedSku: {
            value: generateSkuFromTitle('Furadeira Bosch GSB 13 RE', 'Bosch', 'GSB 13 RE'),
            evidence: 'SKU gerado automaticamente pelo padrão do nome no Bling',
            confidence: 0.95,
            source: 'rule_engine'
          },
          categoryML: {
            value: 'MLB1051',
            evidence: 'Classificação preliminar por palavras-chave',
            confidence: 0.70,
            source: 'ai_generated'
          },
          categoryPath: {
            value: 'Ferramentas e Construção > Ferramentas Elétricas > Furadeiras',
            evidence: 'Mapeamento taxonômico preliminar',
            confidence: 0.70,
            source: 'ai_generated'
          },
          attributes: {},
          unsupportedFields: [
            'packageWeightKg', 
            'dimensionsCm', 
            'ncmSuggested', 
            'warrantyDays', 
            'VOLTAGE', 
            'POWER', 
            'CHUCK_SIZE'
          ],
          isSimulated: true,
          providerName: 'Mock AI Engine (Modo Demonstração - Sem Imagem)'
        };
      }

      // Se houver imagem ou EAN disponível
      const boschBlingTitle = 'Furadeira de Impacto Bosch GSB 13 RE 750W 127V com Maleta';
      const boschMlTitle = 'Furadeira Impacto Bosch Gsb 13 Re 750w 127v Maleta';
      return {
        identified: true,
        productSummary: 'Furadeira de Impacto Bosch GSB 13 RE 750W 127V',
        detectedEan: request.ean ? {
          value: request.ean,
          evidence: `Código de barras informado e validado na embalagem: ${request.ean}`,
          confidence: 1.0,
          source: 'ean_catalog'
        } : undefined,
        brand: {
          value: 'Bosch',
          evidence: 'Logotipo visual e texto "BOSCH" nítido na carcaça do produto',
          confidence: 0.95,
          source: 'ai_generated'
        },
        model: {
          value: 'GSB 13 RE',
          evidence: 'Inscrição do modelo "GSB 13 RE" visível na etiqueta frontal',
          confidence: 0.92,
          source: 'ai_generated'
        },
        title: {
          value: boschMlTitle,
          evidence: 'Composição de marca, modelo e especificações otimizada para ML (máx 60 chars)',
          confidence: 0.90,
          source: 'ai_generated'
        },
        titleBling: {
          value: boschBlingTitle,
          evidence: 'Composição técnica completa para ERP Bling',
          confidence: 0.90,
          source: 'ai_generated'
        },
        generatedSku: {
          value: generateSkuFromTitle(boschBlingTitle, 'Bosch', 'GSB 13 RE'),
          evidence: 'SKU gerado automaticamente a partir do nome no Bling',
          confidence: 0.95,
          source: 'rule_engine'
        },
        categoryML: {
          value: 'MLB1051',
          evidence: 'Classificação visual correspondente à categoria Ferramentas Elétricas',
          confidence: 0.88,
          source: 'ai_generated'
        },
        categoryPath: {
          value: 'Ferramentas e Construção > Ferramentas Elétricas > Furadeiras',
          evidence: 'Mapeamento taxonômico de furadeiras de impacto',
          confidence: 0.88,
          source: 'ai_generated'
        },
        packageWeightKg: {
          value: 1.8,
          evidence: 'Especificação técnica da embalagem indicando peso líquido/bruto ~1.8kg',
          confidence: 0.85,
          source: 'ai_generated'
        },
        dimensionsCm: {
          height: { value: 25, evidence: 'Dimensão da caixa comercial', confidence: 0.75, source: 'ai_generated' },
          width: { value: 10, evidence: 'Dimensão da caixa comercial', confidence: 0.75, source: 'ai_generated' },
          length: { value: 30, evidence: 'Dimensão da caixa comercial', confidence: 0.75, source: 'ai_generated' }
        },
        attributes: {
          'VOLTAGE': {
            value: '127V',
            evidence: 'Gravação "127V ~ 60Hz" visível na plaqueta técnica',
            confidence: 0.95,
            source: 'ai_generated'
          },
          'POWER': {
            value: '750 W',
            evidence: 'Inscrição "750 Watts" em destaque na embalagem',
            confidence: 0.95,
            source: 'ai_generated'
          },
          'CHUCK_SIZE': {
            value: '1/2 pol (13 mm)',
            evidence: 'Identificação de mandril 1/2" visível',
            confidence: 0.90,
            source: 'ai_generated'
          }
        },
        warrantyDays: {
          value: 365,
          evidence: 'Selo "Garantia de 1 Ano de Fábrica" impresso na caixa',
          confidence: 0.95,
          source: 'ai_generated'
        },
        ncmSuggested: {
          value: '8467.21.00',
          evidence: 'NCM fiscal oficial para furadeiras eletromecânicas portáteis',
          confidence: 0.85,
          source: 'rule_engine'
        },
        unsupportedFields: ['cor_secundaria', 'velocidade_variavel_rpm', 'bateria_inclusa'],
        isSimulated: true,
        providerName: 'Mock AI Engine (Simulação Fact-or-Omit)'
      };
    }

    // Caso 2: Alimento / Bebida (ex: Coca-Cola ou 7894900011517)
    if (textContext.includes('coca') || textContext.includes('refrigerante') || request.ean === '7894900011517') {
      return {
        identified: true,
        productSummary: 'Refrigerante Coca-Cola Original Garrafa 2L Pet',
        detectedEan: {
          value: '7894900011517',
          evidence: 'Código EAN-13 GS1 autêntico reconhecido: 7894900011517',
          confidence: 1.0,
          source: 'ean_catalog'
        },
        brand: {
          value: 'Coca-Cola',
          evidence: 'Marca nominativa e tipográfica Coca-Cola no rótulo',
          confidence: 0.98,
          source: 'ai_generated'
        },
        model: {
          value: 'Original Pet 2L',
          evidence: 'Rótulo frontal indicando embalagem PET 2 Litros',
          confidence: 0.95,
          source: 'ai_generated'
        },
        title: {
          value: 'Refrigerante Coca-Cola 2 Litros Pet Original',
          evidence: 'Composição otimizada para Mercado Livre (máx 60 caracteres)',
          confidence: 0.95,
          source: 'ai_generated'
        },
        titleBling: {
          value: 'Refrigerante Coca-Cola Original Garrafa Pet 2 Litros Sabor Tradicional',
          evidence: 'Composição descritiva completa para Bling ERP',
          confidence: 0.95,
          source: 'ai_generated'
        },
        generatedSku: {
          value: generateSkuFromTitle('Refrigerante Coca-Cola Garrafa Pet 2 Litros Original', 'Coca-Cola', '2 Litros'),
          evidence: 'SKU gerado automaticamente pelo padrão do nome no Bling',
          confidence: 0.95,
          source: 'rule_engine'
        },
        categoryML: {
          value: 'MLB1403',
          evidence: 'Classificação Alimentos e Bebidas > Bebidas > Refrigerantes',
          confidence: 0.90,
          source: 'ai_generated'
        },
        categoryPath: {
          value: 'Alimentos e Bebidas > Refrigerantes',
          evidence: 'Árvore de categoria canônica Mercado Livre',
          confidence: 0.90,
          source: 'ai_generated'
        },
        packageWeightKg: {
          value: 2.1,
          evidence: 'Conteúdo de 2000ml com embalagem plástica ~2.1kg',
          confidence: 0.90,
          source: 'ai_generated'
        },
        dimensionsCm: {
          height: { value: 35, evidence: 'Altura padrão garrafa 2L', confidence: 0.85, source: 'ai_generated' },
          width: { value: 11, evidence: 'Diâmetro padrão garrafa 2L', confidence: 0.85, source: 'ai_generated' },
          length: { value: 11, evidence: 'Diâmetro padrão garrafa 2L', confidence: 0.85, source: 'ai_generated' }
        },
        attributes: {
          'FLAVOR': {
            value: 'Cola',
            evidence: 'Sabor clássico de cola indicado no rótulo',
            confidence: 0.98,
            source: 'ai_generated'
          },
          'VOLUME': {
            value: '2 Litros',
            evidence: 'Volume líquido impresso no canto frontal: 2L',
            confidence: 0.98,
            source: 'ai_generated'
          }
        },
        warrantyDays: {
          value: 30,
          evidence: 'Prazo legal de produto de consumo perecível',
          confidence: 0.90,
          source: 'rule_engine'
        },
        ncmSuggested: {
          value: '2202.10.00',
          evidence: 'Classificação NCM para águas gaseificadas e refrigerantes aromatizados',
          confidence: 0.90,
          source: 'rule_engine'
        },
        unsupportedFields: ['potencia', 'voltagem', 'tamanho_calcado'],
        isSimulated: true,
        providerName: 'Mock AI Engine (Simulação Fact-or-Omit)'
      };
    }

    // Caso Genérico: Extração baseada em texto fornecido ou imagem genérica
    const fallbackBrand = request.rawName?.split(' ')[0] || (hasImage ? 'Genérico' : '');
    const fallbackTitle = request.rawName ? `${request.rawName.trim()}` : hasImage ? 'Item Identificado por Imagem' : '';

    return {
      identified: Boolean(fallbackTitle || request.ean),
      productSummary: fallbackTitle || 'Produto com dados mínimos',
      detectedEan: request.ean ? {
        value: request.ean,
        evidence: `EAN fornecido: ${request.ean}`,
        confidence: 1.0,
        source: 'user_manual'
      } : undefined,
      brand: fallbackBrand ? {
        value: fallbackBrand,
        evidence: `Identificado pelo termo inicial: "${fallbackBrand}"`,
        confidence: 0.70,
        source: 'ai_generated'
      } : undefined,
      title: fallbackTitle ? {
        value: fallbackTitle.slice(0, 60),
        evidence: 'Título para Mercado Livre (máx 60 caracteres)',
        confidence: 0.75,
        source: 'ai_generated'
      } : undefined,
      titleBling: fallbackTitle ? {
        value: fallbackTitle,
        evidence: 'Título completo para cadastro no Bling',
        confidence: 0.75,
        source: 'ai_generated'
      } : undefined,
      generatedSku: fallbackTitle ? {
        value: generateSkuFromTitle(fallbackTitle, fallbackBrand),
        evidence: 'SKU gerado automaticamente pelo padrão do nome no Bling',
        confidence: 0.90,
        source: 'rule_engine'
      } : undefined,
      categoryML: {
        value: 'MLB1051',
        evidence: 'Categoria padrão estimada',
        confidence: 0.60,
        source: 'rule_engine'
      },
      categoryPath: {
        value: 'Geral',
        evidence: 'Classificação inicial',
        confidence: 0.60,
        source: 'rule_engine'
      },
      packageWeightKg: {
        value: 0.5,
        evidence: 'Peso estimado padrão de 500g',
        confidence: 0.50,
        source: 'rule_engine'
      },
      attributes: {},
      warrantyDays: {
        value: 90,
        evidence: 'Garantia legal mínima do consumidor (CDC)',
        confidence: 1.0,
        source: 'rule_engine'
      },
      unsupportedFields: ['modelo', 'ncm', 'voltagem', 'dimensoes_exatas'],
      isSimulated: true,
      providerName: 'Mock AI Engine (Fallback Fact-or-Omit)'
    };
  }
}

// ---------------------------------------------------------------------------
// PROVEDOR GOOGLE GEMINI REAL (GeminiAIProvider)
// ---------------------------------------------------------------------------

export class AIProviderConfigError extends Error {
  constructor(message: string = 'Chave da API Gemini não configurada. Configure sua chave no painel ou ative o Modo Demonstração.') {
    super(message);
    this.name = 'AIProviderConfigError';
  }
}

export class GeminiAIProvider implements IAIProvider {
  readonly providerId = GEMINI_MODEL;

  constructor(private apiKey?: string) {}

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async identifyProduct(request: AIIdentificationRequest): Promise<AIIdentificationResponse> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new AIProviderConfigError(
        'Chave da API Gemini não configurada. Configure sua chave no painel ou ative o Modo Demonstração.'
      );
    }

    const parts: any[] = [];

    // Adiciona imagem caso fornecida
    if (request.imageBase64) {
      const dataUrl = request.imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
      const cleanBase64 = dataUrl?.[2] || request.imageBase64;
      if (/^https?:/i.test(cleanBase64)) throw new Error('Envie a foto pelo botão de upload antes de identificar.');
      parts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: dataUrl?.[1] || request.mimeType || 'image/jpeg'
        }
      });
    }

    // Prompt com Regra Estrita Fact-or-Omit
    const systemInstruction = `Você é o motor de visão e identificação técnica do Paulifest Seller Copilot para e-commerce.
REGRAS INEGOCIÁVEIS:
1. FACT-OR-OMIT: Preencha apenas dados com EVIDÊNCIA VISÍVEL na imagem ou texto fornecido. NUNCA INVENTE ou faça suposições.
2. Se um atributo não estiver explícito na imagem ou texto, NÃO o inclua nos atributos principais; liste-o em "unsupportedFields".
3. Para cada campo preenchido, você DEVE fornecer uma "evidence" (exata citação visual ou trecho de texto).
4. TÍTULOS:
   - "title" (Mercado Livre): deve ser rigorosamente otimizado para o Mercado Livre com no MÁXIMO 60 caracteres (Produto + Marca + Modelo + Especificação principal), sem palavras subjetivas (como "lindo", "promoção", "oferta", "frete grátis").
   - "titleBling" (Bling ERP): nome curto e simples para identificar o produto no Bling, SEMPRE EM MAIÚSCULAS. Use tipo + marca e apenas a medida ou característica essencial conhecida. Não use frases comerciais ou palavras-chave extras.
5. Se houver código de barras ou EAN legível na embalagem, extraia em detectedEan e confira o checksum.`;

    const userText = `Identifique o produto com base nos dados disponíveis.
Nome preliminar: ${sanitizeName(request.rawName || '') || 'Não informado'}
EAN fornecido: ${request.ean || 'Não informado'}

Retorne um objeto JSON neste formato (campos sem evidência devem ser omitidos):
{"productSummary":"resumo","title":{"value":"Título ML","evidence":"trecho fornecido","confidence":0.8},"titleBling":{"value":"NOME SIMPLES","evidence":"trecho fornecido","confidence":0.8},"attributes":{},"unsupportedFields":[]}
Os campos opcionais brand, model, detectedEan, packageWeightKg, warrantyDays, ncmSuggested usam objetos com value, evidence e confidence. dimensionsCm contém height, width, length no mesmo formato. attributes é um mapa de atributos nesse formato. Não adivinhe IDs de categoria do Mercado Livre.`;

    parts.push({ text: userText });

    const parsed = await requestGeminiJson(this.apiKey, REGRA_OURO + systemInstruction, parts);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Gemini retornou uma ficha inválida.');
    const brandName = parsed.brand ? String(parsed.brand.value || '') : undefined;
    const modelName = parsed.model ? String(parsed.model.value || '') : undefined;
    const mlTitleStr = parsed.title ? limitMlTitle(typeof parsed.title === 'string' ? parsed.title : String(parsed.title.value || '')) : undefined;
    const blingTitleStr = parsed.titleBling ? (typeof parsed.titleBling === 'string' ? parsed.titleBling : String(parsed.titleBling.value || '')) : (mlTitleStr || '');
    const autoSku = generateSkuFromTitle(blingTitleStr || mlTitleStr || '', brandName, modelName);

    // Normaliza para AIIdentificationResponse
    return {
      identified: Boolean(parsed.brand || parsed.title || parsed.model || parsed.titleBling),
      productSummary: parsed.productSummary || blingTitleStr || mlTitleStr || 'Produto identificado via Gemini',
      detectedEan: parsed.detectedEan ? {
        value: String(parsed.detectedEan.value || ''),
        evidence: parsed.detectedEan.evidence || '',
        confidence: Number(parsed.detectedEan.confidence || 0.9),
        source: 'ai_generated'
      } : undefined,
      brand: parsed.brand ? {
        value: String(parsed.brand.value || ''),
        evidence: parsed.brand.evidence || '',
        confidence: Number(parsed.brand.confidence || 0.9),
        source: 'ai_generated'
      } : undefined,
      model: parsed.model ? {
        value: String(parsed.model.value || ''),
        evidence: parsed.model.evidence || '',
        confidence: Number(parsed.model.confidence || 0.85),
        source: 'ai_generated'
      } : undefined,
      title: mlTitleStr ? {
        value: mlTitleStr,
        evidence: parsed.title?.evidence || 'Título otimizado para Mercado Livre (máx 60 caracteres)',
        confidence: Number(parsed.title?.confidence || 0.85),
        source: 'ai_generated'
      } : undefined,
      titleBling: blingTitleStr ? {
        value: blingTitleStr.toUpperCase(),
        evidence: parsed.titleBling?.evidence || 'Título completo para o ERP Bling',
        confidence: Number(parsed.titleBling?.confidence || 0.85),
        source: 'ai_generated'
      } : undefined,
      generatedSku: {
        value: autoSku,
        evidence: `SKU padronizado gerado a partir do nome no Bling`,
        confidence: 0.95,
        source: 'rule_engine'
      },
      categoryML: parsed.categoryML ? {
        value: String(parsed.categoryML.value || ''),
        evidence: parsed.categoryML.evidence || '',
        confidence: Number(parsed.categoryML.confidence || 0.8),
        source: 'ai_generated'
      } : undefined,
      categoryPath: parsed.categoryPath ? {
        value: String(parsed.categoryPath.value || ''),
        evidence: parsed.categoryPath.evidence || '',
        confidence: Number(parsed.categoryPath.confidence || 0.8),
        source: 'ai_generated'
      } : undefined,
      packageWeightKg: parsed.packageWeightKg ? {
        value: Number(parsed.packageWeightKg.value),
        evidence: parsed.packageWeightKg.evidence || '',
        confidence: Number(parsed.packageWeightKg.confidence || 0.8),
        source: 'ai_generated'
      } : undefined,
      dimensionsCm: parsed.dimensionsCm,
      attributes: parsed.attributes || {},
      warrantyDays: parsed.warrantyDays ? {
        value: Number(parsed.warrantyDays.value),
        evidence: parsed.warrantyDays.evidence || '',
        confidence: Number(parsed.warrantyDays.confidence || 0.9),
        source: 'ai_generated'
      } : undefined,
      // NCM suggestions are obtained separately and checked against the official table.
      ncmSuggested: undefined,
      unsupportedFields: Array.isArray(parsed.unsupportedFields) ? parsed.unsupportedFields : [],
      isSimulated: false,
      providerName: GEMINI_MODEL
    };
  }
}

export const defaultAIProvider = new GeminiAIProvider();
