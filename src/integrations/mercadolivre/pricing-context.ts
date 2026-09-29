import type { MlPricingContext } from '../../shared/ml-pricing.ts';
import { isMlHost, parseBrlPrice } from './market.ts';
export function mlItemIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!isMlHost(url.hostname)) return;
    // Catalog /p/ identifiers are not listing IDs.
    const explicit = url.searchParams.get('item_id');
    if (explicit && /^MLB\d{6,}$/.test(explicit)) return explicit;
    if (/\/p\/MLB/i.test(url.pathname)) return;
    const match = url.pathname.match(/(?:^|[/_-])MLB-?(\d{6,})(?:\D|$)/i);
    return match ? 'MLB' + match[1] : undefined;
  } catch { return; }
}
export function readPricingPage(doc: Document, href: string): MlPricingContext {
  const url = new URL(href);
  if (!isMlHost(url.hostname) || /captcha|account-verification|login|\/auth\//i.test(url.pathname)) throw new Error('Abra o anúncio ou o cadastro do Mercado Livre.');
  const input = (name: string) => {
    const el = doc.querySelector<HTMLInputElement | HTMLSelectElement>(`input[name="${name}"], select[name="${name}"]`);
    return el && (el.type !== 'radio' || (el as HTMLInputElement).checked) ? el.value : undefined;
  };
  const title = input('title') || doc.querySelector('h1.ui-pdp-title')?.textContent?.trim();
  const rawPrice = input('price');
  const price = rawPrice ? (rawPrice.includes(',') ? parseBrlPrice(rawPrice) : Number(rawPrice)) : undefined;
  const categoryId = input('category_id');
  const listingType = input('listing_type_id');
  const shippingMode = input('shipping_mode');
  const logisticType = input('logistic_type');
  return { itemId: mlItemIdFromUrl(href), title: title?.slice(0, 500),
    ...(categoryId && /^MLB\d+$/.test(categoryId) ? { categoryId } : {}),
    ...(typeof price === 'number' && Number.isFinite(price) && price > 0 ? { price } : {}),
    ...(['gold_special','gold_pro'].includes(listingType || '') ? { listingType: listingType as 'gold_special' | 'gold_pro' } : {}),
    ...(shippingMode ? { shippingMode } : {}), ...(logisticType ? { logisticType } : {}) };
}
