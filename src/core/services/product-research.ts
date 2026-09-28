import type { CentralProductSheet } from '../schema/product.ts';
import type { ResearchReference } from '../schema/workbench.ts';
import { REGRA_OURO } from '../engines/identification/prompts.ts';
import { requestAI } from './ai-gateway.ts';
import { GEMINI_MODEL } from './gemini-client.ts';
import { listingFacts } from './listing-content.ts';

export function safeWebUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 4096) return;
  try { const url = new URL(input); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch { /* invalid external URL */ }
}
export function parseResearchReferences(body: any): ResearchReference[] {
  const candidate = body?.candidates?.[0];
  if (body?.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== 'STOP')) throw new Error('A pesquisa não foi concluída. Tente novamente.');
  const metadata = candidate?.groundingMetadata;
  if (!Array.isArray(metadata?.groundingChunks)) return [];
  const used = new Set<string>();
  return metadata.groundingChunks.flatMap((chunk: any, index: number) => {
    const url = safeWebUrl(chunk?.web?.uri);
    if (!url || used.has(url)) return [];
    used.add(url);
    const excerpts = Array.isArray(metadata.groundingSupports) ? metadata.groundingSupports.filter((support: any) => Array.isArray(support?.groundingChunkIndices) && support.groundingChunkIndices.includes(index)).map((support: any) => typeof support.segment?.text === 'string' ? support.segment.text : '').filter(Boolean) : [];
    return [{ url, title: typeof chunk.web.title === 'string' ? chunk.web.title.slice(0, 300) : new URL(url).hostname, snippet: excerpts.join('\n').slice(0, 1500), retrievedAt: new Date().toISOString() }];
  }).slice(0, 12);
}
export async function researchProduct(sheet: CentralProductSheet, key: string): Promise<ResearchReference[]> {
  const facts = listingFacts(sheet);
  if (!facts.nome) throw new Error('Informe o nome do produto antes de pesquisar.');
  const body = await requestAI(key, `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    systemInstruction: { parts: [{ text: REGRA_OURO }] },
    contents: [{ role: 'user', parts: [{ text: `Pesquise fontes sobre este produto exato e sua variação. Priorize fabricante e ficha técnica, depois distribuidores. Resuma dados confirmados e dúvidas úteis para o anúncio. Não confunda variantes. Não estime vendas. Dados: ${JSON.stringify(facts)}` }] }],
    tools: [{ googleSearch: {} }]
  });
  const references = parseResearchReferences(body);
  if (!references.length) throw new Error('A pesquisa não retornou fontes verificáveis. Nenhum dado foi aplicado à ficha.');
  return references;
}
