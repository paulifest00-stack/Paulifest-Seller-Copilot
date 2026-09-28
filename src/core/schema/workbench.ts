import type { AuditedField } from './product.ts';

export interface Keywords { principais: string[]; relacionadas: string[]; variacoes: string[] }
export type ImageKind = 'principal' | 'objecoes' | 'detalhes' | 'contexto' | 'escala' | 'conteudo' | 'festa';
export interface ImageBrief {
  kind: ImageKind; title: string; prompt: string; layout: 'A' | 'B' | 'C';
  imageId?: string; generatedAt?: string;
}
export interface ProductVariation { id: string; label: string; sku: string; ean: AuditedField<string> }
export interface ResearchReference { title: string; url: string; snippet: string; retrievedAt: string }
export interface ProductWorkbench {
  titleComparison?: { titleB: string; viewsA: number; clicksA: number; viewsB: number; clicksB: number };
  keywords?: AuditedField<Keywords>;
  briefs?: ImageBrief[];
  variations?: ProductVariation[];
  references?: ResearchReference[];
  kit?: { quantity: number; baseSheetId: string; baseName: string; baseSku: string };
}
