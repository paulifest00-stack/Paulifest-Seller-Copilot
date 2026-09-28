import type { CentralProductSheet } from '../schema/product.ts';
import { listingFacts } from './listing-content.ts';
import { requestGeminiJson } from './gemini-client.ts';

export const NCM_TABLE_URL = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json';
export interface NcmEntry { code: string; description: string; path: string }
export interface NcmSuggestion extends NcmEntry { reason: string; method: 'text' | 'ai' }

const plain = (text: string) => text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const digits = (value: string) => value.replace(/\D/g, '');

function isoDate(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return '';
  return raw.slice(6) + '-' + raw.slice(3, 5) + '-' + raw.slice(0, 2);
}

const STOPWORDS = new Set([
  'para', 'com', 'sem', 'por', 'dos', 'das', 'uma', 'uns', 'uso', 'tipo',
  'kit', 'unidade', 'unidades', 'pacote', 'caixa', 'fardo', 'peca', 'pecas',
  'tamanho', 'cor', 'cores', 'modelo', 'marca', 'linha', 'original', 'novo',
  'alta', 'qualidade', 'super', 'extra', 'mini', 'max', 'pro', 'plus'
]);

const SYNONYM_MAP: Record<string, string[]> = {
  pote: ['mesa', 'cozinha', 'utensilio', 'domestico', 'plastico', 'recipiente'],
  copo: ['mesa', 'cozinha', 'utensilio', 'domestico', 'plastico', 'papel'],
  prato: ['mesa', 'cozinha', 'utensilio', 'domestico', 'plastico', 'papel'],
  talher: ['mesa', 'cozinha', 'utensilio', 'domestico', 'plastico'],
  garfo: ['mesa', 'cozinha', 'utensilio', 'domestico', 'plastico'],
  colher: ['mesa', 'cozinha', 'utensilio', 'domestico', 'plastico'],
  faca: ['mesa', 'cozinha', 'utensilio', 'domestico', 'plastico', 'laminas'],
  taca: ['mesa', 'cozinha', 'utensilio', 'domestico', 'plastico', 'vidro'],
  bandeja: ['mesa', 'cozinha', 'utensilio', 'domestico', 'papel', 'plastico', 'aluminio'],
  canudo: ['plastico', 'papel', 'mesa', 'bebida'],
  marmita: ['aluminio', 'plastico', 'isopor', 'embalagem', 'mesa', 'cozinha'],
  luva: ['luva', 'borracha', 'vulcanizada', 'vestuario', 'nitrilica', 'plastico'],
  nitrilica: ['luva', 'borracha', 'vulcanizada', 'nitrilica', 'vestuario'],
  latex: ['borracha', 'vulcanizada', 'luva', 'balao'],
  vinil: ['plastico', 'luva', 'vestuario'],
  cabelo: ['capilar', 'preparaco', 'toucador', 'perfumaria', 'cabelo'],
  pinta: ['capilar', 'preparaco', 'cabelo', 'maquiagem'],
  spray: ['capilar', 'preparaco', 'festa', 'aerossol'],
  balao: ['festa', 'divertimento', 'inflavei', 'borracha', 'carnaval'],
  bexiga: ['festa', 'divertimento', 'inflavei', 'borracha', 'carnaval'],
  festa: ['festa', 'carnaval', 'divertimento', 'artigo'],
  carnaval: ['festa', 'carnaval', 'divertimento', 'artigo'],
  confete: ['festa', 'carnaval', 'divertimento', 'papel'],
  serpentina: ['festa', 'carnaval', 'divertimento', 'papel'],
  mascara: ['festa', 'carnaval', 'divertimento'],
  vela: ['vela', 'pavio', 'cirio', 'parafina'],
  bala: ['confeitaria', 'acucar', 'bombom', 'caramelo', 'confeito', 'pastilha'],
  freegells: ['confeitaria', 'acucar', 'bala', 'pastilha', 'confeito'],
  pirulito: ['confeitaria', 'acucar', 'confeito'],
  chiclete: ['goma', 'mascar', 'confeitaria', 'acucar'],
  chocolate: ['cacau', 'chocolate', 'confeitaria'],
  saco: ['saco', 'embalagem', 'etileno', 'plastico', 'papel', 'transporte'],
  sacola: ['saco', 'embalagem', 'etileno', 'plastico', 'papel', 'transporte'],
  embalagem: ['embalagem', 'saco', 'caixa', 'transporte', 'plastico', 'papel'],
  guardanapo: ['guardanapo', 'toalha', 'papel', 'mesa', 'celulose'],
  toalha: ['toalha', 'mesa', 'papel', 'plastico'],
  forminha: ['caixa', 'cartonagem', 'papel', 'cartao', 'confeitaria'],
  fita: ['fita', 'adesiva', 'autoadesiva', 'plastico', 'papel'],
  adesivo: ['autoadesiv', 'etiqueta', 'papel', 'plastico'],
  etiqueta: ['etiqueta', 'papel', 'cartao', 'autoadesiv'],
  furadeira: ['furadeira', 'perfuratriz', 'eletromecanica', 'ferramenta'],
  brinquedo: ['brinquedo', 'jogos', 'divertimento', ' boneco']
};

