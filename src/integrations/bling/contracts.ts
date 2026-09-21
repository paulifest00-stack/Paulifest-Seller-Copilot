// Contratos e Definições Canônicas da Integração com Bling ERP (API Oficial v3)

/**
 * Propriedades canônicas documentadas da API v3 de Produtos do Bling.
 * Qualquer campo fora desta lista é tratado como desconhecido/não suportado.
 */
export const BLING_DOCUMENTED_PRODUCT_FIELDS = [
  'id',
  'nome',
  'codigo',
  'preco',
  'precoCusto',
  'tipo',
  'situacao',
  'formato',
  'descricaoCurta',
  'descricaoComplementar',
  'unidade',
  'pesoLiquido',
  'pesoBruto',
  'gtin',
  'gtinEmbalagem',
  'marca',
  'dimensoes',
  'tributacao',
  'midia',
  'imagensUrl',
  'estoque' // Documentado na API, mas com regra explícita de descarte para ficha técnica permanente
] as const;

export type BlingDocumentedField = typeof BLING_DOCUMENTED_PRODUCT_FIELDS[number];

/**
 * Unidades físicas suportadas quando expressamente confirmadas por contrato ou contexto.
 * Nenhuma unidade é assumida tacitamente.
 */
export type ConfirmedDimensionUnit = 'cm' | 'mm' | 'm';
export type ConfirmedWeightUnit = 'kg' | 'g';

import type { ProductStockInfo } from '../../shared/gateway-contracts.ts';

/**
 * Contexto de execução e proveniência para o mapeamento de produtos Bling.
 */
export interface BlingMappingContext {
  externalId?: string;
  retrievedAt?: string;
  sourceName?: string;
  confirmedUnits?: {
    weight?: ConfirmedWeightUnit;
    dimension?: ConfirmedDimensionUnit;
  };
  stockInfo?: ProductStockInfo | null;
}
