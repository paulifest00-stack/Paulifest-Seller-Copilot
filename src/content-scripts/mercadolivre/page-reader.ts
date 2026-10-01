import { readPricingPage } from '../../integrations/mercadolivre/pricing-context.ts';
import { isMlHost, normalizeMarketUrl, parseBrlPrice, type MarketItem, type MarketSnapshot } from '../../integrations/mercadolivre/market.ts';
const read = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
function price(root: ParentNode): number | null {
  const container = root.querySelector('.poly-price__current, .ui-search-price__second-line, .ui-pdp-price__second-line') || root;
  const fraction = read(container, '.andes-money-amount__fraction');
  const cents = read(container, '.andes-money-amount__cents');
  return fraction ? parseBrlPrice(fraction + (cents ? ',' + cents : '')) : null;
}
export function readMarketPage(doc: Document, href: string): MarketSnapshot {
  const url = new URL(href);
  if (!isMlHost(url.hostname) || /captcha|account-verification|login|\/auth\//i.test(url.pathname)) throw new Error('Esta página não é uma página de produtos disponível para leitura.');
  const at = new Date().toISOString();
  const items: MarketItem[] = [];
  const seen = new Set<string>();
  const cards = Array.from(doc.querySelectorAll('.ui-search-layout__item, .ui-search-result__wrapper'));
  for (const [index, card] of cards.entries()) {
    const link = card.querySelector<HTMLAnchorElement>('a.poly-component__title, a.ui-search-item__group__element, a.ui-search-link');
    const identity = link ? normalizeMarketUrl(link.href, href) : null;
    const title = read(card, '.poly-component__title, .ui-search-item__title');
    if (!identity || !title || seen.has(identity.id)) continue;
    seen.add(identity.id);
    const text = card.textContent || '';
    items.push({ ...identity, title: title.slice(0, 500), price: price(card), currency: 'BRL', seller: read(card, '.poly-component__seller, .ui-search-official-store-label') || null,
      soldLabel: text.match(/(?:\+\s*)?[\d.,]+\s*(?:mil\s*)?vendidos?/i)?.[0] || null,
      shippingLabel: read(card, '.poly-component__shipping, .ui-search-item__shipping') || null,
      sponsored: /patrocinado/i.test(text), position: index + 1, capturedAt: at });
    if (items.length >= 100) break;
  }
  if (!cards.length) {
    const identity = normalizeMarketUrl(doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || href, href);
    const title = read(doc, 'h1.ui-pdp-title');
    if (identity && title) items.push({ ...identity, title: title.slice(0, 500), price: price(doc), currency: 'BRL', seller: read(doc, '.ui-pdp-seller__header__title, .ui-pdp-seller__link-trigger') || null,
      soldLabel: read(doc, '.ui-pdp-subtitle') || null, shippingLabel: read(doc, '.ui-pdp-shipping__title') || null, sponsored: false, position: 1, capturedAt: at });
  }
  url.search = ''; url.hash = '';
  return { url: url.href, capturedAt: at, kind: cards.length ? 'search' : items.length ? 'product' : 'unknown', items };
}
export function installMarketReader(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['ML_READ_PAGE', 'ML_READ_PRICING'].includes(message?.type)) return;
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: 'Origem não autorizada.' });
      return;
    }
    if (message.expectedUrl && message.expectedUrl !== location.href) {
      // Tolera pequenas variações de hash ou trailing slash
      const cleanExpected = message.expectedUrl.split('#')[0].replace(/\/$/, '');
      const cleanActual = location.href.split('#')[0].replace(/\/$/, '');
      if (cleanExpected !== cleanActual) {
        sendResponse({ ok: false, error: 'A aba mudou de página. Capture novamente.' });
        return;
      }
    }
    try {
      sendResponse(
        message.type === 'ML_READ_PRICING'
          ? { ok: true, context: readPricingPage(document, location.href) }
          : { ok: true, snapshot: readMarketPage(document, location.href) }
      );
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : 'Não foi possível ler a página.' });
    }
  });
}
