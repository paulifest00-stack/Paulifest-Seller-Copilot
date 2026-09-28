import { parseApiKeys, redactCredentials } from './key-manager.ts';

export class AIHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** One attempt per configured key. Permanent input errors never fan out. */
export async function requestAI(apiKeys: string, url: string, body: unknown, timeoutMs = 60000): Promise<any> {
  const keys = parseApiKeys(apiKeys);
  if (!keys.length) throw new Error('Configure sua chave Gemini na etapa Produto, em Configurar.');
  let lastError: Error = new Error('IA indisponível.');
  const deadline = Date.now() + timeoutMs;
  for (let i = 0; i < keys.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('A IA excedeu o tempo de resposta. Tente novamente.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetch(url, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[i] },
        body: JSON.stringify(body)
      });
      let data: any;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) {
        const detail = redactCredentials(String(data?.error?.message || response.statusText || ''), keys).slice(0, 400);
        lastError = new AIHttpError(response.status, `Gemini API retornou erro HTTP ${response.status}: ${detail} ${response.status === 429 ? "Limite de uso atingido. Confira a cota e o faturamento no Google AI Studio." : "Confira sua chave e os dados enviados."}`);
        if ([401, 402, 403, 429, 500, 502, 503, 504].includes(response.status) && i + 1 < keys.length) continue;
        throw lastError;
      }
      if (!data || typeof data !== 'object') throw new Error('A IA retornou uma resposta inválida.');
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('O Gemini demorou mais de 60 segundos. Tente novamente.');
      if (error instanceof TypeError) {
        lastError = new Error('Não foi possível acessar o Gemini. Confira a internet e recarregue a extensão.');
        if (i + 1 < keys.length) continue;
        throw lastError;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

