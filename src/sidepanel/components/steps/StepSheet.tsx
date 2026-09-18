import React, { useState } from 'react';
import { 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  Sparkles, 
  Scale, 
  Box, 
  ShieldCheck, 
  ArrowLeft, 
  ArrowRight,
  Info,
  Layers,
  Edit3,
  Cpu,
  Check
} from 'lucide-react';
import type { CentralProductSheet, FieldStatus, AuditedField } from '../../../core/schema/product.ts';
import { createAuditedField, resolveFieldConflict } from '../../../core/schema/product.ts';

interface StepSheetProps {
  sheet: CentralProductSheet;
  onUpdateSheet: (updater: (prev: CentralProductSheet) => CentralProductSheet) => void;
  onNext: () => void;
  onPrev: () => void;
}

export const StepSheet: React.FC<StepSheetProps> = ({
  sheet,
  onUpdateSheet,
  onNext,
  onPrev
}) => {
  const [expandedEvidences, setExpandedEvidences] = useState<Record<string, boolean>>({});

  const toggleEvidence = (fieldKey: string) => {
    setExpandedEvidences((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey]
    }));
  };

  // Helper para atualizar campo auditado
  const updateField = <K extends keyof CentralProductSheet>(
    key: K,
    val: any,
    status: FieldStatus = 'edited'
  ) => {
    onUpdateSheet((prev) => {
      const current = prev[key] as AuditedField<any>;
      return {
        ...prev,
        [key]: createAuditedField(
          val,
          'user_manual',
          1.0,
          status,
          current?.evidence
        )
      };
    });
  };

  const toggleApproval = <K extends keyof CentralProductSheet>(key: K) => {
    onUpdateSheet((prev) => {
      const current = prev[key] as AuditedField<any>;
      const newStatus: FieldStatus = current.status === 'approved' ? 'pending_review' : 'approved';
      return {
        ...prev,
        [key]: {
          ...current,
          status: newStatus
        }
      };
    });
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
        [key]: resolved
      };
    });
  };

  const renderStatusBadge = <K extends keyof CentralProductSheet>(key: K, field: AuditedField<any>) => {
    const isApproved = field.status === 'approved';
    const isConflict = field.status === 'conflict';
    const isMissing = field.status === 'missing';

    let colorClass = 'bg-blue-50 text-blue-700 border-blue-200/60';
    let label = 'Editado';

    if (isApproved) {
      colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200/60';
      label = 'Aprovado';
    } else if (isConflict) {
      colorClass = 'bg-rose-50 text-rose-700 border-rose-200/60';
      label = 'Conflito';
    } else if (isMissing) {
      colorClass = 'bg-slate-100 text-slate-500 border-slate-200';
      label = 'Vazio';
    } else if (field.status === 'pending_review') {
      colorClass = 'bg-amber-50 text-amber-700 border-amber-200/60';
      label = field.source === 'ai_generated' ? 'Lido IA' : 'Revisar';
    }

    return (
      <button
        type="button"
        onClick={() => toggleApproval(key)}
        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border flex items-center gap-1 transition-all apple-press-spring ${colorClass}`}
        title="Clique para alternar status de aprovação"
      >
        {isApproved ? (
          <CheckCircle2 className="w-2.5 h-2.5" />
        ) : isConflict ? (
          <AlertTriangle className="w-2.5 h-2.5 text-rose-500" />
        ) : (
          <Edit3 className="w-2.5 h-2.5" />
        )}
        <span>{label}</span>
      </button>
    );
  };

  const getTierBadge = (tier?: number) => {
    switch (tier) {
      case 1: return { label: 'Tier 1 - Fabricante', color: 'bg-purple-50 text-purple-700 border-purple-200' };
      case 2: return { label: 'Tier 2 - Marca Oficial', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
      case 3: return { label: 'Tier 3 - Ficha Técnica', color: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 4: return { label: 'Tier 4 - Distribuidor', color: 'bg-sky-50 text-sky-700 border-sky-200' };
      case 5: return { label: 'Tier 5 - GS1 / GTIN', color: 'bg-teal-50 text-teal-700 border-teal-200' };
      case 6: return { label: 'Tier 6 - Marketplace', color: 'bg-slate-50 text-slate-700 border-slate-200' };
      default: return { label: 'Fonte Auditada', color: 'bg-slate-50 text-slate-600 border-slate-200' };
    }
  };

  const renderEvidenceSnippet = (fieldKey: string, field: AuditedField<any>) => {
    if (!field.evidence?.extractedSnippet) return null;
    const isExpanded = expandedEvidences[fieldKey];
    const tierInfo = getTierBadge(field.evidence.sourceTier);

    return (
      <div className="pt-1">
        <button
          type="button"
          onClick={() => toggleEvidence(fieldKey)}
          className="text-[9px] text-[#0071e3] hover:underline flex items-center gap-1 font-medium"
        >
          <Info className="w-2.5 h-2.5" />
          <span>{isExpanded ? 'Ocultar comprovação auditável' : 'Ver fonte & evidência auditável'}</span>
        </button>
        {isExpanded && (
          <div className="p-2 bg-black/[0.02] rounded-xl border border-black/[0.06] mt-1.5 space-y-1.5 text-[10px]">
            <div className="flex items-center justify-between gap-1 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${tierInfo.color}`}>
                {tierInfo.label}
              </span>
              {field.evidence.sourceId && (
                <span className="text-[9px] font-mono text-[#86868b] bg-white px-1.5 py-0.5 rounded border border-black/[0.04]">
                  ID: {field.evidence.sourceId}
                </span>
              )}
            </div>

            {field.evidence.sourceName && (
              <div className="text-[10px] font-semibold text-[#1d1d1f]">
                {field.evidence.sourceName}
                {field.evidence.documentTitle && (
                  <span className="font-normal text-[#86868b] block text-[9px]">
                    Doc: {field.evidence.documentTitle}
                  </span>
                )}
              </div>
            )}

            <p className="text-[#1d1d1f] bg-white p-1.5 rounded-lg border border-black/[0.04] italic leading-tight">
              "{field.evidence.extractedSnippet}"
            </p>

            {field.evidence.sourceUrl && (
              <a
                href={field.evidence.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[9px] text-[#0071e3] hover:underline truncate block"
              >
                {field.evidence.sourceUrl}
              </a>
            )}
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
      <div className="p-2.5 bg-rose-50/80 border border-rose-200 rounded-xl space-y-2 animate-scale-in">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-800">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />
          <span>Divergência entre fontes detectada:</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="p-2 bg-white rounded-lg border border-rose-200/60 space-y-1">
            <div className="font-semibold text-[#1d1d1f] truncate">Opção A (Atual)</div>
            <div className="text-xs font-bold text-rose-700 font-mono truncate">{String(field.value)}</div>
            <button
              type="button"
              onClick={() => handleResolveConflict(key, field.value, field.evidence)}
              className="w-full py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 font-semibold rounded flex items-center justify-center gap-1"
            >
              <Check className="w-3 h-3" />
              <span>Manter</span>
            </button>
          </div>

          <div className="p-2 bg-white rounded-lg border border-rose-200/60 space-y-1">
            <div className="font-semibold text-[#1d1d1f] truncate">Opção B (Conflito)</div>
            <div className="text-xs font-bold text-blue-700 font-mono truncate">{String(alt.value)}</div>
            <button
              type="button"
              onClick={() => handleResolveConflict(key, alt.value, alt.evidence)}
              className="w-full py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold rounded flex items-center justify-center gap-1"
            >
              <Check className="w-3 h-3" />
              <span>Adotar</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const titleLength = sheet.title.value.length;
  const isTitleOverLimit = titleLength > 60;

  // Cálculo de campos aprovados para a barra de auditoria
  const auditedFields = [
    sheet.title,
    sheet.brand,
    sheet.model,
    sheet.ncm,
    sheet.packageWeightKg,
    sheet.packageHeightCm,
    sheet.packageWidthCm,
    sheet.packageLengthCm,
    sheet.warrantyDays
  ];
  const approvedCount = auditedFields.filter((f) => f.status === 'approved').length;
  const auditPercent = Math.round((approvedCount / auditedFields.length) * 100);
  const totalConflicts = auditedFields.filter((f) => f.status === 'conflict').length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* 1. Barra de Auditoria de Dados da Ficha */}
      <div className="apple-glass-card rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-[#1d1d1f]">
            <Layers className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Auditoria da Ficha Central (SSOT)</span>
          </div>
          <span className="text-[11px] font-mono font-medium text-[#0071e3]">
            {auditPercent}% Validada
          </span>
        </div>

        <div className="w-full h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#0071e3] transition-all duration-300 rounded-full"
            style={{ width: `${auditPercent}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-[#86868b] pt-0.5">
          <span>{approvedCount} de {auditedFields.length} atributos confirmados</span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-500" />
            Confiança Geral: {(sheet.overallConfidenceScore * 100 || 85).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Alerta de Conflitos Ativos */}
      {totalConflicts > 0 && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2 text-rose-800 animate-scale-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5">
            <div className="font-bold">Atenção: {totalConflicts} conflito(s) entre fontes</div>
            <div className="text-[11px] text-rose-700">
              Escolha a opção correta nos cartões destacados abaixo para validar a ficha.
            </div>
          </div>
        </div>
      )}

      {/* 2. Título do Produto (Regra ML: 60 caracteres max) */}
      <div className="apple-glass-card rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <FileText className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Título do Anúncio (ML & Bling)</span>
          </label>
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${
                isTitleOverLimit
                  ? 'bg-rose-100 text-rose-700 font-bold'
                  : titleLength >= 50
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-black/[0.04] text-[#86868b]'
              }`}
            >
              {titleLength}/60 chars
            </span>
            {renderStatusBadge('title', sheet.title)}
          </div>
        </div>

        <input
          type="text"
          value={sheet.title.value}
          onChange={(e) => updateField('title', e.target.value)}
          placeholder="Ex: Furadeira de Impacto 1/2 Pol 750W 127V com Maleta"
          className={`w-full px-3 py-2 bg-white rounded-xl border text-xs outline-none transition-all ${
            isTitleOverLimit
              ? 'border-rose-400 ring-2 ring-rose-400/20'
              : 'border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20'
          }`}
        />

        {isTitleOverLimit && (
          <p className="text-[10px] text-rose-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span>O algoritmo do Mercado Livre penaliza títulos com mais de 60 caracteres.</span>
          </p>
        )}

        {renderConflictCard('title', sheet.title)}
        {renderEvidenceSnippet('title', sheet.title)}
      </div>

      {/* 3. Marca e Modelo */}
      <div className="grid grid-cols-2 gap-3">
        <div className="apple-glass-card rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-[#1d1d1f]">Marca</label>
            {renderStatusBadge('brand', sheet.brand)}
          </div>
          <input
            type="text"
            value={sheet.brand.value}
            onChange={(e) => updateField('brand', e.target.value)}
            placeholder="Ex: Bosch, Makita"
            className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-xs outline-none"
          />
          {renderConflictCard('brand', sheet.brand)}
          {renderEvidenceSnippet('brand', sheet.brand)}
        </div>

        <div className="apple-glass-card rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-[#1d1d1f]">Modelo</label>
            {renderStatusBadge('model', sheet.model)}
          </div>
          <input
            type="text"
            value={sheet.model.value}
            onChange={(e) => updateField('model', e.target.value)}
            placeholder="Ex: GSB 13 RE"
            className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-xs outline-none"
          />
          {renderConflictCard('model', sheet.model)}
          {renderEvidenceSnippet('model', sheet.model)}
        </div>
      </div>

      {/* 4. Atributos Técnicos Extraídos pela IA */}
      {sheet.attributes && sheet.attributes.length > 0 && (
        <div className="apple-glass-card rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold text-[#1d1d1f]">
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>Atributos Técnicos Identificados</span>
            </div>
            <span className="text-[10px] text-[#86868b]">{sheet.attributes.length} detectados</span>
          </div>

          <div className="space-y-2">
            {sheet.attributes.map((attr, idx) => (
              <div key={attr.id || idx} className="p-2 bg-white rounded-xl border border-black/[0.06] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#1d1d1f] capitalize">{attr.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                    {attr.field.source === 'ai_generated' ? 'Imagem / OCR' : 'Canônico'}
                  </span>
                </div>
                <div className="text-xs font-mono font-bold text-[#0071e3]">{attr.field.value}</div>
                {attr.field.evidence?.extractedSnippet && (
                  <div className="text-[9px] text-[#86868b] italic truncate">
                    Evidência: "{attr.field.evidence.extractedSnippet}"
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Classificação Fiscal (NCM) */}
      <div className="apple-glass-card rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Código NCM (Fiscal)</span>
          </label>
          {renderStatusBadge('ncm', sheet.ncm)}
        </div>
        <input
          type="text"
          maxLength={10}
          value={sheet.ncm.value}
          onChange={(e) => updateField('ncm', e.target.value)}
          placeholder="Ex: 8467.21.00"
          className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-xs font-mono outline-none"
        />
        {renderConflictCard('ncm', sheet.ncm)}
        {renderEvidenceSnippet('ncm', sheet.ncm)}
      </div>

      {/* 6. Peso com Embalagem (Impacto Logístico) */}
      <div className="apple-glass-card rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <Scale className="w-3.5 h-3.5 text-amber-600" />
            <span>Peso Embalado (kg)</span>
          </label>
          {renderStatusBadge('packageWeightKg', sheet.packageWeightKg)}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.05"
            min="0.01"
            value={sheet.packageWeightKg.value || ''}
            onChange={(e) => updateField('packageWeightKg', parseFloat(e.target.value) || 0.1)}
            placeholder="0.5"
            className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-xs font-semibold outline-none"
          />
          <span className="text-xs font-medium text-[#86868b] px-2 py-1 bg-black/[0.04] rounded-lg">
            kg
          </span>
        </div>
        {renderConflictCard('packageWeightKg', sheet.packageWeightKg)}
        {renderEvidenceSnippet('packageWeightKg', sheet.packageWeightKg)}
      </div>

      {/* 7. Dimensões do Pacote (AxLxC em cm) */}
      <div className="apple-glass-card rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <Box className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Dimensões do Pacote (cm)</span>
          </label>
          <span className="text-[10px] text-[#86868b]">A x L x C</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-[#86868b] block mb-1">Altura (A)</label>
            <input
              type="number"
              min="1"
              value={sheet.packageHeightCm.value || ''}
              onChange={(e) => updateField('packageHeightCm', parseInt(e.target.value) || 1)}
              className="w-full px-2.5 py-1.5 bg-white rounded-lg border border-black/[0.1] text-xs outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#86868b] block mb-1">Largura (L)</label>
            <input
              type="number"
              min="1"
              value={sheet.packageWidthCm.value || ''}
              onChange={(e) => updateField('packageWidthCm', parseInt(e.target.value) || 1)}
              className="w-full px-2.5 py-1.5 bg-white rounded-lg border border-black/[0.1] text-xs outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#86868b] block mb-1">Compr. (C)</label>
            <input
              type="number"
              min="1"
              value={sheet.packageLengthCm.value || ''}
              onChange={(e) => updateField('packageLengthCm', parseInt(e.target.value) || 1)}
              className="w-full px-2.5 py-1.5 bg-white rounded-lg border border-black/[0.1] text-xs outline-none"
            />
          </div>
        </div>
      </div>

      {/* 8. Garantia do Vendedor */}
      <div className="apple-glass-card rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-[#1d1d1f]">Garantia do Vendedor</label>
          {renderStatusBadge('warrantyDays', sheet.warrantyDays)}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[30, 90, 180, 365].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => updateField('warrantyDays', days, 'approved')}
              className={`py-1.5 text-xs font-medium rounded-lg border transition-all apple-press-spring ${
                sheet.warrantyDays.value === days
                  ? 'bg-[#0071e3] text-white border-[#0071e3]'
                  : 'bg-white text-[#1d1d1f] border-black/[0.08] hover:border-black/[0.2]'
              }`}
            >
              {days} dias
            </button>
          ))}
        </div>
        {renderEvidenceSnippet('warrantyDays', sheet.warrantyDays)}
      </div>

      {/* 9. Botões de Navegação */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onPrev}
          className="w-1/3 py-3 px-3 rounded-xl text-xs font-semibold bg-black/5 hover:bg-black/10 text-[#1d1d1f] apple-press-spring flex items-center justify-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar</span>
        </button>

        <button
          type="button"
          onClick={onNext}
          className="flex-1 py-3 px-4 rounded-xl text-xs font-semibold bg-[#0071e3] hover:bg-[#0077ed] text-white apple-press-spring flex items-center justify-center gap-2 shadow-sm"
        >
          <span>Ir para Precificação</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