interface NcmHeadingRule {
  keywords: string[];
  prefixes: string[];
  label: string;
}

const HEADING_RULES: NcmHeadingRule[] = [
  { keywords: ['pote', 'copo', 'prato', 'talher', 'garfo', 'colher', 'taca', 'jarra', 'tigela', 'bandeja', 'descartavel'], prefixes: ['392410', '3924', '482369', '4823'], label: 'Utensílios de mesa ou cozinha (3924 / 4823)' },
  { keywords: ['luva', 'nitrilica'], prefixes: ['401519', '401512', '4015', '392620'], label: 'Luvas de proteção/vestuário em borracha ou plástico (4015 / 3926)' },
  { keywords: ['balao', 'bexiga', 'festa', 'carnaval', 'confete', 'serpentina', 'mascara', 'decoracao'], prefixes: ['950590', '9505', '401695'], label: 'Artigos para festas, carnaval ou divertimento (9505)' },
  { keywords: ['vela', 'cirio', 'aniversario'], prefixes: ['340600', '3406'], label: 'Velas, círios e artigos semelhantes (3406)' },
  { keywords: ['saco', 'sacola', 'bobina', 'embalagem'], prefixes: ['392321', '392329', '3923', '481940', '4819'], label: 'Artigos de transporte ou embalagem — sacos e sacolas (3923 / 4819)' },
  { keywords: ['guardanapo', 'papel', 'toalha'], prefixes: ['481830', '4818', '4823'], label: 'Toalhas e guardanapos de mesa de papel (4818 / 4823)' },
  { keywords: ['forminha', 'cartonagem', 'caixa'], prefixes: ['482369', '4823', '4819'], label: 'Artigos de papel ou cartão para confeitaria/embalagem (4823 / 4819)' },
  { keywords: ['cabelo', 'pinta', 'spray', 'capilar', 'shampoo', 'condicionador'], prefixes: ['330590', '3305'], label: 'Preparações capilares (3305)' },
  { keywords: ['bala', 'pirulito', 'chiclete', 'goma', 'caramelo', 'pastilha', 'confeito', 'freegells'], prefixes: ['170490', '170410', '1704'], label: 'Produtos de confeitaria sem cacau (1704)' },
  { keywords: ['chocolate', 'bombom', 'cacau'], prefixes: ['180690', '180631', '180632', '1806'], label: 'Chocolates e preparações contendo cacau (1806)' },
  { keywords: ['fita', 'adesiva', 'durex', 'autoadesiva'], prefixes: ['391910', '391990', '3919', '481141'], label: 'Chapas, folhas e tiras autoadesivas (3919 / 4811)' },
  { keywords: ['aluminio', 'marmitex'], prefixes: ['761510', '761290', '7607'], label: 'Artigos de uso doméstico ou embalagens de alumínio (7615 / 7612)' },
  { keywords: ['furadeira', 'parafusadeira', 'serra', 'esmerilhadeira'], prefixes: ['846721', '846729', '8467'], label: 'Ferramentas eletromecânicas com motor elétrico (8467)' }
];

const MATERIAL_CHAPTERS: Record<string, string[]> = {
  plastico: ['39'],
  acrilico: ['39'],
  polipropileno: ['39'],
  poliestireno: ['39'],
  pet: ['39'],
  pvc: ['39'],
  isopor: ['39'],
  eps: ['39'],
  papel: ['48'],
  cartao: ['48'],
  papelao: ['48'],
  celulose: ['48'],
  borracha: ['40'],
  latex: ['40'],
  nitrilica: ['40'],
  aluminio: ['76'],
  vidro: ['70'],
  inox: ['73', '82'],
  aco: ['73', '82'],
  madeira: ['44'],
  bambu: ['44', '46']
};

