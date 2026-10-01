import React, { useState } from 'react';
import type { MlConnectionInfo } from '../../shared/mercadolivre-contracts.ts';
import {
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Key,
  ShieldCheck,
  ExternalLink
} from 'lucide-react';

export interface MlConnectionCardProps {
  info: MlConnectionInfo;
  isHydrating?: boolean;
  onSaveApiKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  onDisconnect: () => Promise<void>;
  onStartOAuth: () => void;
}

export const MlConnectionCard: React.FC<MlConnectionCardProps> = ({
  info,
  isHydrating = false,
  onSaveApiKey,
  onDisconnect,
  onStartOAuth
}) => {
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const handleSaveKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setErrorMsg('Cole o Token de Acesso (Access Token) do Mercado Livre.');
      return;
    }
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await onSaveApiKey(trimmed);
      if (!res.ok) {
        setErrorMsg(res.error || 'Token inválido ou expirado.');
      } else {
        setApiKey('');
        setShowKeyInput(false);
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Erro ao validar token.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await onDisconnect();
      setConfirmDisconnect(false);
    } finally {
      setBusy(false);
    }
  };

  if (isHydrating) {
    return (
      <div className="bg-white border border-[#e2e8f0] rounded-xl p-3.5 shadow-xs animate-pulse space-y-2">
        <div className="h-4 bg-slate-100 rounded w-1/3" />
        <div className="h-3 bg-slate-100 rounded w-2/3" />
      </div>
    );
  }

  // Confirmação de desconexão inline
  if (confirmDisconnect) {
    return (
      <div className="bg-white border border-rose-200 rounded-xl p-3.5 shadow-xs space-y-2.5">
        <div className="flex items-start gap-2 text-rose-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold">Desconectar Mercado Livre?</p>
            <p className="text-[11px] text-rose-600 mt-0.5">
              A chave e sessão serão removidas. Os rascunhos e cálculos locais continuarão salvos.
            </p>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="flex-1 py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim, desconectar'}
          </button>
          <button
            onClick={() => setConfirmDisconnect(false)}
            disabled={busy}
            className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // 1. Estado CONECTADO
  if (info.connected) {
    return (
      <div className="bg-white border border-emerald-200/80 rounded-xl p-3.5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-900">Mercado Livre</span>
                <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full uppercase">
                  Conectado
                </span>
              </div>
              <p className="text-[11px] text-slate-600 font-medium">
                {info.nickname || `Vendedor ${info.sellerId}`}
                {info.sellerId && ` • ID: ${info.sellerId}`}
              </p>
            </div>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            {info.authType === 'direct_token' ? 'Chave API' : 'OAuth'}
          </span>
        </div>

        <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg p-2 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
          <span>Taxas dinâmicas, categorias e sincronização ativas.</span>
        </div>

        <button
          onClick={() => setConfirmDisconnect(true)}
          className="w-full py-1.5 px-3 text-xs text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-slate-200 transition-colors flex items-center justify-center gap-1.5"
        >
          <WifiOff className="w-3 h-3" />
          Desconectar conta ML
        </button>
      </div>
    );
  }

  // 2. Estado DESCONECTADO
  return (
    <div className="bg-white border border-[#e2e8f0] rounded-xl p-3.5 shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-yellow-50 text-yellow-600 flex items-center justify-center flex-shrink-0 font-bold text-xs">
            ML
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900">Mercado Livre</span>
              <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.2 rounded-full uppercase">
                Não Conectado
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Conecte para sincronizar anúncios e taxas oficiais.
            </p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg p-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Opção 1: Inserir Chave de API / Access Token */}
      {!showKeyInput ? (
        <div className="space-y-2 pt-1">
          <button
            onClick={() => setShowKeyInput(true)}
            className="w-full py-2 px-3 bg-[#ffe600] hover:bg-[#ebd300] text-slate-900 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs"
          >
            <Key className="w-3.5 h-3.5 text-slate-800" />
            Conectar com Chave API / Token
          </button>

          <button
            onClick={onStartOAuth}
            className="w-full py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 transition-colors flex items-center justify-center gap-1"
          >
            <Wifi className="w-3.5 h-3.5 text-slate-500" />
            Ou conectar via login (OAuth)
          </button>
        </div>
      ) : (
        <div className="space-y-2 pt-1 border-t border-slate-100">
          <label className="block text-[11px] font-semibold text-slate-700">
            Chave de API / Access Token (Mercado Livre Developers):
          </label>
          <div className="relative">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setErrorMsg('');
              }}
              placeholder="APP_USR-..."
              className="w-full text-xs font-mono border border-slate-300 rounded-lg px-2.5 py-1.5 pr-8 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <Key className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>
          <p className="text-[10px] text-slate-400 leading-tight">
            Cole seu Access Token gerado no Developers do Mercado Livre para consulta imediata de taxas e publicação.
          </p>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSaveKey}
              disabled={busy}
              className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Salvar e Validar Chave'}
            </button>
            <button
              onClick={() => {
                setShowKeyInput(false);
                setErrorMsg('');
              }}
              disabled={busy}
              className="py-1.5 px-3 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      <div className="pt-1">
        <a
          href="https://developers.mercadolivre.com.br"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-blue-600 hover:underline flex items-center gap-1"
        >
          <ExternalLink className="w-2.5 h-2.5" /> Onde obter meu token de desenvolvedor ML?
        </a>
      </div>
    </div>
  );
};
