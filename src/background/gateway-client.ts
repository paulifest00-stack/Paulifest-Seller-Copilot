import type { 
  GetBlingProductResponse, 
  RefreshSessionResponse 
} from '../shared/gateway-contracts.ts';

export const DEFAULT_GATEWAY_DEV_URL = 'http://localhost:3001';
export const DEFAULT_GATEWAY_BASE_URL = DEFAULT_GATEWAY_DEV_URL;

export type GatewayEnvironment = 'development' | 'test' | 'production';

const STORAGE_KEYS = {
  GATEWAY_SESSION: 'paulifest_gateway_session_v1'
} as const;

export interface ExtensionGatewaySession {
  gatewaySessionToken: string;
  gatewayRefreshToken: string;
  gstExpiresAt?: string;
  sessionGeneration: number;
  updatedAt: string;
}

export class GatewayAuthRequiredError extends Error {
  constructor(message: string = 'Autenticação necessária com o Bling/Gateway.') {
    super(message);
    this.name = 'GatewayAuthRequiredError';
    Object.setPrototypeOf(this, GatewayAuthRequiredError.prototype);
  }
}

export class GatewayTransientError extends Error {
  public status: number;

  constructor(message: string, status: number = 0) {
    super(message);
    this.name = 'GatewayTransientError';
    this.status = status;
    Object.setPrototypeOf(this, GatewayTransientError.prototype);
  }
}

export class GatewayProductError extends Error {
  public code: string;
  public status: number;
  public retryAfterMs?: number;

  constructor(code: string, message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'GatewayProductError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, GatewayProductError.prototype);
  }
}

export interface GatewayClientOptions {
  baseUrl?: string;
  environment?: GatewayEnvironment;
  storage?: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
}

function detectEnvironment(): GatewayEnvironment {
  // 1. Prioridade para ambiente de teste (Node / Vite test runner)
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
      return 'test';
    }
  } catch {}

  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
      const metaEnv = (import.meta as any).env;
      if (metaEnv.MODE === 'test') {
        return 'test';
      }
      if (metaEnv.MODE === 'production' || metaEnv.PROD === true) {
        return 'production';
      }
      return 'development';
    }
  } catch {}

  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.NODE_ENV === 'production') return 'production';
      if (process.env.NODE_ENV === 'development') return 'development';
    }
  } catch {}

  return 'development';
}

function validateAndResolveBaseUrl(rawUrl: string | undefined, env: GatewayEnvironment): string {
  if (env === 'production') {
    if (!rawUrl || rawUrl.trim().length === 0) {
      throw new Error(
        '[Paulifest Copilot] Erro de configuração: Gateway Base URL deve ser explicitamente configurada em ambiente de produção (fail-closed).'
      );
    }
    const trimmed = rawUrl.trim().replace(/\/+$/, '');
    if (!trimmed.startsWith('https://')) {
      throw new Error(
        `[Paulifest Copilot] Erro de configuração: Gateway Base URL em produção exige HTTPS obrigatório. Recebido: "${trimmed}".`
      );
    }
    return trimmed;
  }

  // Ambiente de desenvolvimento / testes: permite localhost ou URL explícita
  if (!rawUrl || rawUrl.trim().length === 0) {
    return DEFAULT_GATEWAY_DEV_URL;
  }
  return rawUrl.trim().replace(/\/+$/, '');
}

// Armazenamento em memória para testes onde chrome.storage não está disponível
const memoryStorage = new Map<string, any>();

export class GatewayClient {
  private baseUrl: string;
  private environment: GatewayEnvironment;
  private storage: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
  // Mutex single-flight indexado pelo token de refresh de origem (protege contra race de sessões)
  private activeRefreshPromises = new Map<string, Promise<string>>();

