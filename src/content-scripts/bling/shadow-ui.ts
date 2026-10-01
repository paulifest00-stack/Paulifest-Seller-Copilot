// shadow-ui.ts — Speed Dial FAB + Native Screen Navigation (iOS-style)
//
// ARQUITETURA:
//   FAB circular → Speed Dial pills surgem ao hover
//   Cada pill abre uma TELA NATIVA dentro do popup card
//   Navegação por stack: push → slide-in da direita, pop → slide-out para direita
//   Popup adapta altura por tela via CSS custom property
//
// TELAS:
//   'home'     → catálogo de busca + status de conexão
//   'catalog'  → lista de resultados de busca
//   'product'  → detalhe do produto (custo / estoque / ações)
//   'cost'     → mini card de inputs de custo/estoque
//   'connect'  → conectar / status da conexão Bling
//   'ml'       → checklist / preparação ML
//
// DESIGN: Apple Design + Emil Kowalski principles
//   - scale(0.92)+opacity em entradas, cubic-bezier(0.23,1,0.32,1)
//   - push: translateX(100%→0), ease-drawer
//   - pop: translateX(0→30%)+opacity, 200ms
//   - :active → scale(0.97) instantâneo
//   - backdrop-filter no header
//   - tracking negativo em títulos grandes
//   - stagger 45ms nas pills
//   - NUNCA ease-in em nada de UI

import type {
  BlingPageType,
  TabContextUiState,
  ContextualActionType
} from '../../shared/tab-context-contracts.ts';
import type { BlingConnectionStatus, BlingProductQuickView } from '../../shared/gateway-contracts.ts';

// ── Tipos públicos exportados ────────────────────────────────────────────────

export interface FormattedQuickViewDisplay {
  stockText: string;
  costText: string;
  hasStock: boolean;
  hasCost: boolean;
}

export function formatQuickViewDisplay(qv: BlingProductQuickView | null | undefined): FormattedQuickViewDisplay {
  if (!qv) return { stockText: 'Não informado', costText: 'Não informado', hasStock: false, hasCost: false };
  const stock = qv.stockInfo;
  let stockText = 'Não informado'; let hasStock = false;
  if (stock != null) { hasStock = true; stockText = `Estoque: ${stock.virtualTotal} disp. (${stock.physicalTotal} físico)`; }
  let costText = 'Não informado'; let hasCost = false;
  if (qv.costPrice != null) { hasCost = true; costText = `Custo: R$ ${qv.costPrice.toFixed(2).replace('.', ',')}`; }
  return { stockText, costText, hasStock, hasCost };
}

export interface ShadowUiOptions {
  onAction: (action: ContextualActionType, options?: { openSidePanel?: boolean }) => Promise<any> | void;
  onQuickGenerateSku?: () => { ok: boolean; value?: string; message: string };
  onQuickGenerateEan?: () => { ok: boolean; value?: string; message: string };
  onQuickApplyCost?: (v: number) => Promise<{ ok: boolean; message: string }>;
  onQuickApplyStock?: (v: number) => Promise<{ ok: boolean; message: string }>;
  onQuickConnectBling?: () => void;
  onQuickRetryBling?: () => void;
}

// ── Screen types ─────────────────────────────────────────────────────────────

type ScreenId = 'home' | 'catalog' | 'product' | 'cost' | 'connect' | 'ml';



// ── CSS ──────────────────────────────────────────────────────────────────────

const HOST_ID = 'paulifest-seller-copilot-host';

