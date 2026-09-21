import type { 
  GetBlingProductResponse, 
  RefreshSessionResponse,
  StartAuthResponse,
  SessionHandshakeResponse,
  BlingStatusResponse,
  DisconnectResponse,
  BlingProductQuickView,
  GetBlingProductQuickViewResponse
} from '../shared/gateway-contracts.ts';

export const DEFAULT_GATEWAY_DEV_URL = 'http://localhost:3001';
export const DEFAULT_GATEWAY_BASE_URL = DEFAULT_GATEWAY_DEV_URL;

export type GatewayEnvironment = 'development' | 'test' | 'production';

export const STORAGE_KEYS = {
  LOCAL_REFRESH_SESSION: 'paulifest_grt_v2',
  SESSION_GST: 'paulifest_gst_v2',
  LEGACY_SESSION: 'paulifest_gateway_session_v1',
  GATEWAY_SESSION: 'paulifest_gateway_session_v1' // alias compatibilidade
} as const;

export interface ExtensionGatewaySession {
  gatewaySessionToken?: string;
  gatewayRefreshToken: string;
  gstExpiresAt?: string;
  sessionGeneration: number;
  updatedAt: string;
}

export interface StoredRefreshSession {
  gatewayRefreshToken: string;
  sessionGeneration: number;
  updatedAt: string;
}

export interface StoredGstSession {
  gatewaySessionToken: string;
  gstExpiresAt: string;
  sessionGeneration: number;
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

export interface IStorageArea {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export interface GatewayClientOptions {
  baseUrl?: string;
  environment?: GatewayEnvironment;
  timeoutMs?: number;
  localStorage?: IStorageArea;
  sessionStorage?: IStorageArea;
  storage?: IStorageArea; // backward-compatibility: se passado sozinho, atua como localStorage
}

export function detectEnvironment(): GatewayEnvironment {
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

// Armazenamento em memória para ambientes onde chrome.storage não está disponível (ex: testes sem mock de storage)
const memoryLocalStorage = new Map<string, any>();
const memorySessionStorage = new Map<string, any>();

function createDefaultLocalStorage(): IStorageArea {
  return {
    get: async (key: string) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const res = await chrome.storage.local.get(key);
        return res[key];
      }
      return memoryLocalStorage.get(key);
    },
    set: async (key: string, value: any) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [key]: value });
        return;
      }
      memoryLocalStorage.set(key, value);
    },
    remove: async (key: string) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove(key);
        return;
      }
      memoryLocalStorage.delete(key);
    }
  };
}

function createDefaultSessionStorage(): IStorageArea {
  return {
    get: async (key: string) => {
      if (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage as any).session) {
        const res = await (chrome.storage as any).session.get(key);
        return res[key];
      }
      return memorySessionStorage.get(key);
    },
    set: async (key: string, value: any) => {
      if (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage as any).session) {
        await (chrome.storage as any).session.set({ [key]: value });
        return;
      }
      memorySessionStorage.set(key, value);
    },
    remove: async (key: string) => {
      if (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage as any).session) {
        await (chrome.storage as any).session.remove(key);
        return;
      }
      memorySessionStorage.delete(key);
    }
  };
}

export class GatewayClient {
  private baseUrl: string;
  private environment: GatewayEnvironment;
  private timeoutMs: number;
  private localStorage: IStorageArea;
  private sessionStorage: IStorageArea;
  // Mutex single-flight indexado pelo token de refresh de origem (protege contra race de sessões)
  private activeRefreshPromises = new Map<string, Promise<string>>();
  // Cache volátil local em memória para Quick View (chave: sessionGeneration:productId)
  private quickViewLocalCache = new Map<string, { data: BlingProductQuickView; expiresAt: number }>();

