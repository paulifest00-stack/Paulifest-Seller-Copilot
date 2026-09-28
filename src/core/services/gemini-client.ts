import { requestAI } from './ai-gateway.ts';
/** Shared transport: never put credentials in URLs or logs. */
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
export async function requestGeminiJson(apiKey: string, system: string, parts: unknown[], responseSchema?: unknown): Promise<any> {
  const body = await requestAI(apiKey, `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', ...(responseSchema ? { responseSchema } : {}) }
  });
  const candidate = body?.candidates?.[0];
  if (body?.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== 'STOP')) {
    throw new Error(`Gemini não concluiu a geração: ${body?.promptFeedback?.blockReason || candidate.finishReason}. Revise os dados e tente novamente.`);
  }
  const text = candidate?.content?.parts?.filter((part: any) => !part.thought && typeof part.text === 'string').map((part: any) => part.text).join('');
  if (!text) throw new Error('Gemini não retornou conteúdo. Tente novamente com o nome ou uma foto do produto.');
  try { return JSON.parse(text); } catch { throw new Error('Gemini retornou uma resposta inválida. Tente gerar novamente.'); }
}

/** Limit by Unicode characters, keeping complete words whenever possible. */
export function limitMlTitle(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (Array.from(clean).length <= 60) return clean;
  const head = Array.from(clean).slice(0, 60).join('');
  return Array.from(clean)[60] === ' ' || !head.includes(' ') ? head.trim() : head.slice(0, head.lastIndexOf(' ')).trim();
}