const STYLES = /* css */`
  :host {
    all: initial;
    font: 13px/1.5 system-ui, -apple-system, sans-serif;
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 999999;
    pointer-events: none;
  }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }

  /* ── Design Tokens ── */
  :host {
    --pf-blue:      #1278f9;
    --pf-blue-dk:   #094eb0;
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

  /* ── Root container ── */
  .pf-root {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: none;
  }

  /* ═══════════════════════════════════════════════════════════
     POPUP CARD (contém todas as telas)
  ═══════════════════════════════════════════════════════════ */
  .pf-popup {
    pointer-events: auto;
    width: min(400px, calc(100vw - 24px));
    /* altura animada via CSS transition */
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
    /* popup aparece e some */
    transition: height 240ms var(--ease-out);
    animation: pf-popup-in 220ms var(--ease-out) both;
  }
  @keyframes pf-popup-in {
    from { opacity: 0; transform: scale(0.92) translateY(12px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pf-popup { animation: none; transition: none; }
  }

  /* ── Popup header (glassmorphism) ── */
  .pf-ph {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 14px;
    background: rgba(18, 120, 249, 0.92);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    border-bottom: 1px solid rgba(255,255,255,0.12);
  }
  .pf-ph-back {
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
  .pf-ph-back:hover { background: rgba(255,255,255,0.25); }
  .pf-ph-back:active { transform: scale(0.94); }

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
    background: rgba(255,255,255,0.2);
    color: #fff;
    border-radius: 20px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .pf-ph-action {
    width: 30px; height: 30px;
    border: 1px solid rgba(255,255,255,0.25);
    background: rgba(255,255,255,0.12);
    color: #fff;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 100ms, transform 100ms;
    flex-shrink: 0;
  }
  .pf-ph-action:hover { background: rgba(255,255,255,0.25); }
  .pf-ph-action:active { transform: scale(0.94); }

  /* ── Screen viewport (clip + overflow) ── */
  .pf-screen-wrap {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  /* ── Screen (posicionada absolutamente para animação) ── */
  .pf-screen {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    background: var(--pf-surface);
    /* scrollbar fina */
    scrollbar-width: thin;
    scrollbar-color: rgba(0,0,0,0.15) transparent;
  }
  .pf-screen::-webkit-scrollbar { width: 4px; }
  .pf-screen::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }

  /* Animações de entrada/saída das telas */
  .pf-screen-enter {
    animation: pf-screen-push-in 240ms var(--ease-drawer) both;
  }
  .pf-screen-exit {
    animation: pf-screen-pop-out 200ms var(--ease-ios-in) both;
    pointer-events: none;
  }
  .pf-screen-enter-back {
    animation: pf-screen-pop-in 240ms var(--ease-drawer) both;
  }
  .pf-screen-exit-forward {
    animation: pf-screen-push-out 200ms var(--ease-ios-in) both;
    pointer-events: none;
  }

  @keyframes pf-screen-push-in   { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @keyframes pf-screen-pop-out   { from { transform: translateX(0); opacity: 1; } to { transform: translateX(28%); opacity: 0; } }
  @keyframes pf-screen-pop-in    { from { transform: translateX(-28%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes pf-screen-push-out  { from { transform: translateX(0); opacity: 1; } to { transform: translateX(-10%); opacity: 0; } }

  @media (prefers-reduced-motion: reduce) {
    .pf-screen-enter, .pf-screen-exit,
    .pf-screen-enter-back, .pf-screen-exit-forward {
      animation: pf-fade 160ms ease both;
    }
    @keyframes pf-fade { from { opacity: 0; } to { opacity: 1; } }
  }

  /* ═══════════════════════════════════════════════════════════
     COMPONENTES DE TELA
  ═══════════════════════════════════════════════════════════ */

  /* ── Section / Card ── */
  .pf-section {
    padding: 14px 14px 0;
  }
  .pf-section:last-child { padding-bottom: 16px; }
  .pf-section-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--pf-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .pf-card {
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-r-sm);
    overflow: hidden;
  }

  /* ── Search bar ── */
  .pf-search-wrap {
    padding: 12px 14px 0;
    position: sticky;
    top: 0;
    background: var(--pf-surface);
    z-index: 1;
    border-bottom: 1px solid transparent;
  }
  .pf-search-wrap.is-scrolled { border-bottom-color: var(--pf-border); }
  .pf-search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--pf-surface-2);
    border: 1.5px solid var(--pf-border);
    border-radius: 10px;
    padding: 0 10px;
    transition: border-color 120ms, box-shadow 120ms;
    margin-bottom: 10px;
  }
  .pf-search-box:focus-within {
    border-color: var(--pf-blue);
    box-shadow: 0 0 0 3px rgba(18,120,249,0.12);
  }
  .pf-search-icon { color: var(--pf-muted); font-size: 14px; flex-shrink: 0; }
  .pf-search-input {
    flex: 1;
    border: none;
    background: transparent;
    font: 13px/1 system-ui;
    color: var(--pf-text);
    padding: 10px 0;
    outline: none;
  }
  .pf-search-input::placeholder { color: var(--pf-muted); }
  .pf-search-clear {
    width: 18px; height: 18px;
    border: none;
    background: var(--pf-muted);
    color: #fff;
    border-radius: 50%;
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 120ms;
  }
  .pf-search-box.has-value .pf-search-clear { opacity: 1; }

  /* ── Row list item ── */
  .pf-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    cursor: pointer;
    transition: background 80ms;
    border-bottom: 1px solid var(--pf-border);
  }
  .pf-row:last-child { border-bottom: none; }
  .pf-row:hover { background: rgba(18,120,249,0.04); }
  .pf-row:active { background: rgba(18,120,249,0.08); transform: scale(0.99); }
  .pf-row-img {
    width: 36px; height: 36px;
    border-radius: 8px;
    object-fit: contain;
    background: var(--pf-surface-2);
    flex-shrink: 0;
    border: 1px solid var(--pf-border);
  }
  .pf-row-img-placeholder {
    width: 36px; height: 36px;
    border-radius: 8px;
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
    color: var(--pf-muted);
  }
  .pf-row-body { flex: 1; min-width: 0; }
  .pf-row-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--pf-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pf-row-sub {
    font-size: 11px;
    color: var(--pf-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pf-row-chevron { color: #cbd5e1; font-size: 12px; flex-shrink: 0; }

  /* ── Status panel (conexão) ── */
  .pf-status-banner {
    margin: 14px;
    border-radius: var(--pf-r-sm);
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pf-status-banner.connected    { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .pf-status-banner.disconnected { background: #fef2f2; border: 1px solid #fecaca; }
  .pf-status-banner.transitory   { background: #fff7ed; border: 1px solid #fed7aa; }
  .pf-status-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .pf-status-dot.c { background: #10b981; }
  .pf-status-dot.d { background: #ef4444; animation: pf-pulse 2s ease infinite; }
  .pf-status-dot.t { background: #f59e0b; animation: pf-pulse 1.5s ease infinite; }
  @keyframes pf-pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
  .pf-status-text { flex: 1; font-size: 12px; font-weight: 600; }
  .pf-status-text span { display: block; font-size: 11px; font-weight: 400; color: var(--pf-muted); margin-top: 1px; }

  /* ── Primary button ── */
  .pf-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 11px 14px;
    border: none;
    border-radius: 10px;
    font: 600 13px/1 system-ui;
    cursor: pointer;
    transition: transform 100ms, opacity 100ms;
  }
  .pf-btn:active { transform: scale(0.97); }
  .pf-btn.primary { background: var(--pf-blue); color: #fff; }
  .pf-btn.primary:hover { background: var(--pf-blue-dk); }
  .pf-btn.secondary {
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    color: var(--pf-text);
  }
  .pf-btn.secondary:hover { background: #f1f5f9; }
  .pf-btn.danger { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
  .pf-btn:disabled { opacity: 0.5; pointer-events: none; }

  /* ── Stat grid ── */
  .pf-stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
  }
  .pf-stat {
    padding: 10px 12px;
    border-bottom: 1px solid var(--pf-border);
  }
  .pf-stat:nth-child(odd) { border-right: 1px solid var(--pf-border); }
  .pf-stat:last-child, .pf-stat:nth-last-child(2):nth-child(odd) { border-bottom: none; }
  .pf-stat-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--pf-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 3px;
  }
  .pf-stat-value {
    font-size: 14px;
    font-weight: 700;
    color: var(--pf-text);
    letter-spacing: -0.01em;
  }
  .pf-stat-value.muted { font-size: 12px; font-weight: 500; color: var(--pf-muted); }

  /* ── Inline input row ── */
  .pf-input-group {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-bottom: 1px solid var(--pf-border);
  }
  .pf-input-group:last-child { border-bottom: none; }
  .pf-input-row { display: flex; align-items: center; gap: 8px; }
  .pf-input-wrap { flex: 1; position: relative; }
  .pf-floating-label {
    position: absolute;
    top: -1px; left: 10px;
    transform: translateY(-50%);
    background: #fff;
    padding: 0 3px;
    font-size: 9px;
    font-weight: 700;
    color: var(--pf-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    pointer-events: none;
  }
  .pf-input {
    width: 100%;
    border: 1.5px solid var(--pf-border);
    border-radius: 9px;
    padding: 9px 11px;
    font: 600 13px system-ui;
    background: #fff;
    color: var(--pf-text);
    outline: none;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .pf-input:focus {
    border-color: var(--pf-blue);
    box-shadow: 0 0 0 3px rgba(18,120,249,0.12);
  }
  .pf-apply-btn {
    flex-shrink: 0;
    height: 38px;
    padding: 0 14px;
    border: none;
    background: var(--pf-blue);
    color: #fff;
    border-radius: 9px;
    font: 600 12px system-ui;
    cursor: pointer;
    transition: background 100ms, transform 100ms;
    white-space: nowrap;
  }
  .pf-apply-btn:hover { background: var(--pf-blue-dk); }
  .pf-apply-btn:active { transform: scale(0.95); }

  /* ── Feedback / status text ── */
  .pf-feedback {
    margin: 10px 14px;
    padding: 9px 12px;
    border-radius: 9px;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 7px;
    animation: pf-fade-in 160ms var(--ease-out) both;
  }
  @keyframes pf-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }
  .pf-feedback.ok  { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
  .pf-feedback.err { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .pf-feedback.info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }

  /* ── Empty state ── */
  .pf-empty {
    padding: 32px 20px;
    text-align: center;
    color: var(--pf-muted);
  }
  .pf-empty-icon { font-size: 32px; margin-bottom: 10px; opacity: 0.5; }
  .pf-empty-text { font-size: 13px; font-weight: 500; }
  .pf-empty-sub { font-size: 11px; margin-top: 4px; opacity: 0.7; }

  /* ── Loading spinner ── */
  .pf-spinner {
    width: 22px; height: 22px;
    border: 2.5px solid rgba(18,120,249,0.2);
    border-top-color: var(--pf-blue);
    border-radius: 50%;
    animation: pf-spin 0.7s linear infinite;
    margin: 0 auto;
  }
  @keyframes pf-spin { to { transform: rotate(360deg); } }

  /* ── Product hero (tela de produto) ── */
  .pf-product-hero {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border-bottom: 1px solid var(--pf-border);
  }
  .pf-product-img {
    width: 56px; height: 56px;
    border-radius: 12px;
    object-fit: contain;
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    flex-shrink: 0;
  }
  .pf-product-img-placeholder {
    width: 56px; height: 56px;
    border-radius: 12px;
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    flex-shrink: 0;
  }
  .pf-product-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--pf-text);
    letter-spacing: -0.015em;
    line-height: 1.3;
  }
  .pf-product-sku {
    font-size: 11px;
    color: var(--pf-muted);
    margin-top: 3px;
  }
  .pf-product-tag {
    display: inline-flex;
    align-items: center;
    background: rgba(18,120,249,0.08);
    color: var(--pf-blue);
    border-radius: 5px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 700;
    margin-top: 3px;
  }

  /* ── Separator ── */
  .pf-sep { height: 1px; background: var(--pf-border); margin: 0; }

  /* ── Checklist item (ML) ── */
  .pf-check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--pf-border);
  }
  .pf-check-row:last-child { border-bottom: none; }
  .pf-check-icon { font-size: 16px; flex-shrink: 0; }
  .pf-check-label { flex: 1; font-size: 12px; font-weight: 500; color: var(--pf-text); }
  .pf-check-label span { display: block; font-size: 11px; color: var(--pf-muted); margin-top: 1px; }
  .pf-check-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 20px;
    flex-shrink: 0;
  }
  .pf-check-badge.ok   { background: #dcfce7; color: #15803d; }
  .pf-check-badge.warn { background: #fef9c3; color: #a16207; }
  .pf-check-badge.err  { background: #fee2e2; color: #b91c1c; }

  /* ── Quick actions strip ── */
  .pf-actions-strip {
    display: flex;
    gap: 8px;
    padding: 12px 14px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--pf-border);
  }
  .pf-action-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 11px;
    border: 1px solid var(--pf-border);
    border-radius: 8px;
    background: var(--pf-surface-2);
    font: 600 11px system-ui;
    color: var(--pf-text);
    cursor: pointer;
    transition: background 80ms, transform 100ms, box-shadow 100ms;
  }
  .pf-action-chip:hover { background: #f1f5f9; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .pf-action-chip:active { transform: scale(0.95); }

  /* ═══════════════════════════════════════════════════════════
     SPEED DIAL — FAB + Pills
  ═══════════════════════════════════════════════════════════ */
  .pf-dial-anchor {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: auto;
  }

  /* Toast */
  .pf-toast {
    pointer-events: none;
    background: #1e293b;
    color: #fff;
    border-radius: 10px;
    padding: 7px 13px;
    font-size: 12px;
    font-weight: 600;
    max-width: 230px;
    text-align: right;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    animation: pf-toast-in 180ms var(--ease-out) both;
  }
  .pf-toast.ok  { background: #15803d; }
  .pf-toast.err { background: #b91c1c; }
  @keyframes pf-toast-in {
    from { opacity: 0; transform: translateY(6px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }

  /* Dial stack */
  .pf-dial { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }

  /* ── Pill ── */
  .pf-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 46px;
    padding: 0 18px 0 7px;
    background: #fff;
    border: none;
    border-radius: 23px;
    box-shadow:
      0 0 0 1px rgba(10,31,68,0.06),
      0 4px 16px rgba(10,31,68,0.12),
      0 1px 3px rgba(0,0,0,0.05);
    cursor: pointer;
    font: 600 13.5px/1 system-ui;
    color: #1e293b;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(10px) scale(0.92);
    pointer-events: none;
    transition:
      opacity 180ms var(--ease-out),
      transform 180ms var(--ease-out),
      box-shadow 120ms,
      background 80ms;
    will-change: transform, opacity;
  }
  @media (hover: hover) and (pointer: fine) {
    .pf-pill:hover {
      box-shadow:
        0 0 0 1px rgba(10,31,68,0.08),
        0 8px 24px rgba(10,31,68,0.18);
      transform: translateY(0) scale(1) translateX(-3px) !important;
    }
  }
  .pf-pill:active { transform: translateY(0) scale(0.96) !important; }
  .pf-pill:disabled { opacity: 0.5 !important; pointer-events: auto; cursor: not-allowed; }

  .pf-dial-anchor:hover .pf-pill,
  .pf-dial-anchor.is-pinned .pf-pill {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .pf-pill-icon {
    width: 32px; height: 32px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px;
    flex-shrink: 0;
  }
  .pf-pill-text { flex: 1; }
  .pf-pill-label { display: block; }
  .pf-pill-sub   { display: block; font-size: 10px; font-weight: 500; color: var(--pf-muted); margin-top: 1px; }
  .pf-pill-dot   { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; animation: pf-pulse 2s ease infinite; }

  /* ── FAB ── */
  .pf-fab {
    width: 54px; height: 54px;
    border-radius: 50%;
    border: none;
    background: linear-gradient(145deg, #1c87ff, var(--pf-blue-dk));
    color: #fff;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.1),
      0 4px 20px rgba(18,120,249,0.48),
      0 1px 4px rgba(0,0,0,0.12);
    position: relative;
    touch-action: none;
    user-select: none;
    pointer-events: auto;
    transition:
      transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 200ms;
    will-change: transform;
  }
  @media (hover: hover) and (pointer: fine) {
    .pf-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(18,120,249,0.58); }
  }
  .pf-fab:active  { transform: scale(0.94) !important; }
  .pf-fab.is-active { background: linear-gradient(145deg, #0b63d3, #063181); }
  .pf-fab.is-dragging { cursor: grabbing; }

  .pf-fab-logo {
    width: 30px; height: 30px;
    border-radius: 8px;
    object-fit: contain;
    transition: opacity 150ms, transform 200ms;
  }
  .pf-fab-x {
    position: absolute;
    font-size: 20px;
    font-weight: 300;
    line-height: 1;
    opacity: 0;
    transform: scale(0.5) rotate(-30deg);
    transition: opacity 150ms, transform 200ms;
    pointer-events: none;
  }
  .pf-fab.is-active .pf-fab-logo { opacity: 0; transform: scale(0.4) rotate(30deg); }
  .pf-fab.is-active .pf-fab-x    { opacity: 1; transform: scale(1) rotate(0deg); }

  .pf-fab-dot {
    position: absolute;
    top: 3px; right: 3px;
    width: 12px; height: 12px;
    border-radius: 50%;
    border: 2.5px solid #fff;
    transition: background 300ms;
  }
`;

