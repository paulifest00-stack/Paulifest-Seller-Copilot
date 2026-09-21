import React, { useState, useEffect } from 'react';
import {
  Camera,
  Barcode,
  DollarSign,
  Tag,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowRight,
  Sparkles,
  Search,
  Key,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ShieldCheck
} from 'lucide-react';
import type { CentralProductSheet } from '../../../core/schema/product.ts';
import { createAuditedField } from '../../../core/schema/product.ts';
import { validateEan } from '../../../core/engines/identification/ean-validator.ts';
import {
  runProductIdentification,
  type IdentificationSummary
} from '../../../core/engines/identification/product-identifier.ts';
import {
  GeminiAIProvider,
  MockAIProvider
} from '../../../core/services/ai-provider.service.ts';
import {
  loadSellerPreferences,
  saveSellerPreferences
} from '../../../core/storage/storage.ts';

interface StepInputProps {
  sheet: CentralProductSheet;
  onUpdateSheet: (updater: (prev: CentralProductSheet) => CentralProductSheet) => void;
  onNext: () => void;
}

export const StepInput: React.FC<StepInputProps> = ({ sheet, onUpdateSheet, onNext }) => {
  const [eanValidation, setEanValidation] = useState(validateEan(sheet.ean.value));
  const [rawName, setRawName] = useState<string>(sheet.title.value || '');
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    sheet.images.length > 0 ? sheet.images[0].url : null
  );

  // Estados de IA e Identificação
  const [isIdentifying, setIsIdentifying] = useState<boolean>(false);
  const [identStep, setIdentStep] = useState<number>(0);
  const [identSummary, setIdentSummary] = useState<IdentificationSummary | null>(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [savedApiKey, setSavedApiKey] = useState<string>('');
  const [useDemoMode, setUseDemoMode] = useState<boolean>(false);
  const [identError, setIdentError] = useState<string | null>(null);
  const [showSummaryDetails, setShowSummaryDetails] = useState<boolean>(true);

  // Carrega chave Gemini do storage se existir
  useEffect(() => {
    loadSellerPreferences().then((prefs) => {
      if (prefs.geminiApiKey) {
        setSavedApiKey(prefs.geminiApiKey);
        setApiKeyInput(prefs.geminiApiKey);
        setUseDemoMode(false);
      } else {
        setUseDemoMode(true);
      }
    });
  }, []);

  const handleEanChange = (val: string) => {
    const clean = val.replace(/\D/g, '');
    const validation = validateEan(clean);
    setEanValidation(validation);

    if (!clean) {
      onUpdateSheet((prev) => ({
        ...prev,
        ean: createAuditedField('', 'user_manual', 0.0, 'missing')
      }));
    } else {
      onUpdateSheet((prev) => ({
        ...prev,
        ean: createAuditedField(
          clean,
          'user_manual',
          validation.valid ? 1.0 : 0.2,
          validation.valid ? 'approved' : 'conflict'
        )
      }));
    }
  };

  const handleCostChange = (val: string) => {
    const parsed = parseFloat(val.replace(',', '.')) || 0;
    onUpdateSheet((prev) => ({
      ...prev,
      costPrice: createAuditedField(parsed, 'user_manual', 1.0, parsed > 0 ? 'approved' : 'missing')
    }));
  };

  const handleSkuChange = (val: string) => {
    onUpdateSheet((prev) => ({
      ...prev,
      sku: createAuditedField(val.trim(), 'user_manual', 1.0, val.trim() ? 'approved' : 'missing')
    }));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        setPhotoPreview(url);
        onUpdateSheet((prev) => ({
          ...prev,
          images: [
            {
              id: `img_${Date.now()}`,
              url,
              isMain: true,
              status: createAuditedField('approved', 'user_manual', 1.0, 'approved')
            }
          ]
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    onUpdateSheet((prev) => ({
      ...prev,
      images: []
    }));
  };

  const handleSaveApiKey = () => {
    const cleanKey = apiKeyInput.trim();
    saveSellerPreferences({ geminiApiKey: cleanKey });
    setSavedApiKey(cleanKey);
    if (cleanKey) {
      setUseDemoMode(false);
    }
    setShowApiKeyModal(false);
    setIdentError(null);
  };

  // Disparo da Identificação Inteligente com IA & Pesquisa Confiável
  const handleRunIdentification = async () => {
    setIdentError(null);

    if (!useDemoMode && !savedApiKey) {
      setShowApiKeyModal(true);
      return;
    }

    setIsIdentifying(true);
    setIdentStep(1);

    const provider = useDemoMode
      ? new MockAIProvider()
      : new GeminiAIProvider(savedApiKey);

    try {
      // Feedback visual fluído das etapas do pipeline
      const timer1 = setTimeout(() => setIdentStep(2), 500);
      const timer2 = setTimeout(() => setIdentStep(3), 1100);

      const result = await runProductIdentification(
        {
          imageBase64: photoPreview || undefined,
          ean: sheet.ean.value || undefined,
          rawName: rawName || undefined
        },
        sheet,
        provider
      );

      clearTimeout(timer1);
      clearTimeout(timer2);
      setIdentStep(4);

      // Atualiza a Ficha Central no estado global
      onUpdateSheet(() => result.sheet);
      setIdentSummary(result.summary);
      setIsIdentifying(false);
    } catch (err: any) {
      console.error('Erro na identificação do produto:', err);
      setIdentError(err?.message || 'Falha ao comunicar com o provedor de IA.');
      setIsIdentifying(false);
    }
  };

  const hasAnyInput = Boolean(photoPreview || sheet.ean.value || rawName.trim());
  const isFormReady = sheet.costPrice.value !== null && sheet.costPrice.status !== 'missing';

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Seletor Transparente de Modo de IA */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-[#86868b] flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-[#0071e3]" />
          <span>Visão & Fato Auditável</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUseDemoMode(!useDemoMode)}
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-all ${
              useDemoMode
                ? 'bg-amber-100 text-amber-800 border border-amber-300/60'
                : 'bg-blue-50 text-blue-700 border border-blue-200/60'
            }`}
          >
            {useDemoMode ? 'Modo Demonstração' : 'Gemini 2.0 Flash'}
          </button>
          <button
            type="button"
            onClick={() => setShowApiKeyModal(!showApiKeyModal)}
            className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-1 font-medium"
          >
            <Key className="w-2.5 h-2.5" />
            <span>{savedApiKey ? 'Chave Salva' : 'Configurar'}</span>
          </button>
        </div>
      </div>

      {/* Banner de Alerta Transparente quando em Modo Demonstração */}
      {useDemoMode && (
        <div className="p-2.5 bg-amber-50/80 border border-amber-200/70 rounded-xl text-[11px] text-amber-800 space-y-1">
          <div className="flex items-center gap-1 font-semibold">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
            <span>Modo Demonstração Ativo (Offline/Simulado)</span>
          </div>
          <p className="text-[10px] text-amber-700 leading-tight">
            Utilizando catálogo de dados controlados com fontes rastreáveis. Para executar visão e OCR reais com sua própria chave, desative a demonstração.
          </p>
        </div>
      )}

      {/* Erro de Identificação (caso ocorra) */}
      {identError && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-700 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Erro na Identificação</span>
            <span className="text-[10px]">{identError}</span>
          </div>
        </div>
      )}

      {/* Modal/Gaveta para Inserir Chave Gemini */}
      {showApiKeyModal && (
        <div className="apple-glass-card rounded-2xl p-3 space-y-2 border border-[#0071e3]/30 animate-fade-in">
          <div className="flex items-center justify-between text-xs font-semibold text-[#1d1d1f]">
            <span>Chave de API do Google Gemini</span>
            <button onClick={() => setShowApiKeyModal(false)} className="text-[#86868b] hover:text-black">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-[#86868b]">
            Insira sua chave do Google AI Studio para usar visão real e Fact-or-Omit em nuvem. A chave é armazenada localmente neste navegador via chrome.storage.local.
          </p>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              className="flex-1 px-2.5 py-1.5 bg-white rounded-lg border text-xs font-mono outline-none"
            />
            <button
              onClick={handleSaveApiKey}
              className="px-3 py-1.5 bg-[#0071e3] text-white text-xs font-semibold rounded-lg apple-press-spring"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {/* 1. Upload de Foto do Produto */}
      <div className="apple-glass-card rounded-2xl p-4 space-y-2.5">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
          <Camera className="w-3.5 h-3.5 text-[#0071e3]" />
          <span>Foto do Produto ou Embalagem</span>
        </label>

        {photoPreview ? (
          <div className="relative w-full h-36 rounded-xl overflow-hidden bg-white border border-black/[0.06] flex items-center justify-center group">
            <img src={photoPreview} alt="Preview" className="w-full h-full object-contain p-2" />
            <button
              onClick={handleRemovePhoto}
              className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors shadow-sm"
              title="Remover foto"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <label className="w-full h-28 border border-dashed border-black/[0.12] hover:border-[#0071e3] rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer bg-white/50 hover:bg-blue-50/20 transition-all text-[#86868b] hover:text-[#0071e3]">
            <Camera className="w-6 h-6 stroke-[1.5]" />
            <span className="text-xs font-medium">Clique para selecionar foto</span>
            <span className="text-[10px] opacity-75">PNG, JPG ou WEBP</span>
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </label>
        )}
      </div>

      {/* 2. Nome Básico ou Palavras-chave (Opcional) */}
      <div className="apple-glass-card rounded-2xl p-3.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <Search className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Nome ou Descrição Rápida</span>
          </label>
          <span className="text-[10px] text-[#86868b]">Opcional</span>
        </div>
        <input
          type="text"
          value={rawName}
          onChange={(e) => {
            setRawName(e.target.value);
            onUpdateSheet((prev) => ({
              ...prev,
              title: prev.title.status === 'edited' || prev.title.status === 'approved'
                ? prev.title
                : createAuditedField(e.target.value, 'user_manual', 0.5, 'pending_review')
            }));
          }}
          placeholder="Ex: Furadeira Bosch 750W ou Coca-Cola 2L"
          className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-xs outline-none"
        />
      </div>

      {/* 3. Código EAN / GTIN com Validação em Tempo Real */}
      <div className="apple-glass-card rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <Barcode className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Código de Barras (EAN / GTIN)</span>
          </label>
          <span className="text-[10px] font-medium text-[#86868b]">Opcional</span>
        </div>

        <div className="space-y-1.5">
          <input
            type="text"
            inputMode="numeric"
            maxLength={14}
            value={sheet.ean.value}
            onChange={(e) => handleEanChange(e.target.value)}
            placeholder="Ex: 7894900011517 (ou deixe vazio se não tiver)"
            className={`w-full px-3 py-2 bg-white rounded-xl border text-xs font-mono transition-all outline-none ${
              sheet.ean.value
                ? eanValidation.valid
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                  : 'border-rose-400 ring-2 ring-rose-400/20'
                : 'border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20'
            }`}
          />

          {/* Feedback de Validação Visual */}
          {sheet.ean.value ? (
            <div
              className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg ${
                eanValidation.valid
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                  : 'bg-rose-50 text-rose-700 border border-rose-200/60'
              }`}
            >
              {eanValidation.valid ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
              )}
              <span>{eanValidation.message}</span>
            </div>
          ) : (
            <p className="text-[10px] text-[#86868b]">
              Deixe em branco caso o produto não possua código de barras (marcado como "Sem GTIN").
            </p>
          )}
        </div>
      </div>

      {/* Botão Primário de Identificação Automática com IA */}
      <div>
        <button
          type="button"
          onClick={handleRunIdentification}
          disabled={!hasAnyInput || isIdentifying}
          className={`w-full py-3 px-4 rounded-xl text-xs font-semibold apple-press-spring flex items-center justify-center gap-2 shadow-sm transition-all ${
            hasAnyInput && !isIdentifying
              ? 'bg-gradient-to-r from-[#0071e3] to-[#4393e6] hover:brightness-105 text-white shadow-blue-500/20'
              : 'bg-black/10 text-black/40 cursor-not-allowed'
          }`}
        >
          <Sparkles className={`w-4 h-4 ${isIdentifying ? 'animate-spin' : ''}`} />
          <span>{isIdentifying ? 'Identificando Produto...' : 'Identificar Produto com IA'}</span>
        </button>
      </div>

      {/* Progresso Dinâmico da Identificação */}
      {isIdentifying && (
        <div className="apple-glass-card rounded-2xl p-4 space-y-2.5 animate-scale-in border border-[#0071e3]/30">
          <div className="flex items-center justify-between text-xs font-semibold text-[#1d1d1f]">
            <span>Processando Identificação</span>
            <span className="text-[#0071e3] font-mono">{identStep}/4</span>
          </div>

          <div className="w-full h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0071e3] transition-all duration-500 rounded-full"
              style={{ width: `${identStep * 25}%` }}
            />
          </div>

          <div className="text-[11px] text-[#86868b] space-y-1 pt-1">
            <div className={`flex items-center gap-1.5 ${identStep >= 1 ? 'text-[#0071e3] font-medium' : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${identStep >= 1 ? 'bg-[#0071e3]' : 'bg-black/20'}`} />
              <span>1. Analisando foto e OCR da embalagem...</span>
            </div>
            <div className={`flex items-center gap-1.5 ${identStep >= 2 ? 'text-[#0071e3] font-medium' : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${identStep >= 2 ? 'bg-[#0071e3]' : 'bg-black/20'}`} />
              <span>2. Extraindo atributos visíveis (Regra Fact-or-Omit)...</span>
            </div>
            <div className={`flex items-center gap-1.5 ${identStep >= 3 ? 'text-[#0071e3] font-medium' : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${identStep >= 3 ? 'bg-[#0071e3]' : 'bg-black/20'}`} />
              <span>3. Validando dados e registrando evidências...</span>
            </div>
            <div className={`flex items-center gap-1.5 ${identStep >= 4 ? 'text-emerald-600 font-medium' : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${identStep >= 4 ? 'bg-emerald-500' : 'bg-black/20'}`} />
              <span>4. Ficha estruturada com sucesso!</span>
            </div>
          </div>
        </div>
      )}

      {/* Card de Resumo do Produto Identificado */}
      {identSummary && !isIdentifying && (
        <div className="apple-glass-card rounded-2xl p-4 space-y-3 animate-scale-in border-l-4 border-l-[#0071e3]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider">
              Identificação Concluída
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/60">
              {identSummary.providerName}
            </span>
          </div>

          <div>
            <h4 className="text-xs font-bold text-[#1d1d1f] leading-snug">
              {identSummary.productSummary}
            </h4>
            <p className="text-[10px] text-[#86868b] mt-0.5">
              Atributos extraídos com base em evidências verificáveis.
            </p>
          </div>

          {/* Discriminação de Proveniências */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="p-2 rounded-xl bg-emerald-50/70 border border-emerald-200/50 flex items-center justify-between text-emerald-800">
              <span>Lido da Imagem:</span>
              <span className="font-bold">{identSummary.readFromImageCount}</span>
            </div>
            <div className="p-2 rounded-xl bg-blue-50/70 border border-blue-200/50 flex items-center justify-between text-blue-800">
              <span>Catálogo / Regras:</span>
              <span className="font-bold">{identSummary.researchedCount}</span>
            </div>
            <div className={`p-2 rounded-xl border flex items-center justify-between ${
              identSummary.conflictCount > 0
                ? 'bg-rose-50 border-rose-200 text-rose-800 font-bold'
                : 'bg-black/[0.02] border-black/[0.04] text-[#86868b]'
            }`}>
              <span>Conflitos:</span>
              <span>{identSummary.conflictCount}</span>
            </div>
            <div className="p-2 rounded-xl bg-black/[0.02] border border-black/[0.04] flex items-center justify-between text-[#86868b]">
              <span>Não Encontrados:</span>
              <span className="font-bold">{identSummary.missingCount}</span>
            </div>
          </div>

          {identSummary.conflictCount > 0 && (
            <div className="flex items-center gap-1.5 p-2 bg-rose-50 border border-rose-200/70 rounded-xl text-[10px] text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-rose-500" />
              <span>Existem divergências entre fontes. Você poderá escolher a correta na Ficha.</span>
            </div>
          )}

          {/* Alerta de Variantes Divergentes Rejeitadas (Proteção de Identidade) */}
          {identSummary.rejectedVariantCount > 0 && (
            <div className="p-2.5 bg-amber-50/90 border border-amber-300/70 rounded-xl space-y-1 text-amber-900">
              <div className="flex items-center gap-1 text-[11px] font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                <span>{identSummary.rejectedVariantCount} fonte(s) rejeitada(s) por variante divergente</span>
              </div>
              <p className="text-[10px] text-amber-800 leading-tight">
                Fontes que correspondiam a modelos parecidos mas variantes distintas foram descartadas para evitar contaminação técnica da ficha.
              </p>
              {identSummary.rejectedVariantNotices.map((n, i) => (
                <div key={i} className="text-[9px] bg-white/70 p-1 rounded border border-amber-200/60 font-mono text-amber-950">
                  {n.sourceName}: {n.reason}
                </div>
              ))}
            </div>
          )}

          {/* Detalhes de Campos Omitidos (Fact-or-Omit) */}
          <div className="pt-1 border-t border-black/[0.04]">
            <button
              type="button"
              onClick={() => setShowSummaryDetails(!showSummaryDetails)}
              className="w-full flex items-center justify-between text-[10px] text-[#86868b] hover:text-[#1d1d1f]"
            >
              <span>Regra Fact-or-Omit: {identSummary.unsupportedFields.length} campos sem evidência omitidos</span>
              {showSummaryDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showSummaryDetails && identSummary.unsupportedFields.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1.5">
                {identSummary.unsupportedFields.map((field) => (
                  <span key={field} className="px-1.5 py-0.5 rounded bg-black/[0.04] text-[9px] text-[#86868b] font-mono">
                    {field}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. SKU e Custo de Aquisição (CMV) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="apple-glass-card rounded-2xl p-3.5 space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <Tag className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Código SKU</span>
          </label>
          <input
            type="text"
            value={sheet.sku.value}
            onChange={(e) => handleSkuChange(e.target.value)}
            placeholder="Ex: PLF-1029"
            className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-xs font-mono uppercase outline-none"
          />
        </div>

        <div className="apple-glass-card rounded-2xl p-3.5 space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
            <span>Custo (CMV) R$</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={sheet.costPrice.value ?? ''}
            onChange={(e) => handleCostChange(e.target.value)}
            placeholder="0,00"
            className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 text-xs font-semibold text-emerald-700 outline-none"
          />
        </div>
      </div>

      {/* 5. Botão de Avanço */}
      <div className="pt-2">
        <button
          onClick={onNext}
          disabled={!isFormReady}
          className={`w-full py-3 px-4 rounded-xl text-xs font-semibold apple-press-spring flex items-center justify-center gap-2 shadow-sm transition-all ${
            isFormReady
              ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
              : 'bg-black/10 text-black/40 cursor-not-allowed'
          }`}
        >
          <span>Avançar para Ficha do Produto</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        {!isFormReady && (
          <p className="text-center text-[10px] text-[#86868b] mt-1.5">
            Informe ao menos o Custo (CMV) para liberar o fluxo de precificação.
          </p>
        )}
      </div>
    </div>
  );
};