export function parseNcmTable(data: any, today = new Date().toISOString().slice(0, 10)): NcmEntry[] {
  if (!Array.isArray(data?.Nomenclaturas)) throw new Error('A tabela NCM retornou um formato inválido.');
  const active = data.Nomenclaturas.filter((row: any) => typeof row?.Codigo === 'string' && typeof row.Descricao === 'string' &&
    isoDate(row.Data_Inicio) && isoDate(row.Data_Fim) && isoDate(row.Data_Inicio) <= today && isoDate(row.Data_Fim) >= today);
  const descriptions = new Map<string, string>(active.map((row: any) => [digits(row.Codigo), plain(row.Descricao)]));
  return active.filter((row: any) => /^\d{8}$/.test(digits(row.Codigo))).map((row: any) => {
    const code = digits(row.Codigo), chain: string[] = [];
    for (let i = 2; i <= 8; i++) { const description = descriptions.get(code.slice(0, i)); if (description) chain.push(description); }
    return { code, description: plain(row.Descricao), path: chain.join(' › ') };
  });
}

let cached: { entries: NcmEntry[]; at: number } | undefined;
export async function loadOfficialNcmTable(): Promise<NcmEntry[]> {
  if (cached && Date.now() - cached.at < 3600000) return cached.entries;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(NCM_TABLE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Consulta NCM indisponível (HTTP ${response.status}). Tente novamente.`);
    const entries = parseNcmTable(await response.json());
    if (!entries.length) throw new Error('A tabela NCM não retornou códigos vigentes.');
    cached = { entries, at: Date.now() };
    return entries;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('A consulta NCM demorou demais. Tente novamente.');
    if (error instanceof TypeError) {
      throw new Error('Não foi possível consultar a tabela oficial NCM. Tente novamente; nenhum código será preenchido automaticamente.');
    }
    throw error;
  } finally { clearTimeout(timer); }
}

const tokens = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
    .map(w => w.replace(/s$/, ''));

function expandQueryTokens(query: string): { base: string[]; expanded: string[] } {
  const base = [...new Set(tokens(query))];
  const expanded = new Set<string>(base);
  for (const word of base) {
    const syns = SYNONYM_MAP[word];
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
  }
  return { base, expanded: [...expanded] };
}

export function buildNcmQueryFromSheet(sheet: CentralProductSheet): string {
  const parts: string[] = [];
  const nameBling = (sheet.titleBling?.value || '').trim();
  const nameMl = (sheet.title.value || '').trim();
  if (nameBling) parts.push(nameBling);
  else if (nameMl) parts.push(nameMl);

  if (sheet.categoryPathML?.value?.trim()) parts.push(sheet.categoryPathML.value.trim());
  if (sheet.model?.value?.trim() && sheet.model.status !== 'conflict') parts.push(sheet.model.value.trim());

  for (const attr of sheet.attributes || []) {
    if (attr.field?.status === 'conflict') continue;
    const val = (attr.field?.value || '').trim();
    const name = (attr.name || '').trim().toLowerCase();
    if (val && /^(material|composic|tipo|finalidade|uso|categoria|formato|linha|acabamento)/.test(name)) {
      parts.push(`${attr.name} ${val}`);
    } else if (val) {
      parts.push(val);
    }
  }
  return parts.join(' ').trim();
}

export function searchNcm(entries: NcmEntry[], query: string): NcmSuggestion[] {
  const { base, expanded } = expandQueryTokens(query);
  const code = digits(query);

  // Detect matched heading rules and material chapters
  const matchedRules = HEADING_RULES.filter(r => r.keywords.some(k => base.includes(k) || expanded.includes(k)));
  const preferredChapters = new Set<string>();
  for (const word of base) {
    const chs = MATERIAL_CHAPTERS[word];
    if (chs) chs.forEach(c => preferredChapters.add(c));
  }

  const results = entries
    .map(entry => {
      if (code.length === 8 && code === entry.code) {
        return {
          ...entry,
          score: 1000,
          method: 'text' as const,
          reason: 'Código NCM exato localizado na tabela oficial Siscomex.'
        };
      }
      if (code.length >= 2 && code.length < 8 && entry.code.startsWith(code)) {
        return {
          ...entry,
          score: 500 + (entry.description.toLowerCase() !== 'outros' ? 10 : 0),
          method: 'text' as const,
          reason: `Posição fiscal iniciada por ${code} na tabela oficial Siscomex.`
        };
      }

      const descTokens = tokens(entry.description);
      const pathTokens = tokens(entry.path);
      let score = 0;
      let matchedReason = 'Sugerido automaticamente pela tabela NCM para este tipo de produto.';

      // 1. Heading rule boost
      for (const rule of matchedRules) {
        if (rule.prefixes.some(pref => entry.code.startsWith(pref))) {
          score += entry.code.startsWith(rule.prefixes[0]) ? 35 : 22;
          matchedReason = `${rule.label} compatível com os dados do produto.`;
          break;
        }
      }

      // 2. Material chapter boost
      if (preferredChapters.size > 0 && preferredChapters.has(entry.code.slice(0, 2))) {
        score += 14;
      }

      // 3. Base words & expanded words match
      for (const word of expanded) {
        const isCoreWord = base.includes(word);
        const inDescExact = descTokens.includes(word);
        const inPathExact = pathTokens.includes(word);
        const inDescPartial = !inDescExact && descTokens.some(h => h.includes(word) || word.includes(h));
        const inPathPartial = !inPathExact && pathTokens.some(h => h.includes(word) || word.includes(h));

        if (inDescExact) score += isCoreWord ? 12 : 6;
        else if (inDescPartial) score += isCoreWord ? 6 : 3;

        if (inPathExact) score += isCoreWord ? 5 : 2;
        else if (inPathPartial) score += isCoreWord ? 2 : 1;
      }

      // 4. Prefer specific descriptions over generic "Outros" when score > 0
      if (score > 0 && entry.description.toLowerCase() !== 'outros') {
        score += 3;
      }

      return {
        ...entry,
        score,
        method: 'text' as const,
        reason: matchedReason
      };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, 5);

  return results;
}

export async function suggestNcm(sheet: CentralProductSheet, apiKey?: string): Promise<NcmSuggestion[]> {
  const facts = listingFacts(sheet);
  if (!facts.nome) throw new Error('Digite o nome do produto.');
  const entries = await loadOfficialNcmTable();
  const richQuery = buildNcmQueryFromSheet(sheet) || String(facts.nome);
  const localMatches = searchNcm(entries, richQuery);

  if (!apiKey) return localMatches;

  try {
    const result = await requestGeminiJson(
      apiKey,
      `Você é um especialista fiscal brasileiro (TIPI / NCM Siscomex).
Sugira até 4 possíveis códigos NCM de 8 dígitos para o produto a partir do nome, marca, material e atributos técnicos recebidos.
Priorize a posição exata pelo material constitutivo (ex: plástico cap. 39, papel cap. 48, borracha cap. 40, alumínio cap. 76, confeitaria cap. 17/18, festas cap. 9505) e pela finalidade do produto.
Explique brevemente o motivo fiscal de cada código.`,
      [{ text: JSON.stringify({ ...facts, consultaCompleta: richQuery }) }],
      {
        type: 'OBJECT',
        properties: {
          suggestions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { code: { type: 'STRING' }, reason: { type: 'STRING' } },
              required: ['code', 'reason']
            }
          }
        },
        required: ['suggestions']
      }
    );
    const suggestions: NcmSuggestion[] = [];
    for (const candidate of Array.isArray(result?.suggestions) ? result.suggestions.slice(0, 4) : []) {
      if (typeof candidate.code !== 'string') continue;
      const code = digits(candidate.code);
      if (code.length < 4) continue;

      // 1. Exact 8-digit match in official table
      let match = code.length === 8 ? entries.find(entry => entry.code === code) : undefined;

      // 2. If exact 8-digit code was renumbered in Siscomex, fallback to 6-digit subheading only if 8-digit was provided
      if (!match && code.length === 8) {
        const subheadingMatches = entries.filter(e => e.code.startsWith(code.slice(0, 6)));
        if (subheadingMatches.length > 0) {
          match = subheadingMatches.find(e => e.description.toLowerCase() !== 'outros') || subheadingMatches[0];
        }
      }

      if (match && !suggestions.some(entry => entry.code === match!.code)) {
        suggestions.push({
          ...match,
          method: 'ai',
          reason: typeof candidate.reason === 'string' ? candidate.reason.slice(0, 500) : 'Classificação sugerida pela IA e validada na tabela oficial Siscomex.'
        });
      }
    }

    if (suggestions.length > 0) {
      return suggestions;
    }
  } catch {
    // Se a IA falhar ou não houver chave válida, usa busca inteligente local/Siscomex
  }
  return localMatches;
}