  constructor(options: GatewayClientOptions = {}) {
    this.environment = options.environment || detectEnvironment();
    this.baseUrl = validateAndResolveBaseUrl(options.baseUrl, this.environment);
    this.storage = options.storage || {
      get: async (key: string) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const res = await chrome.storage.local.get(key);
          return res[key];
        }
        return memoryStorage.get(key);
      },
      set: async (key: string, value: any) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ [key]: value });
          return;
        }
        memoryStorage.set(key, value);
      },
      remove: async (key: string) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.remove(key);
          return;
        }
        memoryStorage.delete(key);
      }
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getEnvironment(): GatewayEnvironment {
    return this.environment;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = validateAndResolveBaseUrl(url, this.environment);
  }

  async loadSession(): Promise<ExtensionGatewaySession | null> {
    const raw = await this.storage.get(STORAGE_KEYS.GATEWAY_SESSION);
    if (!raw) return null;
    return raw as ExtensionGatewaySession;
  }

  async saveSession(session: ExtensionGatewaySession): Promise<void> {
    await this.storage.set(STORAGE_KEYS.GATEWAY_SESSION, session);
  }

  async clearSession(): Promise<void> {
    await this.storage.remove(STORAGE_KEYS.GATEWAY_SESSION);
  }

  /**
   * Obtém um GST válido:
   * - Se o GST armazenado for válido com margem de segurança de 30s, retorna-o;
   * - Se expirado ou ausente, aciona a renovação single-flight via GRT.
   */
  async getValidGst(): Promise<string> {
    const session = await this.loadSession();
    if (!session || !session.gatewaySessionToken || !session.gatewayRefreshToken) {
      throw new GatewayAuthRequiredError('Nenhuma sessão do Gateway ativa. Conecte o Bling.');
    }

    if (session.gstExpiresAt) {
      const expiresAt = new Date(session.gstExpiresAt).getTime();
      const now = Date.now();
      // Margem de 30 segundos antes da expiração
      if (expiresAt - now > 30000) {
        return session.gatewaySessionToken;
      }
    }

    // GST expirado: executa renovação coordenada via single-flight
    return this.executeSingleFlightRefresh(session.gatewayRefreshToken);
  }

  /**
   * Renovação Single-Flight de GST via GRT:
   * 1. Associada estritamente ao originatingRefreshToken;
   * 2. Chamadas concorrentes aguardam a mesma Promise;
   * 3. Erros terminais limpam credenciais; erros transitórios (500, timeout, 429) preservam GRT;
   * 4. Proteção CAS: se a sessão mudar durante o voo, o resultado antigo é descartado;
   * 5. Mutex liberado incondicionalmente em finally.
   */
  async executeSingleFlightRefresh(originatingRefreshToken: string): Promise<string> {
    if (!originatingRefreshToken) {
      throw new GatewayAuthRequiredError('Token de refresh do Gateway ausente.');
    }

    // Se já existe uma renovação em voo PARA ESTE MESMO REFRESH TOKEN, reutiliza a Promise
    const existing = this.activeRefreshPromises.get(originatingRefreshToken);
    if (existing) {
      return existing;
    }

    const refreshPromise = (async () => {
      try {
        let response: Response;
        try {
          response = await fetch(`${this.baseUrl}/auth/session/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gatewayRefreshToken: originatingRefreshToken }),
            signal: AbortSignal.timeout(8000)
          });
        } catch (netErr: any) {
          // Erro de rede ou timeout: transitório! PRESERVA O GRT ATUAL!
          throw new GatewayTransientError(
            `Falha transitória de conexão com o Gateway: ${netErr?.message || netErr}`,
            0
          );
        }

        if (!response.ok) {
          const status = response.status;
          let body: any = {};
          try {
            body = await response.json();
          } catch {}

          const errorType = body?.error;

          // Identificação de falha terminal da sessão (401 explícito)
          const isTerminal = status === 401 && (
            errorType === 'SESSION_EXPIRED' ||
            errorType === 'TOKEN_REUSE_DETECTED' ||
            errorType === 'INVALID_REFRESH_TOKEN' ||
            errorType === 'SESSION_REVOKED' ||
            body?.message?.includes('revogada') ||
            body?.message?.includes('expirou')
          );

          if (isTerminal) {
            // Proteção CAS: limpa localmente apenas se a sessão armazenada ainda for a de origem
            const currentStored = await this.loadSession();
            if (currentStored && currentStored.gatewayRefreshToken === originatingRefreshToken) {
              await this.clearSession();
            }
            throw new GatewayAuthRequiredError(
              body?.message || 'Sessão revogada ou expirada no Gateway. Reconecte o Bling.'
            );
          }

          // Falha transitória (429, 500, 502, 503, 504 ou indeterminada): PRESERVA o GRT atual!
          throw new GatewayTransientError(
            body?.message || `Erro transitório no Gateway (${status}).`,
            status
          );
        }

        const data: RefreshSessionResponse = await response.json();
        const expiresInSeconds = data.expiresInSeconds || 900;
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

        // PROTEÇÃO CAS / SESSION-GENERATION RACE:
        // Relê a sessão armazenada para verificar se houve alteração durante a chamada
        const currentStored = await this.loadSession();
        if (!currentStored || currentStored.gatewayRefreshToken !== originatingRefreshToken) {
          // A sessão mudou (usuário reconectou com nova sessão) ou foi desconectada
          // Descarte integral do resultado antigo sem sobrescrever a nova sessão nem recriar sessão apagada!
          return data.gatewaySessionToken!;
        }

        const newSession: ExtensionGatewaySession = {
          gatewaySessionToken: data.gatewaySessionToken!,
          gatewayRefreshToken: data.gatewayRefreshToken!,
          gstExpiresAt: expiresAt,
          sessionGeneration: (currentStored.sessionGeneration || 0) + 1,
          updatedAt: new Date().toISOString()
        };

        await this.saveSession(newSession);
        return newSession.gatewaySessionToken;
      } finally {
        // Liberação incondicional do mutex em finally
        this.activeRefreshPromises.delete(originatingRefreshToken);
      }
    })();

    this.activeRefreshPromises.set(originatingRefreshToken, refreshPromise);
    return refreshPromise;
  }

  /**
   * Consulta produto no Gateway por ID:
   * 1. Obtém GST válido;
   * 2. Executa GET /integrations/bling/products/:id;
   * 3. Trata 401 autoritativo do Gateway com 1 tentativa de refresh;
   * 4. Segundo 401 dispara GatewayAuthRequiredError (sem loop infinito).
   */
  async fetchBlingProduct(productId: string): Promise<GetBlingProductResponse> {
    const trimmedId = productId.trim();
    if (!trimmedId) {
      throw new GatewayProductError('INVALID_PRODUCT_ID', 'ID do produto não pode ser vazio.', 400);
    }

    let gst: string;
    try {
      gst = await this.getValidGst();
    } catch (err) {
      throw err;
    }

    let res = await this.rawFetchProduct(trimmedId, gst);

    if (res.status === 401) {
      // 401 autoritativo do Gateway: força UMA renovação de sessão via single-flight
      const currentStored = await this.loadSession();
      if (!currentStored?.gatewayRefreshToken) {
        throw new GatewayAuthRequiredError('Sessão inexistente no Gateway.');
      }

      gst = await this.executeSingleFlightRefresh(currentStored.gatewayRefreshToken);
      // Repete a requisição uma única vez
      res = await this.rawFetchProduct(trimmedId, gst);
      if (res.status === 401) {
        throw new GatewayAuthRequiredError('Sessão definitivamente rejeitada pelo Gateway após renovação.');
      }
    }

    if (!res.ok) {
      let body: any = {};
      try {
        body = await res.json();
      } catch {}

      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      const retryAfterMs = (retryAfterSeconds && !isNaN(retryAfterSeconds)) ? retryAfterSeconds * 1000 : body.retryAfterMs;

      throw new GatewayProductError(
        body.error || 'GATEWAY_ERROR',
        body.message || `Falha na requisição ao Gateway (HTTP ${res.status}).`,
        res.status,
        retryAfterMs
      );
    }

    return res.json();
  }

  private async rawFetchProduct(productId: string, gst: string): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/integrations/bling/products/${encodeURIComponent(productId)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${gst}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });
    } catch (netErr: any) {
      throw new GatewayTransientError(
        `Erro de conexão com Gateway ao consultar produto: ${netErr?.message || netErr}`,
        0
      );
    }
  }
}

export const gatewayClient = new GatewayClient();
