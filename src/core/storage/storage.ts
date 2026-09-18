// Camada de Persistência Local Tipada com suporte a chrome.storage.local e fallback robusto
import type { CentralProductSheet } from '../schema/product.ts';

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

/**
 * Salva a ficha de produto ativa no storage.
 */
export async function saveActiveSheet(sheet: CentralProductSheet): Promise<void> {
  sheet.updatedAt = new Date().toISOString();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SHEET]: sheet });
  } else {
    setStorageItem(STORAGE_KEYS.ACTIVE_SHEET, JSON.stringify(sheet));
  }
}

/**
 * Recupera a ficha de produto ativa do storage.
 */
export async function loadActiveSheet(): Promise<CentralProductSheet | null> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_SHEET);
    return res[STORAGE_KEYS.ACTIVE_SHEET] || null;
  } else {
    const raw = getStorageItem(STORAGE_KEYS.ACTIVE_SHEET);
    return raw ? JSON.parse(raw) : null;
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
