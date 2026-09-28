import { NcmValidation } from '../NcmValidation.tsx';
import { NcmLookup } from '../NcmLookup.tsx';
import { SkuEditor } from '../SkuEditor.tsx';
import { NewBlingProduct } from '../NewBlingProduct.tsx';
import { assignGeneratedEan } from '../../../core/engines/identification/ean-generator.ts';
import { adaptSheetToTechnicalChanges, type SheetChangeContext } from '../../../core/engines/identification/sheet-adapter.ts';
import React, { useState } from 'react';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  Info,
  Layers,
  Cpu,
  Copy,
  Plus,
  Trash2
} from 'lucide-react';
import type { CentralProductSheet, FieldStatus, AuditedField, TechnicalAttribute } from '../../../core/schema/product.ts';
import { createAuditedField, resolveFieldConflict } from '../../../core/schema/product.ts';
import { buildBlingProductUpdatePatch } from '../../../integrations/bling/sheet-to-bling-patch.ts';
import type { BlingUpdateProductMessageResponse } from '../../../shared/gateway-contracts.ts';

interface StepSheetProps {
  sheet: CentralProductSheet;
  onUpdateSheet: (updater: (prev: CentralProductSheet) => CentralProductSheet) => void;
  onNext: () => void;
  onPrev: () => void;
  onExportMl?: () => void;
  newBlingTarget?: { tabId: number; pageInstanceId: string; url: string };
  blingTarget?: { productId: string; connected: boolean; contextKey: string };
  onUpdateBling?: (confirmedPatch: string) => Promise<BlingUpdateProductMessageResponse>;
}

const QUICK_ATTRIBUTE_SUGGESTIONS = ['Material', 'Cor', 'Capacidade', 'Quantidade', 'Tamanho'];

