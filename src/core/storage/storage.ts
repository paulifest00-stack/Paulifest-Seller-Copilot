import type { CentralProductSheet } from '../schema/product.ts';
import { migrateSheetToV2, validateSheetV2 } from '../schema/migrations.ts';

const STORAGE_KEYS = {
  ACTIVE_SHEET: 'paulifest_active_product_sheet_v1',
  SELLER_PREFERENCES: 'paulifest_seller_prefs_v1'
} as const;

export interface SellerPreferences {
  defaultTaxRatePercent: number;
  defaultPackagingCost: number;
  defaultTargetMarginPercent: number;
  defaultListingType: 'gold_special' | 'gold_pro';
  geminiApiKey?: string;
}

export const DEFAULT_PREFERENCES: SellerPreferences = {
  defaultTaxRatePercent: 6.0,      // Padrão Simples Nacional
  defaultPackagingCost: 2.50,      // Embalagem média
  defaultTargetMarginPercent: 20.0, // 20% de margem líquida limpa
  defaultListingType: 'gold_special'
};

// Fallback em memória para testes e ambientes onde localStorage não está totalmente instanciado
const memoryStore = new Map<string, string>();

function setStorageItem(key: string, val: string) {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(key, val);
      return;
    }
  } catch {}
  memoryStore.set(key, val);
}

function getStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      return localStorage.getItem(key);
    }
  } catch {}
  return memoryStore.get(key) || null;
}

function removeStorageItem(key: string) {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
      localStorage.removeItem(key);
      return;
    }
  } catch {}
  memoryStore.delete(key);
}

const SHEET_STORAGE_PREFIX = 'paulifest_sheet_';

/**
 * Salva uma ficha de produto pelo seu próprio ID no storage permanente (chrome.storage.local).
 * Garante validação de integridade com Schema v2 antes da gravação.
 */
export async function saveSheet(sheet: CentralProductSheet): Promise<void> {
  const validation = validateSheetV2(sheet);
  if (!validation.isValid) {
    throw new Error(`Não é possível salvar ficha inválida no storage: ${validation.errors.join('; ')}`);
  }

  sheet.updatedAt = new Date().toISOString();
  const sheetKey = `${SHEET_STORAGE_PREFIX}${sheet.id}`;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ 
      [sheetKey]: sheet,
      [STORAGE_KEYS.ACTIVE_SHEET]: sheet 
    });
  } else {
    setStorageItem(sheetKey, JSON.stringify(sheet));
    setStorageItem(STORAGE_KEYS.ACTIVE_SHEET, JSON.stringify(sheet));
  }
}

/**
 * Carrega uma ficha de produto pelo seu ID a partir do storage permanente (chrome.storage.local).
 */
export async function loadSheet(sheetId: string): Promise<CentralProductSheet | null> {
  if (!sheetId || typeof sheetId !== 'string') return null;

  const sheetKey = `${SHEET_STORAGE_PREFIX}${sheetId}`;
  let raw: any = null;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(sheetKey);
    raw = res[sheetKey] || null;
  } else {
    const serialized = getStorageItem(sheetKey);
    raw = serialized ? JSON.parse(serialized) : null;
  }

  if (!raw) {
    const active = await loadActiveSheet();
    if (active && active.id === sheetId) {
      return active;
    }
    return null;
  }

  try {
    const migrated = migrateSheetToV2(raw);
    return migrated;
  } catch (err) {
    console.error(`Falha ao validar/migrar ficha ${sheetId} do storage:`, err);
    return null;
  }
}

/**
 * Salva a ficha de produto ativa no storage após validar conformidade com o Schema v2.
 * Mantido como camada de compatibilidade com a Fase 2/3.
 */
export async function saveActiveSheet(sheet: CentralProductSheet): Promise<void> {
  return saveSheet(sheet);
}

/**
 * Recupera a ficha de produto ativa do storage, aplicando migração segura e transparente (v1 -> v2)
 * se necessário. Se os dados armazenados estiverem corrompidos, o storage legado é preservado intacto.
 */
export async function loadActiveSheet(): Promise<CentralProductSheet | null> {
  let raw: any = null;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_SHEET);
    raw = res[STORAGE_KEYS.ACTIVE_SHEET] || null;
  } else {
    const serialized = getStorageItem(STORAGE_KEYS.ACTIVE_SHEET);
    raw = serialized ? JSON.parse(serialized) : null;
  }

  if (!raw) return null;

  try {
    const migrated = migrateSheetToV2(raw);
    return migrated;
  } catch (err) {
    console.error('Falha ao validar/migrar ficha legada do storage:', err);
    // Preserva o storage legado intacto caso a migração falhe
    return null;
  }
}

/**
 * Limpa a ficha de produto ativa (para reiniciar o cadastro).
 */
export async function clearActiveSheet(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.remove(STORAGE_KEYS.ACTIVE_SHEET);
  } else {
    removeStorageItem(STORAGE_KEYS.ACTIVE_SHEET);
  }
}

/**
 * Salva as preferências do vendedor.
 */
export async function saveSellerPreferences(prefs: Partial<SellerPreferences>): Promise<void> {
  const current = await loadSellerPreferences();
  const updated = { ...current, ...prefs };
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SELLER_PREFERENCES]: updated });
  } else {
    setStorageItem(STORAGE_KEYS.SELLER_PREFERENCES, JSON.stringify(updated));
  }
}

/**
 * Recupera as preferências do vendedor.
 */
export async function loadSellerPreferences(): Promise<SellerPreferences> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SELLER_PREFERENCES);
    return res[STORAGE_KEYS.SELLER_PREFERENCES] || DEFAULT_PREFERENCES;
  } else {
    const raw = getStorageItem(STORAGE_KEYS.SELLER_PREFERENCES);
    return raw ? JSON.parse(raw) : DEFAULT_PREFERENCES;
  }
}
