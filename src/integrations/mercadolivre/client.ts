import type { MlAction } from '../../shared/mercadolivre-contracts.ts';
export async function mlAction(action: MlAction, payload: Record<string, unknown> = {}): Promise<any> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) throw new Error('Abra a extensão no Chrome e conecte o Gateway e o Mercado Livre.');
  const result = await chrome.runtime.sendMessage({ type: 'ML_ACTION', action, payload });
  if (!result?.ok) throw new Error(result?.error || result?.message || 'O Gateway não respondeu.');
  return result;
}
