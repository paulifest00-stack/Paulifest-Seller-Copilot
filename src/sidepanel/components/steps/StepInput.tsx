import { resolveImageAsset } from '../../../core/storage/image-assets.ts';
import { parseApiKeys } from '../../../core/services/key-manager.ts';
import { SkuEditor } from '../SkuEditor.tsx';
import { generateSkuFromTitle } from '../../../core/engines/identification/sku-generator.ts';
import { limitMlTitle } from '../../../core/services/gemini-client.ts';
import { assignGeneratedEan, isGeneratedEan } from '../../../core/engines/identification/ean-generator.ts';
import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Barcode,
  DollarSign,
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
  const liveSheet = useRef(sheet);
  liveSheet.current = sheet;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const eanValidation = validateEan(sheet.ean.value);
  const [rawName, setRawName] = useState<string>((sheet.titleBling?.value || sheet.title.value || '').toUpperCase());
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    sheet.images[0]?.url.startsWith('data:') ? sheet.images[0].url : null
  );

  useEffect(() => { let active = true; const url = sheet.images[0]?.url; if (!url) { setPhotoPreview(null); return; } void resolveImageAsset(url).then(value => { if (active) setPhotoPreview(value); }).catch(() => { if (active) setPhotoPreview(null); }); return () => { active = false; }; }, [sheet.images[0]?.url]);

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

  useEffect(() => { setRawName((sheet.titleBling?.value || sheet.title.value || '').toUpperCase()); }, [sheet.titleBling?.value, sheet.title.value]);

  // Carrega chave Gemini do storage se existir
  useEffect(() => {
    loadSellerPreferences().then((prefs) => {
      if (prefs.geminiApiKey) {
        setSavedApiKey(prefs.geminiApiKey);
        setApiKeyInput(prefs.geminiApiKey);
        setUseDemoMode(false);
      } else {
        setUseDemoMode(false);
      }
    });
  }, []);

  const handleEanChange = (val: string) => {
    const clean = val.replace(/\D/g, '');
    const validation = validateEan(clean);

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

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        if (!mounted.current || liveSheet.current.id !== sheet.id) return;
        setPhotoPreview(url);
        onUpdateSheet((prev) => ({
          ...prev,
          images: [
            {
              id: `img_${Date.now()}`,
              url,
              isMain: true,
              status: createAuditedField('approved', 'user_manual', 1.0, 'approved')
            },
            ...prev.images.map(image => ({ ...image, isMain: false }))
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
      images: prev.images.filter(image => image.id !== sheet.images[0]?.id).map((image, index) => ({ ...image, isMain: index === 0 }))
    }));
  };

  const handleSaveApiKey = async () => {
    const cleanKey = apiKeyInput.trim();
    try { parseApiKeys(cleanKey); await saveSellerPreferences({ geminiApiKey: cleanKey }); }
    catch { setIdentError("Não foi possível salvar a chave neste navegador. Tente novamente."); return; }
    setSavedApiKey(cleanKey);
    setUseDemoMode(false);
    setShowApiKeyModal(false);
    setIdentError(null);
  };

  // Disparo da Identificação Inteligente com IA & Pesquisa Confiável
  const handleRunIdentification = async () => {
    setIdentError(null);
    if (photoPreview && !photoPreview.startsWith('data:') && !rawName.trim()) { setIdentError('Informe o nome ou envie uma foto para identificar este produto.'); return; }

    if (!useDemoMode && !savedApiKey) {
      setShowApiKeyModal(true);
      return;
    }

    const snapshot = structuredClone(sheet);
    setIsIdentifying(true);
    setIdentStep(1);

    const provider = useDemoMode
      ? new MockAIProvider()
      : new GeminiAIProvider(savedApiKey);

    let timer1: ReturnType<typeof setTimeout> | undefined;
    let timer2: ReturnType<typeof setTimeout> | undefined;
    try {
      // Feedback visual fluído das etapas do pipeline
      timer1 = setTimeout(() => setIdentStep(2), 500);
      timer2 = setTimeout(() => setIdentStep(3), 1100);

      const result = await runProductIdentification(
        {
          imageBase64: photoPreview?.startsWith('data:') ? photoPreview : undefined,
          ean: isGeneratedEan(sheet.ean) ? undefined : sheet.ean.value || undefined,
          rawName: rawName || undefined
        },
        snapshot,
        provider
      );

      clearTimeout(timer1);
      clearTimeout(timer2);
      setIdentStep(4);

      // Atualiza a Ficha Central no estado global
      if (JSON.stringify(liveSheet.current) !== JSON.stringify(snapshot)) throw new Error('A ficha foi editada durante a identificação. Seus dados foram preservados. Identifique novamente.');
      if (!result.sheet.title.value && !result.sheet.titleBling?.value) throw new Error('A IA não conseguiu extrair um nome. Envie uma foto mais nítida ou informe o nome do produto.');
      onUpdateSheet(prev => prev.id === snapshot.id && JSON.stringify(prev) === JSON.stringify(snapshot) ? result.sheet : prev);
      if (!mounted.current) return;
      setRawName(result.sheet.titleBling?.value || result.sheet.title.value);
      onNext();
      setIdentSummary(result.summary);
      setIsIdentifying(false);
    } catch (err: any) {
      console.error('Erro na identificação do produto:', err);
      if (!mounted.current) return;
      setIdentError(err?.message || 'Falha ao comunicar com o provedor de IA.');
      setIsIdentifying(false);
    } finally { clearTimeout(timer1); clearTimeout(timer2); }
  };

  const hasAnyInput = Boolean(photoPreview || sheet.ean.value || rawName.trim());

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Seletor Transparente de Modo de IA */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-[#86868b] flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-[#0071e3]" />
          <span>Identificar produto</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{savedApiKey ? 'IA configurada' : 'IA opcional'}</span>
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
            Dados de demonstração. Configure a chave para usar IA real.
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
            Até 5 chaves próprias do Google AI Studio, separadas por vírgula. Salvas somente neste navegador; fallback automático em indisponibilidade.
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

      {photoPreview && !photoPreview.startsWith('data:') && <p className="text-xs text-slate-600">A identificação usará o nome informado. Para analisar a imagem importada, envie a foto pelo seletor.</p>}
      {/* 2. Nome Básico ou Palavras-chave (Opcional) */}
      <div className="apple-glass-card rounded-2xl p-3.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <Search className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Nome do produto</span>
          </label>
          <span className="text-[10px] text-[#86868b]">Ou envie uma foto</span>
        </div>
        <input
          type="text"
          aria-label="Nome do produto"
          value={rawName}
          onChange={(e) => {
            const name = e.target.value.toUpperCase();
            setRawName(name);
            onUpdateSheet(prev => ({ ...prev, titleBling: createAuditedField(name, 'user_manual', 1, name.trim() ? 'edited' : 'missing') }));
          }}
          placeholder="Ex: LUVA NITRILICA BOMPACK PRETA 100UN"
          className="w-full px-3 py-2 bg-white rounded-xl border border-black/[0.1] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/20 text-xs outline-none"
        />
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
          <span>{isIdentifying ? 'Identificando produto…' : savedApiKey ? 'Identificar e continuar com IA' : 'Configurar IA para identificar'}</span>
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

      <details className="rounded-xl border bg-white p-3 text-xs space-y-3"><summary className="cursor-pointer text-slate-600 font-medium">Código de barras, SKU e custo (opcional)</summary>      {/* 3. Código EAN / GTIN com Validação em Tempo Real */}
      <div className="apple-glass-card rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1d1d1f]">
            <Barcode className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>Código de Barras (EAN / GTIN)</span>
          </label>
          <button type="button" disabled={Boolean(sheet.ean.value.trim())}
            onClick={() => onUpdateSheet(prev => assignGeneratedEan(prev))}
            className="text-[11px] font-semibold text-[#0071e3] disabled:opacity-40"
            title="Cria um número aleatório com dígito verificador; não substitui código existente">
            Gerar EAN-13
          </button>
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
              <span>{isGeneratedEan(sheet.ean) ? 'EAN-13 gerado · dígito verificador correto · uso interno' : eanValidation.message}</span>
            </div>
          ) : (
            <p className="text-[10px] text-[#86868b]">

            </p>
          )}
        </div>
      </div>

      {isGeneratedEan(sheet.ean) && (
        <p className="text-[10px] text-[#6e6e73] px-2">
          Código EAN-13 de circulação interna (prefixo 20) pronto para uso na ficha e no Bling.
        </p>
      )}

      {/* 4. SKU e Custo de Aquisição (CMV — usado na precificação) */}
      <div className="grid grid-cols-2 gap-3">
        <SkuEditor sheet={sheet} onUpdateSheet={onUpdateSheet} />

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

</details>
      {!rawName.trim() && <p className="text-xs text-slate-500">Para continuar sem IA, digite o nome do produto.</p>}
      {/* 5. Botão de Avanço */}
      <div className="pt-2">
        <button
          disabled={isIdentifying || !rawName.trim()}
          onClick={() => {
            if (rawName.trim()) {
              onUpdateSheet(prev => {
                const cleanName = rawName.trim().toUpperCase();
                const autoSku = !prev.sku.value.trim()
                  ? generateSkuFromTitle(cleanName, prev.brand.value)
                  : prev.sku.value;
                return {
                  ...prev,
                  title: prev.title.value ? prev.title : createAuditedField(limitMlTitle(rawName), 'user_manual', 1, 'approved'),
                  titleBling: prev.titleBling?.value ? prev.titleBling : createAuditedField(cleanName, 'user_manual', 1, 'approved'),
                  sku: !prev.sku.value.trim() && autoSku
                    ? createAuditedField(autoSku, 'rule_engine', 1, 'approved')
                    : prev.sku
                };
              });
            }
            onNext();
          }}
          className="w-full py-3 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-white border border-slate-300 text-blue-700 disabled:opacity-40 apple-press-spring"
        >
          <span>Continuar com preenchimento manual</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
