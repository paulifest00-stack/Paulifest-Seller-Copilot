import { createAuditedField, type CentralProductSheet } from '../schema/product.ts';
import type { Keywords } from '../schema/workbench.ts';
import { researchProduct } from './product-research.ts';
import { CONTENT_RULES, kitRules } from '../engines/identification/prompts.ts';
import { listingFacts, generateListingContent } from './listing-content.ts';
import { requestGeminiJson, GEMINI_MODEL } from './gemini-client.ts';

export function normalizeKeywords(raw: unknown): Keywords {
  if (!raw || typeof raw !== 'object') throw new Error('A IA não retornou palavras-chave válidas.');
  const data = raw as Record<string, unknown>;
  const read = (key: string): string[] => {
    if (!Array.isArray(data[key])) throw new Error('Resposta SEO incompleta. Tente novamente.');
    return [...new Set((data[key] as unknown[]).filter((v): v is string => typeof v === 'string')
      .map(v => v.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()).filter(v => v && v.length <= 80))].slice(0, 12);
  };
  return { principais: read('principais'), relacionadas: read('relacionadas'), variacoes: read('variacoes') };
}

export async function generateKeywords(sheet: CentralProductSheet, key: string): Promise<Keywords> {
  const facts = listingFacts(sheet);
  if (!facts.nome) throw new Error('Preencha o nome antes de gerar SEO.');
  const raw = await requestGeminiJson(key, CONTENT_RULES, [{ text: JSON.stringify({ tarefa: 'Sugira palavras-chave em três categorias. Variacoes significa formas alternativas de busca do MESMO produto, nunca outras cores ou tamanhos.', fatos: facts }) }], {
    type: 'OBJECT', properties: Object.fromEntries(['principais', 'relacionadas', 'variacoes'].map(k => [k, { type: 'ARRAY', items: { type: 'STRING' } }])), required: ['principais', 'relacionadas', 'variacoes']
  });
  return normalizeKeywords(raw);
}

export function applyKeywords(current: CentralProductSheet, snapshot: CentralProductSheet, keywords: Keywords): CentralProductSheet {
  if (JSON.stringify(current) !== JSON.stringify(snapshot)) return current;
  return { ...current, workbench: { ...current.workbench, keywords: createAuditedField(keywords, 'ai_generated', 0.8, 'pending_review', {
    capturedAt: new Date().toISOString(), sourceName: GEMINI_MODEL, extractedSnippet: 'Sugestões de busca; sem medição de volume.'
  }) } };
}

/** Identification remains separate; this stage only composes content from its reviewed sheet. */
export async function generateProductContent(sheet: CentralProductSheet, key: string, mode: 'bling' | 'complete', progress?: (message: string) => void): Promise<CentralProductSheet> {
  let context = sheet;
  if (mode === 'complete') {
    progress?.('Pesquisando fontes e dúvidas sobre o produto identificado…');
    const references = await researchProduct(sheet, key);
    context = { ...sheet, workbench: { ...sheet.workbench, references } };
  }
  progress?.('Preparando descrição com os dados da ficha…');
  const description = await generateListingContent(context, key, 'descriptionPlain');
  const audit = (value: string) => createAuditedField(value, 'ai_generated', 0.8, 'pending_review', { capturedAt: new Date().toISOString(), sourceName: GEMINI_MODEL });
  let result = { ...context, descriptionPlain: audit(description) };
  if (mode === 'bling') return result;
  progress?.('Preparando título e palavras-chave…');
  const title = await generateListingContent(context, key, 'title');
  const keywords = await generateKeywords(context, key);
  result = { ...result, title: audit(title), workbench: { ...context.workbench, keywords: createAuditedField(keywords, 'ai_generated', 0.8, 'pending_review') } };
  return result;
}

export const currentKitRules = (sheet: CentralProductSheet) => kitRules(sheet.workbench?.kit?.quantity ?? 1);
