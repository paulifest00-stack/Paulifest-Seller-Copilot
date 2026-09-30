import type { CentralProductSheet } from '../schema/product.ts';
import { migrateSheetToV3, validateSheetV3 } from '../schema/migrations.ts';

const STORAGE_KEYS = {
  ACTIVE_SHEET: 'paulifest_active_product_sheet_v1',
  SELLER_PREFERENCES: 'paulifest_seller_prefs_v1'
} as const;

export interface SellerPreferences {
  defaultTaxRatePercent: number;
  defaultPackagingCost: number;
  defaultTargetMarginPercent: number;
  defaultListingType: 'gold_special' | 'gold_pro';
  packagingCostMigratedTo150?: boolean;
  geminiApiKey?: string;
}

export const DEFAULT_PREFERENCES: SellerPreferences = {
  defaultTaxRatePercent: 6.0,      // Padrão Simples Nacional
  defaultPackagingCost: 1.50,      // Embalagem padrão R$ 1,50
  defaultTargetMarginPercent: 20.0, // 20% de margem líquida limpa
  defaultListingType: 'gold_special',
  packagingCostMigratedTo150: true
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
 * Utilitário exclusivo para testes: injeta payload bruto no storage ativo (chrome.storage ou memoryStore).
 */
export async function _setRawStorageForTesting(key: string, val: any): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [key]: val });
  } else {
    setStorageItem(key, typeof val === 'string' ? val : JSON.stringify(val));
  }
}

/**
 * Utilitário exclusivo para testes: lê payload bruto do storage ativo (chrome.storage ou memoryStore).
 */
export async function _getRawStorageForTesting(key: string): Promise<any> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(key);
    return res[key] || null;
  }
  const item = getStorageItem(key);
  try {
    return item ? JSON.parse(item) : null;
  } catch {
    return item;
  }
}

const SHEET_STORAGE_PREFIX = 'paulifest_sheet_';

/**
 * Salva uma ficha de produto pelo seu próprio ID no storage permanente (chrome.storage.local).
 * Garante validação de integridade com Schema v3 antes da gravação.
 */
async function saveSheetUnlocked(sheet: CentralProductSheet, workspace?: ProductWorkspace): Promise<void> {
  const validation = validateSheetV3(sheet);
  if (!validation.isValid) {
    throw new Error(`Não é possível salvar ficha inválida no storage: ${validation.errors.join('; ')}`);
  }

  // Never mutate React state or an in-flight AI snapshot while persisting.
  sheet = { ...sheet, updatedAt: new Date().toISOString() };
  const sheetKey = `${SHEET_STORAGE_PREFIX}${sheet.id}`;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({
      [sheetKey]: sheet,
      [STORAGE_KEYS.ACTIVE_SHEET]: sheet,
      ...(workspace ? { [WORKSPACE_KEY]: workspace } : {})
    });
  } else {
    setStorageItem(sheetKey, JSON.stringify(sheet));
    setStorageItem(STORAGE_KEYS.ACTIVE_SHEET, JSON.stringify(sheet));
    if (workspace) setStorageItem(WORKSPACE_KEY, JSON.stringify(workspace));
  }
}

/**
 * Carrega uma ficha de produto pelo seu ID a partir do storage permanente (chrome.storage.local).
 * Aplica migração pura e determinística para Schema v3.
 * Preserva o dado persistido e propaga erro controlado se a migração falhar.
 */
