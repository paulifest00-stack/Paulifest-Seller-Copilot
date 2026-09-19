// Orquestrador de Autenticação e Conexão do Bling no Background (Fase 4C.4A)
import type {
  BlingConnectionStatus,
  BlingStartConnectResponse,
  BlingGetConnectionStatusResponse,
  BlingDisconnectResponseMessage,
  BlingConnectionStatusChangedMessage
} from '../shared/gateway-contracts.ts';
import { 
  GatewayClient, 
  gatewayClient as defaultGatewayClient,
  GatewayAuthRequiredError,
  GatewayTransientError
} from './gateway-client.ts';

export interface ActiveOAuthFlow {
  flowId: string;
  pairingId: string;
  pairingSecret: string;
  expiresAtMs: number;
  oauthTabId?: number;
  timer?: any;
  status: BlingConnectionStatus;
  resolved: boolean;
}

export class BlingAuthOrchestrator {
  private gatewayClient: GatewayClient;
  // Estado em memória estrito: pairingSecret e flow NUNCA são persistidos em disco ou storage!
  private activeFlow: ActiveOAuthFlow | null = null;
  private cachedStatus: BlingConnectionStatus = 'disconnected';

  constructor(clientInstance?: GatewayClient) {
    this.gatewayClient = clientInstance || defaultGatewayClient;
  }

  getActiveFlow(): ActiveOAuthFlow | null {
    return this.activeFlow;
  }

  getCachedStatus(): BlingConnectionStatus {
    return this.cachedStatus;
  }

