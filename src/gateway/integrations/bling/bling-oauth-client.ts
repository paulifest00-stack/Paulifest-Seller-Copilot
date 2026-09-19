// Cliente HTTP OAuth2 Oficial para API v3 do Bling (Fase 4C.2B)
import { gatewayLogger } from '../../security/logger.ts';
import type {
  BlingTokenResponse,
  BlingOAuthErrorData,
  BlingRevokeResult
} from '../../types/contracts.ts';

export interface BlingOAuthClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  baseUrl?: string;           // Default: 'https://api.bling.com.br'
  authUrl?: string;           // Default: 'https://www.bling.com.br/Api/v3/oauth/authorize'
  timeoutMs?: number;         // Default: 8000ms
  fetchFn?: typeof fetch;     // Injeção de fetch para testes/mocks
}

export class BlingOAuthError extends Error implements BlingOAuthErrorData {
  public readonly status?: number;
  public readonly category: 'auth' | 'rate_limit' | 'server_error' | 'network' | 'invalid_payload';
  public readonly code?: string;
  public readonly retryable: boolean;
  public readonly requiresReauth: boolean;

  constructor(data: BlingOAuthErrorData) {
    super(data.message);
    this.name = 'BlingOAuthError';
    this.status = data.status;
    this.category = data.category;
    this.code = data.code;
    this.retryable = data.retryable;
    this.requiresReauth = data.requiresReauth;
    Object.setPrototypeOf(this, BlingOAuthError.prototype);
  }
}