// ── Pill interface ────────────────────────────────────────────────────────────

interface PillConfig {
  id: string;
  label: string;
  sub?: string;
  icon: string;
  iconBg: string;
  iconColor?: string;
  dot?: string;
  disabled?: boolean;
  action: () => void;
}

// ── Product item (from catalog search) ───────────────────────────────────────

interface CatalogItem {
  id: string;
  nome: string;
  codigo?: string;
  precoCusto?: number;
  preco?: number;
  imagensUrl?: string[];
  gtin?: string;
  marca?: string;
  ncm?: string;
  pesoBruto?: number;
  formato?: string;
}

// ── Main class ───────────────────────────────────────────────────────────────

export class BlingShadowUi {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  private onAction: ShadowUiOptions['onAction'];
  private onQuickGenerateSku?: ShadowUiOptions['onQuickGenerateSku'];
  private onQuickGenerateEan?: ShadowUiOptions['onQuickGenerateEan'];
  private onQuickApplyCost?: ShadowUiOptions['onQuickApplyCost'];
  private onQuickApplyStock?: ShadowUiOptions['onQuickApplyStock'];
  private onQuickConnectBling?: ShadowUiOptions['onQuickConnectBling'];
  private onQuickRetryBling?: ShadowUiOptions['onQuickRetryBling'];

  private currentUiState: TabContextUiState = { dockVisible: false, canImport: false, isSimulatedMock: true };
  private currentPageType: BlingPageType = 'other';
  private currentDetectedProduct?: { id?: string; sku?: string };
  private blingConnectionStatus: BlingConnectionStatus = 'disconnected';

  // Navigation stack
  private screenStack: ScreenId[] = [];
  private currentScreenEl: HTMLElement | null = null;
  // Selected product in catalog
  private selectedProduct: CatalogItem | null = null;
  // Catalog state
  private catalogQuery = '';
  private catalogItems: CatalogItem[] = [];
  private catalogLoading = false;
  private catalogError = '';
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Popup visible or not
  private popupOpen = false;
  private isPinned = false;

  // Drag
  private fabDragOffset: { x: number; y: number } | null = null;
  private customFabPos: { x: number; y: number } | null = null;
  private fabDidDrag = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onResize = () => this.applyFabPosition();

  // Screen heights (px)
  private readonly SCREEN_HEIGHTS: Record<ScreenId, number> = {
    home:    420,
    catalog: 500,
    product: 500,
    cost:    340,
    connect: 360,
    ml:      460,
  };

  constructor(options: ShadowUiOptions) {
    this.onAction = options.onAction;
    this.onQuickGenerateSku = options.onQuickGenerateSku;
    this.onQuickGenerateEan = options.onQuickGenerateEan;
    this.onQuickApplyCost = options.onQuickApplyCost;
    this.onQuickApplyStock = options.onQuickApplyStock;
    this.onQuickConnectBling = options.onQuickConnectBling;
    this.onQuickRetryBling = options.onQuickRetryBling;
    this.loadPrefs();
  }

  // ── Prefs ──────────────────────────────────────────────────────────────────

  private loadPrefs() {
    try {
      const raw = window.localStorage?.getItem('paulifest_speeddial_prefs');
      if (raw) { const p = JSON.parse(raw); if (typeof p.x === 'number') this.customFabPos = { x: p.x, y: p.y }; }
    } catch { /**/ }
  }
  private savePrefs() {
    try { window.localStorage?.setItem('paulifest_speeddial_prefs', JSON.stringify(this.customFabPos)); } catch { /**/ }
  }

  // ── Position ───────────────────────────────────────────────────────────────

