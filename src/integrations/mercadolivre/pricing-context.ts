import type { MlPricingContext } from '../../shared/ml-pricing.ts';
import { isMlHost, parseBrlPrice } from './market.ts';

export function mlItemIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!isMlHost(url.hostname)) return;
    const explicit = url.searchParams.get('item_id');
    if (explicit && /^MLB\d{6,}$/i.test(explicit)) return explicit.toUpperCase();
    const match = url.pathname.match(/(?:^|[/_-])(MLB-?\d{6,})(?:\D|$)/i);
    return match ? match[1].replace('-', '').toUpperCase() : undefined;
  } catch { return; }
}

export function readPricingPage(doc: Document, href: string): MlPricingContext {
  const url = new URL(href);
  if (!isMlHost(url.hostname) || /captcha|account-verification|login|\/auth\//i.test(url.pathname)) {
    throw new Error('Abra o anúncio ou o cadastro do Mercado Livre.');
  }

  const input = (name: string) => {
    const el = doc.querySelector<HTMLInputElement | HTMLSelectElement>(`input[name="${name}"], select[name="${name}"]`);
    return el && (el.type !== 'radio' || (el as HTMLInputElement).checked) ? el.value : undefined;
  };

  // 1. Título
  const title = input('title')
    || doc.querySelector('h1.ui-pdp-title')?.textContent?.trim()
    || doc.querySelector('.ui-pdp-title')?.textContent?.trim()
    || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
    || doc.title.replace(/\s*\|\s*Mercado\s*Livre.*$/i, '').trim();

  // 2. Preço
  let price: number | undefined;
  const rawInputPrice = input('price');
  if (rawInputPrice) {
    price = (rawInputPrice.includes(',') ? parseBrlPrice(rawInputPrice) : Number(rawInputPrice)) || undefined;
  } else {
    const metaPrice = doc.querySelector('meta[itemprop="price"]')?.getAttribute('content');
    if (metaPrice && !isNaN(Number(metaPrice)) && Number(metaPrice) > 0) {
      price = Number(metaPrice);
    } else {
      const priceContainer = doc.querySelector('.ui-pdp-price__second-line, .poly-price__current, .ui-search-price__second-line') || doc;
      const fraction = priceContainer.querySelector('.andes-money-amount__fraction')?.textContent?.replace(/\./g, '').trim();
      const cents = priceContainer.querySelector('.andes-money-amount__cents')?.textContent?.trim();
      if (fraction) {
        price = parseBrlPrice(fraction + (cents ? ',' + cents : '')) || undefined;
      }
    }
  }

  // 3. Categoria
  let categoryId = input('category_id');
  let categoryName: string | undefined;
  const breadcrumbLinks = Array.from(doc.querySelectorAll('.ui-pdp-breadcrumb a, .andes-breadcrumb a'));
  if (breadcrumbLinks.length > 0) {
    const lastCrumb = breadcrumbLinks[breadcrumbLinks.length - 1];
    categoryName = lastCrumb.textContent?.trim();
    const hrefAttr = lastCrumb.getAttribute('href') || '';
    const catMatch = hrefAttr.match(/(MLB\d{3,})/i);
    if (catMatch && !categoryId) {
      categoryId = catMatch[1].toUpperCase();
    }
  }

  // 4. Frete e Condição
  const freeShippingText = doc.querySelector('.ui-pdp-shipping, .ui-pdp-media, .ui-pdp-action--shipping')?.textContent || '';
  const freeShipping = /frete gr[áa]tis/i.test(freeShippingText);

  // 5. Imagem / Thumbnail
  const thumbnail = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
    || doc.querySelector<HTMLImageElement>('.ui-pdp-gallery__figure img, .ui-pdp-image')?.src;

  const listingType = input('listing_type_id');
  const shippingMode = input('shipping_mode');
  const logisticType = input('logistic_type');

  return {
    itemId: mlItemIdFromUrl(href),
    title: title?.slice(0, 500),
    ...(categoryId && /^MLB\d+$/i.test(categoryId) ? { categoryId: categoryId.toUpperCase() } : {}),
    ...(categoryName ? { categoryName } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(typeof price === 'number' && Number.isFinite(price) && price > 0 ? { price } : {}),
    ...(['gold_special', 'gold_pro'].includes(listingType || '') ? { listingType: listingType as 'gold_special' | 'gold_pro' } : {}),
    ...(shippingMode ? { shippingMode } : {}),
    ...(logisticType ? { logisticType } : {}),
    freeShipping
  };
}

