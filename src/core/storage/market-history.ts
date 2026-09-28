import type { MarketItem, MarketSnapshot } from '../../integrations/mercadolivre/market.ts';
const KEY = 'paulifest_market_history_v1';
export interface MarketHistory { snapshots: MarketSnapshot[] }
export async function loadMarketHistory(): Promise<MarketHistory> {
  let data: MarketHistory | undefined;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) data = (await chrome.storage.local.get(KEY))[KEY];
  else { try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* empty history */ } }
  return data && Array.isArray(data.snapshots) ? data : { snapshots: [] };
}
let queue = Promise.resolve();
export function saveMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
  const result = queue.then(async () => {
    const history = await loadMarketHistory();
    const bounded = { ...snapshot, items: snapshot.items.slice(0, 100) };
    const data = { snapshots: [...history.snapshots, bounded].slice(-100) };
    if (typeof chrome !== 'undefined' && chrome.storage?.local) await chrome.storage.local.set({ [KEY]: data });
    else localStorage.setItem(KEY, JSON.stringify(data));
  });
  queue = result.catch(() => {}); return result;
}
export function priceHistory(history: MarketHistory, id: string): MarketItem[] {
  return history.snapshots.flatMap(s => s.items.filter(i => i.id === id && i.price !== null)).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}
