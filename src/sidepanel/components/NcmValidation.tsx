import { useEffect, useState } from 'react';
import { loadOfficialNcmTable } from '../../core/services/ncm-service.ts';
export function NcmValidation({ code }: { code: string }) {
  const [state, setState] = useState<{ code: string; valid: boolean; text: string } | null>(null);
  useEffect(() => { let active = true; const digits = code.replace(/\D/g, ''); if (digits.length !== 8) { setState(null); return; }
    void loadOfficialNcmTable().then(table => { const found = table.find(row => row.code === digits); if (active) setState({ code, valid: !!found, text: found ? found.path : 'Código não encontrado na tabela vigente. Confira a classificação.' }); }).catch(() => { if (active) setState({ code, valid: false, text: 'Consulta oficial indisponível. Código ainda não validado.' }); });
    return () => { active = false; };
  }, [code]);
  if (!code) return null;
  if (!state || state.code !== code) return <p className="text-xs text-slate-500">{code.replace(/\D/g, '').length === 8 ? 'Consultando código na tabela NCM…' : 'NCM deve conter 8 dígitos.'}</p>;
  return <div className={`rounded-lg p-2 text-xs ${state.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}><strong>{state.valid ? 'Código vigente · Siscomex' : 'NCM precisa de conferência'}</strong><p>{state.text}</p>{state.valid && <p className="mt-1">Existência na tabela não confirma a classificação deste produto.</p>}</div>;
}