  private applyFabPosition() {
    if (!this.host) return;
    if (this.customFabPos) {
      const W = window.innerWidth || 1200; const H = window.innerHeight || 800;
      this.host.style.left   = `${Math.min(Math.max(8, this.customFabPos.x), W - 62)}px`;
      this.host.style.top    = `${Math.min(Math.max(8, this.customFabPos.y), H - 62)}px`;
      this.host.style.right  = 'auto'; this.host.style.bottom = 'auto';
    } else {
      this.host.style.left = 'auto'; this.host.style.top = 'auto';
      this.host.style.right = '20px'; this.host.style.bottom = '20px';
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  mount() {
    if (!document?.body) return;
    let host = document.getElementById(HOST_ID);
    if (!host) { host = document.createElement('div'); host.id = HOST_ID; document.body.appendChild(host); }
    this.host = host;
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.render();
    window.addEventListener?.('resize', this.onResize);
  }

  unmount() {
    window.removeEventListener?.('resize', this.onResize);
    this.host?.parentElement?.removeChild(this.host);
    this.host = null; this.shadow = null;
  }

  minimizeForWorkspace() {
    this.closePopup();
  }

  update(uiState: TabContextUiState, pageType: BlingPageType, detectedProduct?: { id?: string; sku?: string }) {
    this.currentUiState = uiState;
    this.currentPageType = pageType;
    this.currentDetectedProduct = detectedProduct;
    if (!this.shadow) this.mount(); else this.render();
  }

  updateConnectionStatus(status: BlingConnectionStatus) {
    this.blingConnectionStatus = status;
    if (this.shadow) this.render();
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  private showToast(msg: string, type: 'ok' | 'err' | 'info' = 'info') {
    if (!this.shadow) return;
    if (this.toastTimer) { clearTimeout(this.toastTimer); this.toastTimer = null; }
    const slot = this.shadow.getElementById('pf-toast-slot');
    if (!slot) return;
    slot.replaceChildren();
    const t = document.createElement('div');
    t.className = `pf-toast${type !== 'info' ? ' ' + type : ''}`;
    t.textContent = msg;
    slot.appendChild(t);
    this.toastTimer = setTimeout(() => {
      t.style.transition = 'opacity 280ms ease'; t.style.opacity = '0';
      setTimeout(() => slot.replaceChildren(), 300);
    }, 3500);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  private openPopup(screenId: ScreenId) {
    this.popupOpen = true;
    this.isPinned = true;
    this.screenStack = [screenId];
    this.selectedProduct = null;
    this.applyPopupVisibility();
    this.setPopupHeight(screenId);
    this.renderCurrentScreen('push');
    this.updateFabState();
  }

  private closePopup() {
    this.popupOpen = false;
    this.isPinned = false;
    this.screenStack = [];
    this.applyPopupVisibility();
    this.updateFabState();
    const anchor = this.shadow?.getElementById('pf-dial-anchor');
    anchor?.classList.remove('is-pinned');
  }

  private pushScreen(screenId: ScreenId) {
    this.screenStack.push(screenId);
    this.setPopupHeight(screenId);
    this.renderCurrentScreen('push');
    this.updateHeader();
  }

  private popScreen() {
    if (this.screenStack.length <= 1) { this.closePopup(); return; }
    this.screenStack.pop();
    const prev = this.screenStack[this.screenStack.length - 1];
    this.setPopupHeight(prev);
    this.renderCurrentScreen('pop');
    this.updateHeader();
  }

  private get currentScreen(): ScreenId {
    return this.screenStack[this.screenStack.length - 1] ?? 'home';
  }

  private setPopupHeight(screen: ScreenId) {
    const popup = this.shadow?.getElementById('pf-popup') as HTMLElement | null;
    if (!popup) return;
    const h = this.SCREEN_HEIGHTS[screen];
    popup.style.setProperty('--pf-popup-h', `${h}px`);
  }

  private applyPopupVisibility() {
    const popup = this.shadow?.getElementById('pf-popup');
    if (popup) popup.hidden = !this.popupOpen;
  }

  private updateFabState() {
    const fab = this.shadow?.getElementById('pf-fab');
    const anchor = this.shadow?.getElementById('pf-dial-anchor');
    if (fab) fab.classList.toggle('is-active', this.popupOpen);
    if (anchor) anchor.classList.toggle('is-pinned', this.isPinned && !this.popupOpen);
  }

  private updateHeader() {
    const backBtn = this.shadow?.getElementById('pf-ph-back') as HTMLButtonElement | null;
    const titleEl = this.shadow?.getElementById('pf-ph-title');
    const sc = this.currentScreen;
    const titles: Record<ScreenId, string> = {
      home:    'Paulifest Copilot',
      catalog: 'Buscar Produto',
      product: this.selectedProduct?.nome || 'Produto',
      cost:    'Custo / Estoque',
      connect: 'Conexão Bling',
      ml:      'Preparar Mercado Livre',
    };
    if (titleEl) {
      titleEl.textContent = titles[sc];
      (titleEl as HTMLElement).title = titles[sc];
    }
    if (backBtn) backBtn.hidden = this.screenStack.length <= 1;
  }

  // ── Screen rendering ───────────────────────────────────────────────────────

  private renderCurrentScreen(direction: 'push' | 'pop' | 'replace' = 'push') {
    const wrap = this.shadow?.getElementById('pf-screen-wrap');
    if (!wrap) return;

    // Animate out the old screen
    if (this.currentScreenEl) {
      const old = this.currentScreenEl;
      old.classList.add(direction === 'push' ? 'pf-screen-exit-forward' : 'pf-screen-exit');
      setTimeout(() => old.remove(), 250);
      this.currentScreenEl = null;
    }

    // Build the new screen
    const screenEl = document.createElement('div');
    screenEl.className = `pf-screen pf-screen-enter${direction === 'pop' ? '-back' : ''}`;
    this.buildScreen(this.currentScreen, screenEl);
    wrap.appendChild(screenEl);
    this.currentScreenEl = screenEl;

    // Scroll listener for sticky header shadow effect
    const searchWrap = screenEl.querySelector('.pf-search-wrap');
    if (searchWrap) {
      screenEl.addEventListener('scroll', () => {
        searchWrap.classList.toggle('is-scrolled', screenEl.scrollTop > 2);
      }, { passive: true });
    }
  }

  private buildScreen(id: ScreenId, el: HTMLElement) {
    switch (id) {
      case 'home':    this.buildHomeScreen(el);    break;
      case 'catalog': this.buildCatalogScreen(el); break;
      case 'product': this.buildProductScreen(el); break;
      case 'cost':    this.buildCostScreen(el);    break;
      case 'connect': this.buildConnectScreen(el); break;
      case 'ml':      this.buildMlScreen(el);      break;
    }
  }

  // ── HOME SCREEN ──────────────────────────────────────────────────────────

  private buildHomeScreen(el: HTMLElement) {
    const isConnected  = this.blingConnectionStatus === 'connected';
    const isTransitory = this.blingConnectionStatus === 'gateway_unreachable' || this.blingConnectionStatus === 'refreshing';
    const isConnecting = this.blingConnectionStatus === 'connecting' || this.blingConnectionStatus === 'awaiting_oauth';

    // Status banner
    let bannerClass = 'disconnected'; let dot = 'd';
    let bannerTitle = 'Bling desconectado';
    let bannerSub = 'Conecte para usar o catálogo e importar produtos.';
    let bannerBtn: { label: string; action: () => void } | null = {
      label: '🔗 Conectar Bling',
      action: () => { this.onQuickConnectBling?.(); this.closePopup(); }
    };

    if (isConnected) {
      bannerClass = 'connected'; dot = 'c';
      bannerTitle = 'Bling conectado';
      bannerSub = 'Catálogo e importação disponíveis.';
      bannerBtn = null;
    } else if (isTransitory) {
      bannerClass = 'transitory'; dot = 't';
      bannerTitle = 'Reconectando…';
      bannerSub = 'Aguarde enquanto renovamos a sessão.';
      bannerBtn = { label: '🔄 Tentar novamente', action: () => this.onQuickRetryBling?.() };
    } else if (isConnecting) {
      bannerClass = 'transitory'; dot = 't';
      bannerTitle = 'Aguardando autorização…';
      bannerSub = 'Complete o login no Bling para continuar.';
      bannerBtn = null;
    }

    const banner = this.makeBanner(bannerClass, dot, bannerTitle, bannerSub, bannerBtn);
    el.appendChild(banner);

    // Menu Principal (Start Screen look-alike)
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
      this.onAction('open_in_copilot', { openSidePanel: true });
      this.closePopup();
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
    btnImport.addEventListener('click', () => {
      this.catalogQuery = ''; this.catalogItems = []; this.catalogError = '';
      this.pushScreen('catalog');
    });

    startSection.appendChild(btnNew);
    startSection.appendChild(btnImport);
    el.appendChild(startSection);

    // Se há produto detectado na página
    if (this.currentDetectedProduct?.id || this.currentUiState.quickView) {
      const qv = this.currentUiState.quickView;
      const productSection = document.createElement('div');
      productSection.className = 'pf-section';
      productSection.style.marginTop = '4px';
      const lbl = document.createElement('div');
      lbl.className = 'pf-section-label';
      lbl.textContent = 'Produto Detectado';
      productSection.appendChild(lbl);

      const card = document.createElement('div');
      card.className = 'pf-card';

      if (qv) {
        const { costText, stockText } = formatQuickViewDisplay(qv);
        const imgUrl = (qv as any)?.imageUrl || '';
        const row = document.createElement('div');
        row.className = 'pf-product-hero';
        const imgEl = imgUrl
          ? Object.assign(document.createElement('img'), { src: imgUrl, className: 'pf-product-img', alt: '' })
          : Object.assign(document.createElement('div'), { className: 'pf-product-img-placeholder', textContent: '📦' });
        const info = document.createElement('div');
        info.innerHTML = `
          <div class="pf-product-name">${escHtml(qv.name || 'Produto sem nome')}</div>
          <div class="pf-product-sku">SKU: ${escHtml(qv.sku || '—')} · ID: ${escHtml(this.currentDetectedProduct?.id || '—')}</div>
        `;
        row.appendChild(imgEl);
        row.appendChild(info);

        const stats = document.createElement('div');
        stats.className = 'pf-stat-grid';
        stats.innerHTML = `
          <div class="pf-stat"><div class="pf-stat-label">Custo</div><div class="pf-stat-value">${escHtml(costText)}</div></div>
          <div class="pf-stat"><div class="pf-stat-label">Estoque</div><div class="pf-stat-value">${escHtml(stockText)}</div></div>
        `;

        const actions = document.createElement('div');
        actions.className = 'pf-actions-strip';
        const chips: Array<{ icon: string; label: string; action: () => void }> = [];

        if (this.onQuickGenerateSku) chips.push({ icon: '⚡', label: 'Gerar SKU', action: () => { const r = this.onQuickGenerateSku!(); this.showToast(r.message, r.ok ? 'ok' : 'err'); } });
        if (this.onQuickGenerateEan) chips.push({ icon: '⚡', label: 'Gerar EAN', action: () => { const r = this.onQuickGenerateEan!(); this.showToast(r.message, r.ok ? 'ok' : 'err'); } });
        chips.push({ icon: '💰', label: 'Custo/Est.', action: () => this.pushScreen('cost') });

        if (this.currentUiState.canImport && this.currentDetectedProduct?.id) {
          chips.push({ icon: '🛒', label: 'Preparar ML', action: () => this.pushScreen('ml') });
        }

        for (const chip of chips) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pf-action-chip';
          btn.innerHTML = `<span>${chip.icon}</span> ${escHtml(chip.label)}`;
          btn.addEventListener('click', chip.action);
          actions.appendChild(btn);
        }

        card.appendChild(row);
        card.appendChild(stats);
        card.appendChild(actions);
      } else if (this.currentUiState.quickViewLoading) {
        const loading = document.createElement('div');
        loading.style.cssText = 'padding:20px;display:flex;align-items:center;justify-content:center;gap:10px;color:var(--pf-muted);font-size:12px;';
        loading.innerHTML = `<div class="pf-spinner"></div> Carregando produto…`;
        card.appendChild(loading);
      } else {
        const rowEl = document.createElement('div');
        rowEl.className = 'pf-row';
        rowEl.style.cursor = 'default';
        rowEl.innerHTML = `
          <div class="pf-row-img-placeholder">📦</div>
          <div class="pf-row-body">
            <div class="pf-row-name">Produto ID ${escHtml(this.currentDetectedProduct?.id || '—')}</div>
            <div class="pf-row-sub">Dados ainda não carregados</div>
          </div>
        `;
        card.appendChild(rowEl);
      }

      productSection.appendChild(card);
      el.appendChild(productSection);
    }
  }

  // ── CATALOG SCREEN ───────────────────────────────────────────────────────

  private buildCatalogScreen(el: HTMLElement) {
    const searchWrap = document.createElement('div');
    searchWrap.className = 'pf-search-wrap';

    const box = document.createElement('div');
    box.className = `pf-search-box${this.catalogQuery ? ' has-value' : ''}`;
    box.innerHTML = `<span class="pf-search-icon">🔍</span>`;

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'pf-search-input';
    input.placeholder = 'Nome ou SKU do produto…';
    input.value = this.catalogQuery;
    input.autocomplete = 'off';
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'pf-search-clear';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Limpar';

    box.appendChild(input);
    box.appendChild(clearBtn);
    searchWrap.appendChild(box);
    el.appendChild(searchWrap);

    // Results container
    const resultsEl = document.createElement('div');
    resultsEl.id = 'pf-catalog-results';
    el.appendChild(resultsEl);

    // Render initial results
    this.renderCatalogResults(resultsEl, input);

    // Input events
    input.addEventListener('input', () => {
      const q = input.value.trim();
      this.catalogQuery = q;
      box.classList.toggle('has-value', q.length > 0);
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      if (q.length === 0) { this.catalogItems = []; this.catalogLoading = false; this.renderCatalogResults(resultsEl, input); return; }
      this.catalogLoading = true; this.catalogError = '';
      this.renderCatalogResults(resultsEl, input);
      this.searchDebounceTimer = setTimeout(() => this.doSearch(q, resultsEl, input), 320);
    });

    clearBtn.addEventListener('click', () => {
      input.value = ''; this.catalogQuery = ''; this.catalogItems = [];
      box.classList.remove('has-value');
      this.renderCatalogResults(resultsEl, input);
      input.focus();
    });

    // Autofocus after animation
    setTimeout(() => input.focus(), 260);

    // If we had results from before, show them
    if (this.catalogItems.length > 0) this.renderCatalogResults(resultsEl, input);
  }

  private renderCatalogResults(container: HTMLElement, _input: HTMLInputElement) {
    container.replaceChildren();

    if (!this.catalogQuery) {
      const empty = document.createElement('div');
      empty.className = 'pf-empty';
      empty.innerHTML = `<div class="pf-empty-icon">🔍</div><div class="pf-empty-text">Digite para buscar</div><div class="pf-empty-sub">Nome ou código SKU do produto Bling</div>`;
      container.appendChild(empty);
      return;
    }

    if (this.catalogLoading) {
      const loading = document.createElement('div');
      loading.style.cssText = 'padding:32px;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--pf-muted);font-size:12px;';
      loading.innerHTML = `<div class="pf-spinner"></div>Buscando…`;
      container.appendChild(loading);
      return;
    }

    if (this.catalogError) {
      const errEl = document.createElement('div');
      errEl.className = 'pf-feedback err';
      errEl.style.margin = '14px';
      errEl.textContent = '⚠ ' + this.catalogError;
      container.appendChild(errEl);
      return;
    }

    if (this.catalogItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pf-empty';
      empty.innerHTML = `<div class="pf-empty-icon">😕</div><div class="pf-empty-text">Nenhum produto encontrado</div><div class="pf-empty-sub">Tente um termo diferente</div>`;
      container.appendChild(empty);
      return;
    }

    const card = document.createElement('div');
    card.className = 'pf-card';
    card.style.margin = '10px 14px 16px';

    this.catalogItems.forEach((item, idx) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pf-row';
      row.style.cssText = 'width:100%;text-align:left;background:none;cursor:pointer;';
      if (idx === this.catalogItems.length - 1) row.style.borderBottom = 'none';

      const imgUrl = item.imagensUrl?.[0] || '';
      const imgEl = imgUrl
        ? `<img class="pf-row-img" src="${escHtml(imgUrl)}" alt="" loading="lazy" />`
        : `<div class="pf-row-img-placeholder">📦</div>`;

      const costStr = item.precoCusto != null
        ? `R$ ${item.precoCusto.toFixed(2).replace('.', ',')} custo`
        : '';

      row.innerHTML = `
        ${imgEl}
        <div class="pf-row-body">
          <div class="pf-row-name">${escHtml(item.nome || 'Produto')}</div>
          <div class="pf-row-sub">${escHtml([item.codigo, costStr].filter(Boolean).join(' · '))}</div>
        </div>
        <span class="pf-row-chevron">›</span>
      `;
      row.addEventListener('click', () => {
        this.selectedProduct = item;
        this.pushScreen('product');
      });
      card.appendChild(row);
    });

    container.appendChild(card);
  }

  private async doSearch(query: string, container: HTMLElement, input: HTMLInputElement) {
    if (!query.trim() || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      const searchBy = /^\d{6,}$/.test(query.trim()) ? 'sku' : 'name';
      const res = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'BLING_SEARCH_PRODUCTS', query: query.trim().slice(0, 120), page: 1, searchBy },
          (r) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(r);
          }
        );
      });

      if (this.catalogQuery !== query) return; // stale

      if (res?.ok && Array.isArray(res.items)) {
        this.catalogItems = res.items.map((item: any) => ({
          id: String(item.id || ''),
          nome: item.nome || item.name || '',
          codigo: item.codigo || item.sku || '',
          precoCusto: typeof item.precoCusto === 'number' ? item.precoCusto : (typeof item.costPrice === 'number' ? item.costPrice : undefined),
          preco: typeof item.preco === 'number' ? item.preco : undefined,
          imagensUrl: item.imagensUrl || item.imagens?.map((i: any) => i.url || i.link) || [],
          gtin: item.gtin || item.gtinEmbalagem || undefined,
          marca: item.marca || undefined,
          ncm: item.tributacao?.ncm || item.ncm || undefined,
          pesoBruto: item.pesoBruto || undefined,
          formato: item.formato || undefined,
        }));
        this.catalogLoading = false;
        this.catalogError = '';
      } else {
        this.catalogItems = [];
        this.catalogLoading = false;
        this.catalogError = res?.error || 'Falha ao buscar produtos. Verifique a conexão com o Bling.';
      }
    } catch (e: any) {
      if (this.catalogQuery !== query) return;
      this.catalogLoading = false;
      this.catalogError = e?.message || 'Erro ao conectar com o background.';
    }
    this.renderCatalogResults(container, input);
  }

  // ── PRODUCT SCREEN ───────────────────────────────────────────────────────

  private buildProductScreen(el: HTMLElement) {
    const product = this.selectedProduct;

    // If opened from context (Bling page), use quickView data
    const qv = !product ? this.currentUiState.quickView : null;
    const imgUrl = product?.imagensUrl?.[0] || (qv as any)?.imageUrl || '';
    const nome = product?.nome || qv?.name || 'Produto';
    const codigo = product?.codigo || qv?.sku || '';
    const productId = product?.id || this.currentDetectedProduct?.id || '';

    // Hero
    const hero = document.createElement('div');
    hero.className = 'pf-product-hero';
    const imgEl = imgUrl
      ? Object.assign(document.createElement('img'), { src: imgUrl, alt: '', className: 'pf-product-img', loading: 'lazy' })
      : Object.assign(document.createElement('div'), { className: 'pf-product-img-placeholder', textContent: '📦' });
    const info = document.createElement('div');
    info.innerHTML = `
      <div class="pf-product-name">${escHtml(nome)}</div>
      ${codigo ? `<div class="pf-product-sku">SKU: ${escHtml(codigo)}</div>` : ''}
      ${productId ? `<div class="pf-product-tag">ID ${escHtml(productId)}</div>` : ''}
    `;
    hero.appendChild(imgEl);
    hero.appendChild(info);
    el.appendChild(hero);

    // Stats
    const { costText, stockText } = product
      ? { costText: product.precoCusto != null ? `R$ ${product.precoCusto.toFixed(2).replace('.', ',')}` : '—', stockText: '—' }
      : formatQuickViewDisplay(qv);

    const statsCard = document.createElement('div');
    statsCard.className = 'pf-section';
    const lbl = document.createElement('div');
    lbl.className = 'pf-section-label';
    lbl.textContent = 'Dados do produto';
    statsCard.appendChild(lbl);
    const grid = document.createElement('div');
    grid.className = 'pf-card';
    grid.innerHTML = `
      <div class="pf-stat-grid">
        <div class="pf-stat"><div class="pf-stat-label">Custo</div><div class="pf-stat-value">${escHtml(costText)}</div></div>
        <div class="pf-stat"><div class="pf-stat-label">Estoque</div><div class="pf-stat-value">${escHtml(stockText)}</div></div>
        ${product?.preco != null ? `<div class="pf-stat"><div class="pf-stat-label">Preço</div><div class="pf-stat-value">R$ ${product.preco.toFixed(2).replace('.', ',')}</div></div>` : ''}
      </div>
    `;
    statsCard.appendChild(grid);
    el.appendChild(statsCard);

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
      el.appendChild(extraSection);
    }

    // Actions
    const actionsSection = document.createElement('div');
    actionsSection.className = 'pf-section';
    actionsSection.style.cssText = 'margin-top:4px;padding-bottom:16px;display:flex;flex-direction:column;gap:8px;';

    const lbl2 = document.createElement('div');
    lbl2.className = 'pf-section-label';
    lbl2.textContent = 'Ações';
    actionsSection.appendChild(lbl2);

    // Cost/stock button
    if (this.onQuickApplyCost || this.onQuickApplyStock) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pf-btn secondary';
      btn.innerHTML = '💰 Aplicar custo / estoque';
      btn.addEventListener('click', () => this.pushScreen('cost'));
      actionsSection.appendChild(btn);
    }

    // ML
    if (this.currentUiState.canImport && (productId || this.selectedProduct?.id)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pf-btn primary';
      btn.innerHTML = '🛒 Preparar para Mercado Livre';
      btn.addEventListener('click', () => this.pushScreen('ml'));
      actionsSection.appendChild(btn);
    }

    // Open in sidepanel
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'pf-btn secondary';
    openBtn.innerHTML = '↗ Abrir no app completo';
    openBtn.addEventListener('click', () => {
      this.onAction('open_in_copilot', { openSidePanel: true });
      this.closePopup();
    });
    actionsSection.appendChild(openBtn);
    el.appendChild(actionsSection);
  }

  // ── COST SCREEN ──────────────────────────────────────────────────────────

  private buildCostScreen(el: HTMLElement) {
    const qv = this.currentUiState.quickView;
    const { costText, stockText } = formatQuickViewDisplay(qv);

    // Current values
    const currentSection = document.createElement('div');
    currentSection.className = 'pf-section';
    const lbl = document.createElement('div');
    lbl.className = 'pf-section-label';
    lbl.textContent = 'Valores Atuais';
    currentSection.appendChild(lbl);
    const grid = document.createElement('div');
    grid.className = 'pf-card';
    grid.innerHTML = `<div class="pf-stat-grid">
      <div class="pf-stat"><div class="pf-stat-label">Custo</div><div class="pf-stat-value${qv?.costPrice == null ? ' muted' : ''}">${escHtml(costText)}</div></div>
      <div class="pf-stat"><div class="pf-stat-label">Estoque</div><div class="pf-stat-value${!qv?.stockInfo ? ' muted' : ''}">${escHtml(stockText)}</div></div>
    </div>`;
    currentSection.appendChild(grid);
    el.appendChild(currentSection);

    // Inputs
    const inputSection = document.createElement('div');
    inputSection.className = 'pf-section';
    inputSection.style.marginTop = '4px';
    const lbl2 = document.createElement('div');
    lbl2.className = 'pf-section-label';
    lbl2.textContent = 'Aplicar Novo Valor';
    inputSection.appendChild(lbl2);

    const card = document.createElement('div');
    card.className = 'pf-card';

    const feedbackEl = document.createElement('div');
    feedbackEl.style.cssText = 'padding: 0;';

    const showFeedback = (msg: string, type: 'ok' | 'err' | 'info') => {
      feedbackEl.innerHTML = '';
      const f = document.createElement('div');
      f.className = `pf-feedback ${type}`;
      f.style.cssText = 'margin:10px 14px;';
      f.textContent = (type === 'ok' ? '✓ ' : type === 'err' ? '⚠ ' : 'ℹ ') + msg;
      feedbackEl.appendChild(f);
    };

    // Cost row
    if (this.onQuickApplyCost) {
      const group = document.createElement('div');
      group.className = 'pf-input-group';
      const row = document.createElement('div');
      row.className = 'pf-input-row';
      const wrap = document.createElement('div');
      wrap.className = 'pf-input-wrap';
      const floatLabel = document.createElement('span');
      floatLabel.className = 'pf-floating-label';
      floatLabel.textContent = 'Custo R$';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'pf-input';
      input.placeholder = 'ex: 25,90';
      input.inputMode = 'decimal';
      if (qv?.costPrice != null) input.value = qv.costPrice.toFixed(2).replace('.', ',');
      wrap.appendChild(floatLabel);
      wrap.appendChild(input);

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'pf-apply-btn';
      applyBtn.textContent = 'Aplicar';
      applyBtn.addEventListener('click', async () => {
        const raw = input.value.trim().replace(/\./g, '').replace(',', '.');
        const val = Number(raw);
        if (!raw || !Number.isFinite(val) || val < 0) { showFeedback('Valor inválido', 'err'); return; }
        applyBtn.disabled = true; applyBtn.textContent = '…';
        const res = await this.onQuickApplyCost!(val);
        applyBtn.disabled = false; applyBtn.textContent = 'Aplicar';
        showFeedback(res.message, res.ok ? 'ok' : 'err');
      });

      row.appendChild(wrap);
      row.appendChild(applyBtn);
      group.appendChild(row);
      card.appendChild(group);
    }

    // Stock row
    if (this.onQuickApplyStock) {
      const group = document.createElement('div');
      group.className = 'pf-input-group';
      group.style.borderTop = '1px solid var(--pf-border)';
      const row = document.createElement('div');
      row.className = 'pf-input-row';
      const wrap = document.createElement('div');
      wrap.className = 'pf-input-wrap';
      const floatLabel = document.createElement('span');
      floatLabel.className = 'pf-floating-label';
      floatLabel.textContent = 'Estoque (un)';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'pf-input';
      input.placeholder = 'ex: 10';
      input.inputMode = 'decimal';
      wrap.appendChild(floatLabel);
      wrap.appendChild(input);

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'pf-apply-btn';
      applyBtn.textContent = 'Aplicar';
      applyBtn.addEventListener('click', async () => {
        const raw = input.value.trim().replace(',', '.');
        const val = Number(raw);
        if (!raw || !Number.isFinite(val) || val < 0) { showFeedback('Valor inválido', 'err'); return; }
        applyBtn.disabled = true; applyBtn.textContent = '…';
        const res = await this.onQuickApplyStock!(val);
        applyBtn.disabled = false; applyBtn.textContent = 'Aplicar';
        showFeedback(res.message, res.ok ? 'ok' : 'err');
      });

      row.appendChild(wrap);
      row.appendChild(applyBtn);
      group.appendChild(row);
      card.appendChild(group);
    }

    inputSection.appendChild(card);
    inputSection.appendChild(feedbackEl);
    el.appendChild(inputSection);

    // SKU/EAN chips
    if (this.onQuickGenerateSku || this.onQuickGenerateEan) {
      const chipSection = document.createElement('div');
      chipSection.className = 'pf-section';
      chipSection.style.cssText = 'margin-top:4px;padding-bottom:16px;';
      const lbl3 = document.createElement('div');
      lbl3.className = 'pf-section-label';
      lbl3.textContent = 'Identificadores';
      chipSection.appendChild(lbl3);
      const strip = document.createElement('div');
      strip.className = 'pf-actions-strip';
      if (this.onQuickGenerateSku) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pf-action-chip';
        b.innerHTML = '<span>⚡</span> Gerar SKU';
        b.addEventListener('click', () => { const r = this.onQuickGenerateSku!(); showFeedback(r.message, r.ok ? 'ok' : 'err'); });
        strip.appendChild(b);
      }
      if (this.onQuickGenerateEan) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pf-action-chip';
        b.innerHTML = '<span>⚡</span> Gerar EAN-13';
        b.addEventListener('click', () => { const r = this.onQuickGenerateEan!(); showFeedback(r.message, r.ok ? 'ok' : 'err'); });
        strip.appendChild(b);
      }
      chipSection.appendChild(strip);
      el.appendChild(chipSection);
    }
  }

  // ── CONNECT SCREEN ────────────────────────────────────────────────────────

  private buildConnectScreen(el: HTMLElement) {
    const status = this.blingConnectionStatus;
    const isConnected = status === 'connected';
    const isConnecting = status === 'connecting' || status === 'awaiting_oauth';

    const bannerClass = isConnected ? 'connected' : isConnecting ? 'transitory' : 'disconnected';
    const dot = isConnected ? 'c' : isConnecting ? 't' : 'd';
    const title = isConnected ? 'Bling conectado' : isConnecting ? 'Aguardando…' : 'Bling desconectado';
    const sub = isConnected ? 'Catálogo, importação e custos disponíveis.' : isConnecting ? 'Conclua o login na aba do Bling.' : 'Conecte para usar o catálogo e importar produtos.';

    el.appendChild(this.makeBanner(bannerClass, dot, title, sub, null));

    const section = document.createElement('div');
    section.className = 'pf-section';
    section.style.cssText = 'padding-bottom:16px;display:flex;flex-direction:column;gap:8px;';

    if (!isConnected && !isConnecting) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'pf-btn primary';
      btn.innerHTML = '🔗 Iniciar conexão OAuth';
      btn.addEventListener('click', () => { this.onQuickConnectBling?.(); this.closePopup(); });
      section.appendChild(btn);
    }

    if (isConnecting) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'pf-btn secondary';
      btn.innerHTML = '🔍 Focar aba do Bling';
      btn.addEventListener('click', () => { chrome.runtime?.sendMessage?.({ type: 'BLING_FOCUS_OAUTH_TAB' }); });
      section.appendChild(btn);
    }

    if (!isConnected && !isConnecting) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button'; retryBtn.className = 'pf-btn secondary';
      retryBtn.innerHTML = '🔄 Verificar novamente';
      retryBtn.addEventListener('click', () => this.onQuickRetryBling?.());
      section.appendChild(retryBtn);
    }

    const infoBox = document.createElement('div');
    infoBox.className = 'pf-feedback info';
    infoBox.style.margin = '0';
    infoBox.innerHTML = `<span>ℹ</span> ${isConnected ? 'Você pode <b>desconectar</b> pelo app completo nas configurações.' : 'A conexão usa OAuth 2.0. Nenhuma senha é armazenada.'}`;
    section.appendChild(infoBox);

    el.appendChild(section);
  }

  // ── ML SCREEN ────────────────────────────────────────────────────────────

  private buildMlScreen(el: HTMLElement) {
    const qv = this.currentUiState.quickView;
    const product = this.selectedProduct;
    const nome = product?.nome || qv?.name || 'Produto';
    const { costText } = product
      ? { costText: product.precoCusto != null ? `R$ ${product.precoCusto.toFixed(2).replace('.', ',')}` : null }
      : formatQuickViewDisplay(qv);
    const hasPrice = qv?.costPrice != null || product?.precoCusto != null;
    const hasImage = (product?.imagensUrl?.length || (qv as any)?.imageUrl) ? true : false;
    const hasSku = Boolean(product?.codigo || qv?.sku);

    // Checklist
    const checks: Array<{ icon: string; label: string; sub: string; ok: boolean; warn?: boolean }> = [
      { icon: '📝', label: 'Nome do produto', sub: nome, ok: Boolean(nome && nome.length > 3) },
      { icon: '🔖', label: 'SKU / código', sub: hasSku ? 'Preenchido' : 'Não informado', ok: hasSku, warn: !hasSku },
      { icon: '💰', label: 'Custo', sub: costText || 'Não informado', ok: hasPrice, warn: !hasPrice },
      { icon: '🖼️', label: 'Imagem', sub: hasImage ? 'Disponível' : 'Nenhuma imagem', ok: hasImage, warn: !hasImage },
      { icon: '📦', label: 'Conexão Bling', sub: this.blingConnectionStatus === 'connected' ? 'Conectado' : 'Desconectado', ok: this.blingConnectionStatus === 'connected' },
    ];

    const section = document.createElement('div');
    section.className = 'pf-section';
    const lbl = document.createElement('div');
    lbl.className = 'pf-section-label';
    lbl.textContent = 'Checklist de pré-publicação';
    section.appendChild(lbl);

    const card = document.createElement('div');
    card.className = 'pf-card';
    checks.forEach(c => {
      const row = document.createElement('div');
      row.className = 'pf-check-row';
      const badge = c.ok ? '<span class="pf-check-badge ok">OK</span>'
        : c.warn ? '<span class="pf-check-badge warn">Atenção</span>'
        : '<span class="pf-check-badge err">Incompleto</span>';
      row.innerHTML = `
        <span class="pf-check-icon">${c.icon}</span>
        <div class="pf-check-label">${escHtml(c.label)}<span>${escHtml(c.sub)}</span></div>
        ${badge}
      `;
      card.appendChild(row);
    });
    section.appendChild(card);
    el.appendChild(section);

    // CTA
    const ctaSection = document.createElement('div');
    ctaSection.className = 'pf-section';
    ctaSection.style.cssText = 'margin-top:4px;padding-bottom:16px;display:flex;flex-direction:column;gap:8px;';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pf-btn primary';
    btn.innerHTML = '🚀 Preparar no App Completo';
    btn.addEventListener('click', () => {
      const p = this.onAction('prepare_mercadolivre', { openSidePanel: false });
      const go = () => this.onAction('open_in_copilot', { openSidePanel: true });
      if (p && typeof (p as Promise<any>).finally === 'function') void (p as Promise<any>).finally(go);
      else go();
      this.closePopup();
    });
    ctaSection.appendChild(btn);

    const lateralBtn = document.createElement('button');
    lateralBtn.type = 'button';
    lateralBtn.className = 'pf-btn secondary';
    lateralBtn.innerHTML = '↗ Abrir na lateral';
    lateralBtn.addEventListener('click', () => { this.onAction('open_in_copilot', { openSidePanel: true }); this.closePopup(); });
    ctaSection.appendChild(lateralBtn);

    el.appendChild(ctaSection);
  }

  // ── Helper: status banner ─────────────────────────────────────────────────

  private makeBanner(
    cls: string, dot: string, title: string, sub: string,
    btn: { label: string; action: () => void } | null
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.padding = '14px 14px 0';
    const banner = document.createElement('div');
    banner.className = `pf-status-banner ${cls}`;
    const dotEl = document.createElement('div');
    dotEl.className = `pf-status-dot ${dot}`;
    const text = document.createElement('div');
    text.className = 'pf-status-text';
    text.innerHTML = `${escHtml(title)}<span>${escHtml(sub)}</span>`;
    banner.appendChild(dotEl);
    banner.appendChild(text);
    if (btn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'flex-shrink:0;border:1px solid currentColor;border-radius:8px;padding:5px 10px;font:600 11px system-ui;cursor:pointer;background:transparent;color:inherit;transition:opacity 120ms;';
      b.textContent = btn.label;
      b.addEventListener('click', btn.action);
      banner.appendChild(b);
    }
    wrap.appendChild(banner);
    return wrap;
  }

  // ── Build Pills ────────────────────────────────────────────────────────────

  private buildPills(): PillConfig[] {
    const isConnected   = this.blingConnectionStatus === 'connected';
    const isTransitory  = this.blingConnectionStatus === 'gateway_unreachable' || this.blingConnectionStatus === 'refreshing';
    const isDisconnected = !isConnected && !isTransitory;
    const isConnecting   = this.blingConnectionStatus === 'connecting' || this.blingConnectionStatus === 'awaiting_oauth';

    const isNew  = this.currentPageType === 'product_form_new';
    const isEdit = this.currentPageType === 'product_form_edit';
    const isForm = isNew || isEdit;
    const hasId  = Boolean(this.currentDetectedProduct?.id);
    const canImport = isConnected && this.currentUiState.canImport && hasId;

    const pills: PillConfig[] = [];

    // ── Catálogo / Busca (sempre disponível) ─────────────────────────────────
    pills.push({
      id: 'catalog', label: 'Catálogo Bling', sub: 'Buscar produtos',
      icon: '🔍', iconBg: '#eff6ff',
      action: () => {
        this.catalogQuery = ''; this.catalogItems = []; this.catalogError = '';
        this.openPopup('catalog');
      }
    });

    // ── Ações Rápidas (Home menu) ────────────────────────────────────────────
    pills.push({
      id: 'home', label: 'Ações Rápidas', sub: 'Menu da extensão',
      icon: '⚡', iconBg: '#f0fdf4',
      action: () => this.openPopup('home')
    });

    // ── App completo (Abre Side Panel) ───────────────────────────────────────
    pills.push({
      id: 'app', label: 'App Completo', sub: 'Abrir Painel Lateral',
      icon: '🚀', iconBg: '#f5f3ff',
      action: () => {
        this.onAction('open_in_copilot', { openSidePanel: true });
        this.closePopup();
      }
    });

    // ── Preparar ML ──────────────────────────────────────────────────────────
    if (canImport) {
      pills.push({
        id: 'ml', label: 'Preparar ML', sub: 'Anúncio Mercado Livre',
        icon: '🛒', iconBg: '#fff7ed', dot: '#f59e0b',
        action: () => { this.selectedProduct = null; this.openPopup('ml'); }
      });
    }

    // ── Formulário Bling ─────────────────────────────────────────────────────
    if (isForm) {
      const qv = this.currentUiState.quickView;
      pills.push({
        id: 'cost', label: 'Custo / Estoque',
        sub: qv?.costPrice != null ? `R$ ${qv.costPrice.toFixed(2).replace('.', ',')}` : undefined,
        icon: '💰', iconBg: '#f0fdf4',
        action: () => { this.selectedProduct = null; this.openPopup('cost'); }
      });

      if (this.onQuickGenerateEan) pills.push({
        id: 'ean', label: 'Gerar EAN-13', icon: '⚡', iconBg: '#f5f3ff',
        action: () => { const r = this.onQuickGenerateEan!(); this.showToast(r.message, r.ok ? 'ok' : 'err'); }
      });
      if (this.onQuickGenerateSku) pills.push({
        id: 'sku', label: 'Gerar SKU', icon: '⚡', iconBg: '#f5f3ff',
        action: () => { const r = this.onQuickGenerateSku!(); this.showToast(r.message, r.ok ? 'ok' : 'err'); }
      });
    }

    // ── Conexão ──────────────────────────────────────────────────────────────
    if (isTransitory) pills.push({
      id: 'retry', label: 'Reconectar Bling', icon: '🔄', iconBg: '#fff7ed', dot: '#f59e0b',
      disabled: this.blingConnectionStatus === 'refreshing',
      action: () => this.onQuickRetryBling?.()
    });
    else if (isDisconnected && !isConnecting) pills.push({
      id: 'connect', label: 'Conectar Bling', sub: 'Necessário para importar',
      icon: '🔗', iconBg: '#fef2f2', dot: '#ef4444',
      action: () => this.openPopup('connect')
    });

    return pills;
  }

  private renderPills() {
    const dial = this.shadow?.getElementById('pf-dial');
    if (!dial) return;
    dial.replaceChildren();
    const pills = this.buildPills();
    pills.forEach((pill, i) => {
      const delay = (pills.length - 1 - i) * 45;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pf-pill';
      btn.style.transitionDelay = `${delay}ms`;
      if (pill.disabled) btn.disabled = true;

      const icon = document.createElement('span');
      icon.className = 'pf-pill-icon';
      icon.style.background = pill.iconBg;
      if (pill.iconColor) icon.style.color = pill.iconColor;
      icon.textContent = pill.icon;
      icon.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'pf-pill-text';
      const labelEl = document.createElement('span');
      labelEl.className = 'pf-pill-label';
      labelEl.textContent = pill.label;
      text.appendChild(labelEl);
      if (pill.sub) {
        const sub = document.createElement('span');
        sub.className = 'pf-pill-sub';
        sub.textContent = pill.sub;
        text.appendChild(sub);
      }

      btn.appendChild(icon);
      btn.appendChild(text);

      if (pill.dot) {
        const dot = document.createElement('span');
        dot.className = 'pf-pill-dot';
        dot.style.background = pill.dot;
        btn.appendChild(dot);
      }

      btn.addEventListener('click', e => { e.stopPropagation(); if (!pill.disabled) pill.action(); });
      dial.appendChild(btn);
    });
  }

  // ── Main Render ────────────────────────────────────────────────────────────

  private render() {
    if (!this.shadow) return;

    if (!this.currentUiState.dockVisible || this.currentPageType === 'other') {
      this.shadow.innerHTML = ''; this.popupOpen = false; this.isPinned = false;
      this.currentScreenEl = null; this.screenStack = [];
      return;
    }

    const isConnected  = this.blingConnectionStatus === 'connected';
    const isTransitory = this.blingConnectionStatus === 'gateway_unreachable' || this.blingConnectionStatus === 'refreshing';
    const fabDotColor  = isConnected ? '#10b981' : isTransitory ? '#f59e0b' : '#ef4444';
    const badgeLabel   = this.currentUiState.isSimulatedMock ? 'Prévia' : 'Bling';

    this.applyFabPosition();

    // Bootstrap HTML once
    if (!this.shadow.getElementById('pf-root')) {
      this.shadow.innerHTML = `<style>${STYLES}</style>
      <div id="pf-root" class="pf-root">

        <!-- Popup card -->
        <div id="pf-popup" class="pf-popup" hidden style="--pf-popup-h: ${this.SCREEN_HEIGHTS.home}px">
          <div class="pf-ph">
            <button id="pf-ph-back" class="pf-ph-back" type="button" aria-label="Voltar" hidden>‹</button>
            <div id="pf-ph-title" class="pf-ph-title">Paulifest Copilot</div>
            <span id="pf-ph-badge" class="pf-ph-badge"></span>
            <button id="pf-ph-close" class="pf-ph-action" type="button" aria-label="Fechar">✕</button>
          </div>
          <div id="pf-screen-wrap" class="pf-screen-wrap"></div>
        </div>

        <!-- Speed Dial -->
        <div id="pf-dial-anchor" class="pf-dial-anchor">
          <div id="pf-toast-slot"></div>
          <div id="pf-dial" class="pf-dial"></div>
          <button id="pf-fab" class="pf-fab" type="button" aria-label="Paulifest Copilot">
            <img id="pf-fab-logo" class="pf-fab-logo" alt="" />
            <span class="pf-fab-x" aria-hidden="true">✕</span>
            <span id="pf-fab-dot" class="pf-fab-dot"></span>
          </button>
        </div>

      </div>`;

      // Logo
      const logoUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('icons/logo.png') : '';
      if (logoUrl) {
        (this.shadow.getElementById('pf-fab-logo') as HTMLImageElement).src = logoUrl;
      }

      // Header back button
      this.shadow.getElementById('pf-ph-back')?.addEventListener('click', e => { e.stopPropagation(); this.popScreen(); });

      // Header close
      this.shadow.getElementById('pf-ph-close')?.addEventListener('click', e => { e.stopPropagation(); this.closePopup(); });

      // FAB click (toggle pin or close popup)
      const fab = this.shadow.getElementById('pf-fab')!;
      fab.addEventListener('click', e => {
        if (this.fabDidDrag) { this.fabDidDrag = false; return; }
        e.stopPropagation();
        if (this.popupOpen) { this.closePopup(); return; }
        if (this.isPinned) { this.isPinned = false; this.updateFabState(); return; }
        this.isPinned = true; this.updateFabState();
        const anchor = this.shadow?.getElementById('pf-dial-anchor');
        anchor?.classList.add('is-pinned');
      });

      // FAB drag
      fab.addEventListener('pointerdown', e => {
        this.fabDidDrag = false;
        if (!this.host) return;
        const rect = this.host.getBoundingClientRect();
        this.fabDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        fab.classList.add('is-dragging');
        fab.setPointerCapture(e.pointerId);
      });
      fab.addEventListener('pointermove', e => {
        if (!this.fabDragOffset || !this.host) return;
        const nx = e.clientX - this.fabDragOffset.x;
        const ny = e.clientY - this.fabDragOffset.y;
        const old = this.customFabPos ?? { x: (window.innerWidth || 1200) - 74, y: (window.innerHeight || 800) - 74 };
        if (!this.fabDidDrag && (Math.abs(nx - old.x) > 4 || Math.abs(ny - old.y) > 4)) this.fabDidDrag = true;
        if (this.fabDidDrag) { this.customFabPos = { x: nx, y: ny }; this.applyFabPosition(); }
      });
      fab.addEventListener('pointerup', () => {
        if (this.fabDragOffset) {
          this.fabDragOffset = null;
          fab.classList.remove('is-dragging');
          if (this.fabDidDrag) this.savePrefs();
        }
      });
    }

    // Dynamic updates
    const badge = this.shadow.getElementById('pf-ph-badge');
    if (badge) badge.textContent = badgeLabel;
    const fabDot = this.shadow.getElementById('pf-fab-dot') as HTMLElement | null;
    if (fabDot) fabDot.style.background = fabDotColor;

    this.renderPills();
    this.applyPopupVisibility();
    this.updateFabState();
  }
}

// ── Util ──────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