export const StepSheet: React.FC<StepSheetProps> = ({
  sheet,
  onUpdateSheet,
  onNext,
  onPrev,
  onExportMl,
  blingTarget,
  newBlingTarget,
  onUpdateBling
}) => {
  const [expandedEvidences, setExpandedEvidences] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [reviewedUpdate, setReviewedUpdate] = useState<string | null>(null);
  const [blingUpdateState, setBlingUpdateState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [blingUpdateMessage, setBlingUpdateMessage] = useState('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrValue, setNewAttrValue] = useState('');

  let blingPatch: Record<string, unknown> = {};
  let blingPatchError = '';
  if (blingTarget) {
    try { blingPatch = { ...buildBlingProductUpdatePatch(sheet) }; }
    catch (err: any) { blingPatchError = err?.message || 'A ficha não pode ser enviada.'; }
  }

  const patchSnapshot = JSON.stringify(blingPatch);
  const reviewIdentity = JSON.stringify([sheet.id, blingTarget?.contextKey, blingTarget?.productId, blingTarget?.connected, patchSnapshot]);
  const showBlingConfirmation = reviewedUpdate === reviewIdentity && !blingPatchError;
  const fieldLabels: Record<string, string> = {
    nome: 'Nome', codigo: 'SKU', preco: 'Preço de venda (R$)', gtin: 'EAN/GTIN',
    marca: 'Marca', descricaoComplementar: 'Descrição', pesoBruto: 'Peso bruto (kg)',
    dimensoes: 'Dimensões (cm)', tributacao: 'NCM'
  };
  const formatPatchValue = (value: unknown): string => {
    if (value && typeof value === 'object') {
      const labels: Record<string, string> = { altura: 'Altura', largura: 'Largura', profundidade: 'Comprimento', ncm: 'NCM' };
      return Object.entries(value).filter(([key]) => key !== 'unidadeMedida')
        .map(([key, entry]) => `${labels[key] || key}: ${entry}`).join(' · ');
    }
    return String(value);
  };

  const confirmBlingUpdate = async () => {
    if (!onUpdateBling || !showBlingConfirmation || !blingTarget?.connected || blingUpdateState === 'loading') return;
    setBlingUpdateState('loading');
    setBlingUpdateMessage('Atualizando no Bling...');
    let result: BlingUpdateProductMessageResponse;
    try { result = await onUpdateBling(patchSnapshot); }
    catch { result = { ok: false, error: 'Não foi possível confirmar a atualização.' }; }
    if (result.ok) {
      setBlingUpdateState('success');
      setBlingUpdateMessage(`Produto #${result.productId} atualizado.`);
      setReviewedUpdate(null);
    } else {
      setBlingUpdateState('error');
      setBlingUpdateMessage(result.error || 'O Bling não confirmou a atualização.');
    }
  };

  const handleCopy = (key: string, text: string) => {
    if (navigator?.clipboard?.writeText && text) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    }
  };

  const toggleEvidence = (fieldKey: string) => {
    setExpandedEvidences((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey]
    }));
  };

  const updateField = <K extends keyof CentralProductSheet>(
    key: K,
    val: any,
    status: FieldStatus = 'approved',
    changeContext?: SheetChangeContext
  ) => {
    onUpdateSheet((prev) => {
      const current = prev[key] as AuditedField<any>;
      const hasVal = typeof val === 'string' ? Boolean(val.trim()) : Boolean(val);
      const nextBase: CentralProductSheet = {
        ...prev,
        [key]: createAuditedField(
          val,
          'user_manual',
          1.0,
          hasVal ? status : 'missing',
          current?.evidence
        )
      };
      if (changeContext) {
        return adaptSheetToTechnicalChanges(prev, nextBase, changeContext);
      }
      return nextBase;
    });
  };

  const handleUpdateAttribute = (index: number, nextName: string, nextValue: string) => {
    onUpdateSheet((prev) => {
      const currentAttr = prev.attributes[index];
      if (!currentAttr) return prev;
      const oldVal = currentAttr.field.value;
      const nextAttributes: TechnicalAttribute[] = prev.attributes.map((attr, idx) =>
        idx === index
          ? {
              ...attr,
              name: nextName,
              field: createAuditedField(
                nextValue,
                'user_manual',
                1.0,
                nextValue.trim() ? 'approved' : 'missing',
                attr.field.evidence
              )
            }
          : attr
      );
      const nextBase: CentralProductSheet = { ...prev, attributes: nextAttributes };
      return adaptSheetToTechnicalChanges(prev, nextBase, {
        kind: 'attribute',
        attributeName: nextName,
        oldValue: oldVal,
        newValue: nextValue
      });
    });
  };

  const handleRemoveAttribute = (index: number) => {
    onUpdateSheet((prev) => {
      const target = prev.attributes[index];
      const nextAttributes = prev.attributes.filter((_, idx) => idx !== index);
      const nextBase: CentralProductSheet = { ...prev, attributes: nextAttributes };
      return adaptSheetToTechnicalChanges(prev, nextBase, {
        kind: 'attribute',
        attributeName: target?.name,
        oldValue: target?.field.value,
        newValue: ''
      });
    });
  };

  const handleAddAttribute = (customName?: string, customVal?: string) => {
    const nameToUse = (customName ?? newAttrName).trim();
    const valToUse = (customVal ?? newAttrValue).trim();
    if (!nameToUse) return;
    onUpdateSheet((prev) => {
      const newAttr: TechnicalAttribute = {
        id: `attr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: nameToUse,
        field: createAuditedField(valToUse, 'user_manual', 1.0, valToUse ? 'approved' : 'missing')
      };
      const nextBase: CentralProductSheet = {
        ...prev,
        attributes: [...prev.attributes, newAttr]
      };
      return adaptSheetToTechnicalChanges(prev, nextBase, {
        kind: 'attribute',
        attributeName: nameToUse,
        oldValue: '',
        newValue: valToUse
      });
    });
    if (customName === undefined) {
      setNewAttrName('');
      setNewAttrValue('');
    }
  };

  const handleResolveConflict = <K extends keyof CentralProductSheet>(
    key: K,
    chosenValue: any,
    chosenEvidence?: any
  ) => {
    onUpdateSheet((prev) => {
      const current = prev[key] as AuditedField<any>;
      const resolved = resolveFieldConflict(current, chosenValue, chosenEvidence);
      return {
        ...prev,
        [key]: resolved,
        hasUnresolvedConflicts: Object.entries(prev).some(([name, value]) => name !== String(key) && value && typeof value === 'object' && 'status' in value && value.status === 'conflict') || prev.attributes.some(a => a.field.status === 'conflict')
      };
    });
  };

  const renderStatusBadge = <K extends keyof CentralProductSheet>(key: K, field: AuditedField<any>) => {
    const isConflict = field.status === 'conflict';
    const hasValue = typeof field.value === 'string' ? Boolean(field.value.trim()) : Boolean(field.value);
    const isMissing = field.status === 'missing' || !hasValue;

    if (field.status === 'pending_review' && !isMissing) {
      return (
        <button
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-300"
          onClick={() => onUpdateSheet(prev => ({ ...prev, [key]: { ...(prev[key] as AuditedField<unknown>), status: 'approved' } }))}
        >
          Aprovar
        </button>
      );
    }
    if (isConflict) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold border bg-rose-50 text-rose-700 border-rose-200/60 flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5 text-rose-500" />
          <span>Conflito</span>
        </span>
      );
    }
    if (isMissing) return null;

    return (
      <span title="Preenchido" className="inline-flex">
        <CheckCircle2 className="w-3 h-3 text-emerald-600 flex-shrink-0" />
      </span>
    );
  };

  const renderEvidenceSnippet = (fieldKey: string, field: AuditedField<any>) => {
    if (!field.evidence?.extractedSnippet) return null;
    const isExpanded = expandedEvidences[fieldKey];

    return (
      <div className="pt-0.5">
        <button
          type="button"
          onClick={() => toggleEvidence(fieldKey)}
          className="text-[9px] text-[#86868b] hover:text-[#0071e3] flex items-center gap-1"
        >
          <Info className="w-2.5 h-2.5" />
          <span>{isExpanded ? 'Ocultar fonte' : 'Fonte'}</span>
        </button>
        {isExpanded && (
          <div className="p-2 bg-black/[0.02] rounded-lg border border-black/[0.06] mt-1 text-[10px] text-[#6e6e73]">
            {field.evidence.sourceName && <div className="font-semibold text-[#1d1d1f]">{field.evidence.sourceName}</div>}
            <p className="italic">"{field.evidence.extractedSnippet}"</p>
          </div>
        )}
      </div>
    );
  };

  const renderConflictCard = <K extends keyof CentralProductSheet>(key: K, field: AuditedField<any>) => {
    if (field.status !== 'conflict' || !field.conflictingValues || field.conflictingValues.length === 0) {
      return null;
    }
    const alt = field.conflictingValues[0];
    return (
      <div className="p-2 bg-rose-50/80 border border-rose-200 rounded-lg space-y-1.5 text-[10px]">
        <div className="font-semibold text-rose-800">Conflito detectado:</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => handleResolveConflict(key, field.value, field.evidence)}
            className="p-1.5 bg-white rounded border border-rose-200 text-left hover:bg-rose-50"
          >
            <div className="font-mono font-bold text-rose-700 truncate">{String(field.value)}</div>
            <span className="text-[9px] text-slate-500">Manter atual</span>
          </button>
          <button
            type="button"
            onClick={() => handleResolveConflict(key, alt.value, alt.evidence)}
            className="p-1.5 bg-white rounded border border-blue-200 text-left hover:bg-blue-50"
          >
            <div className="font-mono font-bold text-blue-700 truncate">{String(alt.value)}</div>
            <span className="text-[9px] text-slate-500">Adotar novo</span>
          </button>
        </div>
      </div>
    );
  };

  const titleBlingVal = (sheet.titleBling?.value || '').toUpperCase();

  return (
    <div className="space-y-2.5 animate-fade-in">
      {/* 1. Nome no Bling */}
      <div className="apple-glass-card rounded-xl p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <FileText className="w-3.5 h-3.5 text-emerald-600" />
            <span>Nome no Bling</span>
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleCopy('titleBling', titleBlingVal || sheet.title.value)}
              className="text-[10px] text-[#86868b] hover:text-emerald-600 flex items-center gap-1"
            >
              <Copy className="w-2.5 h-2.5" />
              <span>{copiedKey === 'titleBling' ? 'Copiado' : 'Copiar'}</span>
            </button>
            {sheet.titleBling && renderStatusBadge('titleBling', sheet.titleBling)}
          </div>
        </div>

        <input
          type="text"
          value={titleBlingVal}
          onChange={(e) => {
            const nextVal = e.target.value.toUpperCase();
            updateField('titleBling', nextVal, 'approved', {
              kind: 'titleBling',
              oldValue: titleBlingVal,
              newValue: nextVal
            });
          }}
          placeholder="Ex: LUVA NITRILICA BOMPACK PRETA 100UN"
          className="w-full px-2.5 py-1.5 bg-white rounded-lg border border-black/[0.1] focus:border-emerald-600 text-xs outline-none"
        />
        {sheet.titleBling && renderEvidenceSnippet('titleBling', sheet.titleBling)}
      </div>

      {/* 2. SKU Pai / Filho */}
      <SkuEditor sheet={sheet} onUpdateSheet={onUpdateSheet} />

      {/* 3. EAN / GTIN */}
      <div className="apple-glass-card rounded-xl p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#1d1d1f]">EAN / GTIN</span>
          <div className="flex items-center gap-2">
            {sheet.ean.value && (
              <button
                type="button"
                onClick={() => handleCopy('ean', sheet.ean.value)}
                className="text-[10px] text-[#86868b] hover:text-[#0071e3] flex items-center gap-1"
              >
                <Copy className="w-2.5 h-2.5" />
                <span>{copiedKey === 'ean' ? 'Copiado' : 'Copiar'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onUpdateSheet(prev => assignGeneratedEan({ ...prev, ean: createAuditedField('', 'user_manual', 0, 'missing') }))}
              className="text-[11px] text-[#0071e3] hover:underline font-medium"
            >
              Gerar EAN-13
            </button>
            {renderStatusBadge('ean', sheet.ean)}
          </div>
        </div>
        <input
          type="text"
          inputMode="numeric"
          maxLength={14}
          value={sheet.ean.value}
          onChange={(e) => updateField('ean', e.target.value.replace(/\D/g, ''))}
          placeholder="Código de barras (13 dígitos)"
          className="w-full px-2.5 py-1.5 bg-white rounded-lg border border-black/[0.1] focus:border-[#0071e3] text-xs font-mono outline-none"
        />
        {renderEvidenceSnippet('ean', sheet.ean)}
      </div>

      {/* 4. Marca e Detalhes Técnicos (Editáveis & Reativos) */}
      <div className="apple-glass-card rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[#1d1d1f] flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Marca e Detalhes Técnicos</span>
          </h3>
          <span className="text-[10px] text-[#86868b]">Adapta SKU, NCM e ML</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-[#6e6e73]">Marca</label>
              {renderStatusBadge('brand', sheet.brand)}
            </div>
            <input
              type="text"
              value={sheet.brand.value}
              onChange={(e) =>
                updateField('brand', e.target.value, 'approved', {
                  kind: 'brand',
                  oldValue: sheet.brand.value,
                  newValue: e.target.value
                })
              }
              placeholder="Ex: Bompack"
              className="w-full px-2.5 py-1.5 bg-white rounded-lg border border-black/[0.1] focus:border-[#0071e3] text-xs outline-none"
            />
            {renderConflictCard('brand', sheet.brand)}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-[#6e6e73]">Modelo</label>
              {renderStatusBadge('model', sheet.model)}
            </div>
            <input
              type="text"
              value={sheet.model.value}
              onChange={(e) =>
                updateField('model', e.target.value, 'approved', {
                  kind: 'model',
                  oldValue: sheet.model.value,
                  newValue: e.target.value
                })
              }
              placeholder="Ex: Nitrílica"
              className="w-full px-2.5 py-1.5 bg-white rounded-lg border border-black/[0.1] focus:border-[#0071e3] text-xs outline-none"
            />
            {renderConflictCard('model', sheet.model)}
          </div>
        </div>

        {/* Atributos Técnicos compactos */}
        <div className="space-y-1.5 pt-1 border-t border-black/[0.06]">
          <div className="flex items-center justify-between gap-1 flex-wrap">
            <span className="text-[11px] font-medium text-[#6e6e73]">
              Atributos ({sheet.attributes.length})
            </span>
            <div className="flex flex-wrap gap-1">
              {QUICK_ATTRIBUTE_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => handleAddAttribute(sug, '')}
                  className="text-[9.5px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-[#0071e3]"
                >
                  +{sug}
                </button>
              ))}
            </div>
          </div>

          {sheet.attributes.length > 0 && (
            <div className="space-y-1">
              {sheet.attributes.map((attr, idx) => (
                <div key={attr.id || idx} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    aria-label={`Nome do atributo ${idx + 1}`}
                    value={attr.name}
                    onChange={(e) => handleUpdateAttribute(idx, e.target.value, attr.field.value)}
                    placeholder="Atributo"
                    className="w-2/5 px-2 py-1 bg-white rounded-md border border-black/[0.1] text-[11px] font-medium text-[#1d1d1f] outline-none focus:border-[#0071e3]"
                  />
                  <input
                    type="text"
                    aria-label={`Valor do atributo ${attr.name || idx + 1}`}
                    value={attr.field.value}
                    onChange={(e) => handleUpdateAttribute(idx, attr.name, e.target.value)}
                    placeholder="Valor"
                    className="flex-1 px-2 py-1 bg-white rounded-md border border-black/[0.1] text-[11px] font-mono text-[#0071e3] outline-none focus:border-[#0071e3]"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveAttribute(idx)}
                    className="p-1 rounded text-slate-400 hover:text-rose-600"
                    title="Remover"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-0.5">
            <input
              type="text"
              value={newAttrName}
              onChange={(e) => setNewAttrName(e.target.value)}
              placeholder="Novo atributo (ex: Material)"
              className="w-2/5 px-2 py-1 bg-slate-50 focus:bg-white rounded-md border border-black/[0.08] text-[11px] outline-none focus:border-[#0071e3]"
            />
            <input
              type="text"
              value={newAttrValue}
              onChange={(e) => setNewAttrValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddAttribute();
                }
              }}
              placeholder="Valor (ex: Plástico)"
              className="flex-1 px-2 py-1 bg-slate-50 focus:bg-white rounded-md border border-black/[0.08] text-[11px] outline-none focus:border-[#0071e3]"
            />
            <button
              type="button"
              onClick={() => handleAddAttribute()}
              disabled={!newAttrName.trim()}
              className="px-2 py-1 rounded-md bg-[#0071e3] text-white text-[11px] font-semibold disabled:opacity-40"
              title="Adicionar atributo"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Peso, Medidas e Garantia recolhíveis para manter visual minimalista */}
        <details className="pt-1 border-t border-black/[0.06] text-xs">
          <summary className="cursor-pointer text-[11px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] flex items-center justify-between">
            <span>Medidas, peso e garantia</span>
            <span className="font-mono text-[10px]">
              {sheet.packageWeightKg.value || 0}kg · {sheet.packageHeightCm.value || 0}x{sheet.packageWidthCm.value || 0}x{sheet.packageLengthCm.value || 0}cm
            </span>
          </summary>
          <div className="pt-2 space-y-2">
            <div className="grid grid-cols-4 gap-1.5">
              <div>
                <label className="text-[10px] text-[#86868b] block">Peso (kg)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.01"
                  value={sheet.packageWeightKg.value || ''}
                  onChange={(e) => updateField('packageWeightKg', Number(e.target.value) > 0 ? Number(e.target.value) : 0, Number(e.target.value) > 0 ? 'approved' : 'missing', { kind: 'dimensions' })}
                  className="w-full px-2 py-1 bg-white rounded border border-black/[0.1] text-[11px]"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#86868b] block">Alt. (cm)</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={sheet.packageHeightCm.value || ''}
                  onChange={(e) => updateField('packageHeightCm', Number(e.target.value) > 0 ? Number(e.target.value) : 0, Number(e.target.value) > 0 ? 'approved' : 'missing', { kind: 'dimensions' })}
                  className="w-full px-2 py-1 bg-white rounded border border-black/[0.1] text-[11px]"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#86868b] block">Larg. (cm)</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={sheet.packageWidthCm.value || ''}
                  onChange={(e) => updateField('packageWidthCm', Number(e.target.value) > 0 ? Number(e.target.value) : 0, Number(e.target.value) > 0 ? 'approved' : 'missing', { kind: 'dimensions' })}
                  className="w-full px-2 py-1 bg-white rounded border border-black/[0.1] text-[11px]"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#86868b] block">Comp. (cm)</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={sheet.packageLengthCm.value || ''}
                  onChange={(e) => updateField('packageLengthCm', Number(e.target.value) > 0 ? Number(e.target.value) : 0, Number(e.target.value) > 0 ? 'approved' : 'missing', { kind: 'dimensions' })}
                  className="w-full px-2 py-1 bg-white rounded border border-black/[0.1] text-[11px]"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#86868b]">Garantia:</span>
              <div className="flex gap-1">
                {[30, 90, 180, 365].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => updateField('warrantyDays', days, 'approved', { kind: 'warranty' })}
                    className={`px-2 py-0.5 text-[10px] rounded border ${
                      sheet.warrantyDays.value === days ? 'bg-[#0071e3] text-white border-[#0071e3]' : 'bg-white border-black/[0.1]'
                    }`}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>

      {/* 5. Classificação Fiscal (NCM) */}
      <div className="apple-glass-card rounded-xl p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>NCM</span>
          </label>
          {renderStatusBadge('ncm', sheet.ncm)}
        </div>
        <input
          type="text"
          maxLength={10}
          value={sheet.ncm.value}
          onChange={(e) => updateField('ncm', e.target.value)}
          placeholder="Ex: 3924.10.00"
          className="w-full px-2.5 py-1.5 bg-white rounded-lg border border-black/[0.1] focus:border-[#0071e3] text-xs font-mono outline-none"
        />
        <NcmValidation code={sheet.ncm.value} />
        <NcmLookup key={sheet.id} sheet={sheet} onUpdateSheet={onUpdateSheet} />
        {renderConflictCard('ncm', sheet.ncm)}
      </div>

      {/* 6. Ações no Bling */}
      {blingTarget && (
        <div className="apple-glass-card rounded-xl p-3 space-y-2 border border-emerald-200 bg-emerald-50/40">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[#1d1d1f]">Produto #{blingTarget.productId} no Bling</p>
            <Layers className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          {blingPatchError && <p className="text-[10px] text-amber-700">{blingPatchError}</p>}
          {!showBlingConfirmation ? (
            <button
              type="button"
              disabled={!blingTarget.connected || Boolean(blingPatchError) || blingUpdateState === 'loading'}
              onClick={() => setReviewedUpdate(reviewIdentity)}
              className="w-full py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-black/10 disabled:text-[#86868b] text-white"
            >
              {blingTarget.connected ? 'Atualizar no Bling' : 'Conecte o Bling'}
            </button>
          ) : (
            <div className="rounded-lg bg-white border border-emerald-200 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold">Confirmar envio para #{blingTarget.productId}:</p>
              <dl className="text-[10px] space-y-1 max-h-48 overflow-y-auto">
                {Object.entries(blingPatch).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <dt className="font-semibold text-slate-600">{fieldLabels[key] || key}</dt>
                    <dd className="truncate font-mono">{formatPatchValue(value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex gap-1.5">
                <button type="button" disabled={blingUpdateState === 'loading'} onClick={() => setReviewedUpdate(null)} className="flex-1 py-1.5 rounded text-[11px] font-semibold bg-black/5">Cancelar</button>
                <button type="button" disabled={blingUpdateState === 'loading'} onClick={() => void confirmBlingUpdate()} className="flex-1 py-1.5 rounded text-[11px] font-semibold bg-emerald-600 text-white">
                  {blingUpdateState === 'loading' ? 'Enviando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}
          {blingUpdateMessage && <p className="text-[10px] text-slate-600">{blingUpdateMessage}</p>}
        </div>
      )}

      {newBlingTarget && <NewBlingProduct key={sheet.id + newBlingTarget.pageInstanceId} sheet={sheet} target={newBlingTarget} />}

      {/* 7. Navegação compacta */}
      <div className="flex items-center gap-1.5 pt-1">
        <button
          type="button"
          onClick={onPrev}
          className="px-3 py-2 rounded-xl text-xs font-semibold bg-black/5 hover:bg-black/10 text-[#1d1d1f] flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>Voltar</span>
        </button>

        <button
          type="button"
          onClick={onNext}
          className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold bg-[#0071e3] hover:bg-[#0077ed] text-white flex items-center justify-center gap-1.5"
        >
          <span>Preço</span>
          <ArrowRight className="w-3 h-3" />
        </button>

        {onExportMl && (
          <button
            type="button"
            onClick={onExportMl}
            className="py-2 px-3 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-[#1d1d1f] flex items-center gap-1"
            title="Ir direto para Anúncio ML"
          >
            <span>Anúncio ML</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