  /**
   * Inicia o fluxo "Conectar Bling":
   * 1. Single-flight: se já houver fluxo ativo (connecting ou awaiting_oauth), não duplica;
   * 2. Chama Gateway POST /auth/bling/start;
   * 3. Abre a aba do Bling (se ambiente Chrome com tabs);
   * 4. Inicia o polling com TTL fornecido pelo Gateway;
   * 5. pairingSecret fica exclusivamente na memória volátil do Background.
   */
  async startConnect(): Promise<BlingStartConnectResponse> {
    // 1. Proteção Single-Flight contra múltiplos cliques concorrentes
    if (this.activeFlow && !this.activeFlow.resolved && Date.now() < this.activeFlow.expiresAtMs) {
      if (this.activeFlow.oauthTabId && typeof chrome !== 'undefined' && chrome.tabs?.update) {
        chrome.tabs.update(this.activeFlow.oauthTabId, { active: true }).catch(() => {});
      }
      return {
        ok: true,
        status: this.activeFlow.status,
        pairingId: this.activeFlow.pairingId,
        message: 'Fluxo de conexão já em andamento.'
      };
    }

    this.cachedStatus = 'connecting';
    this.broadcastStatus('connecting');

    try {
      const startRes = await this.gatewayClient.startBlingAuth();
      if (!startRes.ok || !startRes.authorizationUrl || !startRes.pairingId || !startRes.pairingSecret) {
        this.cachedStatus = 'disconnected';
        this.broadcastStatus('disconnected');
        return {
          ok: false,
          status: 'disconnected',
          error: startRes.error || 'START_AUTH_FAILED',
          message: startRes.message || 'Falha ao iniciar pareamento no Gateway.'
        };
      }

      // TTL governado pela autoridade do Gateway (com margem de segurança de 5 segundos)
      const ttlSeconds = startRes.expiresInSeconds || 300;
      const expiresAtMs = Date.now() + Math.max(10000, (ttlSeconds * 1000) - 5000);
      const flowId = `flow_${Math.random().toString(36).substring(2)}_${Date.now()}`;

      // Validação Mínima da URL (Requisito 6)
      try {
        const parsedUrl = new URL(startRes.authorizationUrl);
        const isLocal = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
        const isBling = parsedUrl.hostname.endsWith('bling.com.br');
        if (!isBling && !isLocal) throw new Error('Hostname inválido.');
        if (parsedUrl.protocol !== 'https:' && !isLocal) throw new Error('Protocolo inválido. HTTPS exigido.');
      } catch (err) {
        this.cachedStatus = 'disconnected';
        this.broadcastStatus('disconnected');
        return {
          ok: false,
          status: 'disconnected',
          error: 'INVALID_AUTH_URL',
          message: 'O Gateway retornou uma URL de autorização insegura ou inválida.'
        };
      }

      // Abre aba do Bling se executando na extensão
      let oauthTabId: number | undefined;
      if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
        try {
          const tab = await chrome.tabs.create({ url: startRes.authorizationUrl });
          oauthTabId = tab?.id;
        } catch (tabErr) {
          console.warn('[Paulifest Copilot] Falha ao abrir aba de autorização do Bling:', tabErr);
        }
      }

      const flow: ActiveOAuthFlow = {
        flowId,
        pairingId: startRes.pairingId,
        pairingSecret: startRes.pairingSecret,
        expiresAtMs,
        oauthTabId,
        status: 'awaiting_oauth',
        resolved: false
      };

      this.activeFlow = flow;
      this.cachedStatus = 'awaiting_oauth';
      this.broadcastStatus('awaiting_oauth');

      // Inicia o polling moderado (2 segundos)
      this.startHandshakePolling(flow);

      return {
        ok: true,
        status: 'awaiting_oauth',
        authorizationUrl: startRes.authorizationUrl,
        pairingId: startRes.pairingId,
        message: 'Aba do Bling aberta. Aguardando autorização.'
      };
    } catch (err: any) {
      this.cachedStatus = 'disconnected';
      this.broadcastStatus('disconnected');
      return {
        ok: false,
        status: 'disconnected',
        error: 'START_AUTH_ERROR',
        message: err?.message || 'Erro inesperado ao iniciar fluxo de conexão.'
      };
    }
  }

  /**
   * Polling de Handshake com controle estrito de TTL e proteção contra respostas tardias:
   */
  private startHandshakePolling(flow: ActiveOAuthFlow): void {
    const pollIntervalMs = 2000;

    const timer = setInterval(async () => {
      // Se o fluxo foi cancelado, substituído ou resolvido, encerra o timer
      if (this.activeFlow?.flowId !== flow.flowId || flow.resolved) {
        clearInterval(timer);
        return;
      }

      // Verifica timeout governado pelo TTL do Gateway
      if (Date.now() > flow.expiresAtMs) {
        clearInterval(timer);
        flow.resolved = true;
        this.activeFlow = null;
        this.cachedStatus = 'disconnected';
        this.broadcastStatus('disconnected');
        return;
      }

      try {
        // DECISÃO ARQUITETURAL MV3 (Fase 4C.4B):
        // NÃO usamos nenhum hack de keep-alive de runtime nem APIs artificiais para extensão de lifetime.
        // MV3 Service Workers são intencionalmente efêmeros — comportamentos incidentais de
        // extensão de lifetime não são garantidos e são mascarados pelo DevTools aberto.
        // O OAuth polling é best-effort: se o worker morrer, pairingSecret se perde (correto
        // por design — era exclusivamente na memória volátil), o pairing expira no Gateway,
        // e o usuário inicia um novo fluxo de conexão. Conexões JÁ estabelecidas sobrevivem
        // normalmente via GRT em chrome.storage.local → refresh → novo GST.
        const handshakeRes = await this.gatewayClient.completeSessionHandshake(flow.pairingId, flow.pairingSecret);

        // Proteção contra race/stale: se outro fluxo assumiu, descarta
        if (this.activeFlow?.flowId !== flow.flowId || flow.resolved) {
          clearInterval(timer);
          return;
        }

        if (handshakeRes.ok) {
          // Handshake concluído com sucesso!
          clearInterval(timer);
          flow.resolved = true;
          this.activeFlow = null;
          this.cachedStatus = 'connected';

          // Fecha aba de consentimento se ainda estiver aberta
          if (flow.oauthTabId && typeof chrome !== 'undefined' && chrome.tabs?.remove) {
            chrome.tabs.remove(flow.oauthTabId).catch(() => {});
          }

          this.broadcastStatus('connected');
          return;
        }

        // Se o erro for terminal para o pareamento (expirado, consumido, tentativas esgotadas)
        if (
          handshakeRes.error === 'PAIRING_EXPIRED' ||
          handshakeRes.error === 'PAIRING_ALREADY_CONSUMED' ||
          handshakeRes.error === 'PAIRING_MAX_ATTEMPTS_EXCEEDED'
        ) {
          clearInterval(timer);
          flow.resolved = true;
          this.activeFlow = null;
          this.cachedStatus = 'disconnected';
          this.broadcastStatus('disconnected');
          return;
        }

        // Se for OAUTH_FLOW_NOT_COMPLETED ou erro transitório: continua aguardando no próximo tick
      } catch (pollErr) {
        // Erros de rede durante polling são transitórios e não encerram o polling prematuramente
      }
    }, pollIntervalMs);

    flow.timer = timer;
  }

  /**
   * Tratamento de Race Condition ao fechar a aba OAuth (Requisito 6):
   * Não declara imediatamente 'disconnected'!
   * Interrompe o polling periódico e executa UMA ÚLTIMA TENTATIVA de handshake,
   * garantindo que se o callback acabou de concluir, a sessão seja confirmada.
   */
  async handleTabRemoved(tabId: number): Promise<void> {
    if (!this.activeFlow || this.activeFlow.resolved || this.activeFlow.oauthTabId !== tabId) {
      return;
    }

    const flow = this.activeFlow;
    if (flow.timer) {
      clearInterval(flow.timer);
      flow.timer = undefined;
    }

    try {
      const lastAttempt = await this.gatewayClient.completeSessionHandshake(flow.pairingId, flow.pairingSecret);

      // Proteção de geração/flowId
      if (this.activeFlow?.flowId !== flow.flowId || flow.resolved) {
        return;
      }

      flow.resolved = true;
      this.activeFlow = null;

      if (lastAttempt.ok) {
        this.cachedStatus = 'connected';
        this.broadcastStatus('connected');
      } else {
        // Se ainda não estava completo ou falhou: fecha o fluxo e volta a disconnected
        this.cachedStatus = 'disconnected';
        this.broadcastStatus('disconnected');
      }
    } catch {
      if (this.activeFlow?.flowId === flow.flowId) {
        flow.resolved = true;
        this.activeFlow = null;
        this.cachedStatus = 'disconnected';
        this.broadcastStatus('disconnected');
      }
    }
  }

  /**
   * Consulta o estado autoritativo da conexão:
   * Combina estado transitório em memória (se houver OAuth em voo) com estado da sessão persistente.
   */
  async getConnectionStatus(): Promise<BlingGetConnectionStatusResponse> {
    // 1. Se houver fluxo OAuth em voo, o estado transitório prevalece
    if (this.activeFlow && !this.activeFlow.resolved && Date.now() < this.activeFlow.expiresAtMs) {
      return {
        ok: true,
        status: this.activeFlow.status
      };
    }

    // 2. Verifica existência de sessão no storage
    let session;
    try {
      session = await this.gatewayClient.loadSession();
    } catch (err: any) {
      if (err?.message?.includes('fail-closed') || err?.message?.includes('HTTPS obrigatório')) {
        this.cachedStatus = 'configuration_error';
        return { ok: false, status: 'configuration_error', error: 'CONFIGURATION_ERROR', message: err.message };
      }
      this.cachedStatus = 'disconnected';
      return { ok: true, status: 'disconnected' };
    }

    if (!session || !session.gatewayRefreshToken) {
      this.cachedStatus = 'disconnected';
      return { ok: true, status: 'disconnected' };
    }

    // 3. Consulta status no Gateway
    try {
      const statusRes = await this.gatewayClient.getBlingStatus();
      if (statusRes.requiresReauth) {
        this.cachedStatus = 'requires_reauth';
        return { ok: true, status: 'requires_reauth', lastRefreshAt: statusRes.lastRefreshAt };
      }
      if (statusRes.status === 'disconnected') {
        this.cachedStatus = 'disconnected';
        return { ok: true, status: 'disconnected' };
      }
      this.cachedStatus = 'connected';
      return { ok: true, status: 'connected', lastRefreshAt: statusRes.lastRefreshAt };
    } catch (err: any) {
      if (err instanceof GatewayAuthRequiredError) {
        this.cachedStatus = 'session_expired';
        return { ok: false, status: 'session_expired', error: 'SESSION_EXPIRED', message: err.message };
      }
      if (err instanceof GatewayTransientError) {
        this.cachedStatus = 'gateway_unreachable';
        return { ok: true, status: 'gateway_unreachable', message: err.message };
      }
      this.cachedStatus = 'disconnected';
      return { ok: false, status: 'disconnected', error: err?.message };
    }
  }

  /**
   * Executa desconexão segura:
   * 1. Cancela qualquer fluxo em andamento;
   * 2. Chama Gateway DELETE /integrations/bling;
   * 3. Se o Gateway estiver inalcançável, lança erro e preserva credenciais locais (Requisito 9);
   * 4. Se o Gateway confirmar, limpa credenciais locais e notifica listeners.
   */
  async disconnect(): Promise<BlingDisconnectResponseMessage> {
    if (this.activeFlow) {
      if (this.activeFlow.timer) clearInterval(this.activeFlow.timer);
      this.activeFlow.resolved = true;
      this.activeFlow = null;
    }

    try {
      await this.gatewayClient.disconnectBling();
      this.cachedStatus = 'disconnected';
      this.broadcastStatus('disconnected');
      return {
        ok: true,
        status: 'disconnected',
        message: 'Desconectado com sucesso.'
      };
    } catch (err: any) {
      // Se for falha transitória / Gateway offline: NÃO confirma desconexão
      throw err;
    }
  }

  /**
   * Transmissão tolerante de eventos de status para listeners da Sidebar e abas (Requisito 12):
   * Não lança erro se não houver abas abertas ou se a Sidebar estiver fechada.
   */
  broadcastStatus(status: BlingConnectionStatus, lastRefreshAt?: string | null): void {
    this.cachedStatus = status;

    const payload: BlingConnectionStatusChangedMessage = {
      type: 'BLING_CONNECTION_STATUS_CHANGED',
      status,
      lastRefreshAt,
      timestamp: new Date().toISOString()
    };

    // 1. Notifica Sidebar / Popup
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(payload, () => {
          if (chrome.runtime.lastError) {
            // Ignora ausência de listeners (ex: Sidebar fechada)
          }
        });
      } catch {}
    }

    // 2. Notifica abas ativas do Bling
    if (typeof chrome !== 'undefined' && chrome.tabs?.query && chrome.tabs?.sendMessage) {
      try {
        chrome.tabs.query({}).then((tabs) => {
          for (const tab of tabs) {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
            }
          }
        }).catch(() => {});
      } catch {}
    }
  }
}

export const blingAuthOrchestrator = new BlingAuthOrchestrator();