async function loadSheetUnlocked(sheetId: string): Promise<CentralProductSheet | null> {
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
    try {
      const active = await loadActiveSheetUnlocked();
      if (active && active.id === sheetId) {
        return active;
      }
    } catch {
      // Se active sheet falhar ou não corresponder, não mascara ausência da chave
    }
    return null;
  }

  try {
    const migrated = migrateSheetToV3(raw);
    return migrated;
  } catch (err) {
    console.error(`Falha ao validar/migrar ficha ${sheetId} do storage:`, err);
    throw new Error(`Falha ao validar/migrar ficha ${sheetId} do storage: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Salva a ficha de produto ativa no storage após validar conformidade com o Schema v3.
 * Mantido como camada de compatibilidade com a Fase 2/3.
 */
export async function saveActiveSheet(sheet: CentralProductSheet): Promise<void> {
  return saveSheet(sheet);
}

/**
 * Recupera a ficha de produto ativa do storage, aplicando migração segura e transparente (v1/v2 -> v3)
 * se necessário. Se os dados armazenados estiverem corrompidos, o storage legado é preservado intacto
 * e um erro controlado é propagado, sem recriar silenciosamente uma ficha vazia por cima.
 */
async function loadActiveSheetUnlocked(): Promise<CentralProductSheet | null> {
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
    const migrated = migrateSheetToV3(raw);
    return migrated;
  } catch (err) {
    console.error('Falha ao validar/migrar ficha legada do storage:', err);
    // Preserva o storage legado intacto caso a migração falhe e propaga erro controlado
    throw new Error(`Falha ao validar/migrar ficha ativa do storage: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Limpa a ficha de produto ativa (para reiniciar o cadastro).
 */
async function clearActiveSheetUnlocked(): Promise<void> {
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
  let stored: SellerPreferences | null = null;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SELLER_PREFERENCES);
    stored = res[STORAGE_KEYS.SELLER_PREFERENCES] || null;
  } else {
    const raw = getStorageItem(STORAGE_KEYS.SELLER_PREFERENCES);
    stored = raw ? JSON.parse(raw) : null;
  }

  if (!stored) return { ...DEFAULT_PREFERENCES };

  if (!stored.packagingCostMigratedTo150 && stored.defaultPackagingCost === 2.5) {
    stored = {
      ...stored,
      defaultPackagingCost: 1.50,
      packagingCostMigratedTo150: true
    };
  }

  return { ...DEFAULT_PREFERENCES, ...stored };
}

// Web Locks coordinates the worker and Sidepanel for the same extension origin.
// The in-process fallback is for Node/unit tests without the browser LockManager.
let sheetTail: Promise<void> = Promise.resolve();
async function withSheetLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return await navigator.locks.request('paulifest:ssot', operation);
  }
  const result = sheetTail.then(operation);
  sheetTail = result.then(() => {}, () => {});
  return result;
}
export function saveSheet(sheet: CentralProductSheet): Promise<void> {
  return withSheetLock(() => saveSheetUnlocked(sheet));
}
export function loadSheet(sheetId: string): Promise<CentralProductSheet | null> {
  return withSheetLock(() => loadSheetUnlocked(sheetId));
}
export function loadActiveSheet(): Promise<CentralProductSheet | null> {
  return withSheetLock(loadActiveSheetUnlocked);
}
export function clearActiveSheet(): Promise<void> {
  return withSheetLock(clearActiveSheetUnlocked);
}

/** Saved drafts are independent of browser tabs and survive exports/navigation. */
export function listSavedSheets(): Promise<CentralProductSheet[]> {
  return withSheetLock(async () => {
    const entries: Record<string, unknown> = {};
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      Object.assign(entries, await chrome.storage.local.get(null));
    } else {
      try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.length === 'number') {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(SHEET_STORAGE_PREFIX)) entries[key] = localStorage.getItem(key);
          }
        }
      } catch {}
      for (const [key, value] of memoryStore) {
        if (key.startsWith(SHEET_STORAGE_PREFIX)) entries[key] = value;
      }
    }
    const sheets = new Map<string, CentralProductSheet>();
    for (const [key, raw] of Object.entries(entries)) {
      if (!key.startsWith(SHEET_STORAGE_PREFIX) && key !== STORAGE_KEYS.ACTIVE_SHEET) continue;
      try {
        const sheet = migrateSheetToV3(typeof raw === 'string' ? JSON.parse(raw) : raw);
        sheets.set(sheet.id, sheet);
      } catch { /* Preserve unreadable records; never delete them. */ }
    }
    return [...sheets.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

const WORKSPACE_KEY = 'paulifest_workspace_v1';
export interface ProductWorkspace { sheetId: string; step: number }
export async function saveWorkspace(workspace: ProductWorkspace): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [WORKSPACE_KEY]: workspace });
  } else setStorageItem(WORKSPACE_KEY, JSON.stringify(workspace));
}
export async function loadWorkspace(): Promise<ProductWorkspace | null> {
  const raw = typeof chrome !== 'undefined' && chrome.storage?.local
    ? (await chrome.storage.local.get(WORKSPACE_KEY))[WORKSPACE_KEY]
    : JSON.parse(getStorageItem(WORKSPACE_KEY) || 'null');
  return raw && typeof raw.sheetId === 'string' ? { sheetId: raw.sheetId, step: Math.min(8, Math.max(1, Number(raw.step) || 1)) } : null;
}