  constructor(options: GatewayClientOptions = {}) {
    this.environment = options.environment || detectEnvironment();
    this.baseUrl = validateAndResolveBaseUrl(options.baseUrl, this.environment);
    this.timeoutMs = options.timeoutMs || 8000;
    this.localStorage = options.localStorage || options.storage || createDefaultLocalStorage();
    this.sessionStorage = options.sessionStorage || createDefaultSessionStorage();
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

  getLocalStorageArea(): IStorageArea {
    return this.localStorage;
  }

  getSessionStorageArea(): IStorageArea {
    return this.sessionStorage;
  }

  /**
   * Carrega a sessão da extensão:
   * 1. Executa migração segura caso exista schema v1 legado (paulifest_gateway_session_v1);
   * 2. Lê o GRT exclusivamente de storage.local;
   * 3. Lê o GST de storage.session (se existir e pertencer à mesma sessionGeneration);
   * 4. Retorna a sessão ou null.
   */
  async loadSession(): Promise<ExtensionGatewaySession | null> {
    // 1. Migração do formato legado (v1)
    const legacy = await this.localStorage.get(STORAGE_KEYS.LEGACY_SESSION);
    if (legacy && typeof legacy === 'object' && legacy.gatewayRefreshToken) {
      const migratedRefresh: StoredRefreshSession = {
        gatewayRefreshToken: legacy.gatewayRefreshToken,
        sessionGeneration: legacy.sessionGeneration || 1,
        updatedAt: legacy.updatedAt || new Date().toISOString()
      };
      await this.localStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, migratedRefresh);

      if (legacy.gatewaySessionToken && legacy.gstExpiresAt) {
        const migratedGst: StoredGstSession = {
          gatewaySessionToken: legacy.gatewaySessionToken,
          gstExpiresAt: legacy.gstExpiresAt,
          sessionGeneration: legacy.sessionGeneration || 1
        };
        await this.sessionStorage.set(STORAGE_KEYS.SESSION_GST, migratedGst);
      }

      // Remove de forma estrita o v1 para garantir que GST nunca permaneça em storage.local
      await this.localStorage.remove(STORAGE_KEYS.LEGACY_SESSION);
    }

    // 2. Lê sessão persistente (GRT) de localStorage
    const rawRefresh = await this.localStorage.get(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
    if (!rawRefresh || !rawRefresh.gatewayRefreshToken) {
      return null;
    }
    const refreshData = rawRefresh as StoredRefreshSession;

    // 3. Lê GST de sessionStorage (somente se pertencer à mesma geração)
    const rawGst = await this.sessionStorage.get(STORAGE_KEYS.SESSION_GST);
    let gstData: StoredGstSession | undefined;
    if (rawGst && rawGst.sessionGeneration === refreshData.sessionGeneration) {
      gstData = rawGst as StoredGstSession;
    }

    return {
      gatewaySessionToken: gstData?.gatewaySessionToken,
      gstExpiresAt: gstData?.gstExpiresAt,
      gatewayRefreshToken: refreshData.gatewayRefreshToken,
      sessionGeneration: refreshData.sessionGeneration,
      updatedAt: refreshData.updatedAt
    };
  }

  /**
   * Salva a sessão garantindo isolamento estrito:
   * - GRT -> storage.local
   * - GST -> storage.session
   * - NUNCA grava GST em storage.local
   */
  async saveSession(session: ExtensionGatewaySession): Promise<void> {
    const refreshData: StoredRefreshSession = {
      gatewayRefreshToken: session.gatewayRefreshToken,
      sessionGeneration: session.sessionGeneration,
      updatedAt: session.updatedAt || new Date().toISOString()
    };
    await this.localStorage.set(STORAGE_KEYS.LOCAL_REFRESH_SESSION, refreshData);

    if (session.gatewaySessionToken && session.gstExpiresAt) {
      const gstData: StoredGstSession = {
        gatewaySessionToken: session.gatewaySessionToken,
        gstExpiresAt: session.gstExpiresAt,
        sessionGeneration: session.sessionGeneration
      };
      await this.sessionStorage.set(STORAGE_KEYS.SESSION_GST, gstData);
    } else {
      await this.sessionStorage.remove(STORAGE_KEYS.SESSION_GST);
    }

    // Garante que o legado v1 não persista
    await this.localStorage.remove(STORAGE_KEYS.LEGACY_SESSION);
  }

  /**
   * Limpa todas as credenciais locais: local e session storage.
   */
  async clearSession(): Promise<void> {
    await this.localStorage.remove(STORAGE_KEYS.LOCAL_REFRESH_SESSION);
    await this.localStorage.remove(STORAGE_KEYS.LEGACY_SESSION);
    await this.sessionStorage.remove(STORAGE_KEYS.SESSION_GST);
    this.activeRefreshPromises.clear();
    this.quickViewLocalCache.clear();
  }

  /**
   * Limpa explicitamente o cache local de Quick View.
   */
  clearQuickViewLocalCache(): void {
    this.quickViewLocalCache.clear();
  }

  /**
   * Inicia o fluxo OAuth junto ao Gateway:
   * POST /auth/bling/start
   */
  async startBlingAuth(clientSessionId?: string): Promise<StartAuthResponse> {
    const finalClientSessionId = clientSessionId && clientSessionId.trim().length >= 16
      ? clientSessionId.trim()
      : `cli_${Math.random().toString(36).substring(2)}${Date.now().toString(36)}${Math.random().toString(36).substring(2)}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/auth/bling/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSessionId: finalClientSessionId }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (netErr: any) {
      throw new GatewayTransientError(
        `Falha de conexão com Gateway ao iniciar autorização: ${netErr?.message || netErr}`,
        0
      );
    }

    let body: any = {};
    try {
      body = await response.json();
    } catch {}

    if (!response.ok) {
      if (response.status === 429) {
        throw new GatewayTransientError(body.message || 'Muitas tentativas de autorização. Aguarde.', 429);
      }
      throw new Error(body.message || `Erro ao iniciar autorização no Gateway (${response.status}).`);
    }

    return body as StartAuthResponse;
  }

  /**
   * Executa o Handshake de Sessão pós-OAuth:
   * POST /auth/bling/session
   */
  async completeSessionHandshake(pairingId: string, pairingSecret: string): Promise<SessionHandshakeResponse> {
    if (!pairingId || !pairingSecret) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'pairingId e pairingSecret são obrigatórios.'
      };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/auth/bling/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingId, pairingSecret }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (netErr: any) {
      throw new GatewayTransientError(
        `Falha de rede ao verificar pareamento no Gateway: ${netErr?.message || netErr}`,
        0
      );
    }

    let body: any = {};
    try {
      body = await response.json();
    } catch {}

    if (!response.ok) {
      return {
        ok: false,
        status: body.status,
        error: body.error || 'HANDSHAKE_ERROR',
        message: body.message || `Falha no handshake (${response.status}).`,
        remainingAttempts: body.remainingAttempts
      };
    }

    const handshakeData = body as SessionHandshakeResponse;
    if (handshakeData.ok && handshakeData.gatewaySessionToken && handshakeData.gatewayRefreshToken) {
      const expiresInSeconds = handshakeData.expiresInSeconds || 900;
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
      const current = await this.loadSession();
      const nextGen = (current?.sessionGeneration || 0) + 1;

      await this.saveSession({
        gatewaySessionToken: handshakeData.gatewaySessionToken,
        gatewayRefreshToken: handshakeData.gatewayRefreshToken,
        gstExpiresAt: expiresAt,
        sessionGeneration: nextGen,
        updatedAt: new Date().toISOString()
      });
    }

    return handshakeData;
  }

  /**
   * Consulta o status da conexão no Gateway:
   * GET /integrations/bling/status
   */
  async getBlingStatus(): Promise<BlingStatusResponse> {
    let gst: string;
    try {
      gst = await this.getValidGst();
    } catch (err) {
      throw err;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/integrations/bling/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${gst}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (netErr: any) {
      throw new GatewayTransientError(
        `Falha de rede ao consultar status no Gateway: ${netErr?.message || netErr}`,
        0
      );
    }

    if (response.status === 401) {
      // Tenta 1 refresh via single-flight
      const current = await this.loadSession();
      if (!current?.gatewayRefreshToken) {
        throw new GatewayAuthRequiredError('Sessão inexistente no Gateway.');
      }
      gst = await this.executeSingleFlightRefresh(current.gatewayRefreshToken);

      try {
        response = await fetch(`${this.baseUrl}/integrations/bling/status`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${gst}`,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (netErr: any) {
        throw new GatewayTransientError(
          `Falha de rede ao consultar status no Gateway: ${netErr?.message || netErr}`,
          0
        );
      }

      if (response.status === 401) {
        throw new GatewayAuthRequiredError('Sessão rejeitada pelo Gateway.');
      }
    }

    let body: any = {};
    try {
      body = await response.json();
    } catch {}

    if (!response.ok) {
      throw new GatewayTransientError(
        body.message || `Erro ao consultar status no Gateway (${response.status}).`,
        response.status
      );
    }

    return body as BlingStatusResponse;
  }

