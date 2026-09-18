// Data Transfer Objects (DTO) para a API v3 do Bling ERP baseados exclusivamente na documentação oficial

export interface BlingProductDimensionsDTO {
  largura?: number | string;
  altura?: number | string;
  profundidade?: number | string;
}

export interface BlingProductTributacaoDTO {
  ncm?: string;
  origem?: number;
  cest?: string;
  [key: string]: unknown;
}

export interface BlingProductMediaItemDTO {
  link?: string;
  url?: string;
}

export interface BlingProductMidiaDTO {
  imagens?: {
    externas?: BlingProductMediaItemDTO[];
    internas?: BlingProductMediaItemDTO[];
  };
  [key: string]: unknown;
}

export interface BlingProductDTO {
  id?: number | string;
  nome?: string;
  codigo?: string;
  preco?: number | string;
  precoCusto?: number | string;
  tipo?: string;
  situacao?: string;
  formato?: string;
  descricaoCurta?: string;
  descricaoComplementar?: string;
  unidade?: string;
  pesoLiquido?: number | string;
  pesoBruto?: number | string;
  gtin?: string | number;
  gtinEmbalagem?: string | number;
  marca?: string;
  dimensoes?: BlingProductDimensionsDTO;
  tributacao?: BlingProductTributacaoDTO;
  midia?: BlingProductMidiaDTO;
  imagensUrl?: string[];
  estoque?: Record<string, unknown>;
}