export function deleteSheet(sheetId: string): Promise<void> {
  return withSheetLock(async () => {
    if (!sheetId || typeof sheetId !== 'string') return;
    const sheetKey = `${SHEET_STORAGE_PREFIX}${sheetId}`;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const current = await chrome.storage.local.get(null);
      const keysToRemove = [sheetKey];
      const activeRaw = current[STORAGE_KEYS.ACTIVE_SHEET];
      const activeObj = typeof activeRaw === 'string' ? JSON.parse(activeRaw || 'null') : activeRaw;
      if (activeObj && activeObj.id === sheetId) keysToRemove.push(STORAGE_KEYS.ACTIVE_SHEET);
      const wsRaw = current[WORKSPACE_KEY];
      const wsObj = typeof wsRaw === 'string' ? JSON.parse(wsRaw || 'null') : wsRaw;
      if (wsObj && wsObj.sheetId === sheetId) keysToRemove.push(WORKSPACE_KEY);
      for (const k of keysToRemove) await chrome.storage.local.remove(k);
    } else {
      removeStorageItem(sheetKey);
      memoryStore.delete(sheetKey);
      try {
        const active = JSON.parse(getStorageItem(STORAGE_KEYS.ACTIVE_SHEET) || 'null');
        if (active && active.id === sheetId) {
          removeStorageItem(STORAGE_KEYS.ACTIVE_SHEET);
          memoryStore.delete(STORAGE_KEYS.ACTIVE_SHEET);
        }
      } catch {}
      try {
        const ws = JSON.parse(getStorageItem(WORKSPACE_KEY) || 'null');
        if (ws && ws.sheetId === sheetId) {
          removeStorageItem(WORKSPACE_KEY);
          memoryStore.delete(WORKSPACE_KEY);
        }
      } catch {}
    }
  });
}

export function clearAllSavedSheets(): Promise<void> {
  return withSheetLock(async () => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter(k => k.startsWith(SHEET_STORAGE_PREFIX) || k === STORAGE_KEYS.ACTIVE_SHEET || k === WORKSPACE_KEY);
      for (const k of keys) await chrome.storage.local.remove(k);
    } else {
      try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.length === 'number') {
          const keys: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith(SHEET_STORAGE_PREFIX) || k === STORAGE_KEYS.ACTIVE_SHEET || k === WORKSPACE_KEY)) keys.push(k);
          }
          for (const k of keys) removeStorageItem(k);
        }
      } catch {}
      for (const k of [...memoryStore.keys()]) {
        if (k.startsWith(SHEET_STORAGE_PREFIX) || k === STORAGE_KEYS.ACTIVE_SHEET || k === WORKSPACE_KEY) memoryStore.delete(k);
      }
    }
  });
}

/** Compensated import: readers/writers cannot observe or overwrite a tentative sheet.
 * Context/auth invalidation is deliberately NOT locked. Any failure before publish
 * restores both the sheet and the previous active-sheet pointer before releasing.
 */
export function commitImportedSheet(
  sheet: CentralProductSheet, assertCurrent: () => unknown, publish: () => Promise<void>,
  expectedBase?: CentralProductSheet, workspace?: ProductWorkspace
): Promise<void> {
  return withSheetLock(async () => {
    assertCurrent();
    const keys = [SHEET_STORAGE_PREFIX + sheet.id, STORAGE_KEYS.ACTIVE_SHEET];
    if (workspace) keys.push(WORKSPACE_KEY);
    const before = new Map<string, any>();
    for (const key of keys) {
      const raw = typeof chrome !== 'undefined' && chrome.storage?.local
        ? (await chrome.storage.local.get(key))[key] : getStorageItem(key);
      before.set(key, raw == null ? undefined : structuredClone(raw));
      assertCurrent();
    }
    if (expectedBase) {
      const stored = before.get(keys[0]) ?? before.get(keys[1]);
      const current = stored === undefined ? null : migrateSheetToV3(typeof stored === 'string' ? JSON.parse(stored) : stored);
      if (JSON.stringify(current) !== JSON.stringify(expectedBase)) {
        throw new Error('Importação descartada: ficha editada durante a operação.');
      }
    }
    try {
      assertCurrent();
      await saveSheetUnlocked(sheet, workspace);
      assertCurrent();
      await publish();
    } catch (error) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          const restore = Object.fromEntries([...before].filter(([, value]) => value !== undefined));
          if (Object.keys(restore).length) await chrome.storage.local.set(restore);
          for (const [key, value] of before) if (value === undefined) await chrome.storage.local.remove(key);
        } else {
          for (const [key, value] of before) {
            if (value === undefined) removeStorageItem(key); else setStorageItem(key, value);
          }
        }
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Falha de importação e de restauração do storage.');
      }
      throw error;
    }
  });
}
