import { installMarketInsights } from './inline-insights.ts';
import { readMarketPage } from './page-reader.ts';
import { marketSummary } from '../../integrations/mercadolivre/market.ts';

/** Read-only page companion. Editing remains in the shared side panel. */
export function installMarketCompanion(): void {
  if (document.getElementById('paulifest-market-companion')) return;
  const host = document.createElement('div');
  host.id = 'paulifest-market-companion';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483000;font:13px/1.5 system-ui,sans-serif;color:#17243a}
    *{box-sizing:border-box} [hidden]{display:none!important}
    button{font:inherit;cursor:pointer;border:1px solid #dbe3ee;background:white;color:#17243a;border-radius:10px;padding:9px 12px}
    button:hover{background:#edf4ff} button:focus-visible{outline:3px solid #3483fa;outline-offset:2px}
    #launcher,.primary{background:#2458d3;color:white;border:0;font-weight:600;box-shadow:0 3px 12px #17243a22}
    #panel{width:min(350px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;background:#fff;border:1px solid #dbe3ee;border-radius:16px;box-shadow:0 8px 32px #17243a30}
    header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e9edf3}
    h2{font-size:15px;margin:0} .body{padding:14px} p{margin:0 0 12px} .muted{color:#667085;font-size:12px}
    #summary{background:#f3f6fc;border-radius:10px;padding:12px;white-space:pre-line;margin-bottom:12px}
    .actions{display:flex;flex-wrap:wrap;gap:8px} #status{margin-top:10px} footer{padding:10px 14px;border-top:1px solid #e9edf3;display:flex;gap:8px}
  </style>
  <button id="launcher" aria-expanded="false" aria-controls="panel">✦ Copilot · analisar página</button>
  <section id="panel" hidden aria-label="Copilot Mercado Livre">
    <header><h2>Copilot · Mercado Livre</h2><button id="close" aria-label="Recolher painel">−</button></header>
    <div class="body"><p class="muted">Entenda os anúncios desta página. Continue a edição da sua ficha no painel lateral.</p>
    <div id="summary" aria-live="polite"></div><div id="details"></div>
    <div class="actions"><button id="refresh">Atualizar leitura</button><button id="open" class="primary">Abrir painel lateral</button></div>
    <p id="status" class="muted" role="status"></p></div>
    <footer><button id="position">Mover para a esquerda</button><button id="hide">Ocultar nesta página</button></footer>
  </section>`;
  document.body.append(host);
  const el = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;
  let left = false;
  const format = (value: number | null) => value === null ? 'Não disponível' : value.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const read = () => {
    el('details').replaceChildren();
    try {
      const snapshot = readMarketPage(document, location.href);
      const stats = marketSummary(snapshot.items);
      el('summary').textContent = stats.count
        ? `${stats.count} anúncio(s) lido(s) nesta página\nMenor preço: ${format(stats.min)}\nPreço mediano: ${format(stats.median)}\nPatrocinados identificados: ${stats.sponsored}`
        : 'Abra uma busca ou um anúncio do Mercado Livre e atualize a leitura.';
      for (const item of snapshot.items.slice(0, 5)) {
        const p = document.createElement('p');
        p.textContent = `${item.title} — ${format(item.price)}${item.seller ? ` · ${item.seller}` : ''}`;
        el('details').append(p);
      }
      el('status').textContent = `Dados visíveis da página · ${new Date(snapshot.capturedAt).toLocaleTimeString('pt-BR')}. Esta leitura não representa todo o mercado.`;
    } catch {
      el('summary').textContent = 'Esta página não está disponível para análise.';
      el('status').textContent = 'Abra uma busca ou anúncio e tente novamente.';
    }
  };
  const toggle = (open: boolean) => {
    el('panel').hidden = !open; el('launcher').hidden = open;
    el('launcher').setAttribute('aria-expanded', String(open));
    if (open) { read(); el('close').focus(); } else el('launcher').focus();
  };
  installMarketInsights(() => { host.style.display = ''; toggle(true); });
  el('launcher').onclick = () => toggle(true);
  el('close').onclick = () => toggle(false);
  el('refresh').onclick = read;
  shadow.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') toggle(false); });
  el('position').onclick = () => {
    left = !left; host.style.left = left ? '16px' : 'auto'; host.style.right = left ? 'auto' : '16px';
    el('position').textContent = left ? 'Mover para a direita' : 'Mover para a esquerda';
  };
  el('hide').onclick = () => { host.style.display = 'none'; };
  el<HTMLButtonElement>('open').onclick = () => {
    chrome.runtime.sendMessage({type:'ML_OPEN_SIDE_PANEL'}).then(response => {
      if (!response?.ok) el('status').textContent = 'Abra o painel pelo ícone da extensão na barra do navegador.';
      else toggle(false);
    }).catch(() => { el('status').textContent = 'Recarregue a página após atualizar a extensão.'; });
  };
  // Navigation invalidates the displayed capture; reading stays an explicit action.
  let lastUrl = location.href;
  const timer = window.setInterval(() => {
    if (!host.isConnected) { window.clearInterval(timer); return; }
    if (lastUrl !== location.href) {
      lastUrl = location.href; el('details').replaceChildren();
      el('summary').textContent = 'A página mudou. Atualize a leitura para analisar os anúncios atuais.';
      el('status').textContent = '';
    }
  }, 1000);
}
