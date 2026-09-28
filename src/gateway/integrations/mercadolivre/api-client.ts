export class MlApiError extends Error {
  constructor(public status: number, message: string, public uncertain = false) { super(message); }
}
export class MlApiClient {
  constructor(private fetcher: typeof fetch = fetch) {}
  async request(path: string, token: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}): Promise<any> {
    if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) throw new Error('Rota ML inválida.');
    let response: Response;
    try {
      const multipart = body instanceof FormData;
      response = await this.fetcher('https://api.mercadolibre.com' + path, { method, signal: AbortSignal.timeout(20000), redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
        ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
    } catch { throw new MlApiError(502, 'O Mercado Livre não respondeu. Confira o resultado antes de repetir uma escrita.', method !== 'GET'); }
    let data: any; try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const causes = Array.isArray(data?.cause) ? data.cause.map((c: any) => String(c.message || c.code || '')).join('; ') : '';
      const message = String(causes || data?.message || data?.error || 'Resposta inválida').split(token).join('[credencial omitida]').slice(0, 1200);
      throw new MlApiError(response.status, `Mercado Livre HTTP ${response.status}: ${message}`, method !== 'GET' && response.status >= 500);
    }
    if (data === null && response.status !== 204) throw new MlApiError(502, 'Resposta inválida do Mercado Livre.', method !== 'GET');
    return data;
  }
  async token(params: Record<string, string>): Promise<{ access_token: string; refresh_token: string; expires_in: number; user_id: number }> {
    let response: Response;
    try { response = await this.fetcher('https://api.mercadolibre.com/oauth/token', { method: 'POST', signal: AbortSignal.timeout(15000), redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) }); }
    catch { throw new MlApiError(502, 'Falha na conexão OAuth com o Mercado Livre. Conecte novamente.'); }
    let body: any; try { body = await response.json(); } catch { body = null; }
    if (!response.ok || typeof body?.access_token !== 'string' || typeof body?.refresh_token !== 'string' || !Number.isFinite(body?.expires_in) || body.expires_in <= 0 || !Number.isSafeInteger(body?.user_id)) throw new MlApiError(response.status || 502, 'O Mercado Livre não concluiu a autenticação. Conecte novamente.');
    return body;
  }
}
