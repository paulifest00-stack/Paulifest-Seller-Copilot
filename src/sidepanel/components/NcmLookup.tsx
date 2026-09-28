import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Check, Search } from 'lucide-react';
import { createAuditedField, type CentralProductSheet } from '../../core/schema/product.ts';
import { loadSellerPreferences } from '../../core/storage/storage.ts';
import {
  NCM_TABLE_URL,
  buildNcmQueryFromSheet,
  loadOfficialNcmTable,
  searchNcm,
  suggestNcm,
  type NcmSuggestion
} from '../../core/services/ncm-service.ts';

export function NcmLookup({
  sheet,
  onUpdateSheet
}: {
  sheet: CentralProductSheet;
  onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [customQuery, setCustomQuery] = useState('');
  const [results, setResults] = useState<{ signature: string; items: NcmSuggestion[] } | null>(null);

  const productName = (sheet.titleBling?.value || sheet.title?.value || '').trim();
  const attributesSig = (sheet.attributes || [])
    .filter(a => a.field?.status !== 'conflict' && a.field?.value)
    .map(a => `${a.name}:${a.field.value}`)
    .join('|');

  const signature = JSON.stringify([
    sheet.id,
    productName,
    sheet.brand?.value || '',
    sheet.model?.value || '',
    sheet.categoryPathML?.value || '',
    attributesSig
  ]);
  const live = useRef(signature);
  live.current = signature;
  const lastAutoSignature = useRef<string>('');

  const applySuggestion = (entry: NcmSuggestion) => {
    onUpdateSheet(current => {
      if (current.id !== sheet.id) return current;
      return {
        ...current,
        ncm: createAuditedField(
          entry.code,
          entry.method === 'ai' ? 'ai_generated' : 'rule_engine',
          0.95,
          'approved',
          {
            capturedAt: new Date().toISOString(),
            sourceName: 'Tabela NCM — Siscomex',
            sourceUrl: NCM_TABLE_URL,
            extractedSnippet: `${entry.path} | ${entry.reason}`,
            sourceId: entry.code
          }
        )
      };
    });
  };

  const lookup = async (isAuto = false, manualTerm?: string) => {
    const queryTerm = (manualTerm ?? customQuery).trim();
    if (!productName && !queryTerm) {
      if (!isAuto) setMessage('Digite um termo para buscar o NCM.');
      return;
    }
    setBusy(true);
    if (!isAuto) setMessage('');
    try {
      let items: NcmSuggestion[];
      if (queryTerm) {
        const entries = await loadOfficialNcmTable();
        items = searchNcm(entries, `${queryTerm} ${buildNcmQueryFromSheet(sheet)}`.trim());
        if (items.length === 0) items = searchNcm(entries, queryTerm);
      } else {
        const prefs = await loadSellerPreferences();
        items = await suggestNcm(sheet, prefs.geminiApiKey);
      }
      if (!queryTerm && live.current !== signature) return;
      setResults({ signature, items });
      if (items.length > 0) {
        setMessage('');
      } else if (!isAuto) {
        setMessage('Nenhum NCM encontrado. Tente buscar pelo material (ex: plástico, borracha).');
      }
    } catch (error) {
      if (live.current === signature) setMessage(error instanceof Error ? error.message : 'Falha ao consultar NCM.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!productName) return;
    if (lastAutoSignature.current === signature) return;
    lastAutoSignature.current = signature;
    void lookup(true);
  }, [signature, productName]);

  const currentCleanNcm = sheet.ncm.value.replace(/\D/g, '');
  const activeItems = results?.signature === signature ? results.items : [];

  return (
    <div className="space-y-1.5 text-xs pt-0.5">
      <div className="flex gap-1.5 items-center">
        <div className="relative flex-1">
          <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void lookup(false, customQuery);
              }
            }}
            placeholder="Buscar NCM (ex: pote plástico, luva borracha, 3924)..."
            className="w-full pl-6 pr-2 py-1 bg-slate-50 rounded-lg border border-black/[0.08] focus:bg-white focus:border-[#0071e3] text-[11px] outline-none"
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void lookup(false, customQuery)}
          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#1d1d1f] font-medium text-[10px] flex items-center gap-1 disabled:opacity-50"
          title="Recalcular sugestões de NCM"
        >
          <RefreshCw className={`w-2.5 h-2.5 ${busy ? 'animate-spin' : ''}`} />
          <span>{customQuery.trim() ? 'Buscar' : 'Sugerir'}</span>
        </button>
      </div>

      {activeItems.length > 0 && (
        <div className="space-y-1">
          {activeItems.map((entry) => {
            const isSelected = currentCleanNcm === entry.code;
            const formattedCode = entry.code.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
            return (
              <div
                key={entry.code}
                onClick={() => applySuggestion(entry)}
                className={`cursor-pointer rounded-lg px-2.5 py-1.5 border transition-all flex items-center justify-between gap-2 ${
                  isSelected
                    ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                    : 'bg-black/[0.015] hover:bg-blue-50/40 border-black/[0.06] text-[#1d1d1f]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-[11px] text-[#0071e3]">
                      {formattedCode}
                    </span>
                    <span className="text-[11px] truncate text-[#1d1d1f]">
                      {entry.description}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    applySuggestion(entry);
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 flex-shrink-0 ${
                    isSelected
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white border border-black/[0.1] text-[#1d1d1f] hover:border-[#0071e3]'
                  }`}
                >
                  {isSelected && <Check className="w-2.5 h-2.5" />}
                  <span>{isSelected ? 'Ativo' : 'Usar'}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {message && <p role="status" className="text-[10px] text-[#6e6e73]">{message}</p>}
    </div>
  );
}
