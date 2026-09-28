export function validateWorkbench(value: unknown, audited: (v: unknown) => boolean): string[] {
  const errors: string[] = [];
  const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
  const string = (v: unknown, max = 1000) => typeof v === 'string' && v.length <= max;
  if (!object(value)) return ['workbench deve ser um objeto.'];
  if (value.titleComparison !== undefined && (!object(value.titleComparison) || !string(value.titleComparison.titleB,1000) || ['viewsA','clicksA','viewsB','clicksB'].some(k => !Number.isSafeInteger(value.titleComparison[k]) || value.titleComparison[k] < 0))) errors.push('Comparação de títulos inválida.');
  if (value.keywords !== undefined) {
    if (!audited(value.keywords) || !object(value.keywords.value) || ['principais', 'relacionadas', 'variacoes'].some(k => !Array.isArray(value.keywords.value[k]) || value.keywords.value[k].length > 12 || value.keywords.value[k].some((v: unknown) => !string(v, 80)))) errors.push('Palavras-chave inválidas.');
  }
  if (value.briefs !== undefined && (!Array.isArray(value.briefs) || value.briefs.length > 7 || new Set(value.briefs.map((b: any) => b?.kind)).size !== value.briefs.length || value.briefs.some((b: any) => !object(b) || !['principal','objecoes','detalhes','contexto','escala','conteudo','festa'].includes(b.kind) || !['A','B','C'].includes(b.layout) || !string(b.title, 200) || !string(b.prompt, 30000) || (b.imageId !== undefined && !string(b.imageId, 128))))) errors.push('Briefings de imagem inválidos.');
  if (value.variations !== undefined && (!Array.isArray(value.variations) || value.variations.length > 100 || new Set(value.variations.map((v: any) => v?.id)).size !== value.variations.length || value.variations.some((v: any) => !object(v) || !string(v.id,128) || !string(v.label,200) || !string(v.sku,50) || !audited(v.ean) || !string(v.ean.value,14)))) errors.push('Variações inválidas.');
  if (value.references !== undefined && (!Array.isArray(value.references) || value.references.length > 12 || value.references.some((r: any) => !object(r) || !string(r.title,300) || !string(r.url,4096) || !r.url.startsWith('https://') || !string(r.snippet,1500) || !Number.isFinite(Date.parse(r.retrievedAt))))) errors.push('Referências de pesquisa inválidas.');
  if (value.kit !== undefined && (!object(value.kit) || !Number.isInteger(value.kit.quantity) || value.kit.quantity < 1 || value.kit.quantity > 999 || !string(value.kit.baseSheetId,128) || !string(value.kit.baseName,1000) || !string(value.kit.baseSku,50))) errors.push('Dados do kit inválidos.');
  return errors;
}
