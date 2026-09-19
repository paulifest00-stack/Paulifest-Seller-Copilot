// Componente de Card de Conexão Bling (Fase 4C.4B)
// Responsabilidade exclusiva: apresentação visual dos estados de conexão.
// INVARIANTES:
//   - NÃO chama Gateway diretamente
//   - NÃO armazena tokens ou secrets
//   - NÃO expõe pairingId, pairingSecret ou oauthTabId
//   - NÃO inicializa OAuth automaticamente (retry usa BLING_RETRY_CONNECTION)
//   - Confirmação de desconexão é inline (não usa window.confirm)
import React, { useState } from 'react';
import type { BlingConnectionStatus } from '../../shared/gateway-contracts.ts';
import {
  Wifi,
  WifiOff,
  Loader2,
  Clock,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Settings,
  ExternalLink
} from 'lucide-react';

export interface BlingConnectionCardProps {
  /** Estado autoritativo vindo do Background. Nunca derivado na UI. */
  status: BlingConnectionStatus;
  /** Apenas se realmente retornado pelo Gateway — nunca inventar. */
  lastRefreshAt?: string | null;
  /** true enquanto a resposta inicial de BLING_GET_CONNECTION_STATUS não chegou */
  isHydrating?: boolean;
  /** true durante execução de BLING_DISCONNECT (para feedback de progresso) */
  isDisconnecting?: boolean;
  /** Callbacks — cada um envia mensagem ao Background, sem acesso direto ao Gateway */
  onConnect: () => void;
  onDisconnect: () => void;
  onFocusOAuthTab: () => void;
  /** Envia BLING_RETRY_CONNECTION — Background reavalia sessão sem iniciar novo OAuth */
  onRetry: () => void;
}

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------

