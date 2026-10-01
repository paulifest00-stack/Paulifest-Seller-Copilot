// companion.ts — ML Speed Dial FAB + Native Screen Navigation (iOS-style)
import { installMarketInsights } from './inline-insights.ts';
import { readMarketPage } from './page-reader.ts';
import { marketSummary } from '../../integrations/mercadolivre/market.ts';

type ScreenId = 'home' | 'catalog' | 'reading' | 'product';

const ML_STYLES = /* css */`
  :host {
    all: initial;
    font: 13px/1.5 system-ui, -apple-system, sans-serif;
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483000;
    pointer-events: none;
  }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }

  /* ── Design Tokens ── */
  :host {
    --pf-ml-yellow: #ffe600;
    --pf-ml-blue:   #3483fa;
    --pf-ml-dark:   #2d3277;
    --pf-surface:   #ffffff;
    --pf-surface-2: #f8fafc;
    --pf-border:    #e2e8f0;
    --pf-text:      #0f172a;
    --pf-muted:     #64748b;
    --pf-r:         18px;
    --pf-r-sm:      12px;
    --ease-out:     cubic-bezier(0.23, 1, 0.32, 1);
    --ease-drawer:  cubic-bezier(0.32, 0.72, 0, 1);
    --ease-ios-in:  cubic-bezier(0.72, 0, 0.28, 1);
  }

  .pf-root {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: none;
  }

  /* ── POPUP CARD ── */
  .pf-popup {
    pointer-events: auto;
    width: min(400px, calc(100vw - 24px));
    height: var(--pf-popup-h, 520px);
    max-height: calc(100dvh - 100px);
    background: var(--pf-surface);
    border-radius: var(--pf-r);
    box-shadow:
      0 0 0 1px rgba(10,31,68,0.06),
      0 4px 6px -1px rgba(10,31,68,0.06),
      0 20px 48px -4px rgba(10,31,68,0.18);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform-origin: bottom right;
    transition: height 240ms var(--ease-out);
    animation: pf-popup-in 220ms var(--ease-out) both;
  }
  @keyframes pf-popup-in {
    from { opacity: 0; transform: scale(0.92) translateY(12px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);    }
  }

  /* ── Header ── */
  .pf-ph {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 14px;
    background: rgba(52, 131, 250, 0.92);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    border-bottom: 1px solid rgba(255,255,255,0.12);
  }
  .pf-ph-back, .pf-ph-action {
    width: 30px; height: 30px;
    border: none;
    background: rgba(255,255,255,0.15);
    color: #fff;
    border-radius: 8px;
    font-size: 15px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 100ms, transform 100ms;
    flex-shrink: 0;
  }
  .pf-ph-action { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); font-size: 14px; }
  .pf-ph-back:hover, .pf-ph-action:hover { background: rgba(255,255,255,0.25); }
  .pf-ph-back:active, .pf-ph-action:active { transform: scale(0.94); }

  .pf-ph-title {
    flex: 1;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.015em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pf-ph-badge {
    background: #ffe600;
    color: #1a1a1a;
    border-radius: 20px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  /* ── Screen viewport & animations ── */
  .pf-screen-wrap { flex: 1; min-height: 0; position: relative; overflow: hidden; }
  .pf-screen {
    position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden;
    background: var(--pf-surface); scrollbar-width: thin;
  }
  .pf-screen::-webkit-scrollbar { width: 4px; }
  .pf-screen::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }

  .pf-screen-enter { animation: pf-screen-push-in 240ms var(--ease-drawer) both; }
  .pf-screen-exit { animation: pf-screen-pop-out 200ms var(--ease-ios-in) both; pointer-events: none; }
  .pf-screen-enter-back { animation: pf-screen-pop-in 240ms var(--ease-drawer) both; }
  .pf-screen-exit-forward { animation: pf-screen-push-out 200ms var(--ease-ios-in) both; pointer-events: none; }

  @keyframes pf-screen-push-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @keyframes pf-screen-pop-out { from { transform: translateX(0); opacity: 1; } to { transform: translateX(28%); opacity: 0; } }
  @keyframes pf-screen-pop-in  { from { transform: translateX(-28%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes pf-screen-push-out{ from { transform: translateX(0); opacity: 1; } to { transform: translateX(-10%); opacity: 0; } }

  /* ── Components ── */
  .pf-section { padding: 14px 14px 0; }
  .pf-section:last-child { padding-bottom: 16px; }
  .pf-section-label { font-size: 10px; font-weight: 700; color: var(--pf-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
  .pf-card { background: var(--pf-surface-2); border: 1px solid var(--pf-border); border-radius: var(--pf-r-sm); overflow: hidden; }

  .pf-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%;
    padding: 11px 14px; border: none; border-radius: 10px; font: 600 13px/1 system-ui;
    cursor: pointer; transition: transform 100ms, opacity 100ms, background 100ms;
  }
  .pf-btn:active { transform: scale(0.97); }
  .pf-btn.primary { background: var(--pf-ml-blue); color: #fff; }
  .pf-btn.primary:hover { background: var(--pf-ml-dark); }
  .pf-btn.secondary { background: var(--pf-surface-2); border: 1px solid var(--pf-border); color: var(--pf-text); }
  .pf-btn.secondary:hover { background: #f1f5f9; }

  /* Search */
  .pf-search-wrap { padding: 12px 14px 0; position: sticky; top: 0; background: var(--pf-surface); z-index: 1; border-bottom: 1px solid transparent; }
  .pf-search-wrap.is-scrolled { border-bottom-color: var(--pf-border); }
  .pf-search-box {
    display: flex; align-items: center; gap: 8px; background: var(--pf-surface-2);
    border: 1.5px solid var(--pf-border); border-radius: 10px; padding: 0 10px;
    transition: border-color 120ms, box-shadow 120ms; margin-bottom: 10px;
  }
  .pf-search-box:focus-within { border-color: var(--pf-ml-blue); box-shadow: 0 0 0 3px rgba(52,131,250,0.12); }
  .pf-search-input { flex: 1; border: none; background: transparent; font: 13px/1 system-ui; color: var(--pf-text); padding: 10px 0; outline: none; }
  .pf-search-clear { width: 18px; height: 18px; border: none; background: var(--pf-muted); color: #fff; border-radius: 50%; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0; transition: opacity 120ms; }
  .pf-search-box.has-value .pf-search-clear { opacity: 1; }

  /* Row */
  .pf-row { display: flex; align-items: center; gap: 10px; padding: 11px 14px; cursor: pointer; transition: background 80ms; border-bottom: 1px solid var(--pf-border); }
  .pf-row:last-child { border-bottom: none; }
  .pf-row:hover { background: rgba(52,131,250,0.04); }
  .pf-row:active { background: rgba(52,131,250,0.08); transform: scale(0.99); }
  .pf-row-img, .pf-row-img-placeholder { width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; border: 1px solid var(--pf-border); background: var(--pf-surface-2); }
  .pf-row-img { object-fit: contain; }
  .pf-row-img-placeholder { display: flex; align-items: center; justify-content: center; font-size: 16px; color: var(--pf-muted); }
  .pf-row-body { flex: 1; min-width: 0; }
  .pf-row-name { font-size: 13px; font-weight: 600; color: var(--pf-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-row-sub { font-size: 11px; color: var(--pf-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Stats / Info */
  .pf-mini-summary { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 12px; color: #1e293b; white-space: pre-line; line-height: 1.5; }
  .pf-mini-status { font-size: 11px; color: #64748b; text-align: center; margin-top: 8px; min-height: 16px; }

  .pf-empty { padding: 32px 20px; text-align: center; color: var(--pf-muted); }
  .pf-empty-icon { font-size: 32px; margin-bottom: 10px; opacity: 0.5; }
  .pf-empty-text { font-size: 13px; font-weight: 500; }
  .pf-empty-sub { font-size: 11px; margin-top: 4px; opacity: 0.7; }
  .pf-spinner { width: 22px; height: 22px; border: 2.5px solid rgba(52,131,250,0.2); border-top-color: var(--pf-ml-blue); border-radius: 50%; animation: pf-spin 0.7s linear infinite; margin: 0 auto; }
  @keyframes pf-spin { to { transform: rotate(360deg); } }

  /* ── Speed Dial ── */
  .pf-dial-anchor { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; pointer-events: auto; }
  .pf-dial { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .pf-toast { pointer-events: none; background: #1e293b; color: #fff; border-radius: 10px; padding: 7px 13px; font-size: 12px; font-weight: 600; max-width: 230px; text-align: right; box-shadow: 0 4px 16px rgba(0,0,0,0.2); animation: pf-toast-in 180ms var(--ease-out) both; }
  @keyframes pf-toast-in { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

  .pf-pill {
    display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 18px 0 7px;
    background: #fff; border: none; border-radius: 23px;
    box-shadow: 0 0 0 1px rgba(10,31,68,0.06), 0 4px 16px rgba(10,31,68,0.12), 0 1px 3px rgba(0,0,0,0.05);
    cursor: pointer; font: 600 13.5px/1 system-ui; color: #1e293b; white-space: nowrap;
    opacity: 0; transform: translateY(10px) scale(0.92); pointer-events: none;
    transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out), box-shadow 120ms, background 80ms;
    will-change: transform, opacity;
  }
  @media (hover: hover) and (pointer: fine) {
    .pf-pill:hover { box-shadow: 0 0 0 1px rgba(10,31,68,0.08), 0 8px 24px rgba(10,31,68,0.18); transform: translateY(0) scale(1) translateX(-3px) !important; }
  }
  .pf-pill:active { transform: translateY(0) scale(0.96) !important; }
  .pf-dial-anchor:hover .pf-pill, .pf-dial-anchor.is-pinned .pf-pill { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
  .pf-pill-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
  .pf-pill-text { flex: 1; }
  .pf-pill-label { display: block; }
  .pf-pill-sub { display: block; font-size: 10px; font-weight: 500; color: var(--pf-muted); margin-top: 1px; }

  /* ── FAB ML ── */
  .pf-fab {
    width: 54px; height: 54px; border-radius: 50%; border: none;
    background: linear-gradient(145deg, #ffe600, #f0c000); color: #1a1a1a;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 4px 20px rgba(255,230,0,0.48), 0 1px 4px rgba(0,0,0,0.12);
    position: relative; touch-action: none; user-select: none; pointer-events: auto;
    transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms, background 200ms;
    will-change: transform;
  }
  @media (hover: hover) and (pointer: fine) {
    .pf-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(255,230,0,0.58); }
  }
  .pf-fab:active { transform: scale(0.94) !important; }
  .pf-fab.is-active { background: linear-gradient(145deg, #3483fa, #1e3a8a); color: #fff; }
  .pf-fab.is-dragging { cursor: grabbing; }

  .pf-fab-logo { width: 30px; height: 30px; border-radius: 8px; object-fit: contain; transition: opacity 150ms, transform 200ms; }
  .pf-fab-x { position: absolute; font-size: 20px; font-weight: 300; line-height: 1; opacity: 0; transform: scale(0.5) rotate(-30deg); transition: opacity 150ms, transform 200ms; pointer-events: none; }
  .pf-fab.is-active .pf-fab-logo { opacity: 0; transform: scale(0.4) rotate(30deg); }
  .pf-fab.is-active .pf-fab-x { opacity: 1; transform: scale(1) rotate(0deg); }
  .pf-product-hero {
    display: flex; align-items: center; gap: 12px; padding: 14px; border-bottom: 1px solid var(--pf-border);
  }
  .pf-product-img {
    width: 56px; height: 56px; border-radius: 12px; object-fit: contain; background: var(--pf-surface-2); border: 1px solid var(--pf-border); flex-shrink: 0;
  }
  .pf-product-img-placeholder {
    width: 56px; height: 56px; border-radius: 12px; background: var(--pf-surface-2); border: 1px solid var(--pf-border); display: flex; align-items: center; justify-content: center; font-size: 24px; color: var(--pf-muted); flex-shrink: 0;
  }
  .pf-product-name {
    font-size: 13px; font-weight: 600; color: var(--pf-text); margin-bottom: 2px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .pf-product-sku { font-size: 11px; color: var(--pf-muted); margin-bottom: 2px; }
  .pf-product-tag { font-size: 10px; color: #3b82f6; font-weight: 600; background: #eff6ff; padding: 1px 6px; border-radius: 4px; display: inline-block; }
  
  .pf-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .pf-stat { padding: 10px 12px; border-bottom: 1px solid var(--pf-border); }
  .pf-stat:nth-child(odd) { border-right: 1px solid var(--pf-border); }
  .pf-stat:last-child, .pf-stat:nth-last-child(2):nth-child(odd) { border-bottom: none; }
  .pf-stat-label { font-size: 10px; font-weight: 700; color: var(--pf-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; }
  .pf-stat-value { font-size: 14px; font-weight: 600; color: var(--pf-text); }
`;

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function installMarketCompanion(): void {
  if (document.getElementById('paulifest-market-companion')) return;

  const hostEl = document.createElement('div');
  hostEl.id = 'paulifest-market-companion';
  document.body.append(hostEl);
  const shadow = hostEl.attachShadow({ mode: 'open' });

  // ── State ──
  let popupOpen = false;
  let isPinned = false;
  let screenStack: ScreenId[] = [];
  let currentScreenEl: HTMLElement | null = null;
  let customPos: { x: number; y: number } | null = null;
  let fabDidDrag = false;
  let fabDragOffset: { x: number; y: number } | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Catalog State
  let catalogQuery = '';
  let catalogItems: any[] = [];
  let catalogLoading = false;
  let catalogError = '';
  let selectedProduct: any = null;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Reading state
  let readingStats = 'Atualize a leitura para ver os dados.';
  let readingTime = '';
  let lastUrl = location.href;

  const SCREEN_HEIGHTS: Record<ScreenId, number> = {
    home: 240,
    catalog: 500,
    reading: 340,
    product: 480,
  };

  try {
    const raw = window.localStorage?.getItem('pf_ml_speeddial_pos');
    if (raw) { const p = JSON.parse(raw); if (typeof p.x === 'number') customPos = { x: p.x, y: p.y }; }
  } catch { /**/ }

  shadow.innerHTML = `<style>${ML_STYLES}</style>
    <div id="pf-root" class="pf-root">
      <div id="pf-popup" class="pf-popup" hidden style="--pf-popup-h: ${SCREEN_HEIGHTS.home}px">
        <div class="pf-ph">
          <button id="pf-ph-back" class="pf-ph-back" type="button" aria-label="Voltar" hidden>‹</button>
          <div id="pf-ph-title" class="pf-ph-title">Mercado Livre</div>
          <span id="pf-ph-badge" class="pf-ph-badge">ML</span>
          <button id="pf-ph-close" class="pf-ph-action" type="button" aria-label="Fechar">✕</button>
        </div>
        <div id="pf-screen-wrap" class="pf-screen-wrap"></div>
      </div>
      <div id="pf-dial-anchor" class="pf-dial-anchor">
        <div id="pf-toast-slot"></div>
        <div id="pf-dial" class="pf-dial"></div>
        <button id="pf-fab" class="pf-fab" type="button" aria-label="Copilot ML">
          <img id="pf-fab-logo" class="pf-fab-logo" alt="" />
          <span class="pf-fab-x" aria-hidden="true">✕</span>
        </button>
      </div>
    </div>`;

  const el = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;

  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    el<HTMLImageElement>('pf-fab-logo').src = chrome.runtime.getURL('icons/logo.png');
  }

  // ── Functions ──
  const applyPos = () => {
    if (customPos) {
      hostEl.style.left = `${Math.min(Math.max(8, customPos.x), (window.innerWidth || 1200) - 62)}px`;
      hostEl.style.top = `${Math.min(Math.max(8, customPos.y), (window.innerHeight || 800) - 62)}px`;
      hostEl.style.right = 'auto'; hostEl.style.bottom = 'auto';
    } else {
      hostEl.style.left = 'auto'; hostEl.style.top = 'auto';
      hostEl.style.right = '20px'; hostEl.style.bottom = '20px';
    }
  };
  applyPos();

  // @ts-ignore
  const showToast = (msg: string) => {
    if (toastTimer) clearTimeout(toastTimer);
    const slot = el('pf-toast-slot');
    slot.replaceChildren();
    const t = document.createElement('div');
    t.className = 'pf-toast'; t.textContent = msg;
    slot.appendChild(t);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; setTimeout(() => slot.replaceChildren(), 300); }, 3500);
  };

  const updateFabState = () => {
    el('pf-fab').classList.toggle('is-active', popupOpen);
    el('pf-dial-anchor').classList.toggle('is-pinned', isPinned && !popupOpen);
    el('pf-popup').hidden = !popupOpen;
  };

  const setPopupHeight = (id: ScreenId) => {
    el('pf-popup').style.setProperty('--pf-popup-h', `${SCREEN_HEIGHTS[id]}px`);
  };

  const updateHeader = () => {
    const titleEl = el('pf-ph-title');
    const backBtn = el<HTMLButtonElement>('pf-ph-back');
    const sc = screenStack[screenStack.length - 1] ?? 'home';
    const titles: Record<ScreenId, string> = {
      home: 'Copilot · ML',
      catalog: 'Catálogo Bling',
      reading: 'Análise da Página',
      product: 'Produto',
    };
    titleEl.textContent = titles[sc];
    backBtn.hidden = screenStack.length <= 1;
  };

  // ── Screen Rendering ──
  const buildScreen = (id: ScreenId, screenEl: HTMLElement) => {
    if (id === 'home') {
      const startSection = document.createElement('div');
      startSection.className = 'pf-section';
      startSection.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-top: 4px;';

      const btnNew = document.createElement('button');
      btnNew.type = 'button';
      btnNew.style.cssText = 'width: 100%; text-align: left; background: #0071e3; color: white; border: none; border-radius: 12px; padding: 12px; cursor: pointer; transition: opacity 0.15s; font-family: system-ui;';
      btnNew.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 2px;">Novo produto (Bling → ML)</div>
        <div style="font-size: 11px; color: #dbeafe;">Criar ficha técnica e exportar ao Mercado Livre</div>
      `;
      btnNew.addEventListener('mousedown', () => btnNew.style.transform = 'scale(0.98)');
      btnNew.addEventListener('mouseup', () => btnNew.style.transform = 'scale(1)');
      btnNew.addEventListener('mouseleave', () => btnNew.style.transform = 'scale(1)');
      btnNew.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'ML_OPEN_SIDE_PANEL' });
        closePopup();
      });

      const btnImport = document.createElement('button');
      btnImport.type = 'button';
      btnImport.style.cssText = 'width: 100%; text-align: left; background: #ffffff; border: 1px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 12px; cursor: pointer; transition: all 0.15s; font-family: system-ui; box-shadow: 0 1px 2px rgba(0,0,0,0.02);';
      btnImport.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; color: #1d1d1f; margin-bottom: 2px;">Importar do Bling p/ Mercado Livre</div>
        <div style="font-size: 11px; color: #6e6e73;">Buscar produto já cadastrado no catálogo do Bling</div>
      `;
      btnImport.addEventListener('mouseenter', () => btnImport.style.borderColor = 'rgba(0,113,227,0.4)');
      btnImport.addEventListener('mouseleave', () => { btnImport.style.borderColor = 'rgba(0,0,0,0.08)'; btnImport.style.transform = 'scale(1)'; });
      btnImport.addEventListener('mousedown', () => btnImport.style.transform = 'scale(0.98)');
      btnImport.addEventListener('mouseup', () => btnImport.style.transform = 'scale(1)');
      btnImport.addEventListener('click', () => pushScreen('catalog'));

      const btnAnalysis = document.createElement('button');
      btnAnalysis.type = 'button';
      btnAnalysis.style.cssText = 'width: 100%; text-align: left; background: transparent; border: none; padding: 12px; cursor: pointer; font-family: system-ui; margin-top: 4px; display: flex; align-items: center; gap: 6px; color: #1d1d1f; font-weight: 500; font-size: 12px;';
      btnAnalysis.innerHTML = `<span style="font-size: 14px">📊</span> Análise de Preços da Página`;
      btnAnalysis.addEventListener('click', () => { refreshReading(); pushScreen('reading'); });

      startSection.appendChild(btnNew);
      startSection.appendChild(btnImport);
      startSection.appendChild(btnAnalysis);
      screenEl.appendChild(startSection);
    } 
    else if (id === 'reading') {
      const section = document.createElement('div');
      section.className = 'pf-section';
      section.innerHTML = `
        <div class="pf-section-label">Resumo de Anúncios</div>
        <div class="pf-card" style="margin-bottom: 12px;">
          <div class="pf-mini-summary">${escHtml(readingStats)}</div>
        </div>
        <div class="pf-mini-status">${escHtml(readingTime)}</div>
      `;
      const refBtn = document.createElement('button');
      refBtn.className = 'pf-btn secondary'; refBtn.innerHTML = '🔄 Atualizar leitura';
      refBtn.addEventListener('click', refreshReading);
      section.appendChild(refBtn);
      screenEl.appendChild(section);
    }
    else if (id === 'product') {
      const product = selectedProduct;
      const imgUrl = product?.imagensUrl?.[0] || '';
      const nome = product?.nome || 'Produto';
      const codigo = product?.codigo || '';
      const productId = product?.id || '';
      const costText = product?.precoCusto != null ? `R$ ${product.precoCusto.toFixed(2).replace('.', ',')}` : '—';

      // Hero
      const hero = document.createElement('div');
      hero.className = 'pf-product-hero';
      hero.innerHTML = `
        ${imgUrl ? `<img class="pf-product-img" src="${escHtml(imgUrl)}" alt="" loading="lazy" />` : `<div class="pf-product-img-placeholder">📦</div>`}
        <div>
          <div class="pf-product-name">${escHtml(nome)}</div>
          ${codigo ? `<div class="pf-product-sku">SKU: ${escHtml(codigo)}</div>` : ''}
          ${productId ? `<div class="pf-product-tag">ID ${escHtml(productId)}</div>` : ''}
        </div>
      `;
      screenEl.appendChild(hero);

      // Stats
      const statsCard = document.createElement('div');
      statsCard.className = 'pf-section';
      statsCard.innerHTML = `
        <div class="pf-section-label">Dados do produto</div>
        <div class="pf-card">
          <div class="pf-stat-grid">
            <div class="pf-stat"><div class="pf-stat-label">Custo</div><div class="pf-stat-value">${escHtml(costText)}</div></div>
            ${product?.preco != null ? `<div class="pf-stat"><div class="pf-stat-label">Preço</div><div class="pf-stat-value">R$ ${product.preco.toFixed(2).replace('.', ',')}</div></div>` : ''}
          </div>
        </div>
      `;
      screenEl.appendChild(statsCard);

      // Extra Info
      if (product?.gtin || product?.ncm || product?.marca || product?.formato) {
        const extraSection = document.createElement('div');
        extraSection.className = 'pf-section';
        const lblExtra = document.createElement('div');
        lblExtra.className = 'pf-section-label';
        lblExtra.textContent = 'Informações Adicionais';
        extraSection.appendChild(lblExtra);

        const extraCard = document.createElement('div');
        extraCard.className = 'pf-card';
        extraCard.style.cssText = 'padding: 8px 12px; font-size: 11px; line-height: 1.6; color: var(--pf-muted); display: grid; grid-template-columns: 1fr 1fr; gap: 4px;';
        
        if (product.gtin) extraCard.innerHTML += `<div><strong>Cód. Barras:</strong> <br/><span style="user-select:all;color:var(--pf-text)">${escHtml(product.gtin)}</span></div>`;
        if (product.ncm) extraCard.innerHTML += `<div><strong>NCM:</strong> <br/><span style="user-select:all;color:var(--pf-text)">${escHtml(product.ncm)}</span></div>`;
        if (product.marca) extraCard.innerHTML += `<div><strong>Marca:</strong> <br/><span style="user-select:all;color:var(--pf-text)">${escHtml(product.marca)}</span></div>`;
        if (product.formato) extraCard.innerHTML += `<div><strong>Formato:</strong> <br/><span style="user-select:all;color:var(--pf-text)">${escHtml(product.formato)}</span></div>`;
        if (product.pesoBruto != null) extraCard.innerHTML += `<div><strong>Peso Bruto:</strong> <br/><span style="user-select:all;color:var(--pf-text)">${product.pesoBruto} kg</span></div>`;

        extraSection.appendChild(extraCard);
        screenEl.appendChild(extraSection);
      }

      // Actions
      const actionsSection = document.createElement('div');
      actionsSection.className = 'pf-section';
      actionsSection.style.cssText = 'margin-top:4px;padding-bottom:16px;display:flex;flex-direction:column;gap:8px;';
      actionsSection.innerHTML = `<div class="pf-section-label">Ações</div>`;
      
      const btnPrepare = document.createElement('button');
      btnPrepare.className = 'pf-btn primary';
      btnPrepare.innerHTML = '🛒 Preparar para Mercado Livre';
      btnPrepare.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'ML_OPEN_SIDE_PANEL' });
        closePopup();
      });
      actionsSection.appendChild(btnPrepare);
      screenEl.appendChild(actionsSection);
    }
    else if (id === 'catalog') {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'pf-search-wrap';
      const box = document.createElement('div');
      box.className = `pf-search-box${catalogQuery ? ' has-value' : ''}`;
      box.innerHTML = `<span class="pf-search-icon">🔍</span>`;
      const input = document.createElement('input');
      input.type = 'search'; input.className = 'pf-search-input'; input.placeholder = 'Nome ou SKU...';
      input.value = catalogQuery;
      const clearBtn = document.createElement('button');
      clearBtn.className = 'pf-search-clear'; clearBtn.textContent = '✕';
      
      box.append(input, clearBtn);
      searchWrap.appendChild(box);
      screenEl.appendChild(searchWrap);

      const resultsEl = document.createElement('div');
      screenEl.appendChild(resultsEl);

      const renderResults = () => {
        resultsEl.replaceChildren();
        if (!catalogQuery) {
          resultsEl.innerHTML = `<div class="pf-empty"><div class="pf-empty-icon">🔍</div><div class="pf-empty-text">Busque produtos do Bling</div></div>`;
          return;
        }
        if (catalogLoading) {
          resultsEl.innerHTML = `<div style="padding:32px;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--pf-muted);font-size:12px;"><div class="pf-spinner"></div>Buscando…</div>`;
          return;
        }
        if (catalogError) {
          resultsEl.innerHTML = `<div class="pf-empty" style="color:#b91c1c;"><div class="pf-empty-text">⚠ ${escHtml(catalogError)}</div></div>`;
          return;
        }
        if (catalogItems.length === 0) {
          resultsEl.innerHTML = `<div class="pf-empty"><div class="pf-empty-icon">😕</div><div class="pf-empty-text">Nenhum produto encontrado</div></div>`;
          return;
        }

        const card = document.createElement('div');
        card.className = 'pf-card';
        card.style.margin = '10px 14px 16px';
        catalogItems.forEach(item => {
          const row = document.createElement('button');
          row.className = 'pf-row'; row.style.cssText = 'width:100%;text-align:left;background:none;border-bottom:1px solid var(--pf-border);';
          const costStr = item.precoCusto != null ? `R$ ${item.precoCusto.toFixed(2).replace('.', ',')} custo` : '';
          const imgUrl = item.imagensUrl?.[0] || '';
          row.innerHTML = `
            ${imgUrl ? `<img class="pf-row-img" src="${escHtml(imgUrl)}" alt="" />` : `<div class="pf-row-img-placeholder">📦</div>`}
            <div class="pf-row-body">
              <div class="pf-row-name">${escHtml(item.nome || 'Produto')}</div>
              <div class="pf-row-sub">${escHtml([item.codigo, costStr].filter(Boolean).join(' · '))}</div>
            </div>
          `;
          row.addEventListener('click', () => {
            selectedProduct = item;
            pushScreen('product');
          });
          card.appendChild(row);
        });
        resultsEl.appendChild(card);
      };

      const doSearch = async (query: string) => {
        if (!query.trim()) return;
        try {
          const searchBy = /^\d{6,}$/.test(query.trim()) ? 'sku' : 'name';
          const res = await new Promise<any>((resolve) => {
            chrome.runtime.sendMessage({ type: 'BLING_SEARCH_PRODUCTS', query: query.trim().slice(0, 120), page: 1, searchBy }, resolve);
          });
          if (catalogQuery !== query) return;
          if (res?.ok && Array.isArray(res.items)) {
            catalogItems = res.items.map((item: any) => ({
              id: String(item.id || ''), nome: item.nome || item.name || '',
              codigo: item.codigo || item.sku || '', precoCusto: item.precoCusto ?? item.costPrice,
              preco: typeof item.preco === 'number' ? item.preco : undefined,
              imagensUrl: item.imagensUrl || item.imagens?.map((i: any) => i.url || i.link) || [],
              gtin: item.gtin || item.gtinEmbalagem || undefined,
              marca: item.marca || undefined,
              ncm: item.tributacao?.ncm || item.ncm || undefined,
              pesoBruto: item.pesoBruto || undefined,
              formato: item.formato || undefined,
            }));
            catalogLoading = false; catalogError = '';
          } else {
            catalogItems = []; catalogLoading = false; catalogError = res?.error || 'Falha ao buscar.';
          }
        } catch (e: any) {
          if (catalogQuery !== query) return;
          catalogLoading = false; catalogError = e?.message || 'Erro.';
        }
        renderResults();
      };

      input.addEventListener('input', () => {
        const q = input.value.trim(); catalogQuery = q;
        box.classList.toggle('has-value', q.length > 0);
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        if (q.length === 0) { catalogItems = []; catalogLoading = false; renderResults(); return; }
        catalogLoading = true; catalogError = ''; renderResults();
        searchDebounceTimer = setTimeout(() => doSearch(q), 320);
      });

      clearBtn.addEventListener('click', () => {
        input.value = ''; catalogQuery = ''; catalogItems = [];
        box.classList.remove('has-value'); renderResults(); input.focus();
      });

      renderResults();
      setTimeout(() => input.focus(), 260);
    }
  };

  const renderCurrentScreen = (direction: 'push' | 'pop' | 'replace' = 'push') => {
    const wrap = el('pf-screen-wrap');
    if (currentScreenEl) {
      const old = currentScreenEl;
      old.classList.add(direction === 'push' ? 'pf-screen-exit-forward' : 'pf-screen-exit');
      setTimeout(() => old.remove(), 250);
    }
    const screenEl = document.createElement('div');
    screenEl.className = `pf-screen pf-screen-enter${direction === 'pop' ? '-back' : ''}`;
    buildScreen(screenStack[screenStack.length - 1], screenEl);
    wrap.appendChild(screenEl);
    currentScreenEl = screenEl;
    
    const searchWrap = screenEl.querySelector('.pf-search-wrap');
    if (searchWrap) screenEl.addEventListener('scroll', () => searchWrap.classList.toggle('is-scrolled', screenEl.scrollTop > 2), { passive: true });
  };

  const pushScreen = (id: ScreenId) => {
    screenStack.push(id); setPopupHeight(id); renderCurrentScreen('push'); updateHeader();
  };
  const popScreen = () => {
    if (screenStack.length <= 1) { closePopup(); return; }
    screenStack.pop(); setPopupHeight(screenStack[screenStack.length - 1]); renderCurrentScreen('pop'); updateHeader();
  };
  const openPopup = (startScreen: ScreenId = 'home') => {
    popupOpen = true; isPinned = true; screenStack = [startScreen];
    updateFabState(); setPopupHeight(startScreen); renderCurrentScreen('replace'); updateHeader();
  };
  const closePopup = () => {
    popupOpen = false; isPinned = false; screenStack = [];
    updateFabState();
  };

  const refreshReading = () => {
    try {
      const snapshot = readMarketPage(document, location.href);
      const stats = marketSummary(snapshot.items);
      const fmt = (v: number | null) => v === null ? 'N/A' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      readingStats = stats.count
        ? `${stats.count} anúncio(s) nesta página\nMenor preço: ${fmt(stats.min)}\nMediana: ${fmt(stats.median)}\nPatrocinados: ${stats.sponsored}`
        : 'Abra uma busca ou anúncio e atualize.';
      readingTime = `Dados desta aba · ${new Date(snapshot.capturedAt).toLocaleTimeString('pt-BR')} · Não representa todo o mercado`;
    } catch {
      readingStats = 'Página não disponível para análise.';
      readingTime = '';
    }
    // Re-render if reading screen is active
    if (screenStack[screenStack.length - 1] === 'reading' && currentScreenEl) {
      renderCurrentScreen('replace');
    }
  };

  // ── Header buttons ──
  el('pf-ph-back').addEventListener('click', popScreen);
  el('pf-ph-close').addEventListener('click', closePopup);

  const pillsConfig = [
    { label: 'App Completo', sub: 'Abrir Painel Lateral', icon: '🚀', bg: '#f5f3ff', action: () => { chrome.runtime.sendMessage({ type: 'ML_OPEN_SIDE_PANEL' }); closePopup(); } },
    { label: 'Ações Rápidas', sub: 'Menu da extensão', icon: '⚡', bg: '#f0fdf4', action: () => openPopup('home') },
    { label: 'Análise da página', sub: 'Preços e anúncios', icon: '📊', bg: '#eff6ff', action: () => { refreshReading(); openPopup('reading'); } },
    { label: 'Catálogo Bling', sub: 'Buscar produtos', icon: '🔍', bg: '#fffbeb', action: () => openPopup('catalog') }
  ];
  const dial = el('pf-dial');
  pillsConfig.forEach((p, i) => {
    const reverseI = pillsConfig.length - 1 - i;
    const btn = document.createElement('button');
    btn.className = 'pf-pill'; btn.style.transitionDelay = `${reverseI * 45}ms`;
    btn.innerHTML = `<span class="pf-pill-icon" style="background:${p.bg}">${p.icon}</span><span class="pf-pill-text"><span class="pf-pill-label">${p.label}</span>${p.sub ? `<span class="pf-pill-sub">${p.sub}</span>` : ''}</span>`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); p.action(); });
    dial.appendChild(btn);
  });

  // ── FAB Drag & Click ──
  const fab = el('pf-fab');
  fab.addEventListener('click', (e) => {
    if (fabDidDrag) { fabDidDrag = false; return; }
    e.stopPropagation();
    if (popupOpen) { closePopup(); return; }
    isPinned = !isPinned; updateFabState();
  });
  fab.addEventListener('pointerdown', (e) => {
    fabDidDrag = false; const rect = hostEl.getBoundingClientRect();
    fabDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    fab.classList.add('is-dragging'); fab.setPointerCapture(e.pointerId);
  });
  fab.addEventListener('pointermove', (e) => {
    if (!fabDragOffset) return;
    const nx = e.clientX - fabDragOffset.x; const ny = e.clientY - fabDragOffset.y;
    const old = customPos ?? { x: (window.innerWidth || 1200) - 74, y: (window.innerHeight || 800) - 74 };
    if (!fabDidDrag && (Math.abs(nx - old.x) > 4 || Math.abs(ny - old.y) > 4)) fabDidDrag = true;
    if (fabDidDrag) { customPos = { x: nx, y: ny }; applyPos(); }
  });
  fab.addEventListener('pointerup', () => {
    if (fabDragOffset) {
      fabDragOffset = null; fab.classList.remove('is-dragging');
      if (fabDidDrag) try { window.localStorage?.setItem('pf_ml_speeddial_pos', JSON.stringify(customPos)); } catch {}
    }
  });

  shadow.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Escape') closePopup(); });

  installMarketInsights(() => { refreshReading(); openPopup('reading'); });
  updateFabState();

  const urlTimer = window.setInterval(() => {
    if (!hostEl.isConnected) { clearInterval(urlTimer); return; }
    if (lastUrl !== location.href) {
      lastUrl = location.href;
      if (screenStack[screenStack.length - 1] === 'reading') {
        readingStats = 'A página mudou. Atualize a leitura para ver os dados atuais.';
        readingTime = '';
        renderCurrentScreen('replace');
      }
    }
  }, 1000);
}



