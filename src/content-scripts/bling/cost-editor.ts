import { parseCostInput } from '../../shared/cost.ts';
export interface CostSaveResult {
    ok: boolean;
    cost?: number;
    error?: string;
    remoteUpdateMayHaveCompleted?: boolean;
}
function formatInlineBrl(cost: number | null | undefined, withSymbol = false): string {
    if (cost === null || cost === undefined) return withSymbol ? 'Definir' : '0,00';
    const num = cost.toFixed(2).replace('.', ',');
    return withSymbol ? `R$ ${num}` : num;
}
export function createCostEditor(options: {
    getCost: () => number | null;
    isCurrent: () => boolean;
    save: (value: number, expected: number | null) => Promise<CostSaveResult>;
    onSaved: (value: number) => void;
    successMessage?: string;
    prefixLabel?: string;
}): HTMLElement & { refreshDisplay?: () => void } {
    const isTableCell = !options.prefixLabel;
    const host = document.createElement('span') as HTMLElement & { refreshDisplay?: () => void };
    host.className = 'paulifest-cost-editor';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
:host{display:inline-flex;align-items:center;vertical-align:middle;font:inherit;color:inherit;max-width:100%}
*{box-sizing:border-box}[hidden]{display:none!important}
.wrap{display:inline-flex;flex-direction:column;align-items:${isTableCell ? 'flex-start' : 'flex-end'};max-width:100%}
#edit{font:inherit;color:${isTableCell ? '#28a745' : 'inherit'};border:1px solid transparent;border-radius:4px;background:transparent;padding:2px 5px;margin:-2px -5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;line-height:1.35;white-space:nowrap;transition:background .12s,border-color .12s,color .12s}
#edit:hover{background:rgba(40,167,69,.08);border-color:rgba(40,167,69,.28);color:#1e7e34}
#edit:focus-visible,input:focus-visible,.icon-btn:focus-visible{outline:2px solid #28a745;outline-offset:1px}
#edit .prefix{color:#64748b;font-weight:400;font-size:11px}
#edit .val{font-variant-numeric:tabular-nums;color:${isTableCell ? '#28a745' : '#21845e'};font-weight:${isTableCell ? '500' : '600'}}
#edit .val.empty{color:${isTableCell ? '#28a745' : '#94a3b8'};font-weight:400}
#edit .pen{width:13px;height:13px;opacity:1;fill:none;stroke:#28a745;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;transition:transform .12s,stroke .12s;flex-shrink:0}
#edit:hover .pen{stroke:#1e7e34;transform:scale(1.06)}
.editor{display:inline-flex;align-items:center;gap:3px;background:#fff;border:1px solid #28a745;border-radius:4px;padding:1px 3px;box-shadow:0 1px 4px rgba(15,23,42,.08);height:26px}
.currency{padding-left:4px;color:#64748b;font-size:11px;font-weight:500;user-select:none}
input{font:500 12px system-ui,sans-serif;width:64px;min-width:0;padding:2px 4px;border:0;background:transparent;color:#0f172a;outline:none!important;font-variant-numeric:tabular-nums;text-align:right}
.icon-btn{border:0;border-radius:3px;width:20px;height:20px;padding:0;cursor:pointer;display:inline-grid;place-items:center;font-size:11px;line-height:1;background:transparent;transition:background .12s}
.icon-btn:disabled{opacity:.45;cursor:wait}
#save{color:#fff;background:#28a745}#save:hover{background:#218838}
#cancel{color:#64748b}#cancel:hover{background:#f1f5f9;color:#0f172a}
small{display:block;font:400 10.5px/1.3 system-ui,sans-serif;max-width:210px;white-space:normal;margin-top:2px;text-align:${isTableCell ? 'left' : 'right'}}
small:empty{display:none}
small[data-state=error]{color:#b91c1c}
small[data-state=success]{color:#15803d}
small[data-state=pending]{color:#64748b}
</style><div class="wrap"><button id="edit" type="button" title="Clique para alterar o preço de custo"><svg class="pen" viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5"/><path d="M13.5 1.5a1.414 1.414 0 0 1 2 2L9 10l-3 1 1-3 6.5-6.5z"/></svg>${options.prefixLabel ? `<span class="prefix">${options.prefixLabel}</span>` : ''}<span class="val" id="val-text"></span></button><span class="editor" hidden><span class="currency">R$</span><input aria-label="Preço de custo em reais" inputmode="decimal" placeholder="0,00" autocomplete="off"><button id="save" class="icon-btn" type="button" title="Salvar (Enter)" aria-label="Salvar">✓</button><button id="cancel" class="icon-btn" type="button" title="Cancelar (Esc)" aria-label="Cancelar">✕</button></span><small role="status" aria-live="polite"></small></div>`;
    const edit = shadow.querySelector<HTMLButtonElement>('#edit')!, valText = shadow.querySelector<HTMLElement>('#val-text')!, form = shadow.querySelector<HTMLElement>('.editor')!, input = shadow.querySelector('input')!, save = shadow.querySelector<HTMLButtonElement>('#save')!, cancel = shadow.querySelector<HTMLButtonElement>('#cancel')!, status = shadow.querySelector('small')!;
    const syncDisplay = () => {
        const c = options.getCost();
        valText.textContent = formatInlineBrl(c, !isTableCell);
        valText.classList.toggle('empty', c === null || c === 0);
        edit.setAttribute('aria-label', c === null ? 'Informar preço de custo' : `Editar preço de custo (${formatInlineBrl(c, true)})`);
    };
    host.refreshDisplay = syncDisplay;
    syncDisplay();
    let expected: number | null = null, busy = false, clearTimer: number | undefined;
    host.addEventListener('click', event => event.stopPropagation());
    host.addEventListener('pointerdown', event => event.stopPropagation());
    edit.onclick = () => {
        if (!options.isCurrent()) return;
        window.clearTimeout(clearTimer);
        expected = options.getCost();
        input.value = expected === null ? '' : expected.toFixed(2).replace('.', ',');
        form.hidden = false;
        edit.hidden = true;
        status.textContent = '';
        save.disabled = false;
        input.focus();
        input.select();
    };
    cancel.onclick = () => {
        if (busy) return;
        form.hidden = true;
        edit.hidden = false;
        status.textContent = '';
        syncDisplay();
        edit.focus();
    };
    save.onclick = async () => {
        if (busy) return;
        const value = parseCostInput(input.value);
        if (value === null) {
            status.dataset.state = 'error';
            status.textContent = 'Valor inválido (ex: 12,50)';
            return;
        }
        if (!host.isConnected || !options.isCurrent()) {
            status.textContent = 'Atualize a página.';
            return;
        }
        busy = true;
        save.disabled = true;
        cancel.disabled = true;
        input.disabled = true;
        status.dataset.state = 'pending';
        status.textContent = 'Salvando…';
        form.setAttribute('aria-busy', 'true');
        let result: CostSaveResult;
        try {
            result = await options.save(value, expected);
            if (!result || typeof result.ok !== 'boolean') throw new Error('Resposta ausente');
        } catch {
            result = { ok: false, remoteUpdateMayHaveCompleted: false, error: 'Falha ao comunicar com o servidor.' };
        }
        busy = false;
        form.removeAttribute('aria-busy');
        cancel.disabled = false;
        input.disabled = false;
        if (!host.isConnected || !options.isCurrent()) return;
        if (result.ok && result.cost === value) {
            status.dataset.state = 'success';
            options.onSaved(value);
            syncDisplay();
            form.hidden = true;
            edit.hidden = false;
            status.textContent = options.successMessage || 'Salvo';
            clearTimer = window.setTimeout(() => { if (status.dataset.state === 'success') status.textContent = ''; }, 2200);
        } else {
            status.dataset.state = 'error';
            status.textContent = result.error || 'Não foi possível salvar.';
            save.disabled = Boolean(result.remoteUpdateMayHaveCompleted);
        }
    };
    input.onkeydown = event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            save.click();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel.click();
        }
    };
    return host;
}
async function resolveBlingSupplierId(): Promise<string | undefined> {
    if (typeof location === 'undefined' || !/(?:^|\.)bling\.com\.br$/i.test(location.hostname)) return undefined;
    try {
        const cached = sessionStorage.getItem('paulifest_bling_supplier_id');
        if (cached && /^[1-9]\d{0,19}$/.test(cached)) return cached;
    } catch {}
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    try {
        const rc = await fetch('/Api/v3/contatos?limite=1', { credentials: 'include', headers });
        if (rc.ok) {
            const jc = await rc.json();
            const cid = String(jc?.data?.[0]?.id || '');
            if (/^[1-9]\d{0,19}$/.test(cid)) {
                try { sessionStorage.setItem('paulifest_bling_supplier_id', cid); } catch {}
                return cid;
            }
            const createRes = await fetch('/Api/v3/contatos', {
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify({ nome: 'Fornecedor Padrão', situacao: 'A', tipo: 'F' })
            });
            if (createRes.ok) {
                const created = await createRes.json();
                const newId = String(created?.data?.id || '');
                if (/^[1-9]\d{0,19}$/.test(newId)) {
                    try { sessionStorage.setItem('paulifest_bling_supplier_id', newId); } catch {}
                    return newId;
                }
            }
        }
    } catch {}
    return undefined;
}

export async function saveInlineCost(pageInstanceId: string, productId: string, value: number, expected: number | null): Promise<CostSaveResult> {
    const supplierId = await resolveBlingSupplierId();
    return chrome.runtime.sendMessage({
        type: 'BLING_UPDATE_COST',
        pageInstanceId,
        productId,
        value,
        expected,
        expectedUrl: location.href,
        confirmed: true,
        ...(supplierId ? { supplierId } : {})
    });
}