export class BlingOAuthClient {
  private clientId: string;
  private clientSecret: string;
  public readonly redirectUri: string;
  private baseUrl: string;
  private authUrl: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: BlingOAuthClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.baseUrl = (options.baseUrl || 'https://api.bling.com.br').replace(/\/+$/, '');
    this.authUrl = options.authUrl || 'https://www.bling.com.br/Api/v3/oauth/authorize';
    this.timeoutMs = options.timeoutMs || 8000;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  /**
   * Constrói a URL de autorização oficial do Bling para consentimento do seller.
   * Não loga nem vaza segredos.
   */
  buildAuthorizationUrl(state: string): string {
    const url = new URL(this.authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /**
   * Executa a troca do authorization code por tokens no endpoint /Api/v3/oauth/token.
   * Headers estritos: Authorization Basic, Content-Type, Accept: 1.0, enable-jwt: 1.
   */
  async exchangeCodeForTokens(code: string): Promise<BlingTokenResponse> {
    const bodyParams = new URLSearchParams();
    bodyParams.set('grant_type', 'authorization_code');
    bodyParams.set('code', code);

    const headers: Record<string, string> = {
      'Authorization': this.getBasicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '1.0',
      'enable-jwt': '1'
    };

    return this.executeTokenRequest(bodyParams, headers, 'code_exchange');
  }

  /**
   * Executa o refresh de token no endpoint /Api/v3/oauth/token.
   * Headers estritos: Authorization Basic, Content-Type, Accept: 1.0, enable-jwt: 1.
   */
  async refreshTokens(refreshToken: string): Promise<BlingTokenResponse> {
    const bodyParams = new URLSearchParams();
    bodyParams.set('grant_type', 'refresh_token');
    bodyParams.set('refresh_token', refreshToken);

    const headers: Record<string, string> = {
      'Authorization': this.getBasicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '1.0',
      'enable-jwt': '1'
    };

    return this.executeTokenRequest(bodyParams, headers, 'refresh_token');
  }

  /**
   * Executa a revogação oficial remota no endpoint /oauth/revoke.
   * Headers estritos: Authorization Basic, Content-Type: application/x-www-form-urlencoded.
   * NÃO inclui enable-jwt ou Accept: 1.0 conforme contrato documentado.
   */
  async revokeToken(
    token: string,
    tokenTypeHint: 'access_token' | 'refresh_token' = 'access_token'
  ): Promise<BlingRevokeResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const bodyParams = new URLSearchParams();
    bodyParams.set('token', token);
    bodyParams.set('token_type_hint', tokenTypeHint);

    const headers: Record<string, string> = {
      'Authorization': this.getBasicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    try {
      const revokeEndpoint = `${this.baseUrl}/oauth/revoke`;
      const response = await this.fetchFn(revokeEndpoint, {
        method: 'POST',
        headers,
        body: bodyParams.toString(),
        signal: controller.signal
      });

      if (response.ok || response.status === 200 || response.status === 204) {
        return { success: true };
      }

      gatewayLogger.warn(`[BlingOAuthClient] Revogação remota retornou HTTP ${response.status}`);
      return { success: false, error: `HTTP_${response.status}` };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        gatewayLogger.warn('[BlingOAuthClient] Timeout na revogação remota');
        return { success: false, error: 'TIMEOUT' };
      }
      gatewayLogger.warn('[BlingOAuthClient] Falha de rede na revogação remota');
      return { success: false, error: 'NETWORK_ERROR' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ---------------------------------------------------------------------------
  // Execução Interna de Requisição de Token com Tratamento Semântico de Erros
  // ---------------------------------------------------------------------------

  private async executeTokenRequest(
    bodyParams: URLSearchParams,
    headers: Record<string, string>,
    operation: 'code_exchange' | 'refresh_token'
  ): Promise<BlingTokenResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const tokenEndpoint = `${this.baseUrl}/Api/v3/oauth/token`;

    try {
      const response = await this.fetchFn(tokenEndpoint, {
        method: 'POST',
        headers,
        body: bodyParams.toString(),
        signal: controller.signal
      });

      const rawText = await response.text();
      let parsedData: any = null;

      try {
        parsedData = rawText ? JSON.parse(rawText) : null;
      } catch {
        // Resposta não é JSON válido
      }

      if (!response.ok) {
        throw this.classifyHttpError(response.status, parsedData, operation);
      }

      // Validação em tempo de execução do payload de sucesso
      if (!parsedData || typeof parsedData !== 'object') {
        throw new BlingOAuthError({
          status: response.status,
          category: 'invalid_payload',
          message: 'Resposta da API do Bling retornou corpo vazio ou malformado.',
          retryable: true,
          requiresReauth: false
        });
      }

      // Validação estrita de access_token e refresh_token (strings não vazias)
      if (
        typeof parsedData.access_token !== 'string' ||
        parsedData.access_token.trim().length === 0 ||
        typeof parsedData.refresh_token !== 'string' ||
        parsedData.refresh_token.trim().length === 0
      ) {
        throw new BlingOAuthError({
          status: response.status,
          category: 'invalid_payload',
          message: 'Resposta da API do Bling ausente de tokens obrigatórios ou com tokens vazios.',
          retryable: true,
          requiresReauth: false
        });
      }

      // Validação estrita de expires_in: deve ser numérico, finito e estritamente > 0 (sem fallback mascarado)
      let expiresInNum: number | null = null;
      if (typeof parsedData.expires_in === 'number') {
        expiresInNum = parsedData.expires_in;
      } else if (typeof parsedData.expires_in === 'string' && /^\s*-?\d+\s*$/.test(parsedData.expires_in)) {
        expiresInNum = parseInt(parsedData.expires_in.trim(), 10);
      }

      if (expiresInNum === null || !Number.isFinite(expiresInNum) || expiresInNum <= 0) {
        throw new BlingOAuthError({
          status: response.status,
          category: 'invalid_payload',
          message: 'Resposta da API do Bling com expires_in inválido, não-numérico, não-positivo ou ausente.',
          retryable: true,
          requiresReauth: false
        });
      }

      // Validação de token_type: se presente, deve ser compatível com Bearer (case-insensitive)
      if (parsedData.token_type !== undefined && parsedData.token_type !== null) {
        if (typeof parsedData.token_type !== 'string' || parsedData.token_type.trim().toLowerCase() !== 'bearer') {
          throw new BlingOAuthError({
            status: response.status,
            category: 'invalid_payload',
            message: `Resposta da API do Bling com token_type incompatível: ${parsedData.token_type}.`,
            retryable: true,
            requiresReauth: false
          });
        }
      }

      return {
        access_token: parsedData.access_token.trim(),
        refresh_token: parsedData.refresh_token.trim(),
        expires_in: expiresInNum,
        token_type: parsedData.token_type || 'Bearer',
        scope: parsedData.scope || ''
      };
    } catch (err: any) {
      if (err instanceof BlingOAuthError) {
        throw err;
      }

      if (err?.name === 'AbortError') {
        throw new BlingOAuthError({
          category: 'network',
          message: `Timeout de comunicação com o Bling na operação ${operation}.`,
          retryable: true,
          requiresReauth: false
        });
      }

      throw new BlingOAuthError({
        category: 'network',
        message: `Falha de rede ao contatar a API do Bling na operação ${operation}.`,
        retryable: true,
        requiresReauth: false
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Classifica semântica e seguramente os erros HTTP retornados pelo Bling.
   * Não loga nem expõe o payload bruto do Bling.
   */
  private classifyHttpError(
    status: number,
    data: any,
    operation: 'code_exchange' | 'refresh_token'
  ): BlingOAuthError {
    const errorProp = typeof data?.error === 'string' ? data.error : data?.error?.type || '';
    const errorDesc = typeof data?.error_description === 'string' ? data.error_description : data?.error?.message || '';

    // Sanitiza códigos de erro conhecidos
    let sanitizedCode: string | undefined = undefined;
    if (errorProp.includes('invalid_grant')) {
      sanitizedCode = 'invalid_grant';
    } else if (errorProp.includes('invalid_client')) {
      sanitizedCode = 'invalid_client';
    } else if (errorProp.includes('unauthorized')) {
      sanitizedCode = 'unauthorized';
    }

    // 1. Rate Limit (429) -> Transitório / Retryable
    if (status === 429) {
      return new BlingOAuthError({
        status: 429,
        category: 'rate_limit',
        code: 'rate_limit_exceeded',
        message: 'Limite de requisições excedido junto à API do Bling.',
        retryable: true,
        requiresReauth: false
      });
    }

    // 2. Erros de Servidor (5xx) -> Transitório / Retryable
    if (status >= 500) {
      return new BlingOAuthError({
        status,
        category: 'server_error',
        code: 'server_error',
        message: `Servidor da API do Bling indisponível temporariamente (HTTP ${status}).`,
        retryable: true,
        requiresReauth: false
      });
    }

    // 3. Erros de Autenticação / Requisição (400, 401)
    if (status === 400 || status === 401) {
      // Rejeição definitiva de grant / token
      const isExplicitInvalidGrant = sanitizedCode === 'invalid_grant' ||
        errorDesc.toLowerCase().includes('revoked') ||
        errorDesc.toLowerCase().includes('expired') ||
        errorDesc.toLowerCase().includes('invalido') ||
        errorDesc.toLowerCase().includes('inválido');

      if (isExplicitInvalidGrant) {
        return new BlingOAuthError({
          status,
          category: 'auth',
          code: 'invalid_grant',
          message: 'Autorização do Bling expirada, revogada ou inválida. Reautenticação necessária.',
          retryable: false,
          requiresReauth: true
        });
      }

      // Se for no code exchange com 400/401, o code falhou (expirado > 1m ou usado)
      if (operation === 'code_exchange') {
        return new BlingOAuthError({
          status,
          category: 'auth',
          code: sanitizedCode || 'authorization_code_invalid',
          message: 'Código de autorização OAuth do Bling expirado ou inválido.',
          retryable: false,
          requiresReauth: true
        });
      }

      // Em refresh, se for ambíguo sem invalid_grant claro: falha de forma recuperável (retryable: true)
      // para NUNCA destruir tokens válidos por oscilação transitória
      return new BlingOAuthError({
        status,
        category: 'auth',
        code: sanitizedCode || 'auth_ambiguous_error',
        message: 'Erro na autenticação com o Bling. Falha temporária preservando conexão.',
        retryable: true,
        requiresReauth: false
      });
    }

    // 4. Outros erros HTTP inesperados (403, 404, etc.)
    return new BlingOAuthError({
      status,
      category: 'invalid_payload',
      code: 'unexpected_http_status',
      message: `Resposta inesperada da API do Bling (HTTP ${status}).`,
      retryable: true,
      requiresReauth: false
    });
  }

  private getBasicAuthHeader(): string {
    const credentials = `${this.clientId}:${this.clientSecret}`;
    const base64Creds = Buffer.from(credentials, 'utf8').toString('base64');
    return `Basic ${base64Creds}`;
  }
}