  /**
   * Desconecta o Bling no Gateway com revogação remota e purga local:
   * DELETE /integrations/bling
   * 
   * REGRA DE SEGURANÇA (Fase 4C.4A):
   * Se o Gateway estiver offline / inalcançável, NÃO limpa a sessão localmente e NÃO
   * declara desconexão remota bem-sucedida falsamente. Permite retry seguro.
   */
  async disconnectBling(): Promise<DisconnectResponse> {
    const session = await this.loadSession();
    if (!session || !session.gatewayRefreshToken) {
      await this.clearSession();
      return {
        ok: true,
        status: 'disconnected',
        localDisconnected: true,
        remoteRevocation: { accessToken: 'not_available', refreshToken: 'not_available', complete: true },
        message: 'Extensão já desconectada localmente.'
      };
    }

    let gst: string;
    try {
      gst = await this.getValidGst();
    } catch (err: any) {
      if (err instanceof GatewayTransientError) {
        // Se erro foi transitório no refresh, falhamos a desconexão para não criar sessão órfã
        throw new GatewayTransientError(
          `Falha transitória ao preparar desconexão: ${err.message}. Credenciais preservadas para retry.`,
          err.status
        );
      }
      if (err instanceof GatewayAuthRequiredError) {
        // Sessão já estava inválida e foi purgada localmente pelo refresh
        return {
          ok: true,
          status: 'disconnected',
          localDisconnected: true,
          remoteRevocation: { accessToken: 'not_available', refreshToken: 'not_available', complete: false },
          message: 'Sessão já estava inválida no Gateway. Desconectado localmente.'
        };
      }
      // Fallback extremo
      gst = session.gatewaySessionToken || '';
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/integrations/bling`, {
        method: 'DELETE',
        headers: {
          ...(gst ? { 'Authorization': `Bearer ${gst}` } : {}),
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });
    } catch (netErr: any) {
      // Gateway indisponível/offline: PRESERVA as credenciais para permitir retry posterior!
      throw new GatewayTransientError(
        `Gateway inalcançável para desconexão remota: ${netErr?.message || netErr}. Credenciais preservadas para retry.`,
        0
      );
    }

    let body: any = {};
    try {
      body = await response.json();
    } catch {}

    if (!response.ok) {
      // Se 401 e chegamos aqui com um GST recém-validado, a sessão foi revogada
      if (response.status === 401) {
        await this.clearSession();
        return {
          ok: true,
          status: 'disconnected',
          localDisconnected: true,
          remoteRevocation: { accessToken: 'not_available', refreshToken: 'not_available', complete: false },
          message: 'Sessão já revogada no Gateway. Dados locais limpos.'
        };
      }
      // Outros erros (429, 500, etc): não confirma desconexão
      throw new GatewayTransientError(
        body.message || `Falha ao desconectar no Gateway (${response.status}).`,
        response.status
      );
    }

    // Sucesso confirmado pelo Gateway (200): purga local confirmada
    await this.clearSession();
    return body as DisconnectResponse;
  }

  /**
   * Obtém um GST válido:
   * - Se o GST armazenado em sessionStorage for válido com margem de segurança de 30s, retorna-o;
   * - Se ausente ou expirado, aciona a renovação single-flight via GRT.
   */
  async getValidGst(): Promise<string> {
    const session = await this.loadSession();
    if (!session || !session.gatewayRefreshToken) {
      throw new GatewayAuthRequiredError('Nenhuma sessão do Gateway ativa. Conecte o Bling.');
    }

    if (session.gatewaySessionToken && session.gstExpiresAt) {
      const expiresAt = new Date(session.gstExpiresAt).getTime();
      const now = Date.now();
      // Margem de 30 segundos antes da expiração
      if (expiresAt - now > 30000) {
        return session.gatewaySessionToken;
      }
    }

    // GST expirado ou ausente no sessionStorage (ex: pós-restart): renova via GRT
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

    // Reutiliza Promise ativa para o mesmo refresh token
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
            signal: AbortSignal.timeout(this.timeoutMs)
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
        const currentStored = await this.loadSession();
        if (!currentStored || currentStored.gatewayRefreshToken !== originatingRefreshToken) {
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
        return newSession.gatewaySessionToken!;
      } finally {
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

  /**
   * Consulta Quick View de produto (custo + estoque) no Gateway:
   * 1. Verifica cache volátil local (chave: sessionGeneration:productId);
   * 2. Obtém GST válido;
   * 3. Executa GET /integrations/bling/products/:id/quick-view;
   * 4. Trata 401 autoritativo do Gateway com 1 tentativa de refresh;
   * 5. Segundo 401 dispara GatewayAuthRequiredError;
   * 6. Armazena no cache volátil local (30s).
   */
  async fetchBlingProductQuickView(productId: string): Promise<BlingProductQuickView> {
    const trimmedId = productId.trim();
    if (!trimmedId) {
      throw new GatewayProductError('INVALID_PRODUCT_ID', 'ID do produto não pode ser vazio.', 400);
    }

    const currentStored = await this.loadSession();
    const sessionGen = currentStored?.sessionGeneration ?? 0;
    const cacheKey = `${sessionGen}:${trimmedId}`;

    const cached = this.quickViewLocalCache.get(cacheKey);
    if (cached && Date.now() <= cached.expiresAt) {
      return cached.data;
    }

    let gst: string;
    try {
      gst = await this.getValidGst();
    } catch (err) {
      throw err;
    }

    let res = await this.rawFetchQuickView(trimmedId, gst);

    if (res.status === 401) {
      if (!currentStored?.gatewayRefreshToken) {
        throw new GatewayAuthRequiredError('Sessão inexistente no Gateway.');
      }

      gst = await this.executeSingleFlightRefresh(currentStored.gatewayRefreshToken);
      res = await this.rawFetchQuickView(trimmedId, gst);
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
        body.message || `Falha na requisição de Quick View ao Gateway (HTTP ${res.status}).`,
        res.status,
        retryAfterMs
      );
    }

    const data: GetBlingProductQuickViewResponse = await res.json();
    const quickView = data.quickView;

    // Atualiza cache volátil local (otimização efêmera, não autoridade)
    this.quickViewLocalCache.set(cacheKey, {
      data: quickView,
      expiresAt: Date.now() + 30_000
    });

    return quickView;
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

  private async rawFetchQuickView(productId: string, gst: string): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/integrations/bling/products/${encodeURIComponent(productId)}/quick-view`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${gst}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });
    } catch (netErr: any) {
      throw new GatewayTransientError(
        `Erro de conexão com Gateway ao consultar Quick View: ${netErr?.message || netErr}`,
        0
      );
    }
  }
}

export const gatewayClient = new GatewayClient();
