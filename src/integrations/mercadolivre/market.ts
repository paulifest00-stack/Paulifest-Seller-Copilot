export interface MarketItem {
  id: string; url: string; title: string; price: number | null; currency: 'BRL';
  seller: string | null; soldLabel: string | null; shippingLabel: string | null;
  sponsored: boolean; position: number; capturedAt: string;
}
export interface MarketSnapshot { url: string; capturedAt: string; kind: 'search' | 'product' | 'unknown'; items: MarketItem[] }
export function isMlHost(host: string): boolean { return host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br'); }
export function parseBrlPrice(value: string): number | null {
  const clean = value.replace(/R\$|\s/g, '').trim();
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(clean)) return null;
  const number = Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function normalizeMarketUrl(value: string, base: string): { id: string; url: string } | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || !isMlHost(url.hostname) || url.username || url.password) return null;
    const match = url.pathname.match(/\b(MLB)-?(\d{6,})\b/i);
    if (!match) return null;
    url.hash = ''; url.search = '';
    return { id: match[1].toUpperCase() + match[2], url: url.href };
  } catch { return null; }
}

export function marketSummary(items: MarketItem[]) {
  const prices = items.map(i => i.price).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  return { count: items.length, priced: prices.length,
    min: prices.length ? prices[0] : null, max: prices.length ? prices[prices.length - 1] : null,
    median: prices.length ? (prices[Math.floor((prices.length - 1) / 2)] + prices[Math.floor(prices.length / 2)]) / 2 : null,
    sponsored: items.filter(i => i.sponsored).length };
}
export function marketCsv(items: MarketItem[]): string {
  const cell = (value: unknown) => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, "'$&").replace(/"/g, '""') + '"';
  return '\ufeff' + [['Posição observada', 'ID', 'Título', 'Preço BRL', 'Vendedor', 'Vendas exibidas', 'Frete exibido', 'Patrocinado', 'URL', 'Capturado em'], ...items.map(i => [i.position, i.id, i.title, i.price, i.seller, i.soldLabel, i.shippingLabel, i.sponsored ? 'Sim' : 'Não', i.url, i.capturedAt])].map(row => row.map(cell).join(';')).join('\r\n');
}
