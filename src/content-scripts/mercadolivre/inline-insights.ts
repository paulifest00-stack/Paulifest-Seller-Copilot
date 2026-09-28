import { readMarketPage } from './page-reader.ts';
import { marketSummary, normalizeMarketUrl, type MarketSnapshot } from '../../integrations/mercadolivre/market.ts';
export function priceComparisonLabel(price: number | null, median: number | null): string {
    if (price === null || median === null || !Number.isFinite(price) || !Number.isFinite(median) || median <= 0 || price < 0)
        return 'Sem base para comparar';
    const delta = (price / median - 1) * 100;
    if (Math.abs(delta) < .5)
        return 'Na mediana desta página';
    return `${Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% ${delta > 0 ? 'acima' : 'abaixo'} da mediana`;
}
/** Inline read-only insights; no remote requests or inferred sales/revenue. */
export function installMarketInsights(onOpen: () => void, readSnapshot: () => MarketSnapshot = () => readMarketPage(document, location.href)): () => void {
    let host: HTMLElement | null = null, signature = '', timer: number | undefined, stopped = false, collapsed = false;
    const badges = new Map<HTMLElement, HTMLElement>();
    const money = (value: number | null) => value === null ? 'Não disponível' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const clear = () => { host?.remove(); host = null; for (const badge of badges.values())
        badge.remove(); badges.clear(); signature = ''; };
    const scan = () => {
        if (stopped)
            return;
        let snapshot: MarketSnapshot;
        try {
            snapshot = readSnapshot();
        }
        catch {
            clear();
            return;
        }
        const anchor = document.querySelector('.ui-search-layout, .ui-pdp-container');
        if (!anchor || !snapshot.items.length) {
            clear();
            return;
        }
        const stats = marketSummary(snapshot.items);
        const next = JSON.stringify([location.href, snapshot.items.map(({ capturedAt, ...item }) => item)]);
        if (!host?.isConnected) {
            host = document.createElement('div');
            host.id = 'paulifest-market-insights';
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `<style>
      :host{all:initial;display:block;margin:16px 0 20px;font:13px/1.5 system-ui,sans-serif;color:#17243a}*{box-sizing:border-box}[hidden]{display:none!important}.shell{background:#fff;border:1px solid #dce4ef;border-radius:15px;overflow:hidden;box-shadow:0 3px 12px #173c6410}header{background:#102e61;color:white;padding:13px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}strong{font-size:14px}header small{color:#bbd3f5;margin-left:10px;font-size:11px}button{font:600 12px system-ui;cursor:pointer;border:1px solid #dce4ef;background:white;color:#255bb4;border-radius:8px;padding:9px 13px}button:focus-visible{outline:3px solid #76adff;outline-offset:2px}header button{background:#ffffff14;border:0;color:white}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:20px;gap:20px}.metric small{display:block;font-size:11px;color:#76879e}.metric b{display:block;font-size:23px;margin-top:5px;letter-spacing:-.025em}.foot{display:flex;justify-content:space-between;gap:16px;align-items:center;border-top:1px solid #edf0f5;padding:12px 20px}.foot p{font-size:11px;color:#7c8ba0;margin:0}.primary{background:#2467dc;border-color:#2467dc;color:white}@media(max-width:650px){.metrics{grid-template-columns:1fr 1fr}.foot{align-items:flex-start;flex-direction:column}header small{display:none}.metric b{font-size:20px}}
      .shell{border:0;border-radius:0;box-shadow:none;background:transparent}header,.foot{display:none}.metrics{display:flex;flex-wrap:wrap;gap:12px 24px;padding:8px 0;border-bottom:1px solid #e6e6e6}.metric b{font-size:15px;margin-top:2px}.metric small{font-size:11px}</style><section class="shell" aria-label="Análise Copilot"><header><div><strong>✦ Paulifest Copilot</strong><small>ANÁLISE DA PÁGINA</small></div><button id="collapse" aria-expanded="true">Recolher</button></header><div id="body"><div class="metrics" id="metrics"></div><div class="foot"><p id="source"></p><button class="primary" id="open">Explorar anúncios →</button></div></div></section>`;
            anchor.parentElement?.insertBefore(host, anchor);
            signature = '';
            shadow.getElementById('open')!.onclick = onOpen;
            const button = shadow.getElementById('collapse')!;
            const body = shadow.getElementById('body')!;
            body.hidden = collapsed;
            button.textContent = collapsed ? 'Expandir' : 'Recolher';
            button.setAttribute('aria-expanded', String(!collapsed));
            button.onclick = () => { collapsed = !collapsed; body.hidden = collapsed; button.textContent = collapsed ? 'Expandir' : 'Recolher'; button.setAttribute('aria-expanded', String(!collapsed)); };
        }
        if (signature !== next) {
            signature = next;
            const shadow = host.shadowRoot!;
            const metrics: [
                string,
                string
            ][] = [['Anúncios lidos', String(stats.count)], ['Menor preço', money(stats.min)], ['Preço mediano', money(stats.median)], ['Patrocinados identificados', String(stats.sponsored)]];
            shadow.getElementById('metrics')!.replaceChildren(...metrics.map(([label, value]) => { const node = document.createElement('div'); node.className = 'metric'; const small = document.createElement('small'); small.textContent = label; const strong = document.createElement('b'); strong.textContent = value; node.append(small, strong); return node; }));
            shadow.getElementById('source')!.textContent = `Leitura às ${new Date(snapshot.capturedAt).toLocaleTimeString('pt-BR')} · preços de ${stats.priced} anúncio(s) desta página. Não representa todo o mercado.`;
        }
        for (const [card, badge] of badges) {
            if (!card.isConnected) {
                badge.remove();
                badges.delete(card);
            }
        }
        const byId = new Map(snapshot.items.map(item => [item.id, item]));
        for (const card of document.querySelectorAll<HTMLElement>('.ui-search-layout__item')) {
            const link = card.querySelector<HTMLAnchorElement>('a.poly-component__title,a.ui-search-item__group__element,a.ui-search-link');
            const id = link ? normalizeMarketUrl(link.href, location.href)?.id : undefined;
            const item = id ? byId.get(id) : undefined;
            if (!item) {
                badges.get(card)?.remove();
                badges.delete(card);
                continue;
            }
            let badge = badges.get(card);
            if (!badge?.isConnected) {
                badge = document.createElement('div');
                badge.className = 'paulifest-market-card';
                const shadow = badge.attachShadow({ mode: 'open' });
                shadow.innerHTML = '<style>:host{all:initial;display:block;margin:8px 10px 12px;font:11px/1.5 system-ui,sans-serif;color:#335b92}.box{background:transparent;border:0;border-top:1px solid #eee;border-radius:0;padding:6px 0}.label{font-weight:700;color:#2458a7;margin-bottom:3px}.detail{color:#677b98;font-size:10px}</style><div class="box"><div class="label" id="label"></div><div id="comparison"></div><div class="detail" id="detail"></div></div>';
                card.append(badge);
                badges.set(card, badge);
            }
            const shadow = badge.shadowRoot!;
            shadow.getElementById('label')!.textContent = `Posição observada ${item.position}`;
            shadow.getElementById('comparison')!.textContent = priceComparisonLabel(item.price, stats.median);
            shadow.getElementById('detail')!.textContent = item.sponsored ? 'Patrocinado identificado na página' : 'Comparação com os resultados lidos';
        }
    };
    const observer = new MutationObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(scan, 300); });
    scan();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
    // Some SPA route changes precede DOM replacement; clear stale information immediately.
    const onNavigation = () => { clear(); scan(); };
    window.addEventListener('popstate', onNavigation);
    return () => { stopped = true; observer.disconnect(); window.clearTimeout(timer); window.removeEventListener('popstate', onNavigation); clear(); };
}