function formatLastRefresh(ts?: string | null): string | null {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Configuração visual por estado
// ---------------------------------------------------------------------------

interface StatusConfig {
  title: string;
  description: string;
  badge: string;
  badgeClass: string;
  borderClass: string;
  iconBg: string;
  iconColor: string;
  iconSpin: boolean;
  Icon: React.ElementType;
}

function getStatusConfig(status: BlingConnectionStatus): StatusConfig {
  switch (status) {
    case 'disconnected':
      return {
        title: 'Bling não conectado',
        description: 'Conecte sua conta Bling para importar produtos e sincronizar dados.',
        badge: 'Offline',
        badgeClass: 'bg-slate-100 text-slate-500 border border-slate-200',
        borderClass: '',
        iconBg: 'bg-slate-100',
        iconColor: 'text-slate-400',
        iconSpin: false,
        Icon: WifiOff
      };
    case 'connecting':
      return {
        title: 'Iniciando conexão…',
        description: 'Aguarde enquanto a conexão com o Bling é estabelecida.',
        badge: 'Conectando',
        badgeClass: 'bg-blue-50 text-blue-600 border border-blue-100',
        borderClass: 'border border-blue-200/40',
        iconBg: 'bg-blue-50',
        iconColor: 'text-blue-500',
        iconSpin: true,
        Icon: Loader2
      };
    case 'awaiting_oauth':
      return {
        title: 'Autorize o acesso na aba do Bling',
        description: 'Uma aba foi aberta com a tela de autorização do Bling. Autorize o acesso e retorne ao Copilot.',
        badge: 'Aguardando',
        badgeClass: 'bg-amber-50 text-amber-600 border border-amber-200',
        borderClass: 'border border-amber-200/60',
        iconBg: 'bg-amber-50',
        iconColor: 'text-amber-500',
        iconSpin: false,
        Icon: Clock
      };
    case 'connected':
      return {
        title: 'Bling conectado',
        description: 'Conexão ativa. Você pode importar e sincronizar produtos do Bling.',
        badge: 'Ativo',
        badgeClass: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
        borderClass: 'border border-emerald-200/50',
        iconBg: 'bg-emerald-50',
        iconColor: 'text-emerald-500',
        iconSpin: false,
        Icon: CheckCircle2
      };
    case 'refreshing':
      return {
        title: 'Renovando sessão…',
        description: 'A sessão está sendo renovada automaticamente. Aguarde um instante.',
        badge: 'Renovando',
        badgeClass: 'bg-blue-50 text-blue-500 border border-blue-100',
        borderClass: 'border border-blue-100/60',
        iconBg: 'bg-blue-50',
        iconColor: 'text-blue-400',
        iconSpin: true,
        Icon: RefreshCw
      };
    case 'requires_reauth':
      return {
        title: 'Autorização do Bling precisa ser renovada',
        description: 'Sua autorização expirou ou foi revogada. Reconecte para continuar usando o Copilot.',
        badge: 'Reconectar',
        badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
        borderClass: 'border border-amber-200/70',
        iconBg: 'bg-amber-50',
        iconColor: 'text-amber-600',
        iconSpin: false,
        Icon: AlertTriangle
      };
    case 'session_expired':
      return {
        title: 'Sessão expirada',
        description: 'A sessão com o Gateway foi encerrada. Conecte novamente para retomar.',
        badge: 'Expirado',
        badgeClass: 'bg-orange-50 text-orange-600 border border-orange-200',
        borderClass: 'border border-orange-200/60',
        iconBg: 'bg-orange-50',
        iconColor: 'text-orange-500',
        iconSpin: false,
        Icon: XCircle
      };
    case 'gateway_unreachable':
      return {
        title: 'Gateway temporariamente indisponível',
        description: 'O serviço está temporariamente inacessível. Sua sessão pode ainda ser válida — tente novamente em instantes.',
        badge: 'Transitório',
        badgeClass: 'bg-rose-50 text-rose-600 border border-rose-200',
        borderClass: 'border border-rose-200/50',
        iconBg: 'bg-rose-50',
        iconColor: 'text-rose-500',
        iconSpin: false,
        Icon: WifiOff
      };
    case 'configuration_error':
      return {
        // AJUSTE OBRIGATÓRIO 6: Sem URL interna, variável de ambiente, stack ou secret
        title: 'Erro de configuração detectado',
        description: 'Configuração do Gateway indisponível. Verifique a configuração da extensão.',
        badge: 'Config',
        badgeClass: 'bg-red-50 text-red-600 border border-red-200',
        borderClass: 'border border-red-200/60',
        iconBg: 'bg-red-50',
        iconColor: 'text-red-500',
        iconSpin: false,
        Icon: Settings
      };
    default:
      return {
        title: 'Status desconhecido',
        description: 'Não foi possível determinar o estado da conexão.',
        badge: '?',
        badgeClass: 'bg-slate-100 text-slate-500 border border-slate-200',
        borderClass: '',
        iconBg: 'bg-slate-100',
        iconColor: 'text-slate-400',
        iconSpin: false,
        Icon: WifiOff
      };
  }
}

// ---------------------------------------------------------------------------
// Ações por estado
// ---------------------------------------------------------------------------

interface ActionCallbacks {
  onConnect: () => void;
  onFocusOAuthTab: () => void;
  onRetry: () => void;
  onDisconnectRequest: () => void;
}

function renderActions(status: BlingConnectionStatus, cb: ActionCallbacks): React.ReactNode {
  switch (status) {
    case 'disconnected':
      return (
        <button
          onClick={cb.onConnect}
          className="w-full py-2 px-3 bg-[#0071e3] hover:bg-[#0077ed] text-white text-[11px] font-semibold rounded-xl apple-press-spring shadow-sm flex items-center justify-center gap-1.5 transition-colors"
        >
          <Wifi className="w-3.5 h-3.5" />
          Conectar Bling
        </button>
      );
    case 'connecting':
      return (
        <button
          disabled
          className="w-full py-2 px-3 bg-[#0071e3]/50 text-white text-[11px] font-semibold rounded-xl flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Iniciando…
        </button>
      );
    case 'awaiting_oauth':
      return (
        <button
          onClick={cb.onFocusOAuthTab}
          className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold rounded-xl apple-press-spring shadow-sm flex items-center justify-center gap-1.5 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Ir para aba de autorização
        </button>
      );
    case 'connected':
      return (
        <button
          onClick={cb.onDisconnectRequest}
          className="w-full py-1.5 px-3 bg-white hover:bg-rose-50 text-[#86868b] hover:text-rose-600 text-[11px] font-medium rounded-xl border border-black/10 hover:border-rose-200 apple-press-spring transition-all flex items-center justify-center gap-1.5"
        >
          <WifiOff className="w-3.5 h-3.5" />
          Desconectar
        </button>
      );
    case 'refreshing':
      // Sem ação durante refresh — não tratar como logout (AJUSTE OBRIGATÓRIO 4)
      return null;
    case 'requires_reauth':
      return (
        <button
          onClick={cb.onConnect}
          className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold rounded-xl apple-press-spring shadow-sm flex items-center justify-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reconectar Bling
        </button>
      );
    case 'session_expired':
      return (
        <button
          onClick={cb.onConnect}
          className="w-full py-2 px-3 bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-semibold rounded-xl apple-press-spring shadow-sm flex items-center justify-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Conectar novamente
        </button>
      );
    case 'gateway_unreachable':
      // AJUSTE OBRIGATÓRIO 1: Retry usa BLING_RETRY_CONNECTION — NÃO inicia OAuth
      return (
        <button
          onClick={cb.onRetry}
          className="w-full py-2 px-3 bg-slate-600 hover:bg-slate-700 text-white text-[11px] font-semibold rounded-xl apple-press-spring shadow-sm flex items-center justify-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Tentar novamente
        </button>
      );
    case 'configuration_error':
      // Sem ação de usuário — mensagem segura sem informação interna
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export const BlingConnectionCard: React.FC<BlingConnectionCardProps> = ({
  status,
  lastRefreshAt,
  isHydrating = false,
  isDisconnecting = false,
  onConnect,
  onDisconnect,
  onFocusOAuthTab,
  onRetry
}) => {
  // Estado local exclusivo de confirmação de desconexão — não afeta SSOT
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const handleDisconnectRequest = () => setConfirmingDisconnect(true);
  const handleDisconnectConfirm = () => {
    setConfirmingDisconnect(false);
    onDisconnect();
  };
  const handleDisconnectCancel = () => setConfirmingDisconnect(false);

  // ---------------------------------------------------------------------------
  // AJUSTE OBRIGATÓRIO 5: Hydration skeleton — evita flash enganoso de "disconnected"
  // antes da resposta de BLING_GET_CONNECTION_STATUS chegar
  // ---------------------------------------------------------------------------
  if (isHydrating) {
    return (
      <section className="apple-glass-card rounded-2xl p-3 space-y-2 animate-fade-in">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-slate-100 animate-pulse flex-shrink-0" />
          <div className="space-y-1.5 flex-1">
            <div className="h-3 bg-slate-200 rounded animate-pulse w-32" />
            <div className="h-2.5 bg-slate-100 rounded animate-pulse w-20" />
          </div>
        </div>
        <div className="h-2 bg-slate-100 rounded animate-pulse w-full" />
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Diálogo de confirmação de desconexão (inline React — sem window.confirm)
  // ---------------------------------------------------------------------------
  if (confirmingDisconnect && !isDisconnecting) {
    return (
      <section className="apple-glass-card rounded-2xl p-3 space-y-3 animate-fade-in border border-rose-200/60">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-semibold text-rose-800">Desconectar o Bling?</p>
            <p className="text-[11px] text-rose-700 mt-0.5 leading-relaxed">
              A conexão com o Bling será encerrada. Fichas já salvas não serão apagadas.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDisconnectConfirm}
            className="flex-1 py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold rounded-lg apple-press-spring transition-colors"
          >
            Sim, desconectar
          </button>
          <button
            onClick={handleDisconnectCancel}
            className="flex-1 py-1.5 px-3 bg-white hover:bg-slate-50 text-[#1d1d1f] text-[11px] font-semibold rounded-lg border border-black/10 apple-press-spring transition-colors"
          >
            Cancelar
          </button>
        </div>
      </section>
    );
  }

  const config = getStatusConfig(status);
  const lastRefreshLabel = formatLastRefresh(lastRefreshAt);

  return (
    <section
      className={`apple-glass-card rounded-2xl p-3 space-y-2.5 animate-fade-in transition-all duration-300 ${config.borderClass}`}
    >
      {/* Header: ícone + título + badge de status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${config.iconBg}`}>
            <config.Icon className={`w-3.5 h-3.5 ${config.iconColor} ${config.iconSpin ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[#1d1d1f] leading-tight">{config.title}</p>
            {/* lastRefreshAt: só exibido se realmente vier do Gateway e status for connected */}
            {lastRefreshLabel && status === 'connected' && (
              <p className="text-[9px] text-[#86868b] font-medium">
                Sessão validada às {lastRefreshLabel}
              </p>
            )}
          </div>
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0 ${config.badgeClass}`}>
          {config.badge}
        </span>
      </div>

      {/* Descrição contextual */}
      <p className="text-[11px] text-[#6e6e73] leading-relaxed">{config.description}</p>

      {/* Progresso de desconexão */}
      {isDisconnecting && (
        <div className="flex items-center gap-2 text-[11px] text-[#86868b]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Encerrando conexão…</span>
        </div>
      )}

      {/* Ações — ocultas durante progress de desconexão */}
      {!isDisconnecting && renderActions(status, {
        onConnect,
        onFocusOAuthTab,
        onRetry,
        onDisconnectRequest: handleDisconnectRequest
      })}
    </section>
  );
};
